import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BoardV2,
  ContentCard,
  Transformation,
  TransformationRun,
} from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'
import { portableDownloads } from './v2/portableDownloads'

const now = '2026-08-23T00:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function card(id: string, versionId = `${id}-v1`, markdown = `# ${id}`): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `digest-${versionId}`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function transformation(
  id: string,
  sourceCardIds: string[],
  targetCardId: string,
  lastRunId?: string,
): Transformation {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: id,
    instruction: `执行 ${id}`,
    acceptance: '',
    permissions: { workspaceWrite: false },
    ...(lastRunId ? { lastRunId } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function board(
  id: string,
  cards: ContentCard[] = [card(`${id}-source`)],
  transformations: Transformation[] = [],
): BoardV2 {
  return {
    schemaVersion: 2,
    id,
    title: id,
    cards,
    transformations,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function run(
  id: string,
  boardId: string,
  status: TransformationRun['status'],
): TransformationRun {
  return {
    id,
    boardId,
    transformationId: `${boardId}-transformation`,
    status,
    sourceSnapshot: [],
    targetCardId: `${boardId}-target`,
    targetBaseVersionId: null,
    intent: 'create',
    ...(status === 'succeeded'
      ? { result: { output: '# 完成', digest: 'done', disposition: 'applied' as const } }
      : {}),
    createdAt: now,
  }
}

function resetTo(canvas: BoardV2) {
  useV2Canvas.setState({
    boardId: canvas.id,
    board: canvas,
    boards: [{ id: canvas.id, title: canvas.title }],
    boardCatalog: [],
    boardCatalogState: 'idle',
    boardCatalogError: null,
    ...projectV2Board(canvas, {}),
    runs: {},
    selectedCardIds: [],
    suggestions: [],
    suggestionState: 'idle',
    applyingWorkflowId: null,
    branchDraft: null,
    drawer: null,
    editingCardId: null,
    message: null,
    notices: [],
    loadState: 'ready',
    saveState: 'saved',
  })
}

function summary(
  id: string,
  state: 'active' | 'archived' | 'trashed' = 'active',
  revision = 0,
) {
  return { id, title: id, state, revision, updatedAt: now }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function latestNotice() {
  const notices = useV2Canvas.getState().notices
  return notices[notices.length - 1]
}

beforeEach(() => {
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  })
  resetTo(board('home'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('board navigation lifecycle', () => {
  it('keeps the old detail visible but refuses to replace it while switching boards', async () => {
    const nextBoard = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'getBoard').mockReturnValue(nextBoard.promise)
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'home-source' })

    const switchPending = useV2Canvas.getState().switchBoard('next')

    expect(useV2Canvas.getState()).toMatchObject({
      loadState: 'loading',
      drawer: { tab: 'content', cardId: 'home-source' },
    })
    useV2Canvas.getState().openDrawer({ tab: 'versions', cardId: 'home-source' })
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'home-source' })

    nextBoard.resolve({ board: board('next') })
    await switchPending
  })

  it('refuses to open a board that became archived while navigation was pending', async () => {
    const archived = {
      ...board('target'),
      lifecycle: { state: 'archived' as const },
      revision: 1,
    }
    const archiveResponse = deferred<{ board: BoardV2 }>()
    const targetResponse = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'archiveBoard').mockReturnValue(archiveResponse.promise)
    vi.spyOn(v2Api, 'getBoard').mockReturnValue(targetResponse.promise)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('home')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [
      summary('home'), summary('target', 'archived', 1),
    ] })

    const archiving = useV2Canvas.getState().archiveBoard('target', 0)
    const switching = useV2Canvas.getState().switchBoard('target')
    archiveResponse.resolve({ board: archived })
    await archiving
    targetResponse.resolve({ board: archived })

    await expect(switching).rejects.toThrow('不在工作中')
    expect(useV2Canvas.getState()).toMatchObject({
      boardId: 'home',
      loadState: 'ready',
    })
    expect(useV2Canvas.getState().boardCatalog).toContainEqual(
      expect.objectContaining({ id: 'target', state: 'archived' }),
    )
  })

  it('keeps the latest board when an older open request resolves last', async () => {
    const slow = deferred<{ board: BoardV2 }>()
    const fast = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'getBoard').mockImplementation((boardId) =>
      boardId === 'slow' ? slow.promise : fast.promise,
    )

    const openSlow = useV2Canvas.getState().switchBoard('slow')
    const openFast = useV2Canvas.getState().switchBoard('fast')
    fast.resolve({ board: board('fast') })
    await openFast
    slow.resolve({ board: board('slow') })
    await openSlow

    expect(useV2Canvas.getState().boardId).toBe('fast')
    expect(useV2Canvas.getState().board?.id).toBe('fast')
  })

  it('keeps an earlier card creation scoped to the old board until navigation commits', async () => {
    const created = deferred<{ card: ContentCard }>()
    const nextBoard = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'createCard').mockReturnValue(created.promise)
    vi.spyOn(v2Api, 'getBoard').mockReturnValue(nextBoard.promise)

    const createPending = useV2Canvas.getState().createCard({ x: 100, y: 120 })
    const switchPending = useV2Canvas.getState().switchBoard('next')
    created.resolve({ card: card('stale-created') })
    await createPending

    expect(useV2Canvas.getState().board?.cards.some((item) => item.id === 'stale-created'))
      .toBe(true)

    nextBoard.resolve({ board: board('next') })
    await switchPending
    expect(useV2Canvas.getState().board?.cards.some((item) => item.id === 'stale-created'))
      .toBe(false)
  })

  it('keeps navigation failures observable to task-level UI callbacks', async () => {
    vi.spyOn(v2Api, 'getBoard').mockRejectedValueOnce(new Error('open failed'))
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'home-source' })
    useV2Canvas.getState().setEditingCardId('home-source')

    await expect(useV2Canvas.getState().switchBoard('missing')).rejects.toThrow('open failed')
    expect(useV2Canvas.getState()).toMatchObject({
      boardId: 'home',
      loadState: 'ready',
      drawer: { tab: 'content', cardId: 'home-source' },
      editingCardId: 'home-source',
    })
    expect(latestNotice()?.message).toContain('open failed')

    vi.spyOn(v2Api, 'createBoard').mockRejectedValueOnce(new Error('create failed'))
    await expect(useV2Canvas.getState().createBoard('新画板')).rejects.toThrow('create failed')
  })

  it('records a durably created board even when catalog reconciliation fails', async () => {
    const created = board('created')
    vi.spyOn(v2Api, 'createBoard').mockResolvedValue({ boardId: created.id, board: created })
    vi.spyOn(v2Api, 'listBoards').mockRejectedValue(new Error('catalog unavailable'))
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('home')] })

    await expect(useV2Canvas.getState().createBoard('Created')).resolves.toBeUndefined()

    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'home', loadState: 'ready' })
    expect(useV2Canvas.getState().boardCatalog.map((item) => item.id)).toContain('created')
    expect(latestNotice()?.message).toContain('已创建')
    expect(latestNotice()?.message).toContain('暂时无法打开')
  })

  it('records a durably created board without overtaking newer navigation', async () => {
    const createPending = deferred<{ boardId: string; board: BoardV2 }>()
    const nextPending = deferred<{ board: BoardV2 }>()
    const created = board('created')
    vi.spyOn(v2Api, 'createBoard').mockReturnValue(createPending.promise)
    vi.spyOn(v2Api, 'getBoard').mockReturnValue(nextPending.promise)

    const creating = useV2Canvas.getState().createBoard('Created')
    const switching = useV2Canvas.getState().switchBoard('next')
    createPending.resolve({ boardId: created.id, board: created })
    await creating

    expect(useV2Canvas.getState().boardCatalog.map((item) => item.id)).toContain(created.id)
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'home', loadState: 'loading' })

    nextPending.resolve({ board: board('next') })
    await switching
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'next', loadState: 'ready' })
  })

  it('does not let an older lifecycle response erase a concurrent card write', async () => {
    const current = useV2Canvas.getState().board!
    const created = card('created')
    const createResponse = deferred<{ card: ContentCard }>()
    const renameResponse = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'createCard').mockReturnValue(createResponse.promise)
    vi.spyOn(v2Api, 'renameBoard').mockReturnValue(renameResponse.promise)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('home', 'active', 1)] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('home', 'active', 1)] })

    const creating = useV2Canvas.getState().createCard({ x: 120, y: 140 })
    const renaming = useV2Canvas.getState().renameBoard('home', 'Renamed', 0)
    createResponse.resolve({ card: created })
    await creating
    renameResponse.resolve({ board: { ...current, title: 'Renamed', revision: 1 } })
    await renaming

    expect(useV2Canvas.getState().board?.title).toBe('Renamed')
    expect(useV2Canvas.getState().board?.cards.map((item) => item.id)).toContain(created.id)
    expect(useV2Canvas.getState().selectedCardIds).toEqual([created.id])
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: created.id, mode: 'edit' })
  })

  it('keeps selection and drawer owned by the latest concurrent card request', async () => {
    const first = deferred<{ card: ContentCard }>()
    const second = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'createCard')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstPending = useV2Canvas.getState().createCard({ x: 100, y: 120 })
    const secondPending = useV2Canvas.getState().createCard({ x: 500, y: 120 })
    second.resolve({ card: { ...card('second'), x: 500, y: 120 } })
    await secondPending
    useV2Canvas.setState({ editingCardId: 'second' })
    first.resolve({ card: { ...card('first'), x: 100, y: 120 } })
    await firstPending

    expect(useV2Canvas.getState().board?.cards.map((item) => item.id))
      .toEqual(['home-source', 'second', 'first'])
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['second'])
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'second', mode: 'edit' })
    expect(useV2Canvas.getState().editingCardId).toBe('second')
  })

  it('lets the newest successful card own navigation when a later request fails first', async () => {
    const first = deferred<{ card: ContentCard }>()
    const second = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'createCard')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstPending = useV2Canvas.getState().createCard({ x: 100, y: 120 })
    const secondPending = useV2Canvas.getState().createCard({ x: 500, y: 120 })
    second.reject(new Error('second failed'))
    await secondPending
    first.resolve({ card: { ...card('first'), x: 100, y: 120 } })
    await firstPending

    expect(useV2Canvas.getState().selectedCardIds).toEqual(['first'])
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'first', mode: 'edit' })
  })

  it('promotes an earlier successful card only after the later request fails', async () => {
    const first = deferred<{ card: ContentCard }>()
    const second = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'createCard')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstPending = useV2Canvas.getState().createCard({ x: 100, y: 120 })
    const secondPending = useV2Canvas.getState().createCard({ x: 500, y: 120 })
    first.resolve({ card: { ...card('first'), x: 100, y: 120 } })
    await firstPending
    expect(useV2Canvas.getState().drawer).toBeNull()

    second.reject(new Error('second failed'))
    await secondPending

    expect(useV2Canvas.getState().selectedCardIds).toEqual(['first'])
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'first', mode: 'edit' })
  })

  it('upserts a created card when a concurrent refresh already contains it', async () => {
    const pending = deferred<{ card: ContentCard }>()
    const created = { ...card('created'), x: 120, y: 140 }
    vi.spyOn(v2Api, 'createCard').mockReturnValue(pending.promise)

    const creating = useV2Canvas.getState().createCard({ x: 120, y: 140 })
    useV2Canvas.setState((state) => ({
      board: state.board ? { ...state.board, cards: [...state.board.cards, created] } : null,
    }))
    pending.resolve({ card: created })
    await creating

    expect(useV2Canvas.getState().board?.cards.filter((item) => item.id === created.id))
      .toHaveLength(1)
  })

  it.each(['before', 'after'] as const)(
    'keeps an old-board card that finishes %s a failed switch',
    async (timing) => {
      const created = deferred<{ card: ContentCard }>()
      const target = deferred<{ board: BoardV2 }>()
      vi.spyOn(v2Api, 'createCard').mockReturnValue(created.promise)
      vi.spyOn(v2Api, 'getBoard').mockReturnValue(target.promise)

      const createPending = useV2Canvas.getState().createCard({ x: 100, y: 120 })
      const switchPending = useV2Canvas.getState().switchBoard('missing')
      if (timing === 'before') {
        created.resolve({ card: card('committed') })
        await createPending
      }
      target.reject(new Error('open failed'))
      await expect(switchPending).rejects.toThrow('open failed')
      if (timing === 'after') {
        created.resolve({ card: card('committed') })
        await createPending
      }

      expect(useV2Canvas.getState().board?.cards.map((item) => item.id))
        .toContain('committed')
      expect(useV2Canvas.getState().loadState).toBe('ready')
    },
  )
})

