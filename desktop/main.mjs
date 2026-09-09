import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  session,
  shell,
} from 'electron'
import { createModelSettingsService } from '../bridge/model-settings.js'
import { restoreWorkspaceBackup } from '../bridge/node-backup-restore.js'
import { startNodeRuntime } from '../bridge/node-runtime.js'
import {
  closeDesktopResources,
  createShutdownController,
  focusExistingWindow,
  handleAllWindowsClosed,
  completeDesktopSmoke,
} from './lifecycle.mjs'
import {
  addDesktopAuthHeader,
  desktopSmokeStartupOverrides,
  formatDesktopRestoreError,
  rememberedWorkspaceRootForDesktopStartup,
  resolveDesktopRestoreWorkspace,
  resolveDesktopWorkspace,
  resolveDesktopStartupWorkspace,
  workspaceRootForDesktopState,
} from './main-policy.mjs'
import { verifyRendererReady } from './renderer-readiness.mjs'
import { createDesktopStateWriter } from './state-writer.mjs'
import {
  createBrowserWindowOptions,
  desktopListenOptions,
  isAllowedExternalUrl,
  isAllowedNavigation,
  visibleWindowBounds,
} from './security-policy.mjs'
import {
  prepareWorkspaceRoot,
  readDesktopState,
  writeDesktopState,
} from './workspace.mjs'

const runtimeRoot = dirname(fileURLToPath(import.meta.url))
const staticRoot = join(runtimeRoot, 'dist')
const preloadPath = join(runtimeRoot, 'preload.js')
const WINDOW_STATE_DELAY_MS = 250

let mainWindow = null
let nodeRuntime = null
let nodeRuntimeStartup = null
let applicationUrl = ''
let launchToken = ''
let workspaceRoot = ''
let pendingWorkspaceRoot = ''
let userDataRoot = ''
let windowBounds
let stateWriteTimer
let quittingAfterCleanup = false
let shutdownRequested = false
let switchingWorkspace = false

function reportStateWriteFailure(error) {
  console.error('[mira-desktop] failed to persist desktop state:', error)
}

const desktopStateWriter = createDesktopStateWriter({
  writeState(snapshot) {
    return writeDesktopState(userDataRoot, snapshot)
  },
  onBackgroundError: reportStateWriteFailure,
})

function currentNormalBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return windowBounds
  return mainWindow.getNormalBounds()
}

function currentStateWorkspaceRoot() {
  return workspaceRootForDesktopState({
    activeWorkspaceRoot: workspaceRoot,
    pendingWorkspaceRoot,
  })
}

function queueDesktopStateWrite() {
  const stateWorkspaceRoot = currentStateWorkspaceRoot()
  if (!stateWorkspaceRoot || !userDataRoot) return Promise.resolve()
  windowBounds = currentNormalBounds()
  const snapshot = { workspaceRoot: stateWorkspaceRoot, windowBounds }
  return desktopStateWriter.write(snapshot)
}

function scheduleDesktopStateWrite() {
  if (switchingWorkspace) return
  windowBounds = currentNormalBounds()
  clearTimeout(stateWriteTimer)
  stateWriteTimer = setTimeout(() => {
    stateWriteTimer = undefined
    const stateWorkspaceRoot = currentStateWorkspaceRoot()
    if (!stateWorkspaceRoot || !userDataRoot) return
    windowBounds = currentNormalBounds()
    desktopStateWriter.writeInBackground({
      workspaceRoot: stateWorkspaceRoot,
      windowBounds,
    })
  }, WINDOW_STATE_DELAY_MS)
}

async function chooseDirectory() {
  const options = {
    title: '选择 Mira 工作区',
    buttonLabel: '使用此文件夹',
    message: 'Mira 的卡片、运行记录和方法将保存在这里。',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] || null
}

