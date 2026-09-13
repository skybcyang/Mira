import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManagedMaterials } from '../../bridge/managed-materials.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'

const roots = []
async function setup() { const root = await mkdtemp(join(tmpdir(), 'mira-materials-')); roots.push(root); return { root, materials: createManagedMaterials({ workspaceRoot: root, coordinator: createStorageCoordinator() }) } }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('copies project files, deduplicates bytes, and survives source deletion', async () => {
  const { root, materials } = await setup()
  const source = join(root, 'notes.md')
  await writeFile(source, '原件\n')
  const [first, second] = await Promise.all([materials.importFile(source), materials.importFile(source)])
  expect(first.asset.id).toBe(second.asset.id)
  expect(first.path).not.toBe('notes.md')
  await rm(source)
  expect(await materials.readText(first.path)).toBe('原件\n')
  expect(await materials.list()).toHaveLength(1)
  await writeFile(source, '新版本')
  expect((await materials.importFile(source)).asset.id).not.toBe(first.asset.id)
  expect(await materials.readText(first.path)).toBe('原件\n')
})
it('refuses tampered originals and symlink imports', async () => {
  const { root, materials } = await setup()
  const source = join(root, 'file.txt')
  await writeFile(source, 'text')
  await symlink(source, join(root, 'link.txt'))
  await expect(materials.importFile(join(root, 'link.txt'))).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  const result = await materials.importFile(source)
  await writeFile(join(root, result.path), 'tampered')
  await expect(materials.readText(result.path)).rejects.toMatchObject({ code: 'MATERIAL_CORRUPT' })
  await expect(materials.importFile(source)).rejects.toMatchObject({ code: 'MATERIAL_CORRUPT' })
})
it('exports byte-exact assets, rejects bad packages before writes, and installs into another project', async () => {
  const { root, materials } = await setup()
  await writeFile(join(root, 'binary.dat'), Buffer.from([0, 255, 13, 10, 0]))
  const result = await materials.importFile(join(root, 'binary.dat'))
  const bundle = await materials.export([result.path])
  const target = await setup()
  await expect(target.materials.install([{ ...bundle[0], data: 'AAAA' }])).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  expect(await target.materials.list()).toEqual([])
  await target.materials.install(bundle)
  expect(await readFile(join(target.root, result.path))).toEqual(Buffer.from([0, 255, 13, 10, 0]))
  expect(await readdir(join(target.root, 'materials'))).toEqual([result.asset.id])
})
it('rejects oversized input and corrupt pre-existing asset directories without deleting them', async () => {
  const { root, materials } = await setup()
  const handle = await open(join(root, 'large.bin'), 'w')
  try { await handle.truncate(64 * 1024 * 1024 + 1) } finally { await handle.close() }
  await expect(materials.importFile(join(root, 'large.bin'))).rejects.toMatchObject({ code: 'MATERIAL_LIMIT' })
  expect(await materials.list()).toEqual([])
  await writeFile(join(root, 'small.txt'), 'small')
  const original = await materials.importFile(join(root, 'small.txt'))
  await rm(join(root, 'materials', original.asset.id, 'record.json'))
  await expect(materials.importFile(join(root, 'small.txt'))).rejects.toMatchObject({ code: 'MATERIAL_CORRUPT' })
  expect(await readFile(join(root, original.path), 'utf8')).toBe('small')
})
it('rejects a symlink replacing the managed materials directory', async () => {
  const { root, materials } = await setup()
  await mkdir(join(root, 'elsewhere'))
  await symlink(join(root, 'elsewhere'), join(root, 'materials'))
  await writeFile(join(root, 'note.txt'), 'text')
  await expect(materials.importFile(join(root, 'note.txt'))).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  expect(await readdir(join(root, 'elsewhere'))).toEqual([])
})
it('requires the exact canonical path, not just a matching content identity', async () => {
  const { materials } = await setup()
  const result = await materials.importText('text', 'note')
  const wrongPath = result.path.replace('.txt', '.pdf')
  await expect(materials.verify(wrongPath)).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  await expect(materials.readText(wrongPath)).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  await expect(materials.export([wrongPath])).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
})
