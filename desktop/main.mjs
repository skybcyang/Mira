import { randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, screen, session, shell } from 'electron'
import { createModelSettingsService } from '../bridge/model-settings.js'
import { restoreWorkspaceBackup } from '../bridge/node-backup-restore.js'
import { startNodeRuntime } from '../bridge/node-runtime.js'
import { WORKSPACE_DATA_PATHS } from '../bridge/project-workspace.js'
import { projectHostError } from '../bridge/project-host.js'
import { verifyPackedMaterialReader } from './material-smoke.mjs'
import { closeDesktopResources, createShutdownController, focusExistingWindow, handleAllWindowsClosed, completeDesktopSmoke } from './lifecycle.mjs'
import { addDesktopAuthHeader, desktopSmokeStartupOverrides } from './main-policy.mjs'
import { verifyRendererReady } from './renderer-readiness.mjs'
import { createDesktopStateWriter } from './state-writer.mjs'
import { createProjectStateStore } from './project-state.mjs'
import { openDesktopProject, dispatchProjectMenuAction, createStagedProjectHost } from './project-opening.mjs'
import { createBrowserWindowOptions, desktopListenOptions, isAllowedExternalUrl, isAllowedNavigation, visibleWindowBounds } from './security-policy.mjs'
import { prepareWorkspaceRoot, readDesktopState, writeDesktopState } from './workspace.mjs'

const runtimeRoot = dirname(fileURLToPath(import.meta.url))
const staticRoot = join(runtimeRoot, 'dist')
const preloadPath = join(runtimeRoot, 'preload.js')
let mainWindow = null, nodeRuntime = null, nodeRuntimeStartup = null
let workspaceRoot = '', userDataRoot = '', projectState, windowBounds, stateWriteTimer
let quittingAfterCleanup = false, shutdownRequested = false, switchingWorkspace = false

