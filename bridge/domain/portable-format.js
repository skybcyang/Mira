import { validateBoardV2 } from './validation.js'
import { runProgressErrors } from './run-progress.js'
import {
  isObject,
  nonEmptyString,
} from './guards.js'

const MIB = 1024 * 1024
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'interrupted'])
const ALL_RUN_STATUSES = new Set(['queued', 'running', ...TERMINAL_RUN_STATUSES])
const RUN_DISPOSITIONS = new Set(['applied', 'candidate', 'discarded'])
const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'token',
  'rootsessionid',
  'password',
  'secret',
  'clientsecret',
  'privatekey',
])
const FILE_CONTENT_KEYS = new Set(['kind', 'path', 'readonly'])

export const BOARD_ARTIFACT_LIMITS = Object.freeze({
  maxBytes: 64 * MIB,
  boards: 1,
  cards: 10_000,
  versions: 100_000,
  transformations: 50_000,
  runs: 100_000,
  workflowProvenance: 1_000,
})

export const MIRA_BACKUP_LIMITS = Object.freeze({
  maxBytes: 256 * MIB,
  boards: 1_000,
  cards: 100_000,
  versions: 1_000_000,
  transformations: 500_000,
  runs: 1_000_000,
  workflows: 10_000,
  inspirationEntries: 100_000,
  checkpoints: 20_000,
  checkpointsPerBoard: 20,
})

export function portableError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function normalizedSensitiveKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function formatCodes(format) {
  if (format === 'mira-board') {
    return { invalid: 'BOARD_IMPORT_INVALID', tooLarge: 'PAYLOAD_TOO_LARGE' }
  }
  if (format === 'mira-backup') {
    return { invalid: 'BACKUP_INVALID', tooLarge: 'BACKUP_TOO_LARGE' }
  }
  throw portableError('PORTABLE_FORMAT_INVALID', `Unsupported portable format: ${format}`)
}

export function utf8JsonByteLength(value) {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw portableError(
      'PORTABLE_SERIALIZATION_INVALID',
      `Portable data could not be serialized: ${error?.message || error}`,
    )
  }
  if (serialized === undefined) {
    throw portableError('PORTABLE_SERIALIZATION_INVALID', 'Portable data is not JSON serializable')
  }
  return new TextEncoder().encode(serialized).length
}

export function assertPortableByteLength(format, byteLength) {
  const { invalid, tooLarge } = formatCodes(format)
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw portableError(invalid, 'Portable byte length must be a non-negative safe integer')
  }
  const limit = format === 'mira-board'
    ? BOARD_ARTIFACT_LIMITS.maxBytes
    : MIRA_BACKUP_LIMITS.maxBytes
  if (byteLength > limit) {
    throw portableError(tooLarge, `${format} exceeds its UTF-8 JSON byte limit`, {
      category: 'bytes',
      actual: byteLength,
      limit,
    })
  }
  return byteLength
}

export function assertPortableObjectLimits(format, counts) {
  const { invalid, tooLarge } = formatCodes(format)
  if (!isObject(counts)) throw portableError(invalid, 'Portable object counts are invalid')
  const limits = format === 'mira-board' ? BOARD_ARTIFACT_LIMITS : MIRA_BACKUP_LIMITS
  for (const [category, actual] of Object.entries(counts)) {
    if (category === 'maxBytes') continue
    if (!Object.prototype.hasOwnProperty.call(limits, category)) {
      throw portableError(invalid, `Unknown portable object count: ${category}`)
    }
    if (!Number.isSafeInteger(actual) || actual < 0) {
      throw portableError(invalid, `Portable object count ${category} is invalid`)
    }
    const limit = limits[category]
    if (actual > limit) {
      throw portableError(tooLarge, `${format} exceeds its ${category} limit`, {
        category,
        actual,
        limit,
      })
    }
  }
  return counts
}

export function validateWorkspaceRelativePath(path) {
  const invalid = () => {
    throw portableError('PORTABLE_PATH_INVALID', `Unsafe workspace-relative path: ${path}`)
  }
  if (!nonEmptyString(path) || path.includes('\0') || path.includes('\\')) invalid()
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) invalid()
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) invalid()
  return path
}

