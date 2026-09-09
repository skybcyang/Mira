import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const runtimeModule = new URL('../../bridge/node-runtime.js', import.meta.url)
const temporaryRoots = []

async function exists(url) {
  try {
    await access(url)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('standalone Node runtime', () => {
  it('starts the real host on a system-assigned loopback port and exposes close', async () => {
    expect(await exists(runtimeModule)).toBe(true)
    const { startNodeRuntime } = await import(runtimeModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-node-runtime-'))
    temporaryRoots.push(workspaceRoot)
    const staticRoot = join(workspaceRoot, 'web-dist')
    await mkdir(staticRoot, { recursive: true })
    await writeFile(
      join(staticRoot, 'index.html'),
      '<!doctype html><title>Mira runtime</title>',
    )

    const runtime = await startNodeRuntime({
      workspaceRoot,
      staticRoot,
      host: '127.0.0.1',
      port: 0,
      hostOptions: { logger: { log() {}, error() {} } },
    })
    const runtimeUrl = runtime.address.url

    try {
      expect(runtime.address).toMatchObject({
        host: '127.0.0.1',
        port: expect.any(Number),
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      })
      expect(runtime.address.port).toBeGreaterThan(0)
      expect(runtime.close).toEqual(expect.any(Function))

      const response = await fetch(`${runtimeUrl}/graphmind/`)
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toContain('Mira runtime')
      const activity = await fetch(`${runtimeUrl}/graphmind/api/v2/boards/activity`)
      expect(activity.status).toBe(200)
      await expect(activity.json()).resolves.toEqual({activity:{}})
    } finally {
      await runtime.close()
    }

    await expect(fetch(`${runtimeUrl}/graphmind/`)).rejects.toThrow()
  })

  it('closes a partially started host when listen fails', async () => {
    expect(await exists(runtimeModule)).toBe(true)
    const { startNodeRuntime } = await import(runtimeModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-node-runtime-failure-'))
    temporaryRoots.push(workspaceRoot)
    const staticRoot = join(workspaceRoot, 'web-dist')
    const listenFailure = new Error('listen failed after allocating resources')
    const hostOptions = { marker: 'forwarded-to-host' }
    let receivedHostOptions
    let receivedListenOptions
    let closeCalls = 0

    await expect(startNodeRuntime({
      workspaceRoot,
      staticRoot,
      host: '127.0.0.1',
      port: 0,
      hostOptions,
      createHost(options) {
        receivedHostOptions = options
        return {
          async listen(options) {
            receivedListenOptions = options
            throw listenFailure
          },
          async close() {
            closeCalls += 1
          },
        }
      },
    })).rejects.toBe(listenFailure)

    expect(receivedHostOptions).toEqual({
      workspaceRoot,
      staticRoot,
      ...hostOptions,
    })
    expect(receivedListenOptions).toEqual({ host: '127.0.0.1', port: 0 })
    expect(closeCalls).toBe(1)
  })
})
