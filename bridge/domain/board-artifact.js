import {
  assertPortableByteLength,
  assertPortableObjectLimits,
  cleanPortableValue,
  normalizePortableBoard,
  portableError,
  utf8JsonByteLength,
  validatePortableBoard,
  validatePortableCurrentRunClosure,
  validatePortableRun,
  validatePortableWorkflow,
  validateWorkspaceRelativePath,
} from './portable-format.js'
import {
  assertUnique as assertUniqueIds,
  isObject,
  nonEmptyString,
} from './guards.js'

function codeFor(operation) {
  return operation === 'export' ? 'BOARD_EXPORT_INVALID' : 'BOARD_IMPORT_INVALID'
}

function fail(operation, message, details) {
  throw portableError(codeFor(operation), message, details)
}

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

const IDENTITY_FIELDS = new Set([
  'id',
  'objectId',
  'boardId',
  'cardId',
  'versionId',
  'fromCardId',
  'toCardId',
  'targetCardId',
  'targetBaseVersionId',
  'transformationId',
  'sourceRunId',
  'restoredFromVersionId',
  'lastRunId',
  'lastAppliedRunId',
  'appliedVersionId',
  'planId',
  'applicationId',
  'workflowId',
  'stepId',
  'inputId',
  'headVersionId',
])

function assertUnique(items, getId, label, operation) {
  return assertUniqueIds(items, getId, label, (message) => fail(operation, message))
}

function validateWorkflowProvenance(snapshot, operation) {
  if (!isObject(snapshot) || !nonEmptyString(snapshot.workflowId)) {
    fail(operation, 'Workflow provenance has an invalid workflowId')
  }
  const errors = validatePortableWorkflow(snapshot, { provenance: true })
  if (errors.length > 0) fail(operation, 'Workflow provenance is invalid', { errors })
  return snapshot
}

function collectFileDependencies(board, operation) {
  const dependencies = new Map()
  const affected = []
  for (const card of board.cards) {
    for (const version of card.versions) {
      if (version.content?.kind !== 'file-reference') continue
      const path = version.content.path
      try {
        validateWorkspaceRelativePath(path)
      } catch {
        affected.push({ cardId: card.id, versionId: version.id, path })
        continue
      }
      dependencies.set(path, (dependencies.get(path) || 0) + 1)
    }
  }
  if (affected.length > 0) {
    fail(operation, 'Board contains unsafe file-reference paths', { affected })
  }
  return [...dependencies.entries()]
    .map(([path, occurrenceCount]) => ({ path, occurrenceCount }))
    .sort((left, right) => stableCompare(left.path, right.path))
}

function canonicalExternalReference(reference) {
  if (reference.kind === 'inspiration') {
    return `inspiration:${JSON.stringify([
      reference.poolId || reference.boardId,
      reference.entryId || reference.cardId,
      reference.versionId,
    ])}`
  }
  if (reference.kind === 'workflow') {
    return `workflow:${JSON.stringify([reference.workflowId, reference.stepId || null])}`
  }
  return `historical:${JSON.stringify([reference.objectKind, reference.objectId])}`
}

function validateExternalReference(reference, operation) {
  if (!isObject(reference)) fail(operation, 'External reference must be an object')
  if (reference.kind === 'inspiration') {
    const fields = reference.poolId || reference.entryId
      ? ['poolId', 'entryId', 'versionId']
      : ['boardId', 'cardId', 'versionId']
    if (!fields.every((field) => nonEmptyString(reference[field]))) {
      fail(operation, 'Inspiration external reference is invalid')
    }
    return
  }
  if (reference.kind === 'workflow') {
    if (!nonEmptyString(reference.workflowId)) fail(operation, 'Workflow external reference is invalid')
    if (reference.stepId !== undefined && !nonEmptyString(reference.stepId)) {
      fail(operation, 'Workflow step external reference is invalid')
    }
    return
  }
  if (reference.kind === 'historical') {
    if (
      !['card', 'version', 'transformation', 'run'].includes(reference.objectKind)
      || !nonEmptyString(reference.objectId)
    ) {
      fail(operation, 'Historical external reference is invalid')
    }
    return
  }
  fail(operation, 'External reference kind is invalid')
}

