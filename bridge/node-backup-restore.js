import * as nodeFs from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'
import {
  BoardCheckpointStore,
  boardCheckpointFilename,
} from './board-checkpoint-store.js'
import { createNodeWorkspaceAdapter } from './node-workspace-adapter.js'
import {
  assertPortableByteLength,
  MIRA_BACKUP_LIMITS,
} from './domain/portable-format.js'
import { validateWorkspaceBackup } from './domain/workspace-backup.js'

const ENTITY_DIRECTORIES = Object.freeze({
  boards: 'boards-v2',
  runs: 'runs-v2',
  workflows: 'workflows-v2',
  checkpoints: 'board-checkpoints-v1',
})
const INSPIRATION_POOL_FILE = 'inspiration-pool-v2.json'
const SAFE_FILENAME_BYTES = 255

function restoreError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function errorMessage(error) {
  return error?.message || String(error)
}

function restoreFailure(message, error) {
  if (error?.code === 'BACKUP_RESTORE_TARGET_INVALID') return error
  return restoreError('BACKUP_RESTORE_FAILED', `${message}: ${errorMessage(error)}`, {
    ...(error?.code ? { causeCode: error.code } : {}),
  })
}

function isMissing(error) {
  return error?.code === 'ENOENT'
}

function assertSafeEntityId(kind, id) {
  const filename = `${id}.json`
  const unsafe =
    typeof id !== 'string'
    || !id.trim()
    || id === '.'
    || id.includes('..')
    || /[\u0000-\u001f\u007f/\\]/u.test(id)
    || basename(filename) !== filename
    || Buffer.byteLength(filename, 'utf8') > SAFE_FILENAME_BYTES
  if (unsafe) {
    throw restoreError('BACKUP_INVALID', `Unsafe ${kind} ID cannot be restored as a filename`, {
      kind,
      id,
    })
  }
  return id
}

function assertSafeEntitySet(kind, entities) {
  const filenames = new Set()
  for (const entity of entities) {
    const id = assertSafeEntityId(kind, entity.id)
    const collisionKey = `${id}.json`.normalize('NFC').toLocaleLowerCase('en-US')
    if (filenames.has(collisionKey)) {
      throw restoreError(
        'BACKUP_INVALID',
        `${kind} IDs would create colliding entity filenames`,
        { kind, id },
      )
    }
    filenames.add(collisionKey)
  }
}

function assertSafeEntityIds(backup) {
  assertSafeEntitySet('Board', backup.boards)
  assertSafeEntitySet('Run', backup.runs)
  assertSafeEntitySet('WorkflowTemplate', backup.workflows)
  const checkpointNames = new Set()
  for (const checkpoint of backup.formatVersion === 2 ? backup.checkpoints : []) {
    assertSafeEntityId('BoardCheckpoint', checkpoint.id)
    let filename
    try {
      filename = boardCheckpointFilename(checkpoint.boardId, checkpoint.id)
    } catch {
      throw restoreError('BACKUP_INVALID', 'BoardCheckpoint IDs would create invalid entity filenames', {
        id: checkpoint.id,
        boardId: checkpoint.boardId,
      })
    }
    const collisionKey = filename.normalize('NFC').toLocaleLowerCase('en-US')
    if (checkpointNames.has(collisionKey)) {
      throw restoreError('BACKUP_INVALID', 'BoardCheckpoint IDs would create invalid entity filenames', {
        id: checkpoint.id,
        boardId: checkpoint.boardId,
      })
    }
    checkpointNames.add(collisionKey)
  }
}

function assertBackupByteLimit(byteLength, maxBytes) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw restoreError('BACKUP_INVALID', 'Backup byte length must be a non-negative safe integer')
  }
  if (maxBytes === MIRA_BACKUP_LIMITS.maxBytes) {
    return assertPortableByteLength('mira-backup', byteLength)
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw restoreError('BACKUP_INVALID', 'Backup byte limit must be a non-negative safe integer')
  }
  if (byteLength > maxBytes) {
    throw restoreError('BACKUP_TOO_LARGE', 'mira-backup exceeds its UTF-8 JSON byte limit', {
      category: 'bytes',
      actual: byteLength,
      limit: maxBytes,
    })
  }
  return byteLength
}

