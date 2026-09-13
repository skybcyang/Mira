import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateProjectWorkspace } from '../../bridge/project-migration.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('rejects a normal project directory rather than creating an empty migrated workspace', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'mira-migration-')); roots.push(parent)
  const source = join(parent, 'source'); await mkdir(source)
  await writeFile(join(source, 'readme.md'), 'project')
  await expect(migrateProjectWorkspace({ sourceRoot: source, targetRoot: join(parent, 'target') })).rejects.toMatchObject({ code: 'WORKSPACE_MIGRATION_INVALID' })
  expect(await readdir(source)).toEqual(['readme.md'])
  expect(await readdir(parent)).toEqual(['source'])
})
it('copies legacy data into a fresh project without rewriting the source or scanning project files', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'mira-migration-')); roots.push(parent)
  const source = join(parent, 'source'), target = join(parent, 'target')
  await mkdir(join(source, 'boards-v2'), { recursive: true })
  const text = JSON.stringify(emptyBoardV2('b', '原画布', new Date().toISOString()))
  await writeFile(join(source, 'boards-v2/b.json'), text)
  await writeFile(join(source, 'private.txt'), 'do not include')
  await migrateProjectWorkspace({ sourceRoot: source, targetRoot: target })
  expect(await readFile(join(source, 'boards-v2/b.json'), 'utf8')).toBe(text)
  expect(await readdir(source)).toEqual(['boards-v2', 'private.txt'])
  expect(JSON.parse(await readFile(join(target, '.mira/boards-v2/b.json'), 'utf8')).id).toBe('b')
  await expect(readFile(join(target, 'private.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(migrateProjectWorkspace({ sourceRoot: source, targetRoot: target })).rejects.toBeTruthy()
  await expect(migrateProjectWorkspace({ sourceRoot: source, targetRoot: join(source, 'nested') })).rejects.toMatchObject({ code: 'WORKSPACE_MIGRATION_INVALID' })
})