export function cleanPortableValue(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw portableError('PORTABLE_SERIALIZATION_INVALID', 'Portable data contains a cycle')
    }
    seen.add(value)
    const result = value.map((item) => cleanPortableValue(item, seen))
    seen.delete(value)
    return result
  }
  if (!isObject(value)) return value
  if (seen.has(value)) {
    throw portableError('PORTABLE_SERIALIZATION_INVALID', 'Portable data contains a cycle')
  }
  seen.add(value)
  const fileContent = value.kind === 'file-reference'
  const fileSnapshot = value.contentKind === 'file-reference'
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(normalizedSensitiveKey(key))) continue
    if (fileContent && !FILE_CONTENT_KEYS.has(key)) continue
    if (fileSnapshot && key === 'resolvedContent') continue
    if (item !== undefined) result[key] = cleanPortableValue(item, seen)
  }
  seen.delete(value)
  return result
}

export function normalizePortableBoard(board) {
  const normalized = cleanPortableValue(board)
  normalized.cards?.forEach((card) => { delete card.fileBinding })
  delete normalized.relations
  if (normalized.revision === undefined) normalized.revision = 0
  if (normalized.lifecycle === undefined) normalized.lifecycle = { state: 'active' }
  return normalized
}

export function collectForbiddenPortableData(value, path = '$', findings = [], seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      findings.push(`${path} contains a cycle`)
      return findings
    }
    seen.add(value)
    value.forEach((item, index) => collectForbiddenPortableData(item, `${path}[${index}]`, findings, seen))
    seen.delete(value)
    return findings
  }
  if (!isObject(value)) return findings
  if (seen.has(value)) {
    findings.push(`${path} contains a cycle`)
    return findings
  }
  seen.add(value)
  const fileContent = value.kind === 'file-reference'
  const fileSnapshot = value.contentKind === 'file-reference'
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`
    if (SENSITIVE_KEYS.has(normalizedSensitiveKey(key))) findings.push(`${itemPath} is secret data`)
    if (fileContent && !FILE_CONTENT_KEYS.has(key)) findings.push(`${itemPath} is file body data`)
    if (fileSnapshot && key === 'resolvedContent') findings.push(`${itemPath} is file body data`)
    collectForbiddenPortableData(item, itemPath, findings, seen)
  }
  seen.delete(value)
  return findings
}

function validateLifecycle(board, errors) {
  if (board.revision !== undefined && (!Number.isSafeInteger(board.revision) || board.revision < 0)) {
    errors.push('Board revision is invalid')
  }
  if (board.lifecycle !== undefined) {
    if (!isObject(board.lifecycle) || !['active', 'archived', 'trashed'].includes(board.lifecycle.state)) {
      errors.push('Board lifecycle is invalid')
    } else {
      for (const field of ['archivedAt', 'trashedAt']) {
        if (board.lifecycle[field] !== undefined && !nonEmptyString(board.lifecycle[field])) {
          errors.push(`Board lifecycle ${field} is invalid`)
        }
      }
    }
  }
}

export function validatePortableBoard(board) {
  const errors = []
  if (!isObject(board)) {
    throw portableError('PORTABLE_DATA_INVALID', 'Board must be an object')
  }
  errors.push(...validateBoardV2(board))
  if (!nonEmptyString(board.id)) errors.push('Board id is invalid')
  if (typeof board.title !== 'string' || !board.title.trim() || [...board.title].length > 120) {
    errors.push('Board title is invalid')
  }
  validateLifecycle(board, errors)
  if (
    !isObject(board.viewport)
    || !Number.isFinite(board.viewport.x)
    || !Number.isFinite(board.viewport.y)
    || !Number.isFinite(board.viewport.zoom)
    || board.viewport.zoom <= 0
  ) {
    errors.push('Board viewport is invalid')
  }
  if (!nonEmptyString(board.createdAt)) errors.push('Board createdAt is invalid')
  if (!nonEmptyString(board.updatedAt)) errors.push('Board updatedAt is invalid')

  for (const card of Array.isArray(board.cards) ? board.cards : []) {
    if (
      !Number.isFinite(card?.x)
      || !Number.isFinite(card?.y)
      || !Number.isFinite(card?.width)
      || card.width <= 0
      || !Number.isFinite(card?.height)
      || card.height <= 0
    ) {
      errors.push(`Card ${card?.id || '<missing>'} geometry is invalid`)
    }
    if (!nonEmptyString(card?.createdAt) || !nonEmptyString(card?.updatedAt)) {
      errors.push(`Card ${card?.id || '<missing>'} timestamps are invalid`)
    }
    for (const item of Array.isArray(card?.versions) ? card.versions : []) {
      if (!nonEmptyString(item?.digest) || !nonEmptyString(item?.createdAt)) {
        errors.push(`Version ${item?.id || '<missing>'} metadata is invalid`)
      }
      if (item?.content?.kind === 'file-reference') {
        try {
          validateWorkspaceRelativePath(item.content.path)
        } catch {
          errors.push(`Version ${item?.id || '<missing>'} has an unsafe file path`)
        }
      }
    }
  }
  errors.push(...collectForbiddenPortableData(board))
  if (errors.length > 0) {
    throw portableError('PORTABLE_DATA_INVALID', 'Board is invalid for portable data', { errors })
  }
  return board
}

export function validatePortableRun(run, { terminalOnly = false } = {}) {
  const errors = []
  if (!isObject(run)) {
    throw portableError('PORTABLE_DATA_INVALID', 'Run must be an object')
  }
  for (const field of ['id', 'boardId', 'transformationId', 'targetCardId', 'createdAt']) {
    if (!nonEmptyString(run[field])) errors.push(`Run ${field} is invalid`)
  }
  if (!ALL_RUN_STATUSES.has(run.status)) errors.push('Run status is invalid')
  if (terminalOnly && !TERMINAL_RUN_STATUSES.has(run.status)) errors.push('Run must be terminal')
  if (!Array.isArray(run.sourceSnapshot)) {
    errors.push('Run sourceSnapshot must be an array')
  } else {
    const cards = new Set()
    for (const snapshot of run.sourceSnapshot) {
      if (!isObject(snapshot)) {
        errors.push('Run sourceSnapshot item is invalid')
        continue
      }
      if (!nonEmptyString(snapshot.cardId) || cards.has(snapshot.cardId)) {
        errors.push('Run sourceSnapshot cardId is invalid or duplicated')
      }
      cards.add(snapshot.cardId)
      if (!nonEmptyString(snapshot.versionId)) errors.push('Run sourceSnapshot versionId is invalid')
      if (!['markdown', 'file-reference'].includes(snapshot.contentKind)) {
        errors.push('Run sourceSnapshot contentKind is invalid')
      }
      if (!nonEmptyString(snapshot.digest)) errors.push('Run sourceSnapshot digest is invalid')
      if (snapshot.contentKind === 'markdown' && typeof snapshot.resolvedContent !== 'string') {
        errors.push('Markdown Run sourceSnapshot content is invalid')
      }
      if (
        snapshot.contentKind === 'file-reference'
        && Object.prototype.hasOwnProperty.call(snapshot, 'resolvedContent')
      ) {
        errors.push('File Run sourceSnapshot must not contain file body data')
      }
    }
  }
  if (run.targetBaseVersionId !== null && !nonEmptyString(run.targetBaseVersionId)) {
    errors.push('Run targetBaseVersionId is invalid')
  }
  if (!['create', 'update'].includes(run.intent)) errors.push('Run intent is invalid')
  if (run.modelSnapshot !== undefined && (
    !isObject(run.modelSnapshot)
    || !nonEmptyString(run.modelSnapshot.provider)
    || !nonEmptyString(run.modelSnapshot.model)
  )) {
    errors.push('Run modelSnapshot is invalid')
  }
  if (run.status === 'succeeded') {
    if (
      !isObject(run.result)
      || typeof run.result.output !== 'string'
      || !nonEmptyString(run.result.digest)
      || !RUN_DISPOSITIONS.has(run.result.disposition)
      || (run.result.appliedVersionId !== undefined && !nonEmptyString(run.result.appliedVersionId))
    ) {
      errors.push('Succeeded Run result is invalid')
    }
  }
  if (run.error !== undefined && (
    !isObject(run.error)
    || !nonEmptyString(run.error.code)
    || typeof run.error.message !== 'string'
    || typeof run.error.retryable !== 'boolean'
  )) {
    errors.push('Run error is invalid')
  }
  errors.push(...runProgressErrors(run))
  for (const field of ['startedAt', 'finishedAt']) {
    if (run[field] !== undefined && !nonEmptyString(run[field])) errors.push(`Run ${field} is invalid`)
  }
  errors.push(...collectForbiddenPortableData(run))
  if (errors.length > 0) {
    throw portableError('PORTABLE_DATA_INVALID', 'Run is invalid for portable data', { errors })
  }
  return run
}

export function validatePortableCurrentRunClosure(board, runs) {
  const errors = []
  const runById = new Map(runs.map((run) => [run.id, run]))
  const cards = new Map(board.cards.map((card) => [card.id, card]))
  const versions = new Map()
  for (const card of board.cards) {
    for (const version of card.versions) versions.set(version.id, card.id)
  }
  const owners = new Map()
  const lastRunOwners = new Map()
  for (const transformation of board.transformations) {
    for (const field of ['lastRunId', 'lastAppliedRunId']) {
      const runId = transformation[field]
      if (!runId) continue
      if (!runById.has(runId)) {
        errors.push(`Transformation ${transformation.id} ${field} is not packaged`)
        continue
      }
      if (field === 'lastRunId') {
        const currentOwners = lastRunOwners.get(runId) || []
        currentOwners.push(transformation)
        lastRunOwners.set(runId, currentOwners)
      }
      const owner = owners.get(runId)
      if (owner && owner.transformation.id !== transformation.id) {
        errors.push(`Run ${runId} is current for more than one Transformation`)
        continue
      }
      owners.set(runId, {
        transformation,
        lastApplied: owner?.lastApplied || field === 'lastAppliedRunId',
      })
    }
  }

  for (const run of runs) {
    if (run.status !== 'succeeded' || run.result?.disposition !== 'candidate') continue
    const candidateOwners = lastRunOwners.get(run.id) || []
    if (
      candidateOwners.length !== 1
      || candidateOwners[0].id !== run.transformationId
    ) {
      errors.push(
        `Pending Candidate Run ${run.id} must be owned by its matching Transformation lastRunId`,
      )
    }
  }

  for (const [runId, { transformation, lastApplied }] of owners) {
    const run = runById.get(runId)
    if (run.transformationId !== transformation.id) {
      errors.push(`Current Run ${runId} has a dangling Transformation reference`)
    }
    if (run.targetCardId !== transformation.targetCardId || !cards.has(run.targetCardId)) {
      errors.push(`Current Run ${runId} has a dangling target Card reference`)
    }
    for (const snapshot of run.sourceSnapshot) {
      if (!cards.has(snapshot.cardId) || versions.get(snapshot.versionId) !== snapshot.cardId) {
        errors.push(`Current Run ${runId} has a dangling source snapshot reference`)
      }
    }
    if (
      run.targetBaseVersionId !== null
      && versions.get(run.targetBaseVersionId) !== run.targetCardId
    ) {
      errors.push(`Current Run ${runId} has a dangling target base Version reference`)
    }
    if (run.result?.appliedVersionId !== undefined) {
      if (versions.get(run.result.appliedVersionId) !== run.targetCardId) {
        errors.push(`Current Run ${runId} has a dangling applied Version reference`)
      }
    } else if (run.result?.disposition === 'applied') {
      errors.push(`Current applied Run ${runId} is missing its applied Version reference`)
    }
    if (lastApplied && run.result?.disposition !== 'applied') {
      errors.push(`Transformation ${transformation.id} lastAppliedRunId is not applied`)
    }
  }
  if (errors.length > 0) {
    throw portableError('PORTABLE_DATA_INVALID', 'Current Run references are invalid', { errors })
  }
  return runs
}

export function validatePortableWorkflow(workflow, { provenance = false } = {}) {
  const errors = []
  if (!isObject(workflow)) return ['Workflow must be an object']
  const identity = provenance ? workflow.workflowId : workflow.id
  if (!nonEmptyString(identity)) errors.push('Workflow identity is invalid')
  if (!nonEmptyString(workflow.title)) errors.push('Workflow title is invalid')
  if (typeof workflow.description !== 'string') errors.push('Workflow description is invalid')

  const hasInputs = Object.prototype.hasOwnProperty.call(workflow, 'inputs')
  const inputIds = new Set()
  if (hasInputs) {
    if (!Array.isArray(workflow.inputs) || workflow.inputs.length === 0) {
      errors.push('Workflow requires at least one input')
    } else {
      for (const input of workflow.inputs) {
        if (!isObject(input) || !nonEmptyString(input.id) || inputIds.has(input.id)) {
          errors.push(`Workflow input identity is invalid or duplicated: ${input?.id}`)
          continue
        }
        inputIds.add(input.id)
        if (!nonEmptyString(input.name)) errors.push(`Workflow input ${input.id} name is invalid`)
        if (typeof input.description !== 'string') {
          errors.push(`Workflow input ${input.id} description is invalid`)
        }
        if (typeof input.required !== 'boolean') {
          errors.push(`Workflow input ${input.id} required flag is invalid`)
        }
        if (!['one', 'many'].includes(input.cardinality)) {
          errors.push(`Workflow input ${input.id} cardinality is invalid`)
        }
      }
    }
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('Workflow requires at least one step')
  } else {
    const stepIds = new Set()
    workflow.steps.forEach((step, index) => {
      if (!isObject(step) || !nonEmptyString(step.id) || stepIds.has(step.id)) {
        errors.push(`Workflow step identity is invalid or duplicated: ${step?.id}`)
        return
      }
      stepIds.add(step.id)
      if (!nonEmptyString(step.label)) errors.push(`Workflow step ${step.id} label is invalid`)
      if (!nonEmptyString(step.instruction)) {
        errors.push(`Workflow step ${step.id} instruction is invalid`)
      }
      if (typeof step.acceptance !== 'string') {
        errors.push(`Workflow step ${step.id} acceptance is invalid`)
      }
      if (step.modelId !== undefined && !nonEmptyString(step.modelId)) {
        errors.push(`Workflow step ${step.id} modelId is invalid`)
      }
      const hasSources = Object.prototype.hasOwnProperty.call(step, 'sources')
      if (hasSources !== hasInputs) {
        errors.push(`Workflow step ${step.id} source contract is incomplete`)
      } else if (hasSources) {
        if (!Array.isArray(step.sources) || step.sources.length === 0) {
          errors.push(`Workflow step ${step.id} requires at least one source`)
          return
        }
        let previousOutputCount = 0
        for (const source of step.sources) {
          if (source?.kind === 'previous-output') {
            previousOutputCount += 1
          } else if (source?.kind === 'input' && nonEmptyString(source.inputId)) {
            if (!inputIds.has(source.inputId)) {
              errors.push(`Workflow step ${step.id} references an unknown input: ${source.inputId}`)
            }
          } else {
            errors.push(`Workflow step ${step.id} source is invalid`)
          }
        }
        if ((index === 0 && previousOutputCount !== 0) || (index > 0 && previousOutputCount !== 1)) {
          errors.push(`Workflow step ${step.id} previous-output source is invalid`)
        }
      }
    })
  }

  if (!provenance) {
    if (!nonEmptyString(workflow.createdAt)) errors.push('Workflow createdAt is invalid')
    if (!nonEmptyString(workflow.updatedAt)) errors.push('Workflow updatedAt is invalid')
  }
  errors.push(...collectForbiddenPortableData(workflow))
  return errors
}

export function countPortableBoards(boards) {
  return boards.reduce((counts, board) => {
    counts.boards += 1
    counts.cards += board.cards.length
    counts.versions += board.cards.reduce((total, card) => total + card.versions.length, 0)
    counts.transformations += board.transformations.length
    return counts
  }, { boards: 0, cards: 0, versions: 0, transformations: 0 })
}
