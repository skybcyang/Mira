import { describe, expect, it, vi } from 'vitest'
import { createBackupService } from '../../bridge/backup-service.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'

const NOW = '2026-09-02T08:00:00.000Z'

function board(id, state) {
  const value = emptyBoardV2(id, `课题 ${id}`, NOW)
  value.lifecycle = { state }
  return value
}

function failedRun(overrides = {}) {
  return {
    id: 'run-1',
    boardId: 'board-active',
    transformationId: 'historical-transformation',
    status: 'failed',
    sourceSnapshot: [],
    targetCardId: 'historical-target',
    targetBaseVersionId: null,
    intent: 'update',
    error: { code: 'MODEL_FAILED', message: 'failed', retryable: true },
    createdAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function workflow() {
  return {
    id: 'workflow-1',
    title: '研究方法',
    description: '',
    steps: [{
      id: 'workflow-step-1', label: '形成结论', instruction: '整理来源', acceptance: '',
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

function checkpoint(boardValue = board('board-active', 'active')) {
  return {
    schemaVersion: 1,
    id: 'checkpoint-1',
    boardId: boardValue.id,
    title: '初稿',
    baseBoardRevision: boardValue.revision,
    artifact: projectBoardArtifact({ board: boardValue, runs: [], exportedAt: NOW }),
    createdAt: NOW,
    metadataUpdatedAt: NOW,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function setup(overrides = {}) {
  const coordinator = overrides.coordinator || createStorageCoordinator()
  const boardStore = overrides.boardStore || {
    listStrict: vi.fn(async () => [
      board('board-active', 'active'),
      board('board-archived', 'archived'),
      board('board-trashed', 'trashed'),
    ]),
  }
  const runStore = overrides.runStore || { listStrict: vi.fn(async () => [failedRun()]) }
  const workflowStore = overrides.workflowStore || {
    listStrict: vi.fn(async () => [workflow()]),
  }
  const inspirationPoolStore = overrides.inspirationPoolStore
  const checkpointStore = overrides.checkpointStore || {
    listStrict: vi.fn(async () => [checkpoint()]),
  }
  return {
    coordinator,
    boardStore,
    runStore,
    workflowStore,
    checkpointStore,
    service: createBackupService({
      coordinator,
      boardStore,
      runStore,
      workflowStore,
      inspirationPoolStore,
      checkpointStore,
      now: () => NOW,
    }),
  }
}

describe('workspace backup service', () => {
  it('strictly exports all Board lifecycle states, terminal Runs, and workflows', async () => {
    const context = setup()

    await expect(context.service.exportBackup()).resolves.toMatchObject({
      format: 'mira-backup',
      formatVersion: 2,
      boards: [
        { id: 'board-active', lifecycle: { state: 'active' } },
        { id: 'board-archived', lifecycle: { state: 'archived' } },
        { id: 'board-trashed', lifecycle: { state: 'trashed' } },
      ],
      runs: [{ id: 'run-1', status: 'failed' }],
      workflows: [{ id: 'workflow-1' }],
      checkpoints: [{ id: 'checkpoint-1', boardId: 'board-active' }],
    })
    expect(context.boardStore.listStrict).toHaveBeenCalledOnce()
    expect(context.runStore.listStrict).toHaveBeenCalledOnce()
    expect(context.workflowStore.listStrict).toHaveBeenCalledOnce()
    expect(context.checkpointStore.listStrict).toHaveBeenCalledOnce()
  })

  it('exports the workspace inspiration pool alongside the other workspace data', async () => {
    const poolStore = { load: vi.fn(async () => inspirationPool()) }
    const context = setup({ inspirationPoolStore: poolStore })

    await expect(context.service.exportBackup()).resolves.toMatchObject({
      inspirationPool: { id: 'inspiration-pool', entries: [{ id: 'inspiration-1' }] },
    })
    expect(poolStore.load).toHaveBeenCalledOnce()
  })

  it.each(['queued', 'running'])('rejects a snapshot containing a %s Run', async (status) => {
    const context = setup({
      runStore: { listStrict: vi.fn(async () => [failedRun({ status })]) },
    })

    await expect(context.service.exportBackup()).rejects.toMatchObject({ code: 'EXPORT_BUSY' })
  })

  it('propagates strict member read failures without returning a partial backup', async () => {
    const failure = Object.assign(new Error('corrupt workflow'), { code: 'WORKFLOW_INVALID' })
    const context = setup({
      workflowStore: { listStrict: vi.fn(async () => { throw failure }) },
    })

    await expect(context.service.exportBackup()).rejects.toBe(failure)
  })

  it('propagates strict checkpoint read failures without returning a partial backup', async () => {
    const failure = Object.assign(new Error('corrupt checkpoint'), { code: 'CHECKPOINT_INVALID' })
    const context = setup({
      checkpointStore: { listStrict: vi.fn(async () => { throw failure }) },
    })

    await expect(context.service.exportBackup()).rejects.toBe(failure)
  })

  it('holds the exclusive snapshot lease until every strict list has been projected', async () => {
    const coordinator = createStorageCoordinator()
    const listed = deferred()
    const releaseList = deferred()
    const mutationEntered = vi.fn()
    const context = setup({
      coordinator,
      boardStore: {
        listStrict: vi.fn(async () => {
          listed.resolve()
          await releaseList.promise
          return [board('board-active', 'active')]
        }),
      },
      runStore: { listStrict: vi.fn(async () => []) },
      workflowStore: { listStrict: vi.fn(async () => []) },
    })

    const exporting = context.service.exportBackup()
    await listed.promise
    const mutating = coordinator.withMutation(async () => mutationEntered())
    await Promise.resolve()
    expect(mutationEntered).not.toHaveBeenCalled()

    releaseList.resolve()
    await expect(exporting).resolves.toMatchObject({ boards: [{ id: 'board-active' }] })
    await mutating
    expect(mutationEntered).toHaveBeenCalledOnce()
  })
})
