import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  addDesktopAuthHeader,
  desktopSmokeStartupOverrides,
  formatDesktopRestoreError,
  rememberedWorkspaceRootForDesktopStartup,
  resolveDesktopRestoreWorkspace,
  resolveDesktopWorkspace,
  resolveDesktopStartupWorkspace,
  workspaceRootForDesktopState,
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

describe('desktop workspace selection', () => {
  it('persists a pending switch instead of letting shutdown restore the old workspace', () => {
    expect(workspaceRootForDesktopState({
      activeWorkspaceRoot: '/old/workspace',
      pendingWorkspaceRoot: '/new/workspace',
    })).toBe('/new/workspace')
    expect(workspaceRootForDesktopState({
      activeWorkspaceRoot: '/old/workspace',
      pendingWorkspaceRoot: '',
    })).toBe('/old/workspace')
  })

  it('reuses a valid remembered workspace without opening the chooser', async () => {
    const prepareWorkspaceRoot = vi.fn(async (path) => path)
    const chooseDirectory = vi.fn()

    await expect(resolveDesktopWorkspace({
      rememberedWorkspaceRoot: '/remembered/workspace',
      prepareWorkspaceRoot,
      chooseDirectory,
      onInvalidWorkspace: vi.fn(),
    })).resolves.toBe('/remembered/workspace')

    expect(prepareWorkspaceRoot).toHaveBeenCalledWith('/remembered/workspace')
    expect(chooseDirectory).not.toHaveBeenCalled()
  })

  it('reports an invalid remembered path and keeps asking until a valid path is chosen', async () => {
    const missingError = new Error('remembered workspace moved')
    const fileError = new Error('selection is not a directory')
    const prepareWorkspaceRoot = vi.fn(async (path) => {
      if (path === '/missing/workspace') throw missingError
      if (path === '/picked/file') throw fileError
      return path
    })
    const chooseDirectory = vi.fn()
      .mockResolvedValueOnce('/picked/file')
      .mockResolvedValueOnce('/picked/workspace')
    const onInvalidWorkspace = vi.fn()

    await expect(resolveDesktopWorkspace({
      rememberedWorkspaceRoot: '/missing/workspace',
      prepareWorkspaceRoot,
      chooseDirectory,
      onInvalidWorkspace,
    })).resolves.toBe('/picked/workspace')

    expect(onInvalidWorkspace).toHaveBeenNthCalledWith(1, {
      path: '/missing/workspace',
      error: missingError,
      remembered: true,
    })
    expect(onInvalidWorkspace).toHaveBeenNthCalledWith(2, {
      path: '/picked/file',
      error: fileError,
      remembered: false,
    })
    expect(chooseDirectory).toHaveBeenCalledTimes(2)
  })

  it('returns null when the user cancels without preparing an implicit fallback', async () => {
    const prepareWorkspaceRoot = vi.fn()
    const chooseDirectory = vi.fn().mockResolvedValue(null)

    await expect(resolveDesktopWorkspace({
      prepareWorkspaceRoot,
      chooseDirectory,
      onInvalidWorkspace: vi.fn(),
    })).resolves.toBeNull()

    expect(prepareWorkspaceRoot).not.toHaveBeenCalled()
  })
})