describe('board catalog, lifecycle, and portability commands', () => {
  it('does not let an older catalog reload overwrite a committed lifecycle update', async () => {
    const staleCatalog = deferred<{ boards: ReturnType<typeof summary>[] }>()
    const currentCatalog = [summary('home'), summary('target', 'archived', 1)]
    useV2Canvas.setState({
      boardCatalog: [summary('home'), summary('target')],
      boards: [summary('home'), summary('target')],
    })
    vi.spyOn(v2Api, 'listBoardCatalog')
      .mockReturnValueOnce(staleCatalog.promise)
      .mockResolvedValueOnce({ boards: currentCatalog })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('home')] })
    vi.spyOn(v2Api, 'archiveBoard').mockResolvedValue({
      board: {
        ...board('target'),
        lifecycle: { state: 'archived' },
        revision: 1,
      },
    })

    const reloading = useV2Canvas.getState().refreshBoardCatalog()
    await flushMicrotasks()
    await useV2Canvas.getState().archiveBoard('target', 0)
    staleCatalog.resolve({ boards: [summary('home'), summary('target')] })
    await reloading

    expect(useV2Canvas.getState().boards).toEqual([summary('home')])
    expect(useV2Canvas.getState().boardCatalog).toEqual(currentCatalog)
    expect(useV2Canvas.getState().boardCatalogState).toBe('ready')
  })

  it('loads the complete catalog independently and rejects reload failures for row-level UI', async () => {
    const catalog = [summary('home'), summary('archive', 'archived', 2)]
    const listCatalog = vi.spyOn(v2Api, 'listBoardCatalog')
      .mockResolvedValueOnce({ boards: catalog })
      .mockRejectedValueOnce(new Error('catalog offline'))

    await useV2Canvas.getState().refreshBoardCatalog()
    expect(useV2Canvas.getState()).toMatchObject({
      boardCatalog: catalog,
      boardCatalogState: 'ready',
      boardCatalogError: null,
    })

    await expect(useV2Canvas.getState().refreshBoardCatalog())
      .rejects.toThrow('catalog offline')
    expect(useV2Canvas.getState().boardCatalog).toEqual(catalog)
    expect(useV2Canvas.getState().boardCatalogState).toBe('error')
    expect(useV2Canvas.getState().boardCatalogError).toContain('catalog offline')
    expect(listCatalog).toHaveBeenCalledTimes(2)
  })

  it('renames with the visible revision, refreshes both lists, and updates the current title', async () => {
    const renamed = { ...board('home'), title: '新标题', revision: 5 }
    const rename = vi.spyOn(v2Api, 'renameBoard').mockResolvedValue({ board: renamed })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [
      { ...summary('home', 'active', 5), title: '新标题' },
    ] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [
      { ...summary('home', 'active', 5), title: '新标题' },
    ] })

    await useV2Canvas.getState().renameBoard('home', '新标题', 4)

    expect(rename).toHaveBeenCalledWith('home', '新标题', 4)
    expect(useV2Canvas.getState().board?.title).toBe('新标题')
    expect(useV2Canvas.getState().boards[0].title).toBe('新标题')
    expect(useV2Canvas.getState().boardCatalog[0].revision).toBe(5)
  })

  it('opens another active board after archiving the current board', async () => {
    vi.spyOn(v2Api, 'archiveBoard').mockResolvedValue({
      board: { ...board('home'), lifecycle: { state: 'archived' }, revision: 2 },
    })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('next')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [
      summary('next'), summary('home', 'archived', 2),
    ] })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: board('next') })

    await useV2Canvas.getState().archiveBoard('home', 1)

    expect(v2Api.archiveBoard).toHaveBeenCalledWith('home', 1)
    expect(useV2Canvas.getState().boardId).toBe('next')
    expect(useV2Canvas.getState().boards.map((item) => item.id)).toEqual(['next'])
    expect(useV2Canvas.getState().boardCatalog.map((item) => item.id)).toEqual(['next', 'home'])
  })

  it('purges the current board and opens the next active board', async () => {
    vi.spyOn(v2Api, 'purgeBoard').mockResolvedValue({
      deletedBoardId: 'home', deletedRunIds: ['run-old'],
    })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('next')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('next')] })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: board('next') })

    await expect(useV2Canvas.getState().purgeBoard('home', 4)).resolves.toBeUndefined()
    expect(v2Api.purgeBoard).toHaveBeenCalledWith('home', 4)
    expect(useV2Canvas.getState().boardId).toBe('next')
    expect(useV2Canvas.getState().board?.id).toBe('next')
  })

  it('uses the ordinary default-board creation path when trashing the only active board', async () => {
    vi.spyOn(v2Api, 'trashBoard').mockResolvedValue({
      board: { ...board('home'), lifecycle: { state: 'trashed' }, revision: 2 },
    })
    vi.spyOn(v2Api, 'listBoards')
      .mockResolvedValueOnce({ boards: [] })
      .mockResolvedValueOnce({ boards: [summary('default')] })
    vi.spyOn(v2Api, 'listBoardCatalog')
      .mockResolvedValueOnce({ boards: [summary('home', 'trashed', 2)] })
      .mockResolvedValueOnce({ boards: [summary('default'), summary('home', 'trashed', 2)] })
    const create = vi.spyOn(v2Api, 'createBoard').mockResolvedValue({
      boardId: 'default', board: board('default'),
    })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: board('default') })

    await useV2Canvas.getState().trashBoard('home', 1)

    expect(create).toHaveBeenCalledWith('Mira 画板')
    expect(useV2Canvas.getState().boardId).toBe('default')
    expect(useV2Canvas.getState().boardCatalog.map((item) => item.id))
      .toEqual(['default', 'home'])
  })

  it('fails closed after lifecycle commit when catalog or fallback reconciliation cannot load', async () => {
    useV2Canvas.setState({
      boardCatalog: [summary('home')],
      boards: [summary('home')],
    })
    vi.spyOn(v2Api, 'archiveBoard').mockResolvedValue({
      board: { ...board('home'), lifecycle: { state: 'archived' }, revision: 2 },
    })
    vi.spyOn(v2Api, 'listBoards').mockRejectedValue(new Error('active list unavailable'))
    vi.spyOn(v2Api, 'listBoardCatalog').mockRejectedValue(new Error('catalog unavailable'))

    await expect(useV2Canvas.getState().archiveBoard('home', 1)).resolves.toBeUndefined()

    expect(useV2Canvas.getState()).toMatchObject({
      boardId: null,
      board: null,
      nodes: [],
      edges: [],
      loadState: 'error',
      boardCatalogState: 'error',
    })
    expect(useV2Canvas.getState().boards).toEqual([])
    expect(useV2Canvas.getState().boardCatalog).toEqual([
      expect.objectContaining({ id: 'home', state: 'archived', revision: 2 }),
    ])
    expect(useV2Canvas.getState().message).toContain('已归档')
    expect(useV2Canvas.getState().message).toContain('重新加载')
  })

  it('refreshes the latest catalog and current board after a revision conflict, then rethrows', async () => {
    const conflict = Object.assign(new Error('画板已更新'), { code: 'BOARD_CONFLICT', status: 409 })
    vi.spyOn(v2Api, 'renameBoard').mockRejectedValue(conflict)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [
      { ...summary('home', 'active', 6), title: '其他窗口标题' },
    ] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [
      { ...summary('home', 'active', 6), title: '其他窗口标题' },
    ] })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({
      board: { ...board('home'), title: '其他窗口标题', revision: 6 },
    })

    await expect(useV2Canvas.getState().renameBoard('home', '我的草稿', 4))
      .rejects.toBe(conflict)

    expect(useV2Canvas.getState().board?.title).toBe('其他窗口标题')
    expect(useV2Canvas.getState().boardCatalog[0].revision).toBe(6)
  })

  it('imports the same file twice as new boards and opens each returned identity', async () => {
    const imported = [board('copy-1'), board('copy-2')]
    const importBoard = vi.spyOn(v2Api, 'importBoard')
      .mockImplementation(async () => {
        const next = imported[importBoard.mock.calls.length - 1]
        return { boardId: next.id, board: next, imported: { runCount: 0, externalReferenceCount: 0 } }
      })
    vi.spyOn(v2Api, 'listBoards').mockImplementation(async () => ({
      boards: importBoard.mock.calls.map((_, index) => summary(`copy-${index + 1}`)),
    }))
    vi.spyOn(v2Api, 'listBoardCatalog').mockImplementation(async () => ({
      boards: importBoard.mock.calls.map((_, index) => summary(`copy-${index + 1}`)),
    }))
    vi.spyOn(v2Api, 'getBoard').mockImplementation(async (id) => ({ board: board(id) }))
    const file = { text: vi.fn().mockResolvedValue(JSON.stringify({
      format: 'mira-board', formatVersion: 1, board: { title: '副本' },
    })) } as unknown as File

    const firstImport = useV2Canvas.getState().importBoardFile(file)
    const firstOperationId = latestNotice()?.operationId
    await firstImport
    expect(latestNotice()?.operationId).toBe(firstOperationId)
    await useV2Canvas.getState().importBoardFile(file)

    expect(importBoard).toHaveBeenCalledTimes(2)
    expect(importBoard.mock.calls[0][0]).toEqual(importBoard.mock.calls[1][0])
    expect(useV2Canvas.getState().boardId).toBe('copy-2')
    expect(useV2Canvas.getState().boards.map((item) => item.id)).toEqual(['copy-1', 'copy-2'])
    expect(latestNotice()).toMatchObject({
      kind: 'success', boardId: 'copy-2',
    })
  })

  it('returns to the existing board when an imported copy cannot be opened', async () => {
    const imported = board('copy')
    vi.spyOn(v2Api, 'importBoard').mockResolvedValue({
      boardId: imported.id,
      board: imported,
      imported: { runCount: 0, externalReferenceCount: 0 },
    })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('home'), summary('copy')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('home'), summary('copy')] })
    vi.spyOn(v2Api, 'getBoard').mockRejectedValue(new Error('copy unavailable'))
    const file = { text: async () => JSON.stringify({ format: 'mira-board', formatVersion: 1 }) } as File

    await useV2Canvas.getState().importBoardFile(file)

    expect(useV2Canvas.getState()).toMatchObject({
      boardId: 'home',
      loadState: 'ready',
      boardCatalogState: 'error',
    })
    expect(latestNotice()?.message).toContain('暂时无法打开')
  })

  it('does not let a stale import-open failure cancel a newer board switch', async () => {
    const imported = board('copy')
    const copyOpen = deferred<{ board: BoardV2 }>()
    const nextOpen = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'importBoard').mockResolvedValue({
      boardId: imported.id,
      board: imported,
      imported: { runCount: 0, externalReferenceCount: 0 },
    })
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('home'), summary('copy'), summary('next')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('home'), summary('copy'), summary('next')] })
    vi.spyOn(v2Api, 'getBoard').mockImplementation((boardId) =>
      boardId === 'copy' ? copyOpen.promise : nextOpen.promise,
    )
    const file = { text: async () => JSON.stringify({ format: 'mira-board', formatVersion: 1 }) } as File

    const importing = useV2Canvas.getState().importBoardFile(file)
    await flushMicrotasks()
    await flushMicrotasks()
    const switching = useV2Canvas.getState().switchBoard('next')
    copyOpen.reject(new Error('copy unavailable'))
    await importing

    expect(useV2Canvas.getState().loadState).toBe('loading')
    nextOpen.resolve({ board: board('next') })
    await switching
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'next', loadState: 'ready' })
  })

  it('does not let import catalog reconciliation overtake a newer board switch', async () => {
    const imported = board('copy')
    const activeBoards = deferred<{ boards: ReturnType<typeof summary>[] }>()
    const nextOpen = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'importBoard').mockResolvedValue({
      boardId: imported.id,
      board: imported,
      imported: { runCount: 0, externalReferenceCount: 0 },
    })
    vi.spyOn(v2Api, 'listBoards').mockReturnValue(activeBoards.promise)
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({
      boards: [summary('home'), summary('copy'), summary('next')],
    })
    vi.spyOn(v2Api, 'getBoard').mockImplementation((boardId) =>
      boardId === 'copy' ? Promise.resolve({ board: imported }) : nextOpen.promise,
    )
    const file = { text: async () => JSON.stringify({ format: 'mira-board', formatVersion: 1 }) } as File

    const importing = useV2Canvas.getState().importBoardFile(file)
    await flushMicrotasks()
    const switching = useV2Canvas.getState().switchBoard('next')
    activeBoards.resolve({ boards: [summary('home'), summary('copy'), summary('next')] })
    await importing

    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'home', loadState: 'loading' })
    nextOpen.resolve({ board: board('next') })
    await switching
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'next', loadState: 'ready' })
  })

  it('does not force-open or publish a terminal notice when an import resolves after switching', async () => {
    const pending = deferred<{
      boardId: string
      board: BoardV2
      imported: { runCount: number; externalReferenceCount: number }
    }>()
    vi.spyOn(v2Api, 'importBoard').mockReturnValue(pending.promise)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('next'), summary('late-copy')] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('next'), summary('late-copy')] })
    vi.spyOn(v2Api, 'getBoard').mockImplementation(async (id) => ({ board: board(id) }))
    const file = { text: async () => JSON.stringify({ format: 'mira-board', formatVersion: 1 }) } as File

    const importing = useV2Canvas.getState().importBoardFile(file)
    await flushMicrotasks()
    await useV2Canvas.getState().switchBoard('next')
    pending.resolve({
      boardId: 'late-copy', board: board('late-copy'),
      imported: { runCount: 0, externalReferenceCount: 0 },
    })
    await importing

    expect(useV2Canvas.getState().boardId).toBe('next')
    expect(useV2Canvas.getState().notices).toEqual([])
  })

  it('replaces export and backup progress with terminal notices and rethrows failures', async () => {
    const download = vi.spyOn(portableDownloads, 'downloadJson').mockImplementation(() => {})
    vi.spyOn(v2Api, 'exportBoard').mockResolvedValue({ format: 'mira-board', formatVersion: 1 })
    vi.spyOn(v2Api, 'exportBackup').mockRejectedValue(new Error('backup unavailable'))
    useV2Canvas.setState({
      boardCatalog: [{ ...summary('home'), title: '研究/计划' }],
    })

    const exporting = useV2Canvas.getState().exportBoardFile('home')
    const operationId = latestNotice()?.operationId
    expect(latestNotice()).toMatchObject({
      kind: 'progress', operationId: expect.stringContaining('board-export:home:'),
    })
    await exporting
    expect(download).toHaveBeenCalledWith(
      { format: 'mira-board', formatVersion: 1 },
      '研究-计划.mira-board.json',
    )
    expect(latestNotice()).toMatchObject({
      kind: 'success', operationId,
    })

    await expect(useV2Canvas.getState().backupMira()).rejects.toThrow('backup unavailable')
    expect(latestNotice()).toMatchObject({
      kind: 'error', operationId: expect.stringContaining('mira-backup:'),
    })
  })

  it('shows and completes an archived-board export in the current active board context', async () => {
    const pending = deferred<unknown>()
    const download = vi.spyOn(portableDownloads, 'downloadJson').mockImplementation(() => {})
    vi.spyOn(v2Api, 'exportBoard').mockReturnValue(pending.promise)
    useV2Canvas.setState({
      boardCatalog: [summary('home'), {
        ...summary('archive', 'archived', 3), title: '旧课题',
      }],
    })

    const exporting = useV2Canvas.getState().exportBoardFile('archive')
    expect(latestNotice()).toMatchObject({
      kind: 'progress', boardId: 'home',
      operationId: expect.stringContaining('board-export:archive:'),
    })
    pending.resolve({ format: 'mira-board', formatVersion: 1 })
    await exporting

    expect(download).toHaveBeenCalledWith(
      { format: 'mira-board', formatVersion: 1 },
      '旧课题.mira-board.json',
    )
    expect(latestNotice()).toMatchObject({
      kind: 'success', boardId: 'home',
      operationId: expect.stringContaining('board-export:archive:'),
    })
  })

  it('keeps a board switch clean when an older export finishes later', async () => {
    const pending = deferred<unknown>()
    vi.spyOn(portableDownloads, 'downloadJson').mockImplementation(() => {})
    vi.spyOn(v2Api, 'exportBoard').mockReturnValue(pending.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: board('next') })

    const exporting = useV2Canvas.getState().exportBoardFile('home')
    await useV2Canvas.getState().switchBoard('next')
    pending.resolve({ format: 'mira-board', formatVersion: 1 })
    await exporting

    expect(useV2Canvas.getState().boardId).toBe('next')
    expect(useV2Canvas.getState().notices).toEqual([])
  })
})

