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
