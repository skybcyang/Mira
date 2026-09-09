import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, CardContent, ContentCard } from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-09-01T00:00:00.000Z'

interface InspirationCandidate {
  key: string
  boardId?: string
  boardTitle?: string
  cardId?: string
  versionId: string
  content: CardContent
  tags: string[]
  width?: number
  height?: number
  updatedAt: string
  poolId?: string
  entryId?: string
}

type AddInspirationCards = (
  selected: InspirationCandidate[],
  anchor: { x: number; y: number },
) => Promise<string[] | undefined>
type RecordInspiration = (
  sourceBoard: BoardV2,
  capture: { markdown: string; tags: string[] },
) => Promise<ContentCard>

function card(
  id: string,
  markdown = id,
  extras: {
    tags?: string[]
    inspirationRef?: {
      boardId?: string
      cardId?: string
      poolId?: string
      entryId?: string
      versionId: string
    }
  } = {},
): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    ...extras,
    x: 100,
    y: 100,
    width: 312,
    height: 208,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `${id}-digest`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  } as ContentCard
}

function currentBoard(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'current',
    title: '当前课题',
    cards: [card('before', '原选择'), card('already-here', '当前画板灵感')],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function candidate(
  boardId: string,
  cardId: string,
  markdown: string,
  tags: string[],
): InspirationCandidate {
  return {
    key: `${boardId}\u0000${cardId}\u0000${cardId}-v1`,
    boardId,
    boardTitle: boardId === 'current' ? '当前课题' : '灵感池',
    cardId,
    versionId: `${cardId}-v1`,
    content: { kind: 'markdown', markdown },
    tags,
    width: 312,
    height: 208,
    updatedAt: now,
  }
}

function addAction(): AddInspirationCards | undefined {
  return (useV2Canvas.getState() as unknown as {
    addInspirationCards?: AddInspirationCards
  }).addInspirationCards
}

function recordAction(): RecordInspiration | undefined {
  return (useV2Canvas.getState() as unknown as {
    recordInspiration?: RecordInspiration
  }).recordInspiration
}

function currentCanvasSnapshot() {
  const state = useV2Canvas.getState()
  return structuredClone({
    boardId: state.boardId,
    board: state.board,
    boards: state.boards,
    nodes: state.nodes,
    edges: state.edges,
    runs: state.runs,
    selectedCardIds: state.selectedCardIds,
    clipboard: state.clipboard,
    deleteConfirmationIds: state.deleteConfirmationIds,
    multiSelectMode: state.multiSelectMode,
    suggestions: state.suggestions,
    suggestionState: state.suggestionState,
    message: state.message,
    editingCardId: state.editingCardId,
    drawer: state.drawer,
    branchDraft: state.branchDraft,
    workflowDraft: state.workflowDraft,
    loadState: state.loadState,
    saveState: state.saveState,
    historyPast: state.historyPast,
    historyFuture: state.historyFuture,
    historyState: state.historyState,
  })
}

function resetStore() {
  const board = currentBoard()
  useV2Canvas.setState({
    boardId: board.id,
    board,
    boards: [{ id: board.id, title: board.title }, { id: 'pool', title: '灵感池' }],
    ...projectV2Board(board, {}),
    runs: {},
    selectedCardIds: ['before'],
    clipboard: null,
    deleteConfirmationIds: ['before'],
    multiSelectMode: true,
    suggestions: [{ id: 'old', label: '旧建议', instruction: '旧建议', acceptance: '' }],
    suggestionState: 'ready',
    message: null,
    editingCardId: 'before',
    drawer: null,
    branchDraft: { sourceCardIds: ['before'], targetPosition: { x: 500, y: 300 } },
    workflowDraft: null,
    loadState: 'ready',
    saveState: 'saved',
    historyPast: [],
    historyFuture: [],
    historyState: 'idle',
  })
}

beforeEach(resetStore)
afterEach(() => vi.restoreAllMocks())

describe('inspiration store orchestration', () => {
  it('records directly into the workspace pool without changing the current canvas', async () => {
    const entry = {
      id: 'pool-entry',
      tags: ['主意'],
      headVersionId: 'pool-entry-v1',
      versions: [{
        id: 'pool-entry-v1', entryId: 'pool-entry', sequence: 1,
        content: { kind: 'markdown' as const, markdown: '独立灵感' },
        digest: 'digest', origin: 'human' as const, createdAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }
    const createEntry = vi.spyOn(v2Api, 'createInspirationEntry').mockResolvedValue({ entry })
    const before = currentCanvasSnapshot()
    const action = useV2Canvas.getState().recordInspiration

    const result = await action({ markdown: '独立灵感', tags: ['主意'] })

    expect(createEntry).toHaveBeenCalledWith({ markdown: '独立灵感', tags: ['主意'] })
    expect(result).toEqual(entry)
    expect(currentCanvasSnapshot()).toEqual(before)
  })

  it('copies pool selections to the current board only after explicit add', async () => {
    const created = card('pool-copy', '池中想法', {
      inspirationRef: { poolId: 'inspiration-pool', entryId: 'pool-entry', versionId: 'pool-v1' },
    })
    const createCards = vi.spyOn(v2Api, 'createCards').mockResolvedValue({ cards: [created] })
    const action = addAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    useV2Canvas.setState({ drawer: { tab: 'content', cardId: 'before', mode: 'edit' } })
    const previous = useV2Canvas.getState()
    const result = await action([{
      key: 'pool-entry-key',
      poolId: 'inspiration-pool',
      entryId: 'pool-entry',
      versionId: 'pool-v1',
      content: { kind: 'markdown', markdown: '池中想法' },
      tags: ['主意'],
      updatedAt: now,
    }], { x: 500, y: 300 })

    expect(createCards).toHaveBeenCalledWith('current', {
      cards: [expect.objectContaining({
        poolSource: { poolId: 'inspiration-pool', entryId: 'pool-entry', versionId: 'pool-v1' },
        tags: ['主意'],
      })],
    })
    expect(result).toEqual(['pool-copy'])
    const next = useV2Canvas.getState()
    for (const key of ['selectedCardIds', 'editingCardId', 'drawer', 'branchDraft', 'multiSelectMode', 'suggestions'] as const) {
      expect(next[key], key).toEqual(previous[key])
    }
    expect(next.historyPast).toEqual([{ kind: 'create', boardId: 'current', cardIds: ['pool-copy'] }])
    expect(next.board?.cards).toHaveLength(previous.board!.cards.length + 1)
  })

  it('records into another source board without changing the current canvas state', async () => {
    const pool: BoardV2 = {
      ...currentBoard(),
      id: 'pool',
      title: '灵感池',
      cards: [card('pool-existing', '已有灵感')],
    }
    const created = card('captured', '直接记录', { tags: ['主意'] })
    const createCard = vi.spyOn(v2Api, 'createCard').mockResolvedValue({ card: created })
    const before = currentCanvasSnapshot()
    const action = recordAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const result = await action(pool, { markdown: '  直接记录  ', tags: ['主意'] })

    expect(createCard).toHaveBeenCalledWith('pool', {
      contentKind: 'markdown',
      markdown: '直接记录',
      tags: ['主意'],
      placement: 'board-bottom',
    })
    expect(result).toEqual(created)
    expect(currentCanvasSnapshot()).toEqual(before)
  })

  it('does not select or edit a directly recorded card when the source is current', async () => {
    const source = currentBoard()
    const created = card('captured', '直接记录', { tags: ['约束'] })
    vi.spyOn(v2Api, 'createCard').mockResolvedValue({ card: created })
    const action = recordAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const result = await action(source, { markdown: '直接记录', tags: ['约束'] })

    expect(result).toEqual(created)
    expect(useV2Canvas.getState().board?.cards.map((item) => item.id))
      .toEqual(['before', 'already-here', 'captured'])
    expect(useV2Canvas.getState()).toMatchObject({
      selectedCardIds: ['before'],
      editingCardId: 'before',
      deleteConfirmationIds: ['before'],
      multiSelectMode: true,
      branchDraft: { sourceCardIds: ['before'], targetPosition: { x: 500, y: 300 } },
    })
    const history = useV2Canvas.getState().historyPast
    expect(history[history.length - 1]).toMatchObject({
      kind: 'create',
      boardId: 'current',
      cardIds: ['captured'],
    })
  })

  it('keeps the current canvas unchanged when recording into another board fails', async () => {
    const pool = { ...currentBoard(), id: 'pool', title: '灵感池' }
    const failure = Object.assign(new Error('disk unavailable'), {
      code: 'BOARD_V2_WRITE_FAILED',
    })
    vi.spyOn(v2Api, 'createCard').mockRejectedValue(failure)
    const before = currentCanvasSnapshot()
    const action = recordAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    await expect(action(pool, { markdown: '保留这条草稿', tags: ['主意'] }))
      .rejects.toBe(failure)
    expect(currentCanvasSnapshot()).toEqual(before)
  })

  it('rejects blank capture before issuing a request', async () => {
    const createCard = vi.spyOn(v2Api, 'createCard')
    const before = currentCanvasSnapshot()
    const action = recordAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    await expect(action(currentBoard(), { markdown: '  \n ', tags: [] }))
      .rejects.toThrow('灵感内容不能为空')
    expect(createCard).not.toHaveBeenCalled()
    expect(currentCanvasSnapshot()).toEqual(before)
  })

  it('does not apply a late current-board response after switching boards', async () => {
    let resolveCreate: ((value: { card: ContentCard }) => void) | undefined
    vi.spyOn(v2Api, 'createCard').mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve
    }))
    const destination: BoardV2 = {
      ...currentBoard(),
      id: 'pool',
      title: '灵感池',
      cards: [card('pool-only', '另一画板内容')],
    }
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: destination })
    const action = recordAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const pendingRecord = action(currentBoard(), { markdown: '迟到结果', tags: [] })
    await useV2Canvas.getState().switchBoard('pool')
    const afterSwitch = currentCanvasSnapshot()
    resolveCreate?.({ card: card('late', '迟到结果') })
    await pendingRecord

    expect(currentCanvasSnapshot()).toEqual(afterSwitch)
    expect(useV2Canvas.getState().board?.cards.map((item) => item.id)).toEqual(['pool-only'])
  })

  it('creates every external snapshot in one batch and restores the mixed selection order', async () => {
    const created = [
      card('copy-a', '外部 A', {
        tags: ['主意'],
        inspirationRef: { boardId: 'pool', cardId: 'external-a', versionId: 'external-a-v1' },
      }),
      card('copy-b', '外部 B', {
        tags: ['约束'],
        inspirationRef: { boardId: 'pool', cardId: 'external-b', versionId: 'external-b-v1' },
      }),
    ]
    const createCards = vi.spyOn(v2Api, 'createCards').mockResolvedValue({ cards: created })
    const selected = [
      candidate('pool', 'external-a', '外部 A', ['主意']),
      candidate('current', 'already-here', '当前画板灵感', ['事件']),
      candidate('pool', 'external-b', '外部 B', ['约束']),
    ]
    const action = addAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const result = await action(selected, { x: 900, y: 520 })

    expect(createCards).toHaveBeenCalledOnce()
    expect(createCards).toHaveBeenCalledWith('current', {
      cards: [
        expect.objectContaining({
          contentKind: 'markdown',
          markdown: '外部 A',
          tags: ['主意'],
          inspirationRef: { boardId: 'pool', cardId: 'external-a', versionId: 'external-a-v1' },
          x: expect.any(Number),
          y: expect.any(Number),
          width: 312,
          height: 208,
        }),
        expect.objectContaining({
          contentKind: 'markdown',
          markdown: '外部 B',
          tags: ['约束'],
          inspirationRef: { boardId: 'pool', cardId: 'external-b', versionId: 'external-b-v1' },
          x: expect.any(Number),
          y: expect.any(Number),
          width: 312,
          height: 208,
        }),
      ],
    })
    expect(result).toEqual(['copy-a', 'already-here', 'copy-b'])
    expect(useV2Canvas.getState().selectedCardIds).toEqual(result)
    expect(useV2Canvas.getState().board?.cards.map((item) => item.id))
      .toEqual(['before', 'already-here', 'copy-a', 'copy-b'])
    expect(useV2Canvas.getState().nodes.filter((node) => node.selected).map((node) => node.id).sort())
      .toEqual(['already-here', 'copy-a', 'copy-b'])
    expect(useV2Canvas.getState()).toMatchObject({
      multiSelectMode: false,
      branchDraft: null,
      deleteConfirmationIds: null,
      editingCardId: null,
      suggestions: [],
      suggestionState: 'idle',
      saveState: 'saved',
    })
    const history = useV2Canvas.getState().historyPast
    expect(history[history.length - 1]).toMatchObject({
      kind: 'create',
      boardId: 'current',
      cardIds: ['copy-a', 'copy-b'],
    })
  })

  it.each(['success', 'failure'])('ignores a late batch %s after leaving and reopening the same board', async (outcome) => {
    let resolveCreate!: (value: { cards: ContentCard[] }) => void
    let rejectCreate!: (error: Error) => void
    vi.spyOn(v2Api, 'createCards').mockImplementation(() => new Promise((resolve, reject) => {
      resolveCreate = resolve
      rejectCreate = reject
    }))
    const destination = { ...currentBoard(), id: 'other', cards: [card('other-only')] }
    vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: destination })
      .mockResolvedValueOnce({ board: currentBoard() })

    const pendingAdd = useV2Canvas.getState().addInspirationCards([{
      key: 'pool-entry-key',
      poolId: 'inspiration-pool',
      entryId: 'pool-entry',
      versionId: 'pool-v1',
      content: { kind: 'markdown', markdown: 'late inspiration' },
      tags: [],
      updatedAt: now,
    }], { x: 500, y: 300 })
    await useV2Canvas.getState().switchBoard('other')
    await useV2Canvas.getState().switchBoard('current')
    const afterSwitch = currentCanvasSnapshot()

    if (outcome === 'success') resolveCreate({ cards: [card('late-copy')] })
    else rejectCreate(new Error('late failure'))

    expect(await pendingAdd).toBeUndefined()
    expect(currentCanvasSnapshot()).toEqual(afterSwitch)
  })

  it('selects current-board candidates without issuing an empty batch request', async () => {
    const createCards = vi.spyOn(v2Api, 'createCards')
    const action = addAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const result = await action([
      candidate('current', 'already-here', '当前画板灵感', ['事件']),
    ], { x: 900, y: 520 })

    expect(createCards).not.toHaveBeenCalled()
    expect(result).toEqual(['already-here'])
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['already-here'])
    expect(useV2Canvas.getState().historyPast).toEqual([])
    expect(useV2Canvas.getState().multiSelectMode).toBe(false)
    expect(useV2Canvas.getState().branchDraft).toBeNull()
  })

  it('keeps the board, selection, history, and interaction state unchanged when the batch fails', async () => {
    vi.spyOn(v2Api, 'createCards').mockRejectedValue(new Error('disk unavailable'))
    const before = structuredClone({
      board: useV2Canvas.getState().board,
      selectedCardIds: useV2Canvas.getState().selectedCardIds,
      historyPast: useV2Canvas.getState().historyPast,
      multiSelectMode: useV2Canvas.getState().multiSelectMode,
      branchDraft: useV2Canvas.getState().branchDraft,
      deleteConfirmationIds: useV2Canvas.getState().deleteConfirmationIds,
      editingCardId: useV2Canvas.getState().editingCardId,
      suggestions: useV2Canvas.getState().suggestions,
      suggestionState: useV2Canvas.getState().suggestionState,
    })
    const action = addAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const result = await action([
      candidate('pool', 'external-a', '外部 A', ['主意']),
      candidate('current', 'already-here', '当前画板灵感', ['事件']),
    ], { x: 900, y: 520 })

    expect(result).toBeUndefined()
    expect({
      board: useV2Canvas.getState().board,
      selectedCardIds: useV2Canvas.getState().selectedCardIds,
      historyPast: useV2Canvas.getState().historyPast,
      multiSelectMode: useV2Canvas.getState().multiSelectMode,
      branchDraft: useV2Canvas.getState().branchDraft,
      deleteConfirmationIds: useV2Canvas.getState().deleteConfirmationIds,
      editingCardId: useV2Canvas.getState().editingCardId,
      suggestions: useV2Canvas.getState().suggestions,
      suggestionState: useV2Canvas.getState().suggestionState,
    }).toEqual(before)
    expect(useV2Canvas.getState().saveState).toBe('error')
    expect(useV2Canvas.getState().message).toContain('disk unavailable')
  })
})
