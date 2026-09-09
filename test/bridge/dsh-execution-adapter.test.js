import { describe, expect, it } from 'vitest'
import { createDshExecutionAdapter } from '../../bridge/dsh-cordis-adapter.js'

function adapter(selection) {
  return createDshExecutionAdapter({
    agents: {},
    subagents: { list: () => [] },
    sessionQuery: {},
    agentDefaultModel: { currentSelection: () => selection },
    boardStore: {},
    workspaceRoot: Promise.resolve('/workspace'),
  })
}

describe('DSH transformation model selection', () => {
  it('freezes the current host model when a step inherits', () => {
    expect(adapter({ provider: 'host-provider', model: 'host-model' }).resolveModel({}))
      .toEqual({ provider: 'host-provider', model: 'host-model' })
  })

  it('rejects a per-step override the host cannot honor', () => {
    expect(() => adapter({ provider: 'host-provider', model: 'host-model' })
      .resolveModel({ modelId: 'another-model' }))
      .toThrowError(expect.objectContaining({ code: 'MODEL_OVERRIDE_UNSUPPORTED' }))
  })
})
