import { typed } from './errors.js'

const LIFECYCLE_STATES = new Set(['active', 'archived', 'trashed'])

export function boardRevision(board) {
  return Number.isInteger(board?.revision) && board.revision >= 0 ? board.revision : 0
}

export function boardLifecycleState(board) {
  return LIFECYCLE_STATES.has(board?.lifecycle?.state) ? board.lifecycle.state : 'active'
}

export function normalizeBoardLifecycle(board) {
  return {
    ...board,
    revision: boardRevision(board),
    lifecycle: board?.lifecycle
      ? { ...board.lifecycle }
      : { state: 'active' },
  }
}

export function boardSummary(board) {
  return {
    id: board.id,
    title: board.title,
    state: boardLifecycleState(board),
    revision: boardRevision(board),
    updatedAt: board.updatedAt,
  }
}

export function normalizeBoardTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || [...title].length > 120) {
    throw typed('BAD_REQUEST', 'Board title must contain between 1 and 120 characters')
  }
  return title
}

export function requireBaseRevision(body) {
  const baseRevision = body?.baseRevision
  if (!Number.isInteger(baseRevision) || baseRevision < 0) {
    throw typed('BAD_REQUEST', 'baseRevision must be a non-negative integer')
  }
  return baseRevision
}

export function assertBaseRevision(board, baseRevision) {
  if (boardRevision(board) !== baseRevision) {
    throw typed('BOARD_CONFLICT', 'Board changed after this command was prepared')
  }
}

export function assertBoardWritable(board) {
  if (boardLifecycleState(board) !== 'active') {
    throw typed('BOARD_READ_ONLY', 'Archived and trashed boards are read-only')
  }
}

export function renameBoard(board, title) {
  if (boardLifecycleState(board) === 'trashed') {
    throw typed('BOARD_READ_ONLY', 'Trashed boards cannot be renamed')
  }
  board.title = title
}

export function transitionBoardLifecycle(board, command, timestamp) {
  const state = boardLifecycleState(board)
  if (command === 'archive' && state === 'active') {
    board.lifecycle = { state: 'archived', archivedAt: timestamp }
    return
  }
  if (command === 'trash' && (state === 'active' || state === 'archived')) {
    board.lifecycle = { state: 'trashed', trashedAt: timestamp }
    return
  }
  if (command === 'restore' && (state === 'archived' || state === 'trashed')) {
    board.lifecycle = { state: 'active' }
    return
  }
  throw typed('BOARD_CONFLICT', `Board cannot ${command} from ${state}`)
}

export function assertBoardHasNoBlockingRuns(runs, boardId) {
  if (!Array.isArray(runs)) {
    throw typed('RUN_READ_FAILED', 'Run history could not be verified')
  }
  const boardRuns = runs.filter((run) => run?.boardId === boardId)
  if (boardRuns.some((run) => run.status === 'queued' || run.status === 'running')) {
    throw typed('TARGET_BUSY', 'Board still has an active run')
  }
  if (boardRuns.some(
    (run) => run.status === 'succeeded' && run.result?.disposition === 'candidate',
  )) {
    throw typed('CANDIDATE_PENDING', 'Board still has a pending candidate')
  }
}

export function assertBoardPurgeable(board, confirmation) {
  if (confirmation !== 'permanently-delete') {
    throw typed('BOARD_PURGE_INVALID', 'Permanent deletion requires explicit confirmation')
  }
  if (boardLifecycleState(board) !== 'trashed') {
    throw typed('BOARD_PURGE_INVALID', 'Only trashed boards can be permanently deleted')
  }
}
