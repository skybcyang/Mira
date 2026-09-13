import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { createCapabilityService } from '../../bridge/capability-service.js'
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mira-capabilities-test-')); roots.push(root)
  const fs = createNodeWorkspaceAdapter(root)
  return { root, fs, service: createCapabilityService({ fs, coordinator: createStorageCoordinator(), ...options }) }
}
it('discovers without enabling, stores no credentials and fails stale CAS', async () => {
  let calls = 0
  const { root, service } = await fixture({ mcp: { discover: async c => { expect(c.token).toBe('session-secret'); return { tools: [{ name: 'lookup', description: 'lookup', inputSchema: { type: 'object' } }] } }, call: async () => { calls++; return { text: 'ok' } } } })
  const result = await service.connect({ baseRevision: 0, connection: { title: 'Local', transport: 'http', url: 'http://localhost:3344/mcp' }, credential: { token: 'session-secret' } })
  expect(result.settings.tools).toHaveLength(1); expect(result.settings.enabled).toEqual([]); expect(calls).toBe(0)
  expect(await readFile(join(root, 'capability-settings-v1.json'), 'utf8')).not.toContain('session-secret')
  const tool = result.settings.tools[0]
  expect(tool.phases).toEqual(['before', 'model'])
  await expect(service.resolve(tool)).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' })
  await service.update({ baseRevision: 1, tool: { id: tool.id, enabled: true, readOnly: false } })
  expect((await service.resolve(tool)).tool.effect).toBe('review')
  await expect(service.update({ baseRevision: 1, tool: { id: tool.id, enabled: false } })).rejects.toMatchObject({ code: 'CAPABILITY_CONFLICT' })
})
it('script versions are immutable and bound to reviewed code and immutable environment', async () => {
  const { service } = await fixture({ python: { status: async () => ({ available: true, imageId: 'sha256:' + 'a'.repeat(64) }) } })
  const saved = await service.update({ baseRevision: 0, script: { title: '计算', code: 'print(1)', imageId: 'sha256:' + 'a'.repeat(64), inputSchema: { type: 'object' } } })
  const first = saved.settings.scripts[0]
  expect(saved.settings.tools[0].phases).toEqual(['before', 'model'])
  const next = await service.update({ baseRevision: 1, script: { ...first, code: 'print(2)' } })
  expect(next.settings.scripts[0].code).toBe('print(1)'); expect(next.settings.scripts).toHaveLength(2)
  await expect(service.resolve(saved.settings.tools[0])).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' })
})
it('failed replacement preserves saved configuration', async () => {
  const { fs, service } = await fixture()
  const previous = await service.get()
  fs.replace = async () => { throw Error('disk') }
  await expect(service.update({ baseRevision: 0, pythonImageId: 'sha256:' + 'a'.repeat(64) })).rejects.toMatchObject({ code: 'CAPABILITY_WRITE_FAILED' })
  expect(await service.get()).toEqual(previous)
})
