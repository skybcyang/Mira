function rootError(message) {
  return Object.assign(new Error(message), { code: 'ROOT_AGENT_UNAVAILABLE' })
}

export function createRootAgentRegistry({
  agents,
  store,
  workspaceRoot,
  agentOptions = () => ({}),
  newSessionId,
  getPersistedSessionId = (board) => board.runtime?.rootSessionId,
  setPersistedSessionId = (board, sessionId) => {
    board.runtime = board.runtime || {}
    board.runtime.rootSessionId = sessionId
  },
}) {
  const roots = new Map()
  const pending = new Map()

  return {
    async ensure(boardId, board) {
      const cached = roots.get(boardId)
      if (cached) return cached.agent
      const inFlight = pending.get(boardId)
      if (inFlight) return inFlight

      const operation = (async () => {
        const persistedId = getPersistedSessionId(board)
        if (persistedId) {
          const live = agents.get(persistedId)
          if (live) {
            roots.set(boardId, { agent: live, dispose: null })
            return live
          }
          try {
            const handle = await agents.resume({
              resumeSessionId: persistedId,
              agentOptions: agentOptions(),
            })
            roots.set(boardId, handle)
            return handle.agent
          } catch (error) {
            throw rootError(`failed to resume root agent ${persistedId}: ${(error && error.message) || error}`)
          }
        }

        const sessionId = newSessionId()
        let handle
        try {
          handle = await agents.create({
            sessionId,
            agentOptions: agentOptions(),
            meta: { cwd: await workspaceRoot },
          })
          setPersistedSessionId(board, sessionId)
          await store.update(boardId, async (latest) => {
            setPersistedSessionId(latest, sessionId)
            return latest
          })
          roots.set(boardId, handle)
          return handle.agent
        } catch (error) {
          if (handle?.dispose) await Promise.resolve(handle.dispose()).catch(() => {})
          throw rootError(`failed to create root agent ${sessionId}: ${(error && error.message) || error}`)
        }
      })()
      pending.set(boardId, operation)
      try {
        return await operation
      } finally {
        if (pending.get(boardId) === operation) pending.delete(boardId)
      }
    },

    async dispose() {
      const disposals = []
      for (const handle of roots.values()) {
        if (handle.dispose) disposals.push(handle.dispose().catch(() => {}))
      }
      roots.clear()
      await Promise.all(disposals)
    },
  }
}
