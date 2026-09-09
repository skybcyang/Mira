import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  prepareWorkspaceRoot,
  readDesktopState,
  writeDesktopState,
} from '../../desktop/workspace.mjs'

const temporaryRoots = []

async function createTemporaryRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('desktop workspace preparation', () => {
  it.each([undefined, null])('treats a cancelled selection (%s) as a zero-write result', async (selection) => {
    await expect(prepareWorkspaceRoot(selection)).resolves.toBeNull()
  })

  it('rejects a missing workspace without creating it', async () => {
    const parent = await createTemporaryRoot('mira-desktop-workspace-parent-')
    const missingRoot = join(parent, 'missing')

    await expect(prepareWorkspaceRoot(missingRoot)).rejects.toThrow()
    await expect(readdir(parent)).resolves.toEqual([])
  })

  it('rejects a regular file without changing it or creating data beside it', async () => {
    const parent = await createTemporaryRoot('mira-desktop-workspace-file-')
    const filePath = join(parent, 'not-a-directory')
    await writeFile(filePath, 'keep this file unchanged', 'utf8')

    await expect(prepareWorkspaceRoot(filePath)).rejects.toThrow()
    await expect(readFile(filePath, 'utf8')).resolves.toBe('keep this file unchanged')
    await expect(readdir(parent)).resolves.toEqual(['not-a-directory'])
  })

  it('initializes only the three business-data directories after validating a directory', async () => {
    const workspaceRoot = await createTemporaryRoot('mira-desktop-workspace-valid-')
    await writeFile(join(workspaceRoot, 'existing-note.md'), 'preserve me', 'utf8')

    await expect(prepareWorkspaceRoot(workspaceRoot)).resolves.toBe(workspaceRoot)

    await expect(readdir(workspaceRoot)).resolves.toEqual([
      'boards-v2',
      'existing-note.md',
      'runs-v2',
      'workflows-v2',
    ])
    await expect(readFile(join(workspaceRoot, 'existing-note.md'), 'utf8')).resolves.toBe(
      'preserve me',
    )
    for (const directory of ['boards-v2', 'runs-v2', 'workflows-v2']) {
      expect((await stat(join(workspaceRoot, directory))).isDirectory()).toBe(true)
    }
  })

  it('does not continue initializing when a required data path is occupied by a file', async () => {
    const workspaceRoot = await createTemporaryRoot('mira-desktop-workspace-collision-')
    await writeFile(join(workspaceRoot, 'workflows-v2'), 'collision', 'utf8')

    await expect(prepareWorkspaceRoot(workspaceRoot)).rejects.toThrow()
    await expect(readFile(join(workspaceRoot, 'workflows-v2'), 'utf8')).resolves.toBe('collision')
    await expect(readdir(workspaceRoot)).resolves.toEqual(['workflows-v2'])
  })
})

describe('desktop state persistence', () => {
  it('persists only the recent workspace and valid window bounds', async () => {
    const userDataRoot = await createTemporaryRoot('mira-desktop-state-')
    const state = {
      workspaceRoot: '/Users/example/Documents/Mira Workspace',
      windowBounds: { x: 120, y: 80, width: 1280, height: 800 },
      accessToken: 'must-not-be-persisted',
      boardId: 'must-not-be-persisted',
      nested: { arbitrary: true },
    }

    await writeDesktopState(userDataRoot, state)

    await expect(readDesktopState(userDataRoot)).resolves.toEqual({
      workspaceRoot: '/Users/example/Documents/Mira Workspace',
      windowBounds: { x: 120, y: 80, width: 1280, height: 800 },
    })
    const entries = await readdir(userDataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(/\.json$/)
    const persisted = JSON.parse(await readFile(join(userDataRoot, entries[0]), 'utf8'))
    expect(persisted).toEqual({
      workspaceRoot: '/Users/example/Documents/Mira Workspace',
      windowBounds: { x: 120, y: 80, width: 1280, height: 800 },
    })
  })

  it('drops blank workspace paths and invalid window bounds', async () => {
    const userDataRoot = await createTemporaryRoot('mira-desktop-invalid-state-')

    await writeDesktopState(userDataRoot, {
      workspaceRoot: '   ',
      windowBounds: { x: 10, y: 10, width: -1, height: 800 },
    })

    await expect(readDesktopState(userDataRoot)).resolves.toEqual({})
  })

  it('returns an empty state without creating files when no state exists', async () => {
    const parent = await createTemporaryRoot('mira-desktop-missing-state-')
    const missingUserDataRoot = join(parent, 'not-created')

    await expect(readDesktopState(missingUserDataRoot)).resolves.toEqual({})
    await expect(readdir(parent)).resolves.toEqual([])
  })

  it('returns an empty state for corrupted JSON', async () => {
    const userDataRoot = await createTemporaryRoot('mira-desktop-corrupt-state-')
    await writeDesktopState(userDataRoot, { workspaceRoot: '/valid/workspace' })
    const [stateFile] = await readdir(userDataRoot)
    await writeFile(join(userDataRoot, stateFile), '{not-json', 'utf8')

    await expect(readDesktopState(userDataRoot)).resolves.toEqual({})
  })

  it('replaces state atomically without leaving temporary files', async () => {
    const userDataRoot = await createTemporaryRoot('mira-desktop-atomic-state-')
    await writeDesktopState(userDataRoot, { workspaceRoot: '/first/workspace' })
    await writeDesktopState(userDataRoot, {
      workspaceRoot: '/second/workspace',
      windowBounds: { x: 0, y: 0, width: 1024, height: 768 },
    })

    const entries = await readdir(userDataRoot)
    expect(entries).toHaveLength(1)
    expect(entries.some((entry) => /(?:tmp|temp|partial)/i.test(entry))).toBe(false)
    await expect(readDesktopState(userDataRoot)).resolves.toEqual({
      workspaceRoot: '/second/workspace',
      windowBounds: { x: 0, y: 0, width: 1024, height: 768 },
    })
  })
})
