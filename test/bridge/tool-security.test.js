import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { createCapabilityService } from '../../bridge/capability-service.js'
import { createToolExecutionService } from '../../bridge/tool-execution-service.js'
import { executeBuiltin } from '../../bridge/tool-builtins.js'
import { listBuiltinTools, toolDefinition, validateTool, validateToolEvidence, validateToolPolicy } from '../../src/domain/toolPolicy.js'

const roots = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const imageA = 'sha256:' + 'a'.repeat(64), imageB = 'sha256:' + 'b'.repeat(64)
const remote = (extra = {}) => toolDefinition({ id: 'mcp:lookup', title: 'Lookup', description: 'lookup', source: 'mcp', name: 'lookup', bindingId: 'mcp', inputSchema: { type: 'object' }, phases: ['before', 'model', 'after'], effect: 'review', ...extra })
async function catalog(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mira-tool-security-')); roots.push(root)
  const fs = createNodeWorkspaceAdapter(root)
  return { fs, service: createCapabilityService({ fs, coordinator: createStorageCoordinator(), ...options }) }
}
function execution(tools, capabilities = {}, settings = {}, temporary = false) {
  let reviewing = false
  let run = { id: 'run-security', status: 'running', sourceSnapshot: [{ resolvedContent: 'frozen' }], toolPolicySnapshot: { tools, allowTemporaryPython: temporary } }
  const controller = new AbortController()
  const service = createToolExecutionService({ capabilities: { resolve: async tool => ({ tool }), ...capabilities }, ...settings })
  const save = async update => { run = update(run) }
  const start = (executeModel = async () => ({ outputText: 'result' }), customSave = save) => service.execute({ run, save: customSave, executeModel, input: { prompt: 'task', signal: controller.signal, onProgress: async event => { reviewing = event.phase === 'awaiting-review' } } })
  return { service, save, start, controller, get run() { return run }, get reviewing() { return reviewing } }
}
const approve = f => f.service.review(f.run.id, { requestId: f.run.toolReview.requestId, digest: f.run.toolReview.digest, approve: true })

