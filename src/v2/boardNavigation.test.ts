import { describe, expect, it } from 'vitest'
import { boardMenuGroups, boardMenuFocusIndex, readBoardNavigation, rememberOpenedBoard } from './boardNavigation'

describe('board navigation preferences', () => {
  it('enters keyboard results at either end and wraps around', () => {
    expect(boardMenuFocusIndex(-1, 3, 'ArrowUp')).toBe(2)
    expect(boardMenuFocusIndex(-1, 3, 'ArrowDown')).toBe(0)
    expect(boardMenuFocusIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(boardMenuFocusIndex(2, 3, 'ArrowDown')).toBe(0)
  })
  it('deduplicates pinned/open groups and searches beyond the open list', () => {
    const boards = Array.from({ length: 120 }, (_, i) => ({ id: `${i}`, title: `课题 ${i}` }))
    expect(boardMenuGroups(boards, ['3', '2', '1'], ['2'], '').map(g => g.boards.map(b => b.id)))
      .toEqual([['2'], ['3', '1']])
    expect(boardMenuGroups(boards, ['3'], [], ' 119 ')[0].boards.map(b => b.id)).toEqual(['119'])
  })
  it('remembers successful opens once and validates optional storage', () => {
    expect(rememberOpenedBoard(['b', 'a'], 'a')).toEqual(['a', 'b'])
    expect(readBoardNavigation({ getItem: () => '{bad' })).toBeNull()
    expect(readBoardNavigation({ getItem: () => JSON.stringify({ opened: [], pinned: ['a', 'a', 1] }) }))
      .toEqual({ opened: [], pinned: ['a'] })
    expect(readBoardNavigation({ getItem: () => { throw Error('denied') } })).toBeNull()
  })
})
