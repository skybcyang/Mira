import type { BoardV2, SourceSnapshot, Transformation, TransformationRun } from '../domain'
import { headVersion, sourceCardPresentations } from '../v2View'

export interface SourceComparisonRow {
  cardId: string
  title: string
  currentVersionLabel: string
  historicalVersionLabel: string
  status: 'same' | 'changed' | 'added' | 'removed' | 'reordered' | 'unknown'
  currentOrder?: number
  historicalOrder?: number
  snapshot?: SourceSnapshot
}

export function sourceComparisonRows(
  board: BoardV2,
  transformation: Transformation,
  run?: TransformationRun,
): SourceComparisonRow[] {
  const applied = run?.id === transformation.lastAppliedRunId
    && run?.boardId === board.id && run?.transformationId === transformation.id
    && run?.targetCardId === transformation.targetCardId
    && run?.status === 'succeeded' && run?.result?.disposition === 'applied'
    ? run : undefined
  const snapshots = applied?.sourceSnapshot || []
  const currentIds = transformation.sourceCardIds
  const ids = [...currentIds, ...snapshots.filter((item) => !currentIds.includes(item.cardId)).map((item) => item.cardId)]
  const cards = new Map(board.cards.map((card) => [card.id, card]))
  const titles = new Map(sourceCardPresentations(board.cards).map((item) => [item.cardId, item.label]))
  return ids.map((cardId) => {
    const card = cards.get(cardId)
    const head = card ? headVersion(card) : undefined
    const currentIndex = currentIds.indexOf(cardId)
    const historicalIndex = snapshots.findIndex((item) => item.cardId === cardId)
    const snapshot = snapshots[historicalIndex]
    const historicalVersion = card?.versions.find((version) => version.id === snapshot?.versionId)
    let status: SourceComparisonRow['status'] = 'unknown'
    if (currentIndex < 0 && snapshot) status = 'removed'
    else if (head && applied) {
      if (!snapshot) status = 'added'
      else if (head.id !== snapshot.versionId || head.content.kind !== snapshot.contentKind) status = 'changed'
      else if (head.content.kind === 'markdown' && (
        head.digest !== snapshot.digest || head.content.markdown !== snapshot.resolvedContent
      )) status = 'changed'
      else if (currentIndex !== historicalIndex) status = 'reordered'
      else if (head.content.kind === 'markdown') status = 'same'
    }
    return {
      cardId,
      title: titles.get(cardId) || snapshot?.resolvedContent.split('\n').find((line) => line.trim())?.replace(/^#{1,6}\s+/, '').slice(0, 80) || cardId,
      currentVersionLabel: head ? `v${head.sequence}` : '不可用',
      historicalVersionLabel: historicalVersion ? `v${historicalVersion.sequence}` : snapshot?.versionId || '无已采用输入',
      status,
      ...(currentIndex >= 0 ? { currentOrder: currentIndex + 1 } : {}),
      ...(historicalIndex >= 0 ? { historicalOrder: historicalIndex + 1, snapshot } : {}),
    }
  })
}
