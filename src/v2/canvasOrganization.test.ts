import { describe, expect, it } from 'vitest'
import type { BoardV2 } from '../domain'
import { copyCards, pastedCardInputs } from '../canvasOperations'
import { projectV2Board } from '../v2Projection'
import { groupBounds, transferCards, reverseOrganization, groupMoveRequest, applyOrganizationResult, projectGroupFrames, groupPasteInputs } from './canvasOrganization'

export function organizationBoard(): BoardV2 {
  return {
    schemaVersion: 2, id: 'b', title: 'Board', createdAt: 'now', updatedAt: 'now',
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: ['a', 'b', 'c'].map((id, index) => ({
      id, contentKind: 'markdown', x: index * 400, y: 100, width: 312, height: 208,
      headVersionId: null, versions: [], createdAt: 'now', updatedAt: 'now',
      ...(id === 'a' ? { color: 'blue' as const } : {}),
    })),
    groups: [{ id: 'g', title: 'Research', cardIds: ['a', 'b'] }],
    transformations: [{
      id: 't', sourceCardIds: ['a'], targetCardId: 'b', label: 'Draft', instruction: 'Draft',
      acceptance: '', permissions: { workspaceWrite: false }, createdAt: 'now', updatedAt: 'now',
    }, {
      id: 'cross', sourceCardIds: ['b'], targetCardId: 'c', label: 'Output', instruction: 'Output',
      acceptance: '', permissions: { workspaceWrite: false }, createdAt: 'now', updatedAt: 'now',
      x: 750, y: 140,
    }],
  }
}

describe('explicit canvas organization', () => {
  it('follows active resize dimensions and falls back to persisted styles for untouched cards', () => {
    const board = organizationBoard()
    const nodes = projectV2Board(board, {}).nodes
    const initial = groupBounds(board.groups![0], nodes)
    expect(initial).toMatchObject({ width: 760, height: 288 })
    const resizing = nodes.map((node) => node.id === 'b' ? { ...node, width: 560, height: 320 } : node)
    expect(groupBounds(board.groups![0], resizing)).toMatchObject({ width: 1008, height: 400 })
    expect(groupBounds(board.groups![0], nodes)).toEqual(initial)
    expect(board.cards[1]).toMatchObject({ width: 312, height: 208 })
  })
  it('reverses size baselines and applies only geometry while preserving newer content and groups', () => {
    const old = organizationBoard()
    const request = { sizes: [{ cardId: 'a', width: 440, height: 320, baseWidth: 312, baseHeight: 208 }] }
    const current = { ...old, groups: [], cards: old.cards.map((card) => ({ ...card, headVersionId: 'new-head' })) }
    expect(reverseOrganization(request)).toEqual({ sizes: [{ cardId: 'a', width: 312, height: 208, baseWidth: 440, baseHeight: 320 }] })
    const result = applyOrganizationResult(current, request, { groups: old.groups!, cards: old.cards, transformations: [] })
    expect(result.groups).toEqual([])
    expect(result.cards[0]).toEqual({ ...current.cards[0], width: 440, height: 320 })
    expect(result.cards[1]).toBe(current.cards[1])
  })
  it('supplies stable node dimensions so reprojected frames remain visible in ReactFlow', () => {
    const board = organizationBoard()
    const frame = projectGroupFrames(board.groups!, projectV2Board(board, {}).nodes)[0]
    expect(frame.width).toBe(frame.style?.width)
    expect(frame.height).toBe(frame.style?.height)
    expect(frame.measured).toEqual({ width: frame.width, height: frame.height })
  })
  it('places a copied group clear of existing cards while preserving relative layout', () => {
    const board = organizationBoard()
    const clipboard = { ...copyCards(board, ['a', 'b'])!, group: { title: 'Copy' } }
    const items = groupPasteInputs(board, clipboard, { x: 350, y: 200 })
    expect(items[1].x - items[0].x).toBe(400)
    expect(items.every((item) => board.cards.every((card) => item.x >= card.x + card.width
      || item.x + item.width <= card.x || item.y >= card.y + card.height || item.y + item.height <= card.y))).toBe(true)
  })
  it('does not replace newer groups when a color-only response arrives late', () => {
    const old = organizationBoard()
    const current = { ...old, groups: [] }
    const result = applyOrganizationResult(current, { colors: [{ cardId: 'a', color: 'green', baseColor: 'blue' }] },
      { groups: old.groups!, cards: [], transformations: [] })
    expect(result.groups).toEqual([])
  })
  it('recomputes a group frame after an arbitrarily distant card move without reassigning membership', () => {
    const board = organizationBoard()
    const nodes = projectV2Board(board, {}).nodes
    const moved = nodes.map((node) => node.id === 'a' ? { ...node, position: { x: -2500, y: -500 } } : node)
    expect(groupBounds(board.groups![0], moved)).toMatchObject({ x: -2524, y: -556 })
    expect(board.groups![0].cardIds).toEqual(['a', 'b'])
  })

  it('transfers only explicit cards, preserves order and drops emptied groups', () => {
    const groups = [...organizationBoard().groups!, { id: 'other', title: 'Other', cardIds: ['c'] }]
    expect(transferCards(groups, ['b', 'a'], 'other')).toEqual([
      { id: 'other', title: 'Other', cardIds: ['c', 'b', 'a'] },
    ])
    expect(transferCards(groups, ['a'], null)[0].cardIds).toEqual(['b'])
  })

  it('copies colors but not group membership with ordinary cards', () => {
    const clipboard = copyCards(organizationBoard(), ['a', 'b'])!
    expect(pastedCardInputs(clipboard, { x: 0, y: 0 })[0]).toMatchObject({ color: 'blue' })
    expect(clipboard).not.toHaveProperty('group')
  })

  it('moves group members and internal steps only, with reversible null step positions', () => {
    const board = organizationBoard()
    const request = groupMoveRequest(board, projectV2Board(board, {}).nodes, 'g', { x: 100, y: 40 })
    expect(request.positions?.map((item) => item.id)).toEqual(['a', 'b', 't'])
    expect(request.positions?.[0]).toMatchObject({ x: 100, y: 140, baseX: 0, baseY: 100 })
    expect(reverseOrganization(request).positions?.[2]).toMatchObject({ x: null, y: null })
  })
})