it('stops immediately when a completed evidence write fails with any storage error', async () => {
  let calls = 0, writes = 0
  const tool = remote({ effect: 'read' })
  const f = execution([{ id: 'one', tool, phase: 'after', arguments: {} }, { id: 'two', tool, phase: 'after', arguments: {} }], { call: async () => { calls++; return { text: 'done' } } })
  await expect(f.start(undefined, async update => { if (++writes === 2) throw Object.assign(Error('disk'), { code: 'EIO' }); await f.save(update) })).rejects.toMatchObject({ code: 'EIO' })
  expect(calls).toBe(1)
})
it('canonical MCP arguments accept reordered keys without changing the fixed binding', async () => {
  let actual
  const f = execution([{ id: 'one', tool: remote({ effect: 'read' }), phase: 'model', arguments: { x: 1, y: { z: 2, q: 3 } } }], { call: async (_, args) => { actual = args; return { text: 'done' } } })
  await f.start(async model => { await model.invokeTool('mira_tool_1', { y: { q: 3, z: 2 }, x: 1 }); return { outputText: 'result' } })
  expect(actual).toEqual({ x: 1, y: { z: 2, q: 3 } })
})
it('freezes arguments before review so a later caller mutation cannot expand approval', async () => {
  const args = { text: 'approved' }; let actual
  const f = execution([{ id: 'one', tool: remote(), phase: 'model', arguments: { ...args } }], { call: async (_, value) => { actual = value; return { text: 'done' } } })
  const pending = f.start(async model => { await model.invokeTool('mira_tool_1', args); return { outputText: 'result' } })
  await vi.waitFor(() => expect(f.reviewing).toBe(true))
  args.text = 'changed after review'
  await approve(f); await pending
  expect(actual).toEqual({ text: 'approved' })
})
it('refuses approval immediately after cancellation, even before asynchronous cleanup', async () => {
  const f = execution([{ id: 'one', tool: remote(), phase: 'before', arguments: {} }])
  const pending = f.start().catch(e => e)
  await vi.waitFor(() => expect(f.reviewing).toBe(true))
  f.controller.abort()
  await expect(approve(f)).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
  await pending
})
it('refuses an expired approval even when the timer callback has not run yet', async () => {
  const f = execution([{ id: 'one', tool: remote(), phase: 'before', arguments: {} }], {}, { reviewTimeoutMs: 10000 })
  const pending = f.start().catch(e => e)
  await vi.waitFor(() => expect(f.reviewing).toBe(true))
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 20000)
  await expect(approve(f)).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
  f.controller.abort(); await pending
})
it('rejects malformed temporary Python parameters before asking for approval', async () => {
  const f = execution([], { pythonStatus: async () => ({ available: true, imageId: imageA }) }, { reviewTimeoutMs: 10 }, true)
  await expect(f.start(async model => { await model.invokeTool('mira_temporary_python', { code: 'print(1)', arguments: [] }); return { outputText: 'result' } })).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' })
  expect(f.run.toolReview).toBeUndefined()
})
it('temporary Python rejects a changed image rather than executing outside its reviewed environment', async () => {
  let calls = 0
  const { service } = await catalog({ python: { execute: async () => { calls++; return { text: 'bad' } } } })
  await service.update({ baseRevision: 0, pythonImageId: imageA })
  await service.update({ baseRevision: 1, pythonImageId: imageB })
  await expect(service.temporaryPython('print(1)', { sources: [], arguments: {} }, { imageId: imageA })).rejects.toMatchObject({ code: 'TOOL_CHANGED' })
  expect(calls).toBe(0)
})
it('a failed Python preparation never changes registry revision or environment', async () => {
  const { service } = await catalog({ python: { prepare: async () => ({ available: false, reason: 'isolation failed' }) } })
  await expect(service.preparePython({ baseRevision: 0 })).rejects.toMatchObject({ code: 'PYTHON_UNAVAILABLE' })
  expect((await service.get()).settings.revision).toBe(0)
})
it('removing a connection revokes its process credentials before an ID can be reused', async () => {
  const seen = []
  const { service } = await catalog({ mcp: { discover: async c => { seen.push(c.token); return { tools: [] } } } })
  const first = await service.connect({ baseRevision: 0, connection: { id: 'mcp-test', title: 'test', transport: 'http', url: 'http://localhost/mcp' }, credential: { token: 'session-secret-value' } })
  await service.update({ baseRevision: 1, removeConnection: 'mcp-test' })
  await service.connect({ baseRevision: 2, connection: { id: 'mcp-test', title: 'test', transport: 'http', url: 'http://localhost/other' } })
  expect(first.settings.connections[0].hasCredential).toBe(true)
  expect(seen).toEqual(['session-secret-value', undefined])
})
it('connection changes never silently send retained credentials to a different destination', async () => {
  const seen = []
  const { service } = await catalog({ mcp: { discover: async c => { seen.push(c.token); return { tools: [] } } } })
  await service.connect({ baseRevision: 0, connection: { id: 'mcp-test', title: 'test', transport: 'http', url: 'http://localhost/mcp' }, credential: { token: 'session-secret-value' } })
  await expect(service.connect({ baseRevision: 1, connection: { id: 'mcp-test', title: 'test', transport: 'http', url: 'http://localhost/other' } })).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' })
  expect(seen).toEqual(['session-secret-value'])
  expect((await service.get()).settings.connections[0].url).toBe('http://localhost/mcp')
  await service.connect({ baseRevision: 1, connection: { id: 'mcp-test', title: 'test', transport: 'http', url: 'http://localhost/other' }, credential: {} })
  expect(seen).toEqual(['session-secret-value', undefined])
})
it('rejects echoed credentials before a discovered tool can persist them', async () => {
  const { service } = await catalog({ mcp: { discover: async c => ({ tools: [{ name: 'lookup', description: c.token, inputSchema: { type: 'object' } }] }) } })
  await expect(service.connect({ baseRevision: 0, connection: { title: 'test', transport: 'http', url: 'http://localhost/mcp' }, credential: { token: 'session-secret-value' } })).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' })
  expect((await service.get()).settings.revision).toBe(0)
})
it('rejects token echoes in actual MCP responses and keeps the error itself secret-free', async () => {
  const mcp = { discover: async () => ({ tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] }), call: async c => ({ text: 'echo ' + c.token }) }
  const { service } = await catalog({ mcp })
  const first = await service.connect({ baseRevision: 0, connection: { title: 'test', transport: 'http', url: 'http://localhost/mcp' }, credential: { token: 'session-secret-value' } })
  const tool = first.settings.tools[0]; await service.update({ baseRevision: 1, tool: { id: tool.id, enabled: true } })
  await expect(service.call(tool, {}, { sources: [] })).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' })
})
it('rejects unsafe regular expressions, recursive references and excessive schema depth before compiling', () => {
  for (const inputSchema of [
    { type: 'object', properties: { x: { type: 'string', pattern: '(a+)+$' } } },
    { type: 'object', properties: { x: { $ref: '#' } } },
    Array.from({ length: 30 }).reduce(s => ({ type: 'object', properties: { x: s } }), { type: 'object' }),
  ]) expect(() => validateTool(remote({ inputSchema }))).toThrow()
})
it('persisted evidence must be bound to the frozen capability and have valid terminal fields', () => {
  const config = { id: 'one', tool: listBuiltinTools()[0], phase: 'before', arguments: { query: 'q' } }
  const record = { id: 'record', configId: 'one', title: config.tool.title, version: config.tool.version, phase: 'before', status: 'succeeded', arguments: { query: 'q' }, startedAt: '2026-09-14T00:00:00.000Z', finishedAt: '2026-09-14T00:00:01.000Z', text: 'ok' }
  const run = { id: 'run', status: 'succeeded', toolPolicySnapshot: { tools: [config], allowTemporaryPython: false }, toolExecutions: [record] }
  expect(() => validateToolEvidence(run)).not.toThrow()
  for (const change of [{ configId: 'forged' }, { version: 'forged' }, { finishedAt: undefined }, { startedAt: 'yesterday' }, { filesOmitted: 'yes' }, { files: [{ name: '../escape.txt', mimeType: 'text/plain', data: 'eA==' }] }]) {
    expect(() => validateToolEvidence({ ...run, toolExecutions: [{ ...record, ...change }] })).toThrow()
  }
  expect(() => validateToolEvidence({ ...run, toolExecutions: [record, record] })).toThrow()
})
it('reserves post-generation calls so model requests cannot consume their budget', async () => {
  const tool = remote({ effect: 'read' })
  const after = { id: 'check', tool: listBuiltinTools().find(t => t.id === 'mira-output-check'), phase: 'after', arguments: {} }
  const f = execution([{ id: 'lookup', tool, phase: 'model', arguments: {} }, after], { call: async () => ({ text: 'done' }) })
  await f.start(async model => {
    expect(model.maxToolCalls).toBe(7)
    for (let i = 0; i < 7; i++) await model.invokeTool('mira_tool_1', {})
    return { outputText: 'result' }
  })
  expect(f.run.toolExecutions).toHaveLength(8)
})
it('serializes model requests before side effects or review can overlap', async () => {
  let active = 0, maximum = 0
  const f = execution([{ id: 'lookup', tool: remote({ effect: 'read' }), phase: 'model', arguments: {} }], { call: async () => { active++; maximum = Math.max(active, maximum); await new Promise(r => setTimeout(r, 10)); active--; return { text: 'done' } } })
  await f.start(async model => { await Promise.all([model.invokeTool('mira_tool_1', {}), model.invokeTool('mira_tool_1', {})]); return { outputText: 'result' } })
  expect(maximum).toBe(1)
})
it('rejects overcommitted temporary tool selections before a durable Run', async () => {
  const tool = remote({ effect: 'read' })
  const capabilities = { pythonStatus: async () => ({ available: true, imageId: imageA }) }
  for (const phase of ['before', 'model', 'after']) {
    const f = execution(Array.from({ length: 8 }, (_, i) => ({ id: 'call-' + i, tool, phase, arguments: {} })), capabilities, {}, true)
    await expect(f.service.prepare({ toolPolicy: f.run.toolPolicySnapshot }, Object.assign(async () => {}, { supportsTools: true }))).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
  }
})
it('CSV column limits include the final field, and row limits include the final unterminated row', async () => {
  const tooWide = Array(101).fill('x').join(',') + '\n' + Array(101).fill('1').join(',')
  const tooLong = Array(10001).fill('x').join('\n')
  for (const text of [tooWide, tooLong]) await expect(executeBuiltin('mira-csv-summary', { sourceIndex: 0 }, { sources: [{ text }] })).rejects.toMatchObject({ code: 'TOOL_FAILED' })
})
it('material search stops at its result byte bound without constructing an unbounded match list', async () => {
  expect(await executeBuiltin('mira-source-search', { query: 'x' }, { sources: [{ text: 'x\n'.repeat(50000) }] }).then(() => null, e => e.code)).toBe('TOOL_LIMIT')
})
it('credential-shaped argument fields are rejected without rejecting schema declarations', () => {
  const tool = remote({ inputSchema: { type: 'object', properties: { token: { type: 'string' } } } })
  expect(() => validateTool(tool)).not.toThrow()
  for (const args of [{ token: 'not-a-host-credential-yet' }, { headers: { Authorization: 'Bearer secret' } }, { nested: [{ api_key: 'secret' }] }]) {
    expect(() => validateToolPolicy({ tools: [{ id: 'one', tool, phase: 'before', arguments: args }], allowTemporaryPython: false })).toThrow()
  }
})
it('retained stdio credentials keep their environment names on same-destination reconnect', async () => {
  const seen = []
  const { service } = await catalog({ mcp: { discover: async c => { seen.push(c); return { tools: [] } } } })
  const first = await service.connect({ baseRevision: 0, connection: { id: 'local', title: 'test', transport: 'stdio', command: 'fixture-program', args: [] }, credential: { env: { FIXTURE_SECRET: 'private-value' } } })
  await service.connect({ baseRevision: 1, connection: first.settings.connections[0] })
  expect(seen[1].envNames).toEqual(['FIXTURE_SECRET']); expect(seen[1].env).toEqual({ FIXTURE_SECRET: 'private-value' })
})
it('checks the selected script image independently of the project default', async () => {
  const seen = []
  const { service } = await catalog({ python: { status: async ({ image }) => { seen.push(image); return { available: true, imageId: image } } } })
  expect((await service.pythonStatus()).available).toBe(false)
  await service.update({ baseRevision: 0, pythonImageId: imageA })
  expect((await service.pythonStatus({ image: imageB })).imageId).toBe(imageB)
  expect(seen).toEqual([imageB])
})
it('aborts an in-flight adapter call when the model exits unexpectedly', async () => {
  let started = false, cancelled = false
  const f = execution([{ id: 'lookup', tool: remote({ effect: 'read' }), phase: 'model', arguments: {} }], { call: async (_, __, ___, { signal }) => { started = true; return new Promise((resolve, reject) => { signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason) }, { once: true }) }) } })
  await expect(f.start(async model => {
    model.invokeTool('mira_tool_1', {}).catch(() => {})
    await vi.waitFor(() => expect(started).toBe(true))
    throw Error('model exited')
  })).rejects.toThrow('model exited')
  expect(cancelled).toBe(true)
})
