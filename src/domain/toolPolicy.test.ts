import { describe, expect, it } from 'vitest'
import { listBuiltinTools, validateToolPolicy, portableToolPolicy, methodToolPolicy, validateToolEvidence, validateToolSchema, toolDefinition } from './toolPolicy.js'

describe('bounded step tool policy', () => {
  const policy = () => ({ tools: [{ id: 'call-1', tool: listBuiltinTools()[0], phase: 'before' as const, arguments: { query: 'evidence' } }], allowTemporaryPython: false })
  it('supports old steps and a frozen builtin definition', () => { expect(() => validateToolPolicy(undefined)).not.toThrow(); expect(() => validateToolPolicy(policy())).not.toThrow() })
  it('rejects changed definitions, duplicate instances and unbounded arguments', () => {
    const p = policy(); p.tools[0].tool.description = 'changed'; expect(() => validateToolPolicy(p)).toThrow()
    const q = policy(); q.tools.push(q.tools[0]); expect(() => validateToolPolicy(q)).toThrow()
    const r = policy(); r.tools[0].arguments.query = 'x'.repeat(33000); expect(() => validateToolPolicy(r)).toThrow()
  })
  it('methods omit parameters and all resources require explicit rebinding', () => {
    const p = policy(); const result = methodToolPolicy(p)!
    expect(result.tools[0].arguments).toEqual({}); expect(result.tools[0].tool.requiresBinding).toBe(true)
    expect(portableToolPolicy(p)).toEqual(p)
  })
  it('rejects credentials or forged execution fields in persisted evidence', () => {
    expect(() => validateToolEvidence({ toolExecutions: [{ token: 'secret' }] })).toThrow()
    expect(() => validateToolEvidence({})).not.toThrow()
  })
  it.each(['mcp', 'python'] as const)('limits %s read/review tools to before or model even with a forged after phase', source => {
    for (const effect of ['read', 'review'] as const) {
      const tool = toolDefinition({ id: `external-${source}`, name: 'external', title: 'External', description: 'External tool', source, bindingId: 'binding', inputSchema: { type: 'object' }, phases: ['before', 'model', 'after'], effect })
      const p = { tools: [{ id: 'call', tool, phase: 'after' as 'before' | 'model' | 'after', arguments: {} }], allowTemporaryPython: false }
      expect(() => validateToolPolicy(p)).toThrow()
      for (const phase of ['before', 'model'] as const) {
        p.tools[0].phase = phase
        expect(() => validateToolPolicy(p)).not.toThrow()
      }
    }
  })
  it('permits the deterministic output checker after generation', () => {
    const tool = listBuiltinTools().find(t => t.id === 'mira-output-check')!
    expect(() => validateToolPolicy({ tools: [{ id: 'check', tool, phase: 'after', arguments: { contains: ['Result'] } }], allowTemporaryPython: false })).not.toThrow()
  })
})

describe('portable tool schema literal data', () => {
  it.each([
    { default: { token: 'secret' } },
    { examples: [{ options: [{ password: 'secret' }] }] },
    { const: { headers: { Authorization: 'secret' } } },
    { enum: [{ nested: { 'api-key': 'secret' } }] },
    { properties: { ordinary: { default: { credentials: { value: 'secret' } } } } },
    { properties: { token: { type: 'string', default: 'secret' } } },
    { properties: { 'access-token': { const: 'secret' } } },
    { properties: { password: { enum: ['secret'] } } },
    { properties: { client_secret: { examples: ['secret'] } } },
    { properties: { auth: { anyOf: [{ type: 'string', default: 'secret' }] } } },
    { properties: { env: { type: 'array', items: { const: 'secret' } } } },
    { properties: { credentials: { type: 'object', properties: { value: { default: 'secret' } } } } },
    { properties: { token: { allOf: [{ oneOf: [{ const: 'secret' }] }] } } },
    { properties: { auth: { additionalProperties: { enum: ['secret'] } } } },
  ])('rejects credential literals without relying on live session secrets: %j', fragment => {
    expect(() => validateToolSchema({ type: 'object', ...fragment })).toThrow()
  })
  it('retains authentication property declarations and ordinary defaults, examples, consts and enums', () => {
    const schema = {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Provided by the connection' },
        auth: { anyOf: [{ type: 'null' }, { type: 'object', properties: { password: { type: 'string' } } }] },
        format: { type: 'string', default: 'markdown', const: 'markdown', enum: ['markdown'], examples: ['markdown'] },
        count: { type: 'integer', default: 3 },
      },
      default: { format: 'markdown' },
      examples: [{ count: 5 }],
      enum: [{ format: 'markdown' }],
      const: { count: 3 },
    }
    expect(() => validateToolSchema(schema)).not.toThrow()
  })
})