describe('board-scoped API responses', () => {
  it('ignores a late post-adoption board refresh after switching boards', async () => {
    const candidate = {
      ...run('old-run', 'old', 'succeeded'),
      result: { output: '# 待采用结果', digest: 'candidate', disposition: 'candidate' as const },
    }
    const target = card('old-target', 'old-target-v1', '# 当前成果')
    const oldTransformation = transformation(
      'old-transformation',
      ['old-source'],
      target.id,
      candidate.id,
    )
    const oldBoard = board('old', [card('old-source'), target], [oldTransformation])
    resetTo(oldBoard)
    useV2Canvas.setState({
      runs: { [candidate.id]: candidate },
      ...projectV2Board(oldBoard, { [candidate.id]: candidate }),
      drawer: { tab: 'run', runId: candidate.id },
    })
    const adoptedCard = card(target.id, 'old-target-v2', '# 已采用结果')
    const adoptedRun: TransformationRun = {
      ...candidate,
      result: {
        output: '# 已采用结果',
        digest: 'adopted',
        disposition: 'applied',
        appliedVersionId: adoptedCard.headVersionId || undefined,
      },
    }
    const refreshedOldBoard: BoardV2 = {
      ...oldBoard,
      cards: oldBoard.cards.map((item) => item.id === target.id ? adoptedCard : item),
      transformations: [{
        ...oldTransformation,
        lastAppliedRunId: candidate.id,
        updatedAt: '2026-08-23T01:00:00.000Z',
      }],
    }
    const oldRefresh = deferred<{ board: BoardV2 }>()
    vi.spyOn(v2Api, 'adoptCandidate').mockResolvedValue({ card: adoptedCard, run: adoptedRun })
    const getBoard = vi.spyOn(v2Api, 'getBoard').mockImplementation((boardId) =>
      boardId === oldBoard.id ? oldRefresh.promise : Promise.resolve({ board: board('new') }),
    )

    const adoptPending = useV2Canvas.getState().adoptCandidate(candidate.id, candidate.targetBaseVersionId)
    await flushMicrotasks()
    expect(getBoard).toHaveBeenCalledWith(oldBoard.id)

    await useV2Canvas.getState().switchBoard('new')
    oldRefresh.resolve({ board: refreshedOldBoard })
    await adoptPending

    expect(useV2Canvas.getState().boardId).toBe('new')
    expect(useV2Canvas.getState().board?.id).toBe('new')
    expect(useV2Canvas.getState().board?.transformations).toEqual([])
    expect(useV2Canvas.getState().runs[candidate.id]).toBeUndefined()
    expect(useV2Canvas.getState().drawer).toBeNull()
  })

  it('does not replace a card on the new board with a late commit from the old board', async () => {
    const oldBoard = board('old', [card('shared', 'old-v1')])
    const newBoard = board('new', [card('shared', 'new-v1')])
    resetTo(oldBoard)
    const committed = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(committed.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: newBoard })

    const commitPending = useV2Canvas.getState().commitCard('shared', '# old changed')
    await useV2Canvas.getState().switchBoard('new')
    committed.resolve({ card: card('shared', 'old-v2', '# stale old result') })
    await commitPending

    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe('new-v1')
    expect(useV2Canvas.getState().saveState).toBe('saved')
  })

  it('does not let a stale mutation error replace the current board message', async () => {
    const created = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'createCard').mockReturnValue(created.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: board('new') })

    const createPending = useV2Canvas.getState().createFileCard({ x: 10, y: 20 }, 'old.md')
    await useV2Canvas.getState().switchBoard('new')
    created.reject(new Error('old board failed'))
    await createPending

    expect(useV2Canvas.getState().message).toBeNull()
  })

  it('does not publish old suggestions when the new board selects cards with the same ids', async () => {
    const oldBoard = board('old', [card('shared', 'old-v1')])
    const newBoard = board('new', [card('shared', 'new-v1')])
    resetTo(oldBoard)
    useV2Canvas.setState({ selectedCardIds: ['shared'] })
    const suggestions = deferred<{ suggestions: Array<{ id: string; label: string; instruction: string; acceptance: string }> }>()
    vi.spyOn(v2Api, 'suggest').mockReturnValue(suggestions.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: newBoard })

    const suggestPending = useV2Canvas.getState().requestSuggestions()
    await useV2Canvas.getState().switchBoard('new')
    useV2Canvas.setState({ selectedCardIds: ['shared'] })
    suggestions.resolve({ suggestions: [{ id: 'stale', label: '旧建议', instruction: '旧建议', acceptance: '' }] })
    await suggestPending

    expect(useV2Canvas.getState().suggestions).toEqual([])
    expect(useV2Canvas.getState().suggestionState).toBe('idle')
  })

  it('does not replace the new board with a late transformation response', async () => {
    const oldBoard = board('old', [card('source', 'old-v1')])
    const newBoard = board('new', [card('source', 'new-v1')])
    resetTo(oldBoard)
    useV2Canvas.setState({ selectedCardIds: ['source'] })
    const generated = deferred<{ transformation: Transformation; targetCard: ContentCard }>()
    vi.spyOn(v2Api, 'createTransformation').mockReturnValue(generated.promise)
    const startRun = vi.spyOn(v2Api, 'startRun')
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: newBoard })

    const generatePending = useV2Canvas.getState().generate({
      id: 'suggestion', label: '整理', instruction: '整理来源', acceptance: '',
    })
    expect(useV2Canvas.getState().notices).toEqual([
      expect.objectContaining({ kind: 'progress', boardId: 'old' }),
    ])
    await useV2Canvas.getState().switchBoard('new')
    expect(useV2Canvas.getState().notices).toEqual([])
    generated.resolve({
      transformation: transformation('old-transformation', ['source'], 'old-target'),
      targetCard: card('old-target'),
    })
    await generatePending

    expect(useV2Canvas.getState().boardId).toBe('new')
    expect(useV2Canvas.getState().board?.id).toBe('new')
    expect(useV2Canvas.getState().board?.cards.some((item) => item.id === 'old-target')).toBe(false)
    expect(useV2Canvas.getState().notices).toEqual([])
    expect(startRun).not.toHaveBeenCalled()
  })

  it('ignores a late drag persistence response from the previous board', async () => {
    const oldBoard = board('old', [card('shared', 'old-v1')])
    const newBoard = board('new', [card('shared', 'new-v1')])
    resetTo(oldBoard)
    const updated = deferred<{ card: ContentCard }>()
    vi.spyOn(v2Api, 'updateCard').mockReturnValue(updated.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: newBoard })

    useV2Canvas.getState().onNodesChange([{
      type: 'position', id: 'shared', position: { x: 200, y: 220 }, dragging: false,
    }])
    await useV2Canvas.getState().switchBoard('new')
    updated.resolve({ card: { ...card('shared', 'old-v1'), x: 200, y: 220 } })
    await flushMicrotasks()

    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe('new-v1')
    expect(useV2Canvas.getState().board?.cards[0].x).toBe(0)
  })
})

