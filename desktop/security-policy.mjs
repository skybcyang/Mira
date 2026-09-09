export const DESKTOP_TOKEN_HEADER = 'x-mira-desktop-token'

export function desktopListenOptions() {
  return { host: '127.0.0.1', port: 0 }
}

function restoredWindowBounds(value) {
  if (!value || typeof value !== 'object') return {}
  const { x, y, width, height } = value
  if (![x, y, width, height].every(Number.isInteger)) return {}
  if (width <= 0 || height <= 0) return {}
  return { x, y, width, height }
}

function intersectionArea(first, second) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  )
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  )
  return width * height
}

export function visibleWindowBounds(value, workAreas = []) {
  const bounds = restoredWindowBounds(value)
  if (!Object.hasOwn(bounds, 'width')) return value

  const displays = workAreas
    .map(restoredWindowBounds)
    .filter((area) => Object.hasOwn(area, 'width'))
  if (displays.length === 0 || displays.some((area) => intersectionArea(bounds, area) > 0)) {
    return bounds
  }

  const area = displays[0]
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  }
}

export function createBrowserWindowOptions({ preloadPath, partition, windowBounds } = {}) {
  return {
    title: 'Mira',
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f7f5',
    ...restoredWindowBounds(windowBounds),
    webPreferences: {
      preload: preloadPath,
      partition,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  }
}

function parsedUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function isAllowedNavigation(target, appUrl) {
  const targetUrl = parsedUrl(target)
  const applicationUrl = parsedUrl(appUrl)
  if (!targetUrl || !applicationUrl) return false
  if (applicationUrl.protocol !== 'http:' || applicationUrl.hostname !== '127.0.0.1') return false
  if (applicationUrl.username || applicationUrl.password) return false
  if (targetUrl.origin !== applicationUrl.origin) return false
  if (targetUrl.username || targetUrl.password) return false

  const applicationPath = applicationUrl.pathname.replace(/\/+$/, '')
  return targetUrl.pathname === applicationPath || targetUrl.pathname.startsWith(`${applicationPath}/`)
}

export function isAllowedExternalUrl(target) {
  const targetUrl = parsedUrl(target)
  return targetUrl?.protocol === 'https:'
}
