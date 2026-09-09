import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TransformationRun } from '../domain'
import type { BoardImportResult } from '../v2Api'
import { v2Api } from '../v2Api'
import { createCheckpointSlice } from './checkpointSlice'
import { compareCheckpointToCurrent } from './checkpointDiff'

const checkpoint = {
  schemaVersion: 1 as const,
  id: 'checkpoint-1',
  boardId: 'board-1',
  title: '第一稿',
  baseBoardRevision: 2,
  artifact: {
    format: 'mira-board' as const,
    formatVersion: 1 as const,
    exportedAt: '2026-09-05T00:00:00.000Z',
    board: {
      schemaVersion: 2 as const,
      id: 'board-1', title: '课题', revision: 2, cards: [], transformations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    },
    runs: [], workflowProvenance: [], fileDependencies: [], externalReferences: [],
  },
  createdAt: '2026-09-05T00:00:00.000Z',
  metadataUpdatedAt: '2026-09-05T00:00:00.000Z',
}

afterEach(() => vi.restoreAllMocks())

function run(id: string, status: TransformationRun['status'] = 'succeeded'): TransformationRun {
  return {
    id, boardId: 'board-1', transformationId: 'step-1', status,
    sourceSnapshot: [], targetCardId: 'card-1', targetBaseVersionId: null,
    intent: 'update', createdAt: checkpoint.createdAt,
    ...(status === 'succeeded' ? {
      result: { disposition: 'applied', output: 'done', digest: 'digest' },
      finishedAt: checkpoint.createdAt,
    } : {}),
  }
}

