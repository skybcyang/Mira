import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v2Api } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import { projectApi } from './projectApi'
import { executeProjectSwitch } from './projectSwitch'

beforeEach(() => {
  vi.restoreAllMocks()
  useV2Canvas.setState({ ...useV2Canvas.getInitialState(), loadState: 'ready', projectInfo: { project: { id: 'a', name: 'A', path: '/a' }, canSwitch: true, recentProjects: [], navigation: null } })
  vi.spyOn(useV2Canvas.getState(), 'flushBoardNavigation').mockResolvedValue()
  vi.spyOn(v2Api, 'getBoardActivity').mockResolvedValue({ activity: {} })
  vi.spyOn(projectApi, 'open').mockResolvedValue({ cancelled: true })
})

describe('project switch boundary', () => {
  it.each([{ activeRuns: 1, pendingCandidates: 0 }, { activeRuns: 0, pendingCandidates: 1 }])('blocks unfinished work in any project board %j', async counts => {
    vi.mocked(v2Api.getBoardActivity).mockResolvedValue({ activity: { anotherBoard: counts } })
    await expect(executeProjectSwitch({ kind: 'open' })).rejects.toThrow('运行或待处理结果')
    expect(projectApi.open).not.toHaveBeenCalled()
  })
  it('does not treat a failed activity read as an empty project', async () => {
    vi.mocked(v2Api.getBoardActivity).mockRejectedValue(new Error('status unavailable'))
    await expect(executeProjectSwitch({ kind: 'open' })).rejects.toThrow('status unavailable')
    expect(projectApi.open).not.toHaveBeenCalled()
  })
  it('waits for navigation persistence before invoking the host', async () => {
    let finish!: () => void
    vi.mocked(useV2Canvas.getState().flushBoardNavigation).mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const changing = executeProjectSwitch({ kind: 'recent', projectId: 'b' })
    await Promise.resolve()
    expect(projectApi.open).not.toHaveBeenCalled()
    finish()
    await expect(changing).resolves.toEqual({ cancelled: true })
    expect(projectApi.open).toHaveBeenCalledExactlyOnceWith({ kind: 'recent', projectId: 'b' })
  })
  it('preserves the project when opening records could not be saved', async () => {
    vi.mocked(useV2Canvas.getState().flushBoardNavigation).mockRejectedValue(new Error('preferences unavailable'))
    await expect(executeProjectSwitch({ kind: 'new' })).rejects.toThrow('preferences unavailable')
    expect(projectApi.open).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().projectInfo?.project.id).toBe('a')
  })
  it('blocks a pending save even if no run is active', async () => {
    useV2Canvas.setState({ saveState: 'saving' })
    await expect(executeProjectSwitch({ kind: 'open' })).rejects.toThrow('保存')
    expect(projectApi.open).not.toHaveBeenCalled()
  })
})
