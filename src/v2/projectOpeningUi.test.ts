import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProjectOverview, { type ProjectOverviewProps } from './ProjectOverview'
import ProjectMenu, { type ProjectMenuProps } from './ProjectMenu'

let root: Root, document: Document
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="app"></div><button id="outside">外部</button></body></html>')
  document = dom.document as unknown as Document
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', document)
  vi.stubGlobal('HTMLElement', dom.HTMLElement); vi.stubGlobal('Node', dom.Node)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let focused: Element = document.body
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => focused })
  vi.spyOn(dom.HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) { focused = this })
  root = createRoot(document.getElementById('app')!)
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const overview = (): ProjectOverviewProps => ({ projectName: '研究项目', boards: [], onOpenBoard: vi.fn(), onCreateBoard: vi.fn(), onManageBoards: vi.fn(), onMaterials: vi.fn(), onInspiration: vi.fn(), onMethods: vi.fn(), onRetry: vi.fn() })
const menu = (): ProjectMenuProps => ({ project: { name: '研究项目', path: '/projects/research' }, recentProjects: [{ id: 'other', name: '写作项目', path: '/projects/writing' }], canSwitch: true, busy: false, onOverview: vi.fn(), onOpenProject: vi.fn() })
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)! }
async function click(label: string) { await act(async () => button(label).click()) }
async function key(target: Element | Document, name: string) {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'key', { value: name })
  await act(async () => target.dispatchEvent(event))
}

it('keeps empty projects empty and exposes explicit board and project library commands', async () => {
  const props = overview()
  await act(async () => root.render(createElement(ProjectOverview, props)))
  expect(document.querySelector('h1')?.textContent).toBe('研究项目')
  expect(document.body.textContent).toContain('还没有画板')
  expect(props.onCreateBoard).not.toHaveBeenCalled()
  for (const [label, callback] of [['新建画板', props.onCreateBoard], ['管理全部画板', props.onManageBoards], ['材料', props.onMaterials], ['灵感池', props.onInspiration], ['方法', props.onMethods]] as const) {
    await click(label); expect(callback).toHaveBeenCalledOnce()
  }
})

it('searches active boards, opens the exact result, and distinguishes no results from an empty project', async () => {
  const props = overview()
  props.boards = [
    { id: 'a', title: '证据整理', state: 'active', revision: 1, updatedAt: '2026-09-14T00:00:00Z' },
    { id: 'b', title: '文章草稿', state: 'active', revision: 1, updatedAt: '2026-09-14T00:00:00Z' },
    { id: 'c', title: '已归档', state: 'archived', revision: 1, updatedAt: '2026-09-14T00:00:00Z' },
  ]
  await act(async () => root.render(createElement(ProjectOverview, props)))
  expect(document.body.textContent).not.toContain('已归档')
  const search = document.querySelector('input')!
  await act(async () => { search.value = '证据'; search.dispatchEvent(new window.Event('input', { bubbles: true })) })
  expect(document.body.textContent).not.toContain('文章草稿')
  await click('打开画板：证据整理')
  expect(props.onOpenBoard).toHaveBeenCalledWith('a')
  await act(async () => { search.value = '无匹配'; search.dispatchEvent(new window.Event('input', { bubbles: true })) })
  expect(document.body.textContent).toContain('没有匹配的画板')
  expect(document.body.textContent).not.toContain('还没有画板')
  await click('清除搜索')
  expect(document.body.textContent).toContain('文章草稿')
})

it('shows retry for read failures without claiming the project is empty and locks actions while busy', async () => {
  const props = overview()
  await act(async () => root.render(createElement(ProjectOverview, { ...props, error: '无法读取画板，请重试。' })))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法读取画板')
  expect(document.body.textContent).not.toContain('还没有画板')
  await click('重试'); expect(props.onRetry).toHaveBeenCalledOnce()
  await act(async () => root.render(createElement(ProjectOverview, { ...props, busy: true })))
  expect(document.body.textContent).toContain('正在读取画板')
  expect([...document.querySelectorAll<HTMLButtonElement>('#app button')].every(item => item.disabled)).toBe(true)
})

it('keeps project overview available in Standalone without offering unsupported project switching', async () => {
  const props = menu()
  await act(async () => root.render(createElement(ProjectMenu, { ...props, canSwitch: false })))
  await click('项目菜单：研究项目')
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  expect(document.body.textContent).toContain('/projects/research')
  expect(document.body.textContent).not.toContain('打开项目')
  await click('项目总览')
  expect(props.onOverview).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('routes explicit project commands by kind and recent project identity', async () => {
  const props = menu()
  await act(async () => root.render(createElement(ProjectMenu, props)))
  for (const [label, input] of [['打开项目…', { kind: 'open' }], ['新建项目…', { kind: 'new' }], ['从备份恢复…', { kind: 'restore' }], ['打开最近项目：写作项目', { kind: 'recent', projectId: 'other' }]] as const) {
    await click('项目菜单：研究项目'); await click(label)
    expect(props.onOpenProject).toHaveBeenLastCalledWith(input)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  }
})

it('supports arrow navigation, Escape focus return, outside dismissal, and busy locking', async () => {
  const props = menu()
  await act(async () => root.render(createElement(ProjectMenu, props)))
  await key(button('项目菜单：研究项目'), 'ArrowDown')
  expect(document.activeElement).toBe(button('项目总览'))
  await key(document.activeElement!, 'End')
  expect(document.activeElement).toBe(button('从备份恢复…'))
  await key(document.activeElement!, 'ArrowDown')
  expect(document.activeElement).toBe(button('项目总览'))
  await key(document, 'Escape')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(button('项目菜单：研究项目'))
  await click('项目菜单：研究项目')
  await key(document.activeElement!, 'Tab')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await click('项目菜单：研究项目')
  await act(async () => document.getElementById('outside')!.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await act(async () => root.render(createElement(ProjectMenu, { ...props, busy: true })))
  expect(button('项目菜单：研究项目').disabled).toBe(true)
  expect(document.body.textContent).toContain('正在切换项目')
})
