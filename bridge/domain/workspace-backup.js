import { validateBoardCheckpoint } from './board-checkpoint.js'
import { assertUnique as assertUniqueIds, isObject, nonEmptyString } from './guards.js'
import {
  MIRA_BACKUP_LIMITS,
  assertPortableByteLength,
  assertPortableObjectLimits,
  cleanPortableValue,
  collectForbiddenPortableData,
  countPortableBoards,
  normalizePortableBoard,
  portableError,
  utf8JsonByteLength,
  validatePortableBoard,
  validatePortableCurrentRunClosure,
  validatePortableRun,
  validatePortableWorkflow,
} from './portable-format.js'

function assertUnique(items, getId, label) {
  return assertUniqueIds(items, getId, label, (message) => {
    throw portableError('BACKUP_INVALID', message)
  })
}

function validateBackupEnvelope(backup) {
  if (!isObject(backup)) throw portableError('BACKUP_INVALID', 'MiraBackup must be an object')
  if (backup.format !== 'mira-backup') throw portableError('BACKUP_INVALID', 'Invalid MiraBackup format')
  if (![1, 2].includes(backup.formatVersion)) {
    throw portableError('BACKUP_INVALID', 'Unsupported MiraBackup formatVersion')
  }
  if (!nonEmptyString(backup.exportedAt)) {
    throw portableError('BACKUP_INVALID', 'MiraBackup exportedAt is invalid')
  }
  for (const field of ['boards', 'runs', 'workflows']) {
    if (!Array.isArray(backup[field])) {
      throw portableError('BACKUP_INVALID', `MiraBackup ${field} must be an array`)
    }
  }
  if (backup.inspirationPool !== undefined && !isObject(backup.inspirationPool)) {
    throw portableError('BACKUP_INVALID', 'MiraBackup inspirationPool must be an object')
  }
  if (backup.formatVersion === 2 && !Array.isArray(backup.checkpoints)) {
    throw portableError('BACKUP_INVALID', 'MiraBackup checkpoints must be an array')
  }
}

function validatePortableInspirationPool(pool) {
  const errors = []
  if (pool.schemaVersion !== 1 || pool.id !== 'inspiration-pool') {
    errors.push('InspirationPool schema is invalid')
  }
  if (!Array.isArray(pool.entries)) errors.push('InspirationPool entries are invalid')
  if (!nonEmptyString(pool.createdAt) || !nonEmptyString(pool.updatedAt)) {
    errors.push('InspirationPool timestamps are invalid')
  }
  const entryIds = new Set()
  const versionIds = new Set()
  for (const entry of pool.entries || []) {
    if (!isObject(entry) || !nonEmptyString(entry.id) || entryIds.has(entry.id)) {
      errors.push('InspirationPool entry ID is invalid or duplicated')
      continue
    }
    entryIds.add(entry.id)
    if (!Array.isArray(entry.versions) || entry.versions.length === 0) {
      errors.push(`InspirationPool entry ${entry.id} versions are invalid`)
      continue
    }
    if (!nonEmptyString(entry.headVersionId) || !entry.versions.some((version) => version?.id === entry.headVersionId)) {
      errors.push(`InspirationPool entry ${entry.id} head version is invalid`)
    }
    if (!nonEmptyString(entry.createdAt) || !nonEmptyString(entry.updatedAt)) {
      errors.push(`InspirationPool entry ${entry.id} timestamps are invalid`)
    }
    entry.versions.forEach((version, index) => {
      if (
        !isObject(version)
        || !nonEmptyString(version.id)
        || versionIds.has(version.id)
        || version.entryId !== entry.id
        || version.sequence !== index + 1
        || !isObject(version.content)
        || version.content.kind !== 'markdown'
        || !nonEmptyString(version.content.markdown)
        || !nonEmptyString(version.digest)
        || !nonEmptyString(version.createdAt)
        || !['human', 'restore', 'import'].includes(version.origin)
      ) {
        errors.push(`InspirationPool entry ${entry.id} contains an invalid version`)
        return
      }
      versionIds.add(version.id)
    })
  }
  if (errors.length > 0) {
    throw portableError('PORTABLE_DATA_INVALID', 'InspirationPool is invalid for portable data', { errors })
  }
  return pool
}

