import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-09-03T00:00:00.000Z'

function card(id: string): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`, cardId: id, sequence: 1,
      content: { kind: 'markdown', markdown: id }, digest: id,
      origin: 'human', createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function board(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards: [card('a'), card('b')],
    transformations: [{
      id: 't-1',
      sourceCardIds: ['a'],
      targetCardId: 'b',
      label: '形成结果',
      instruction: '从 A 形成结果',
      acceptance: '',
      permissions: { workspaceWrite: false },
      lastRunId: 'run-1',
      createdAt: now,
      updatedAt: now,
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function resetTo(nextBoard: BoardV2) {
  useV2Canvas.setState({
    boardId: nextBoard.id,
    board: nextBoard,
    boards: [{ id: nextBoard.id, title: nextBoard.title }],
    ...projectV2Board(nextBoard, {}),
    runs: {},
    selectedCardIds: [],
    suggestions: [],
    suggestionState: 'idle',
    clipboard: null,
    deleteConfirmationIds: null,
    branchDraft: null,
    drawer: null,
    panel: null,
    editingCardId: null,
    message: null,
    loadState: 'ready',
    saveState: 'saved',
    historyPast: [],
    historyFuture: [],
    historyState: 'idle',
  })
}

beforeEach(() => resetTo(board()))
afterEach(() => vi.restoreAllMocks())

describe('side panel store state', () => {
  it('opens a panel and closes it again', () => {
    useV2Canvas.getState().openPanel('model')
    expect(useV2Canvas.getState().panel).toBe('model')
    useV2Canvas.getState().openPanel(null)
    expect(useV2Canvas.getState().panel).toBe(null)
  })

  it('closes the drawer when a panel opens', () => {
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'a' })
    useV2Canvas.getState().openPanel('workflow')
    expect(useV2Canvas.getState().drawer).toBe(null)
    expect(useV2Canvas.getState().panel).toBe('workflow')
  })

  it('closes the panel when a drawer opens', () => {
    useV2Canvas.getState().openPanel('plan')
    useV2Canvas.getState().openDrawer({ tab: 'versions', cardId: 'a' })
    expect(useV2Canvas.getState().panel).toBe(null)
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'versions', cardId: 'a' })
  })

  it('keeps the active panel when an async result requests a drawer', async () => {
    useV2Canvas.setState({
      runs: {
        'run-1': {
          id: 'run-1',
          boardId: 'board-1',
          transformationId: 't-1',
          status: 'succeeded',
          sourceSnapshot: [],
          targetCardId: 'b',
          targetBaseVersionId: null,
          intent: 'update',
          result: { output: '候选', digest: 'candidate', disposition: 'candidate' },
          createdAt: now,
        },
      },
    })
    useV2Canvas.getState().openPanel('workflow')

    await useV2Canvas.getState().runToTransformation('t-1')

    expect(useV2Canvas.getState().drawer).toBe(null)
    expect(useV2Canvas.getState().panel).toBe('workflow')
  })
})
