import { describe, expect, it } from 'vitest'
import {
  DESKTOP_TOKEN_HEADER,
  createBrowserWindowOptions,
  desktopListenOptions,
  isAllowedExternalUrl,
  isAllowedNavigation,
  visibleWindowBounds,
} from '../../desktop/security-policy.mjs'

describe('desktop BrowserWindow security policy', () => {
  it('enables the Electron isolation controls explicitly', () => {
    const options = createBrowserWindowOptions({
      preloadPath: '/Applications/Mira.app/Contents/Resources/app/desktop/preload.mjs',
      partition: 'mira-desktop-session',
    })

    expect(options.webPreferences).toMatchObject({
      preload: '/Applications/Mira.app/Contents/Resources/app/desktop/preload.mjs',
      partition: 'mira-desktop-session',
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    })
  })

  it('always requests an ephemeral loopback port', () => {
    expect(desktopListenOptions()).toEqual({ host: '127.0.0.1', port: 0 })
  })

  it('uses one stable, lower-case header for the per-launch credential', () => {
    expect(DESKTOP_TOKEN_HEADER).toBe('x-mira-desktop-token')
  })

  it('keeps restored bounds visible after a display is removed', () => {
    expect(visibleWindowBounds(
      { x: 3200, y: 120, width: 1200, height: 800 },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
    )).toEqual({ x: 240, y: 100, width: 1200, height: 800 })
  })

  it('preserves bounds that still intersect a current display', () => {
    const bounds = { x: 100, y: 80, width: 1200, height: 800 }
    expect(visibleWindowBounds(bounds, [
      { x: 0, y: 0, width: 1440, height: 900 },
    ])).toEqual(bounds)
  })
})

describe('desktop navigation policy', () => {
  const appUrl = 'http://127.0.0.1:49152/graphmind/'

  it.each([
    'http://127.0.0.1:49152/graphmind/',
    'http://127.0.0.1:49152/graphmind',
    'http://127.0.0.1:49152/graphmind/boards/board-1',
    'http://127.0.0.1:49152/graphmind/boards/board-1?panel=history#version-2',
  ])('allows the exact app origin inside the /graphmind scope: %s', (target) => {
    expect(isAllowedNavigation(target, appUrl)).toBe(true)
  })

  it.each([
    'http://localhost:49152/graphmind/',
    'http://127.0.0.1:49153/graphmind/',
    'https://127.0.0.1:49152/graphmind/',
    'http://127.0.0.1:49152/',
    'http://127.0.0.1:49152/graphmind-evil',
    'http://127.0.0.1:49152/graphmindish/boards',
    'not a url',
  ])('rejects navigation outside the exact desktop app boundary: %s', (target) => {
    expect(isAllowedNavigation(target, appUrl)).toBe(false)
  })

  it.each([
    ['https://example.com/docs', true],
    ['https://example.com:8443/docs?q=mira#desktop', true],
    ['http://example.com/docs', false],
    ['mailto:hello@example.com', false],
    ['file:///Users/example/private.txt', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('allows only HTTPS URLs to leave the application: %s', (target, expected) => {
    expect(isAllowedExternalUrl(target)).toBe(expected)
  })
})
