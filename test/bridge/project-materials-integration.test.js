import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStandaloneMiraHost } from '../../bridge/node-host.js'
import { restoreWorkspaceBackup } from '../../bridge/node-backup-restore.js'
import { createFileBindingService } from '../../bridge/domain/file-binding.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'

const roots = [], hosts = []
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() { const root = await mkdtemp(join(tmpdir(), 'mira-project-api-')); roots.push(root); const host = createStandaloneMiraHost({ workspaceRoot: root, logger: { log() {} } }); hosts.push(host); await host.application.ready; return { root, app: host.application } }
it('imports without a board, shares originals across boards, and carries bytes to another workspace', async () => {
  const { root, app } = await setup()
  await writeFile(join(root, 'source.md'), '项目原始材料')
  const imported = await app.dispatch('POST', ['v2', 'files', 'import'], { path: join(root, 'source.md') })
  expect(imported.body.path).toMatch(/^materials\//)
  expect((await app.dispatch('GET', ['v2', 'materials'])).body.assets).toHaveLength(1)
  const board = await app.boardStore.create('来源')
  await app.handlers.createCard(board.id, { name: '原件', filePath: imported.body.path, x: 0, y: 0 })
  const artifact = await app.boardPortabilityService.exportBoard(board.id)
  expect(artifact.formatVersion).toBe(2)
  expect(artifact.assets).toHaveLength(1)
  const target = await setup()
  const copy = await target.app.boardPortabilityService.importBoard({ artifact })
  expect(copy.board.id).not.toBe(board.id)
  await rm(join(root, 'source.md'))
  expect(await readFile(join(target.root, imported.body.path), 'utf8')).toBe('项目原始材料')
  const backup = await target.app.backupService.exportBackup()
  expect(backup.formatVersion).toBe(4)
  expect(backup.executionSettings.defaultOutputPolicy.id).toBe('concise')
  expect(backup.assets).toHaveLength(1)
  const backupPath = join(root, 'backup.json'), restoredRoot = join(root, 'restored')
  await writeFile(backupPath, JSON.stringify(backup))
  await restoreWorkspaceBackup({ inputPath: backupPath, workspaceRoot: restoredRoot })
  expect(await readFile(join(restoredRoot, imported.body.path), 'utf8')).toBe('项目原始材料')
  expect(JSON.parse(await readFile(join(restoredRoot, '.mira/workspace.json'), 'utf8')).id).toBeTruthy()
  expect(JSON.parse(await readFile(join(restoredRoot, `.mira/boards-v2/${copy.board.id}.json`), 'utf8')).id).toBe(copy.board.id)
})
it('protects internal data and immutable originals from file binding', async () => {
  const { root } = await setup()
  const binding = createFileBindingService({ fs: createNodeWorkspaceAdapter(root) })
  const card = { contentKind: 'markdown', headVersionId: 'v', versions: [{ id: 'v', content: { kind: 'markdown', markdown: 'manual' } }] }
  for (const path of ['.mira/workspace.json', 'materials/any.md', 'boards-v2/board.json', 'runs-v2/run.json', 'execution-settings-v1.json', 'execution-settings-v1.json.tmp']) {
    await expect(binding.bind(card, { path, overwrite: true })).rejects.toMatchObject({ code: 'FILE_BINDING_INVALID' })
  }
  expect((await binding.bind(card, { path: 'docs/result.md' })).fileSync.status).toBe('synced')
})
it('preserves managed originals in checkpoints, forks, and full backup restore', async () => {
  const { root, app } = await setup()
  await writeFile(join(root, 'evidence.md'), 'checkpoint evidence')
  const imported = await app.dispatch('POST', ['v2', 'files', 'import'], { path: 'evidence.md' })
  const board = await app.boardStore.create('检查点')
  await app.handlers.createCard(board.id, { filePath: imported.body.path, x: 0, y: 0 })
  const current = await app.boardStore.load(board.id)
  const { checkpoint } = await app.checkpointService.create(board.id, { baseRevision: current.revision, title: '稳定材料' })
  expect(checkpoint.artifact.assets).toHaveLength(1)
  const fork = await app.checkpointService.fork(board.id, checkpoint.id)
  expect(fork.board.id).not.toBe(board.id)
  expect((await app.dispatch('GET', ['v2', 'materials'])).body.assets).toHaveLength(1)
  const backup = await app.backupService.exportBackup()
  expect(backup.checkpoints[0].artifact.assets[0].data).toBe(Buffer.from('checkpoint evidence').toString('base64'))
  const inputPath = join(root, 'backup.json'), target = join(root, 'restored')
  await writeFile(inputPath, JSON.stringify(backup))
  await restoreWorkspaceBackup({ inputPath, workspaceRoot: target })
  const host = createStandaloneMiraHost({ workspaceRoot: target, logger: { log() {} } }); hosts.push(host)
  await host.application.ready
  const restored = await host.application.checkpointService.fork(board.id, checkpoint.id)
  expect(restored.board.cards).toHaveLength(1)
  expect(await readFile(join(target, imported.body.path), 'utf8')).toBe('checkpoint evidence')
})
it('imports selected heads into an existing board with new identities, materials, and read-only provenance', async () => {
  const source = await setup(), target = await setup()
  await writeFile(join(source.root, 'design.md'), '设计依据')
  const imported = await source.app.dispatch('POST', ['v2', 'files', 'import'], { path: join(source.root, 'design.md') })
  const board = await source.app.boardStore.create('来源')
  const { card } = await source.app.handlers.createCard(board.id, { filePath: imported.body.path, x: 100, y: 200 })
  const destination = await target.app.boardStore.create('目标')
  const artifact = await source.app.cardPortabilityService.exportCards(board.id, { cardIds: [card.id] })
  expect(artifact.selection).toBe(true)
  expect(artifact.runs).toEqual([])
  const result = await target.app.cardPortabilityService.importCards(destination.id, { artifact, baseRevision: destination.board.revision, position: { x: 10, y: 20 } })
  expect(result.cards).toHaveLength(1)
  expect(result.cards[0].id).not.toBe(card.id)
  expect(result.cards[0].copiedFrom.card).toBe(card.id)
  expect(result.cards[0].versions).toHaveLength(1)
  expect(result.cards[0]).toMatchObject({ x: 10, y: 20 })
  expect((await target.app.boardStore.load(destination.id)).cards).toHaveLength(1)
  expect((await target.app.runStore.listStrict())).toHaveLength(0)
  await expect(target.app.cardPortabilityService.importCards(destination.id, { artifact, baseRevision: 0, position: { x: 0, y: 0 } })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
})
it('keeps selected-card packages within the existing atomic history batch limit and accepts long board titles', async () => {
  const { app } = await setup()
  await expect(app.cardPortabilityService.exportCards('board', { cardIds: Array.from({ length: 101 }, (_, i) => `card-${i}`) })).rejects.toMatchObject({ code: 'BOARD_EXPORT_INVALID' })
  const source = await app.boardStore.create('名'.repeat(120))
  const { card } = await app.handlers.createCard(source.id, { markdown: 'material', x: 0, y: 0 })
  expect((await app.cardPortabilityService.exportCards(source.id, { cardIds: [card.id] })).board.cards).toHaveLength(1)
})