describe('checkpoint store slice', () => {
  it('keeps the full remote history when the current Board cache contains only the latest Run', async () => {
    const first = run('first')
    const latest = run('latest')
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint, current: { board: checkpoint.artifact.board, runs: [first, latest] },
    })
    const actions = createCheckpointSlice({ integrateFork: vi.fn(), downloadArtifact: vi.fn() })
    const result = await actions.loadBoardCheckpoint('board-1', checkpoint.id, {
      board: checkpoint.artifact.board, runs: { latest },
    })

    expect(Object.keys(result.runs)).toEqual(['first', 'latest'])
    expect(compareCheckpointToCurrent(checkpoint.artifact, result.board, result.runs).runs.added).toBe(2)
  })

  it('uses remote current state when the supplied Store context belongs to another Board', async () => {
    const remoteRun = run('remote')
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint, current: { board: checkpoint.artifact.board, runs: [remoteRun] },
    })
    const actions = createCheckpointSlice({ integrateFork: vi.fn(), downloadArtifact: vi.fn() })
    const result = await actions.loadBoardCheckpoint('board-1', checkpoint.id, {
      board: { ...checkpoint.artifact.board, id: 'board-2' },
      runs: { other: { ...run('other'), boardId: 'board-2' } },
    })

    expect(result.board).toEqual(checkpoint.artifact.board)
    expect(result.runs).toEqual({ remote: remoteRun })
  })

  it('loads summaries and a checkpoint/current Board comparison context', async () => {
    const currentRun = {
      id: 'run-after-checkpoint', boardId: 'board-1', transformationId: 'step-1',
      status: 'succeeded', sourceSnapshot: [], targetCardId: 'card-1',
      targetBaseVersionId: null, intent: 'update',
      result: { disposition: 'applied', output: '完成', digest: 'digest', appliedVersionId: 'v1' },
      createdAt: checkpoint.createdAt, startedAt: checkpoint.createdAt,
      finishedAt: checkpoint.createdAt,
    } satisfies TransformationRun
    vi.spyOn(v2Api, 'listCheckpoints').mockResolvedValue({
      checkpoints: [], saveStatus: { allowed: true },
    })
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint,
      current: { board: checkpoint.artifact.board, runs: [currentRun] },
    })
    const actions = createCheckpointSlice({
      integrateFork: vi.fn(),
      downloadArtifact: vi.fn(),
    })

    await expect(actions.listBoardCheckpoints('board-1')).resolves.toEqual({
      checkpoints: [], saveStatus: { allowed: true },
    })
    await expect(actions.loadBoardCheckpoint('board-1', 'checkpoint-1')).resolves.toEqual({
      checkpoint,
      board: checkpoint.artifact.board,
      runs: { 'run-after-checkpoint': currentRun },
    })
  })

  it('reuses the current Store context without invoking the export busy gate', async () => {
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint,
      current: { board: checkpoint.artifact.board, runs: [] },
    })
    const actions = createCheckpointSlice({ integrateFork: vi.fn(), downloadArtifact: vi.fn() })
    const current = { board: checkpoint.artifact.board, runs: {} }

    await expect(actions.loadBoardCheckpoint('board-1', 'checkpoint-1', current)).resolves.toEqual({
      checkpoint,
      ...current,
    })
  })

  it('keeps create, metadata CAS, and delete request contracts narrow', async () => {
    const create = vi.spyOn(v2Api, 'createCheckpoint').mockResolvedValue({ checkpoint })
    const update = vi.spyOn(v2Api, 'updateCheckpoint').mockResolvedValue({ checkpoint })
    const remove = vi.spyOn(v2Api, 'deleteCheckpoint').mockResolvedValue({
      deletedCheckpointId: checkpoint.id,
    })
    const notify = vi.fn()
    const actions = createCheckpointSlice({
      integrateFork: vi.fn(), downloadArtifact: vi.fn(), notify,
    })

    await actions.createBoardCheckpoint('board-1', {
      title: '第一稿', note: '稳定', baseRevision: 2,
    })
    await actions.updateBoardCheckpoint('board-1', 'checkpoint-1', {
      title: '定稿', note: null, baseMetadataUpdatedAt: checkpoint.metadataUpdatedAt,
    })
    await actions.deleteBoardCheckpoint('board-1', 'checkpoint-1')

    expect(create).toHaveBeenCalledWith('board-1', {
      title: '第一稿', note: '稳定', baseRevision: 2,
    })
    expect(update).toHaveBeenCalledWith('board-1', 'checkpoint-1', {
      title: '定稿', note: null, baseMetadataUpdatedAt: checkpoint.metadataUpdatedAt,
    })
    expect(remove).toHaveBeenCalledWith('board-1', 'checkpoint-1')
    expect(notify.mock.calls).toEqual([
      ['已保存画布版本“第一稿”。', 'board-1'],
      ['已更新画布版本“第一稿”。', 'board-1'],
      ['已删除画布版本。', 'board-1'],
    ])
  })

  it('treats a committed fork as successful when local hydration reports a recoverable failure', async () => {
    const result = {
      boardId: 'board-copy',
      board: { ...checkpoint.artifact.board, id: 'board-copy', title: '副本' },
      imported: { runCount: 0, externalReferenceCount: 0 },
    } satisfies BoardImportResult
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint, current: { board: checkpoint.artifact.board, runs: [] },
    })
    vi.spyOn(v2Api, 'forkCheckpoint').mockResolvedValue(result)
    const integrateFork = vi.fn().mockRejectedValue(new Error('catalog refresh failed'))
    const actions = createCheckpointSlice({ integrateFork, downloadArtifact: vi.fn() })

    await expect(actions.forkBoardCheckpoint('board-1', 'checkpoint-1', '副本'))
      .resolves.toBe('board-copy')
  })

  it('captures fork integration ownership before any request can outlive navigation', async () => {
    let resolveCheckpoint!: (value: Awaited<ReturnType<typeof v2Api.getCheckpoint>>) => void
    vi.spyOn(v2Api, 'getCheckpoint').mockReturnValue(new Promise((resolve) => {
      resolveCheckpoint = resolve
    }))
    const result: BoardImportResult = {
      boardId: 'board-copy', board: { ...checkpoint.artifact.board, id: 'board-copy' },
      imported: { runCount: 0, externalReferenceCount: 0 },
    }
    vi.spyOn(v2Api, 'forkCheckpoint').mockResolvedValue(result)
    const integrateFork = vi.fn()
    let navigation = 'original'
    const integrations: string[] = []
    const captureForkIntegration = vi.fn(() => {
      const owner = navigation
      return async () => { integrations.push(owner) }
    })
    const actions = createCheckpointSlice({
      integrateFork, captureForkIntegration, downloadArtifact: vi.fn(),
    })

    const pending = actions.forkBoardCheckpoint('board-1', checkpoint.id)
    expect(captureForkIntegration).toHaveBeenCalledTimes(1)
    navigation = 'newer navigation'
    resolveCheckpoint({ checkpoint, current: { board: checkpoint.artifact.board, runs: [] } })
    await expect(pending).resolves.toBe('board-copy')
    expect(integrations).toEqual(['original'])
    expect(integrateFork).not.toHaveBeenCalled()
  })

  it.each([false, true])('forwards a lazy UI navigation predicate to integration (captured: %s)', async (captured) => {
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint, current: { board: checkpoint.artifact.board, runs: [] },
    })
    const result: BoardImportResult = {
      boardId: 'board-copy', board: { ...checkpoint.artifact.board, id: 'board-copy' },
      imported: { runCount: 0, externalReferenceCount: 0 },
    }
    vi.spyOn(v2Api, 'forkCheckpoint').mockResolvedValue(result)
    let panelIsCurrent = true
    const canNavigate = vi.fn(() => panelIsCurrent)
    const integrate = vi.fn().mockResolvedValue(undefined)
    const actions = createCheckpointSlice({
      integrateFork: captured ? vi.fn() : integrate,
      ...(captured ? { captureForkIntegration: () => integrate } : {}),
      downloadArtifact: vi.fn(),
    })

    await expect(actions.forkBoardCheckpoint('board-1', checkpoint.id, 'copy', canNavigate))
      .resolves.toBe('board-copy')
    expect(integrate).toHaveBeenCalledWith(result, checkpoint.title, canNavigate)
    expect(canNavigate).not.toHaveBeenCalled()
    panelIsCurrent = false
    expect(integrate.mock.calls[0][2]()).toBe(false)
  })

  it('integrates a fork and exports through the shared download boundary', async () => {
    const result = {
      boardId: 'board-copy',
      board: { ...checkpoint.artifact.board, id: 'board-copy', title: '副本' },
      imported: { runCount: 0, externalReferenceCount: 0 },
    } satisfies BoardImportResult
    vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({
      checkpoint, current: { board: checkpoint.artifact.board, runs: [] },
    })
    vi.spyOn(v2Api, 'forkCheckpoint').mockResolvedValue(result)
    vi.spyOn(v2Api, 'exportCheckpoint').mockResolvedValue(checkpoint.artifact)
    const integrateFork = vi.fn().mockResolvedValue(undefined)
    const downloadArtifact = vi.fn()
    const actions = createCheckpointSlice({ integrateFork, downloadArtifact })

    await expect(actions.forkBoardCheckpoint('board-1', 'checkpoint-1', '副本'))
      .resolves.toBe('board-copy')
    await actions.exportBoardCheckpoint('board-1', 'checkpoint-1', '课题 - 第一稿')

    expect(integrateFork).toHaveBeenCalledWith(result, '第一稿', undefined)
    expect(downloadArtifact).toHaveBeenCalledWith(checkpoint.artifact, '课题 - 第一稿')
  })
})