export async function readBoundedBackupHandle(
  handle,
  { maxBytes = MIRA_BACKUP_LIMITS.maxBytes } = {},
) {
  let stats
  try {
    stats = await handle.stat()
  } catch (error) {
    throw restoreError('BACKUP_INVALID', `Backup file could not be statted: ${errorMessage(error)}`)
  }
  if (typeof stats.isFile !== 'function' || !stats.isFile()) {
    throw restoreError('BACKUP_INVALID', 'Backup input must be a regular file')
  }
  assertBackupByteLimit(stats.size, maxBytes)

  const chunks = []
  let byteLength = 0
  while (true) {
    const bytesToRead = byteLength < maxBytes
      ? Math.min(64 * 1024, maxBytes - byteLength)
      : 1
    const chunk = Buffer.allocUnsafe(bytesToRead)
    let bytesRead
    try {
      const result = await handle.read(chunk, 0, chunk.byteLength, null)
      bytesRead = result?.bytesRead
    } catch (error) {
      throw restoreError('BACKUP_INVALID', `Backup file could not be read: ${errorMessage(error)}`)
    }
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > chunk.byteLength) {
      throw restoreError('BACKUP_INVALID', 'Backup file returned an invalid read length')
    }
    if (bytesRead === 0) break
    byteLength += bytesRead
    assertBackupByteLimit(byteLength, maxBytes)
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, byteLength)
}

async function readBackup(inputPath, fs) {
  let handle
  try {
    handle = await fs.open(inputPath, 'r')
  } catch (error) {
    throw restoreError('BACKUP_INVALID', `Backup file could not be opened: ${errorMessage(error)}`)
  }

  let bytes
  let readError
  try {
    bytes = await readBoundedBackupHandle(handle)
  } catch (error) {
    readError = error
    throw error
  } finally {
    try {
      await handle.close()
    } catch (error) {
      if (!readError) {
        throw restoreError('BACKUP_INVALID', `Backup file could not be closed: ${errorMessage(error)}`)
      }
    }
  }
  const byteLength = bytes.byteLength

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw restoreError('BACKUP_INVALID', `Backup file is not valid UTF-8: ${errorMessage(error)}`)
  }
  let backup
  try {
    backup = JSON.parse(text)
  } catch (error) {
    throw restoreError('BACKUP_INVALID', `Backup file is not valid JSON: ${errorMessage(error)}`)
  }
  validateWorkspaceBackup(backup, { byteLength })
  assertSafeEntityIds(backup)
  return backup
}

async function targetState(target, fs) {
  let stats
  try {
    stats = await fs.lstat(target)
  } catch (error) {
    if (isMissing(error)) return 'missing'
    throw restoreError(
      'BACKUP_RESTORE_TARGET_INVALID',
      `Workspace target could not be inspected: ${errorMessage(error)}`,
    )
  }
  if (
    typeof stats.isSymbolicLink !== 'function'
    || stats.isSymbolicLink()
    || typeof stats.isDirectory !== 'function'
    || !stats.isDirectory()
  ) {
    throw restoreError(
      'BACKUP_RESTORE_TARGET_INVALID',
      'Workspace target must be missing or a real non-symlink directory',
    )
  }
  let entries
  try {
    entries = await fs.readdir(target)
  } catch (error) {
    throw restoreError(
      'BACKUP_RESTORE_TARGET_INVALID',
      `Workspace target could not be read: ${errorMessage(error)}`,
    )
  }
  if (entries.length > 0) {
    throw restoreError('BACKUP_RESTORE_TARGET_INVALID', 'Workspace target must be empty')
  }
  return 'empty'
}

async function assertUsableParent(target, fs) {
  const parent = dirname(target)
  if (parent === target || parse(target).root === target) {
    throw restoreError('BACKUP_RESTORE_TARGET_INVALID', 'A filesystem root cannot be restored')
  }
  try {
    const stats = await fs.stat(parent)
    if (typeof stats.isDirectory !== 'function' || !stats.isDirectory()) {
      throw new Error('parent is not a directory')
    }
  } catch (error) {
    throw restoreError(
      'BACKUP_RESTORE_TARGET_INVALID',
      `Workspace parent must already be a directory: ${errorMessage(error)}`,
    )
  }
  return parent
}

async function writeEntities(stagingRoot, directory, entities, fs) {
  const entityRoot = join(stagingRoot, directory)
  await fs.mkdir(entityRoot)
  for (const entity of entities) {
    await fs.writeFile(
      join(entityRoot, `${entity.id}.json`),
      `${JSON.stringify(entity, null, 2)}\n`,
      'utf8',
    )
  }
}

function direntName(entry) {
  return typeof entry === 'string' ? entry : entry.name
}

function isRealFileEntry(entry) {
  return typeof entry !== 'string' && entry.isFile() && !entry.isSymbolicLink()
}

