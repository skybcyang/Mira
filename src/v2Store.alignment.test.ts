import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-08-23T00:00:00.000Z'

function card(id: string, x = 0, y = 0, markdown = id): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x,
    y,
    width: 300,
    height: 180,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`, cardId: id, sequence: 1,
      content: { kind: 'markdown', markdown }, digest: id,
      origin: 'human', createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function canvas(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards: [card('a', 100, 100, 'A'), card('b', 440, 280, 'B')],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function resetTo(board: BoardV2) {
  useV2Canvas.setState({
    boardId: board.id,
    board,
    boards: [{ id: board.id, title: board.title }],
    ...projectV2Board(board, {}),
    runs: {},
    selectedCardIds: [],
    suggestions: [],
    suggestionState: 'idle',
    clipboard: null,
    deleteConfirmationIds: null,
    branchDraft: null,
    drawer: null,
    editingCardId: null,
    message: null,
    loadState: 'ready',
    saveState: 'saved',
    historyPast: [],
    historyFuture: [],
    historyState: 'idle',
    alignmentGuides: null,
  })
}

beforeEach(() => resetTo(canvas()))
afterEach(() => vi.restoreAllMocks())

describe('canvas drag alignment', () => {
  it('snaps a dragged card to a nearby card edge and exposes guides during the drag', () => {
    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'a',
      position: { x: 438, y: 500 },
      dragging: true,
    }])

    const node = useV2Canvas.getState().nodes.find((item) => item.id === 'a')
    expect(node?.position).toEqual({ x: 440, y: 500 })
    expect(useV2Canvas.getState().alignmentGuides).toEqual([
      { axis: 'vertical', position: 440, from: 272, to: 688 },
    ])
  })

  it('keeps the raw position and clears guides when nothing is within the threshold', () => {
    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'a',
      position: { x: 700, y: 700 },
      dragging: true,
    }])

    const node = useV2Canvas.getState().nodes.find((item) => item.id === 'a')
    expect(node?.position).toEqual({ x: 700, y: 700 })
    expect(useV2Canvas.getState().alignmentGuides).toBeNull()
  })

  it('clears guides and persists the snapped position when the drag completes', async () => {
    const updateCards = vi.spyOn(v2Api, 'updateCards').mockResolvedValue({
      cards: [card('a', 440, 500, 'A')],
    })

    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'a',
      position: { x: 438, y: 500 },
      dragging: true,
    }])
    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'a',
      position: { x: 440, y: 500 },
      dragging: false,
    }])

    await vi.waitFor(() => expect(updateCards).toHaveBeenCalledOnce())
    expect(updateCards).toHaveBeenCalledWith('board-1', {
      updates: [{ cardId: 'a', x: 440, y: 500 }],
    })
    expect(useV2Canvas.getState().alignmentGuides).toBeNull()
  })

  it('does not snap when several cards are dragged together', () => {
    useV2Canvas.getState().onNodesChange([
      { type: 'position', id: 'a', position: { x: 438, y: 500 }, dragging: true },
      { type: 'position', id: 'b', position: { x: 778, y: 680 }, dragging: true },
    ])

    const nodes = useV2Canvas.getState().nodes
    expect(nodes.find((item) => item.id === 'a')?.position).toEqual({ x: 438, y: 500 })
    expect(nodes.find((item) => item.id === 'b')?.position).toEqual({ x: 778, y: 680 })
    expect(useV2Canvas.getState().alignmentGuides).toBeNull()
  })
})