describe('desktop startup workspace chooser', () => {
  it('reuses a valid remembered workspace without presenting startup actions', async () => {
    const prepareWorkspaceRoot = vi.fn(async (path) => path)
    const chooseAction = vi.fn()

    await expect(resolveDesktopStartupWorkspace({
      rememberedWorkspaceRoot: '/remembered/workspace',
      prepareWorkspaceRoot,
      chooseAction,
    })).resolves.toBe('/remembered/workspace')

    expect(prepareWorkspaceRoot).toHaveBeenCalledWith('/remembered/workspace')
    expect(chooseAction).not.toHaveBeenCalled()
  })

  it('restores before preparing and returning the restored workspace', async () => {
    const events = []
    const restoreWorkspaceBackup = vi.fn(async ({ inputPath, workspaceRoot }) => {
      events.push(`restore:${inputPath}:${workspaceRoot}`)
      return { workspaceRoot, restored: { boardCount: 1, runCount: 0, workflowCount: 0 } }
    })
    const prepareWorkspaceRoot = vi.fn(async (path) => {
      events.push(`prepare:${path}`)
      return path
    })

    await expect(resolveDesktopStartupWorkspace({
      prepareWorkspaceRoot,
      chooseAction: vi.fn(async () => 'restore'),
      chooseBackupFile: vi.fn(async () => '/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn(async () => '/workspace/restored'),
      restoreWorkspaceBackup,
      onRestoreError: vi.fn(),
    })).resolves.toBe('/workspace/restored')

    expect(events).toEqual([
      'restore:/backup/mira.mira-backup.json:/workspace/restored',
      'prepare:/workspace/restored',
    ])
  })

  it.each([
    ['backup file', { chooseBackupFile: vi.fn().mockResolvedValue(null) }],
    ['restore directory', {
      chooseBackupFile: vi.fn().mockResolvedValue('/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn().mockResolvedValue(null),
    }],
  ])('returns to the action chooser when the %s selection is canceled', async (_label, overrides) => {
    const chooseAction = vi.fn()
      .mockResolvedValueOnce('restore')
      .mockResolvedValueOnce('quit')
    const restoreWorkspaceBackup = vi.fn()

    await expect(resolveDesktopStartupWorkspace({
      prepareWorkspaceRoot: vi.fn(),
      chooseAction,
      chooseBackupFile: vi.fn().mockResolvedValue('/backup/default.json'),
      chooseRestoreDirectory: vi.fn().mockResolvedValue('/workspace/default'),
      restoreWorkspaceBackup,
      ...overrides,
    })).resolves.toBeNull()

    expect(chooseAction).toHaveBeenCalledTimes(2)
    expect(restoreWorkspaceBackup).not.toHaveBeenCalled()
  })

  it('reports a restore failure, then allows the user to retry or exit', async () => {
    const failure = Object.assign(new Error('Workspace target must be empty'), {
      code: 'BACKUP_RESTORE_TARGET_INVALID',
      details: { target: '/workspace/not-empty' },
    })
    const chooseAction = vi.fn()
      .mockResolvedValueOnce('restore')
      .mockResolvedValueOnce('quit')
    const onRestoreError = vi.fn()

    await expect(resolveDesktopStartupWorkspace({
      prepareWorkspaceRoot: vi.fn(),
      chooseAction,
      chooseBackupFile: vi.fn(async () => '/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn(async () => '/workspace/not-empty'),
      restoreWorkspaceBackup: vi.fn(async () => { throw failure }),
      onRestoreError,
    })).resolves.toBeNull()

    expect(onRestoreError).toHaveBeenCalledWith({
      inputPath: '/backup/mira.mira-backup.json',
      workspaceRoot: '/workspace/not-empty',
      error: failure,
    })
    expect(chooseAction).toHaveBeenCalledTimes(2)
  })

  it('returns to the action chooser when ordinary directory selection is canceled', async () => {
    const chooseAction = vi.fn()
      .mockResolvedValueOnce('workspace')
      .mockResolvedValueOnce('quit')

    await expect(resolveDesktopStartupWorkspace({
      prepareWorkspaceRoot: vi.fn(),
      chooseAction,
      chooseDirectory: vi.fn().mockResolvedValue(null),
    })).resolves.toBeNull()

    expect(chooseAction).toHaveBeenCalledTimes(2)
  })
})

describe('desktop restore from an existing workspace', () => {
  it('restores and prepares a new workspace without requiring the startup chooser', async () => {
    const events = []

    await expect(resolveDesktopRestoreWorkspace({
      chooseBackupFile: vi.fn(async () => '/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn(async () => '/workspace/restored'),
      restoreWorkspaceBackup: vi.fn(async ({ inputPath, workspaceRoot }) => {
        events.push(`restore:${inputPath}:${workspaceRoot}`)
        return { workspaceRoot }
      }),
      prepareWorkspaceRoot: vi.fn(async (workspaceRoot) => {
        events.push(`prepare:${workspaceRoot}`)
        return workspaceRoot
      }),
      onRestoreError: vi.fn(),
    })).resolves.toBe('/workspace/restored')

    expect(events).toEqual([
      'restore:/backup/mira.mira-backup.json:/workspace/restored',
      'prepare:/workspace/restored',
    ])
  })

  it.each([
    ['backup file', { chooseBackupFile: vi.fn().mockResolvedValue(null) }],
    ['restore directory', {
      chooseBackupFile: vi.fn().mockResolvedValue('/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn().mockResolvedValue(null),
    }],
  ])('leaves the active workspace unchanged when the %s selection is canceled', async (_label, overrides) => {
    const restoreWorkspaceBackup = vi.fn()

    await expect(resolveDesktopRestoreWorkspace({
      chooseBackupFile: vi.fn().mockResolvedValue('/backup/default.json'),
      chooseRestoreDirectory: vi.fn().mockResolvedValue('/workspace/default'),
      restoreWorkspaceBackup,
      prepareWorkspaceRoot: vi.fn(),
      onRestoreError: vi.fn(),
      ...overrides,
    })).resolves.toBeNull()

    expect(restoreWorkspaceBackup).not.toHaveBeenCalled()
  })

  it('reports restore failure and keeps the active workspace open', async () => {
    const error = Object.assign(new Error('target not empty'), {
      code: 'BACKUP_RESTORE_TARGET_INVALID',
    })
    const onRestoreError = vi.fn()

    await expect(resolveDesktopRestoreWorkspace({
      chooseBackupFile: vi.fn(async () => '/backup/mira.mira-backup.json'),
      chooseRestoreDirectory: vi.fn(async () => '/workspace/not-empty'),
      restoreWorkspaceBackup: vi.fn(async () => { throw error }),
      prepareWorkspaceRoot: vi.fn(),
      onRestoreError,
    })).resolves.toBeNull()

    expect(onRestoreError).toHaveBeenCalledWith({
      inputPath: '/backup/mira.mira-backup.json',
      workspaceRoot: '/workspace/not-empty',
      error,
    })
  })

  it('keeps restore reachable from the application menu for remembered-workspace users', async () => {
    const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8')

    expect(source).toContain("label: '从 Mira 备份恢复…'")
    expect(source).toContain('click: () => void restoreIntoAnotherWorkspace()')
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

  it('does not let a remembered workspace bypass an explicit smoke restore', () => {
    expect(rememberedWorkspaceRootForDesktopStartup({
      restore: {
        inputPath: '/tmp/backup.json',
        workspaceRoot: '/tmp/restored-workspace',
      },
    }, '/tmp/remembered-workspace')).toBeUndefined()

    expect(rememberedWorkspaceRootForDesktopStartup(
      {},
      '/tmp/remembered-workspace',
    )).toBe('/tmp/remembered-workspace')
  })
})

describe('desktop restore error presentation', () => {
  it('turns restore codes into a structured Chinese chooser error', () => {
    expect(formatDesktopRestoreError(Object.assign(new Error('Workspace target must be empty'), {
      code: 'BACKUP_RESTORE_TARGET_INVALID',
      details: { workspaceRoot: '/tmp/not-empty' },
    }))).toEqual({
      type: 'error',
      title: '无法恢复 Mira 备份',
      message: '恢复目标必须是新建或空文件夹',
      detail: [
        '错误代码：BACKUP_RESTORE_TARGET_INVALID',
        'Workspace target must be empty',
        '详细信息：{"workspaceRoot":"/tmp/not-empty"}',
      ].join('\n\n'),
    })
  })
})

describe('desktop startup host ordering', () => {
  it('persists the resolved workspace after restore and before starting the Node Host', async () => {
    const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8')
    const resolveIndex = source.indexOf('await selectStartupWorkspace(')
    const persistIndex = source.indexOf('await queueDesktopStateWrite()', resolveIndex)
    const hostIndex = source.indexOf('startNodeRuntime({', persistIndex)

    expect(resolveIndex).toBeGreaterThan(-1)
    expect(persistIndex).toBeGreaterThan(resolveIndex)
    expect(hostIndex).toBeGreaterThan(persistIndex)
  })
})
