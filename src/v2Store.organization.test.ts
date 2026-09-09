import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2 } from './domain'
import { useV2Canvas } from './v2Store'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'

function reset() {
  const board: BoardV2 = {
    schemaVersion: 2, id: 'board', title: 'Board', createdAt: 'now', updatedAt: 'now',
    viewport: { x: 0, y: 0, zoom: 1 }, transformations: [],
    cards: ['a', 'b'].map((id, i) => ({ id, x: i * 400, y: 100, width: 312, height: 208,
      contentKind: 'markdown', headVersionId: null, versions: [], createdAt: 'now', updatedAt: 'now' })),
    groups: [{ id: 'g', title: 'Research', cardIds: ['a', 'b'] }],
  }
  useV2Canvas.setState({ boardId: board.id, board, ...projectV2Board(board, {}), runs: {},
    selectedCardIds: ['b', 'a'], selectedGroupId: null, organizationPending: false,
    saveState: 'saved', historyPast: [], historyFuture: [], historyState: 'idle',
    notices: [], message: null, loadState: 'ready', workflowDraft: null })
  return board
}
beforeEach(reset)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockAPI() {
  return vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body)
    return { ok: true, json: async () => ({ groups: body.groups || useV2Canvas.getState().board?.groups || [], cards: [], transformations: [] }) }
  }))
}

