import * as nodeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIRA_BACKUP_LIMITS } from '../../bridge/domain/portable-format.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { V2BoardStore } from '../../bridge/v2-board-store.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'
import { WorkflowStore } from '../../bridge/workflow-store.js'
import { BoardCheckpointStore } from '../../bridge/board-checkpoint-store.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'
import {
  readBoundedBackupHandle,
  restoreWorkspaceBackup,
} from '../../bridge/node-backup-restore.js'

const NOW = '2026-09-02T08:00:00.000Z'
const temporaryRoots = []

function board(id = 'board-1') {
  return {
    schemaVersion: 2,
    id,
    title: '恢复的课题',
    revision: 4,
    lifecycle: { state: 'archived', archivedAt: NOW },
    cards: [],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function run(id = 'run-1', boardId = 'board-1') {
  return {
    id,
    boardId,
    transformationId: 'historical-transformation',
    status: 'failed',
    sourceSnapshot: [],
    targetCardId: 'historical-target',
    targetBaseVersionId: null,
    intent: 'update',
    error: { code: 'MODEL_FAILED', message: 'failed', retryable: true },
    createdAt: NOW,
    finishedAt: NOW,
  }
}

function workflow(id = 'workflow-1') {
  return {
    id,
    title: '研究方法',
    description: '把材料整理成结论',
    inputs: [{
      id: `${id}-input-1`,
      name: '材料',
      description: '',
      required: true,
      cardinality: 'many',
    }],
    steps: [{
      id: `${id}-step-1`,
      label: '形成结论',
      instruction: '整理材料',
      acceptance: '',
      sources: [{ kind: 'input', inputId: `${id}-input-1` }],
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function inspirationPool() {
  return {
    schemaVersion: 1,
    id: 'inspiration-pool',
    entries: [{
      id: 'inspiration-1',
      tags: ['主意'],
      headVersionId: 'inspiration-1-v1',
      versions: [{
        id: 'inspiration-1-v1',
        entryId: 'inspiration-1',
        sequence: 1,
        content: { kind: 'markdown', markdown: '独立灵感' },
        digest: 'digest:inspiration-1-v1',
        origin: 'human',
        createdAt: NOW,
      }],
      createdAt: NOW,
      updatedAt: NOW,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function backup(overrides = {}) {
  return {
    format: 'mira-backup',
    formatVersion: 1,
    exportedAt: NOW,
    boards: [board()],
    runs: [run()],
    workflows: [workflow()],
    ...overrides,
  }
}

function checkpoint(id = 'checkpoint-1', boardValue = board()) {
  return {
    schemaVersion: 1,
    id,
    boardId: boardValue.id,
    title: '恢复点',
    baseBoardRevision: boardValue.revision,
    artifact: projectBoardArtifact({ board: boardValue, runs: [], exportedAt: NOW }),
    createdAt: NOW,
    metadataUpdatedAt: NOW,
  }
}

function backupV2(overrides = {}) {
  const boardValue = board()
  return backup({
    formatVersion: 2,
    boards: [boardValue],
    checkpoints: [checkpoint('checkpoint-1', boardValue)],
    ...overrides,
  })
}

async function fixture(data = backup()) {
  const root = await nodeFs.mkdtemp(join(tmpdir(), 'mira-backup-restore-test-'))
  temporaryRoots.push(root)
  const inputPath = join(root, 'input.mira-backup.json')
  const workspaceRoot = join(root, 'restored-workspace')
  await nodeFs.writeFile(inputPath, JSON.stringify(data), 'utf8')
  return { root, inputPath, workspaceRoot }
}

async function pathState(path) {
  try {
    const stats = await nodeFs.lstat(path)
    return stats.isDirectory() ? await nodeFs.readdir(path) : 'not-directory'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function restoreStagingNames(root, workspaceRoot) {
  const prefix = `.${basename(workspaceRoot)}.mira-restore-`
  return (await nodeFs.readdir(root)).filter((name) => name.startsWith(prefix))
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    nodeFs.rm(root, { recursive: true, force: true }),
  ))
})

describe('Node MiraBackup restore', () => {
  it('restores every managed entity into a previously missing workspace', async () => {
    const { inputPath, workspaceRoot } = await fixture()

    const result = await restoreWorkspaceBackup({ inputPath, workspaceRoot })

    expect(result).toEqual({
      workspaceRoot,
      restored: { boardCount: 1, runCount: 1, workflowCount: 1, checkpointCount: 0 },
    })
    const fs = createNodeWorkspaceAdapter(workspaceRoot)
    await expect(new V2BoardStore(fs).load('board-1')).resolves.toMatchObject({
      id: 'board-1',
      revision: 4,
      lifecycle: { state: 'archived' },
    })
    await expect(createV2RunStore(fs).load('run-1')).resolves.toMatchObject({
      id: 'run-1',
      boardId: 'board-1',
    })
    await expect(new WorkflowStore(fs).load('workflow-1')).resolves.toMatchObject({
      id: 'workflow-1',
    })
  })

  it('restores every MiraBackup V2 checkpoint and strictly reloads it', async () => {
    const { inputPath, workspaceRoot } = await fixture(backupV2())

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { checkpointCount: 1 },
    })
    const store = new BoardCheckpointStore(createNodeWorkspaceAdapter(workspaceRoot))
    await expect(store.listStrict()).resolves.toMatchObject([
      { id: 'checkpoint-1', boardId: 'board-1', title: '恢复点' },
    ])
  })

  it('restores MiraBackup V1 with zero checkpoints', async () => {
    const { inputPath, workspaceRoot } = await fixture()

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { checkpointCount: 0 },
    })
    const store = new BoardCheckpointStore(createNodeWorkspaceAdapter(workspaceRoot))
    await expect(store.listStrict()).resolves.toEqual([])
  })

  it('restores the workspace inspiration pool as a root-level store file', async () => {
    const { inputPath, workspaceRoot } = await fixture(backup({ inspirationPool: inspirationPool() }))

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { inspirationEntryCount: 1 },
    })
    await expect(nodeFs.readFile(join(workspaceRoot, 'inspiration-pool-v2.json'), 'utf8'))
      .resolves.toContain('独立灵感')
  })

  it('replaces a real empty directory only after staging validation', async () => {
    const { inputPath, workspaceRoot } = await fixture()
    await nodeFs.mkdir(workspaceRoot)

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { boardCount: 1, runCount: 1, workflowCount: 1 },
    })
    await expect(nodeFs.readFile(join(workspaceRoot, 'boards-v2/board-1.json'), 'utf8'))
      .resolves.toContain('"board-1"')
  })

  it('rejects a non-empty target without changing it', async () => {
    const { inputPath, workspaceRoot } = await fixture()
    await nodeFs.mkdir(workspaceRoot)
    await nodeFs.writeFile(join(workspaceRoot, 'keep.txt'), 'keep', 'utf8')

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).rejects.toMatchObject({
      code: 'BACKUP_RESTORE_TARGET_INVALID',
    })
    await expect(nodeFs.readFile(join(workspaceRoot, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('rejects a symlink target without writing through it', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    const linkedDirectory = join(root, 'linked-directory')
    await nodeFs.mkdir(linkedDirectory)
    await nodeFs.symlink(linkedDirectory, workspaceRoot)

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).rejects.toMatchObject({
      code: 'BACKUP_RESTORE_TARGET_INVALID',
    })
    await expect(nodeFs.readdir(linkedDirectory)).resolves.toEqual([])
  })

  it('uses one file handle and rejects an oversized input before attempting to read it', async () => {
    const { inputPath, workspaceRoot } = await fixture()
    const read = vi.fn()
    const close = vi.fn()
    const open = vi.fn(async () => ({
      stat: vi.fn(async () => ({
        size: MIRA_BACKUP_LIMITS.maxBytes + 1,
        isFile: () => true,
      })),
      read,
      close,
    }))
    const stat = vi.fn()
    const readFile = vi.fn()

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, open, stat, readFile } },
    )).rejects.toMatchObject({
      code: 'BACKUP_TOO_LARGE',
      details: expect.objectContaining({ category: 'bytes' }),
    })
    expect(open).toHaveBeenCalledWith(inputPath, 'r')
    expect(stat).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(await pathState(workspaceRoot)).toBe('missing')
  })

  it('reads at most one byte beyond the bound when the opened file grows after stat', async () => {
    const read = vi.fn()
      .mockImplementationOnce(async (buffer) => {
        buffer.fill(0x61)
        return { bytesRead: buffer.byteLength, buffer }
      })
      .mockImplementationOnce(async (buffer) => {
        buffer[0] = 0x62
        return { bytesRead: 1, buffer }
      })
    const handle = {
      stat: vi.fn(async () => ({ size: 8, isFile: () => true })),
      read,
    }

    await expect(readBoundedBackupHandle(handle, { maxBytes: 8 })).rejects.toMatchObject({
      code: 'BACKUP_TOO_LARGE',
      details: { category: 'bytes', actual: 9, limit: 8 },
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0][0]).toHaveLength(8)
    expect(read.mock.calls[1][0]).toHaveLength(1)
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['unknown format', JSON.stringify(backup({ formatVersion: 3 }))],
    ['invalid V2 checkpoint', JSON.stringify(backupV2({
      checkpoints: [checkpoint('checkpoint-other', board('board-other'))],
    }))],
    ['duplicate Board ID', JSON.stringify(backup({ boards: [board(), board()] }))],
  ])('rejects %s before creating a staging root', async (_label, content) => {
    const { root, inputPath, workspaceRoot } = await fixture()
    await nodeFs.writeFile(inputPath, content, 'utf8')
    const mkdtemp = vi.fn(nodeFs.mkdtemp)

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, mkdtemp } },
    )).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('rejects malformed UTF-8 instead of restoring replacement characters', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    const bytes = Buffer.from(JSON.stringify(backup()), 'utf8')
    const titleStart = bytes.indexOf(Buffer.from('恢复的课题', 'utf8'))
    bytes[titleStart] = 0xff
    await nodeFs.writeFile(inputPath, bytes)
    const mkdtemp = vi.fn(nodeFs.mkdtemp)

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, mkdtemp } },
    )).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('rejects IDs whose filenames collide on a case-insensitive filesystem before staging', async () => {
    const { root, inputPath, workspaceRoot } = await fixture(backup({
      workflows: [workflow('Workflow'), workflow('workflow')],
    }))
    const mkdtemp = vi.fn(nodeFs.mkdtemp)

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, mkdtemp } },
    )).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it.each([
    ['a composite filename longer than the filesystem limit', (() => {
      const boardId = `board-${'b'.repeat(120)}`
      const boardValue = board(boardId)
      return backupV2({
        boards: [boardValue],
        runs: [run('run-1', boardId)],
        checkpoints: [checkpoint(`checkpoint-${'c'.repeat(120)}`, boardValue)],
      })
    })()],
  ])('rejects %s before staging', async (_label, data) => {
    const { root, inputPath, workspaceRoot } = await fixture(data)
    const mkdtemp = vi.fn(nodeFs.mkdtemp)

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, mkdtemp } },
    )).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('restores checkpoint tuples that collided under delimiter filenames', async () => {
    const firstBoard = board('a')
    const secondBoard = board('a--b')
    const { inputPath, workspaceRoot } = await fixture(backupV2({
      boards: [firstBoard, secondBoard],
      runs: [],
      checkpoints: [
        checkpoint('b--c', firstBoard),
        checkpoint('c', secondBoard),
      ],
    }))

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { checkpointCount: 2 },
    })
    const store = new BoardCheckpointStore(createNodeWorkspaceAdapter(workspaceRoot))
    await expect(store.listStrict()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ boardId: 'a', id: 'b--c' }),
      expect.objectContaining({ boardId: 'a--b', id: 'c' }),
    ]))
  })

  it('restores checkpoint IDs that differ only by case or Unicode normalization', async () => {
    const boardValue = board()
    const { inputPath, workspaceRoot } = await fixture(backupV2({
      checkpoints: [
        checkpoint('Checkpoint', boardValue),
        checkpoint('checkpoint', boardValue),
        checkpoint('\u00e9', boardValue),
        checkpoint('e\u0301', boardValue),
      ],
    }))

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toMatchObject({
      restored: { checkpointCount: 4 },
    })
  })

  it('scans the checkpoint directory a bounded number of times for a restore batch', async () => {
    const boards = [board('board-1'), board('board-2')]
    const checkpoints = boards.flatMap((boardValue) =>
      Array.from({ length: 20 }, (_, index) => checkpoint(`${boardValue.id}-checkpoint-${index}`, boardValue)))
    const { inputPath, workspaceRoot } = await fixture(backupV2({ boards, runs: [], checkpoints }))
    let checkpointDirectoryReads = 0
    const readdir = async (...args) => {
      if (String(args[0]).includes('.mira-restore-') && String(args[0]).endsWith('/board-checkpoints-v1')) {
        checkpointDirectoryReads += 1
      }
      return nodeFs.readdir(...args)
    }

    await restoreWorkspaceBackup({ inputPath, workspaceRoot }, { fs: { ...nodeFs, readdir } })

    expect(checkpointDirectoryReads).toBe(3)
  })

  it.each([
    ['Board', backup({ boards: [board('../outside')], runs: [run('run-1', '../outside')] })],
    ['Run', backup({ runs: [run('run/escape')] })],
    ['Workflow', backup({ workflows: [workflow('workflow\\escape')] })],
    ['NUL', backup({ workflows: [workflow(`workflow${String.fromCharCode(0)}escape`)] })],
    ['dot segment', backup({ workflows: [workflow('.')] })],
  ])('rejects an unsafe %s ID before staging writes', async (_label, data) => {
    const { root, inputPath, workspaceRoot } = await fixture(data)
    const mkdtemp = vi.fn(nodeFs.mkdtemp)

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, mkdtemp } },
    )).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it.each(['mkdir', 'writeFile'])('cleans staging after a %s failure and leaves a missing target retryable', async (method) => {
    const { root, inputPath, workspaceRoot } = await fixture()
    let failed = false
    const injected = async (...args) => {
      const path = String(args[0])
      if (!failed && path.includes('.mira-restore-')) {
        failed = true
        throw Object.assign(new Error(`${method} failed`), { code: 'EIO' })
      }
      return nodeFs[method](...args)
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, [method]: injected } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toBe('missing')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toBeDefined()
  })

  it('cleans staging after a checkpoint write failure and leaves the target untouched', async () => {
    const { root, inputPath, workspaceRoot } = await fixture(backupV2())
    const writeFile = async (...args) => {
      if (String(args[0]).includes('/board-checkpoints-v1/')) {
        throw Object.assign(new Error('checkpoint write failed'), { code: 'EIO' })
      }
      return nodeFs.writeFile(...args)
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, writeFile } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toBe('missing')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('rejects a changed entity during strict reread and removes the staging root', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    const readFile = async (...args) => {
      const path = String(args[0])
      const content = await nodeFs.readFile(...args)
      if (path.includes('.mira-restore-') && path.endsWith('/boards-v2/board-1.json')) {
        return content.replace('"board-1"', '"board-other"')
      }
      return content
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, readFile } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toBe('missing')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('rejects a changed checkpoint during strict reread and removes the staging root', async () => {
    const { root, inputPath, workspaceRoot } = await fixture(backupV2())
    const readFile = async (...args) => {
      const path = String(args[0])
      const content = await nodeFs.readFile(...args)
      if (path.includes('.mira-restore-') && path.includes('/board-checkpoints-v1/')) {
        return content.replace('"checkpoint-1"', '"checkpoint-other"')
      }
      return content
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, readFile } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toBe('missing')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('restores an empty target after final rename failure and supports retry', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    await nodeFs.mkdir(workspaceRoot)
    let failed = false
    const rename = async (...args) => {
      if (!failed && String(args[0]).includes('.mira-restore-')) {
        failed = true
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      return nodeFs.rename(...args)
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, rename } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toEqual([])
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])

    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toBeDefined()
    await expect(nodeFs.readdir(join(workspaceRoot, 'boards-v2'))).resolves.toEqual([
      'board-1.json',
    ])
  })

  it('leaves a missing target missing after final rename failure and supports retry', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    let failed = false
    const rename = async (...args) => {
      if (!failed && String(args[0]).includes('.mira-restore-')) {
        failed = true
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      return nodeFs.rename(...args)
    }

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, rename } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    expect(await pathState(workspaceRoot)).toBe('missing')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot })).resolves.toBeDefined()
  })

  it('recognizes a completed atomic rename even if the filesystem call reports an error', async () => {
    const { root, inputPath, workspaceRoot } = await fixture()
    const rename = vi.fn(async (...args) => {
      await nodeFs.rename(...args)
      throw Object.assign(new Error('ambiguous rename completion'), { code: 'EIO' })
    })

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, rename } },
    )).resolves.toMatchObject({ restored: { boardCount: 1 } })
    await expect(nodeFs.readFile(join(workspaceRoot, 'boards-v2/board-1.json'), 'utf8'))
      .resolves.toContain('"board-1"')
    expect(await restoreStagingNames(root, workspaceRoot)).toEqual([])
  })

  it('does not overwrite a target that becomes non-empty before commit', async () => {
    const { inputPath, workspaceRoot } = await fixture()
    await nodeFs.mkdir(workspaceRoot)
    let targetReads = 0
    const readdir = vi.fn(async (...args) => {
      const result = await nodeFs.readdir(...args)
      if (String(args[0]) === workspaceRoot) targetReads += 1
      if (String(args[0]) === workspaceRoot && targetReads === 2) {
        await nodeFs.writeFile(join(workspaceRoot, 'late.txt'), 'late', 'utf8')
        return ['late.txt']
      }
      return result
    })

    await expect(restoreWorkspaceBackup(
      { inputPath, workspaceRoot },
      { fs: { ...nodeFs, readdir } },
    )).rejects.toMatchObject({ code: 'BACKUP_RESTORE_TARGET_INVALID' })
    await expect(nodeFs.readFile(join(workspaceRoot, 'late.txt'), 'utf8')).resolves.toBe('late')
  })
})
