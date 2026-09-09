import { validateBoardV2 } from './domain/validation.js'
import {
  assertBoardWritable,
  boardSummary,
  normalizeBoardLifecycle,
  normalizeBoardTitle,
} from './domain/board-lifecycle.js'
import { createStorageCoordinator } from './storage-coordinator.js'
import { removeFilesAtomically } from './storage-file-transaction.js'
import { typed } from './domain/errors.js'

export function emptyBoardV2(id, title, createdAt) {
  return {
    schemaVersion: 2,
    id,
    title: String(title || '未命名画板').trim() || '未命名画板',
    revision: 0,
    lifecycle: { state: 'active' },
    cards: [],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt,
    updatedAt: createdAt,
  }
}

export class V2BoardStore {
  constructor(fs, dir = 'boards-v2', options = {}) {
    this.fs = fs
    this.dir = dir
    this.newId = options.newId || (() => `board-${Date.now().toString(36)}`)
    this.now = options.now || (() => new Date().toISOString())
    this.purgedDir = options.purgedDir || 'purged-boards-v2'
    this.coordinator = options.coordinator || createStorageCoordinator()
  }

  path(id) {
    if (typeof id !== 'string' || !id || id.includes('/') || id.includes('..')) {
      throw typed('BAD_PATH', `Invalid board id: ${id}`)
    }
    return `${this.dir}/${id}.json`
  }

  purgedPath(id) {
    if (typeof id !== 'string' || !id || id.includes('/') || id.includes('..')) {
      throw typed('BAD_PATH', `Invalid board id: ${id}`)
    }
    return `${this.purgedDir}/${id}.json`
  }

  async list() {
    try {
      const names = await this.fs.listJson(this.dir)
      return names
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -5))
        .filter((id) => this.coordinator.isVisible('board', id))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('BOARD_V2_READ_FAILED', 'Board directory could not be read')
    }
  }

  async listStrict() {
    const boards = []
    const ids = [...await this.list()].sort((left, right) => left.localeCompare(right))
    for (const id of ids) boards.push(await this.load(id))
    return boards
  }

  async listSummaries() {
    return (await this.listCatalogSummaries()).filter((summary) => summary.state === 'active')
  }

  async listCatalogSummaries() {
    const summaries = []
    for (const id of await this.list()) {
      try {
        const board = await this.load(id)
        summaries.push(boardSummary(board))
      } catch (error) {
        if (error?.code !== 'BOARD_V2_INVALID' && error?.code !== 'BOARD_NOT_FOUND') {
          throw error
        }
        // A corrupt or concurrently deleted board does not hide healthy boards.
      }
    }
    return summaries
  }

  async load(id) {
    if (!this.coordinator.isVisible('board', id)) {
      throw typed('BOARD_NOT_FOUND', `Board ${id} was not found`)
    }
    let text
    try {
      text = await this.fs.readText(this.path(id))
    } catch (error) {
      if (error?.code === 'BAD_PATH') throw error
      if (error?.code === 'ENOENT') {
        throw typed('BOARD_NOT_FOUND', `Board ${id} was not found`)
      }
      throw typed('BOARD_V2_READ_FAILED', `Board ${id} could not be read`)
    }
    let board
    try {
      board = JSON.parse(text)
    } catch {
      throw typed('BOARD_V2_INVALID', `Board ${id} is not valid JSON`)
    }
    if (board && typeof board === 'object' && !Array.isArray(board)) {
      delete board.relations
    }
    const errors = validateBoardV2(board)
    if (board?.id !== id) errors.push(`Board id ${board?.id} does not match ${id}`)
    if (errors.length > 0) throw typed('BOARD_V2_INVALID', errors.join('; '), errors)
    return normalizeBoardLifecycle(board)
  }

  async save(id, board, lease) {
    if (board?.id !== id) {
      throw typed('BOARD_V2_INVALID', `Board id ${board?.id} does not match ${id}`)
    }
    const errors = validateBoardV2(board)
    if (errors.length > 0) throw typed('BOARD_V2_INVALID', errors.join('; '), errors)

    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(
        id,
        mutationLease,
        () => this.#save(id, board),
      ),
      lease,
    )
  }

  async #save(id, board) {
    const path = this.path(id)
    const tempPath = `${path}.tmp`
    const serialized = JSON.stringify(board, null, 2)
    try {
      await this.fs.writeText(tempPath, serialized)
      const verified = JSON.parse(await this.fs.readText(tempPath))
      const verificationErrors = validateBoardV2(verified)
      if (verificationErrors.length > 0) throw new Error(verificationErrors.join('; '))
      if (JSON.stringify(verified) !== JSON.stringify(board)) {
        throw new Error('Temporary board content changed during verification')
      }
      await this.fs.replace(tempPath, path)
      return board
    } catch (error) {
      throw typed(
        'BOARD_V2_WRITE_FAILED',
        `Board ${id} could not be saved safely: ${error?.message || error}`,
      )
    }
  }

  async create(title) {
    const id = this.newId('board')
    try {
      await this.fs.readText(this.purgedPath(id))
      throw typed('BOARD_ID_REUSED', `Board id ${id} was permanently deleted and cannot be reused`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const board = emptyBoardV2(id, normalizeBoardTitle(title), this.now())
    await this.save(id, board)
    return { id, board }
  }

  async withLockedBoard(id, operation, lease) {
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(
        id,
        mutationLease,
        async (boardLease) => operation(await this.load(id), boardLease),
      ),
      lease,
    )
  }

  async update(id, change, lease) {
    return this.#update(id, change, false, lease)
  }

  async updateMetadata(id, change, lease) {
    return this.#update(id, change, true, lease)
  }

  async purge(id, collectFiles, lease) {
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withBoard(
        id,
        mutationLease,
        async (boardLease) => {
          const board = await this.load(id)
          const collected = await collectFiles(board)
          const paths = collected?.paths
          if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path)) {
            throw typed('BOARD_PURGE_INVALID', 'Permanent deletion file set is invalid')
          }
          await removeFilesAtomically(this.fs, [this.path(id), ...paths], {
            code: 'BOARD_PURGE_FAILED',
            message: `Board ${id} could not be permanently deleted`,
            reservationPath: this.purgedPath(id),
            reservationContent: JSON.stringify({ boardId: id, purgedAt: this.now() }),
          })
          return collected.result
        },
      ),
      lease,
    )
  }

  async #update(id, change, allowReadOnly, lease) {
    return this.withLockedBoard(id, async (board, boardLease) => {
      if (!allowReadOnly) assertBoardWritable(board)
      const baseRevision = board.revision
      const next = await change(structuredClone(board))
      next.revision = baseRevision + 1
      next.updatedAt = this.now()
      await this.save(id, next, boardLease)
      return next
    }, lease)
  }
}
