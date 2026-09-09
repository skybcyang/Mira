function timeoutError(sessionId) {
  return Object.assign(new Error(`Model session ${sessionId} did not finish in time`), {
    code: 'MODEL_TIMEOUT',
  })
}

export function createTurnWaiter({
  cacheTtlMs = 60_000,
  defaultTimeoutMs = 300_000,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  const waiting = new Map()
  const completed = new Map()
  const subscribers = new Map()

  function cacheCompleted(sessionId, event) {
    const previous = completed.get(sessionId)
    if (previous?.timer) clearTimer(previous.timer)
    const entry = { event, timer: null }
    entry.timer = setTimer(() => {
      if (completed.get(sessionId) === entry) completed.delete(sessionId)
    }, cacheTtlMs)
    entry.timer?.unref?.()
    completed.set(sessionId, entry)
  }

  return {
    handleEvent(sessionId, event) {
      if (!sessionId || !event) return
      const listeners = subscribers.get(sessionId)
      if (listeners) {
        for (const listener of listeners) listener(event)
      }
      if (event.type !== 'turn/end') return
      const resolvers = waiting.get(sessionId)
      if (!resolvers) {
        cacheCompleted(sessionId, event)
        return
      }
      waiting.delete(sessionId)
      for (const record of resolvers) {
        if (record.timer) clearTimer(record.timer)
        record.resolve(event)
      }
    },

    wait(sessionId, { timeoutMs = defaultTimeoutMs } = {}) {
      const completedEntry = completed.get(sessionId)
      if (completedEntry) {
        if (completedEntry.timer) clearTimer(completedEntry.timer)
        completed.delete(sessionId)
        return Promise.resolve(completedEntry.event)
      }
      return new Promise((resolve, reject) => {
        if (!waiting.has(sessionId)) waiting.set(sessionId, new Set())
        const record = { resolve, reject, timer: null }
        record.timer = setTimer(() => {
          const records = waiting.get(sessionId)
          records?.delete(record)
          if (records?.size === 0) waiting.delete(sessionId)
          reject(timeoutError(sessionId))
        }, timeoutMs)
        record.timer?.unref?.()
        waiting.get(sessionId).add(record)
      })
    },

    subscribe(sessionId, listener) {
      if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set())
      subscribers.get(sessionId).add(listener)
      return () => {
        const listeners = subscribers.get(sessionId)
        if (!listeners) return
        listeners.delete(listener)
        if (!listeners.size) subscribers.delete(sessionId)
      }
    },
  }
}
