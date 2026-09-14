import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  addDesktopAuthHeader,
  desktopSmokeStartupOverrides,
} from '../../desktop/main-policy.mjs'
import { DESKTOP_TOKEN_HEADER } from '../../desktop/security-policy.mjs'

describe('desktop request authentication', () => {
  const appUrl = 'http://127.0.0.1:49152/graphmind/'

  it('adds the launch token only to this app origin and path scope', () => {
    const accessToken = 'per-launch-secret'
    const authorized = addDesktopAuthHeader({
      url: 'http://127.0.0.1:49152/graphmind/api/v2/boards',
      requestHeaders: { Accept: 'application/json' },
    }, { appUrl, accessToken })

    expect(authorized.requestHeaders).toEqual({
      Accept: 'application/json',
      [DESKTOP_TOKEN_HEADER]: accessToken,
    })

    for (const url of [
      'https://example.com/graphmind/',
      'http://127.0.0.1:49153/graphmind/',
      'http://127.0.0.1:49152/',
      'http://127.0.0.1:49152/graphmind-evil',
    ]) {
      const originalHeaders = { Accept: 'text/html' }
      const untouched = addDesktopAuthHeader(
        { url, requestHeaders: originalHeaders },
        { appUrl, accessToken },
      )
      expect(untouched.requestHeaders).toEqual(originalHeaders)
      expect(untouched.requestHeaders).not.toHaveProperty(DESKTOP_TOKEN_HEADER)
    }
  })
})

describe('desktop restore from an existing workspace', () => {
  it('keeps restore reachable from the application menu for remembered-workspace users', async () => {
    const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8')

    expect(source).toContain("label: '从 Mira 备份恢复…'")
    expect(source).toContain("requestProjectAction({ kind: 'restore' })")
    expect(source).not.toContain('app.relaunch()')
  })
})

describe('desktop smoke startup isolation', () => {
  it('ignores all smoke restore environment variables unless smoke mode is explicitly enabled', () => {
    expect(desktopSmokeStartupOverrides({
      MIRA_DESKTOP_SMOKE_MODE: 'restore',
      MIRA_DESKTOP_SMOKE_BACKUP: '/tmp/backup.json',
      MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE: '/tmp/workspace',
    })).toEqual({})
  })

  it('exposes an explicit restore path only inside desktop smoke mode', () => {
    expect(desktopSmokeStartupOverrides({
      MIRA_DESKTOP_SMOKE: '1',
      MIRA_DESKTOP_SMOKE_MODE: 'restore',
      MIRA_DESKTOP_SMOKE_BACKUP: '/tmp/backup.json',
      MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE: '/tmp/workspace',
    })).toEqual({
      restore: {
        inputPath: '/tmp/backup.json',
        workspaceRoot: '/tmp/workspace',
      },
    })
  })

})

describe('desktop startup host ordering', () => {
  it('routes startup through target validation before committing a project', async () => {
    const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8')
    expect(source).toContain('openDesktopProject({')
    expect(source).toContain('runtime.projectHost.commit(project)')
    expect(source).toContain('projectState.currentProject()?.path')
  })
})
