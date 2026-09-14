import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { startNodeRuntime } from '../../bridge/node-runtime.js'

const roots = [], runtimes = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function start(hostOptions = {}, workspaceRoot) {
  if (!workspaceRoot) { workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-project-host-')); roots.push(workspaceRoot) }
  const runtime = await startNodeRuntime({ workspaceRoot, hostOptions: { logger: { log() {}, error() {} }, ...hostOptions } })
  runtimes.push(runtime)
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${runtime.address.url}/graphmind/api/v2/${path}`, {
      method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }
  return { runtime, request, workspaceRoot }
}
const navigation = { opened: ['board-a'], pinned: [], lastBoardId: 'board-a' }

it('exposes stable project identity without switch authority or implicit boards in plain Node', async () => {
  const first = await start()
  const info = await first.request('project')
  expect(info).toMatchObject({ status: 200, body: { project: { path: first.workspaceRoot }, navigation: null, recentProjects: [], canSwitch: false } })
  expect(info.body.project.id).toBeTruthy()
  expect((await first.request('boards')).body.boards).toEqual([])
  expect(await first.request('project/navigation', 'PATCH', navigation)).toMatchObject({ status: 503, body: { code: 'PROJECT_HOST_UNAVAILABLE' } })
  await first.runtime.close()
  const second = await start({}, first.workspaceRoot)
  expect((await second.request('project')).body.project).toEqual(info.body.project)
})

it('isolates legacy identity by canonical path and does not add a project manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-project-host-')); roots.push(root)
  await mkdir(join(root, 'boards-v2'))
  const { request } = await start({}, root)
  expect((await request('project')).body.project).toMatchObject({ id: expect.stringMatching(/^legacy-/), path: root })
})

it('validates navigation and fences writes during switching while allowing reads and navigation saves', async () => {
  let finish
  const entered = Promise.withResolvers()
  const projectHost = {
    getNavigation: async () => null, getRecentProjects: async () => [],
    saveNavigation: vi.fn(async (_project, value) => value),
    open: vi.fn(async () => { entered.resolve(); return new Promise(resolve => { finish = resolve }) }),
  }
  const { request } = await start({ projectHost })
  expect(await request('project/navigation', 'PATCH', { ...navigation, extra: true })).toMatchObject({ status: 422, body: { code: 'PROJECT_NAVIGATION_INVALID' } })
  const switching = request('project/open', 'POST', { kind: 'open' })
  await entered.promise
  expect(await request('boards', 'POST', { title: 'must not exist' })).toMatchObject({ status: 409, body: { code: 'PROJECT_SWITCHING' } })
  expect(await request('project/open', 'POST', { kind: 'new' })).toMatchObject({ status: 409, body: { code: 'PROJECT_SWITCHING' } })
  expect((await request('boards')).body.boards).toEqual([])
  expect(await request('project/navigation', 'PATCH', navigation)).toMatchObject({ status: 200, body: { navigation } })
  finish({ cancelled: true })
  expect(await switching).toEqual({ status: 200, body: { cancelled: true } })
  expect((await request('boards', 'POST', { title: 'allowed again' })).status).toBe(201)
})

it('fails closed on unreadable Run state before opening any chooser', async () => {
  const projectHost = { open: vi.fn(), getNavigation: async () => null, getRecentProjects: async () => [] }
  const { request, workspaceRoot } = await start({ projectHost })
  await mkdir(join(workspaceRoot, '.mira/runs-v2'), { recursive: true })
  await writeFile(join(workspaceRoot, '.mira/runs-v2/bad.json'), '{bad')
  const result = await request('project/open', 'POST', { kind: 'open' })
  expect(result).toMatchObject({ status: 500, body: { code: expect.stringMatching(/^RUN_/) } })
  expect(projectHost.open).not.toHaveBeenCalled()
})

it('blocks candidate renderer mutations until the desktop validates and activates it', async () => {
  let staging = true
  const { request } = await start({ projectHost: { isStaging: () => staging, getNavigation: async () => null, getRecentProjects: async () => [] } })
  expect(await request('boards', 'POST', { title: 'uncommitted' })).toMatchObject({ status: 409, body: { code: 'PROJECT_SWITCHING' } })
  expect((await request('boards')).body.boards).toEqual([])
  staging = false
  expect((await request('boards', 'POST', { title: 'committed' })).status).toBe(201)
})

it('refuses switching for an active Run or reachable Candidate on any board', async () => {
  const model = Promise.withResolvers()
  const projectHost = { open: vi.fn(async () => ({ cancelled: true })), getNavigation: async () => null, getRecentProjects: async () => [] }
  const { request, runtime } = await start({ projectHost, executeModel: () => model.promise })
  const boardId = (await request('boards', 'POST', { title: 'background board' })).body.boardId
  const handlers = runtime.host.application.handlers
  const { card } = await handlers.createCard(boardId, { markdown: 'source' })
  const { transformation } = await handlers.createTransformation(boardId, { sourceRefs: [{ cardId: card.id, versionId: card.headVersionId }], label: 'result', instruction: 'summarize' })
  const { run } = await handlers.startRun(boardId, transformation.id)
  expect(await request('project/open', 'POST', { kind: 'open' })).toMatchObject({ status: 409, body: { code: 'PROJECT_BUSY' } })
  await handlers.commitCardVersion(boardId, transformation.targetCardId, { baseVersionId: null, markdown: 'human result' })
  model.resolve({ outputText: 'model result' })
  await vi.waitFor(async () => expect((await request(`runs/${run.id}`)).body.run.result?.disposition).toBe('candidate'))
  expect(await request('project/open', 'POST', { kind: 'open' })).toMatchObject({ status: 409, body: { code: 'PROJECT_BUSY' } })
  expect(projectHost.open).not.toHaveBeenCalled()
})

it('waits for a previously admitted write before opening and retains the fence on successful switch', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const projectHost = { open: vi.fn(async () => ({ cancelled: false })), getNavigation: async () => null, getRecentProjects: async () => [] }
  const modelSettings = { test: async () => { entered.resolve(); await release.promise; return { ok: true } } }
  const { request } = await start({ projectHost, modelSettings })
  const write = request('model-settings/test', 'POST', { model: 'temporary' })
  await entered.promise
  const open = request('project/open', 'POST', { kind: 'open' })
  await vi.waitFor(async () => expect(await request('boards', 'POST', { title: 'blocked' })).toMatchObject({ status: 409 }))
  expect(projectHost.open).not.toHaveBeenCalled()
  release.resolve()
  expect((await write).status).toBe(200)
  expect(await open).toEqual({ status: 200, body: { cancelled: false } })
  expect(await request('boards', 'POST', { title: 'still blocked' })).toMatchObject({ status: 409, body: { code: 'PROJECT_SWITCHING' } })
})

it('runs successful project cleanup after the HTTP response finishes', async () => {
  const afterResponse = vi.fn()
  const projectHost = {
    open: vi.fn(async () => ({ cancelled: false, afterResponse })),
    getNavigation: async () => null,
    getRecentProjects: async () => [],
  }
  const { request } = await start({ projectHost })
  expect(await request('project/open', 'POST', { kind: 'open' })).toEqual({ status: 200, body: { cancelled: false } })
  await vi.waitFor(() => expect(afterResponse).toHaveBeenCalledOnce())
})
