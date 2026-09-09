export interface CanvasFocusNode {
  id: string
  type?: string
  position: { x: number; y: number }
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
  style?: { width?: number | string; height?: number | string }
}

interface PlanTransformation {
  id: string
  sourceCardIds: string[]
  targetCardId: string
  planRef?: { stepIndex: number; stepTotal: number }
}

export interface MaterializedPlanFocusIntent {
  boardId: string
  viewportRevision: number
  previousTransformationIds: string[]
}

interface MaterializedPlanFocusState {
  boardId: string | null
  viewportRevision: number
  board: { transformations: PlanTransformation[] }
  nodes: CanvasFocusNode[]
}

function numericDimension(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function nodeSize(node: CanvasFocusNode): { width: number; height: number } {
  return {
    width: numericDimension(node.measured?.width)
      ?? numericDimension(node.width)
      ?? numericDimension(node.style?.width)
      ?? 312,
    height: numericDimension(node.measured?.height)
      ?? numericDimension(node.height)
      ?? numericDimension(node.style?.height)
      ?? 208,
  }
}

export function materializedPlanCanvasFocus(
  intent: MaterializedPlanFocusIntent,
  state: MaterializedPlanFocusState,
): { nodeIds: string[] } | null {
  if (
    state.boardId !== intent.boardId
    || state.viewportRevision !== intent.viewportRevision
  ) return null

  const previous = new Set(intent.previousTransformationIds)
  const firstTransformation = state.board.transformations
    .filter((transformation) => !previous.has(transformation.id) && transformation.planRef)
    .sort((left, right) =>
      (left.planRef?.stepIndex ?? Number.MAX_SAFE_INTEGER)
      - (right.planRef?.stepIndex ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id))[0]
  const sourceId = firstTransformation?.sourceCardIds[0]
  if (!firstTransformation || !sourceId) return null

  const nodeIds = [
    sourceId,
    `transformation-node:${firstTransformation.id}`,
    firstTransformation.targetCardId,
  ]
  const available = new Set(state.nodes.map((node) => node.id))
  return nodeIds.every((nodeId) => available.has(nodeId)) ? { nodeIds } : null
}

export function inspirationCanvasFocus(
  nodes: CanvasFocusNode[],
  selectedNodeIds: string[],
  viewport: { width: number; height: number },
): { nodeIds: string[]; group: boolean } | null {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const orderedNodeIds = [...new Set(selectedNodeIds)]
  if (orderedNodeIds.some((nodeId) => !byId.has(nodeId))) return null
  const selected = orderedNodeIds.map((nodeId) => byId.get(nodeId)!)
  if (selected.length === 0) return null
  if (selected.length === 1) return { nodeIds: [selected[0].id], group: false }

  const left = Math.min(...selected.map((node) => node.position.x))
  const top = Math.min(...selected.map((node) => node.position.y))
  const right = Math.max(...selected.map((node) => node.position.x + nodeSize(node).width))
  const bottom = Math.max(...selected.map((node) => node.position.y + nodeSize(node).height))
  const availableWidth = Math.max(1, viewport.width - 64)
  const availableHeight = Math.max(1, viewport.height - 176)
  const readableZoom = Math.min(
    1,
    availableWidth / Math.max(1, right - left),
    availableHeight / Math.max(1, bottom - top),
  )
  if (readableZoom < 0.72) return { nodeIds: [selected[0].id], group: false }
  return { nodeIds: selected.map((node) => node.id), group: true }
}