function reportStateWriteFailure(error) { console.error('[mira-desktop] failed to persist desktop state:', error) }
const desktopStateWriter = createDesktopStateWriter({ writeState: snapshot => writeDesktopState(userDataRoot, snapshot), onBackgroundError: reportStateWriteFailure })
function currentNormalBounds() { return mainWindow && !mainWindow.isDestroyed() ? mainWindow.getNormalBounds() : windowBounds }
function queueDesktopStateWrite() {
  if (!workspaceRoot || !userDataRoot) return Promise.resolve()
  windowBounds = currentNormalBounds()
  return desktopStateWriter.write({ workspaceRoot, windowBounds })
}
function scheduleDesktopStateWrite() {
  if (switchingWorkspace) return
  clearTimeout(stateWriteTimer)
  stateWriteTimer = setTimeout(() => { stateWriteTimer = undefined; void queueDesktopStateWrite().catch(reportStateWriteFailure) }, 250)
}
function showMessage(options) {
  return mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)
}
function showOpenDialog(options) {
  return mainWindow && !mainWindow.isDestroyed() ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
}
async function chooseDirectory(kind) {
  const result = await showOpenDialog({
    title: kind === 'new' ? '新建 Mira 项目' : '打开 Mira 项目',
    buttonLabel: kind === 'new' ? '在此新建项目' : '打开项目',
    message: kind === 'new' ? '选择或创建项目文件夹。已有文件会保留，不覆盖其他 Mira 项目。' : '选择保存 Mira 项目的文件夹。',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  })
  const path = result.canceled ? null : result.filePaths[0] || null
  if (path && kind === 'new') {
    for (const name of ['.mira', ...Object.values(WORKSPACE_DATA_PATHS)]) {
      const exists = await lstat(join(path, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (exists) throw projectHostError('WORKSPACE_FORMAT_INVALID', '这个文件夹已包含 Mira 项目，请使用“打开项目”。')
    }
  }
  return path
}
async function chooseRestore() {
  const backup = await showOpenDialog({ title: '选择 Mira 备份', buttonLabel: '选择此备份', properties: ['openFile'], filters: [{ name: 'Mira 备份', extensions: ['json'] }] })
  if (backup.canceled || !backup.filePaths[0]) return null
  const target = await showOpenDialog({ title: '选择恢复后的项目文件夹', buttonLabel: '恢复到此文件夹', message: '目标必须是新建或完全空的文件夹，现有项目不会被覆盖。', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
  if (target.canceled || !target.filePaths[0]) return null
  return (await restoreWorkspaceBackup({ inputPath: backup.filePaths[0], workspaceRoot: target.filePaths[0] })).workspaceRoot
}
async function selectProject(action) {
  if (action.kind === 'recent') {
    const recent = projectState.getRecentProjects().find(project => project.id === action.projectId)
    if (!recent) throw projectHostError('BAD_REQUEST', '这个项目不在最近项目中，请重新选择。')
    return { path: recent.path, allowCreate: false }
  }
  const path = action.kind === 'restore' ? await chooseRestore() : await chooseDirectory(action.kind)
  return path ? { path, allowCreate: action.kind === 'new' } : null
}
async function chooseStartupAction() {
  const recent = projectState.getRecentProjects()
  const actions = [{ kind: 'new' }, { kind: 'open' }, ...recent.map(project => ({ kind: 'recent', projectId: project.id })), { kind: 'restore' }]
  const buttons = ['新建项目', '打开项目', ...recent.map(project => `${project.name} — ${project.path}`), '从 Mira 备份恢复', '退出']
  const result = await showMessage({ type: 'question', title: '打开 Mira', message: '打开一个项目，继续你的工作', detail: '项目包含画板、材料、灵感池和方法。', buttons, defaultId: recent.length ? 2 : 0, cancelId: buttons.length - 1, noLink: true })
  return actions[result.response] || null
}
function configureDesktopSession(partition, applicationUrl, accessToken) {
  const desktopSession = session.fromPartition(partition)
  desktopSession.setPermissionCheckHandler(() => false)
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  const origin = new URL(applicationUrl).origin
  desktopSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback(addDesktopAuthHeader(details, { appUrl: applicationUrl, accessToken }))
  })
}
function openExternalUrl(url) {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(error => console.error('[mira-desktop] failed to open external URL:', error))
}
async function createMainWindow(runtime = nodeRuntime) {
  const applicationUrl = `${runtime.address.url}/graphmind/`
  const partition = `mira-desktop-${randomBytes(16).toString('hex')}`
  configureDesktopSession(partition, applicationUrl, runtime.accessToken)
  windowBounds = visibleWindowBounds(windowBounds, screen.getAllDisplays().map(({ workArea }) => workArea))
  const options = createBrowserWindowOptions({ preloadPath, partition, windowBounds })
  options.webPreferences.devTools = !app.isPackaged
  const window = new BrowserWindow(options)
  const enforceNavigation = (event, url) => { if (!isAllowedNavigation(url, applicationUrl)) { event.preventDefault(); openExternalUrl(url) } }
  window.webContents.on('will-navigate', enforceNavigation)
  window.webContents.on('will-redirect', enforceNavigation)
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => { openExternalUrl(url); return { action: 'deny' } })
  for (const event of ['move', 'resize']) window.on(event, () => { if (mainWindow === window) scheduleDesktopStateWrite() })
  window.on('close', () => { if (mainWindow === window && !switchingWorkspace) void queueDesktopStateWrite().catch(reportStateWriteFailure) })
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  try {
    await window.loadURL(applicationUrl)
    await verifyRendererReady(window.webContents)
    if (shutdownRequested || window.isDestroyed()) throw new Error('Mira window closed during project startup')
    return window
  } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error }
}
async function startProjectRuntime(path) {
  if (shutdownRequested) throw projectHostError('HOST_CLOSING', 'Mira 正在关闭。')
  const accessToken = randomBytes(32).toString('base64url')
  const projectHost = createStagedProjectHost({ projectState, open: switchProject })
  const startup = startNodeRuntime({ workspaceRoot: path, staticRoot, ...desktopListenOptions(), hostOptions: {
    accessToken,
    modelSettings: createModelSettingsService({ initial: { baseUrl: process.env.MIRA_LLM_BASE_URL, model: process.env.MIRA_LLM_MODEL, apiKey: process.env.MIRA_LLM_API_KEY } }),
    applicationInfo: { version: app.getVersion(), platform: process.platform, architecture: process.arch },
    projectHost,
  } })
  nodeRuntimeStartup = startup
  try {
    const runtime = await startup
    if (shutdownRequested) { await runtime.close(); throw projectHostError('HOST_CLOSING', 'Mira 正在关闭。') }
    return { ...runtime, accessToken, projectHost }
  } finally { if (nodeRuntimeStartup === startup) nodeRuntimeStartup = null }
}
function activateProject({ runtime, window, project }) {
  const previousRuntime = nodeRuntime, previousWindow = mainWindow
  window.show()
  nodeRuntime = runtime
  mainWindow = window
  workspaceRoot = project.path
  void queueDesktopStateWrite().catch(reportStateWriteFailure)
  installApplicationMenu()
  if (previousRuntime || previousWindow) return async () => {
    if (previousWindow && !previousWindow.isDestroyed()) previousWindow.destroy()
    await previousRuntime?.close()
  }
}
async function openProjectPath(path, allowCreate = false) {
  return openDesktopProject({ path, currentPath: workspaceRoot, allowCreate, prepareWorkspaceRoot,
    startRuntime: startProjectRuntime, createWindow: createMainWindow,
    commitProject: (project, runtime) => runtime.projectHost.commit(project), activate: activateProject,
  })
}
async function switchProject(action) {
  if (switchingWorkspace) throw projectHostError('PROJECT_SWITCHING', '正在切换项目，请稍候。')
  switchingWorkspace = true
  clearTimeout(stateWriteTimer)
  try {
    await projectState.flush()
    const selection = await selectProject(action)
    return selection ? await openProjectPath(selection.path, selection.allowCreate) : { cancelled: true }
  } finally { switchingWorkspace = false }
}
function requestProjectAction(action) {
  void dispatchProjectMenuAction(mainWindow, action).catch(error => console.error('[mira-desktop] project action failed:', error))
}
function installApplicationMenu() {
  const recent = projectState.getRecentProjects().map(project => ({ label: `${project.name} — ${project.path}`, click: () => requestProjectAction({ kind: 'recent', projectId: project.id }) }))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: '新建项目…', click: () => requestProjectAction({ kind: 'new' }) },
      { label: '打开项目…', click: () => requestProjectAction({ kind: 'open' }) },
      { label: '最近项目', submenu: recent, enabled: recent.length > 0 },
      { label: '从 Mira 备份恢复…', click: () => requestProjectAction({ kind: 'restore' }) },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'fileMenu', submenu: [{ role: 'close' }] }, { role: 'editMenu' },
    { role: 'viewMenu', submenu: [{ role: 'reload' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]))
}
async function closeDesktopHost() {
  clearTimeout(stateWriteTimer)
  const runtime = nodeRuntime, startup = nodeRuntimeStartup
  nodeRuntime = null
  await closeDesktopResources({
    flushState: async () => { await projectState?.flush(); await queueDesktopStateWrite() },
    closeHost: async () => { const pending = await startup; await Promise.all([runtime?.close(), pending && pending !== runtime ? pending.close() : undefined]) },
    onStateError: reportStateWriteFailure,
  })
}
const shutdownController = createShutdownController({ closeHost: closeDesktopHost, quit() { quittingAfterCleanup = true; app.quit() }, timeoutMs: 3_000 })
function requestShutdown() { shutdownRequested = true; return shutdownController.request() }
async function bootstrap() {
  userDataRoot = app.getPath('userData')
  const desktopState = await readDesktopState(userDataRoot)
  windowBounds = desktopState.windowBounds
  projectState = await createProjectStateStore(userDataRoot, { onReadError: error => showMessage({ type: 'warning', title: '项目打开记录不可用', message: error.message }) })
  const smoke = desktopSmokeStartupOverrides(process.env)
  if (smoke.restore === null) throw new Error('Packed restore smoke requires a backup file and restore workspace')
  let remembered = smoke.rememberedWorkspaceRoot || projectState.currentProject()?.path || desktopState.workspaceRoot
  let allowCreate = Boolean(smoke.rememberedWorkspaceRoot)
  if (smoke.restore) { remembered = (await restoreWorkspaceBackup(smoke.restore)).workspaceRoot; allowCreate = false }
  while (!shutdownRequested) {
    let selection = remembered ? { path: remembered, allowCreate } : null
    remembered = null; allowCreate = false
    try {
      if (!selection) { const action = await chooseStartupAction(); if (!action) { void requestShutdown(); return }; selection = await selectProject(action) }
      if (!selection) continue
      const result = await openProjectPath(selection.path, selection.allowCreate)
      if (result.cancelled) continue
      console.log('[mira-desktop] ready')
      if (process.env.MIRA_DESKTOP_SMOKE === '1' && process.env.MIRA_DESKTOP_SMOKE_PDF === '1') await verifyPackedMaterialReader(nodeRuntime.host.application)
      await completeDesktopSmoke({ environment: process.env, userDataRoot, quit: () => app.quit() })
      return
    } catch (error) {
      if (process.env.MIRA_DESKTOP_SMOKE === '1') throw error
      await showMessage({ type: 'error', title: '无法打开项目', message: '项目未能打开，请重新选择。', detail: `${selection?.path || ''}\n\n${error?.message || '请确认文件夹存在且可读写。'}` })
    }
  }
}
function failStartup(error) {
  if (shutdownRequested) return
  console.error('[mira-desktop] startup failed:', error)
  dialog.showErrorBox('Mira 无法启动', error?.message || '桌面宿主启动失败，请重新选择项目。')
  void requestShutdown()
}
const smokeUserDataRoot = process.env.MIRA_DESKTOP_SMOKE === '1' ? String(process.env.MIRA_DESKTOP_SMOKE_USER_DATA || '').trim() : ''
if (smokeUserDataRoot) app.setPath('userData', smokeUserDataRoot)
app.setName('Mira')
app.enableSandbox()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => focusExistingWindow(mainWindow))
  app.on('before-quit', event => { if (!quittingAfterCleanup) { event.preventDefault(); void requestShutdown() } })
  app.on('activate', () => {
    if (!mainWindow && nodeRuntime && !switchingWorkspace && !shutdownRequested) void createMainWindow().then(window => { mainWindow = window; window.show() }).catch(failStartup)
  })
  app.on('window-all-closed', () => { if (!switchingWorkspace && mainWindow === null && nodeRuntime) handleAllWindowsClosed(process.platform, () => app.quit()) })
  process.once('SIGINT', () => app.quit())
  process.once('SIGTERM', () => app.quit())
  app.whenReady().then(bootstrap).catch(failStartup)
}
