import type { Node } from '@xyflow/react'
import type { BoardV2, CanvasGroup, CardColor, ContentCard, Transformation } from '../domain'
import { collisionFreeCanvasCardPosition, pastedCardInputs, type CanvasClipboard } from '../canvasOperations'

export const CARD_COLORS: CardColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'violet']
export const COLOR_LABELS: Record<CardColor, string> = {
  red: '红色', orange: '橙色', yellow: '黄色', green: '绿色', blue: '蓝色', violet: '紫色',
}
export const GROUP_NODE_PREFIX = 'canvas-group:'

export interface OrganizationPosition {
  kind: 'card' | 'transformation'
  id: string
  x: number | null
  y: number | null
  baseX: number | null
  baseY: number | null
}
export interface OrganizationRequest {
  groups?: CanvasGroup[]
  baseGroups?: CanvasGroup[]
  colors?: Array<{ cardId: string; color: CardColor | null; baseColor: CardColor | null }>
  positions?: OrganizationPosition[]
  sizes?: Array<{ cardId: string; width: number; height: number; baseWidth: number; baseHeight: number }>
}
export interface OrganizationResult {
  groups: CanvasGroup[]
  cards: ContentCard[]
  transformations: Transformation[]
}

export function groupBounds(group: CanvasGroup, nodes: Node[]) {
  const members = new Set(group.cardIds)
  const items = nodes.filter((node) => members.has(node.id))
  if (!items.length) return null
  const x = Math.min(...items.map((node) => node.position.x)) - 24
  const y = Math.min(...items.map((node) => node.position.y)) - 56
  return {
    x, y,
    width: Math.max(240, Math.max(...items.map((node) => node.position.x + (node.width ?? Number(node.style?.width || 312)))) + 24 - x),
    height: Math.max(...items.map((node) => node.position.y + (node.height ?? Number(node.style?.height || 208)))) + 24 - y,
  }
}

export function projectGroupFrames(groups: CanvasGroup[], nodes: Node[], selectedGroupId: string | null = null): Node[] {
  return groups.flatMap((group) => {
    const bounds = groupBounds(group, nodes)
    return bounds ? [{
      id: `${GROUP_NODE_PREFIX}${group.id}`, type: 'canvasGroup',
      position: { x: bounds.x, y: bounds.y }, style: { width: bounds.width, height: bounds.height },
      data: { group }, width: bounds.width, height: bounds.height, zIndex: 0, selectable: false, focusable: false,
      measured: { width: bounds.width, height: bounds.height },
      dragHandle: '.v2-group-title', selected: group.id === selectedGroupId,
    }] : []
  })
}

export function transferCards(groups: CanvasGroup[], cardIds: string[], targetId: string | null): CanvasGroup[] {
  const selected = new Set(cardIds)
  return groups.map((group) => ({
    ...group,
    cardIds: group.id === targetId
      ? [...group.cardIds, ...cardIds.filter((id) => !group.cardIds.includes(id))]
      : group.cardIds.filter((id) => !selected.has(id)),
  })).filter((group) => group.cardIds.length > 0)
}

export function groupPasteInputs(board: BoardV2, clipboard: CanvasClipboard, anchor: { x: number; y: number }) {
  const items = pastedCardInputs(clipboard, anchor)
  if (!clipboard.group || !items.length) return items
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const width = Math.max(...items.map((item) => item.x + item.width)) - left + 48
  const height = Math.max(...items.map((item) => item.y + item.height)) - top + 80
  const nodes = board.cards.map((card) => ({ id: card.id, data: {}, position: card, style: card }))
  const frames = (board.groups || []).flatMap((group) => {
    const bounds = groupBounds(group, nodes)
    return bounds ? [bounds] : []
  })
  const position = collisionFreeCanvasCardPosition(anchor, [...board.cards, ...frames], { width, height })
  return items.map((item) => ({ ...item, x: item.x + position.x + 24 - left, y: item.y + position.y + 56 - top }))
}

export function reverseOrganization(request: OrganizationRequest): OrganizationRequest {
  return {
    ...(request.groups ? { groups: request.baseGroups, baseGroups: request.groups } : {}),
    ...(request.colors ? { colors: request.colors.map(({ color, baseColor, ...item }) => ({ ...item, color: baseColor, baseColor: color })) } : {}),
    ...(request.positions ? { positions: request.positions.map(({ x, y, baseX, baseY, ...item }) => ({ ...item, x: baseX, y: baseY, baseX: x, baseY: y })) } : {}),
    ...(request.sizes ? { sizes: request.sizes.map(({ width, height, baseWidth, baseHeight, ...item }) => ({ ...item, width: baseWidth, height: baseHeight, baseWidth: width, baseHeight: height })) } : {}),
  }
}

export function groupMoveRequest(board: BoardV2, nodes: Node[], groupId: string, delta: { x: number; y: number }): OrganizationRequest {
  const members = new Set(board.groups?.find((group) => group.id === groupId)?.cardIds || [])
  const positions: OrganizationPosition[] = board.cards.filter((card) => members.has(card.id)).map((card) => ({
    kind: 'card', id: card.id, baseX: card.x, baseY: card.y, x: card.x + delta.x, y: card.y + delta.y,
  }))
  for (const item of board.transformations) {
    if (!members.has(item.targetCardId) || !item.sourceCardIds.every((id) => members.has(id))) continue
    const node = nodes.find((node) => node.id === `transformation-node:${item.id}`)
    if (node) positions.push({ kind: 'transformation', id: item.id, baseX: item.x ?? null, baseY: item.y ?? null,
      x: node.position.x + delta.x, y: node.position.y + delta.y })
  }
  return { positions, groups: board.groups || [], baseGroups: board.groups || [] }
}

// Merge only requested metadata: a model response may have advanced Head during the request.
export function applyOrganizationResult(board: BoardV2, request: OrganizationRequest, result: OrganizationResult): BoardV2 {
  const colors = new Map(request.colors?.map((item) => [item.cardId, item.color]))
  const positions = new Map(request.positions?.map((item) => [`${item.kind}:${item.id}`, item]))
  const sizes = new Map(request.sizes?.map((item) => [item.cardId, item]))
  return {
    ...board,
    ...(request.groups && JSON.stringify(request.groups) !== JSON.stringify(request.baseGroups) ? { groups: result.groups } : {}),
    cards: board.cards.map((card) => {
      const position = positions.get(`card:${card.id}`)
      const size = sizes.get(card.id)
      if (!colors.has(card.id) && !position && !size) return card
      const next = { ...card, ...(position ? { x: position.x!, y: position.y! } : {}), ...(size ? { width: size.width, height: size.height } : {}) }
      if (colors.has(card.id)) {
        if (colors.get(card.id)) next.color = colors.get(card.id)!
        else delete next.color
      }
      return next
    }),
    transformations: board.transformations.map((item) => {
      const position = positions.get(`transformation:${item.id}`)
      if (!position) return item
      const next = { ...item }
      if (position.x === null) { delete next.x; delete next.y }
      else { next.x = position.x; next.y = position.y! }
      return next
    }),
  }
}
