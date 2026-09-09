import {
  normalizeCheckpointNote,
  normalizeCheckpointTitle,
} from './domain/board-checkpoint.js'
import {
  assertBoardHasNoBlockingRuns,
  assertBoardWritable,
  boardLifecycleState,
  boardRevision,
  normalizeBoardTitle,
} from './domain/board-lifecycle.js'
import { typed } from './domain/errors.js'

const CHECKPOINT_LIMIT = 20

function checkpointSaveStatus(board, runs, checkpointCount) {
  if (boardLifecycleState(board) !== 'active') return { allowed: false, reason: 'read-only' }
  const boardRuns = runs.filter((run) => run?.boardId === board.id)
  const active = boardRuns.find((run) => run.status === 'queued' || run.status === 'running')
  if (active) return { allowed: false, reason: 'active-run', runId: active.id }
  const candidate = boardRuns.find((run) =>
    run.status === 'succeeded' && run.result?.disposition === 'candidate')
  if (candidate) return { allowed: false, reason: 'pending-candidate', runId: candidate.id }
  if (checkpointCount >= CHECKPOINT_LIMIT) return { allowed: false, reason: 'limit' }
  return { allowed: true }
}

export function createBoardCheckpointService({
  boardStore,
  runStore,
  checkpointStore,
  boardPortabilityService,
  newId,
  now = () => new Date().toISOString(),
} = {}) {
  if (!boardStore || !runStore || !checkpointStore || !boardPortabilityService || typeof newId !== 'function') {
    throw new TypeError('BoardCheckpoint service requires Board, Run, Checkpoint, portability, and ID services')
  }

  async function withBoard(boardId, operation) {
    try {
      return await boardStore.withLockedBoard(boardId, operation)
    } catch (error) {
      if (error?.code === 'BOARD_NOT_FOUND') {
        throw typed('CHECKPOINT_NOT_FOUND', `Board ${boardId} was not found`)
      }
      throw error
    }
  }

  async function list(boardId) {
    return withBoard(boardId, async (board) => {
      const [checkpoints, runs] = await Promise.all([
        checkpointStore.listSummaries(boardId),
        runStore.listStrict(),
      ])
      return { checkpoints, saveStatus: checkpointSaveStatus(board, runs, checkpoints.length) }
    })
  }

  async function get(boardId, checkpointId) {
    return withBoard(boardId, async (board) => {
      const [checkpoint, runs] = await Promise.all([
        checkpointStore.load(boardId, checkpointId),
        runStore.listStrict(),
      ])
      return {
        checkpoint,
        current: {
          board: structuredClone(board),
          runs: runs.filter((run) => run?.boardId === boardId),
        },
      }
    })
  }

  async function create(boardId, body = {}) {
    return withBoard(boardId, async (board, boardLease) => {
      assertBoardWritable(board)
      if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) {
        throw typed('CHECKPOINT_INVALID', 'baseRevision must be a non-negative integer')
      }
      if (boardRevision(board) !== body.baseRevision) {
        throw typed('CHECKPOINT_CONFLICT', 'Board changed after this checkpoint was prepared')
      }
      const runs = await runStore.listStrict()
      assertBoardHasNoBlockingRuns(runs, boardId)
      if ((await checkpointStore.listSummaries(boardId)).length >= CHECKPOINT_LIMIT) {
        throw typed('CHECKPOINT_LIMIT', `Board ${boardId} already has ${CHECKPOINT_LIMIT} checkpoints`)
      }
      let artifact
      try {
        artifact = await boardPortabilityService.exportBoard(boardId, boardLease)
      } catch (error) {
        if (error?.code === 'PAYLOAD_TOO_LARGE') {
          throw typed('CHECKPOINT_TOO_LARGE', error.message, error.details)
        }
        throw error
      }
      const timestamp = now()
      const checkpoint = {
        schemaVersion: 1,
        id: newId('checkpoint'),
        boardId,
        title: normalizeCheckpointTitle(body.title),
        ...(normalizeCheckpointNote(body.note) !== undefined
          ? { note: normalizeCheckpointNote(body.note) }
          : {}),
        baseBoardRevision: boardRevision(board),
        artifact,
        createdAt: timestamp,
        metadataUpdatedAt: timestamp,
      }
      await checkpointStore.save(checkpoint, boardLease)
      return { checkpoint }
    })
  }

  async function update(boardId, checkpointId, body = {}) {
    return withBoard(boardId, async (_board, boardLease) => ({
      checkpoint: await checkpointStore.updateMetadata(boardId, checkpointId, body, boardLease),
    }))
  }

  async function remove(boardId, checkpointId, body = {}) {
    if (body.confirmation !== 'delete-checkpoint') {
      throw typed('CHECKPOINT_INVALID', 'Checkpoint deletion requires explicit confirmation')
    }
    return withBoard(boardId, async (_board, boardLease) => {
      await checkpointStore.remove(boardId, checkpointId, boardLease)
      return { deletedCheckpointId: checkpointId }
    })
  }

  async function exportArtifact(boardId, checkpointId) {
    return withBoard(boardId, async () => (await checkpointStore.load(boardId, checkpointId)).artifact)
  }

  async function fork(boardId, checkpointId, body = {}) {
    const artifact = await withBoard(boardId, async () =>
      structuredClone((await checkpointStore.load(boardId, checkpointId)).artifact))
    const suffix = ' - 版本副本'
    const defaultTitle = `${[...artifact.board.title]
      .slice(0, 120 - [...suffix].length)
      .join('')}${suffix}`
    artifact.board.title = normalizeBoardTitle(body.title === undefined ? defaultTitle : body.title)
    return boardPortabilityService.importBoard({ artifact })
  }

  return Object.freeze({ list, get, create, update, remove, fork, exportArtifact })
}