async function chooseStartupAction() {
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '打开 Mira',
    message: '选择 Mira 工作区',
    detail: '使用现有工作区，或从完整 Mira 备份恢复到一个新建或空文件夹。',
    buttons: ['选择工作区', '从 Mira 备份恢复', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  return ['workspace', 'restore', 'quit'][result.response] || 'quit'
}

async function chooseBackupFile() {
  const result = await dialog.showOpenDialog({
    title: '选择 Mira 备份',
    buttonLabel: '选择此备份',
    message: '选择一个 .mira-backup.json 或 JSON 格式的完整 Mira 备份。',
    properties: ['openFile'],
    filters: [
      { name: 'Mira 备份', extensions: ['json'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0] || null
}

async function chooseRestoreDirectory() {
  const result = await dialog.showOpenDialog({
    title: '选择恢复后的 Mira 工作区',
    buttonLabel: '恢复到此文件夹',
    message: '目标必须是新建或完全空的文件夹，现有工作区不会被覆盖。',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  })
  return result.canceled ? null : result.filePaths[0] || null
}

async function reportInvalidWorkspace({ path, error, remembered }) {
  const options = {
    type: 'error',
    title: '无法使用这个工作区',
    message: remembered ? '之前的 Mira 工作区已不可用' : '无法使用所选文件夹',
    detail: `${path}\n\n${error?.message || '请确认该文件夹存在且可读写。'}`,
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, options)
  } else {
    await dialog.showMessageBox(options)
  }
}

async function reportRestoreError({ error }) {
  await dialog.showMessageBox(formatDesktopRestoreError(error))
}

async function selectStartupWorkspace(rememberedWorkspaceRoot) {
  const smokeOverrides = desktopSmokeStartupOverrides(process.env)
  if (smokeOverrides.restore === null) {
    throw new Error('Packed restore smoke requires a backup file and restore workspace')
  }
  let pendingSmokeRestore = smokeOverrides.restore

  return resolveDesktopStartupWorkspace({
    rememberedWorkspaceRoot: rememberedWorkspaceRootForDesktopStartup(
      smokeOverrides,
      rememberedWorkspaceRoot,
    ),
    prepareWorkspaceRoot,
    chooseAction: pendingSmokeRestore
      ? async () => {
          if (!pendingSmokeRestore) return 'quit'
          pendingSmokeRestore = null
          return 'restore'
        }
      : chooseStartupAction,
    chooseDirectory,
    chooseBackupFile: smokeOverrides.restore
      ? async () => smokeOverrides.restore.inputPath
      : chooseBackupFile,
    chooseRestoreDirectory: smokeOverrides.restore
      ? async () => smokeOverrides.restore.workspaceRoot
      : chooseRestoreDirectory,
    restoreWorkspaceBackup,
    onInvalidWorkspace: reportInvalidWorkspace,
    onRestoreError: smokeOverrides.restore ? async () => {} : reportRestoreError,
  })
}

function configureDesktopSession(partition) {
  const desktopSession = session.fromPartition(partition)
  desktopSession.setPermissionCheckHandler(() => false)
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  const origin = new URL(applicationUrl).origin
  desktopSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`] },
    (details, callback) => {
      callback(addDesktopAuthHeader(details, {
        appUrl: applicationUrl,
        accessToken: launchToken,
      }))
    },
  )
  return desktopSession
}

function openExternalUrl(url) {
  if (!isAllowedExternalUrl(url)) return
  void shell.openExternal(url).catch((error) => {
    console.error('[mira-desktop] failed to open external URL:', error)
  })
}

async function createMainWindow() {
  const partition = `mira-desktop-${randomBytes(16).toString('hex')}`
  configureDesktopSession(partition)
  windowBounds = visibleWindowBounds(
    windowBounds,
    screen.getAllDisplays().map(({ workArea }) => workArea),
  )
  const options = createBrowserWindowOptions({
    preloadPath,
    partition,
    windowBounds,
  })
  options.webPreferences.devTools = !app.isPackaged
  const window = new BrowserWindow(options)
  mainWindow = window

  const enforceNavigation = (event, url) => {
    if (isAllowedNavigation(url, applicationUrl)) return
    event.preventDefault()
    openExternalUrl(url)
  }
  window.webContents.on('will-navigate', enforceNavigation)
  window.webContents.on('will-redirect', enforceNavigation)
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  window.on('move', scheduleDesktopStateWrite)
  window.on('resize', scheduleDesktopStateWrite)
  window.on('close', () => {
    windowBounds = window.getNormalBounds()
    if (switchingWorkspace) return
    const stateWorkspaceRoot = currentStateWorkspaceRoot()
    if (stateWorkspaceRoot && userDataRoot) {
      desktopStateWriter.writeInBackground({
        workspaceRoot: stateWorkspaceRoot,
        windowBounds,
      })
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  try {
    await window.loadURL(applicationUrl)
    await verifyRendererReady(window.webContents)
    if (!window.isDestroyed()) window.show()
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }

  console.log('[mira-desktop] ready')
  await completeDesktopSmoke({ environment: process.env, userDataRoot, quit: () => app.quit() })
  return window
}

async function chooseAnotherWorkspace() {
  if (switchingWorkspace) return
  switchingWorkspace = true
  clearTimeout(stateWriteTimer)
  stateWriteTimer = undefined
  try {
    const selected = await resolveDesktopWorkspace({
      prepareWorkspaceRoot,
      chooseDirectory,
      onInvalidWorkspace: reportInvalidWorkspace,
    })
    if (!selected || selected === workspaceRoot) return

    pendingWorkspaceRoot = selected
    try {
      windowBounds = currentNormalBounds()
      await desktopStateWriter.write({
        workspaceRoot: selected,
        windowBounds,
      })
      workspaceRoot = selected
      pendingWorkspaceRoot = ''
      if (shutdownRequested) return
      app.relaunch()
      void requestShutdown()
    } catch (error) {
      pendingWorkspaceRoot = ''
      reportStateWriteFailure(error)
      if (shutdownRequested) return
      const options = {
        type: 'error',
        title: '无法切换工作区',
        message: 'Mira 无法保存新的工作区设置',
        detail: error?.message || '请确认应用数据目录可写，然后重试。',
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, options)
      } else {
        await dialog.showMessageBox(options)
      }
    }
  } finally {
    switchingWorkspace = false
  }
}

async function restoreIntoAnotherWorkspace() {
  if (switchingWorkspace) return
  switchingWorkspace = true
  clearTimeout(stateWriteTimer)
  stateWriteTimer = undefined
  try {
    const selected = await resolveDesktopRestoreWorkspace({
      chooseBackupFile,
      chooseRestoreDirectory,
      restoreWorkspaceBackup,
      prepareWorkspaceRoot,
      onRestoreError: reportRestoreError,
    })
    if (!selected) return

    pendingWorkspaceRoot = selected
    try {
      windowBounds = currentNormalBounds()
      await desktopStateWriter.write({
        workspaceRoot: selected,
        windowBounds,
      })
      workspaceRoot = selected
      pendingWorkspaceRoot = ''
      if (shutdownRequested) return
      app.relaunch()
      void requestShutdown()
    } catch (error) {
      pendingWorkspaceRoot = ''
      reportStateWriteFailure(error)
      if (shutdownRequested) return
      const options = {
        type: 'error',
        title: '无法打开恢复的工作区',
        message: 'Mira 无法保存恢复后的工作区设置',
        detail: error?.message || '请确认应用数据目录可写，然后重试。',
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, options)
      } else {
        await dialog.showMessageBox(options)
      }
    }
  } finally {
    switchingWorkspace = false
  }
}

function installApplicationMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '选择其他工作区…', click: () => void chooseAnotherWorkspace() },
        { label: '从 Mira 备份恢复…', click: () => void restoreIntoAnotherWorkspace() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu', submenu: [{ role: 'close' }] },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        { role: 'reload' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function closeDesktopHost() {
  clearTimeout(stateWriteTimer)
  stateWriteTimer = undefined
  const runtime = nodeRuntime
  const runtimeStartup = nodeRuntimeStartup
  nodeRuntime = null
  await closeDesktopResources({
    flushState: queueDesktopStateWrite,
    closeHost: async () => {
      const startedRuntime = runtime || await runtimeStartup
      await startedRuntime?.close()
    },
    onStateError: reportStateWriteFailure,
  })
}

const shutdownController = createShutdownController({
  closeHost: closeDesktopHost,
  quit() {
    quittingAfterCleanup = true
    app.quit()
  },
  timeoutMs: 3_000,
})

function requestShutdown() {
  shutdownRequested = true
  return shutdownController.request()
}

async function bootstrap() {
  userDataRoot = app.getPath('userData')
  const desktopState = await readDesktopState(userDataRoot)
  windowBounds = desktopState.windowBounds
  const selectedWorkspace = await selectStartupWorkspace(desktopState.workspaceRoot)
  if (!selectedWorkspace) {
    void requestShutdown()
    return
  }

  workspaceRoot = selectedWorkspace
  await queueDesktopStateWrite()
  if (shutdownRequested) return
  launchToken = randomBytes(32).toString('base64url')
  const modelSettings = createModelSettingsService({
    initial: {
      baseUrl: process.env.MIRA_LLM_BASE_URL,
      model: process.env.MIRA_LLM_MODEL,
      apiKey: process.env.MIRA_LLM_API_KEY,
    },
  })
  const startup = startNodeRuntime({
    workspaceRoot,
    staticRoot,
    ...desktopListenOptions(),
    hostOptions: {
      accessToken: launchToken,
      modelSettings,
    },
  })
  nodeRuntimeStartup = startup
  let startedRuntime
  try {
    startedRuntime = await startup
  } finally {
    if (nodeRuntimeStartup === startup) nodeRuntimeStartup = null
  }
  if (shutdownRequested) {
    await startedRuntime.close()
    return
  }
  nodeRuntime = startedRuntime
  applicationUrl = `${nodeRuntime.address.url}/graphmind/`
  installApplicationMenu()
  await createMainWindow()
}

function failStartup(error) {
  if (shutdownRequested) return
  console.error('[mira-desktop] startup failed:', error)
  dialog.showErrorBox(
    'Mira 无法启动',
    error?.message || '桌面宿主启动失败，请重新选择工作区后再试。',
  )
  void requestShutdown()
}

const smokeUserDataRoot = process.env.MIRA_DESKTOP_SMOKE === '1'
  ? String(process.env.MIRA_DESKTOP_SMOKE_USER_DATA || '').trim()
  : ''
if (smokeUserDataRoot) app.setPath('userData', smokeUserDataRoot)

app.setName('Mira')
app.enableSandbox()

const ownsSingleInstance = app.requestSingleInstanceLock()
if (!ownsSingleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => focusExistingWindow(mainWindow))
  app.on('before-quit', (event) => {
    if (quittingAfterCleanup) return
    event.preventDefault()
    void requestShutdown()
  })
  app.on('activate', () => {
    if (!mainWindow && nodeRuntime) void createMainWindow().catch(failStartup)
  })
  app.on('window-all-closed', () => handleAllWindowsClosed(process.platform, () => app.quit()))
  process.once('SIGINT', () => app.quit())
  process.once('SIGTERM', () => app.quit())
  app.whenReady().then(bootstrap).catch(failStartup)
}
