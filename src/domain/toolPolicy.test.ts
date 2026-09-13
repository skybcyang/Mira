import { describe, expect, it } from 'vitest'
import { listBuiltinTools, validateToolPolicy, portableToolPolicy, methodToolPolicy, validateToolEvidence } from './toolPolicy.js'

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
})