function deriveExternalReferences({ board, runs, workflowProvenance }) {
  const cardIds = new Set(board.cards.map(({ id }) => id))
  const versionsById = new Map()
  const versionCardIds = new Map()
  for (const card of board.cards) {
    for (const version of card.versions) {
      versionsById.set(version.id, version)
      versionCardIds.set(version.id, card.id)
    }
  }
  const transformationIds = new Set(board.transformations.map(({ id }) => id))
  const runIds = new Set(runs.map(({ id }) => id))
  const provenance = new Map(workflowProvenance.map((item) => [
    item.workflowId,
    new Set(item.steps.map(({ id }) => id)),
  ]))
  const references = new Map()
  const add = (reference) => references.set(canonicalExternalReference(reference), reference)
  const historical = (objectKind, objectId) => {
    if (nonEmptyString(objectId)) add({ kind: 'historical', objectKind, objectId })
  }

  for (const card of board.cards) {
    if (card.inspirationRef) {
      const ref = card.inspirationRef
      const isInternal = ref.boardId === board.id
        && cardIds.has(ref.cardId)
        && versionsById.has(ref.versionId)
        && versionCardIds.get(ref.versionId) === ref.cardId
      if (!isInternal) add({ kind: 'inspiration', ...ref })
    }
    for (const version of card.versions) {
      if (version.sourceRunId && !runIds.has(version.sourceRunId)) {
        historical('run', version.sourceRunId)
      }
      if (version.restoredFromVersionId && !versionsById.has(version.restoredFromVersionId)) {
        historical('version', version.restoredFromVersionId)
      }
    }
  }

  for (const transformation of board.transformations) {
    if (transformation.workflowRef) {
      const workflowSteps = provenance.get(transformation.workflowRef.workflowId)
      if (!workflowSteps) {
        add({
          kind: 'workflow',
          workflowId: transformation.workflowRef.workflowId,
          stepId: transformation.workflowRef.stepId,
        })
      }
    }
  }

  for (const run of runs) {
    if (!transformationIds.has(run.transformationId)) historical('transformation', run.transformationId)
    if (!cardIds.has(run.targetCardId)) historical('card', run.targetCardId)
    if (run.targetBaseVersionId && !versionsById.has(run.targetBaseVersionId)) {
      historical('version', run.targetBaseVersionId)
    }
    for (const snapshot of run.sourceSnapshot) {
      if (!cardIds.has(snapshot.cardId)) historical('card', snapshot.cardId)
      if (!versionsById.has(snapshot.versionId)) historical('version', snapshot.versionId)
    }
    if (run.result?.appliedVersionId && !versionsById.has(run.result.appliedVersionId)) {
      historical('version', run.result.appliedVersionId)
    }
  }

  return [...references.values()].sort((left, right) =>
    stableCompare(canonicalExternalReference(left), canonicalExternalReference(right)))
}

function validateArtifactEnvelope(artifact, operation) {
  if (!isObject(artifact)) fail(operation, 'BoardArtifact must be an object')
  if (artifact.format !== 'mira-board') fail(operation, 'Invalid BoardArtifact format')
  if (artifact.formatVersion !== 1) fail(operation, 'Unsupported BoardArtifact formatVersion')
  if (!nonEmptyString(artifact.exportedAt)) fail(operation, 'BoardArtifact exportedAt is invalid')
  if (!isObject(artifact.board)) fail(operation, 'BoardArtifact board must be an object')
  for (const field of ['runs', 'workflowProvenance', 'fileDependencies', 'externalReferences']) {
    if (!Array.isArray(artifact[field])) fail(operation, `BoardArtifact ${field} must be an array`)
  }
}

function assertExactDependencies(actual, expected, operation) {
  const normalized = actual.map((item) => {
    if (!isObject(item) || !Number.isSafeInteger(item.occurrenceCount) || item.occurrenceCount < 1) {
      fail(operation, 'BoardArtifact file dependency is invalid')
    }
    try {
      validateWorkspaceRelativePath(item.path)
    } catch {
      fail(operation, 'BoardArtifact file dependency path is unsafe', { path: item.path })
    }
    return { path: item.path, occurrenceCount: item.occurrenceCount }
  }).sort((left, right) => stableCompare(left.path, right.path))
  assertUnique(normalized, (item) => item.path, 'file dependency path', operation)
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    fail(operation, 'BoardArtifact file dependencies do not match its file-reference Versions')
  }
}

