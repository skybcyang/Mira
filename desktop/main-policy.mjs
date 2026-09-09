import {
  DESKTOP_TOKEN_HEADER,
  isAllowedNavigation,
} from './security-policy.mjs'

export function addDesktopAuthHeader(details, { appUrl, accessToken }) {
  const requestHeaders = { ...(details.requestHeaders || {}) }
  if (accessToken && isAllowedNavigation(details.url, appUrl)) {
    requestHeaders[DESKTOP_TOKEN_HEADER] = accessToken
  }
  return { requestHeaders }
}

export async function resolveDesktopWorkspace({
  rememberedWorkspaceRoot,
  prepareWorkspaceRoot,
  chooseDirectory,
  onInvalidWorkspace = () => {},
}) {
  if (rememberedWorkspaceRoot) {
    try {
      return await prepareWorkspaceRoot(rememberedWorkspaceRoot)
    } catch (error) {
      await onInvalidWorkspace({
        path: rememberedWorkspaceRoot,
        error,
        remembered: true,
      })
    }
  }

  while (true) {
    const selection = await chooseDirectory()
    if (!selection) return null
    try {
      return await prepareWorkspaceRoot(selection)
    } catch (error) {
      await onInvalidWorkspace({ path: selection, error, remembered: false })
    }
  }
}

export async function resolveDesktopRestoreWorkspace({
  chooseBackupFile,
  chooseRestoreDirectory,
  restoreWorkspaceBackup,
  prepareWorkspaceRoot,
  onRestoreError = () => {},
}) {
  const inputPath = await chooseBackupFile()
  if (!inputPath) return null
  const selectedWorkspaceRoot = await chooseRestoreDirectory()
  if (!selectedWorkspaceRoot) return null

  try {
    const result = await restoreWorkspaceBackup({
      inputPath,
      workspaceRoot: selectedWorkspaceRoot,
    })
    return await prepareWorkspaceRoot(result?.workspaceRoot || selectedWorkspaceRoot)
  } catch (error) {
    await onRestoreError({
      inputPath,
      workspaceRoot: selectedWorkspaceRoot,
      error,
    })
    return null
  }
}

export async function resolveDesktopStartupWorkspace({
  rememberedWorkspaceRoot,
  prepareWorkspaceRoot,
  chooseAction,
  chooseDirectory,
  chooseBackupFile,
  chooseRestoreDirectory,
  restoreWorkspaceBackup,
  onInvalidWorkspace = () => {},
  onRestoreError = () => {},
}) {
  if (rememberedWorkspaceRoot) {
    try {
      return await prepareWorkspaceRoot(rememberedWorkspaceRoot)
    } catch (error) {
      await onInvalidWorkspace({
        path: rememberedWorkspaceRoot,
        error,
        remembered: true,
      })
    }
  }

  while (true) {
    const action = await chooseAction()
    if (!action || action === 'quit') return null

    if (action === 'workspace') {
      const selection = await chooseDirectory()
      if (!selection) continue
      try {
        return await prepareWorkspaceRoot(selection)
      } catch (error) {
        await onInvalidWorkspace({ path: selection, error, remembered: false })
      }
      continue
    }

    if (action !== 'restore') continue
    const restoredWorkspaceRoot = await resolveDesktopRestoreWorkspace({
      chooseBackupFile,
      chooseRestoreDirectory,
      restoreWorkspaceBackup,
      prepareWorkspaceRoot,
      onRestoreError,
    })
    if (restoredWorkspaceRoot) return restoredWorkspaceRoot
  }
}

function trimmedEnvironmentValue(environment, name) {
  return typeof environment?.[name] === 'string' ? environment[name].trim() : ''
}

export function desktopSmokeStartupOverrides(environment = {}) {
  if (environment.MIRA_DESKTOP_SMOKE !== '1') return {}

  if (trimmedEnvironmentValue(environment, 'MIRA_DESKTOP_SMOKE_MODE') === 'restore') {
    const inputPath = trimmedEnvironmentValue(environment, 'MIRA_DESKTOP_SMOKE_BACKUP')
    const workspaceRoot = trimmedEnvironmentValue(
      environment,
      'MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE',
    )
    return inputPath && workspaceRoot
      ? { restore: { inputPath, workspaceRoot } }
      : { restore: null }
  }

  const rememberedWorkspaceRoot = trimmedEnvironmentValue(
    environment,
    'MIRA_DESKTOP_SMOKE_WORKSPACE',
  )
  return rememberedWorkspaceRoot ? { rememberedWorkspaceRoot } : {}
}

export function rememberedWorkspaceRootForDesktopStartup(
  smokeOverrides,
  rememberedWorkspaceRoot,
) {
  if (smokeOverrides?.restore) return undefined
  return smokeOverrides?.rememberedWorkspaceRoot || rememberedWorkspaceRoot
}

const RESTORE_ERROR_MESSAGES = Object.freeze({
  BACKUP_INVALID: '所选文件不是有效的 Mira 备份',
  BACKUP_TOO_LARGE: '备份文件超过当前版本允许的大小或对象数量',
  BACKUP_RESTORE_ARGUMENT_INVALID: '恢复所需的备份文件或目标文件夹无效',
  BACKUP_RESTORE_TARGET_INVALID: '恢复目标必须是新建或空文件夹',
  BACKUP_RESTORE_FAILED: '恢复过程中发生错误，目标工作区未被启动',
})

export function formatDesktopRestoreError(error) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : 'BACKUP_RESTORE_FAILED'
  const detailParts = [
    `错误代码：${code}`,
    error?.message || '恢复失败，请检查备份文件和目标文件夹后重试。',
  ]
  if (error?.details !== undefined) {
    detailParts.push(`详细信息：${JSON.stringify(error.details)}`)
  }
  return {
    type: 'error',
    title: '无法恢复 Mira 备份',
    message: RESTORE_ERROR_MESSAGES[code] || RESTORE_ERROR_MESSAGES.BACKUP_RESTORE_FAILED,
    detail: detailParts.join('\n\n'),
  }
}

export function workspaceRootForDesktopState({
  activeWorkspaceRoot,
  pendingWorkspaceRoot,
}) {
  return pendingWorkspaceRoot || activeWorkspaceRoot || ''
}
