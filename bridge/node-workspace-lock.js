import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

export const WORKSPACE_LOCK_FILE = '.mira-workspace.lock'

function workspaceLockError(lockPath, existingContents) {
  let owner
  try {
    owner = JSON.parse(existingContents)
  } catch {
    owner = undefined
  }
  const details = { path: lockPath }
  if (owner && typeof owner === 'object') details.owner = owner
  return Object.assign(
    new Error(
      `Mira workspace is already locked for writing: ${lockPath}. `
      + 'Close every Mira writer, then follow docs/operations/workspace-lock-recovery.md; '
      + 'stale locks are never removed automatically.',
    ),
    { code: 'WORKSPACE_LOCKED', details },
  )
}

export function acquireNodeWorkspaceWriteLock(workspaceRoot, {
  processId = process.pid,
  hostName = hostname(),
  startedAt = () => new Date().toISOString(),
} = {}) {
  const root = resolve(workspaceRoot)
  const lockPath = join(root, WORKSPACE_LOCK_FILE)
  mkdirSync(root, { recursive: true })

  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let existingContents = ''
    try {
      existingContents = readFileSync(lockPath, 'utf8')
    } catch {
      // The lock is still authoritative even if its diagnostic contents cannot be read.
    }
    throw workspaceLockError(lockPath, existingContents)
  }

  try {
    const contents = JSON.stringify({
      version: 1,
      pid: processId,
      hostname: hostName,
      startedAt: startedAt(),
    })
    writeSync(descriptor, `${contents}\n`, undefined, 'utf8')
  } catch (error) {
    closeSync(descriptor)
    try {
      unlinkSync(lockPath)
    } catch {
      // Best-effort cleanup is safe here because this process created the lock.
    }
    throw error
  }

  let released = false
  return {
    path: lockPath,
    release() {
      if (released) return
      released = true
      closeSync(descriptor)
      try {
        unlinkSync(lockPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    },
  }
}
