import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeProjectWorkspace } from '../../bridge/project-workspace.js'

const roots = []
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'mira-project-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('project workspace layout', () => {
  it('initializes beside project files and preserves identity when reopened', async () => {
    const root = await temporary()
    await writeFile(join(root, 'README.md'), 'project')
    const first = initializeProjectWorkspace(root)
    expect(first.directories.boards).toBe('.mira/boards-v2')
    expect(first.workspace.id).toBeTruthy()
    expect(initializeProjectWorkspace(root).workspace).toEqual(first.workspace)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('project')
  })
  it('leaves an existing v2 workspace in place', async () => {
    const root = await temporary()
    await mkdir(join(root, 'boards-v2'))
    expect(initializeProjectWorkspace(root)).toMatchObject({ layout: 'legacy', directories: {} })
    await expect(readFile(join(root, '.mira/workspace.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('enforces open and create intent at final initialization', async () => {
    const root = await temporary()
    expect(() => initializeProjectWorkspace(root, { mode: 'open' })).toThrow(/现有 Mira 项目/)
    await expect(readdir(root)).resolves.toEqual([])

    initializeProjectWorkspace(root)
    expect(() => initializeProjectWorkspace(root, { mode: 'create' })).toThrow(/已包含 Mira 项目/)
  })
  it('rejects an unknown initialization mode without writing', async () => {
    const root = await temporary()
    expect(() => initializeProjectWorkspace(root, { mode: 'typo' })).toThrow(/初始化方式/)
    await expect(readdir(root)).resolves.toEqual([])
  })
  it('fails closed on unknown metadata and ambiguous layouts', async () => {
    const root = await temporary()
    initializeProjectWorkspace(root)
    await mkdir(join(root, 'boards-v2'))
    await writeFile(join(root, 'boards-v2/board.json'), '{}')
    expect(() => initializeProjectWorkspace(root)).toThrow(/布局/)
    await rm(join(root, 'boards-v2'), { recursive: true })
    await writeFile(join(root, '.mira/workspace.json'), '{"formatVersion":900}')
    expect(() => initializeProjectWorkspace(root)).toThrow(/格式/)
  })
  it('rejects internal data symlinks without writing through them', async () => {
    const root = await temporary(), outside = await temporary()
    initializeProjectWorkspace(root)
    await symlink(outside, join(root, '.mira/boards-v2'))
    expect(() => initializeProjectWorkspace(root)).toThrow(/格式/)
  })
})
