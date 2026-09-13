import { expect, it, vi } from 'vitest'
import { createToolExecutionService } from '../../bridge/tool-execution-service.js'
import { listBuiltinTools, toolDefinition } from '../../src/domain/toolPolicy.js'
const configuration = (id, phase, args) => ({ id: `${id}-${phase}`, tool: listBuiltinTools().find(t => t.id === id), phase, arguments: args })
function fixture(tools, capabilities = {}) {
  let run = { id: 'run-test', status: 'running', sourceSnapshot: [{ resolvedContent: 'yes' }], toolPolicySnapshot: { tools, allowTemporaryPython: false } }
  const service = createToolExecutionService({ capabilities: { resolve: async tool => ({ tool }), ...capabilities }, now: () => new Date().toISOString() })
  const save = async transform => { run = transform(run) }
  return { service, save, get run() { return run } }
}
it('executes before/after tools around the model and preserves failed checks', async () => {
  const f = fixture([configuration('mira-source-search', 'before', { query: 'yes' }), configuration('mira-output-check', 'after', { maxCharacters: 1 })])
  const result = await f.service.execute({ run: f.run, save: f.save, executeModel: async input => { expect(input.prompt).toContain('yes'); return { outputText: '正文' } }, input: { prompt: 'task', signal: new AbortController().signal } })
  expect(result.outputText).toBe('正文'); expect(f.run.toolExecutions.map(t => t.status)).toEqual(['succeeded', 'succeeded'])
  expect(f.run.toolExecutions[1].text).toContain('false')
})
it('requires one exact review before external call and rejects duplicate approval', async () => {
  let calls = 0
  const tool = toolDefinition({ id: 'mcp:write', title: 'Write', description: 'write', source: 'mcp', name: 'write', bindingId: 'mcp', inputSchema: { type: 'object' }, phases: ['before'], effect: 'review' })
  const f = fixture([{ id: 'write-1', tool, phase: 'before', arguments: { text: 'exact' } }], { call: async () => { calls++; return { text: 'done' } } })
  const promise = f.service.execute({ run: f.run, save: f.save, executeModel: async () => ({ outputText: 'ok' }), input: { prompt: 'task', signal: new AbortController().signal } })
  await vi.waitFor(() => expect(f.run.toolReview).toBeDefined()); expect(calls).toBe(0)
  const review = f.run.toolReview
  await expect(f.service.review(f.run.id, { requestId: review.requestId, digest: 'wrong', approve: true })).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
  await f.service.review(f.run.id, { requestId: review.requestId, digest: review.digest, approve: true })
  await expect(f.service.review(f.run.id, { requestId: review.requestId, digest: review.digest, approve: true })).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
  await promise; expect(calls).toBe(1); expect(f.run.toolReview).toBeUndefined()
})
it('does not start a tool after evidence storage fails', async () => {
  const f = fixture([configuration('mira-calculator', 'before', { operation: 'sum', values: [1] })])
  let models = 0
  await expect(f.service.execute({ run: f.run, save: async () => { throw Object.assign(Error('disk'), { code: 'RUN_WRITE_FAILED' }) }, executeModel: async () => { models++; return { outputText: 'no' } }, input: { prompt: 'task', signal: new AbortController().signal } })).rejects.toMatchObject({ code: 'RUN_WRITE_FAILED' })
  expect(models).toBe(0)
})