describe('run tracking lifecycle', () => {
  it('coalesces simultaneous terminal-run refreshes and performs one trailing read', async () => {
    vi.useFakeTimers()
    const first = run('first-run', 'active', 'running')
    const second = run('second-run', 'active', 'running')
    const canvas = board('active', [card('active-source')], [
      transformation('first-transformation', ['active-source'], 'active-source', first.id),
      transformation('second-transformation', ['active-source'], 'active-source', second.id),
    ])
    const firstRefresh = deferred<{ board: BoardV2 }>()
    const trailingRefresh = deferred<{ board: BoardV2 }>()
    const polls = new Map<string, number>()
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(trailingRefresh.promise)
    vi.spyOn(v2Api, 'getRun').mockImplementation(async (runId) => {
      const count = polls.get(runId) || 0
      polls.set(runId, count + 1)
      return { run: count === 0
        ? (runId === first.id ? first : second)
        : run(runId, 'active', 'succeeded') }
    })

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(500)
    expect(getBoard).toHaveBeenCalledTimes(2)
    firstRefresh.resolve({ board: canvas })
    await flushMicrotasks()
    expect(getBoard).toHaveBeenCalledTimes(3)
    trailingRefresh.resolve({ board: canvas })
    await flushMicrotasks()

    expect(getBoard).toHaveBeenCalledTimes(3)
  })

  it('keeps accepting a trailing refresh until the active read synchronously retires', async () => {
    vi.useFakeTimers()
    const first = run('first-staggered-run', 'active', 'running')
    const second = run('second-staggered-run', 'active', 'running')
    const canvas = board('active', [card('active-source')], [
      transformation('first-staggered-transformation', ['active-source'], 'active-source', first.id),
      transformation('second-staggered-transformation', ['active-source'], 'active-source', second.id),
    ])
    const firstRefresh = deferred<{ board: BoardV2 }>()
    const secondTerminal = deferred<{ run: TransformationRun }>()
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce({ board: canvas })
    const polls = new Map<string, number>()
    vi.spyOn(v2Api, 'getRun').mockImplementation((runId) => {
      const count = polls.get(runId) || 0
      polls.set(runId, count + 1)
      if (count === 0) return Promise.resolve({ run: runId === first.id ? first : second })
      if (runId === second.id) return secondTerminal.promise
      return Promise.resolve({ run: run(runId, 'active', 'succeeded') })
    })

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(500)
    expect(getBoard).toHaveBeenCalledTimes(2)
    firstRefresh.resolve({ board: canvas })
    secondTerminal.resolve({ run: run(second.id, 'active', 'succeeded') })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(getBoard).toHaveBeenCalledTimes(3)
  })

  it('does not reuse a refresh that began before conflict recovery', async () => {
    vi.useFakeTimers()
    const active = run('conflict-refresh-run', 'active', 'running')
    const canvas = board('active', [card('home-source')], [
      transformation('home-transformation', ['home-source'], 'home-source', active.id),
    ])
    const staleRefresh = deferred<{ board: BoardV2 }>()
    const remote = { ...canvas, title: 'Remote title', revision: 1 }
    const conflict = Object.assign(new Error('conflict'), { code: 'BOARD_CONFLICT', status: 409 })
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ board: remote })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: run(active.id, 'home', 'succeeded') })
    vi.spyOn(v2Api, 'renameBoard').mockRejectedValue(conflict)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [
      { ...summary('active', 'active', 1), title: remote.title },
    ] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [
      { ...summary('active', 'active', 1), title: remote.title },
    ] })

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(500)
    const renaming = useV2Canvas.getState().renameBoard('active', 'Local title', 0)
    await flushMicrotasks()
    staleRefresh.resolve({ board: canvas })
    await expect(renaming).rejects.toBe(conflict)

    expect(getBoard).toHaveBeenCalledTimes(3)
    expect(useV2Canvas.getState().board).toMatchObject({ title: remote.title, revision: 1 })
  })

  it('refetches when a stale run refresh races a committed card creation', async () => {
    vi.useFakeTimers()
    const active = run('refresh-run', 'active', 'running')
    const canvas = board('active', [card('active-source')], [
      transformation('active-transformation', ['active-source'], 'active-source', active.id),
    ])
    const staleRefresh = deferred<{ board: BoardV2 }>()
    const createdResponse = deferred<{ card: ContentCard }>()
    const created = { ...card('created'), x: 120, y: 140 }
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ board: { ...canvas, cards: [...canvas.cards, created] } })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: run(active.id, 'active', 'succeeded') })
    vi.spyOn(v2Api, 'createCard').mockReturnValue(createdResponse.promise)

    await useV2Canvas.getState().switchBoard('active')
    const creating = useV2Canvas.getState().createCard({ x: created.x, y: created.y })
    await vi.advanceTimersByTimeAsync(500)
    createdResponse.resolve({ card: created })
    await creating
    staleRefresh.resolve({ board: canvas })
    await flushMicrotasks()

    expect(getBoard).toHaveBeenCalledTimes(3)
    expect(useV2Canvas.getState().board?.cards.filter((item) => item.id === created.id))
      .toHaveLength(1)
  })

  it('refetches when a stale run refresh races any committed board write', async () => {
    vi.useFakeTimers()
    const active = run('refresh-run', 'active', 'running')
    const editable = card('editable', 'editable-v1', '# old')
    const updated = card('editable', 'editable-v2', '# new')
    const canvas = board('active', [editable], [
      transformation('active-transformation', [editable.id], editable.id, active.id),
    ])
    const staleRefresh = deferred<{ board: BoardV2 }>()
    const commitResponse = deferred<{ card: ContentCard }>()
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ board: { ...canvas, cards: [updated] } })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: run(active.id, 'active', 'succeeded') })
    vi.spyOn(v2Api, 'commitVersion').mockReturnValue(commitResponse.promise)

    await useV2Canvas.getState().switchBoard('active')
    const committing = useV2Canvas.getState().commitCard(editable.id, '# new')
    await vi.advanceTimersByTimeAsync(500)
    commitResponse.resolve({ card: updated })
    await committing
    staleRefresh.resolve({ board: canvas })
    await flushMicrotasks()

    expect(getBoard).toHaveBeenCalledTimes(3)
    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe(updated.headVersionId)
  })

  it('refetches when a stale run refresh races a board lifecycle write', async () => {
    vi.useFakeTimers()
    const active = run('refresh-run', 'active', 'running')
    const canvas = board('active', [card('active-source')], [
      transformation('active-transformation', ['active-source'], 'active-source', active.id),
    ])
    const renamed = { ...canvas, title: 'Renamed', revision: 1 }
    const staleRefresh = deferred<{ board: BoardV2 }>()
    const renameResponse = deferred<{ board: BoardV2 }>()
    const getBoard = vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: canvas })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ board: renamed })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: run(active.id, 'active', 'succeeded') })
    vi.spyOn(v2Api, 'renameBoard').mockReturnValue(renameResponse.promise)
    vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [summary('active', 'active', 1)] })
    vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [summary('active', 'active', 1)] })

    await useV2Canvas.getState().switchBoard('active')
    const renaming = useV2Canvas.getState().renameBoard('active', renamed.title, 0)
    await vi.advanceTimersByTimeAsync(500)
    renameResponse.resolve({ board: renamed })
    await renaming
    staleRefresh.resolve({ board: canvas })
    await flushMicrotasks()

    expect(getBoard).toHaveBeenCalledTimes(3)
    expect(useV2Canvas.getState().board?.title).toBe(renamed.title)
  })

  it('opens a resumed Candidate when idle and publishes an attention notice', async () => {
    vi.useFakeTimers()
    const active = run('candidate-run', 'active', 'running')
    const target = card('active-target', 'target-v1', '# current')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, active.id),
    ])
    const candidate = {
      ...active,
      status: 'succeeded' as const,
      result: { output: '# candidate', digest: 'candidate', disposition: 'candidate' as const },
    }
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: candidate })

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()

    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'run', runId: candidate.id })
    expect(latestNotice()).toMatchObject({ kind: 'attention', boardId: 'active' })
    expect(latestNotice()?.message).toContain('采用或丢弃')
  })

  it('does not let a resumed Candidate replace a panel opened while it was running', async () => {
    vi.useFakeTimers()
    const active = run('candidate-run', 'active', 'running')
    const target = card('active-target', 'target-v1', '# current')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, active.id),
    ])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({
        run: {
          ...active,
          status: 'succeeded',
          result: { output: '# candidate', digest: 'candidate', disposition: 'candidate' },
        },
      })

    await useV2Canvas.getState().switchBoard('active')
    useV2Canvas.getState().openPanel('model')
    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()

    expect(useV2Canvas.getState().panel).toBe('model')
    expect(useV2Canvas.getState().drawer).toBeNull()
    expect(latestNotice()).toMatchObject({ kind: 'attention', boardId: 'active' })
  })

  it('loads both the latest and last applied runs once when opening a board', async () => {
    const latest = {
      ...run('latest-run', 'active', 'succeeded'),
      result: { output: '# 候选', digest: 'candidate', disposition: 'candidate' as const },
    }
    const applied = run('applied-run', 'active', 'succeeded')
    const target = card('active-target', 'target-v1', '# 当前成果')
    const relation = {
      ...transformation('active-transformation', ['active-source'], target.id, latest.id),
      lastAppliedRunId: applied.id,
    }
    const canvas = board('active', [card('active-source'), target], [relation])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const getRun = vi.spyOn(v2Api, 'getRun').mockImplementation(async (runId) => ({
      run: runId === latest.id ? latest : applied,
    }))

    await useV2Canvas.getState().switchBoard('active')

    expect(getRun.mock.calls.map(([runId]) => runId)).toEqual([latest.id, applied.id])
    expect(Object.keys(useV2Canvas.getState().runs).sort())
      .toEqual([applied.id, latest.id].sort())
  })

  it('opens the board immediately and retries a transient initial run load in the background', async () => {
    vi.useFakeTimers()
    const active = run('initial-retry-run', 'active', 'queued')
    const target = card('active-target', 'target-v1', '')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, active.id),
    ])
    const getBoard = vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const transient = Object.assign(new Error('temporarily unavailable'), { status: 503 })
    const getRun = vi.spyOn(v2Api, 'getRun')
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({
        run: {
          ...active,
          status: 'succeeded',
          result: { output: '# 完成', digest: 'done', disposition: 'applied' },
        },
      })

    await useV2Canvas.getState().switchBoard('active')

    expect(useV2Canvas.getState().loadState).toBe('ready')
    expect(getRun).toHaveBeenCalledTimes(1)
    expect(useV2Canvas.getState().runs[active.id]).toBeUndefined()

    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()
    expect(getRun).toHaveBeenCalledTimes(2)
    expect(useV2Canvas.getState().runs[active.id]?.status).toBe('queued')

    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()
    expect(getRun).toHaveBeenCalledTimes(3)
    expect(useV2Canvas.getState().runs[active.id]?.status).toBe('succeeded')
    expect(getBoard).toHaveBeenCalledTimes(2)
  })

  it('abandons an initial run load immediately when the run no longer exists', async () => {
    vi.useFakeTimers()
    const missingRunId = 'missing-run'
    const target = card('active-target', 'target-v1', '')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, missingRunId),
    ])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const notFound = Object.assign(new Error('not found'), { status: 404 })
    const getRun = vi.spyOn(v2Api, 'getRun').mockRejectedValue(notFound)

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(useV2Canvas.getState().loadState).toBe('ready')
    expect(getRun).toHaveBeenCalledTimes(1)
    expect(useV2Canvas.getState().message || '').toContain('运行记录缺失')
    expect(useV2Canvas.getState().message || '').toContain(missingRunId)
  })

  it('diagnoses a missing run found after a transient initial load failure', async () => {
    vi.useFakeTimers()
    const missingRunId = 'missing-after-retry'
    const target = card('active-target', 'target-v1', '')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, missingRunId),
    ])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const transient = Object.assign(new Error('temporarily unavailable'), { status: 503 })
    const notFound = Object.assign(new Error('not found'), { status: 404 })
    const getRun = vi.spyOn(v2Api, 'getRun')
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(notFound)

    await useV2Canvas.getState().switchBoard('active')
    expect(useV2Canvas.getState().message).toBeNull()

    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()

    expect(getRun).toHaveBeenCalledTimes(2)
    expect(useV2Canvas.getState().message || '').toContain('运行记录缺失')
    expect(useV2Canvas.getState().message || '').toContain(missingRunId)
  })

  it('does not publish an initial run retry that resolves after a newer board generation', async () => {
    vi.useFakeTimers()
    const active = run('stale-initial-retry', 'old', 'queued')
    const target = card('old-target', 'target-v1', '')
    const oldBoard = board('old', [card('old-source'), target], [
      transformation('old-transformation', ['old-source'], target.id, active.id),
    ])
    const recovered = deferred<{ run: TransformationRun }>()
    vi.spyOn(v2Api, 'getBoard').mockImplementation(async (boardId) => ({
      board: boardId === 'old' ? oldBoard : board('new'),
    }))
    const transient = Object.assign(new Error('network unavailable'), { status: 503 })
    const getRun = vi.spyOn(v2Api, 'getRun')
      .mockRejectedValueOnce(transient)
      .mockReturnValueOnce(recovered.promise)

    await useV2Canvas.getState().switchBoard('old')
    await vi.advanceTimersByTimeAsync(500)
    expect(getRun).toHaveBeenCalledTimes(2)

    await useV2Canvas.getState().switchBoard('new')
    recovered.resolve({ run: active })
    await flushMicrotasks()

    expect(useV2Canvas.getState().boardId).toBe('new')
    expect(useV2Canvas.getState().runs[active.id]).toBeUndefined()
  })

  it('loads and resumes one active run only once when multiple transformations reference it', async () => {
    vi.useFakeTimers()
    const active = run('dedupe-run', 'active', 'queued')
    const target = card('active-target', 'target-v1', '')
    const canvas = board('active', [card('active-source'), target], [
      transformation('first', ['active-source'], target.id, active.id),
      transformation('second', ['active-source'], target.id, active.id),
    ])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const getRun = vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockResolvedValueOnce({ run: { ...active, status: 'succeeded', result: { output: '# 完成', digest: 'done', disposition: 'applied' } } })

    await useV2Canvas.getState().switchBoard('active')

    expect(getRun).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()
    expect(getRun).toHaveBeenCalledTimes(2)
  })

  it('stops after bounded backoff failures and shows a recoverable tracking message', async () => {
    vi.useFakeTimers()
    const active = run('retry-run', 'active', 'running')
    const target = card('active-target', 'target-v1', '')
    const canvas = board('active', [card('active-source'), target], [
      transformation('active-transformation', ['active-source'], target.id, active.id),
    ])
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas })
    const getRun = vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockRejectedValueOnce(new Error('temporary 3'))

    await useV2Canvas.getState().switchBoard('active')
    await vi.advanceTimersByTimeAsync(500)
    expect(getRun).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(getRun).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(getRun).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1999)
    expect(getRun).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()

    expect(getRun).toHaveBeenCalledTimes(4)
    expect(useV2Canvas.getState().message).toContain('重新打开画板')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getRun).toHaveBeenCalledTimes(4)
  })

  it('never refreshes another board when an old run reaches a terminal state', async () => {
    vi.useFakeTimers()
    const active = run('old-run', 'old', 'running')
    const target = card('old-target', 'target-v1', '')
    const oldBoard = board('old', [card('old-source'), target], [
      transformation('old-transformation', ['old-source'], target.id, active.id),
    ])
    const newBoard = board('new')
    const terminal = deferred<{ run: TransformationRun }>()
    const getBoard = vi.spyOn(v2Api, 'getBoard').mockImplementation(async (boardId) => ({
      board: boardId === 'old' ? oldBoard : newBoard,
    }))
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockReturnValueOnce(terminal.promise)

    await useV2Canvas.getState().switchBoard('old')
    await vi.advanceTimersByTimeAsync(500)
    expect(v2Api.getRun).toHaveBeenCalledTimes(2)
    await useV2Canvas.getState().switchBoard('new')
    terminal.resolve({ run: { ...active, status: 'succeeded', result: { output: '# 完成', digest: 'done', disposition: 'applied' } } })
    await flushMicrotasks()

    expect(getBoard.mock.calls.map(([boardId]) => boardId)).toEqual(['old', 'new'])
    expect(useV2Canvas.getState().boardId).toBe('new')
    expect(useV2Canvas.getState().board?.id).toBe('new')
  })

  it('keeps a pending old-board run refresh from contaminating the newly opened board', async () => {
    vi.useFakeTimers()
    const active = run('pending-navigation-run', 'old', 'running')
    const target = card('old-target', 'target-v1', '')
    const oldBoard = board('old', [card('old-source'), target], [
      transformation('old-transformation', ['old-source'], target.id, active.id),
    ])
    const newBoard = deferred<{ board: BoardV2 }>()
    const terminal = deferred<{ run: TransformationRun }>()
    const getBoard = vi.spyOn(v2Api, 'getBoard').mockImplementation((boardId) => {
      if (boardId === 'new') return newBoard.promise
      return Promise.resolve({ board: oldBoard })
    })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: active })
      .mockReturnValueOnce(terminal.promise)

    await useV2Canvas.getState().switchBoard('old')
    await vi.advanceTimersByTimeAsync(500)
    const switchPending = useV2Canvas.getState().switchBoard('new')
    await flushMicrotasks()
    terminal.resolve({ run: { ...active, status: 'succeeded', result: { output: '# 完成', digest: 'done', disposition: 'applied' } } })
    await flushMicrotasks()

    expect(getBoard.mock.calls.map(([boardId]) => boardId)).toEqual(['old', 'new', 'old'])

    newBoard.resolve({ board: board('new') })
    await switchPending
    expect(useV2Canvas.getState().boardId).toBe('new')
    expect(useV2Canvas.getState().board?.id).toBe('new')
  })
})
