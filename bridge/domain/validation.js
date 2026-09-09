import { isCardColor, validateGroups } from './organization.js'
import { normalizeCardName } from './card-name.js'

const CONTENT_KINDS = new Set(['markdown', 'file-reference'])
const VERSION_ORIGINS = new Set(['human', 'ai', 'restore', 'import'])
const MAX_CARD_TAGS = 20
const MAX_TAG_LENGTH = 32

function isValidContent(content) {
  return (
    (content?.kind === 'markdown' && typeof content.markdown === 'string') ||
    (content?.kind === 'file-reference' &&
      typeof content.path === 'string' &&
      content.path.length > 0 &&
      typeof content.readonly === 'boolean')
  )
}

function hasValidTags(tags) {
  if (!Array.isArray(tags) || tags.length > MAX_CARD_TAGS) return false
  const seen = new Set()
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag !== tag.trim()) return false
    if (tag.length === 0 || [...tag].length > MAX_TAG_LENGTH) return false
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

function hasValidInspirationRef(inspirationRef) {
  if (inspirationRef === null || typeof inspirationRef !== 'object' || Array.isArray(inspirationRef)) return false
  const hasBoardRef = ['boardId', 'cardId', 'versionId'].every(
    (field) => typeof inspirationRef[field] === 'string' && Boolean(inspirationRef[field].trim()),
  )
  const hasPoolRef = ['poolId', 'entryId', 'versionId'].every(
    (field) => typeof inspirationRef[field] === 'string' && Boolean(inspirationRef[field].trim()),
  )
  return hasBoardRef || hasPoolRef
}

function hasValidFileBinding(binding, card) {
  return (
    binding !== null &&
    typeof binding === 'object' &&
    !Array.isArray(binding) &&
    typeof binding.path === 'string' &&
    binding.path.length > 0 &&
    !binding.path.includes('\0') &&
    !binding.path.startsWith('/') &&
    !binding.path.includes('\\') &&
    !binding.path.split('/').some((part) => !part || part === '.' || part === '..') &&
    typeof binding.lastSyncedVersionId === 'string' &&
    Boolean(binding.lastSyncedVersionId.trim()) &&
    card.versions.some((version) => version.id === binding.lastSyncedVersionId && version.content?.kind === 'markdown') &&
    typeof binding.lastSyncedFileDigest === 'string' &&
    Boolean(binding.lastSyncedFileDigest.trim()) &&
    typeof binding.lastSyncedAt === 'string' &&
    Boolean(binding.lastSyncedAt.trim())
  )
}

