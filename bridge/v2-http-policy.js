import { isUsableContent } from './domain/content.js'
import { typed } from './domain/errors.js'
export {
  appendRunProgress,
  appendTerminalRunProgress,
  safeRunProgress,
} from './domain/run-progress.js'

export const FALLBACK_SINGLE = [
  { id: 'clarify', label: '提炼问题定义', instruction: '提炼目标用户、核心问题、现有替代和待确认问题', acceptance: '包含用户、场景、问题和不确定性' },
  { id: 'first-draft', label: '形成第一版方案', instruction: '把当前内容推进成一份可继续修改的第一版方案', acceptance: '包含目标、最小形态和待验证问题' },
  { id: 'validation', label: '制定验证计划', instruction: '把当前内容变成一份短周期验证计划', acceptance: '包含动作、证据门槛和停止条件' },
]

export const FALLBACK_MULTI = [
  { id: 'synthesize', label: '综合成一页决策', instruction: '综合全部来源，形成一页可讨论的决策', acceptance: '保留关键事实、约束、取舍和下一步' },
  { id: 'compare', label: '比较并给出选择', instruction: '比较来源中的方案或观点并给出选择依据', acceptance: '包含共同点、差异、判断和风险' },
  { id: 'plan', label: '整理成执行计划', instruction: '把全部来源整理为可执行计划', acceptance: '包含范围、步骤、负责人和成功门槛' },
]

export { typed }

export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running'])

export function normalizeTags(value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) {
    throw typed('BAD_REQUEST', 'tags must be an array with at most 20 items')
  }
  const tags = []
  const seen = new Set()
  for (const valueTag of value) {
    if (typeof valueTag !== 'string') {
      throw typed('BAD_REQUEST', 'Every tag must be a string')
    }
    const tag = valueTag.trim()
    if (!tag || [...tag].length > 32) {
      throw typed('BAD_REQUEST', 'Every tag must contain between 1 and 32 characters')
    }
    const key = tag.toLowerCase()
    if (seen.has(key)) {
      throw typed('BAD_REQUEST', 'Tags must be unique regardless of case')
    }
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

export function normalizeInspirationRef(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw typed('BAD_REQUEST', 'inspirationRef must be an object')
  }
  const normalized = {}
  if ('poolId' in value || 'entryId' in value) {
    throw typed('BAD_REQUEST', 'Pool provenance must be resolved through a verified pool snapshot')
  }
  const fields = ['boardId', 'cardId', 'versionId']
  for (const field of fields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw typed('BAD_REQUEST', `inspirationRef.${field} must be a non-empty string`)
    }
    normalized[field] = value[field].trim()
  }
  return normalized
}

export function normalizeCardPlacement(value) {
  if (value === undefined) return undefined
  if (value !== 'board-bottom') {
    throw typed('BAD_REQUEST', 'Unsupported card placement')
  }
  return value
}

export function resolveCreateCardPlacement(board, input) {
  if (input.placement !== 'board-bottom') return input
  const gap = 32
  let bottom = board.cards.length === 0 ? -gap : Number.NEGATIVE_INFINITY
  for (const card of board.cards) {
    if (
      ![card.x, card.y, card.width, card.height].every(Number.isFinite)
      || card.width <= 0
      || card.height <= 0
    ) {
      throw typed('BOARD_V2_INVALID', 'Existing card geometry cannot be used for automatic placement')
    }
    const cardBottom = card.y + card.height
    if (!Number.isFinite(cardBottom)) {
      throw typed('BOARD_V2_INVALID', 'Existing card geometry overflows automatic placement')
    }
    bottom = Math.max(bottom, cardBottom)
  }
  const y = bottom + gap
  if (!Number.isFinite(y)) {
    throw typed('BOARD_V2_INVALID', 'Automatic card placement is outside the supported range')
  }
  const { placement: _placement, ...positioned } = input
  return {
    ...positioned,
    x: 0,
    y,
    width: 312,
    height: 208,
  }
}

