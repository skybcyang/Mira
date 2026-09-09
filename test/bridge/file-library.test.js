import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ATTACHMENTS_DIR,
  createFileLibrary,
  pickAttachmentName,
  workspaceRelativePath,
} from '../../bridge/file-library.js'
import { dispatchV2Route } from '../../bridge/v2-routes.js'

let workspace
let outside

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mira-filelib-workspace-'))
  outside = await mkdtemp(join(tmpdir(), 'mira-filelib-outside-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('workspaceRelativePath', () => {
  it('returns a posix workspace-relative path for files inside the workspace', () => {
    expect(workspaceRelativePath(workspace, join(workspace, 'docs', 'a.md'))).toBe('docs/a.md')
    expect(workspaceRelativePath(workspace, workspace)).toBe('')
  })

  it('returns null for paths outside the workspace', () => {
    expect(workspaceRelativePath(workspace, join(outside, 'b.md'))).toBeNull()
    expect(workspaceRelativePath(workspace, join(workspace, '..', 'escape.md'))).toBeNull()
  })
})

describe('pickAttachmentName', () => {
  it('keeps the original name when nothing conflicts', () => {
    expect(pickAttachmentName([], 'research.md')).toBe('research.md')
  })

  it('appends a numeric suffix until the name is free', () => {
    expect(pickAttachmentName(['research.md'], 'research.md')).toBe('research-2.md')
    expect(
      pickAttachmentName(['research.md', 'research-2.md'], 'research.md'),
    ).toBe('research-3.md')
  })

  it('handles files without an extension', () => {
    expect(pickAttachmentName(['notes'], 'notes')).toBe('notes-2')
  })
})

describe('file library browse', () => {
  it('lists directories before files and hides dotfiles and node_modules', async () => {
    await mkdir(join(workspace, 'docs'))
    await mkdir(join(workspace, 'node_modules'))
    await mkdir(join(workspace, '.hidden'))
    await writeFile(join(workspace, 'readme.md'), '# hi')
    await writeFile(join(workspace, '.secret'), 'no')

    const library = createFileLibrary({ workspaceRoot: workspace })
    const result = await library.browse()

    expect(result.path).toBe(workspace)
    expect(result.workspaceRelative).toBe('')
    expect(result.entries.map((entry) => entry.name)).toEqual(['docs', 'readme.md'])
    expect(result.entries[0]).toMatchObject({
      kind: 'directory',
      workspaceRelative: 'docs',
    })
    expect(result.entries[1]).toMatchObject({
      kind: 'file',
      workspaceRelative: 'readme.md',
      path: join(workspace, 'readme.md'),
    })
  })

  it('browses absolute directories outside the workspace with a parent link', async () => {
    await mkdir(join(outside, 'papers'))
    await writeFile(join(outside, 'notes.txt'), 'hello')

    const library = createFileLibrary({ workspaceRoot: workspace })
    const result = await library.browse({ path: outside })

    expect(result.path).toBe(outside)
    expect(result.parent).toBe(tmpdir())
    expect(result.workspaceRelative).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['papers', 'notes.txt'])
    expect(result.entries[1].workspaceRelative).toBeNull()
  })

  it('rejects missing directories and file paths', async () => {
    const library = createFileLibrary({ workspaceRoot: workspace })
    await expect(library.browse({ path: join(workspace, 'missing') })).rejects.toMatchObject({
      code: 'FILE_ENTRY_NOT_FOUND',
    })
    await writeFile(join(workspace, 'a.md'), 'x')
    await expect(library.browse({ path: join(workspace, 'a.md') })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})

describe('file library import', () => {
  it('returns the existing relative path for files already inside the workspace', async () => {
    await mkdir(join(workspace, 'docs'))
    await writeFile(join(workspace, 'docs', 'source.md'), 'inside')

    const library = createFileLibrary({ workspaceRoot: workspace })
    const result = await library.import({ path: join(workspace, 'docs', 'source.md') })

    expect(result).toEqual({ path: 'docs/source.md', copied: false })
  })

  it('copies outside files into the attachments directory', async () => {
    await writeFile(join(outside, 'paper.pdf'), 'pdf-bytes')

    const library = createFileLibrary({ workspaceRoot: workspace })
    const result = await library.import({ path: join(outside, 'paper.pdf') })

    expect(result.path).toBe(`${ATTACHMENTS_DIR}/paper.pdf`)
    expect(result.copied).toBe(true)
    await expect(readFile(join(workspace, ATTACHMENTS_DIR, 'paper.pdf'), 'utf8'))
      .resolves.toBe('pdf-bytes')
    // 原文件保持不动
    await expect(readFile(join(outside, 'paper.pdf'), 'utf8')).resolves.toBe('pdf-bytes')
  })

  it('deduplicates attachment names across repeated imports', async () => {
    await mkdir(join(outside, 'one'))
    await mkdir(join(outside, 'two'))
    await writeFile(join(outside, 'one', 'data.csv'), 'first')
    await writeFile(join(outside, 'two', 'data.csv'), 'second')

    const library = createFileLibrary({ workspaceRoot: workspace })
    const first = await library.import({ path: join(outside, 'one', 'data.csv') })
    const second = await library.import({ path: join(outside, 'two', 'data.csv') })

    expect(first.path).toBe(`${ATTACHMENTS_DIR}/data.csv`)
    expect(second.path).toBe(`${ATTACHMENTS_DIR}/data-2.csv`)
    await expect(readFile(join(workspace, ATTACHMENTS_DIR, 'data.csv'), 'utf8'))
      .resolves.toBe('first')
    await expect(readFile(join(workspace, ATTACHMENTS_DIR, 'data-2.csv'), 'utf8'))
      .resolves.toBe('second')
  })

  it('rejects missing files and directories', async () => {
    const library = createFileLibrary({ workspaceRoot: workspace })
    await expect(library.import({ path: join(outside, 'missing.md') })).rejects.toMatchObject({
      code: 'FILE_ENTRY_NOT_FOUND',
    })
    await expect(library.import({ path: outside })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(library.import({})).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('file routes', () => {
  it('dispatches browse and import commands to the file library', async () => {
    const fileLibrary = {
      browse: vi.fn(async () => ({ path: '/w', parent: null, workspaceRelative: '', entries: [] })),
      import: vi.fn(async () => ({ path: 'attachments/a.md', copied: true })),
    }
    const dependencies = { fileLibrary }

    await expect(
      dispatchV2Route('POST', ['v2', 'files', 'browse'], { path: '/w/docs' }, dependencies),
    ).resolves.toEqual({
      status: 200,
      body: { path: '/w', parent: null, workspaceRelative: '', entries: [] },
    })
    expect(fileLibrary.browse).toHaveBeenCalledWith({ path: '/w/docs' })

    await expect(
      dispatchV2Route('POST', ['v2', 'files', 'import'], { path: '/tmp/a.md' }, dependencies),
    ).resolves.toEqual({ status: 201, body: { path: 'attachments/a.md', copied: true } })
    expect(fileLibrary.import).toHaveBeenCalledWith({ path: '/tmp/a.md' })
  })

  it('reports FILES_UNAVAILABLE when the host provides no file library', async () => {
    await expect(
      dispatchV2Route('POST', ['v2', 'files', 'browse'], {}, {}),
    ).rejects.toMatchObject({ code: 'FILES_UNAVAILABLE' })
    await expect(
      dispatchV2Route('POST', ['v2', 'files', 'import'], { path: '/tmp/a.md' }, {}),
    ).rejects.toMatchObject({ code: 'FILES_UNAVAILABLE' })
  })
})