function assertExactExternalReferences(actual, expected, operation) {
  const seen = new Set()
  for (const reference of actual) {
    validateExternalReference(reference, operation)
    const key = canonicalExternalReference(reference)
    if (seen.has(key)) fail(operation, 'BoardArtifact contains duplicate external references')
    seen.add(key)
  }
  const actualKeys = [...seen].sort(stableCompare)
  const expectedKeys = expected.map(canonicalExternalReference).sort(stableCompare)
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(operation, 'BoardArtifact external references do not match its opaque provenance')
  }
}

export function validateBoardArtifact(artifact, options = {}) {
  const operation = options.operation === 'export' ? 'export' : 'import'
  validateArtifactEnvelope(artifact, operation)

  try {
    validatePortableBoard(artifact.board)
    artifact.runs.forEach((run) => validatePortableRun(run, { terminalOnly: true }))
  } catch (error) {
    fail(operation, error?.message || 'BoardArtifact member is invalid', error?.details)
  }
  artifact.workflowProvenance.forEach((item) => validateWorkflowProvenance(item, operation))

  assertUnique(artifact.board.cards, (item) => item?.id, 'Card', operation)
  assertUnique(
    artifact.board.cards.flatMap((card) => Array.isArray(card?.versions) ? card.versions : []),
    (item) => item?.id,
    'Version',
    operation,
  )
  assertUnique(artifact.board.transformations, (item) => item?.id, 'Transformation', operation)
  const runIds = assertUnique(artifact.runs, (item) => item?.id, 'Run', operation)
  const workflowIds = assertUnique(
    artifact.workflowProvenance,
    (item) => item?.workflowId,
    'workflow provenance',
    operation,
  )

  for (const run of artifact.runs) {
    if (run.boardId !== artifact.board.id) {
      fail(operation, `Run ${run.id} does not belong to the packaged Board`)
    }
  }
  const referencedWorkflowIds = new Set(
    artifact.board.transformations
      .map((transformation) => transformation.workflowRef?.workflowId)
      .filter(Boolean),
  )
  for (const workflowId of workflowIds) {
    if (!referencedWorkflowIds.has(workflowId)) {
      fail(operation, `Workflow provenance ${workflowId} is not referenced by this Board`)
    }
  }
  for (const transformation of artifact.board.transformations) {
    for (const field of ['lastRunId', 'lastAppliedRunId']) {
      if (transformation[field] && !runIds.has(transformation[field])) {
        fail(operation, `Transformation ${transformation.id} ${field} is not packaged`)
      }
    }
    if (transformation.workflowRef && workflowIds.has(transformation.workflowRef.workflowId)) {
      const snapshot = artifact.workflowProvenance.find(
        (item) => item.workflowId === transformation.workflowRef.workflowId,
      )
      if (!snapshot.steps.some(({ id }) => id === transformation.workflowRef.stepId)) {
        fail(operation, `Transformation ${transformation.id} workflow step is not in its provenance`)
      }
    }
  }
  try {
    validatePortableCurrentRunClosure(artifact.board, artifact.runs)
  } catch (error) {
    fail(operation, error?.message || 'BoardArtifact current Run references are invalid', error?.details)
  }

  const dependencies = collectFileDependencies(artifact.board, operation)
  assertExactDependencies(artifact.fileDependencies, dependencies, operation)
  const expectedExternal = deriveExternalReferences(artifact)
  assertExactExternalReferences(artifact.externalReferences, expectedExternal, operation)

  const counts = {
    boards: 1,
    cards: artifact.board.cards.length,
    versions: artifact.board.cards.reduce((total, card) => total + card.versions.length, 0),
    transformations: artifact.board.transformations.length,
    runs: artifact.runs.length,
    workflowProvenance: artifact.workflowProvenance.length,
  }
  assertPortableObjectLimits('mira-board', counts)
  let byteLength = options.byteLength
  if (byteLength === undefined) {
    try {
      byteLength = utf8JsonByteLength(artifact)
    } catch (error) {
      fail(operation, error?.message || 'BoardArtifact is not JSON serializable')
    }
  }
  assertPortableByteLength('mira-board', byteLength)
  return { counts, byteLength }
}