export function nextUpdatedAt(previous, proposed) {
  const previousMs = Date.parse(previous)
  const proposedMs = Date.parse(proposed)
  if (!Number.isFinite(previousMs)) return proposed
  return new Date(Math.max(
    previousMs + 1,
    Number.isFinite(proposedMs) ? proposedMs : previousMs + 1,
  )).toISOString()
}

export function parseSuggestions(output) {
  let parsed
  try {
    parsed = JSON.parse(String(output || '').trim())
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item, index) => ({
      id: typeof item?.id === 'string' ? item.id : `suggestion-${index + 1}`,
      label: String(item?.label || '').trim(),
      instruction: String(item?.instruction || item?.goal || '').trim(),
      acceptance: String(item?.acceptance || item?.accept || '').trim(),
    }))
    .filter((item) => item.label && item.instruction)
    .slice(0, 3)
}

export function cardById(board, cardId) {
  const card = board.cards.find((item) => item.id === cardId)
  if (!card) throw typed('CARD_NOT_FOUND', `Card ${cardId} was not found`)
  return card
}

export function cardIsRelated(board, cardId) {
  return board.transformations.some(
    (item) => item.targetCardId === cardId || item.sourceCardIds.includes(cardId),
  )
}

export function requireNonEmptyBatch(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw typed('BAD_REQUEST', `${field} must contain between 1 and 100 items`)
  }
  return value
}

export function requireUniqueIds(items, field) {
  const ids = items.map((item) =>
    typeof item?.[field] === 'string' ? item[field].trim() : '',
  )
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw typed('BAD_REQUEST', `${field} values must be non-empty and unique`)
  }
  return ids
}

export function transformationById(board, transformationId) {
  const transformation = board.transformations.find((item) => item.id === transformationId)
  if (!transformation) {
    throw typed('TRANSFORMATION_NOT_FOUND', `Transformation ${transformationId} was not found`)
  }
  return transformation
}

export function validateSourceRefs(board, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    throw typed('SOURCE_REQUIRED', 'At least one source is required')
  }
  const seen = new Set()
  for (const sourceRef of sourceRefs) {
    if (!sourceRef || typeof sourceRef.cardId !== 'string' || !sourceRef.cardId.trim()) {
      throw typed('TRANSFORMATION_SOURCE_INVALID', 'Every source requires a card id')
    }
    if (seen.has(sourceRef.cardId)) {
      throw typed('TRANSFORMATION_SOURCE_INVALID', 'A source card cannot appear twice')
    }
    seen.add(sourceRef.cardId)
    const card = cardById(board, sourceRef.cardId)
    if (typeof sourceRef.versionId !== 'string' || !sourceRef.versionId.trim()) {
      throw typed('SOURCE_READ_FAILED', `Source ${sourceRef.cardId} has no usable version`)
    }
    if (card.headVersionId !== sourceRef.versionId) {
      throw typed('SOURCE_VERSION_CHANGED', `Source ${sourceRef.cardId} has changed`)
    }
    const version = card.versions.find((item) => item.id === sourceRef.versionId)
    if (!version || !isUsableContent(version.content)) {
      throw typed('SOURCE_READ_FAILED', `Source ${sourceRef.cardId} has no usable version`)
    }
  }
}

export function buildModelPrompt(transformation, snapshots) {
  return [
    `# 目标\n${transformation.instruction}`,
    `# 验收\n${transformation.acceptance || '结果清晰、具体且可继续编辑'}`,
    ['# 输出规则', '只返回可直接写入成果卡片的正文，不描述执行过程。', '不要提及 agent、会话、工具、report、文件写入或上级代理。', '不要写“已完成”“以下为正文”等交付说明，直接从成果标题或正文开始。'].join('\n'),
    '# 来源',
    ...snapshots.map((snapshot, index) =>
      `## ${index + 1}. ${snapshot.cardId}\n${snapshot.resolvedContent}`,
    ),
  ].join('\n\n')
}
