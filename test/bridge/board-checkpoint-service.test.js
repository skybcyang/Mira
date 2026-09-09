import { describe, expect, it, vi } from 'vitest'
import { createBoardCheckpointService } from '../../bridge/board-checkpoint-service.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

const NOW = '2026-09-05T08:00:00.000Z'

function setup(overrides = {}) {
  const board = emptyBoardV2('board-1', '课题', NOW)
  board.revision = 4
  const checkpointStore = overrides.checkpointStore || {
    listSummaries: vi.fn(async () => []),
    save: vi.fn(async (value) => value),
    load: vi.fn(),
    updateMetadata: vi.fn(),
    remove: vi.fn(),
  }
  const boardStore = overrides.boardStore || {
    withLockedBoard: vi.fn(async (_id, operation) => operation(board, {})),
  }
  const runStore = overrides.runStore || { listStrict: vi.fn(async () => []) }
  const artifact = projectBoardArtifact({ board, runs: [], exportedAt: NOW })
  const boardPortabilityService = overrides.boardPortabilityService || {
    exportBoard: vi.fn(async () => artifact),
    importBoard: vi.fn(async ({ artifact: value }) => ({
      boardId: 'board-copy', board: { ...value.board, id: 'board-copy', revision: 0 },
      imported: { runCount: value.runs.length, externalReferenceCount: 0 },
    })),
  }
  let id = 0
  return {
    board,
    checkpointStore,
    boardStore,
    runStore,
    boardPortabilityService,
    service: createBoardCheckpointService({
      boardStore,
      runStore,
      checkpointStore,
      boardPortabilityService,
      newId: () => `checkpoint-${++id}`,
      now: () => NOW,
    }),
  }
}

describe('BoardCheckpoint service', () => {
  it('returns lightweight save gating and a current comparison context for noncurrent Boards', async () => {
    const runs = [
      { id: 'run-active', boardId: 'board-1', status: 'running' },
      { id: 'run-other', boardId: 'board-2', status: 'running' },
    ]
    const checkpoint = {
      schemaVersion: 1, id: 'checkpoint-1', boardId: 'board-1', title: '第一稿',
      baseBoardRevision: 4,
      artifact: projectBoardArtifact({ board: setup().board, runs: [], exportedAt: NOW }),
      createdAt: NOW, metadataUpdatedAt: NOW,
    }
    const context = setup({
      runStore: { listStrict: vi.fn(async () => runs) },
      checkpointStore: {
        listSummaries: vi.fn(async () => [{ id: checkpoint.id }]),
        save: vi.fn(), load: vi.fn(async () => checkpoint), updateMetadata: vi.fn(), remove: vi.fn(),
      },
    })

    await expect(context.service.list('board-1')).resolves.toEqual({
      checkpoints: [{ id: 'checkpoint-1' }],
      saveStatus: { allowed: false, reason: 'active-run', runId: 'run-active' },
    })
    await expect(context.service.get('board-1', 'checkpoint-1')).resolves.toMatchObject({
      checkpoint: { id: 'checkpoint-1' },
      current: { board: { id: 'board-1' }, runs: [{ id: 'run-active' }] },
    })
  })

  it('creates a named checkpoint inside the Board lock without changing revision', async () => {
    const context = setup()
    const result = await context.service.create('board-1', {
      title: ' 第一稿 ', note: ' 可比较 ', baseRevision: 4,
    })

    expect(result.checkpoint).toMatchObject({
      id: 'checkpoint-1', boardId: 'board-1', title: '第一稿', note: '可比较',
      baseBoardRevision: 4,
    })
    expect(result.checkpoint.artifact.board.revision).toBe(4)
    expect(context.board.revision).toBe(4)
    expect(context.boardPortabilityService.exportBoard).toHaveBeenCalledWith('board-1', {})
  })

  it.each([
    ['queued', undefined, 'TARGET_BUSY'],
    ['running', undefined, 'TARGET_BUSY'],
    ['succeeded', { output: '候选', digest: 'd', disposition: 'candidate' }, 'CANDIDATE_PENDING'],
  ])('rejects %s Run state before writing', async (status, result, code) => {
    const runStore = { listStrict: vi.fn(async () => [{ boardId: 'board-1', status, result }]) }
    const context = setup({ runStore })
    await expect(context.service.create('board-1', {
      title: '版本', baseRevision: 4,
    })).rejects.toMatchObject({ code })
    expect(context.checkpointStore.save).not.toHaveBeenCalled()
  })

  it('rejects read-only Boards, stale revisions, and the 20 checkpoint limit', async () => {
    const archived = emptyBoardV2('board-1', '课题', NOW)
    archived.lifecycle = { state: 'archived', archivedAt: NOW }
    const archivedContext = setup({
      boardStore: { withLockedBoard: vi.fn(async (_id, operation) => operation(archived, {})) },
    })
    await expect(archivedContext.service.create('board-1', {
      title: '版本', baseRevision: 0,
    })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })

    const stale = setup()
    await expect(stale.service.create('board-1', {
      title: '版本', baseRevision: 3,
    })).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' })

    const full = setup({ checkpointStore: {
      listSummaries: vi.fn(async () => Array.from({ length: 20 }, (_, id) => ({ id }))),
      save: vi.fn(), load: vi.fn(), updateMetadata: vi.fn(), remove: vi.fn(),
    } })
    await expect(full.service.create('board-1', {
      title: '版本', baseRevision: 4,
    })).rejects.toMatchObject({ code: 'CHECKPOINT_LIMIT' })
  })

  it('exports the embedded artifact and forks through the existing import remap path', async () => {
    const context = setup()
    const checkpoint = {
      schemaVersion: 1, id: 'checkpoint-1', boardId: 'board-1', title: '第一稿',
      baseBoardRevision: 4,
      artifact: projectBoardArtifact({ board: context.board, runs: [], exportedAt: NOW }),
      createdAt: NOW, metadataUpdatedAt: NOW,
    }
    context.checkpointStore.load.mockResolvedValue(checkpoint)

    await expect(context.service.exportArtifact('board-1', 'checkpoint-1')).resolves.toBe(checkpoint.artifact)
    await expect(context.service.fork('board-1', 'checkpoint-1', { title: '副本' }))
      .resolves.toMatchObject({ boardId: 'board-copy' })
    expect(context.boardPortabilityService.importBoard).toHaveBeenCalledWith({
      artifact: expect.objectContaining({ board: expect.objectContaining({ title: '副本' }) }),
    })
    expect(checkpoint.artifact.board.title).toBe('课题')

    await context.service.fork('board-1', 'checkpoint-1')
    expect(context.boardPortabilityService.importBoard).toHaveBeenLastCalledWith({
      artifact: expect.objectContaining({
        board: expect.objectContaining({ title: '课题 - 版本副本' }),
      }),
    })
    expect(checkpoint.artifact.board.title).toBe('课题')
  })
})