export function projectBoardArtifact({
  board,
  runs,
  workflowProvenance = [],
  exportedAt,
} = {}) {
  try {
    if (!isObject(board) || !Array.isArray(runs) || !Array.isArray(workflowProvenance)) {
      throw portableError('BOARD_EXPORT_INVALID', 'Board export projection input is invalid')
    }
    const portableBoard = normalizePortableBoard(board)
    const portableRuns = cleanPortableValue(runs)
    const portableWorkflows = cleanPortableValue(workflowProvenance)
    const artifact = {
      format: 'mira-board',
      formatVersion: 1,
      exportedAt,
      board: portableBoard,
      runs: portableRuns,
      workflowProvenance: portableWorkflows,
      fileDependencies: collectFileDependencies(portableBoard, 'export'),
      externalReferences: [],
    }
    artifact.externalReferences = deriveExternalReferences(artifact)
    validateBoardArtifact(artifact, { operation: 'export' })
    return artifact
  } catch (error) {
    if (error?.code === 'BOARD_EXPORT_INVALID' || error?.code === 'PAYLOAD_TOO_LARGE') throw error
    throw portableError(
      'BOARD_EXPORT_INVALID',
      error?.message || 'Board export projection input is invalid',
      error?.details,
    )
  }
}

function collectOriginalIdentities(value, identities = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOriginalIdentities(item, identities))
    return identities
  }
  if (!isObject(value)) return identities
  for (const [key, item] of Object.entries(value)) {
    if (IDENTITY_FIELDS.has(key) && nonEmptyString(item)) identities.add(item)
    if (key === 'sourceCardIds' && Array.isArray(item)) {
      item.filter(nonEmptyString).forEach((id) => identities.add(id))
    }
    collectOriginalIdentities(item, identities)
  }
  return identities
}

function freshIdentityFactory(generateId, operation, forbidden) {
  if (typeof generateId !== 'function') fail(operation, 'BoardArtifact import requires an ID generator')
  const used = new Set()
  return (kind, oldId) => {
    const id = generateId(kind, oldId)
    if (
      !nonEmptyString(id)
      || id.includes('/')
      || id.includes('..')
      || used.has(id)
      || forbidden.has(id)
    ) {
      fail(operation, `ID generator returned an invalid or duplicate ${kind} identity`)
    }
    used.add(id)
    return id
  }
}

function addMap(map, values, allocate, kind, getId = (value) => value.id) {
  for (const value of values) {
    const oldId = getId(value)
    map.set(oldId, allocate(kind, oldId))
  }
}