describe('organization commands and history', () => {
  it('records combined size and position changes once and replays both dimensions without changing ordered selection', async () => {
    mockAPI()
    const original = structuredClone(useV2Canvas.getState().board!)
    const request = {
      sizes: original.cards.map((card) => ({ cardId: card.id, width: 440, height: 320, baseWidth: card.width, baseHeight: card.height })),
      positions: [{ kind: 'card' as const, id: 'b', x: 600, y: 100, baseX: 400, baseY: 100 }],
    }
    expect(await useV2Canvas.getState().submitOrganization(request)).toBe(true)
    expect(useV2Canvas.getState().board?.cards.map(({ width, height }) => [width, height])).toEqual([[440, 320], [440, 320]])
    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['b', 'a'])
    await useV2Canvas.getState().undo()
    expect(useV2Canvas.getState().board).toEqual(original)
    await useV2Canvas.getState().redo()
    expect(useV2Canvas.getState().board?.cards[1]).toMatchObject({ width: 440, height: 320, x: 600 })
    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
  })

  it('preserves newer Head and versions while a size request completes', async () => {
    const old = structuredClone(useV2Canvas.getState().board!)
    let finish!: (value: { groups: NonNullable<BoardV2['groups']>; cards: BoardV2['cards']; transformations: [] }) => void
    vi.spyOn(v2Api, 'updateOrganization').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = useV2Canvas.getState().submitOrganization({ sizes: [{ cardId: 'a', width: 560, height: 480, baseWidth: 312, baseHeight: 208 }] })
    const next = structuredClone(old)
    next.cards[0].headVersionId = 'new-head'
    next.cards[0].updatedAt = 'later'
    useV2Canvas.setState({ board: next })
    finish({ groups: old.groups!, cards: old.cards, transformations: [] })
    await pending
    expect(useV2Canvas.getState().board?.cards[0]).toEqual({ ...next.cards[0], width: 560, height: 480 })
  })
  it('retires a conflicting organization history with an explicit notice and preserves earlier history', async () => {
    mockAPI()
    await useV2Canvas.getState().setSelectedCardColor('blue')
    const older = { kind: 'move' as const, boardId: 'board', before: [{ cardId: 'a', x: -10, y: 100 }], after: [{ cardId: 'a', x: 0, y: 100 }] }
    useV2Canvas.setState((state) => ({ historyPast: [older, ...state.historyPast] }))
    vi.spyOn(v2Api, 'updateOrganization').mockRejectedValue(Object.assign(new Error('conflict'), { code: 'ORGANIZATION_CONFLICT' }))
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: useV2Canvas.getState().board! })
    await useV2Canvas.getState().undo()
    expect(useV2Canvas.getState().historyPast).toEqual([older])
    expect(useV2Canvas.getState().message).toContain('已从历史移除')
  })
  it('still accepts ReactFlow measurements while an organization write is pending', () => {
    useV2Canvas.setState({ organizationPending: true })
    useV2Canvas.getState().onNodesChange([{ type: 'dimensions', id: 'a', dimensions: { width: 312, height: 208 } }])
    expect(useV2Canvas.getState().nodes.find((node) => node.id === 'a')?.measured).toEqual({ width: 312, height: 208 })
  })
  it('clears group selection when ReactFlow selects a card at drag start', () => {
    useV2Canvas.getState().selectGroup('g')
    useV2Canvas.getState().onNodesChange([{ type: 'select', id: 'a', selected: true }])
    expect(useV2Canvas.getState()).toMatchObject({ selectedGroupId: null, selectedCardIds: ['a'] })
  })
  it('freezes group membership at drag start instead of moving newly added members', async () => {
    mockAPI()
    const board = structuredClone(useV2Canvas.getState().board!)
    board.groups![0].cardIds = ['a']
    useV2Canvas.setState({ board })
    useV2Canvas.getState().selectGroup('g')
    const node = useV2Canvas.getState().nodes.find((n) => n.id === 'canvas-group:g')!
    const move = { id: node.id, type: 'position' as const, position: { x: node.position.x + 100, y: node.position.y }, dragging: true }
    useV2Canvas.getState().handleGroupChanges([move])
    useV2Canvas.setState({ board: { ...board, groups: [{ ...board.groups![0], cardIds: ['a', 'b'] }] } })
    useV2Canvas.getState().handleGroupChanges([{ ...move, dragging: false }])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.positions.map((item: { id: string }) => item.id)).toEqual(['a'])
    expect(body.baseGroups[0].cardIds).toEqual(['a'])
  })
  it('does not pop a newer history entry when a pending organization undo finishes', async () => {
    mockAPI()
    await useV2Canvas.getState().setSelectedCardColor('blue')
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    const pending = useV2Canvas.getState().undo()
    const newer = { kind: 'create' as const, boardId: 'board', cardIds: ['new'] }
    useV2Canvas.setState((state) => ({ historyPast: [...state.historyPast, newer] }))
    finish({ ok: true, json: async () => ({ groups: useV2Canvas.getState().board?.groups, cards: [], transformations: [] }) })
    await pending
    const past = useV2Canvas.getState().historyPast
    expect(past[past.length - 1]).toEqual(newer)
    expect(useV2Canvas.getState().historyFuture).toEqual([])
  })

  it('updates membership after dismissing an empty grouped card', async () => {
    vi.spyOn(v2Api, 'deleteCard').mockResolvedValue({ deletedCardId: 'a', restoreReceiptId: 'receipt', groups: [{ id: 'g', title: 'Research', cardIds: ['b'] }] })
    await useV2Canvas.getState().commitCard('a', '')
    expect(useV2Canvas.getState().board?.groups?.[0].cardIds).toEqual(['b'])
  })
  it('sets a batch color without changing ordered sources and reverses it in one undo', async () => {
    mockAPI()
    const action = useV2Canvas.getState().setSelectedCardColor
    expect(action).toBeTypeOf('function')
    if (!action) return
    await action('green')
    expect(useV2Canvas.getState().board?.cards.map((c) => c.color)).toEqual(['green', 'green'])
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['b', 'a'])
    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
    await useV2Canvas.getState().undo()
    expect(useV2Canvas.getState().board?.cards.map((c) => c.color)).toEqual([undefined, undefined])
    await useV2Canvas.getState().redo()
    expect(useV2Canvas.getState().board?.cards[0].color).toBe('green')
  })

  it('keeps content advanced during a color request', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    const action = useV2Canvas.getState().setSelectedCardColor
    expect(action).toBeTypeOf('function')
    if (!action) return
    const saving = action('blue')
    const board = structuredClone(useV2Canvas.getState().board!)
    board.cards[0].headVersionId = 'new-head'
    useV2Canvas.setState({ board })
    finish({ ok: true, json: async () => ({ groups: board.groups, cards: [], transformations: [] }) })
    await saving
    expect(useV2Canvas.getState().board?.cards[0]).toMatchObject({ color: 'blue', headVersionId: 'new-head' })
  })

  it('preserves groups, cards and history on a failed write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const action = useV2Canvas.getState().transferSelectedCards
    expect(action).toBeTypeOf('function')
    if (!action) return
    const before = structuredClone(useV2Canvas.getState().board)
    expect(await action(null)).toBe(false)
    expect(useV2Canvas.getState().board).toEqual(before)
    expect(useV2Canvas.getState().historyPast).toEqual([])
  })

  it('separates group selection from model sources', () => {
    const action = useV2Canvas.getState().selectGroup
    expect(action).toBeTypeOf('function')
    if (!action) return
    action('g')
    expect(useV2Canvas.getState()).toMatchObject({ selectedGroupId: 'g', selectedCardIds: [] })
    useV2Canvas.getState().selectGroupCards('g')
    expect(useV2Canvas.getState()).toMatchObject({ selectedGroupId: null, selectedCardIds: ['a', 'b'] })
  })

  it('previews and commits a group drag without changing membership', async () => {
    mockAPI()
    const action = useV2Canvas.getState().handleGroupChanges
    expect(action).toBeTypeOf('function')
    if (!action) return
    useV2Canvas.getState().selectGroup('g')
    const start = useV2Canvas.getState().nodes.find((n) => n.id === 'canvas-group:g')!.position
    action([{ id: 'canvas-group:g', type: 'position', position: { x: start.x + 900, y: start.y }, dragging: true }])
    expect(useV2Canvas.getState().nodes.find((n) => n.id === 'a')?.position.x).toBe(900)
    expect(useV2Canvas.getState().board?.cards[0].x).toBe(0)
    action([{ id: 'canvas-group:g', type: 'position', position: { x: start.x + 900, y: start.y }, dragging: false }])
    await vi.waitFor(() => expect(useV2Canvas.getState().board?.cards[0].x).toBe(900))
    expect(useV2Canvas.getState().board?.groups?.[0].cardIds).toEqual(['a', 'b'])
    await useV2Canvas.getState().undo()
    expect(useV2Canvas.getState().board?.cards[0].x).toBe(0)
  })

  it('ignores late organization results after switching boards', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    const action = useV2Canvas.getState().setSelectedCardColor
    expect(action).toBeTypeOf('function')
    if (!action) return
    const pending = action('red')
    const other = { ...useV2Canvas.getState().board!, id: 'other' }
    useV2Canvas.setState({ boardId: 'other', board: other })
    finish({ ok: true, json: async () => ({ groups: [], cards: [], transformations: [] }) })
    await pending
    expect(useV2Canvas.getState().board).toBe(other)
    expect(useV2Canvas.getState().historyPast).toHaveLength(0)
  })
})
