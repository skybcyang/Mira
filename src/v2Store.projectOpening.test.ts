import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v2Api } from './v2Api'
import { useV2Canvas } from './v2Store'
import type { BoardV2 } from './domain'
import { projectApi } from './v2/projectApi'

const stamp = '2026-09-14T00:00:00.000Z'
const board = (id: string): BoardV2 => ({ schemaVersion: 2, id, title: id, cards: [], transformations: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: stamp, updatedAt: stamp })
const summary = (id: string) => ({ id, title: id, state: 'active' as const, revision: 0, updatedAt: stamp })
let project: { project: { id: string; name: string; path: string }; canSwitch: boolean; recentProjects: []; navigation: { opened: string[]; pinned: string[]; lastBoardId: string | null } | null }
let requests: Array<{ path: string; body: unknown }>

beforeEach(() => {
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) })
  project = { project: { id: 'project-a', name: '项目 A', path: '/tmp/demo-a' }, canSwitch: true, recentProjects: [], navigation: null }
  requests = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined
    requests.push({ path, body })
    return { ok: true, json: async () => path.endsWith('/navigation') ? { navigation: body } : project }
  }))
  useV2Canvas.setState(useV2Canvas.getInitialState())
  vi.spyOn(v2Api, 'listBoards').mockResolvedValue({ boards: [] })
  vi.spyOn(v2Api, 'listBoardCatalog').mockResolvedValue({ boards: [] })
  vi.spyOn(v2Api, 'listWorkflows').mockResolvedValue({ workflows: [] })
  vi.spyOn(v2Api, 'getBoard').mockImplementation(async id => ({ board: board(id) }))
  vi.spyOn(v2Api, 'createBoard').mockResolvedValue({ boardId: 'implicit', board: board('implicit') })
  vi.spyOn(v2Api, 'getBoardActivity').mockResolvedValue({ activity: {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('project opening', () => {
  it('opens an empty project without creating a board or a run', async () => {
    await useV2Canvas.getState().load()
    expect(v2Api.createBoard).not.toHaveBeenCalled()
    expect(v2Api.getBoard).not.toHaveBeenCalled()
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, loadState: 'ready', openedBoardIds: [] })
  })
  it('shows overview when a populated project has no opening record', async () => {
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a'), summary('b')] })
    await useV2Canvas.getState().load()
    expect(v2Api.getBoard).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().boardId).toBeNull()
  })
  it('restores the host record in a new browser session and filters inactive boards', async () => {
    project.navigation = { opened: ['gone', 'b', 'a'], pinned: ['b', 'gone'], lastBoardId: 'b' }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a'), summary('b')] })
    await useV2Canvas.getState().load()
    expect(useV2Canvas.getState()).toMatchObject({ boardId: 'b', openedBoardIds: ['b', 'a'], pinnedBoardIds: ['b'] })
    expect(v2Api.getBoard).toHaveBeenCalledExactlyOnceWith('b')
  })
  it('respects a saved overview even when other boards are open', async () => {
    project.navigation = { opened: ['a'], pinned: ['a'], lastBoardId: null }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a')] })
    await useV2Canvas.getState().load()
    expect(v2Api.getBoard).not.toHaveBeenCalled()
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, openedBoardIds: ['a'] })
  })
  it('saves overview without closing the project boards', async () => {
    project.navigation = { opened: ['a'], pinned: ['a'], lastBoardId: 'a' }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a')] })
    await useV2Canvas.getState().load()
    await useV2Canvas.getState().showProjectOverview()
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, openedBoardIds: ['a'], pinnedBoardIds: ['a'] })
    expect(requests.filter(r => r.path.endsWith('/navigation')).slice(-1)[0]?.body).toEqual({ opened: ['a'], pinned: ['a'], lastBoardId: null })
  })
  it('keeps browser navigation separate for two project identities', async () => {
    project.canSwitch = false
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a')] })
    await useV2Canvas.getState().load()
    await useV2Canvas.getState().switchBoard('a')
    await useV2Canvas.getState().flushBoardNavigation()
    project.project = { id: 'project-b', name: 'B', path: '/tmp/b' }
    await useV2Canvas.getState().load()
    expect(useV2Canvas.getState().boardId).toBeNull()
    project.project = { id: 'project-a', name: 'A', path: '/tmp/a' }
    await useV2Canvas.getState().load()
    expect(useV2Canvas.getState().boardId).toBe('a')
  })
  it('does not overwrite an opening record when loading the remembered board fails', async () => {
    project.navigation = { opened: ['a'], pinned: [], lastBoardId: 'a' }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a')] })
    vi.mocked(v2Api.getBoard).mockRejectedValue(new Error('offline'))
    await useV2Canvas.getState().load()
    expect(useV2Canvas.getState().loadState).toBe('error')
    expect(requests.filter(r => r.path.endsWith('/navigation'))).toEqual([])
  })
  it('keeps the selected overview after a preferences failure and retries the current navigation before switching projects', async () => {
    project.navigation = { opened: ['a'], pinned: [], lastBoardId: 'a' }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a')] })
    await useV2Canvas.getState().load()
    await useV2Canvas.getState().flushBoardNavigation()
    const save = vi.spyOn(projectApi, 'saveNavigation').mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue({ navigation: { opened: ['a'], pinned: [], lastBoardId: null } })
    await expect(useV2Canvas.getState().showProjectOverview()).rejects.toThrow('disk unavailable')
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, openedBoardIds: ['a'], loadState: 'ready' })
    expect(useV2Canvas.getState().notices.some(notice => notice.message.includes('打开记录未保存'))).toBe(true)
    await expect(useV2Canvas.getState().flushBoardNavigation()).resolves.toBeUndefined()
    expect(save).toHaveBeenLastCalledWith({ opened: ['a'], pinned: [], lastBoardId: null })
  })
  it('returns to overview after archiving the only opened board without opening an unselected board', async () => {
    project.navigation = { opened: ['a'], pinned: [], lastBoardId: 'a' }
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('a'), summary('b')] })
    await useV2Canvas.getState().load()
    vi.mocked(v2Api.getBoard).mockClear()
    vi.spyOn(v2Api, 'archiveBoard').mockResolvedValue({ board: { ...board('a'), lifecycle: { state: 'archived' } } })
    vi.mocked(v2Api.listBoards).mockResolvedValue({ boards: [summary('b')] })
    vi.mocked(v2Api.listBoardCatalog).mockResolvedValue({ boards: [summary('b')] })
    await useV2Canvas.getState().archiveBoard('a', 0)
    expect(useV2Canvas.getState()).toMatchObject({ boardId: null, loadState: 'ready', openedBoardIds: [] })
    expect(v2Api.getBoard).not.toHaveBeenCalled()
    expect(v2Api.createBoard).not.toHaveBeenCalled()
  })
  it('rejects opening or creating beyond the navigation limit without dropping other open boards', async () => {
    const opened = Array.from({ length: 1000 }, (_, index) => `b${index}`)
    useV2Canvas.setState({ loadState: 'ready', board: board('b0'), boardId: 'b0', openedBoardIds: opened })
    await expect(useV2Canvas.getState().switchBoard('another')).rejects.toThrow('1000')
    await expect(useV2Canvas.getState().createBoard('another')).rejects.toThrow('1000')
    expect(useV2Canvas.getState().openedBoardIds).toEqual(opened)
    expect(v2Api.createBoard).not.toHaveBeenCalled()
    expect(v2Api.getBoard).not.toHaveBeenCalled()
  })
  it('keeps the pin limit recoverable by unpinning, without rejecting removal', () => {
    const pinned = Array.from({ length: 1000 }, (_, index) => `b${index}`)
    useV2Canvas.setState({ pinnedBoardIds: pinned })
    useV2Canvas.getState().togglePinnedBoard('another')
    expect(useV2Canvas.getState().pinnedBoardIds).toEqual(pinned)
    useV2Canvas.getState().togglePinnedBoard('b0')
    useV2Canvas.getState().togglePinnedBoard('another')
    expect(useV2Canvas.getState().pinnedBoardIds).toHaveLength(1000)
    expect(useV2Canvas.getState().pinnedBoardIds).toContain('another')
  })
})
