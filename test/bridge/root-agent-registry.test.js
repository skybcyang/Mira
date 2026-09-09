import { describe, expect, it, vi } from 'vitest'
import { createRootAgentRegistry } from '../../bridge/root-agent-registry.js'

function board(rootSessionId) {
  return {
    id: 'board',
    runtime: {
      ...(rootSessionId ? { rootSessionId } : {}),
    },
  }
}

describe('root agent registry', () => {
  it('reuses an already-live root agent', async () => {
    const live = { id: 'root-live' }
    const agents = { get: vi.fn(() => live), resume: vi.fn(), create: vi.fn() }
    const store = { save: vi.fn() }
    const registry = createRootAgentRegistry({ agents, store, workspaceRoot: '/workspace', newSessionId: vi.fn() })

    await expect(registry.ensure('board', board('root-live'))).resolves.toBe(live)
    expect(agents.resume).not.toHaveBeenCalled()
    expect(agents.create).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('supports a v2-specific persisted session location', async () => {
    const sourceBoard = {
      id: 'board-v2',
      runtime: {},
    }
    const persistedBoard = structuredClone(sourceBoard)
    const store = {
      update: vi.fn(async (_boardId, change) => change(persistedBoard)),
    }
    const agents = {
      get: vi.fn(),
      create: vi.fn(async () => ({ agent: { id: 'root-v2' }, dispose: vi.fn() })),
    }
    const registry = createRootAgentRegistry({
      agents,
      store,
      workspaceRoot: Promise.resolve('/workspace'),
      newSessionId: () => 'session-v2',
      getPersistedSessionId: (board) => board.runtime?.rootSessionId,
      setPersistedSessionId: (board, sessionId) => {
        board.runtime.rootSessionId = sessionId
      },
    })

    await registry.ensure('board-v2', sourceBoard)

    expect(sourceBoard.runtime.rootSessionId).toBe('session-v2')
    expect(persistedBoard.runtime.rootSessionId).toBe('session-v2')
    expect(store.update).toHaveBeenCalledWith('board-v2', expect.any(Function))
  })

  it('resumes and owns a persisted root that is not live', async () => {
    const handle = { agent: { id: 'root-persisted' }, dispose: vi.fn(async () => {}) }
    const agents = { get: vi.fn(() => undefined), resume: vi.fn(async () => handle), create: vi.fn() }
    const registry = createRootAgentRegistry({
      agents,
      store: { save: vi.fn() },
      workspaceRoot: '/workspace',
      agentOptions: () => ({ provider: 'p', model: 'm' }),
      newSessionId: vi.fn(),
    })

    await expect(registry.ensure('board', board('root-persisted'))).resolves.toBe(handle.agent)
    expect(agents.resume).toHaveBeenCalledWith({
      resumeSessionId: 'root-persisted',
      agentOptions: { provider: 'p', model: 'm' },
    })
    await registry.dispose()
    expect(handle.dispose).toHaveBeenCalledOnce()
  })

  it('creates and persists a root through the board update coordinator', async () => {
    const handle = { agent: { id: 'root-new' }, dispose: vi.fn(async () => {}) }
    const agents = { get: vi.fn(), resume: vi.fn(), create: vi.fn(async () => handle) }
    const sourceBoard = board()
    const persistedBoard = structuredClone(sourceBoard)
    const store = {
      update: vi.fn(async (_boardId, change) => change(persistedBoard)),
    }
    const registry = createRootAgentRegistry({
      agents,
      store,
      workspaceRoot: Promise.resolve('/workspace'),
      agentOptions: () => ({ provider: 'p', model: 'm' }),
      newSessionId: () => 'root-new',
    })

    await expect(registry.ensure('board', sourceBoard)).resolves.toBe(handle.agent)
    expect(agents.create).toHaveBeenCalledWith({
      sessionId: 'root-new',
      agentOptions: { provider: 'p', model: 'm' },
      meta: { cwd: '/workspace' },
    })
    expect(sourceBoard.runtime.rootSessionId).toBe('root-new')
    expect(persistedBoard.runtime.rootSessionId).toBe('root-new')
    expect(store.update).toHaveBeenCalledWith('board', expect.any(Function))
  })

  it('coalesces concurrent first use of the same board into one root agent', async () => {
    let releaseCreate
    const createMayFinish = new Promise((resolve) => {
      releaseCreate = resolve
    })
    const handle = { agent: { id: 'root-one' }, dispose: vi.fn(async () => {}) }
    const agents = {
      get: vi.fn(),
      resume: vi.fn(),
      create: vi.fn(async () => {
        await createMayFinish
        return handle
      }),
    }
    const persistedBoard = board()
    const store = {
      update: vi.fn(async (_boardId, change) => change(persistedBoard)),
    }
    let nextSession = 0
    const registry = createRootAgentRegistry({
      agents,
      store,
      workspaceRoot: Promise.resolve('/workspace'),
      newSessionId: () => `root-${++nextSession}`,
    })
    const sourceBoard = board()

    const first = registry.ensure('board', sourceBoard)
    const second = registry.ensure('board', sourceBoard)
    await Promise.resolve()

    expect(agents.create).toHaveBeenCalledOnce()
    releaseCreate()
    await expect(Promise.all([first, second])).resolves.toEqual([handle.agent, handle.agent])
    expect(store.update).toHaveBeenCalledOnce()
  })

  it('never replaces a persisted root when resume fails', async () => {
    const agents = {
      get: vi.fn(() => undefined),
      resume: vi.fn(async () => {
        throw new Error('persistence offline')
      }),
      create: vi.fn(),
    }
    const registry = createRootAgentRegistry({
      agents,
      store: { save: vi.fn() },
      workspaceRoot: '/workspace',
      newSessionId: () => 'replacement',
    })

    await expect(registry.ensure('board', board('root-old'))).rejects.toMatchObject({
      code: 'ROOT_AGENT_UNAVAILABLE',
      message: expect.stringContaining('root-old'),
    })
    expect(agents.create).not.toHaveBeenCalled()
  })
})
