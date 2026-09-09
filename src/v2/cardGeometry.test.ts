import { describe, expect, it } from 'vitest'
import type { ContentCard } from '../domain'
import { cardSizeRequest, geometryOrganizationRequest } from './cardGeometry'

function card(id: string, x: number, y: number, width = 100, height = 200): ContentCard {
  return { id, x, y, width, height, contentKind: 'markdown', headVersionId: null, versions: [], createdAt: 'now', updatedAt: 'now' }
}

describe('selected card geometry requests', () => {
  it('uses the first selected width, retaining each height and selection order', () => {
    const cards = [card('b', 500, 400, 440, 320), card('a', 0, 0, 312, 208)]
    const before = structuredClone(cards)
    expect(geometryOrganizationRequest(cards, 'same-width')).toEqual({ sizes: [
      { cardId: 'b', width: 440, height: 320, baseWidth: 440, baseHeight: 320 },
      { cardId: 'a', width: 440, height: 208, baseWidth: 312, baseHeight: 208 },
    ] })
    expect(cards).toEqual(before)
  })

  it('supports width-only, height-only and exact sizes without truncating legacy geometry', () => {
    const cards = [card('a', 0, 0, 140, 1400)]
    expect(cardSizeRequest(cards, 440)).toEqual({ sizes: [{ cardId: 'a', width: 440, height: 1400, baseWidth: 140, baseHeight: 1400 }] })
    expect(cardSizeRequest(cards, undefined, 320)?.sizes?.[0]).toMatchObject({ width: 140, height: 320 })
    expect(cardSizeRequest(cards, 140, 1400)).toBeNull()
  })

  it.each([
    ['align-left', [[0, 10], [0, 40], [0, 90]]],
    ['align-right', [[760, 10], [660, 40], [800, 90]]],
    ['align-top', [[0, 10], [500, 10], [800, 10]]],
    ['align-bottom', [[0, 50], [500, 100], [800, 90]]],
  ] as const)('aligns selected bounding edges with %s and CAS baselines', (operation, expected) => {
    const cards = [card('a', 0, 10, 100, 200), card('b', 500, 40, 200, 150), card('c', 800, 90, 60, 160)]
    const request = geometryOrganizationRequest(cards, operation)
    expect(request?.positions?.map(({ x, y }) => [x, y])).toEqual(expected)
    expect(request?.positions?.map(({ kind, id, baseX, baseY }) => [kind, id, baseX, baseY])).toEqual([
      ['card', 'a', 0, 10], ['card', 'b', 500, 40], ['card', 'c', 800, 90],
    ])
    expect(request).not.toHaveProperty('groups')
    if (operation === 'align-right' || operation === 'align-bottom') {
      expect(request?.sizes).toEqual(cards.map((card) => ({ cardId: card.id, width: card.width, height: card.height, baseWidth: card.width, baseHeight: card.height })))
    } else expect(request).not.toHaveProperty('sizes')
  })

  it('distributes bounding-box gaps, fixes both endpoints and preserves input ordering', () => {
    const cards = [card('b', 200, 40, 200), card('c', 1000, 90, 60), card('a', 0, 10)]
    expect(geometryOrganizationRequest(cards, 'distribute-horizontal')?.positions?.map(({ id, x, y }) => [id, x, y])).toEqual([
      ['b', 450, 40], ['c', 1000, 90], ['a', 0, 10],
    ])
    expect(geometryOrganizationRequest(cards, 'distribute-horizontal')?.sizes).toHaveLength(3)
    const vertical = [card('a', 10, -500, 100, 100), card('b', 40, 40, 100, 200), card('c', 90, 1000, 100, 60)]
    expect(geometryOrganizationRequest(vertical, 'distribute-vertical')?.positions?.map(({ x, y }) => [x, y])).toEqual([[10, -500], [40, 200], [90, 1000]])
  })

  it('breaks tied coordinates by ID deterministically, independent of selection order', () => {
    const cards = [card('c', 100, 0), card('b', 100, 0), card('a', 0, 0), card('d', 900, 0)]
    expect(geometryOrganizationRequest(cards, 'distribute-horizontal')?.positions?.map(({ id, x }) => [id, x])).toEqual([
      ['c', 600], ['b', 300], ['a', 0], ['d', 900],
    ])
  })

  it('rejects insufficient selections, negative gaps, invalid geometry and no-op requests', () => {
    const one = [card('a', 0, 0)]
    expect(geometryOrganizationRequest(one, 'same-width')).toBeNull()
    expect(geometryOrganizationRequest(one, 'align-left')).toBeNull()
    expect(geometryOrganizationRequest([...one, card('b', 500, 0)], 'distribute-horizontal')).toBeNull()
    expect(geometryOrganizationRequest([...one, card('b', 20, 0), card('c', 50, 0)], 'distribute-horizontal')).toBeNull()
    expect(geometryOrganizationRequest([...one, card('b', 0, 100)], 'align-left')).toBeNull()
    expect(geometryOrganizationRequest([...one, card('b', 100, 0), card('c', 200, 0)], 'distribute-horizontal')).toBeNull()
    expect(cardSizeRequest([], 440)).toBeNull()
    expect(cardSizeRequest([...one, ...one], 440)).toBeNull()
    expect(cardSizeRequest(Array.from({ length: 101 }, (_, i) => card(String(i), 0, 0)), 440)).toBeNull()
    for (const value of [0, -1, Infinity, NaN]) {
      expect(cardSizeRequest(one, value)).toBeNull()
      expect(cardSizeRequest([card('a', 0, 0, value)], 440)).toBeNull()
      expect(cardSizeRequest(one, 440, value)).toBeNull()
    }
    expect(geometryOrganizationRequest([...one, card('b', Infinity, 0)], 'align-left')).toBeNull()
    expect(geometryOrganizationRequest([card('a', 0, 0), card('b', 1e308, 0, 1e308)], 'align-right')).toBeNull()
  })
})
