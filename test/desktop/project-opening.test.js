import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startNodeRuntime } from '../../bridge/node-runtime.js'
import { createProjectStateStore } from '../../desktop/project-state.mjs'
import { openDesktopProject, dispatchProjectMenuAction, createStagedProjectHost } from '../../desktop/project-opening.mjs'

const roots = [], runtimes = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mira-project-open-')); roots.push(root)
  const store = await createProjectStateStore(root)
  const startRuntime = async path => { const runtime = await startNodeRuntime({ workspaceRoot: path, hostOptions: { logger: { log() {}, error() {} } } }); runtimes.push(runtime); return runtime }
  return { root, store, startRuntime }
}

it('keeps old runtime, window, and recent record when target writer lock fails', async () => {
  const { root, store, startRuntime } = await fixture()
  const old = await startRuntime(join(root, 'old')), locked = await startRuntime(join(root, 'locked'))
  const oldProject = (await old.host.application.dispatch('GET', ['v2','project'])).body.project
  await store.commitOpen(oldProject)
  const activate = vi.fn(), createWindow = vi.fn()
  await expect(openDesktopProject({ path: locked.host.workspaceRoot, currentPath: old.host.workspaceRoot, startRuntime, createWindow, commitProject: store.commitOpen, activate })).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' })
  expect(store.currentProject()).toEqual(oldProject)
  expect(activate).not.toHaveBeenCalled()
  expect(createWindow).not.toHaveBeenCalled()
  expect((await old.host.application.dispatch('POST', ['v2','boards'], { title: 'still writable' })).status).toBe(201)
})

it('closes a staged target on renderer failure and only commits a validated target', async () => {
  const { root, store, startRuntime } = await fixture()
  const old = await startRuntime(join(root, 'old'))
  const oldProject = (await old.host.application.dispatch('GET', ['v2','project'])).body.project
  await store.commitOpen(oldProject)
  const path = join(root, 'target'), activate = vi.fn()
  await expect(openDesktopProject({ path, currentPath: old.host.workspaceRoot, startRuntime, createWindow: async () => { throw new Error('renderer failed') }, commitProject: store.commitOpen, activate })).rejects.toThrow('renderer failed')
  expect(store.currentProject()).toEqual(oldProject)
  const candidateWindow = { show: vi.fn(), destroy: vi.fn() }
  expect(await openDesktopProject({ path, currentPath: old.host.workspaceRoot, startRuntime, createWindow: async () => candidateWindow, commitProject: project => store.commitOpen(project), activate })).toEqual({ cancelled: false })
  expect(store.currentProject().path).toBe(path)
  expect(activate).toHaveBeenCalledOnce()
})

it('keeps a candidate window hidden when the project record commit fails', async () => {
  const { root, startRuntime } = await fixture()
  const candidateWindow = { show: vi.fn(), destroy: vi.fn() }
  await expect(openDesktopProject({
    path: join(root, 'target'),
    startRuntime,
    createWindow: async () => candidateWindow,
    commitProject: async () => { throw new Error('state commit failed') },
    activate: vi.fn(),
  })).rejects.toThrow('state commit failed')
  expect(candidateWindow.show).not.toHaveBeenCalled()
  expect(candidateWindow.destroy).toHaveBeenCalledOnce()
})

it('returns activation cleanup for the HTTP response lifecycle', async () => {
  const { root, startRuntime } = await fixture()
  const cleanup = vi.fn(), candidateWindow = { show: vi.fn(), destroy: vi.fn() }
  const result = await openDesktopProject({
    path: join(root, 'target'),
    startRuntime,
    createWindow: async () => candidateWindow,
    commitProject: vi.fn(),
    activate: vi.fn(() => cleanup),
  })
  expect(result).toEqual({ cancelled: false, afterResponse: cleanup })
})

it('requires an existing project unless initialization was explicitly selected', async () => {
  const startRuntime = vi.fn(async () => ({ host: { application: { dispatch: async () => ({ status: 200, body: { project: { id: 'p', name: 'P', path: '/target' } } }) } }, close: vi.fn() }))
  const prepareWorkspaceRoot = vi.fn(async path => path)
  const createWindow = vi.fn(async () => ({ show: vi.fn(), destroy: vi.fn() }))
  const options = { path: '/target', prepareWorkspaceRoot, startRuntime, createWindow, commitProject: vi.fn(), activate: vi.fn() }

  await openDesktopProject(options)
  expect(prepareWorkspaceRoot).toHaveBeenLastCalledWith('/target', { mustExist: true })
  await openDesktopProject({ ...options, allowCreate: true })
  expect(prepareWorkspaceRoot).toHaveBeenLastCalledWith('/target', { mustExist: false })
})

it('treats selecting the active project as cancellation without a second writer', async () => {
  const { root, startRuntime } = await fixture(), runtime = await startRuntime(root)
  const start = vi.fn()
  expect(await openDesktopProject({ path: root, currentPath: runtime.host.workspaceRoot, startRuntime: start })).toEqual({ cancelled: true })
  expect(start).not.toHaveBeenCalled()
})

it('routes native menu actions through the renderer leave guard event', async () => {
  const executeJavaScript = vi.fn(async () => undefined)
  await dispatchProjectMenuAction({ isDestroyed: () => false, webContents: { executeJavaScript } }, { kind: 'recent', projectId: 'p-1' })
  const events = []
  const CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail } }
  new Function('window', 'CustomEvent', executeJavaScript.mock.calls[0][0])({ dispatchEvent: event => events.push(event) }, CustomEvent)
  expect(events).toMatchObject([{ type: 'mira:open-project', detail: { kind: 'recent', projectId: 'p-1' } }])
})

it('waits for candidate project commit before saving late renderer navigation', async () => {
  const { store } = await fixture()
  const project = { id: 'target', name: 'Target', path: '/tmp/target' }
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const host = createStagedProjectHost({ projectState: {
    ...store, async commitOpen(...args) { entered.resolve(); await release.promise; return store.commitOpen(...args) },
  }, open: vi.fn() })
  const initial = { opened: ['one'], pinned: [], lastBoardId: 'one' }
  await host.saveNavigation(project, initial)
  expect(store.getNavigation(project)).toBeNull()
  const commit = host.commit(project)
  await entered.promise
  const next = { opened: ['one', 'two'], pinned: [], lastBoardId: 'two' }
  const save = host.saveNavigation(project, next)
  expect(store.currentProject()).toBeNull()
  release.resolve()
  await commit
  await expect(save).resolves.toEqual(next)
  expect(store.getNavigation(project)).toEqual(next)
  expect(host.getNavigation(project)).toEqual(next)
  expect(host.isStaging()).toBe(false)
})
