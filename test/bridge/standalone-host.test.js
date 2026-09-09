import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelSettingsService } from '../../bridge/model-settings.js'

const hostModule = new URL('../../bridge/node-host.js', import.meta.url)
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

describe('standalone Node host', () => {
  it('drains an in-flight response and releases the lock without waiting for keep-alive', async () => {
    const { createStandaloneMiraHost } = await import(hostModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-host-close-inflight-'))
    temporaryRoots.push(workspaceRoot)
    let finishRequest
    let requestStarted
    const started = new Promise((resolve) => { requestStarted = resolve })
    const host = createStandaloneMiraHost({
      workspaceRoot,
      logger: { log() {}, error() {} },
      modelSettings: {
        test() {
          requestStarted()
          return new Promise((resolve) => { finishRequest = resolve })
        },
      },
    })
    const address = await host.listen({ host: '127.0.0.1', port: 0 })
    let closePromise
    let timer
    try {
      const response = fetch(`${address.url}/graphmind/api/v2/model-settings/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      await started
      closePromise = host.close()
      finishRequest({ ok: true })
      await expect((await response).json()).resolves.toEqual({ ok: true })
      await Promise.race([
        closePromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Host waited for keep-alive after response')), 500)
        }),
      ])
      await expect(access(join(workspaceRoot, '.mira-workspace.lock')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      clearTimeout(timer)
      host.server.closeAllConnections()
      await (closePromise || host.close())
    }
  })

  it('takes an exclusive workspace lock, releases it on close, and rejects a stale lock', async () => {
    const { createStandaloneMiraHost } = await import(hostModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-workspace-lock-'))
    temporaryRoots.push(workspaceRoot)
    await mkdir(join(workspaceRoot, 'dist'), { recursive: true })
    await writeFile(join(workspaceRoot, 'dist', 'index.html'), '<!doctype html>')

    const first = createStandaloneMiraHost({ workspaceRoot, logger: { log() {}, error() {} } })
    expect(() => createStandaloneMiraHost({ workspaceRoot })).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_LOCKED' }),
    )

    await first.close()
    const second = createStandaloneMiraHost({ workspaceRoot, logger: { log() {}, error() {} } })
    await second.close()

    await writeFile(
      join(workspaceRoot, '.mira-workspace.lock'),
      JSON.stringify({ version: 1, pid: 1, hostname: 'offline-test' }),
    )
    expect(() => createStandaloneMiraHost({ workspaceRoot })).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_LOCKED' }),
    )
    await expect(readFile(join(workspaceRoot, '.mira-workspace.lock'), 'utf8'))
      .resolves.toContain('offline-test')
  })

  it('serves the Mira UI and persists v2 API writes without DSH', async () => {
    expect(await exists(hostModule)).toBe(true)
    const { createStandaloneMiraHost } = await import(hostModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-standalone-'))
    temporaryRoots.push(workspaceRoot)
    await mkdir(join(workspaceRoot, 'dist'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'dist', 'index.html'),
      '<!doctype html><title>Mira standalone</title>',
    )
    const modelSettings = createModelSettingsService({
      initial: {
        baseUrl: 'https://initial.example/v1',
        model: 'initial-model',
        apiKey: 'initial-secret',
      },
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: 'MIRA_OK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      clock: () => 20,
    })

    const host = createStandaloneMiraHost({
      workspaceRoot,
      newId: () => 'board-standalone',
      modelSettings,
      logger: { log() {}, error() {} },
    })
    const address = await host.listen({ host: '127.0.0.1', port: 0 })

    try {
      const root = await fetch(`${address.url}/`, { redirect: 'manual' })
      expect(root.status).toBe(302)
      expect(root.headers.get('location')).toBe('/graphmind/')

      const ui = await fetch(`${address.url}/graphmind/`)
      expect(ui.status).toBe(200)
      expect(ui.headers.get('content-type')).toBe('text/html; charset=utf-8')
      await expect(ui.text()).resolves.toContain('Mira standalone')

      const created = await fetch(`${address.url}/graphmind/api/v2/boards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Independent board' }),
      })
      expect(created.status).toBe(201)
      const createdBody = await created.json()
      expect(createdBody).toMatchObject({
        boardId: 'board-standalone',
        board: {
          title: 'Independent board',
          revision: 0,
          lifecycle: { state: 'active' },
        },
      })
      expect(createdBody.board.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const listed = await fetch(`${address.url}/graphmind/api/v2/boards`)
      await expect(listed.json()).resolves.toEqual({
        boards: [{
          id: 'board-standalone',
          title: 'Independent board',
          state: 'active',
          revision: 0,
          updatedAt: createdBody.board.updatedAt,
        }],
      })

      const currentModel = await fetch(`${address.url}/graphmind/api/v2/model-settings`)
      await expect(currentModel.json()).resolves.toEqual({
        provider: 'openai-compatible',
        baseUrl: 'https://initial.example/v1',
        model: 'initial-model',
        configured: true,
        hasApiKey: true,
        scope: 'process',
      })

      const savedModel = await fetch(`${address.url}/graphmind/api/v2/model-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://api.kimi.com/coding/v1',
          model: 'k3',
          apiKey: 'replacement-secret',
        }),
      })
      expect(savedModel.status).toBe(200)
      await expect(savedModel.json()).resolves.toMatchObject({
        baseUrl: 'https://api.kimi.com/coding/v1',
        model: 'k3',
        hasApiKey: true,
      })

      const testedModel = await fetch(`${address.url}/graphmind/api/v2/model-settings/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(testedModel.status).toBe(200)
      await expect(testedModel.json()).resolves.toEqual({ ok: true, latencyMs: 0 })

      const missingApi = await fetch(`${address.url}/graphmind/api/v2/missing`)
      expect(missingApi.status).toBe(404)
      expect(missingApi.headers.get('content-type')).toBe(
        'application/json; charset=utf-8',
      )
      await expect(missingApi.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })

      const invalidJson = await fetch(`${address.url}/graphmind/api/v2/boards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      })
      expect(invalidJson.status).toBe(400)
      await expect(invalidJson.json()).resolves.toMatchObject({ code: 'BAD_REQUEST' })

      const deepLink = await fetch(`${address.url}/graphmind/boards/board-standalone`)
      expect(deepLink.status).toBe(200)
      await expect(deepLink.text()).resolves.toContain('Mira standalone')

      const traversal = await fetch(
        `${address.url}/graphmind/%2e%2e%2fpackage.json`,
        { redirect: 'manual' },
      )
      expect(traversal.status).toBe(403)
      await expect(
        readFile(join(workspaceRoot, 'boards-v2', 'board-standalone.json'), 'utf8'),
      ).resolves.toContain('Independent board')
    } finally {
      await host.close()
    }
  })

  it('requires a configured desktop token for redirect, UI, and API routes', async () => {
    const { createStandaloneMiraHost } = await import(hostModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-standalone-token-'))
    temporaryRoots.push(workspaceRoot)
    await mkdir(join(workspaceRoot, 'dist'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'dist', 'index.html'),
      '<!doctype html><title>Mira protected</title>',
    )
    const accessToken = 'desktop-session-secret'
    const host = createStandaloneMiraHost({
      workspaceRoot,
      accessToken,
      logger: { log() {}, error() {} },
    })
    const address = await host.listen({ host: '127.0.0.1', port: 0 })
    const protectedPaths = [
      '/',
      '/graphmind/',
      '/graphmind/api/v2/boards',
    ]

    try {
      for (const path of protectedPaths) {
        const missingToken = await fetch(`${address.url}${path}`, {
          redirect: 'manual',
        })
        expect(missingToken.status).toBe(401)

        const wrongToken = await fetch(`${address.url}${path}`, {
          redirect: 'manual',
          headers: { 'x-mira-desktop-token': 'wrong-secret' },
        })
        expect(wrongToken.status).toBe(401)
      }

      const headers = { 'x-mira-desktop-token': accessToken }
      const root = await fetch(`${address.url}/`, { headers, redirect: 'manual' })
      expect(root.status).toBe(302)
      expect(root.headers.get('location')).toBe('/graphmind/')

      const ui = await fetch(`${address.url}/graphmind/`, { headers })
      expect(ui.status).toBe(200)
      await expect(ui.text()).resolves.toContain('Mira protected')

      const api = await fetch(`${address.url}/graphmind/api/v2/boards`, { headers })
      expect(api.status).toBe(200)
      await expect(api.json()).resolves.toEqual({ boards: [] })
    } finally {
      await host.close()
    }
  })

  it('serves protected HTML with a restrictive CSP without exposing its token', async () => {
    const { createStandaloneMiraHost } = await import(hostModule.href)
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-standalone-csp-'))
    temporaryRoots.push(workspaceRoot)
    await mkdir(join(workspaceRoot, 'dist'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'dist', 'index.html'),
      '<!doctype html><title>Mira CSP</title>',
    )
    const accessToken = 'never-echo-this-desktop-secret'
    const host = createStandaloneMiraHost({
      workspaceRoot,
      accessToken,
      logger: { log() {}, error() {} },
    })
    const address = await host.listen({ host: '127.0.0.1', port: 0 })

    try {
      const response = await fetch(`${address.url}/graphmind/`, {
        headers: { 'x-mira-desktop-token': accessToken },
      })
      expect(response.status).toBe(200)
      const csp = response.headers.get('content-security-policy')
      expect(csp).not.toBeNull()
      expect(csp || '').toContain("default-src 'self'")
      expect(csp || '').toContain("script-src 'self'")
      expect(csp || '').toContain("connect-src 'self'")
      expect(csp || '').toContain("object-src 'none'")
      expect(csp || '').toContain("base-uri 'none'")
      expect(csp || '').toContain("frame-ancestors 'none'")
      expect(csp || '').not.toContain("'unsafe-eval'")

      const body = await response.text()
      const serializedResponse = JSON.stringify({
        headers: Object.fromEntries(response.headers.entries()),
        body,
      })
      expect(serializedResponse).not.toContain(accessToken)
    } finally {
      await host.close()
    }
  })
})
