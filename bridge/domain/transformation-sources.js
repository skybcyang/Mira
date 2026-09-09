import { typed } from './errors.js'

export function assertSourcesDoNotCloseCycle(board, transformation, sourceCardIds) {
  const downstream = new Map()
  for (const step of board.transformations) {
    if (step.id === transformation.id) continue
    for (const source of step.sourceCardIds) {
      if (!downstream.has(source)) downstream.set(source, [])
      downstream.get(source).push(step.targetCardId)
    }
  }
  const proposed = new Set(sourceCardIds)
  const visited = new Set()
  const pending = [transformation.targetCardId]
  while (pending.length) {
    const id = pending.pop()
    if (proposed.has(id)) {
      throw typed('TRANSFORMATION_SOURCE_INVALID', '来源不能形成依赖环。')
    }
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(downstream.get(id) || []))
  }
}
