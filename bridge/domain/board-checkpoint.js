import { validateBoardArtifact } from './board-artifact.js'
import { isObject, nonEmptyString } from './guards.js'
import { typed } from './errors.js'

const CHECKPOINT_FIELDS = new Set([
  'schemaVersion',
  'id',
  'boardId',
  'title',
  'note',
  'baseBoardRevision',
  'artifact',
  'createdAt',
  'metadataUpdatedAt',
])

function checkpointInvalid(message, details) {
  throw typed('CHECKPOINT_INVALID', message, details)
}

function safeId(value, field) {
  if (
    !nonEmptyString(value)
    || value === '.'
    || value.includes('..')
    || /[\u0000-\u001f\u007f/\\]/u.test(value)
  ) {
    checkpointInvalid(`BoardCheckpoint ${field} is invalid`)
  }
  return value
}

export function normalizeCheckpointTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || [...title].length > 80) checkpointInvalid('BoardCheckpoint title is invalid')
  return title
}

export function normalizeCheckpointNote(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') checkpointInvalid('BoardCheckpoint note is invalid')
  const note = value.trim()
  if ([...note].length > 240) checkpointInvalid('BoardCheckpoint note is invalid')
  return note || undefined
}

export function validateBoardCheckpoint(checkpoint) {
  if (!isObject(checkpoint) || checkpoint.schemaVersion !== 1) {
    checkpointInvalid('BoardCheckpoint schema is invalid')
  }
  if (Object.keys(checkpoint).some((field) => !CHECKPOINT_FIELDS.has(field))) {
    checkpointInvalid('BoardCheckpoint fields are invalid')
  }
  safeId(checkpoint.id, 'id')
  safeId(checkpoint.boardId, 'boardId')
  if (normalizeCheckpointTitle(checkpoint.title) !== checkpoint.title) {
    checkpointInvalid('BoardCheckpoint title is not normalized')
  }
  if (Object.prototype.hasOwnProperty.call(checkpoint, 'note')) {
    const note = normalizeCheckpointNote(checkpoint.note)
    if (note === undefined || note !== checkpoint.note) {
      checkpointInvalid('BoardCheckpoint note is not normalized')
    }
  }
  if (!Number.isSafeInteger(checkpoint.baseBoardRevision) || checkpoint.baseBoardRevision < 0) {
    checkpointInvalid('BoardCheckpoint baseBoardRevision is invalid')
  }
  if (!nonEmptyString(checkpoint.createdAt) || !nonEmptyString(checkpoint.metadataUpdatedAt)) {
    checkpointInvalid('BoardCheckpoint timestamps are invalid')
  }
  try {
    validateBoardArtifact(checkpoint.artifact)
  } catch (error) {
    const code = error?.code === 'PAYLOAD_TOO_LARGE' ? 'CHECKPOINT_TOO_LARGE' : 'CHECKPOINT_INVALID'
    throw typed(code, `BoardCheckpoint artifact is invalid: ${error?.message || error}`, error?.details)
  }
  if (checkpoint.artifact.board.id !== checkpoint.boardId) {
    checkpointInvalid('BoardCheckpoint boardId does not match its artifact')
  }
  const revision = Number.isSafeInteger(checkpoint.artifact.board.revision)
    ? checkpoint.artifact.board.revision
    : 0
  if (revision !== checkpoint.baseBoardRevision) {
    checkpointInvalid('BoardCheckpoint baseBoardRevision does not match its artifact')
  }
  return checkpoint
}

export function checkpointSummary(checkpoint) {
  validateBoardCheckpoint(checkpoint)
  return {
    id: checkpoint.id,
    boardId: checkpoint.boardId,
    title: checkpoint.title,
    ...(checkpoint.note !== undefined ? { note: checkpoint.note } : {}),
    baseBoardRevision: checkpoint.baseBoardRevision,
    counts: {
      cards: checkpoint.artifact.board.cards.length,
      transformations: checkpoint.artifact.board.transformations.length,
      runs: checkpoint.artifact.runs.length,
    },
    createdAt: checkpoint.createdAt,
    metadataUpdatedAt: checkpoint.metadataUpdatedAt,
  }
}
