import type { BoardV2, Transformation, TransformationRun } from '../domain'
import { cardHeadHasUsableContent } from '../workflows'

export function sourceEditBlock(board: BoardV2, transformation: Transformation, runs: Record<string, TransformationRun>): string | null {
  if (board.lifecycle && board.lifecycle.state !== 'active') return '当前画板只读。'
  const related = Object.values(runs).filter(run => run.boardId === board.id)
  if (related.some(run => run.targetCardId === transformation.targetCardId && (run.status === 'queued' || run.status === 'running'))) {
    return '正在生成，请结束运行后再修改来源。'
  }
  if (related.some(run => run.transformationId === transformation.id && run.status === 'succeeded' && run.result?.disposition === 'candidate')) {
    return '请先采用或丢弃待比较结果，再修改来源。'
  }
  return null
}

export function sourceListError(board: BoardV2, transformation: Transformation, sourceCardIds: string[]): string | null {
  if (!sourceCardIds.length) return '至少保留一个来源。'
  if (new Set(sourceCardIds).size !== sourceCardIds.length) return '来源不能重复。'
  if (sourceCardIds.includes(transformation.targetCardId)) return '目标卡不能作为自身来源。'
  if (sourceCardIds.some(id => !cardHeadHasUsableContent(board, id))) return '来源不存在或尚无可用内容。'
  const downstream = new Map<string, string[]>()
  for (const step of board.transformations) {
    if (step.id === transformation.id) continue
    for (const source of step.sourceCardIds) downstream.set(source, [...(downstream.get(source) || []), step.targetCardId])
  }
  const proposed = new Set(sourceCardIds)
  const visited = new Set<string>()
  const pending = [transformation.targetCardId]
  while (pending.length) {
    const id = pending.pop()!
    if (proposed.has(id)) return '来源不能形成依赖环。'
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(downstream.get(id) || []))
  }
  return null
}

export function appendedSources(transformation: Transformation, cardIds: string[]) {
  return [...new Set([...transformation.sourceCardIds, ...cardIds])]
}
