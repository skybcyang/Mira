import { createStandaloneMiraHost } from './node-host.js'

export async function startNodeRuntime({
  workspaceRoot,
  staticRoot,
  host = '127.0.0.1',
  port = 0,
  hostOptions = {},
  createHost = createStandaloneMiraHost,
} = {}) {
  const miraHost = createHost({
    workspaceRoot,
    staticRoot,
    ...hostOptions,
  })

  try {
    const address = await miraHost.listen({ host, port })
    return {
      host: miraHost,
      address,
      close: () => miraHost.close(),
    }
  } catch (error) {
    try {
      await miraHost.close()
    } catch {
      // Keep the listen failure as the actionable startup error.
    }
    throw error
  }
}
