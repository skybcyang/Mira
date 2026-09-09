import type { NodeChange } from '@xyflow/react'
import type { BoardV2, ContentCard, TransformationRun } from './domain'
import { TRANSFORMATION_NODE_WIDTH } from './v2Projection'

const TRANSFORMATION_GAP = TRANSFORMATION_NODE_WIDTH + 32 * 2
const BRANCH_CARD_WIDTH = 360
const BRANCH_CARD_HEIGHT = 240
const BRANCH_CARD_CLEARANCE = 32
const BRANCH_CARD_STEP = BRANCH_CARD_HEIGHT + BRANCH_CARD_CLEARANCE

export function orderedSelection(
  previous: string[],
  changes: NodeChange[],
  contentCardIds: Set<string>,
): string[] {
  const selected = previous.filter((id) => contentCardIds.has(id))
  for (const change of changes) {
    if (change.type !== 'select' || !('id' in change) || !contentCardIds.has(change.id)) continue
    const index = selected.indexOf(change.id)
    if (change.selected && index < 0) selected.push(change.id)
    if (!change.selected && index >= 0) selected.splice(index, 1)
  }
  return selected
}

export function sourceRefsFor(board: BoardV2, cardIds: string[]) {
  return cardIds.map((cardId) => {
    const card = board.cards.find((item) => item.id === cardId)
    if (!card?.headVersionId) throw new Error(`Card ${cardId} has no committed version`)
    return { cardId, versionId: card.headVersionId }
  })
}

export function targetPositionForSelection(board: BoardV2, cardIds: string[]) {
  const cards = cardIds
    .map((id) => board.cards.find((card) => card.id === id))
    .filter((card): card is BoardV2['cards'][number] => Boolean(card))
  if (cards.length === 0) return { x: 120, y: 120 }
  return {
    x: Math.max(...cards.map((card) => card.x + card.width)) + TRANSFORMATION_GAP,
    y: cards.reduce((sum, card) => sum + card.y, 0) / cards.length,
  }
}

export function collisionFreeBranchOrigin(
  board: BoardV2,
  cardIds: string[],
  branchCount: number,
  requested = targetPositionForSelection(board, cardIds),
) {
  const count = Math.max(1, Math.floor(branchCount))
  let y = requested.y
  while (true) {
    const collides = Array.from({ length: count }, (_item, index) => ({
      x: requested.x,
      y: y + index * BRANCH_CARD_STEP,
      width: BRANCH_CARD_WIDTH,
      height: BRANCH_CARD_HEIGHT,
    })).some((candidate) => board.cards.some((card) =>
      candidate.x + candidate.width + BRANCH_CARD_CLEARANCE > card.x
      && card.x + card.width + BRANCH_CARD_CLEARANCE > candidate.x
      && candidate.y + candidate.height + BRANCH_CARD_CLEARANCE > card.y
      && card.y + card.height + BRANCH_CARD_CLEARANCE > candidate.y
    ))
    if (!collides) return { x: requested.x, y }
    y += BRANCH_CARD_STEP
  }
}

export type TransformationDependencyOrder = {
  transformationIds: string[]
  reason: null | 'not-found' | 'cycle'
}

export type TransformationExecutionDecision =
  | { kind: 'run'; reason: 'empty-target' | 'stale' }
  | { kind: 'current' }
  | { kind: 'candidate'; reason: string }
  | { kind: 'sources-unavailable'; reason: string }
  | { kind: 'tracking-unavailable'; reason: string }

function usableHead(card: ContentCard | undefined): boolean {
  if (!card?.headVersionId) return false
  const version = card.versions.find((item) => item.id === card.headVersionId)
  if (!version) return false
  return version.content.kind === 'markdown'
    ? Boolean(version.content.markdown.trim())
    : Boolean(version.content.path.trim())
}

export function transformationDependencyOrder(
  board: BoardV2,
  transformationId: string,
): TransformationDependencyOrder {
  const target = board.transformations.find((item) => item.id === transformationId)
  if (!target) return { transformationIds: [], reason: 'not-found' }
  const producers = new Map(board.transformations.map((item) => [item.targetCardId, item]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: string[] = []
  let cycle = false

  const visit = (id: string) => {
    if (cycle || visited.has(id)) return
    if (visiting.has(id)) {
      cycle = true
      return
    }
    const transformation = board.transformations.find((item) => item.id === id)
    if (!transformation) return
    visiting.add(id)
    for (const sourceCardId of transformation.sourceCardIds) {
      const producer = producers.get(sourceCardId)
      if (producer) visit(producer.id)
    }
    visiting.delete(id)
    visited.add(id)
    ordered.push(id)
  }

  visit(target.id)
  return cycle
    ? { transformationIds: [], reason: 'cycle' }
    : { transformationIds: ordered, reason: null }
}

export function transformationExecutionDecision(
  board: BoardV2,
  runs: Record<string, TransformationRun>,
  transformationId: string,
): TransformationExecutionDecision {
  const transformation = board.transformations.find((item) => item.id === transformationId)
  if (!transformation) return { kind: 'sources-unavailable', reason: transformationId }
  const latestRun = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
  if (transformation.lastRunId && !latestRun) {
    return { kind: 'tracking-unavailable', reason: transformation.lastRunId }
  }
  if (latestRun && (latestRun.status === 'queued' || latestRun.status === 'running')) {
    return { kind: 'tracking-unavailable', reason: latestRun.id }
  }
  if (latestRun?.status === 'succeeded' && latestRun.result?.disposition === 'candidate') {
    return { kind: 'candidate', reason: latestRun.id }
  }
  for (const sourceCardId of transformation.sourceCardIds) {
    if (!usableHead(board.cards.find((card) => card.id === sourceCardId))) {
      return { kind: 'sources-unavailable', reason: sourceCardId }
    }
  }
  const target = board.cards.find((card) => card.id === transformation.targetCardId)
  if (!usableHead(target)) return { kind: 'run', reason: 'empty-target' }

  const appliedRun = transformation.lastAppliedRunId
    ? runs[transformation.lastAppliedRunId]
    : latestRun?.status === 'succeeded' && latestRun.result?.disposition === 'applied'
      ? latestRun
      : undefined
  if (transformation.lastAppliedRunId && !appliedRun) {
    return { kind: 'tracking-unavailable', reason: transformation.lastAppliedRunId }
  }
  if (!appliedRun) return { kind: 'current' }
  const snapshotCardIds = appliedRun.sourceSnapshot.map((snapshot) => snapshot.cardId)
  const structureChanged = transformation.sourceCardIds.length !== snapshotCardIds.length
    || transformation.sourceCardIds.some((cardId, index) => cardId !== snapshotCardIds[index])
  const sourceChanged = appliedRun.sourceSnapshot.some((snapshot) =>
    board.cards.find((card) => card.id === snapshot.cardId)?.headVersionId !== snapshot.versionId)
  return structureChanged || sourceChanged
    ? { kind: 'run', reason: 'stale' }
    : { kind: 'current' }
}
