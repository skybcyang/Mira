import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const ATTACHMENTS_DIR = 'attachments'
const MAX_BROWSE_ENTRIES = 500
const MAX_ATTACHMENT_ATTEMPTS = 100

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function toPosix(path) {
  return path.split(sep).join('/')
}

export function workspaceRelativePath(root, target) {
  const fromRoot = relative(resolve(root), resolve(target))
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return null
  }
  return toPosix(fromRoot)
}

export function pickAttachmentName(existingNames, fileName) {
  const taken = new Set(existingNames)
  if (!taken.has(fileName)) return fileName
  const extension = extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  for (let index = 2; index <= MAX_ATTACHMENT_ATTEMPTS + 1; index += 1) {
    const candidate = `${stem}-${index}${extension}`
    if (!taken.has(candidate)) return candidate
  }
  return null
}

function requirePath(value, operation) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    fail('BAD_REQUEST', `${operation} requires a non-empty file path`)
  }
  return value
}

function isBrowsable(entry) {
  return !entry.name.startsWith('.') && entry.name !== 'node_modules'
}

export function createFileLibrary({ workspaceRoot } = {}) {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw new TypeError('A workspace root is required to browse or import files')
  }
  const root = resolve(workspaceRoot)

  async function browse(body = {}) {
    const requested = typeof body.path === 'string' && body.path.trim() ? body.path : root
    if (requested.includes('\0')) fail('BAD_REQUEST', 'Browse path contains an invalid character')
    const directory = resolve(requested)
    let info
    try {
      info = await stat(directory)
    } catch {
      fail('FILE_ENTRY_NOT_FOUND', `Directory does not exist: ${requested}`)
    }
    if (!info.isDirectory()) fail('BAD_REQUEST', `Not a directory: ${requested}`)

    const dirents = await readdir(directory, { withFileTypes: true })
    const entries = dirents
      .filter((entry) => isBrowsable(entry) && (entry.isDirectory() || entry.isFile()))
      .map((entry) => {
        const path = join(directory, entry.name)
        return {
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
          path,
          workspaceRelative: workspaceRelativePath(root, path),
        }
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
        return left.name.localeCompare(right.name)
      })
      .slice(0, MAX_BROWSE_ENTRIES)

    const parent = dirname(directory)
    return {
      path: directory,
      parent: parent === directory ? null : parent,
      workspaceRelative: workspaceRelativePath(root, directory),
      entries,
    }
  }

  async function importFile(body = {}) {
    const requested = requirePath(body.path, 'File import')
    const target = resolve(requested)
    let info
    try {
      info = await stat(target)
    } catch {
      fail('FILE_ENTRY_NOT_FOUND', `File does not exist: ${requested}`)
    }
    if (!info.isFile()) fail('BAD_REQUEST', `Not a file: ${requested}`)

    const existing = workspaceRelativePath(root, target)
    if (existing !== null && existing !== '') return { path: existing, copied: false }

    const attachmentsRoot = resolve(root, ATTACHMENTS_DIR)
    await mkdir(attachmentsRoot, { recursive: true })
    const existingNames = await readdir(attachmentsRoot)
    const name = pickAttachmentName(existingNames, basename(target))
    if (!name) {
      fail('FILE_IMPORT_FAILED', `Could not find a free attachments name for: ${basename(target)}`)
    }
    const destination = resolve(attachmentsRoot, name)
    try {
      await copyFile(target, destination, constants.COPYFILE_EXCL)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        fail('FILE_IMPORT_FAILED', `Attachment name was taken during import: ${name}`)
      }
      fail('FILE_IMPORT_FAILED', `Could not copy file into the workspace: ${basename(target)}`)
    }
    return { path: `${ATTACHMENTS_DIR}/${name}`, copied: true }
  }

  return { browse, import: importFile }
}
