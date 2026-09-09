import type { ContentCard } from '../domain'
import type { OrganizationRequest } from './canvasOrganization'

export type GeometryOperation = 'same-width' | 'align-left' | 'align-right' | 'align-top' | 'align-bottom'
  | 'distribute-horizontal' | 'distribute-vertical'

const positive = (value: number) => Number.isFinite(value) && value > 0

function validSelection(cards: ContentCard[]) {
  return cards.length > 0 && cards.length <= 100 && new Set(cards.map(({ id }) => id)).size === cards.length
    && cards.every((card) => card.id.trim() && Number.isFinite(card.x) && Number.isFinite(card.y)
      && positive(card.width) && positive(card.height))
}

export function cardSizeRequest(cards: ContentCard[], width?: number, height?: number): OrganizationRequest | null {
  if (!validSelection(cards) || (width !== undefined && !positive(width)) || (height !== undefined && !positive(height))) return null
  const sizes = cards.map((card) => ({ cardId: card.id, width: width ?? card.width, height: height ?? card.height,
    baseWidth: card.width, baseHeight: card.height }))
  return sizes.some((size) => size.width !== size.baseWidth || size.height !== size.baseHeight) ? { sizes } : null
}

export function geometryOrganizationRequest(cards: ContentCard[], operation: GeometryOperation): OrganizationRequest | null {
  if (cards.length < 2 || !validSelection(cards)) return null
  if (operation === 'same-width') return cardSizeRequest(cards, cards[0].width)
  const positions = cards.map((card) => ({ kind: 'card' as const, id: card.id, x: card.x, y: card.y, baseX: card.x, baseY: card.y }))
  if (operation === 'distribute-horizontal' || operation === 'distribute-vertical') {
    if (cards.length < 3) return null
    const axis = operation === 'distribute-horizontal' ? 'x' : 'y'
    const dimension = axis === 'x' ? 'width' : 'height'
    const ordered = [...cards].sort((a, b) => a[axis] - b[axis] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    const gap = (last[axis] + last[dimension] - first[axis] - ordered.reduce((sum, card) => sum + card[dimension], 0)) / (ordered.length - 1)
    if (!Number.isFinite(gap) || gap < 0) return null
    const byId = new Map(positions.map((position) => [position.id, position]))
    let offset = first[axis]
    for (let index = 0; index < ordered.length; index++) {
      const card = ordered[index]
      // Keep endpoint coordinates exact, including with fractional gaps.
      if (index > 0 && index < ordered.length - 1) byId.get(card.id)![axis] = offset
      offset += card[dimension] + gap
    }
  } else {
    const horizontal = operation === 'align-left' || operation === 'align-right'
    const trailing = operation === 'align-right' || operation === 'align-bottom'
    const axis = horizontal ? 'x' : 'y'
    const dimension = horizontal ? 'width' : 'height'
    const edges = cards.map((card) => card[axis] + (trailing ? card[dimension] : 0))
    const edge = trailing ? Math.max(...edges) : Math.min(...edges)
    positions.forEach((position, index) => { position[axis] = edge - (trailing ? cards[index][dimension] : 0) })
  }
  if (!positions.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return null
  if (!positions.some(({ x, y, baseX, baseY }) => x !== baseX || y !== baseY)) return null
  // These operations derive positions from dimensions; include unchanged sizes as CAS guards.
  const needsSizes = operation !== 'align-left' && operation !== 'align-top'
  return { positions, ...(needsSizes ? { sizes: cards.map((card) => ({ cardId: card.id, width: card.width, height: card.height,
    baseWidth: card.width, baseHeight: card.height })) } : {}) }
}
