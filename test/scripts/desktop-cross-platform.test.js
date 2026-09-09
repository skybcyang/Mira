import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('internal desktop targets', () => {
  it('accepts native Mac architectures and Windows x64, rejecting unsupported targets', async () => {
    const { validateDesktopTarget } = await import('../../scripts/run-desktop-forge.mjs')
    for (const [platform, architecture] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
      expect(() => validateDesktopTarget(platform, architecture)).not.toThrow()
    }
    for (const [platform, architecture] of [['linux', 'x64'], ['win32', 'arm64'], ['darwin', '../outside']]) {
      expect(() => validateDesktopTarget(platform, architecture)).toThrow('Unsupported desktop target')
    }
  })

  it('selects a Windows ZIP without applying the Mac icon or bundle metadata', async () => {
    const { createDesktopForgeConfig } = await import('../../forge.config.mjs')
    const config = createDesktopForgeConfig('win32')
    const makers = config.makers.filter((maker) => maker.platforms.includes('win32'))
    expect(makers.map((maker) => maker.name)).toEqual(['@electron-forge/maker-zip'])
    expect(config.packagerConfig).not.toHaveProperty('icon')
    expect(config.packagerConfig).not.toHaveProperty('extendInfo')
    expect(config.packagerConfig.asar).toBe(true)
    expect(config.plugins).toHaveLength(1)
    expect(config.packagerConfig.download.checksums['electron-v44.0.0-win32-x64.zip'])
      .toMatch(/^[a-f0-9]{64}$/)
  })

  it('starts the Windows packed exe with the same isolated smoke environment', async () => {
    const { createPackedSmokeCommand } = await import('../../scripts/packed-desktop-smoke.mjs')
    const appPath = join('out', 'desktop', 'Mira-win32-x64')
    const command = createPackedSmokeCommand({
      platform: 'win32', appPath, workspaceRoot: 'isolated-workspace',
      userDataRoot: 'isolated-user-data', inheritedEnv: {},
    })
    expect(command.executable).toBe(join(appPath, 'Mira.exe'))
    expect(command.env.MIRA_DESKTOP_SMOKE_WORKSPACE).toBe('isolated-workspace')
    expect(command.env.MIRA_DESKTOP_SMOKE_USER_DATA).toBe('isolated-user-data')
  })
})

describe('cross-platform desktop shutdown', () => {
  it('quits on the last Windows window, retaining the Mac application lifecycle', async () => {
    const { handleAllWindowsClosed } = await import('../../desktop/lifecycle.mjs')
    const quit = vi.fn()
    handleAllWindowsClosed('darwin', quit)
    expect(quit).not.toHaveBeenCalled()
    handleAllWindowsClosed('win32', quit)
    expect(quit).toHaveBeenCalledOnce()
  })

  it('records smoke readiness before ordinary quit, without depending on GUI stdio', async () => {
    const { completeDesktopSmoke } = await import('../../desktop/lifecycle.mjs')
    const userDataRoot = await mkdtemp(join(tmpdir(), 'mira-smoke-ready-'))
    const quit = vi.fn()
    try {
      for (const environment of [{}, { MIRA_DESKTOP_SMOKE: '1' }, { MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1' }]) {
        await completeDesktopSmoke({ environment, userDataRoot, quit })
      }
      expect(await readdir(userDataRoot)).toEqual([])
      expect(quit).not.toHaveBeenCalled()
      await completeDesktopSmoke({
        environment: { MIRA_DESKTOP_SMOKE: '1', MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1' },
        userDataRoot,
        quit: () => {
          quit()
          return readFile(join(userDataRoot, 'smoke-ready'), 'utf8').then((text) => expect(text).toBe('ready'))
        },
      })
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      await rm(userDataRoot, { recursive: true, force: true })
    }
  })
})
