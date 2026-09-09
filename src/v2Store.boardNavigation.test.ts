import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useV2Canvas } from './v2Store'
import { v2Api } from './v2Api'
import type { BoardV2 } from './domain'

const board = (id: string): BoardV2 => ({ schemaVersion: 2, id, title: id, cards: [], transformations: [], viewport: {x:0,y:0,zoom:1}, createdAt:'',updatedAt:'' })
beforeEach(() => {
  useV2Canvas.setState({ ...useV2Canvas.getInitialState(), board:board('a'), boardId:'a', loadState:'ready', boards:[{id:'a',title:'a'},{id:'b',title:'b'}], openedBoardIds:['a','b'] })
  vi.spyOn(v2Api, 'getBoard').mockImplementation(async id => ({board:board(id)}))
  vi.spyOn(v2Api, 'getBoardActivity').mockResolvedValue({activity:{}})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('closing open boards', () => {
  it('keeps an explicitly closed session empty on reload even with an empty catalog', async () => {
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify({opened:[],pinned:['a']}), setItem:vi.fn()})
    vi.spyOn(v2Api,'listBoards').mockResolvedValue({boards:[]})
    vi.spyOn(useV2Canvas.getState(),'refreshWorkflows').mockResolvedValue()
    const create = vi.spyOn(v2Api,'createBoard')
    useV2Canvas.setState({board:null,boardId:null,openedBoardIds:[]})
    await useV2Canvas.getState().load()
    expect(create).not.toHaveBeenCalled()
    expect(useV2Canvas.getState()).toMatchObject({board:null,boardId:null,loadState:'ready',openedBoardIds:[]})
  })
  it('switches before removing the current entry without changing persisted boards', async () => {
    const archive=vi.spyOn(v2Api,'archiveBoard')
    await useV2Canvas.getState().closeBoard('a')
    expect(useV2Canvas.getState()).toMatchObject({boardId:'b',openedBoardIds:['b']})
    expect(archive).not.toHaveBeenCalled()
  })
  it('keeps the old canvas and open list when replacement cannot load', async () => {
    vi.mocked(v2Api.getBoard).mockRejectedValue(Error('offline'))
    await expect(useV2Canvas.getState().closeBoard('a')).rejects.toThrow('offline')
    expect(useV2Canvas.getState()).toMatchObject({boardId:'a',openedBoardIds:['a','b'],loadState:'ready'})
  })
  it.each([{activeRuns:1,pendingCandidates:0},{activeRuns:0,pendingCandidates:1}])('preserves an entry with unfinished work %j', async counts => {
    vi.mocked(v2Api.getBoardActivity).mockResolvedValue({activity:{a:counts}})
    expect(await useV2Canvas.getState().closeBoard('a')).toBe(false)
    expect(useV2Canvas.getState().openedBoardIds).toContain('a')
    expect(v2Api.getBoard).not.toHaveBeenCalled()
  })
  it('does not close when checking status fails', async () => {
    vi.mocked(v2Api.getBoardActivity).mockRejectedValue(Error('offline'))
    await expect(useV2Canvas.getState().closeBoard('a')).rejects.toThrow()
    expect(useV2Canvas.getState().boardId).toBe('a')
  })
  it('closes the last entry without creating an empty board or cancelling its pin', async () => {
    useV2Canvas.setState({openedBoardIds:['a'],pinnedBoardIds:['a']})
    const create=vi.spyOn(v2Api,'createBoard')
    expect(await useV2Canvas.getState().closeBoard('a')).toBe(true)
    expect(useV2Canvas.getState()).toMatchObject({boardId:null,board:null,nodes:[],edges:[],openedBoardIds:[],pinnedBoardIds:['a'],loadState:'ready'})
    expect(create).not.toHaveBeenCalled()
  })
  it('invalidates a pending close after a newer board switch', async () => {
    let resolve!: (value:{activity:{}})=>void
    vi.mocked(v2Api.getBoardActivity).mockReturnValue(new Promise(r=>{resolve=r}))
    const closing=useV2Canvas.getState().closeBoard('a')
    await useV2Canvas.getState().switchBoard('b')
    resolve({activity:{}})
    expect(await closing).toBe(false)
    expect(useV2Canvas.getState().openedBoardIds).toContain('a')
    expect(useV2Canvas.getState().boardId).toBe('b')
  })
})
