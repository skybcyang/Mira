import { execFile } from 'node:child_process'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = new URL('../../scripts/restore-backup.mjs', import.meta.url)
const packagePath = new URL('../../package.json', import.meta.url)
const temporaryRoots = []
const NOW = '2026-09-02T08:00:00.000Z'

function backup() {
  return {
    format: 'mira-backup',
    formatVersion: 1,
    exportedAt: NOW,
    boards: [{
      schemaVersion: 2,
      id: 'board-cli',
      title: 'CLI 恢复',
      revision: 0,
      lifecycle: { state: 'active' },
      cards: [],
      transformations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: NOW,
      updatedAt: NOW,
    }],
    runs: [],
    workflows: [],
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mira-restore-cli-test-'))
  temporaryRoots.push(root)
  const inputPath = join(root, 'input.mira-backup.json')
  const workspaceRoot = join(root, 'workspace')
  await writeFile(inputPath, JSON.stringify(backup()), 'utf8')
  return { inputPath, workspaceRoot }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ))
})

describe('restore-backup CLI', () => {
  it('registers the offline command without starting the Host', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))

    expect(packageJson.scripts['restore:backup']).toBe('node scripts/restore-backup.mjs')
  })

  it('restores with the exact documented arguments', async () => {
    const { inputPath, workspaceRoot } = await fixture()

    const result = await execFileAsync(process.execPath, [
      scriptPath.pathname,
      '--',
      '--input', inputPath,
      '--workspace', workspaceRoot,
    ])

    expect(result.stdout).toContain('Restored 1 Board, 0 Runs, 0 WorkflowTemplates and 0 Checkpoints')
    await expect(readFile(join(workspaceRoot, 'boards-v2/board-cli.json'), 'utf8'))
      .resolves.toContain('"board-cli"')
  })

  it.each([
    [[]],
    [['--input', 'only-input']],
    [['--workspace', 'target', '--input', 'source']],
    [['--input', 'source', '--workspace', 'target', '--unknown', 'value']],
  ])('rejects invalid arguments with usage and a non-zero exit: %j', async (args) => {
    await expect(execFileAsync(process.execPath, [scriptPath.pathname, ...args]))
      .rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          'Usage: pnpm restore:backup -- --input <path> --workspace <path>',
        ),
      })
  })

  it('reports a structured restore error and exits non-zero', async () => {
    const { inputPath, workspaceRoot } = await fixture()
    await writeFile(inputPath, '{invalid', 'utf8')

    await expect(execFileAsync(process.execPath, [
      scriptPath.pathname,
      '--input', inputPath,
      '--workspace', workspaceRoot,
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('[BACKUP_INVALID]'),
    })
  })
})