export function validateWorkspaceBackup(backup, options = {}) {
  validateBackupEnvelope(backup)
  const checkpoints = backup.formatVersion === 2 ? backup.checkpoints : []
  const boardIds = assertUnique(backup.boards, (item) => item?.id, 'Board')
  assertUnique(backup.runs, (item) => item?.id, 'Run')
  assertUnique(backup.workflows, (item) => item?.id, 'WorkflowTemplate')
  assertUnique(checkpoints, (item) => item?.id, 'BoardCheckpoint')

  try {
    backup.boards.forEach(validatePortableBoard)
    backup.runs.forEach((item) => validatePortableRun(item, { terminalOnly: true }))
    for (const item of backup.workflows) {
      const errors = validatePortableWorkflow(item)
      if (errors.length > 0) {
        throw portableError('PORTABLE_DATA_INVALID', 'WorkflowTemplate is invalid', { errors })
      }
      const forbidden = collectForbiddenPortableData(item)
      if (forbidden.length > 0) {
        throw portableError('PORTABLE_DATA_INVALID', 'WorkflowTemplate contains excluded data', {
          errors: forbidden,
        })
      }
    }
    if (backup.inspirationPool !== undefined) validatePortableInspirationPool(backup.inspirationPool)
    checkpoints.forEach((checkpoint, index) => {
      const forbidden = collectForbiddenPortableData(
        checkpoint?.artifact,
        `$.checkpoints[${index}].artifact`,
      )
      if (forbidden.length > 0) {
        throw portableError(
          'PORTABLE_DATA_INVALID',
          'BoardCheckpoint artifact contains excluded data',
          { errors: forbidden },
        )
      }
      validateBoardCheckpoint(checkpoint)
    })
  } catch (error) {
    if (error?.code === 'BACKUP_INVALID') throw error
    throw portableError('BACKUP_INVALID', error?.message || 'MiraBackup member is invalid', error?.details)
  }

  for (const item of backup.runs) {
    if (!boardIds.has(item.boardId)) {
      throw portableError(
        'BACKUP_INVALID',
        `Run ${item.id} must belong to exactly one packaged Board`,
      )
    }
  }
  const checkpointCountsByBoard = new Map()
  for (const item of checkpoints) {
    if (!boardIds.has(item.boardId)) {
      throw portableError(
        'BACKUP_INVALID',
        `BoardCheckpoint ${item.id} must belong to exactly one packaged Board`,
      )
    }
    const count = (checkpointCountsByBoard.get(item.boardId) || 0) + 1
    checkpointCountsByBoard.set(item.boardId, count)
    if (count > MIRA_BACKUP_LIMITS.checkpointsPerBoard) {
      throw portableError('BACKUP_TOO_LARGE', 'mira-backup exceeds its checkpoints limit', {
        category: 'checkpoints',
        actual: count,
        limit: MIRA_BACKUP_LIMITS.checkpointsPerBoard,
        boardId: item.boardId,
      })
    }
  }
  try {
    const runsByBoard = new Map()
    for (const run of backup.runs) {
      const boardRuns = runsByBoard.get(run.boardId) || []
      boardRuns.push(run)
      runsByBoard.set(run.boardId, boardRuns)
    }
    for (const board of backup.boards) {
      validatePortableCurrentRunClosure(board, runsByBoard.get(board.id) || [])
    }
  } catch (error) {
    throw portableError('BACKUP_INVALID', error?.message || 'MiraBackup references are invalid', error?.details)
  }

  const counts = {
    ...countPortableBoards(backup.boards),
    runs: backup.runs.length,
    workflows: backup.workflows.length,
    checkpoints: checkpoints.length,
    ...(backup.inspirationPool ? { inspirationEntries: backup.inspirationPool.entries.length } : {}),
  }
  assertPortableObjectLimits('mira-backup', counts)
  let byteLength = options.byteLength
  if (byteLength === undefined) {
    try {
      byteLength = utf8JsonByteLength(backup)
    } catch (error) {
      throw portableError('BACKUP_INVALID', error?.message || 'MiraBackup is not JSON serializable')
    }
  }
  assertPortableByteLength('mira-backup', byteLength)
  return { counts, byteLength }
}

export function projectWorkspaceBackup({
  boards,
  runs,
  workflows,
  inspirationPool,
  checkpoints = [],
  exportedAt,
} = {}) {
  try {
    if (
      !Array.isArray(boards)
      || !Array.isArray(runs)
      || !Array.isArray(workflows)
      || !Array.isArray(checkpoints)
    ) {
      throw portableError(
        'BACKUP_INVALID',
        'Backup projection requires Board, Run, Workflow and BoardCheckpoint arrays',
      )
    }
    const backup = {
      format: 'mira-backup',
      formatVersion: 2,
      exportedAt,
      boards: boards.map(normalizePortableBoard),
      runs: cleanPortableValue(runs),
      workflows: cleanPortableValue(workflows),
      ...(inspirationPool !== undefined ? { inspirationPool: cleanPortableValue(inspirationPool) } : {}),
      checkpoints: cleanPortableValue(checkpoints),
    }
    validateWorkspaceBackup(backup)
    return backup
  } catch (error) {
    if (error?.code === 'BACKUP_INVALID' || error?.code === 'BACKUP_TOO_LARGE') throw error
    throw portableError(
      'BACKUP_INVALID',
      error?.message || 'Backup projection input is invalid',
      error?.details,
    )
  }
}