async function strictReadEntities(root, directory, expected, fs) {
  const entityRoot = join(root, directory)
  const entries = await fs.readdir(entityRoot, { withFileTypes: true })
  const expectedNames = new Set(expected.map((entity) => `${entity.id}.json`))
  const names = entries.map(direntName)
  if (
    entries.some((entry) => !isRealFileEntry(entry))
    || names.length !== expectedNames.size
    || names.some((name) => !expectedNames.has(name))
  ) {
    throw new Error(`${directory} entity files do not exactly match the backup`)
  }

  const reread = []
  for (const entity of expected) {
    const filename = `${entity.id}.json`
    let parsed
    try {
      parsed = JSON.parse(await fs.readFile(join(entityRoot, filename), 'utf8'))
    } catch (error) {
      throw new Error(`${directory}/${filename} could not be strictly read: ${errorMessage(error)}`)
    }
    if (parsed?.id !== entity.id || JSON.stringify(parsed) !== JSON.stringify(entity)) {
      throw new Error(`${directory}/${filename} changed during staging verification`)
    }
    reread.push(parsed)
  }
  return reread
}

async function strictReadWorkspace(root, backup, fs) {
  const rootEntries = await fs.readdir(root, { withFileTypes: true })
  const expectedDirectories = new Set(Object.values(ENTITY_DIRECTORIES))
  const expectedFiles = backup.inspirationPool ? new Set([INSPIRATION_POOL_FILE]) : new Set()
  if (
    rootEntries.length !== expectedDirectories.size + expectedFiles.size
    || rootEntries.some((entry) =>
      typeof entry === 'string'
      || entry.isSymbolicLink()
      || (entry.isDirectory() && !expectedDirectories.has(entry.name))
      || (entry.isFile() && !expectedFiles.has(entry.name))
      || (!entry.isDirectory() && !entry.isFile()),
    )
  ) {
    throw new Error('Staging root does not contain exactly the managed directories')
  }

  const reread = {
    format: backup.format,
    formatVersion: backup.formatVersion,
    exportedAt: backup.exportedAt,
    boards: await strictReadEntities(
      root,
      ENTITY_DIRECTORIES.boards,
      backup.boards,
      fs,
    ),
    runs: await strictReadEntities(root, ENTITY_DIRECTORIES.runs, backup.runs, fs),
    workflows: await strictReadEntities(
      root,
      ENTITY_DIRECTORIES.workflows,
      backup.workflows,
      fs,
    ),
  }
  const expectedCheckpoints = backup.formatVersion === 2 ? backup.checkpoints : []
  const checkpointEntries = await fs.readdir(
    join(root, ENTITY_DIRECTORIES.checkpoints),
    { withFileTypes: true },
  )
  const expectedCheckpointNames = new Set(expectedCheckpoints.map(
    (checkpoint) => boardCheckpointFilename(checkpoint.boardId, checkpoint.id),
  ))
  if (
    checkpointEntries.length !== expectedCheckpointNames.size
    || checkpointEntries.some((entry) =>
      !isRealFileEntry(entry) || !expectedCheckpointNames.has(entry.name))
  ) {
    throw new Error('board-checkpoints-v1 entity files do not exactly match the backup')
  }
  const checkpointStore = new BoardCheckpointStore(
    createNodeWorkspaceAdapter(root, { fs }),
    ENTITY_DIRECTORIES.checkpoints,
  )
  const rereadCheckpoints = await checkpointStore.listStrict()
  const rereadCheckpointsById = new Map(rereadCheckpoints.map((checkpoint) => [checkpoint.id, checkpoint]))
  if (
    rereadCheckpoints.length !== expectedCheckpoints.length
    || expectedCheckpoints.some((checkpoint) =>
      JSON.stringify(rereadCheckpointsById.get(checkpoint.id)) !== JSON.stringify(checkpoint))
  ) {
    throw new Error('board-checkpoints-v1 entities changed during staging verification')
  }
  if (backup.formatVersion === 2) reread.checkpoints = rereadCheckpoints
  if (backup.inspirationPool) {
    let parsed
    try {
      parsed = JSON.parse(await fs.readFile(join(root, INSPIRATION_POOL_FILE), 'utf8'))
    } catch (error) {
      throw new Error(`${INSPIRATION_POOL_FILE} could not be strictly read: ${errorMessage(error)}`)
    }
    if (JSON.stringify(parsed) !== JSON.stringify(backup.inspirationPool)) {
      throw new Error(`${INSPIRATION_POOL_FILE} changed during staging verification`)
    }
    reread.inspirationPool = parsed
  }
  validateWorkspaceBackup(reread)
  return reread
}