export function validateBoardV2(board) {
  const errors = []
  if (!board || board.schemaVersion !== 2) {
    return ['board schemaVersion must be 2']
  }
  if (Object.prototype.hasOwnProperty.call(board, 'legacy')) {
    errors.push('board legacy graph is not supported')
  }
  if (
    typeof board.title !== 'string'
    || board.title !== board.title.trim()
    || [...board.title].length < 1
    || [...board.title].length > 120
  ) {
    errors.push('board title is invalid')
  }
  if (
    board.revision !== undefined
    && (!Number.isInteger(board.revision) || board.revision < 0)
  ) {
    errors.push('board revision is invalid')
  }
  if (board.lifecycle !== undefined) {
    const lifecycle = board.lifecycle
    const invalidTimestamp = (field) =>
      lifecycle[field] !== undefined
      && (typeof lifecycle[field] !== 'string' || !lifecycle[field].trim())
    if (
      !lifecycle
      || typeof lifecycle !== 'object'
      || Array.isArray(lifecycle)
      || !['active', 'archived', 'trashed'].includes(lifecycle.state)
      || invalidTimestamp('archivedAt')
      || invalidTimestamp('trashedAt')
    ) {
      errors.push('board lifecycle is invalid')
    }
  }
  if (!Array.isArray(board.cards)) errors.push('board must have cards[]')
  if (!Array.isArray(board.transformations)) errors.push('board must have transformations[]')
  if (errors.length > 0) return errors

  const cardIds = new Set()
  const versionIds = new Set()
  const fileBindingPaths = new Set()
  for (const card of board.cards) {
    if (!card || typeof card.id !== 'string' || card.id.length === 0) {
      errors.push('card missing id')
      continue
    }
    if (cardIds.has(card.id)) errors.push(`duplicate card id: ${card.id}`)
    cardIds.add(card.id)
    if (card.name !== undefined) {
      try {
        if (normalizeCardName(card.name) !== card.name) errors.push(`card ${card.id} has invalid name`)
      } catch { errors.push(`card ${card.id} has invalid name`) }
    }
    if (!CONTENT_KINDS.has(card.contentKind)) {
      errors.push(`card ${card.id} has invalid content kind`)
    }
    if (card.tags !== undefined && !hasValidTags(card.tags)) {
      errors.push(`card ${card.id} has invalid tags`)
    }
    if (Object.prototype.hasOwnProperty.call(card, 'color') && !isCardColor(card.color)) {
      errors.push(`card ${card.id} has invalid color`)
    }
    if (card.inspirationRef !== undefined && !hasValidInspirationRef(card.inspirationRef)) {
      errors.push(`card ${card.id} has invalid inspirationRef`)
    }
    if (card.fileBinding !== undefined && (
      card.contentKind !== 'markdown' || !hasValidFileBinding(card.fileBinding, card)
    )) {
      errors.push(`card ${card.id} has invalid fileBinding`)
    } else if (card.fileBinding) {
      if (fileBindingPaths.has(card.fileBinding.path)) {
        errors.push(`duplicate fileBinding path: ${card.fileBinding.path}`)
      }
      fileBindingPaths.add(card.fileBinding.path)
    }
    if (!Array.isArray(card.versions)) {
      errors.push(`card ${card.id} must have versions[]`)
      continue
    }
    if (card.headVersionId === null && card.versions.length > 0) {
      errors.push(`card ${card.id} has versions but no head`)
    }
    if (
      card.headVersionId !== null &&
      !card.versions.some((version) => version.id === card.headVersionId)
    ) {
      errors.push(`card ${card.id} head version missing: ${card.headVersionId}`)
    }

    card.versions.forEach((version, index) => {
      if (!version || typeof version.id !== 'string' || version.id.length === 0) {
        errors.push(`card ${card.id} has a version without id`)
        return
      }
      if (versionIds.has(version.id)) errors.push(`duplicate version id: ${version.id}`)
      versionIds.add(version.id)
      if (version.cardId !== card.id) {
        errors.push(`version ${version.id} belongs to another card: ${version.cardId}`)
      }
      if (version.sequence !== index + 1) {
        errors.push(`card ${card.id} version sequence must start at 1 and increase by 1`)
      }
      if (version.content?.kind !== card.contentKind) {
        errors.push(`version ${version.id} content kind does not match card ${card.id}`)
      }
      if (!isValidContent(version.content)) {
        errors.push(`version ${version.id} has invalid content`)
      }
      if (!VERSION_ORIGINS.has(version.origin)) {
        errors.push(`version ${version.id} has invalid origin`)
      }
      if (version.origin === 'ai' && !version.sourceRunId) {
        errors.push(`AI version ${version.id} requires sourceRunId`)
      }
      if (version.origin === 'restore' && !version.restoredFromVersionId) {
        errors.push(`restored version ${version.id} requires restoredFromVersionId`)
      }
    })
  }

  if (Object.prototype.hasOwnProperty.call(board, 'groups')) errors.push(...validateGroups(board.groups, cardIds))

  const transformationIds = new Set()
  const planGroups = new Map()
  for (const transformation of board.transformations) {
    if (
      !transformation ||
      typeof transformation.id !== 'string' ||
      transformation.id.length === 0
    ) {
      errors.push('transformation missing id')
      continue
    }
    if (transformationIds.has(transformation.id)) {
      errors.push(`duplicate transformation id: ${transformation.id}`)
    }
    transformationIds.add(transformation.id)
    if (
      !Array.isArray(transformation.sourceCardIds) ||
      transformation.sourceCardIds.length === 0
    ) {
      errors.push(`transformation ${transformation.id} requires at least one source`)
      continue
    }
    if (new Set(transformation.sourceCardIds).size !== transformation.sourceCardIds.length) {
      errors.push(`transformation ${transformation.id} has a duplicate source`)
    }
    for (const sourceCardId of transformation.sourceCardIds) {
      if (!cardIds.has(sourceCardId)) {
        errors.push(`transformation ${transformation.id} source missing: ${sourceCardId}`)
      }
      if (sourceCardId === transformation.targetCardId) {
        errors.push(`transformation ${transformation.id} source and target must differ`)
      }
    }
    if (!cardIds.has(transformation.targetCardId)) {
      errors.push(
        `transformation ${transformation.id} target missing: ${transformation.targetCardId}`,
      )
    }
    const hasX = Object.prototype.hasOwnProperty.call(transformation, 'x')
    const hasY = Object.prototype.hasOwnProperty.call(transformation, 'y')
    if (hasX !== hasY || (hasX && (!Number.isFinite(transformation.x) || !Number.isFinite(transformation.y)))) {
      errors.push(`transformation ${transformation.id} has invalid position`)
    }
    if (typeof transformation.label !== 'string' || !transformation.label.trim()) {
      errors.push(`transformation ${transformation.id} missing label`)
    }
    if (typeof transformation.instruction !== 'string' || !transformation.instruction.trim()) {
      errors.push(`transformation ${transformation.id} missing instruction`)
    }
    if (typeof transformation.acceptance !== 'string') {
      errors.push(`transformation ${transformation.id} has invalid acceptance`)
    }
    if (
      Object.prototype.hasOwnProperty.call(transformation, 'modelId')
      && (typeof transformation.modelId !== 'string' || !transformation.modelId.trim())
    ) {
      errors.push(`transformation ${transformation.id} has invalid modelId`)
    }
    if (typeof transformation.permissions?.workspaceWrite !== 'boolean') {
      errors.push(`transformation ${transformation.id} has invalid permissions`)
    }
    const planRef = transformation.planRef
    const validPlanRef =
      planRef === undefined ||
      (planRef &&
        typeof planRef.planId === 'string' &&
        Boolean(planRef.planId.trim()) &&
        (planRef.source === 'ad-hoc' || planRef.source === 'template') &&
        typeof planRef.title === 'string' &&
        Boolean(planRef.title.trim()) &&
        Number.isInteger(planRef.stepIndex) &&
        Number.isInteger(planRef.stepTotal) &&
        planRef.stepIndex >= 1 &&
        planRef.stepTotal >= 1 &&
        planRef.stepIndex <= planRef.stepTotal &&
        (planRef.adjusted === undefined || typeof planRef.adjusted === 'boolean') &&
        (planRef.source !== 'template' ||
          planRef.planId === transformation.workflowRef?.applicationId) &&
        (planRef.source !== 'ad-hoc' || transformation.workflowRef === undefined))
    if (!validPlanRef) {
      errors.push(`transformation ${transformation.id} has invalid planRef`)
    } else if (planRef) {
      const group = planGroups.get(planRef.planId)
      if (!group) {
        planGroups.set(planRef.planId, {
          source: planRef.source,
          title: planRef.title,
          stepTotal: planRef.stepTotal,
          stepIndexes: new Set([planRef.stepIndex]),
          workflowId: planRef.source === 'template'
            ? transformation.workflowRef?.workflowId
            : undefined,
          workflowStepIds: new Set(planRef.source === 'template'
            ? [transformation.workflowRef?.stepId]
            : []),
        })
      } else {
        const inconsistent =
          group.source !== planRef.source ||
          group.title !== planRef.title ||
          group.stepTotal !== planRef.stepTotal ||
          group.stepIndexes.has(planRef.stepIndex) ||
          (planRef.source === 'template' && (
            group.workflowId !== transformation.workflowRef?.workflowId ||
            group.workflowStepIds.has(transformation.workflowRef?.stepId)
          ))
        if (inconsistent && !errors.includes(`plan ${planRef.planId} has inconsistent planRef`)) {
          errors.push(`plan ${planRef.planId} has inconsistent planRef`)
        }
        group.stepIndexes.add(planRef.stepIndex)
        if (planRef.source === 'template') {
          group.workflowStepIds.add(transformation.workflowRef?.stepId)
        }
      }
    }
    for (const field of ['lastRunId', 'lastAppliedRunId']) {
      if (
        transformation[field] !== undefined &&
        (typeof transformation[field] !== 'string' || !transformation[field].trim())
      ) {
        errors.push(`transformation ${transformation.id} has invalid ${field}`)
      }
    }
    if (
      transformation.workflowRef !== undefined &&
      (!transformation.workflowRef ||
        typeof transformation.workflowRef.workflowId !== 'string' ||
        !transformation.workflowRef.workflowId ||
        typeof transformation.workflowRef.stepId !== 'string' ||
        !transformation.workflowRef.stepId ||
        typeof transformation.workflowRef.applicationId !== 'string' ||
        !transformation.workflowRef.applicationId)
    ) {
      errors.push(`transformation ${transformation.id} has invalid workflowRef`)
    }
  }

  return errors
}
