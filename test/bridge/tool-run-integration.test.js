import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiraApplication, createMiraStores } from '../../bridge/mira-application.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { listBuiltinTools } from '../../src/domain/toolPolicy.js'
import { cleanPortableValue } from '../../bridge/domain/portable-format.js'
import { appendTerminalRunProgress } from '../../bridge/domain/run-progress.js'
import { validatePersistedRun } from '../../bridge/v2-run-store.js'
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mira-tool-run-')); roots.push(root)
  const stores = createMiraStores({ fs: createNodeWorkspaceAdapter(root) })
  const app = createMiraApplication({ stores, executeModel: async () => ({ outputText: '完成。' }), ...options }); await app.ready
  const board = await stores.boardStore.create('工具验证'), { card } = await app.handlers.createCard(board.id, { markdown: 'selected material' })
  const input = { label: '结果', instruction: '总结', sourceRefs: [{ cardId: card.id, versionId: card.headVersionId }] }
  return { root, stores, app, board, card, input }
}
const policy = (id, phase, args) => ({ tools: [{ id: 'tool-config-1', tool: listBuiltinTools().find(t => t.id === id), phase, arguments: args }], allowTemporaryPython: false })
it('persists and freezes explicit tools then writes the ordinary target with actual evidence', async () => {
  const executeModel = vi.fn(async input => { expect(input.prompt).toContain('selected material'); return { outputText: '结果正文' } })
  const f = await fixture({ executeModel })
  const toolPolicy = policy('mira-source-search', 'before', { query: 'selected' })
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy })
  expect(transformation.toolPolicy).toEqual(toolPolicy)
  expect(await f.stores.runStore.listStrict()).toEqual([])
  const { run } = await f.app.handlers.startRun(f.board.id, transformation.id)
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).result?.disposition).toBe('applied'))
  const saved = await f.stores.runStore.load(run.id)
  expect(saved.toolPolicySnapshot).toEqual(toolPolicy); expect(saved.toolExecutions[0]).toMatchObject({ status: 'succeeded', phase: 'before' })
  expect(saved.result.disposition).toBe('applied')
})
it('rejects unsupported model tools and missing Skill dependencies before creating any Run', async () => {
  const f = await fixture()
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy: policy('mira-calculator', 'model', { operation: 'sum', values: [1] }) })
  await expect(f.app.handlers.startRun(f.board.id, transformation.id)).rejects.toMatchObject({ code: 'MODEL_TOOLS_UNAVAILABLE' })
  const settings = await f.stores.executionSettingsStore.update({ baseRevision: 0, guidance: { title: '数字检查', text: '检查数字。', requiredTools: ['mira-calculator'] } })
  const guide = settings.guidance[0]
  const step = await f.app.handlers.createTransformation(f.board.id, { ...f.input, guidance: { id: guide.id, version: guide.version } })
  await expect(f.app.handlers.startRun(f.board.id, step.transformation.id)).rejects.toMatchObject({ code: 'TOOL_DEPENDENCY_MISSING' })
  expect(await f.stores.runStore.listStrict()).toEqual([])
})
it('serves host capability discovery separately from project enable and protects review identity', async () => {
  let calls = 0
  const f = await fixture({ toolAdapters: { mcp: { discover: async () => ({ tools: [{ name: 'write', description: 'write', inputSchema: { type: 'object' } }] }), call: async () => { calls++; return { text: 'written' } } } } })
  const connected = await f.app.dispatch('POST', ['v2', 'capabilities', 'connections'], { baseRevision: 0, connection: { title: '验证连接', transport: 'http', url: 'http://localhost:5432/mcp' } })
  expect(connected.status).toBe(200)
  const tool = connected.body.settings.tools[0]
  await f.app.dispatch('PATCH', ['v2', 'capabilities'], { baseRevision: 1, tool: { id: tool.id, enabled: true } })
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy: { tools: [{ id: 'write-1', tool, phase: 'before', arguments: { target: 'test', text: 'approved content' } }], allowTemporaryPython: false } })
  const { run } = await f.app.handlers.startRun(f.board.id, transformation.id)
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).toolReview).toBeDefined())
  expect(calls).toBe(0)
  const review = (await f.stores.runStore.load(run.id)).toolReview
  await f.app.dispatch('POST', ['v2', 'runs', run.id, 'review'], { requestId: review.requestId, digest: review.digest, approve: false })
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).status).toBe('failed'))
  expect(calls).toBe(0)
  const backup = await f.app.backupService.exportBackup()
  expect(JSON.stringify(backup)).not.toContain('localhost:5432')
  expect(await readFile(join(f.root, 'capability-settings-v1.json'), 'utf8')).toContain('localhost:5432')
})
it('exports bounded evidence without attachments and invalidates pending reviews at terminal transitions', () => {
  const value = { status: 'running', toolReview: { requestId: 'review' }, toolExecutions: [{ id: 'call', text: 'retained', files: [{ name: 'chart.png', mimeType: 'image/png', data: 'AAAA' }] }] }
  expect(cleanPortableValue(value)).toEqual({ status: 'running', toolExecutions: [{ id: 'call', text: 'retained', filesOmitted: true }] })
  expect(appendTerminalRunProgress(value, 'interrupted', new Date().toISOString()).toolReview).toBeUndefined()
  expect(() => validatePersistedRun({ id: 'r', boardId: 'b', targetCardId: 'c', status: 'running', toolExecutions: [{ token: 'bad' }] }, 'r')).toThrow()
})
it('extracts only tool requirements into a method and requires explicit binding on application', async () => {
  const f = await fixture()
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy: policy('mira-calculator', 'before', { operation: 'sum', values: [42] }) })
  const { run } = await f.app.handlers.startRun(f.board.id, transformation.id)
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).result?.disposition).toBe('applied'))
  const workflow = await f.app.workflowService.create({ title: '计算方法', sourceBoardId: f.board.id, transformationIds: [transformation.id] })
  expect(workflow.steps[0].toolPolicy.tools[0].arguments).toEqual({})
  expect(workflow.steps[0].toolPolicy.tools[0].tool.requiresBinding).toBe(true)
  const applied = await f.app.workflowService.apply(f.board.id, workflow.id, { sourceRefs: f.input.sourceRefs })
  await expect(f.app.handlers.startRun(f.board.id, applied.transformations[0].id)).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' })
})
it('keeps a human Head and stores the tool-assisted result as Candidate', async () => {
  let release, entered = false
  const answer = new Promise(resolve => { release = resolve })
  const f = await fixture({ executeModel: async () => { entered = true; return answer } })
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy: policy('mira-calculator', 'before', { operation: 'sum', values: [1, 2] }) })
  const { run } = await f.app.handlers.startRun(f.board.id, transformation.id)
  await vi.waitFor(() => expect(entered).toBe(true))
  const { card: human } = await f.app.handlers.commitCardVersion(f.board.id, transformation.targetCardId, { baseVersionId: null, markdown: '人工正文' })
  release({ outputText: '模型正文' })
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).status).toBe('succeeded'))
  expect((await f.stores.runStore.load(run.id)).result.disposition).toBe('candidate')
  const target = (await f.stores.boardStore.load(f.board.id)).cards.find(c => c.id === transformation.targetCardId)
  expect(target.headVersionId).toBe(human.headVersionId)
})
it('interrupts a pending review and never lets its old approval execute', async () => {
  let calls = 0
  const f = await fixture({ toolAdapters: { mcp: { discover: async () => ({ tools: [{ name: 'write', inputSchema: { type: 'object' } }] }), call: async () => { calls++; return { text: 'done' } } } } })
  const discovered = await f.app.capabilities.connect({ baseRevision: 0, connection: { title: 'test', transport: 'http', url: 'http://localhost:5444' } })
  const tool = discovered.settings.tools[0]
  await f.app.capabilities.update({ baseRevision: 1, tool: { id: tool.id, enabled: true } })
  const { transformation } = await f.app.handlers.createTransformation(f.board.id, { ...f.input, toolPolicy: { tools: [{ id: 'reviewed', tool, phase: 'before', arguments: {} }], allowTemporaryPython: false } })
  const { run } = await f.app.handlers.startRun(f.board.id, transformation.id)
  await vi.waitFor(async () => expect((await f.stores.runStore.load(run.id)).toolReview).toBeDefined())
  const review = (await f.stores.runStore.load(run.id)).toolReview
  const interrupted = await f.app.handlers.interruptRun(run.id)
  expect(interrupted.run.status).toBe('interrupted'); expect(interrupted.run.toolReview).toBeUndefined()
  await expect(f.app.dispatch('POST', ['v2', 'runs', run.id, 'review'], { requestId: review.requestId, digest: review.digest, approve: true })).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
  expect(calls).toBe(0)
  const recovered = createMiraApplication({ stores: f.stores }); await recovered.ready
  expect((await recovered.handlers.getRun(run.id)).run.status).toBe('interrupted')
})
