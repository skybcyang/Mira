import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = new URL('../../scripts/migrate-remove-relations.mjs', import.meta.url)
const roots = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mira-remove-relations-'))
  roots.push(root)
  await mkdir(join(root, 'boards-v2'))
  const legacy = {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards: [],
    relations: [{ id: 'relation-1' }],
    transformations: [],
  }
  await writeFile(join(root, 'boards-v2/board-1.json'), JSON.stringify(legacy))
  return { root, boardPath: join(root, 'boards-v2/board-1.json') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('remove-relations migration', () => {
  it('supports a dry run without changing data or creating a backup', async () => {
    const { root, boardPath } = await fixture()

    const result = await execFileAsync(process.execPath, [
      scriptPath.pathname, '--workspace', root, '--dry-run',
    ])

    expect(result.stdout).toContain('Would remove relations from 1 board')
    expect(JSON.parse(await readFile(boardPath, 'utf8')).relations).toHaveLength(1)
    await expect(readdir(join(root, 'migration-backups'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('backs up and removes relations from affected boards', async () => {
    const { root, boardPath } = await fixture()

    const result = await execFileAsync(process.execPath, [
      scriptPath.pathname, '--workspace', root,
    ])

    const migrated = JSON.parse(await readFile(boardPath, 'utf8'))
    expect('relations' in migrated).toBe(false)
    expect(result.stdout).toMatch(/Backup: .+migration-backups.+/)
    const backupRoot = (await readdir(join(root, 'migration-backups')))[0]
    const backup = JSON.parse(await readFile(
      join(root, 'migration-backups', backupRoot, 'boards-v2/board-1.json'),
      'utf8',
    ))
    expect(backup.relations).toHaveLength(1)
  })
})