async function pathExists(path, fs) {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function cleanupStaging(stagingRoot, fs) {
  if (!stagingRoot) return
  await fs.rm(stagingRoot, { recursive: true, force: true })
}

async function ensureEmptyTarget(target, fs) {
  const state = await targetState(target, fs)
  if (state === 'empty') return
  try {
    await fs.mkdir(target)
  } catch (error) {
    if (error?.code === 'EEXIST' && await targetState(target, fs) === 'empty') return
    throw error
  }
}

async function committedDespiteRenameError(stagingRoot, target, backup, fs) {
  if (await pathExists(stagingRoot, fs)) return false
  try {
    await strictReadWorkspace(target, backup, fs)
    return true
  } catch {
    return false
  }
}

function restoredCounts(backup) {
  return {
    boardCount: backup.boards.length,
    runCount: backup.runs.length,
    workflowCount: backup.workflows.length,
    checkpointCount: backup.formatVersion === 2 ? backup.checkpoints.length : 0,
    ...(backup.inspirationPool
      ? { inspirationEntryCount: backup.inspirationPool.entries.length }
      : {}),
  }
}

export async function restoreWorkspaceBackup(
  { inputPath, workspaceRoot } = {},
  { fs = nodeFs } = {},
) {
  if (typeof inputPath !== 'string' || !inputPath || typeof workspaceRoot !== 'string' || !workspaceRoot) {
    throw restoreError(
      'BACKUP_RESTORE_ARGUMENT_INVALID',
      'Both inputPath and workspaceRoot are required',
    )
  }
  const input = resolve(inputPath)
  const target = resolve(workspaceRoot)
  const backup = await readBackup(input, fs)
  const initialTargetState = await targetState(target, fs)
  const parent = await assertUsableParent(target, fs)
  let stagingRoot
  let removedEmptyTarget = false

  try {
    stagingRoot = await fs.mkdtemp(join(parent, `.${basename(target)}.mira-restore-`))
    await writeEntities(stagingRoot, ENTITY_DIRECTORIES.boards, backup.boards, fs)
    await writeEntities(stagingRoot, ENTITY_DIRECTORIES.runs, backup.runs, fs)
    await writeEntities(stagingRoot, ENTITY_DIRECTORIES.workflows, backup.workflows, fs)
    await fs.mkdir(join(stagingRoot, ENTITY_DIRECTORIES.checkpoints))
    const checkpointStore = new BoardCheckpointStore(
      createNodeWorkspaceAdapter(stagingRoot, { fs }),
      ENTITY_DIRECTORIES.checkpoints,
    )
    await checkpointStore.saveManyPrevalidated(
      backup.formatVersion === 2 ? backup.checkpoints : [],
    )
    if (backup.inspirationPool) {
      await fs.writeFile(
        join(stagingRoot, INSPIRATION_POOL_FILE),
        `${JSON.stringify(backup.inspirationPool, null, 2)}\n`,
        'utf8',
      )
    }
    try {
      await strictReadWorkspace(stagingRoot, backup, fs)
    } catch (error) {
      throw restoreFailure('Staged workspace verification failed', error)
    }

    const finalTargetState = await targetState(target, fs)
    if (finalTargetState !== initialTargetState) {
      throw restoreError(
        'BACKUP_RESTORE_TARGET_INVALID',
        'Workspace target changed while the backup was being staged',
      )
    }
    if (initialTargetState === 'empty') {
      await fs.rmdir(target)
      removedEmptyTarget = true
    }

    try {
      await fs.rename(stagingRoot, target)
      stagingRoot = undefined
    } catch (error) {
      if (await committedDespiteRenameError(stagingRoot, target, backup, fs)) {
        stagingRoot = undefined
      } else {
        throw error
      }
    }

    return { workspaceRoot: target, restored: restoredCounts(backup) }
  } catch (error) {
    let cleanupError
    try {
      await cleanupStaging(stagingRoot, fs)
      stagingRoot = undefined
    } catch (caught) {
      cleanupError = caught
    }
    if (removedEmptyTarget) {
      try {
        await ensureEmptyTarget(target, fs)
      } catch (caught) {
        cleanupError ||= caught
      }
    }
    if (cleanupError) {
      throw restoreError(
        'BACKUP_RESTORE_FAILED',
        `Restore failed and cleanup could not complete: ${errorMessage(cleanupError)}`,
        { cause: errorMessage(error), cleanup: errorMessage(cleanupError) },
      )
    }
    if (
      error?.code === 'BACKUP_RESTORE_TARGET_INVALID'
      || error?.code === 'BACKUP_RESTORE_FAILED'
    ) {
      throw error
    }
    throw restoreFailure('Workspace restore failed', error)
  }
}
