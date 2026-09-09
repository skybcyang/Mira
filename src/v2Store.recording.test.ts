import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import { v2Api } from './v2Api'
import { useV2Canvas } from './v2Store'

const now = '2026-09-07T00:00:00.000Z'
function card(id = 'a', markdown = 'Original'): ContentCard {
  return {
    id, contentKind: 'markdown', x: 100, y: 100, width: 300, height: 180,
    headVersionId: `${id}-v1`, versions: [{ id: `${id}-v1`, cardId: id,
      sequence: 1, content: { kind: 'markdown', markdown }, digest: id,
      origin: 'human', createdAt: now }], createdAt: now, updatedAt: now,
  }
}
function savedCard(markdown = 'Saved') {
  const original = card()
  return { ...original, headVersionId: 'a-v2', versions: [...original.versions, {
    ...original.versions[0], id: 'a-v2', sequence: 2,
    content: { kind: 'markdown' as const, markdown },
  }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function reset() {
  const board: BoardV2 = { schemaVersion: 2, id: 'recording', title: 'Recording',
    cards: [card()], transformations: [], viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now, updatedAt: now }
  useV2Canvas.setState({ board, boardId: board.id, runs: {}, selectedCardIds: ['a'],
    drawer: { tab: 'content', cardId: 'a' }, panel: null, detailSurfaceRevision: 0,
    editingCardId: 'a', saveState: 'saved', message: null, notices: [],
    historyPast: [], historyFuture: [], workflowDraft: null })
}
beforeEach(reset)
afterEach(() => vi.restoreAllMocks())

describe('independent card names', () => {
  it('does not let an older body receipt erase a completed rename', async () => {
    const response = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(response.promise)
    const saving = useV2Canvas.getState().commitCard('a', 'Saved', 'a-v1')
    vi.spyOn(v2Api, 'updateCard').mockResolvedValue({ card: { ...savedCard(), name: '新的名称' } })
    expect(await useV2Canvas.getState().renameCard('a', '新的名称', null)).toBe(true)
    response.resolve({ card: savedCard() })
    expect(await saving).toBe(true)
    expect(useV2Canvas.getState().board?.cards[0]).toMatchObject({ name: '新的名称', headVersionId: 'a-v2' })
  })

  it('merges a name response without reverting a newer body or geometry', async () => {
    const response = deferred<{ card: ContentCard }>()
    const update = vi.spyOn(v2Api, 'updateCard').mockReturnValue(response.promise)
    const renaming = useV2Canvas.getState().renameCard('a', '我的笔记', null)
    useV2Canvas.setState((state) => ({ board: { ...state.board!, cards: [{ ...savedCard(), x: 900 }] } }))
    response.resolve({ card: { ...card(), name: '我的笔记' } })
    expect(await renaming).toBe(true)
    expect(update).toHaveBeenCalledWith('recording', 'a', { name: '我的笔记', baseName: null })
    expect(useV2Canvas.getState().board?.cards[0]).toMatchObject({ name: '我的笔记', headVersionId: 'a-v2', x: 900 })
    expect(useV2Canvas.getState().historyPast).toEqual([])
  })

  it('loads a conflicting name without changing body or retrying the write', async () => {
    const update = vi.spyOn(v2Api, 'updateCard').mockRejectedValue(Object.assign(new Error('conflict'), { code: 'CARD_NAME_CONFLICT' }))
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: { ...useV2Canvas.getState().board!, cards: [{ ...card(), name: '别人修改的名称' }] } })
    useV2Canvas.setState((state) => ({ board: { ...state.board!, cards: [savedCard()] } }))
    expect(await useV2Canvas.getState().renameCard('a', '我的草稿', null)).toBe(false)
    expect(update).toHaveBeenCalledOnce()
    expect(useV2Canvas.getState().board?.cards[0]).toMatchObject({ name: '别人修改的名称', headVersionId: 'a-v2' })
    expect(useV2Canvas.getState().notices).toHaveLength(1)
    update.mockResolvedValue({ card: { ...savedCard(), name: '我的草稿' } })
    expect(await useV2Canvas.getState().renameCard('a', '我的草稿', '别人修改的名称')).toBe(true)
    expect(useV2Canvas.getState().notices).toHaveLength(0)
  })

  it('ignores responses after switching boards', async () => {
    const response = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'updateCard').mockReturnValue(response.promise)
    const renaming = useV2Canvas.getState().renameCard('a', '名字', null)
    useV2Canvas.setState({ boardId: 'other' })
    response.resolve({ card: { ...card(), name: '名字' } })
    expect(await renaming).toBe(false)
    expect(useV2Canvas.getState().board?.cards[0].name).toBeUndefined()
  })
})

