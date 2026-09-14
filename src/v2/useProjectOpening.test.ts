import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useProjectOpening } from './useProjectOpening'
import * as switching from './projectSwitch'
import { useV2Canvas } from '../v2Store'

let root: Root, document: Document
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="app"></div></body></html>')
  document = dom.document as unknown as Document
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useV2Canvas.setState({ ...useV2Canvas.getInitialState(), loadState: 'ready', projectInfo: { project: { id: 'a', name: 'A', path: '/a' }, canSwitch: true, navigation: null, recentProjects: [] } })
  vi.spyOn(switching, 'executeProjectSwitch').mockResolvedValue({ cancelled: true })
  root = createRoot(document.getElementById('app')!)
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function Harness({ leave, blocked = null }: { leave: (intent: () => void) => void, blocked?: string | null }) {
  const opening = useProjectOpening(leave, blocked)
  return createElement('button', { className: 'v2-project-menu-trigger', onClick: () => opening.requestOpen({ kind: 'open' }) }, opening.busy ? 'busy' : 'ready')
}
async function nativeOpen() {
  const event = new window.Event('mira:open-project')
  Object.defineProperty(event, 'detail', { value: { kind: 'recent', projectId: 'b' } })
  await act(async () => window.dispatchEvent(event))
}
it('routes native and page opening through the same draft confirmation', async () => {
  const leave = vi.fn()
  await act(async () => root.render(createElement(Harness, { leave })))
  await nativeOpen()
  expect(leave).toHaveBeenCalledOnce()
  expect(switching.executeProjectSwitch).not.toHaveBeenCalled()
  await act(async () => leave.mock.calls[0][0]())
  expect(switching.executeProjectSwitch).toHaveBeenCalledWith({ kind: 'recent', projectId: 'b' })
  await act(async () => document.querySelector('button')!.click())
  expect(leave).toHaveBeenCalledTimes(2)
})
it('keeps modal task drafts reachable when native commands arrive', async () => {
  const leave = vi.fn()
  await act(async () => root.render(createElement(Harness, { leave, blocked: '请先关闭当前窗口。' })))
  await nativeOpen()
  expect(leave).not.toHaveBeenCalled()
  expect(switching.executeProjectSwitch).not.toHaveBeenCalled()
  expect(useV2Canvas.getState().notices.slice(-1)[0]?.message).toBe('请先关闭当前窗口。')
})
it('allows only one pending switch and unlocks the current project on cancellation', async () => {
  let finish!: (value: { cancelled: boolean }) => void
  vi.mocked(switching.executeProjectSwitch).mockReturnValue(new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(createElement(Harness, { leave: intent => intent() })))
  const focus = vi.spyOn(document.querySelector('button')!, 'focus')
  await act(async () => { document.querySelector('button')!.click(); document.querySelector('button')!.click() })
  await nativeOpen()
  expect(switching.executeProjectSwitch).toHaveBeenCalledOnce()
  expect(document.querySelector('button')!.textContent).toBe('busy')
  await act(async () => finish({ cancelled: true }))
  expect(document.querySelector('button')!.textContent).toBe('ready')
  expect(focus).toHaveBeenCalledOnce()
})
it('shows host errors and leaves the current project usable', async () => {
  vi.mocked(switching.executeProjectSwitch).mockRejectedValue(new Error('项目正在被其他窗口使用。'))
  await act(async () => root.render(createElement(Harness, { leave: intent => intent() })))
  await nativeOpen()
  expect(document.querySelector('button')!.textContent).toBe('ready')
  expect(useV2Canvas.getState().projectInfo?.project.id).toBe('a')
  expect(useV2Canvas.getState().notices.slice(-1)[0]?.message).toContain('其他窗口')
})