export function remapBoardArtifact(artifact, { generateId, now = () => new Date().toISOString() } = {}) {
  validateBoardArtifact(artifact)
  const operation = 'import'
  const { relations: _legacyRelations, ...boardWithoutRelations } = artifact.board
  const allocate = freshIdentityFactory(
    generateId,
    operation,
    collectOriginalIdentities({ ...artifact, board: boardWithoutRelations }),
  )
  const boardId = allocate('board', artifact.board.id)
  const cardIds = new Map()
  const groupIds = new Map()
  const versionIds = new Map()
  const transformationIds = new Map()
  const runIds = new Map()
  const planApplicationIds = new Map()
  const workflowIds = new Map()
  const workflowInputIds = new Map()
  const workflowStepIds = new Map()
  addMap(cardIds, artifact.board.cards, allocate, 'card')
  addMap(groupIds, artifact.board.groups || [], allocate, 'group')
  addMap(versionIds, artifact.board.cards.flatMap(({ versions }) => versions), allocate, 'version')
  addMap(transformationIds, artifact.board.transformations, allocate, 'transformation')
  addMap(runIds, artifact.runs, allocate, 'run')

  const planApplicationOldIds = new Set()
  for (const transformation of artifact.board.transformations) {
    if (transformation.planRef) planApplicationOldIds.add(transformation.planRef.planId)
    if (transformation.workflowRef) planApplicationOldIds.add(transformation.workflowRef.applicationId)
  }
  for (const oldId of planApplicationOldIds) {
    planApplicationIds.set(oldId, allocate('plan-application', oldId))
  }
  for (const workflow of artifact.workflowProvenance) {
    workflowIds.set(workflow.workflowId, allocate('workflow-provenance', workflow.workflowId))
    for (const input of workflow.inputs || []) {
      const key = JSON.stringify([workflow.workflowId, input.id])
      workflowInputIds.set(key, allocate('workflow-input-provenance', input.id))
    }
    for (const step of workflow.steps) {
      const key = JSON.stringify([workflow.workflowId, step.id])
      workflowStepIds.set(key, allocate('workflow-step-provenance', step.id))
    }
  }

  const externalHistorical = new Map()
  const externalBoards = new Map()
  const externalCards = new Map()
  const externalVersions = new Map()
  const externalWorkflows = new Map()
  const externalWorkflowSteps = new Map()
  const mapMissing = (objectKind, oldId) => {
    const owned = {
      card: cardIds,
      version: versionIds,
      transformation: transformationIds,
      run: runIds,
    }[objectKind]
    if (owned?.has(oldId)) return owned.get(oldId)
    const key = JSON.stringify([objectKind, oldId])
    if (!externalHistorical.has(key)) {
      externalHistorical.set(key, allocate(`external-${objectKind}`, oldId))
    }
    return externalHistorical.get(key)
  }
  const mapInspiration = (ref) => {
    if (ref.poolId || ref.entryId) {
      return {
        poolId: allocate('external-inspiration-pool', ref.poolId),
        entryId: allocate('external-inspiration-entry', ref.entryId),
        versionId: allocate('external-inspiration-version', ref.versionId),
      }
    }
    const internal = ref.boardId === artifact.board.id
      && cardIds.has(ref.cardId)
      && versionIds.has(ref.versionId)
      && artifact.board.cards.some((card) =>
        card.id === ref.cardId && card.versions.some((version) => version.id === ref.versionId))
    if (internal) {
      return { boardId, cardId: cardIds.get(ref.cardId), versionId: versionIds.get(ref.versionId) }
    }
    if (!externalBoards.has(ref.boardId)) {
      externalBoards.set(ref.boardId, allocate('external-inspiration-board', ref.boardId))
    }
    const cardKey = JSON.stringify([ref.boardId, ref.cardId])
    if (!externalCards.has(cardKey)) {
      externalCards.set(cardKey, allocate('external-inspiration-card', ref.cardId))
    }
    const versionKey = JSON.stringify([ref.boardId, ref.cardId, ref.versionId])
    if (!externalVersions.has(versionKey)) {
      externalVersions.set(versionKey, allocate('external-inspiration-version', ref.versionId))
    }
    return {
      boardId: externalBoards.get(ref.boardId),
      cardId: externalCards.get(cardKey),
      versionId: externalVersions.get(versionKey),
    }
  }
  const mapWorkflowRef = (ref) => {
    if (workflowIds.has(ref.workflowId)) {
      return {
        workflowId: workflowIds.get(ref.workflowId),
        stepId: workflowStepIds.get(JSON.stringify([ref.workflowId, ref.stepId])),
        applicationId: planApplicationIds.get(ref.applicationId),
      }
    }
    if (!externalWorkflows.has(ref.workflowId)) {
      externalWorkflows.set(ref.workflowId, allocate('external-workflow', ref.workflowId))
    }
    const stepKey = JSON.stringify([ref.workflowId, ref.stepId])
    if (!externalWorkflowSteps.has(stepKey)) {
      externalWorkflowSteps.set(stepKey, allocate('external-workflow-step', ref.stepId))
    }
    return {
      workflowId: externalWorkflows.get(ref.workflowId),
      stepId: externalWorkflowSteps.get(stepKey),
      applicationId: planApplicationIds.get(ref.applicationId),
    }
  }

  const importedAt = now()
  if (!nonEmptyString(importedAt)) fail(operation, 'BoardArtifact import time is invalid')
  const remappedBoard = {
    ...cleanPortableValue(artifact.board),
    id: boardId,
    revision: 0,
    lifecycle: { state: 'active' },
    createdAt: importedAt,
    updatedAt: importedAt,
  }
  delete remappedBoard.relations
  if (artifact.board.groups) {
    remappedBoard.groups = artifact.board.groups.map((group) => ({
      ...group,
      id: groupIds.get(group.id),
      cardIds: group.cardIds.map((id) => cardIds.get(id)),
    }))
  }
  remappedBoard.cards = artifact.board.cards.map((card) => {
    const remappedCard = {
      ...cleanPortableValue(card),
      id: cardIds.get(card.id),
      headVersionId: card.headVersionId === null ? null : versionIds.get(card.headVersionId),
      ...(card.inspirationRef ? { inspirationRef: mapInspiration(card.inspirationRef) } : {}),
      versions: card.versions.map((version) => ({
        ...cleanPortableValue(version),
        id: versionIds.get(version.id),
        cardId: cardIds.get(card.id),
        ...(version.sourceRunId
          ? { sourceRunId: mapMissing('run', version.sourceRunId) }
          : {}),
        ...(version.restoredFromVersionId
          ? { restoredFromVersionId: mapMissing('version', version.restoredFromVersionId) }
          : {}),
      })),
    }
    delete remappedCard.fileBinding
    return remappedCard
  })
  remappedBoard.transformations = artifact.board.transformations.map((transformation) => ({
    ...cleanPortableValue(transformation),
    id: transformationIds.get(transformation.id),
    sourceCardIds: transformation.sourceCardIds.map((id) => cardIds.get(id)),
    targetCardId: cardIds.get(transformation.targetCardId),
    ...(transformation.planRef ? {
      planRef: {
        ...cleanPortableValue(transformation.planRef),
        planId: planApplicationIds.get(transformation.planRef.planId),
      },
    } : {}),
    ...(transformation.workflowRef ? { workflowRef: mapWorkflowRef(transformation.workflowRef) } : {}),
    ...(transformation.lastRunId ? { lastRunId: runIds.get(transformation.lastRunId) } : {}),
    ...(transformation.lastAppliedRunId
      ? { lastAppliedRunId: runIds.get(transformation.lastAppliedRunId) }
      : {}),
  }))

  const remappedRuns = artifact.runs.map((run) => ({
    ...cleanPortableValue(run),
    id: runIds.get(run.id),
    boardId,
    transformationId: mapMissing('transformation', run.transformationId),
    sourceSnapshot: run.sourceSnapshot.map((snapshot) => ({
      ...cleanPortableValue(snapshot),
      cardId: mapMissing('card', snapshot.cardId),
      versionId: mapMissing('version', snapshot.versionId),
    })),
    targetCardId: mapMissing('card', run.targetCardId),
    targetBaseVersionId: run.targetBaseVersionId === null
      ? null
      : mapMissing('version', run.targetBaseVersionId),
    ...(run.result ? {
      result: {
        ...cleanPortableValue(run.result),
        ...(run.result.appliedVersionId
          ? { appliedVersionId: mapMissing('version', run.result.appliedVersionId) }
          : {}),
      },
    } : {}),
  }))

  const remappedWorkflows = artifact.workflowProvenance.map((workflow) => ({
    ...cleanPortableValue(workflow),
    workflowId: workflowIds.get(workflow.workflowId),
    ...(workflow.inputs ? {
      inputs: workflow.inputs.map((input) => ({
        ...cleanPortableValue(input),
        id: workflowInputIds.get(JSON.stringify([workflow.workflowId, input.id])),
      })),
    } : {}),
    steps: workflow.steps.map((step) => ({
      ...cleanPortableValue(step),
      id: workflowStepIds.get(JSON.stringify([workflow.workflowId, step.id])),
      ...(step.sources ? {
        sources: step.sources.map((source) => source.kind === 'input'
          ? {
              ...cleanPortableValue(source),
              inputId: workflowInputIds.get(JSON.stringify([workflow.workflowId, source.inputId])),
            }
          : cleanPortableValue(source)),
      } : {}),
    })),
  }))

  const remapped = {
    format: 'mira-board',
    formatVersion: 1,
    exportedAt: artifact.exportedAt,
    board: remappedBoard,
    runs: remappedRuns,
    workflowProvenance: remappedWorkflows,
    fileDependencies: cleanPortableValue(artifact.fileDependencies),
    externalReferences: [],
  }
  remapped.externalReferences = deriveExternalReferences(remapped)
  validateBoardArtifact(remapped)
  return remapped
}
