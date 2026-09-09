import type { BoardV2, CardColor, CanvasGroup, ContentCard } from './domain'
import { headVersion } from './v2View'

export type ClipboardCardItem = {
  name?: string
  color?: CardColor
  width: number
  height: number
  offsetX: number
  offsetY: number
} & (
  | { contentKind: 'markdown'; markdown: string }
  | { contentKind: 'file-reference'; filePath: string; readonly: boolean }
)

export interface CanvasClipboard {
  items: ClipboardCardItem[]
  group?: Pick<CanvasGroup, 'title' | 'color'>
  pasteCount: number
}

export type PastedCardInput = {
  name?: string
  color?: CardColor
  x: number
  y: number
  width: number
  height: number
} & (
  | { contentKind: 'markdown'; markdown: string }
  | { contentKind: 'file-reference'; filePath: string; readonly: boolean }
)

export interface CardSelectionDeleteBlocker {
  reason: 'related'
  cardIds: string[]
}

export interface CanvasRectangle {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_CARD_WIDTH = 312
const DEFAULT_CARD_HEIGHT = 208
const CARD_PLACEMENT_GAP = 24

export type CanvasKeyboardIntent =
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'create'
  | 'delete'
  | 'edit'

export function canvasKeyboardIntent(
  event: {
    key: string
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  },
  selectionCount: number,
): CanvasKeyboardIntent | null {
  const key = event.key.toLowerCase()
  const command = Boolean(event.metaKey || event.ctrlKey)
  if (command) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !event.shiftKey) return 'redo'
    if (key === 'a') return 'select-all'
    if (key === 'c' && selectionCount > 0) return 'copy'
    if (key === 'v') return 'paste'
    if (key === 'd' && selectionCount > 0) return 'duplicate'
    return null
  }
  if (event.altKey) return null
  if (key === 'n' && !event.shiftKey) return 'create'
  if ((key === 'delete' || key === 'backspace') && selectionCount > 0) return 'delete'
  if (key === 'enter' && selectionCount === 1) return 'edit'
  return null
}

function clipboardContent(card: ContentCard) {
  const content = headVersion(card)?.content
  if (card.contentKind === 'file-reference') {
    if (content?.kind !== 'file-reference') return null
    return {
      contentKind: 'file-reference' as const,
      filePath: content.path,
      readonly: content.readonly,
    }
  }
  return {
    contentKind: 'markdown' as const,
    markdown: content?.kind === 'markdown' ? content.markdown : '',
  }
}

export function copyCards(board: BoardV2, cardIds: string[]): CanvasClipboard | null {
  const cards = cardIds.flatMap((cardId) => {
    const card = board.cards.find((item) => item.id === cardId)
    return card ? [card] : []
  })
  if (cards.length === 0) return null
  const left = Math.min(...cards.map((card) => card.x))
  const right = Math.max(...cards.map((card) => card.x + card.width))
  const top = Math.min(...cards.map((card) => card.y))
  const bottom = Math.max(...cards.map((card) => card.y + card.height))
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const items = cards.flatMap((card): ClipboardCardItem[] => {
    const content = clipboardContent(card)
    if (!content) return []
    return [{
      ...content,
      ...(card.name ? { name: card.name } : {}),
      ...(card.color ? { color: card.color } : {}),
      width: card.width,
      height: card.height,
      offsetX: card.x - centerX,
      offsetY: card.y - centerY,
    }]
  })
  return items.length > 0 ? { items, pasteCount: 0 } : null
}

export function pastedCardInputs(
  clipboard: CanvasClipboard,
  anchor: { x: number; y: number },
): PastedCardInput[] {
  const repeatedPasteOffset = clipboard.pasteCount * 24
  return clipboard.items.map(({ offsetX, offsetY, ...item }) => ({
    ...item,
    x: anchor.x + offsetX + repeatedPasteOffset,
    y: anchor.y + offsetY + repeatedPasteOffset,
  }))
}

export function cardSelectionDeleteBlocker(
  board: BoardV2,
  cardIds: string[],
): CardSelectionDeleteBlocker | null {
  const related = cardIds.filter((cardId) =>
    board.transformations.some(
      (transformation) =>
        transformation.targetCardId === cardId || transformation.sourceCardIds.includes(cardId),
    ),
  )
  return related.length > 0 ? { reason: 'related', cardIds: related } : null
}

export function canvasMinimumZoom(nodeCount: number): number {
  return nodeCount > 30 ? 0.08 : 0.2
}

function canvasRectanglesOverlap(left: CanvasRectangle, right: CanvasRectangle): boolean {
  return !(
    left.x + left.width + CARD_PLACEMENT_GAP <= right.x
    || right.x + right.width + CARD_PLACEMENT_GAP <= left.x
    || left.y + left.height + CARD_PLACEMENT_GAP <= right.y
    || right.y + right.height + CARD_PLACEMENT_GAP <= left.y
  )
}