describe('recording saves', () => {
  it('returns explicit success without duplicating an unchanged version', async () => {
    const commit = vi.spyOn(v2Api, 'commitVersion')
    expect(await useV2Canvas.getState().commitCard('a', 'Original', 'a-v1')).toBe(true)
    expect(commit).not.toHaveBeenCalled()
  })

  it('rejects an obsolete draft baseline even when its body matches the latest head', async () => {
    const commit = vi.spyOn(v2Api, 'commitVersion')
    expect(await useV2Canvas.getState().commitCard('a', 'Original', 'older')).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().editingCardId).toBe('a')
    expect(useV2Canvas.getState().saveState).toBe('error')
  })

  it('returns false on save error while preserving draft editing state', async () => {
    vi.spyOn(v2Api, 'commitVersion').mockRejectedValue(new Error('offline'))
    expect(await useV2Canvas.getState().commitCard('a', 'Changed', 'a-v1')).toBe(false)
    expect(useV2Canvas.getState().editingCardId).toBe('a')
  })

  it('saves before creating one same-sized empty card and rejects duplicate submissions', async () => {
    const saved = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(saved.promise)
    const next = { ...card('next'), x: 100, y: 304, headVersionId: null, versions: [] }
    const create = vi.spyOn(v2Api, 'createCard').mockResolvedValue({ card: next })
    const recording = useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')
    expect(create).not.toHaveBeenCalled()
    expect(await useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')).toEqual({ status: 'busy' })
    saved.resolve({ card: savedCard() })
    expect(await recording).toEqual({ status: 'created', card: next })
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith('recording', {
      x: 100, y: 304, width: 300, height: 180, markdown: '',
    })
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'next', mode: 'edit' })
    expect(useV2Canvas.getState().historyPast).toHaveLength(1)
  })

  it('does not create after a failed save', async () => {
    vi.spyOn(v2Api, 'commitVersion').mockRejectedValue(new Error('offline'))
    const create = vi.spyOn(v2Api, 'createCard')
    expect(await useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')).toEqual({ status: 'save-failed' })
    expect(create).not.toHaveBeenCalled()
  })

  it('preserves saved content when creation has an explicit rejection', async () => {
    vi.spyOn(v2Api, 'commitVersion').mockResolvedValue({ card: savedCard() })
    vi.spyOn(v2Api, 'createCard').mockRejectedValue(Object.assign(new Error('readonly'), { status: 409 }))
    expect(await useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')).toEqual({ status: 'creation-failed' })
    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe('a-v2')
  })

  it('classifies lost creation receipts as uncertain, without retrying', async () => {
    const create = vi.spyOn(v2Api, 'createCard').mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await useV2Canvas.getState().saveAndCreateNext('a', 'Original', 'a-v1')).toEqual({ status: 'creation-uncertain' })
    expect(create).toHaveBeenCalledOnce()
    expect(useV2Canvas.getState().board?.cards).toHaveLength(1)
  })

  it('does not create or replace newer navigation after the user leaves during save', async () => {
    const saved = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(saved.promise)
    const create = vi.spyOn(v2Api, 'createCard')
    const recording = useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')
    useV2Canvas.getState().openPanel('model')
    saved.resolve({ card: savedCard() })
    expect(await recording).toEqual({ status: 'cancelled' })
    expect(create).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().panel).toBe('model')
  })

  it('ignores a save response older than a newer head already observed locally', async () => {
    const saved = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(saved.promise)
    const saving = useV2Canvas.getState().commitCard('a', 'Saved', 'a-v1')
    const newer = { ...savedCard('Newer'), headVersionId: 'a-v3', versions: [
      ...savedCard().versions, { ...savedCard().versions[1], id: 'a-v3', sequence: 3,
        content: { kind: 'markdown' as const, markdown: 'Newer' } },
    ] }
    useV2Canvas.setState((state) => ({ board: { ...state.board!, cards: [newer] } }))
    saved.resolve({ card: savedCard() })
    expect(await saving).toBe(true)
    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe('a-v3')
  })

  it('does not create after a board switch during save', async () => {
    const saved = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(saved.promise)
    const create = vi.spyOn(v2Api, 'createCard')
    const recording = useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')
    useV2Canvas.setState({ boardId: 'other', editingCardId: 'other-card' })
    saved.resolve({ card: savedCard() })
    expect(await recording).toEqual({ status: 'cancelled' })
    expect(create).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().editingCardId).toBe('other-card')
  })

  it('inserts a late created card but does not replace newer same-board navigation', async () => {
    const created = deferred<{ card: ContentCard }>()
    const create = vi.spyOn(v2Api, 'createCard').mockReturnValue(created.promise)
    const recording = useV2Canvas.getState().saveAndCreateNext('a', 'Original', 'a-v1')
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    useV2Canvas.getState().openPanel('model')
    created.resolve({ card: { ...card('next'), headVersionId: null, versions: [] } })
    expect(await recording).toEqual({ status: 'cancelled' })
    expect(useV2Canvas.getState().board?.cards).toHaveLength(2)
    expect(useV2Canvas.getState().panel).toBe('model')
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['a'])
  })

  it('avoids nearby cards and copies only geometry', async () => {
    useV2Canvas.setState((state) => ({ board: { ...state.board!, cards: [
      { ...card(), tags: ['tag'], color: 'blue' }, { ...card('blocker'), y: 304 },
    ] } }))
    const create = vi.spyOn(v2Api, 'createCard').mockResolvedValue({ card: card('next') })
    await useV2Canvas.getState().saveAndCreateNext('a', 'Original', 'a-v1')
    expect(create).toHaveBeenCalledWith('recording', {
      x: 424, y: 304, width: 300, height: 180, markdown: '',
    })
  })

  it('retries a confirmed failed create without another version', async () => {
    const commit = vi.spyOn(v2Api, 'commitVersion').mockResolvedValue({ card: savedCard() })
    const create = vi.spyOn(v2Api, 'createCard')
      .mockRejectedValueOnce(Object.assign(new Error('invalid'), { status: 422 }))
      .mockResolvedValueOnce({ card: card('next') })
    await useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v1')
    expect((await useV2Canvas.getState().saveAndCreateNext('a', 'Saved', 'a-v2')).status).toBe('created')
    expect(commit).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledTimes(2)
  })
})
