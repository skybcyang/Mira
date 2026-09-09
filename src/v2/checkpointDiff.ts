import type {
  BoardV2,
  CardVersion,
  ContentCard,
  Transformation,
  TransformationRun,
} from '../domain'
import { cardVersionPreview } from './cardVersions'
import { diffLines, type DiffLine } from '../v2View'

const MAX_INLINE_DIFF_BYTES = 128 * 1024
const MAX_INLINE_DIFF_CELLS = 250_000

function consumeUtf8Budget(value: string, budget: number): number {
  let remaining = budget
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index)
    if (first <= 0x7f) remaining -= 1
    else if (first <= 0x7ff) remaining -= 2
    else if (first >= 0xd800 && first <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      remaining -= 4
      index += 1
    } else remaining -= 3
    if (remaining < 0) return -1
  }
  return remaining
}

function lineCount(value: string): number {
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  return count
}

export function checkpointDiffWithinBudget(before: string, after: string): boolean {
  const remaining = consumeUtf8Budget(before, MAX_INLINE_DIFF_BYTES)
  if (remaining < 0 || consumeUtf8Budget(after, remaining) < 0) return false
  return (lineCount(before) + 1) * (lineCount(after) + 1) <= MAX_INLINE_DIFF_CELLS
}

export interface CheckpointCardContentChange {
  cardId: string
  label: string
  savedHead?: CardVersion
  currentHead?: CardVersion
  hasTextChanges: boolean
}

export interface CheckpointComparable {
  board: BoardV2
  runs: TransformationRun[]
}

export interface BoardCheckpointDiff {
  cards: {
    added: number
    removed: number
    contentChanged: number
    layoutChanged: number
    contentChanges: CheckpointCardContentChange[]
  }
  transformations: {
    added: number
    removed: number
    changed: number
  }
  runs: {
    added: number
    pendingCandidates: number
  }
}

function headDigest(card: ContentCard): string | undefined {
  return card.versions.find((version) => version.id === card.headVersionId)?.digest
}

function headVersion(card: ContentCard) {
  return card.versions.find((version) => version.id === card.headVersionId)
}

function contentChange(saved: ContentCard, current: ContentCard) {
  if (saved.headVersionId === current.headVersionId && headDigest(saved) === headDigest(current)) {
    return null
  }
  const savedHead = headVersion(saved)
  const currentHead = headVersion(current)
  const label = currentHead?.content.kind === 'markdown'
    ? currentHead.content.markdown.trim().split('\n')[0]?.slice(0, 48) || `卡片 ${current.id}`
    : currentHead?.content.kind === 'file-reference'
      ? currentHead.content.path.split('/').pop() || `卡片 ${current.id}`
      : `卡片 ${current.id}`
  return {
    cardId: current.id,
    label,
    ...(savedHead ? { savedHead } : {}),
    ...(currentHead ? { currentHead } : {}),
    hasTextChanges: savedHead?.digest !== currentHead?.digest,
  }
}

export function checkpointCardContentComparison(change: CheckpointCardContentChange): {
  tooLarge: boolean
  lines: DiffLine[]
  emptyMessage?: string
} {
  const before = change.savedHead ? cardVersionPreview(change.savedHead) : ''
  const after = change.currentHead ? cardVersionPreview(change.currentHead) : ''
  if (!checkpointDiffWithinBudget(before, after)) {
    return {
      tooLarge: true,
      lines: [],
      emptyMessage: '正文过长，面板不展开差异；可导出这个画布版本查看。',
    }
  }
  if (!change.hasTextChanges) {
    return {
      tooLarge: false,
      lines: [],
      emptyMessage: 'Head 版本已变化，正文内容相同。',
    }
  }
  return { tooLarge: false, lines: diffLines(before, after) }
}

function layoutChanged(saved: ContentCard, current: ContentCard): boolean {
  return saved.x !== current.x
    || saved.y !== current.y
    || saved.width !== current.width
    || saved.height !== current.height
}

function sameSources(first: string[], second: string[]): boolean {
  return first.length === second.length
    && first.every((sourceId, index) => sourceId === second[index])
}

export function compareCheckpointOrganization(saved: BoardV2, current: BoardV2) {
  const cards = new Map(saved.cards.map((card) => [card.id, card]))
  const groups = new Map((saved.groups || []).map((group) => [group.id, group]))
  const currentGroups = new Map((current.groups || []).map((group) => [group.id, group]))
  return {
    colorsChanged: current.cards.filter((card) => cards.has(card.id) && cards.get(card.id)?.color !== card.color).length,
    groupsAdded: [...currentGroups.keys()].filter((id) => !groups.has(id)).length,
    groupsRemoved: [...groups.keys()].filter((id) => !currentGroups.has(id)).length,
    groupsChanged: [...currentGroups.values()].filter((group) => {
      const before = groups.get(group.id)
      return before && (before.title !== group.title || before.color !== group.color || !sameSources(before.cardIds, group.cardIds))
    }).length,
  }
}

function transformationChanged(
  saved: Transformation,
  current: Transformation,
): boolean {
  return !sameSources(saved.sourceCardIds, current.sourceCardIds)
    || saved.targetCardId !== current.targetCardId
    || saved.label !== current.label
    || saved.instruction !== current.instruction
    || saved.acceptance !== current.acceptance
    || saved.modelId !== current.modelId
}

export function compareCheckpointToCurrent(
  checkpoint: CheckpointComparable,
  currentBoard: BoardV2,
  currentRuns: Record<string, TransformationRun>,
): BoardCheckpointDiff {
  const savedCards = new Map(checkpoint.board.cards.map((card) => [card.id, card]))
  const currentCards = new Map(currentBoard.cards.map((card) => [card.id, card]))
  const sharedCards = checkpoint.board.cards.flatMap((saved) => {
    const current = currentCards.get(saved.id)
    return current ? [{ saved, current }] : []
  })

  const savedTransformations = new Map(
    checkpoint.board.transformations.map((item) => [item.id, item]),
  )
  const currentTransformations = new Map(
    currentBoard.transformations.map((item) => [item.id, item]),
  )
  const savedRunIds = new Set(checkpoint.runs.map((run) => run.id))
  const addedRuns = Object.values(currentRuns).filter((run) => !savedRunIds.has(run.id))
  const contentChanges = sharedCards.flatMap(({ saved, current }) => {
    const change = contentChange(saved, current)
    return change ? [change] : []
  })

  return {
    cards: {
      added: currentBoard.cards.filter((card) => !savedCards.has(card.id)).length,
      removed: checkpoint.board.cards.filter((card) => !currentCards.has(card.id)).length,
      contentChanged: contentChanges.length,
      layoutChanged: sharedCards.filter(({ saved, current }) =>
        layoutChanged(saved, current)).length,
      contentChanges,
    },
    transformations: {
      added: currentBoard.transformations.filter((item) =>
        !savedTransformations.has(item.id)).length,
      removed: checkpoint.board.transformations.filter((item) =>
        !currentTransformations.has(item.id)).length,
      changed: checkpoint.board.transformations.filter((saved) => {
        const current = currentTransformations.get(saved.id)
        return current ? transformationChanged(saved, current) : false
      }).length,
    },
    runs: {
      added: addedRuns.length,
      pendingCandidates: addedRuns.filter((run) =>
        run.status === 'succeeded' && run.result?.disposition === 'candidate').length,
    },
  }
}
