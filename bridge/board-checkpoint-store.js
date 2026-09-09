import {
  checkpointSummary,
  normalizeCheckpointNote,
  normalizeCheckpointTitle,
  validateBoardCheckpoint,
} from './domain/board-checkpoint.js'
import { typed } from './domain/errors.js'
import { createStorageCoordinator } from './storage-coordinator.js'
import { removeFilesAtomically } from './storage-file-transaction.js'

function safeId(id, field) {
  if (
    typeof id !== 'string'
    || !id.trim()
    || id === '.'
    || id.includes('..')
    || /[\u0000-\u001f\u007f/\\]/u.test(id)
  ) {
    throw typed('BAD_PATH', `Invalid ${field}: ${id}`)
  }
  return id
}

function encodeId(id, field) {
  return [...new TextEncoder().encode(safeId(id, field))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function boardCheckpointFilename(boardId, checkpointId) {
  const filename = `${encodeId(boardId, 'board id')}--${encodeId(checkpointId, 'checkpoint id')}.json`
  if (filename.length > 255) {
    throw typed('BAD_PATH', 'BoardCheckpoint filename is too long')
  }
  return filename
}

function nextTimestamp(previous, proposed) {
  const previousMs = Date.parse(previous)
  const proposedMs = Date.parse(proposed)
  if (!Number.isFinite(previousMs)) return proposed
  return new Date(Math.max(previousMs + 1, Number.isFinite(proposedMs) ? proposedMs : previousMs + 1))
    .toISOString()
}

export class BoardCheckpointStore {
  constructor(fs, dir = 'board-checkpoints-v1', options = {}) {
    this.fs = fs
    this.dir = dir || 'board-checkpoints-v1'
    this.coordinator = options.coordinator || createStorageCoordinator()
    this.now = options.now || (() => new Date().toISOString())
    this.checkpointIdsPromise = undefined
  }

  path(boardId, checkpointId) {
    return `${this.dir}/${boardCheckpointFilename(boardId, checkpointId)}`
  }

  async #checkpointsForBoard(boardId) {
    const prefix = `${encodeId(boardId, 'board id')}--`
    let names
    try {
      names = await this.fs.listJson(this.dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('CHECKPOINT_READ_FAILED', `Checkpoints for Board ${boardId} could not be listed`)
    }
    const matches = []
    for (const name of names.filter((item) => item.startsWith(prefix) && item.endsWith('.json')).sort()) {
      const path = `${this.dir}/${name}`
      const checkpoint = await this.#readPath(path, name)
      if (this.path(checkpoint.boardId, checkpoint.id) !== path) {
        throw typed('CHECKPOINT_INVALID', 'BoardCheckpoint identity does not match its filename')
      }
      if (checkpoint.boardId === boardId) matches.push({ checkpoint, name, path })
    }
    return matches
  }

  async namesForBoard(boardId) {
    return (await this.#checkpointsForBoard(boardId)).map(({ name }) => name)
  }

  async entriesForBoard(boardId) {
    return (await this.#checkpointsForBoard(boardId)).map(({ checkpoint, path }) => ({
      id: checkpoint.id,
      path,
    }))
  }

  async load(boardId, checkpointId) {
    const parsed = await this.#readPath(this.path(boardId, checkpointId), checkpointId)
    if (parsed.boardId !== boardId || parsed.id !== checkpointId) {
      throw typed('CHECKPOINT_INVALID', 'BoardCheckpoint identity does not match its filename')
    }
    return parsed
  }

  async #readPath(path, checkpointId) {
    let parsed
    try {
      parsed = JSON.parse(await this.fs.readText(path))
    } catch (error) {
      if (error?.code === 'BAD_PATH') throw error
      if (error?.code === 'ENOENT') {
        throw typed('CHECKPOINT_NOT_FOUND', `Checkpoint ${checkpointId} was not found`)
      }
      if (error instanceof SyntaxError) {
        throw typed('CHECKPOINT_INVALID', `Checkpoint ${checkpointId} is not valid JSON`)
      }
      throw typed('CHECKPOINT_READ_FAILED', `Checkpoint ${checkpointId} could not be read`)
    }
    validateBoardCheckpoint(parsed)
    return parsed
  }

  async listStrict() {
    let names
    try {
      names = await this.fs.listJson(this.dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('CHECKPOINT_READ_FAILED', 'BoardCheckpoint directory could not be read')
    }
    const checkpoints = []
    for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
      const checkpoint = await this.#readPath(`${this.dir}/${name}`, name)
      if (this.path(checkpoint.boardId, checkpoint.id) !== `${this.dir}/${name}`) {
        throw typed('CHECKPOINT_INVALID', 'BoardCheckpoint identity does not match its filename')
      }
      checkpoints.push(checkpoint)
    }
    return checkpoints
  }

  async listSummaries(boardId) {
    return (await this.#checkpointsForBoard(boardId))
      .map(({ checkpoint }) => checkpoint)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map(checkpointSummary)
  }

  async #checkpointIds() {
    if (!this.checkpointIdsPromise) {
      const pending = this.listStrict().then((checkpoints) => new Set(
        checkpoints.map((checkpoint) => checkpoint.id),
      ))
      this.checkpointIdsPromise = pending
      pending.catch(() => {
        if (this.checkpointIdsPromise === pending) this.checkpointIdsPromise = undefined
      })
    }
    return this.checkpointIdsPromise
  }

  async save(checkpoint, lease) {
    validateBoardCheckpoint(checkpoint)
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(
        checkpoint.boardId,
        mutationLease,
        (boardLease) => this.coordinator.withCheckpoint(
          checkpoint.id,
          boardLease,
          async () => {
            const checkpointIds = await this.#checkpointIds()
            if (checkpointIds.has(checkpoint.id)) {
              throw typed('CHECKPOINT_CONFLICT', `Checkpoint id ${checkpoint.id} already exists`)
            }
            const saved = await this.#save(checkpoint)
            checkpointIds.add(checkpoint.id)
            return saved
          },
        ),
      ),
      lease,
    )
  }

  async saveManyPrevalidated(checkpoints) {
    if (!Array.isArray(checkpoints)) {
      throw typed('CHECKPOINT_INVALID', 'Prevalidated checkpoints must be an array')
    }
    await this.#checkpointIds()
    const saved = []
    for (const checkpoint of checkpoints) saved.push(await this.save(checkpoint))
    return saved
  }

  async #save(checkpoint) {
    const path = this.path(checkpoint.boardId, checkpoint.id)
    const tempPath = `${path}.tmp`
    try {
      await this.fs.writeText(tempPath, JSON.stringify(checkpoint, null, 2))
      const verified = JSON.parse(await this.fs.readText(tempPath))
      validateBoardCheckpoint(verified)
      if (JSON.stringify(verified) !== JSON.stringify(checkpoint)) {
        throw new Error('Temporary BoardCheckpoint changed during verification')
      }
      await this.fs.replace(tempPath, path)
      return checkpoint
    } catch (error) {
      try {
        await this.fs.remove(tempPath)
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw typed(
            'CHECKPOINT_WRITE_FAILED',
            `Checkpoint ${checkpoint.id} failed and its temporary file could not be removed`,
          )
        }
      }
      if (error?.code === 'CHECKPOINT_INVALID' || error?.code === 'CHECKPOINT_TOO_LARGE') throw error
      throw typed('CHECKPOINT_WRITE_FAILED', `Checkpoint ${checkpoint.id} could not be saved safely: ${error?.message || error}`)
    }
  }

  async updateMetadata(boardId, checkpointId, change = {}, lease) {
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(boardId, mutationLease, async () => {
        const checkpoint = await this.load(boardId, checkpointId)
        if (checkpoint.metadataUpdatedAt !== change.baseMetadataUpdatedAt) {
          throw typed('CHECKPOINT_CONFLICT', 'Checkpoint metadata changed after this command was prepared')
        }
        if (change.title === undefined && change.note === undefined) {
          throw typed('CHECKPOINT_INVALID', 'Checkpoint metadata update is empty')
        }
        const next = {
          ...checkpoint,
          ...(change.title !== undefined ? { title: normalizeCheckpointTitle(change.title) } : {}),
          metadataUpdatedAt: nextTimestamp(checkpoint.metadataUpdatedAt, this.now()),
        }
        if (change.note !== undefined) {
          const note = normalizeCheckpointNote(change.note)
          if (note === undefined) delete next.note
          else next.note = note
        }
        return this.#save(next)
      }),
      lease,
    )
  }

  async remove(boardId, checkpointId, lease) {
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(boardId, mutationLease, async () => {
        await this.load(boardId, checkpointId)
        await removeFilesAtomically(this.fs, [this.path(boardId, checkpointId)], {
          code: 'CHECKPOINT_WRITE_FAILED',
          message: `Checkpoint ${checkpointId} could not be deleted`,
        })
        if (this.checkpointIdsPromise) {
          (await this.checkpointIdsPromise).delete(checkpointId)
        }
        return checkpointId
      }),
      lease,
    )
  }

  async pathsForBoard(boardId) {
    return (await this.entriesForBoard(boardId)).map(({ path }) => path)
  }
}
