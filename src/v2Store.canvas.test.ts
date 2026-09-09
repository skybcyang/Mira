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

function revisedCard(source: ContentCard, versionId: string, markdown: string): ContentCard {
  return {
    ...source,
    headVersionId: versionId,
    versions: [...source.versions, {
      id: versionId,
      cardId: source.id,
      sequence: source.versions.length + 1,
      content: { kind: 'markdown', markdown },
      digest: versionId,
      origin: 'human',
      createdAt: now,
    }],
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
    notices: [],
  })
}

beforeEach(() => resetTo(canvas()))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas card store operations', () => {
  it('rejects card-to-card connections without writing a relation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await useV2Canvas.getState().onConnect({
      source: 'a',
      target: 'b',
      sourceHandle: null,
      targetHandle: null,
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().board?.transformations).toEqual([])
    const notices = useV2Canvas.getState().notices
    expect(notices[notices.length - 1]?.message).toContain('不创建普通关系')
  })

  it('persists a completed transformation-node drag and keeps the saved position', async () => {
    const board = canvas()
    const transformation = {
      id: 'transformation-1',
      sourceCardIds: ['a'],
      targetCardId: 'b',
      label: '形成结果',
      instruction: '从 A 形成结果',
      acceptance: '',
      permissions: { workspaceWrite: false },
      createdAt: now,
      updatedAt: now,
    }
    board.transformations = [transformation]
    resetTo(board)
    const updatePosition = vi.spyOn(v2Api, 'updateTransformationPosition').mockResolvedValue({
      transformation: { ...transformation, x: 360, y: 180 },
    })

    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'transformation-node:transformation-1',
      position: { x: 360, y: 180 },
      dragging: false,
    }])

    await vi.waitFor(() => expect(updatePosition).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(useV2Canvas.getState().saveState).toBe('saved'))
    expect(updatePosition).toHaveBeenCalledWith('board-1', 'transformation-1', {
      x: 360,
      y: 180,
    })
    expect(useV2Canvas.getState().board?.transformations[0]).toMatchObject({ x: 360, y: 180 })
    expect(useV2Canvas.getState().nodes.find(
      (node) => node.id === 'transformation-node:transformation-1',
    )?.position).toEqual({ x: 360, y: 180 })
  })

  it('rolls a transformation-node drag back when position persistence fails', async () => {
    const board = canvas()
    board.transformations = [{
      id: 'transformation-1',
      sourceCardIds: ['a'],
      targetCardId: 'b',
      label: '形成结果',
      instruction: '从 A 形成结果',
      acceptance: '',
      permissions: { workspaceWrite: false },
      createdAt: now,
      updatedAt: now,
    }]
    resetTo(board)
    const originalPosition = useV2Canvas.getState().nodes.find(
      (node) => node.id === 'transformation-node:transformation-1',
    )?.position
    vi.spyOn(v2Api, 'updateTransformationPosition').mockRejectedValue(new Error('disk unavailable'))

    useV2Canvas.getState().onNodesChange([{
      type: 'position',
      id: 'transformation-node:transformation-1',
      position: { x: 360, y: 180 },
      dragging: false,
    }])

    await vi.waitFor(() => expect(useV2Canvas.getState().saveState).toBe('error'))
    expect(useV2Canvas.getState().nodes.find(
      (node) => node.id === 'transformation-node:transformation-1',
    )?.position).toEqual(originalPosition)
    expect(useV2Canvas.getState().message).toContain('位置未保存，已恢复到上次状态')
  })

  it('copies selection and pastes one atomic group as newly selected cards', async () => {
    const pasted = [card('copy-a', 480, 320, 'A'), card('copy-b', 820, 500, 'B')]
    const createCards = vi.spyOn(v2Api, 'createCards').mockResolvedValue({ cards: pasted })
    useV2Canvas.getState().setSelectedCardIds(['a', 'b'])

    useV2Canvas.getState().copySelectedCards()
    await useV2Canvas.getState().pasteCards({ x: 800, y: 500 })

    expect(createCards).toHaveBeenCalledOnce()
    expect(createCards.mock.calls[0][1].cards).toEqual([
      { contentKind: 'markdown', markdown: 'A', x: 480, y: 320, width: 300, height: 180 },
      { contentKind: 'markdown', markdown: 'B', x: 820, y: 500, width: 300, height: 180 },
    ])
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['copy-a', 'copy-b'])
    expect(useV2Canvas.getState().nodes.filter((node) => node.selected).map((node) => node.id))
      .toEqual(['copy-a', 'copy-b'])
  })

  it('uses the receipt from undoing a creation to redo the same exact card', async () => {
    const created = card('file-card', 760, 320, 'docs/source.md')
    const createCard = vi.spyOn(v2Api, 'createCard').mockResolvedValue({ card: created })
    const deleteCards = vi.spyOn(v2Api, 'deleteCards').mockResolvedValue({
      deletedCardIds: ['file-card'],
      restoreReceiptId: 'receipt-create',
    })
    const restoreCards = vi.spyOn(v2Api, 'restoreCards').mockResolvedValue({ cards: [created] })

    await useV2Canvas.getState().createFileCard({ x: 760, y: 320 }, 'docs/source.md')
    await useV2Canvas.getState().undo()
    await useV2Canvas.getState().redo()

    expect(createCard).toHaveBeenCalledOnce()
    expect(deleteCards).toHaveBeenCalledWith('board-1', { cardIds: ['file-card'] })
    expect(restoreCards).toHaveBeenCalledWith('board-1', {
      restoreReceiptId: 'receipt-create',
    })
    expect(useV2Canvas.getState().board?.cards.slice(-1)[0]).toEqual(created)
  })

  it('persists a completed multi-card drag in one atomic request and keeps selection', async () => {
    const updateCards = vi.spyOn(v2Api, 'updateCards').mockResolvedValue({
      cards: [card('a', 180, 170, 'A'), card('b', 520, 350, 'B')],
    })
    useV2Canvas.getState().setSelectedCardIds(['a', 'b'])

    useV2Canvas.getState().onNodesChange([
      { type: 'position', id: 'a', position: { x: 180, y: 170 }, dragging: false },
      { type: 'position', id: 'b', position: { x: 520, y: 350 }, dragging: false },
    ])
    await vi.waitFor(() => expect(updateCards).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(useV2Canvas.getState().saveState).toBe('saved'))

    expect(updateCards).toHaveBeenCalledWith('board-1', {
      updates: [
        { cardId: 'a', x: 180, y: 170 },
        { cardId: 'b', x: 520, y: 350 },
      ],
    })
    expect(useV2Canvas.getState().nodes.filter((node) => node.selected).map((node) => node.id))
      .toEqual(['a', 'b'])
  })

  it('undoes and redoes an atomic multi-card move', async () => {
    const updateCards = vi.spyOn(v2Api, 'updateCards')
      .mockResolvedValueOnce({ cards: [card('a', 180, 170, 'A'), card('b', 520, 350, 'B')] })
      .mockResolvedValueOnce({ cards: [card('a', 100, 100, 'A'), card('b', 440, 280, 'B')] })
      .mockResolvedValueOnce({ cards: [card('a', 180, 170, 'A'), card('b', 520, 350, 'B')] })

    useV2Canvas.getState().onNodesChange([
      { type: 'position', id: 'a', position: { x: 180, y: 170 }, dragging: false },
      { type: 'position', id: 'b', position: { x: 520, y: 350 }, dragging: false },
    ])
    await vi.waitFor(() => expect(updateCards).toHaveBeenCalledOnce())

    await useV2Canvas.getState().undo()
    expect(updateCards).toHaveBeenNthCalledWith(2, 'board-1', { updates: [
      { cardId: 'a', x: 100, y: 100 },
      { cardId: 'b', x: 440, y: 280 },
    ] })
    expect(useV2Canvas.getState().board?.cards.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 440, y: 280 }])

    await useV2Canvas.getState().redo()
    expect(updateCards).toHaveBeenNthCalledWith(3, 'board-1', { updates: [
      { cardId: 'a', x: 180, y: 170 },
      { cardId: 'b', x: 520, y: 350 },
    ] })
  })

  it('rolls an optimistic move back when atomic position persistence fails', async () => {
    vi.spyOn(v2Api, 'updateCards').mockRejectedValue(new Error('disk unavailable'))
    useV2Canvas.getState().setSelectedCardIds(['a'])

    useV2Canvas.getState().onNodesChange([
      { type: 'position', id: 'a', position: { x: 260, y: 240 }, dragging: false },
    ])

    await vi.waitFor(() => expect(useV2Canvas.getState().saveState).toBe('error'))

    const node = useV2Canvas.getState().nodes.find((candidate) => candidate.id === 'a')
    expect(node?.position).toEqual({ x: 100, y: 100 })
    expect(node?.selected).toBe(true)
    expect(useV2Canvas.getState().message).toContain('位置未保存，已恢复到上次状态')
  })

  it('uses an explicit confirmation before deleting the whole selection', async () => {
    const deleteCards = vi.spyOn(v2Api, 'deleteCards').mockResolvedValue({
      deletedCardIds: ['a', 'b'],
      restoreReceiptId: 'receipt-delete',
    })
    useV2Canvas.getState().setSelectedCardIds(['a', 'b'])

    useV2Canvas.getState().requestDeleteSelectedCards()
    expect(useV2Canvas.getState().deleteConfirmationIds).toEqual(['a', 'b'])
    expect(deleteCards).not.toHaveBeenCalled()

    await useV2Canvas.getState().confirmDeleteSelectedCards()

    expect(deleteCards).toHaveBeenCalledWith('board-1', { cardIds: ['a', 'b'] })
    expect(useV2Canvas.getState().board?.cards).toEqual([])
    expect(useV2Canvas.getState().selectedCardIds).toEqual([])
  })

  it('undoes a deletion by restoring the exact cards and their histories', async () => {
    const before = canvas().cards
    vi.spyOn(v2Api, 'deleteCards').mockResolvedValue({
      deletedCardIds: ['a', 'b'],
      restoreReceiptId: 'receipt-delete',
    })
    const restoreCards = vi.spyOn(v2Api, 'restoreCards').mockResolvedValue({ cards: before })
    useV2Canvas.getState().setSelectedCardIds(['a', 'b'])
    useV2Canvas.getState().requestDeleteSelectedCards()
    await useV2Canvas.getState().confirmDeleteSelectedCards()

    await useV2Canvas.getState().undo()

    expect(restoreCards).toHaveBeenCalledWith('board-1', {
      restoreReceiptId: 'receipt-delete',
    })
    expect(useV2Canvas.getState().historyFuture[0]).not.toHaveProperty('cards')
    expect(useV2Canvas.getState().board?.cards).toEqual(before)
  })

  it('drops a stale deletion entry before undoing an earlier move on the next request', async () => {
    const moved = [card('a', 180, 170, 'A'), card('b', 520, 350, 'B')]
    const updateCards = vi.spyOn(v2Api, 'updateCards')
      .mockResolvedValueOnce({ cards: moved })
      .mockResolvedValueOnce({ cards: canvas().cards })
    vi.spyOn(v2Api, 'deleteCards').mockResolvedValue({
      deletedCardIds: ['a'],
      restoreReceiptId: 'stale-receipt',
    })
    vi.spyOn(v2Api, 'restoreCards').mockRejectedValue(Object.assign(
      new Error('删除回执已失效'),
      { code: 'CARD_RESTORE_CONFLICT', status: 409 },
    ))

    useV2Canvas.getState().onNodesChange([
      { type: 'position', id: 'a', position: { x: 180, y: 170 }, dragging: false },
      { type: 'position', id: 'b', position: { x: 520, y: 350 }, dragging: false },
    ])
    await vi.waitFor(() => expect(updateCards).toHaveBeenCalledOnce())
    useV2Canvas.getState().setSelectedCardIds(['a'])
    useV2Canvas.getState().requestDeleteSelectedCards()
    await useV2Canvas.getState().confirmDeleteSelectedCards()

    await useV2Canvas.getState().undo()
    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
    expect(useV2Canvas.getState().historyPast[0]).toMatchObject({ kind: 'move' })
    expect(useV2Canvas.getState().saveState).toBe('saved')

    await useV2Canvas.getState().undo()
    expect(updateCards).toHaveBeenCalledTimes(2)
    expect(useV2Canvas.getState().board?.cards.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual([{ id: 'b', x: 440, y: 280 }])
  })

  it('keeps a deletion history entry when receipt restoration fails temporarily', async () => {
    vi.spyOn(v2Api, 'deleteCards').mockResolvedValue({
      deletedCardIds: ['a'],
      restoreReceiptId: 'receipt-delete',
    })
    vi.spyOn(v2Api, 'restoreCards').mockRejectedValue(Object.assign(
      new Error('服务暂时不可用'),
      { status: 503 },
    ))
    useV2Canvas.getState().setSelectedCardIds(['a'])
    useV2Canvas.getState().requestDeleteSelectedCards()
    await useV2Canvas.getState().confirmDeleteSelectedCards()

    await useV2Canvas.getState().undo()

    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
    expect(useV2Canvas.getState().historyPast[0]).toMatchObject({
      kind: 'delete',
      restoreReceiptId: 'receipt-delete',
    })
    expect(useV2Canvas.getState().saveState).toBe('error')
  })

  it('replaces a consumed deletion receipt when redo deletes the cards again', async () => {
    const before = canvas().cards
    const deleteCards = vi.spyOn(v2Api, 'deleteCards')
      .mockResolvedValueOnce({ deletedCardIds: ['a', 'b'], restoreReceiptId: 'receipt-1' })
      .mockResolvedValueOnce({ deletedCardIds: ['a', 'b'], restoreReceiptId: 'receipt-2' })
    const restoreCards = vi.spyOn(v2Api, 'restoreCards').mockResolvedValue({ cards: before })
    useV2Canvas.getState().setSelectedCardIds(['a', 'b'])
    useV2Canvas.getState().requestDeleteSelectedCards()
    await useV2Canvas.getState().confirmDeleteSelectedCards()

    await useV2Canvas.getState().undo()
    await useV2Canvas.getState().redo()
    await useV2Canvas.getState().undo()

    expect(deleteCards).toHaveBeenCalledTimes(2)
    expect(restoreCards.mock.calls).toEqual([
      ['board-1', { restoreReceiptId: 'receipt-1' }],
      ['board-1', { restoreReceiptId: 'receipt-2' }],
    ])
  })

  it('undoes and redoes text edits by appending versions from the current Head', async () => {
    const original = canvas().cards[0]
    const edited = revisedCard(original, 'a-v2', '修改后')
    const undone = revisedCard(edited, 'a-v3', 'A')
    const redone = revisedCard(undone, 'a-v4', '修改后')
    const commitVersion = vi.spyOn(v2Api, 'commitVersion')
      .mockResolvedValueOnce({ card: edited })
      .mockResolvedValueOnce({ card: undone })
      .mockResolvedValueOnce({ card: redone })

    await useV2Canvas.getState().commitCard('a', '修改后')
    await useV2Canvas.getState().undo()
    await useV2Canvas.getState().redo()

    expect(commitVersion.mock.calls).toEqual([
      ['board-1', 'a', { baseVersionId: 'a-v1', markdown: '修改后' }],
      ['board-1', 'a', { baseVersionId: 'a-v2', markdown: 'A' }],
      ['board-1', 'a', { baseVersionId: 'a-v3', markdown: '修改后' }],
    ])
    expect(useV2Canvas.getState().board?.cards[0]).toEqual(redone)
  })

  it('defensively exits editing when a file-reference card reaches commit', async () => {
    const board = canvas()
    board.cards[0] = {
      ...board.cards[0],
      contentKind: 'file-reference',
      headVersionId: 'a-file-v1',
      versions: [{
        id: 'a-file-v1', cardId: 'a', sequence: 1,
        content: { kind: 'file-reference', path: 'docs/a.md', readonly: true },
        digest: 'a-file', origin: 'human', createdAt: now,
      }],
    }
    resetTo(board)
    useV2Canvas.setState({ editingCardId: 'a' })

    await useV2Canvas.getState().commitCard('a', '')

    expect(useV2Canvas.getState().editingCardId).toBeNull()
  })
})