function placementOffsets(ring: number): Array<{ x: number; y: number }> {
  if (ring === 0) return [{ x: 0, y: 0 }]
  return [
    { x: ring, y: 0 },
    { x: 0, y: ring },
    { x: -ring, y: 0 },
    { x: 0, y: -ring },
    { x: ring, y: ring },
    { x: -ring, y: ring },
    { x: -ring, y: -ring },
    { x: ring, y: -ring },
  ]
}

export function collisionFreeCanvasCardPosition(
  anchor: { x: number; y: number },
  occupied: CanvasRectangle[],
  size: { width: number; height: number } = {
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT,
  },
): { x: number; y: number } {
  const origin = {
    x: anchor.x - size.width / 2,
    y: anchor.y - size.height / 2,
  }
  const horizontalStep = size.width + CARD_PLACEMENT_GAP
  const verticalStep = size.height + CARD_PLACEMENT_GAP

  for (let ring = 0; ; ring += 1) {
    for (const offset of placementOffsets(ring)) {
      const candidate = {
        x: origin.x + offset.x * horizontalStep,
        y: origin.y + offset.y * verticalStep,
        ...size,
      }
      if (!occupied.some((rectangle) => canvasRectanglesOverlap(candidate, rectangle))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
}

export function cardFocusViewport(
  node: { position: { x: number; y: number }; width?: number; height?: number; measured?: { width?: number; height?: number } },
  area: { x: number; y: number; width: number; height: number },
) {
  const width = node.measured?.width || node.width || 312
  const height = node.measured?.height || node.height || 208
  const zoom = Math.max(0.8, Math.min(1, area.width / width, area.height / height))
  return {
    x: area.x + Math.max(0, (area.width - width * zoom) / 2) - node.position.x * zoom,
    y: area.y + Math.max(0, (area.height - height * zoom) / 2) - node.position.y * zoom,
    zoom,
  }
}

export function canvasInitialFocusNodeIds(
  nodes: Array<{ id: string; type?: string; position: { x: number; y: number } }>,
  viewportWidth: number,
): string[] {
  if (nodes.length <= 6) return []
  const contentNodes = nodes.filter((node) => !node.type || node.type === 'contentCard')
  if (contentNodes.length === 0) return []
  const leftmostX = Math.min(...contentNodes.map((node) => node.position.x))
  return contentNodes
    .filter((node) => Math.abs(node.position.x - leftmostX) < 1)
    .sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id))
    .slice(0, viewportWidth < 720 ? 2 : 3)
    .map((node) => node.id)
}

export function workflowDraftFocusNodeIds(
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    selected?: boolean
  }>,
  origin: { x: number; y: number },
): string[] {
  const byDistance = (
    left: { id: string; position: { x: number; y: number } },
    right: { id: string; position: { x: number; y: number } },
  ) => {
    const leftDistance = Math.abs(left.position.x - origin.x) + Math.abs(left.position.y - origin.y)
    const rightDistance = Math.abs(right.position.x - origin.x) + Math.abs(right.position.y - origin.y)
    return leftDistance - rightDistance || left.id.localeCompare(right.id)
  }
  const selectedContent = nodes.filter((node) => node.type === 'contentCard' && node.selected)
  const content = selectedContent.sort(byDistance)[0]
  const firstStep = nodes
    .filter((node) => node.type === 'workflowDraftStep')
    .sort(byDistance)[0]
  return [content?.id, firstStep?.id].filter((id): id is string => Boolean(id))
}

export function canvasActiveBranchElementIds(
  nodes: Array<{ id: string }>,
  edges: Array<{ id: string; source: string; target: string }>,
  selectedNodeIds: string[],
  depth = 2,
): { nodeIds: string[]; edgeIds: string[] } {
  if (selectedNodeIds.length === 0) return { nodeIds: [], edgeIds: [] }
  const available = new Set(nodes.map((node) => node.id))
  const focused = new Set(selectedNodeIds.filter((id) => available.has(id)))
  let frontier = [...focused]
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = []
    for (const nodeId of frontier) {
      for (const edge of edges) {
        const adjacent = edge.source === nodeId
          ? edge.target
          : edge.target === nodeId
            ? edge.source
            : null
        if (!adjacent || !available.has(adjacent) || focused.has(adjacent)) continue
        focused.add(adjacent)
        next.push(adjacent)
      }
    }
    frontier = next
  }
  return {
    nodeIds: nodes.flatMap((node) => focused.has(node.id) ? [node.id] : []),
    edgeIds: edges.flatMap((edge) =>
      focused.has(edge.source) && focused.has(edge.target) ? [edge.id] : []),
  }
}

export function shouldFitCanvasBoard(
  lastFittedBoardId: string | null,
  boardId: string | undefined,
  loadState: string,
  nodeCount: number,
): boolean {
  return Boolean(
    boardId
    && loadState === 'ready'
    && nodeCount > 0
    && lastFittedBoardId !== boardId,
  )
}
