import { typed } from './domain/errors.js'

function stagePath(path) {
  return `${path}.purge`
}

export async function removeFilesAtomically(fs, paths, {
  code = 'BOARD_PURGE_FAILED',
  message = 'Permanent deletion could not be completed safely',
  reservationPath,
  reservationContent,
} = {}) {
  const uniquePaths = [...new Set(paths)]
  const records = []
  try {
    for (const path of uniquePaths) {
      const staged = stagePath(path)
      try {
        await fs.readText(staged)
        throw typed(code, `A pending purge file already exists for ${path}`)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      records.push({ path, staged, content: await fs.readText(path) })
    }
    if (reservationPath) {
      try {
        await fs.readText(reservationPath)
        throw typed(code, `A purge reservation already exists for ${reservationPath}`)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  } catch (error) {
    throw typed(code, `${message}: ${error?.message || error}`, undefined, error)
  }

  const moved = []
  const removed = new Set()
  const reservationTemp = reservationPath ? `${reservationPath}.tmp` : null
  let reservationCommitted = false
  try {
    for (const record of records) {
      await fs.replace(record.path, record.staged)
      moved.push(record)
    }
    if (reservationPath) {
      await fs.writeText(reservationTemp, reservationContent || '')
      await fs.replace(reservationTemp, reservationPath)
      reservationCommitted = true
    }
    for (const record of moved) {
      await fs.remove(record.staged)
      removed.add(record.path)
    }
  } catch (error) {
    let rollbackError
    if (reservationTemp && !reservationCommitted) {
      try { await fs.remove(reservationTemp) } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') rollbackError ||= cleanupError
      }
    }
    if (reservationCommitted) {
      try { await fs.remove(reservationPath) } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') rollbackError ||= cleanupError
      }
    }
    for (const record of [...moved].reverse()) {
      try {
        if (removed.has(record.path)) {
          const restoreTemp = `${record.path}.purge-restore`
          await fs.writeText(restoreTemp, record.content)
          await fs.replace(restoreTemp, record.path)
        } else {
          await fs.replace(record.staged, record.path)
        }
      } catch (restoreFailure) {
        rollbackError ||= restoreFailure
      }
    }
    if (rollbackError) {
      throw typed(
        'BOARD_PURGE_ROLLBACK_FAILED',
        `${message}; rollback failed: ${rollbackError?.message || rollbackError}`,
        undefined,
        rollbackError,
      )
    }
    throw typed(code, `${message}: ${error?.message || error}`, undefined, error)
  }
}
