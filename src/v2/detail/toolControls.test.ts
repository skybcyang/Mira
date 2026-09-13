import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { listBuiltinTools, type ToolPolicy } from '../../domain/toolPolicy.js'
import { draftToolPolicy, toolDrafts, missingRequiredTools, availableToolCatalog, reviewIdentity } from './toolControls'
import { ToolRunView } from './ToolRunView'
import { ToolPolicyEditor } from './ToolPolicyPanel'
import { GuidanceToolDependencies } from './GuidancePanel'
import { v2Api } from '../../v2Api'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'

const builtin = listBuiltinTools()[0]
const policy: ToolPolicy = { allowTemporaryPython: false, tools: [{ id: 'one', tool: builtin, phase: 'model', arguments: { query: 'test' } }] }
const base = { id: 'r', boardId: 'b', transformationId: 't', targetCardId: 'c', targetBaseVersionId: null, intent: 'create' as const, sourceSnapshot: [], createdAt: '2026-09-14T00:00:00Z', status: 'running' as const }
const review = { requestId: 'q', digest: 'digest', configId: 'one', title: '临时代码', version: 'v', arguments: { data: 'exact' }, code: 'print("hello")', environment: 'sha256:image', expiresAt: '2099-01-01T00:00:00Z' }

describe('step tool drafts and execution views', () => {
  it('round trips selected instances and preserves explicit scopes; malformed JSON cannot save', () => {
    const drafts = toolDrafts(policy)
    expect(draftToolPolicy(drafts, false)).toEqual(policy)
    drafts[0].argumentsText = '[]'
    expect(() => draftToolPolicy(drafts, false)).toThrow(/JSON 对象/)
    drafts[0].argumentsText = '{'
    expect(() => draftToolPolicy(drafts, false)).toThrow(/JSON/)
  })
  it('shows only enabled external capabilities without auto-binding historical snapshots', () => {
    const external = { ...builtin, id: 'remote', source: 'mcp' as const, bindingId: 'server' }
    expect(availableToolCatalog({ builtins: [builtin], settings: { tools: [external], enabled: [] } })).toEqual([builtin])
    expect(availableToolCatalog({ builtins: [builtin], settings: { tools: [external], enabled: ['remote'] } })).toEqual([builtin, external])
    expect(missingRequiredTools(['remote'], { ...policy, tools: [{ ...policy.tools[0], tool: { ...external, requiresBinding: true } }] })).toEqual(['remote'])
    expect(reviewIdentity(base.id, review)).not.toBe(reviewIdentity(base.id, { ...review, digest: 'new' }))
  })
  it('renders searchable source filters, explicit stages and keyboard reorder controls', () => {
    const html = renderToStaticMarkup(createElement(ToolPolicyEditor, { drafts: toolDrafts(policy), onChange: vi.fn(), catalog: listBuiltinTools(), disabled: false }))
    expect(html).toContain('搜索工具')
    expect(html).toContain('工具来源')
    expect(html).toContain('模型按需')
    expect(html).toContain('上移材料检索')
    expect(html).toContain('参数 JSON')
    expect(html).toContain('查看参数说明')
  })
  it('presents full pending review with one-time actions and preserves exact code as text', () => {
    const html = renderToStaticMarkup(createElement(ToolRunView, { run: { ...base, toolReview: review, toolPolicySnapshot: policy }, now: 0 }))
    expect(html).toContain('执行这份代码')
    expect(html).toContain('拒绝并停止')
    expect(html).toContain('sha256:image')
    expect(html).toContain('print(&quot;hello&quot;)')
    expect(html).toContain('exact')
    expect(html).toContain('尚未调用')
  })
  it('does not offer approval for terminal or expired runs or download unpreviewed files', () => {
    for (const run of [{ ...base, status: 'interrupted' as const }, base]) {
      const html = renderToStaticMarkup(createElement(ToolRunView, { run: { ...run, toolReview: review }, now: Date.parse('2100-01-01') }))
      expect(html).not.toContain('执行这份代码')
      expect(html).toContain('审阅已失效')
    }
    const html = renderToStaticMarkup(createElement(ToolRunView, { run: { ...base, toolExecutions: [{ id: 'e', configId: 'one', title: '工具', version: 'v', phase: 'model', status: 'succeeded', arguments: {}, startedAt: base.createdAt, text: '<script>unsafe</script>', files: [{ name: 'result.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }] }] } }))
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
    expect(html).toContain('预览 result.txt')
    expect(html).not.toContain('download=')
  })
  it('sends exact review identity and explicit decision to the API', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await v2Api.approveToolReview('r', { requestId: 'q', digest: 'd', approve: false })
      expect(fetcher.mock.calls[0]).toEqual(['/graphmind/api/v2/runs/r/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestId: 'q', digest: 'd', approve: false }) })])
    } finally { vi.unstubAllGlobals() }
  })
  it('labels an unfinished tool honestly after the run has stopped', () => {
    const html = renderToStaticMarkup(createElement(ToolRunView, { run: { ...base, status: 'interrupted', toolExecutions: [{ id: 'e', configId: 'one', title: '工具', version: 'v', phase: 'model', status: 'started', arguments: {}, startedAt: base.createdAt }] } }))
    expect(html).toContain('未完成')
    expect(html).not.toContain('正在执行')
  })
  it('shows required and optional guidance dependencies with explicit changes and a tools entry', () => {
    const html = renderToStaticMarkup(createElement(GuidanceToolDependencies, { selected: { requiredTools: ['new-tool'], optionalTools: ['optional'] }, previous: { requiredTools: ['old-tool'] }, policy, onTools: vi.fn() }))
    expect(html).toContain('缺少必需工具：new-tool')
    expect(html).toContain('可选：optional')
    expect(html).toContain('原必需：old-tool')
    expect(html).toContain('查看与配置本步工具')
  })
  it('deduplicates actual review clicks and requires readback after an uncertain response', async () => {
    const { window } = parseHTML('<html><body><div id="app"></div></body></html>')
    vi.stubGlobal('window', window); vi.stubGlobal('document', window.document); vi.stubGlobal('HTMLElement', window.HTMLElement)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let reject!: (cause: unknown) => void
    const onReview = vi.fn(() => new Promise((_, fail) => { reject = fail }))
    const root = createRoot(window.document.getElementById('app')!)
    try {
      await act(async () => root.render(createElement(ToolRunView, { run: { ...base, toolReview: review }, now: 0, onReview })))
      const button = [...window.document.querySelectorAll('button')].find(el => el.textContent === '执行这份代码')!
      await act(async () => { button.click(); button.click() })
      expect(onReview).toHaveBeenCalledExactlyOnceWith('r', { requestId: 'q', digest: 'digest', approve: true })
      await act(async () => reject(new Error('network error')))
      expect(window.document.body.textContent).toContain('重新核对运行状态')
      expect(button.hasAttribute('disabled')).toBe(true)
      expect(onReview).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
  })
})
