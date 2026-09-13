import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard, TransformationRun } from '../../domain'
import { useV2Canvas } from '../../v2Store'
import { v2Api } from '../../v2Api'
import { DrawerIntentContext } from '../drawerIntent'
import { RelationPanel } from './RelationPanel'
import { TransformationRunControl } from './RunPanel'

const now = '2026-09-14T00:00:00.000Z'
const card = (id: string): ContentCard => ({ id, contentKind: 'markdown', x: 0, y: 0, width: 300, height: 180, headVersionId: `${id}-v`, versions: [{ id: `${id}-v`, cardId: id, sequence: 1, content: { kind: 'markdown', markdown: id }, digest: id, origin: 'human', createdAt: now }], createdAt: now, updatedAt: now })
const board: BoardV2 = { schemaVersion: 2, id: 'b', title: 'Board', viewport: { x: 0, y: 0, zoom: 1 }, cards: [card('source'), card('target')], transformations: [{ id: 't', label: 'Step', instruction: 'Generate', acceptance: '', sourceCardIds: ['source'], targetCardId: 'target', permissions: { workspaceWrite: false }, lastRunId: 'old', createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }
const run: TransformationRun = { id: 'old', boardId: 'b', transformationId: 't', targetCardId: 'target', targetBaseVersionId: 'target-v', intent: 'update', sourceSnapshot: [], createdAt: now, status: 'succeeded', result: { disposition: 'applied', output: 'old', digest: 'old' } }
const original = useV2Canvas.getState()
let root: Root, document: Document
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="app"></div></body></html>')
  document = dom.document as unknown as Document
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', dom.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  root = createRoot(document.getElementById('app')!)
  useV2Canvas.setState({ board, boardId: 'b', runs: { old: run }, runningToTransformationId: null })
  vi.spyOn(v2Api, 'getModelSettings').mockResolvedValue({} as Awaited<ReturnType<typeof v2Api.getModelSettings>>)
})
afterEach(async () => { await act(async () => root.unmount()); useV2Canvas.setState(original, true); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!

it('keeps run-to-here and offers explicit single-step rerun only after a historical run', () => {
  const props = { workflowStep: true, sourcesReady: true, candidatePending: false, onRun: vi.fn(), onRerun: vi.fn() }
  const first = renderToStaticMarkup(createElement(TransformationRunControl, { ...props, hasRun: false }))
  const again = renderToStaticMarkup(createElement(TransformationRunControl, { ...props, hasRun: true }))
  expect(first).not.toContain('仅重跑这一步')
  expect(again).toContain('运行到这里')
  expect(again).toContain('仅重跑这一步')
  expect(again).toContain('上游步骤不会运行')
})

it.each([
  ['source unavailable', { sourcesReady: false }],
  ['other run active', { busy: true }],
  ['candidate pending', { candidatePending: true }],
  ['required tool missing', { blocked: '先补齐必需工具' }],
])('disables the explicit rerun when %s', async (_label, override) => {
  const onRerun = vi.fn()
  await act(async () => root.render(createElement(TransformationRunControl, { workflowStep: false, hasRun: true, sourcesReady: true, candidatePending: false, onRun: vi.fn(), onRerun, ...override })))
  expect(button('仅重跑这一步').disabled).toBe(true)
})

it('runs only the selected step once, locks the pending request, and can stop its active run', async () => {
  let finish!: () => void
  const rerun = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const runTo = vi.fn(), interrupt = vi.fn(async () => undefined)
  useV2Canvas.setState({ rerunTransformation: rerun, runToTransformation: runTo, interruptRun: interrupt })
  await act(async () => root.render(createElement(RelationPanel, { transformationId: 't' })))
  await act(async () => { button('仅重跑这一步').click(); button('仅重跑这一步').click() })
  expect(rerun).toHaveBeenCalledExactlyOnceWith('t')
  expect(runTo).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLButtonElement>('.v2-run-transformation')?.disabled).toBe(true)
  await act(async () => {
    useV2Canvas.setState({ runs: { old: run, live: { ...run, id: 'live', status: 'running', result: undefined } } })
    finish()
  })
  await act(async () => button('停止生成').click())
  expect(interrupt).toHaveBeenCalledExactlyOnceWith('live')
})

it('routes rerun through the unsaved-input guard and blocks when another step is active', async () => {
  const rerun = vi.fn(async () => undefined), guard = vi.fn()
  useV2Canvas.setState({ rerunTransformation: rerun })
  await act(async () => root.render(createElement(DrawerIntentContext.Provider, { value: { open: vi.fn(), run: guard } }, createElement(RelationPanel, { transformationId: 't' }))))
  await act(async () => button('仅重跑这一步').click())
  expect(guard).toHaveBeenCalledTimes(1)
  expect(rerun).not.toHaveBeenCalled()
  await act(async () => useV2Canvas.setState({ runs: { old: run, other: { ...run, id: 'other', transformationId: 'other-step', status: 'queued', result: undefined } } }))
  expect(button('仅重跑这一步').disabled).toBe(true)
})
