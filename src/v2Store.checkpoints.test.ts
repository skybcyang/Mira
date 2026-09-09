import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCheckpointV1, BoardV2 } from './domain'
import { v2Api } from './v2Api'
import { useV2Canvas } from './v2Store'

const now = '2026-09-06T00:00:00.000Z'
function board(id: string): BoardV2 {
  return {
    schemaVersion: 2, id, title: id, revision: 0, cards: [], transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now,
  }
}
const checkpoint: BoardCheckpointV1 = {
  schemaVersion: 1, id: 'checkpoint', boardId: 'home', title: 'Milestone', baseBoardRevision: 0,
  createdAt: now, metadataUpdatedAt: now,
  artifact: {
    format: 'mira-board', formatVersion: 1, exportedAt: now, board: board('home'),
    runs: [], workflowProvenance: [], fileDependencies: [], externalReferences: [],
  },
}
const result = { boardId: 'copy', board: board('copy'), imported: { runCount: 0, externalReferenceCount: 0 } }

beforeEach(() => {
  useV2Canvas.setState({
    boardId: 'home', board: board('home'), boards: [{ id: 'home', title: 'home' }],
    boardCatalog: [], runs: {}, drawer: null, panel: null, notices: [], message: null,
    selectedCardIds: [], loadState: 'ready', boardCatalogState: 'ready',
  })
  vi.spyOn(v2Api, 'getCheckpoint').mockResolvedValue({ checkpoint, current: { board: board('home'), runs: [] } })
  vi.spyOn(v2Api, 'forkCheckpoint').mockResolvedValue(result)
  vi.spyOn(v2Api, 'getBoard').mockImplementation(async id => ({ board: board(id) }))
  const boards = ['home', 'copy', 'other'].map(id => ({ id, title: id, state: 'active' as const, revision: 0, updatedAt: now }))
  vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards })
  vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards })
})
afterEach(() => vi.restoreAllMocks())

describe('checkpoint composition with Board navigation', () => {
  it('opens a committed fork through the normal Board lifecycle boundary', async () => {
    expect(useV2Canvas.getState().forkBoardCheckpoint).toBeTypeOf('function')
    await useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy')
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'copy', loadState: 'ready' })
    expect(useV2Canvas.getState().boardCatalog.some(item => item.id === 'copy')).toBe(true)
  })

  it('does not steal a Board navigation made while loading the source checkpoint', async () => {
    expect(useV2Canvas.getState().forkBoardCheckpoint).toBeTypeOf('function')
    let resolve!: (value: Awaited<ReturnType<typeof v2Api.getCheckpoint>>) => void
    vi.mocked(v2Api.getCheckpoint).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy')
    await useV2Canvas.getState().switchBoard('other')
    resolve({ checkpoint, current: { board: board('home'), runs: [] } })
    expect(await pending).toBe('copy')
    expect(useV2Canvas.getState().boardId).toBe('other')
    expect(useV2Canvas.getState().boardCatalog.some(item => item.id === 'copy')).toBe(true)
  })

  it('keeps a durable fork discoverable when refreshing the catalog fails', async () => {
    expect(useV2Canvas.getState().forkBoardCheckpoint).toBeTypeOf('function')
    vi.mocked(v2Api.listBoardCatalog).mockRejectedValueOnce(new Error('catalog unavailable'))
    expect(await useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy')).toBe('copy')
    expect(useV2Canvas.getState().boardId).toBe('home')
    expect(useV2Canvas.getState().boardCatalog.some(item => item.id === 'copy')).toBe(true)
    expect(useV2Canvas.getState().message).toContain('画板副本已创建')
  })

  it('keeps the current task when its caller cancels during catalog reconciliation', async () => {
    let finish!: (value: Awaited<ReturnType<typeof v2Api.listBoards>>) => void
    vi.mocked(v2Api.listBoards).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let canNavigate = true
    const pending = useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy', () => canNavigate)
    for (let attempt = 0; attempt < 20 && !finish; attempt++) await Promise.resolve()
    expect(finish).toBeTypeOf('function')
    canNavigate = false
    finish({ boards: [{ id: 'home', title: 'home', state: 'active', revision: 0, updatedAt: now }] })
    expect(await pending).toBe('copy')
    expect(useV2Canvas.getState().boardId).toBe('home')
  })

  it('cancels automatic fork navigation while the copied Board is still loading', async () => {
    let finish!: (value: Awaited<ReturnType<typeof v2Api.getBoard>>) => void
    vi.mocked(v2Api.getBoard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let canNavigate = true
    const pending = useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy', () => canNavigate)
    for (let attempt = 0; attempt < 30 && !finish; attempt++) await Promise.resolve()
    expect(finish).toBeTypeOf('function')
    canNavigate = false
    finish({ board: board('copy') })
    expect(await pending).toBe('copy')
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'home', loadState: 'ready' })
    expect(useV2Canvas.getState().boardCatalog.some(item => item.id === 'copy')).toBe(true)
  })

  it('does not reset a newer lifecycle loading state when a fork read becomes stale', async () => {
    let finishCopy!: (value: Awaited<ReturnType<typeof v2Api.getBoard>>) => void
    vi.mocked(v2Api.getBoard).mockImplementationOnce(() => new Promise(resolve => { finishCopy = resolve }))
    const pendingFork = useV2Canvas.getState().forkBoardCheckpoint('home', 'checkpoint', 'copy')
    for (let attempt = 0; attempt < 30 && !finishCopy; attempt++) await Promise.resolve()
    expect(finishCopy).toBeTypeOf('function')
    vi.spyOn(v2Api, 'archiveBoard').mockResolvedValue({
      board: { ...board('home'), revision: 1, lifecycle: { state: 'archived', archivedAt: now } },
    })
    let finishArchive!: (value: Awaited<ReturnType<typeof v2Api.listBoards>>) => void
    vi.mocked(v2Api.listBoards).mockImplementationOnce(() => new Promise(resolve => { finishArchive = resolve }))
    const pendingArchive = useV2Canvas.getState().archiveBoard('home', 0)
    for (let attempt = 0; attempt < 30 && !finishArchive; attempt++) await Promise.resolve()
    expect(finishArchive).toBeTypeOf('function')
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, loadState: 'loading' })
    finishCopy({ board: board('copy') })
    await pendingFork
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, loadState: 'loading' })
    finishArchive({ boards: [{ id: 'other', title: 'other', state: 'active', revision: 0, updatedAt: now }] })
    await pendingArchive
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'other', loadState: 'ready' })
  })
})
