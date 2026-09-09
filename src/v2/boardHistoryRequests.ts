export function createBoardHistoryRequestScope() {
  let generation = 0
  return {
    invalidate() { generation += 1 },
    capture() {
      const request = generation
      return () => request === generation
    },
    async run<T>(load: () => Promise<T>, success: (value: T) => void, failure: (reason: unknown) => void) {
      const request = ++generation
      try {
        const result = await load()
        if (request === generation) success(result)
      } catch (reason) {
        if (request === generation) failure(reason)
      }
    },
  }
}
