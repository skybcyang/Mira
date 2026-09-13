import { validateBoardV2 } from './domain/validation.js'
import { validatePersistedRun } from './v2-run-store.js'
import { typed } from './domain/errors.js'
import { validateManagedAssets } from './domain/managed-assets.js'
import { normalizeBoardLifecycle } from './domain/board-lifecycle.js'

const JOURNAL_FORMAT = 'mira-board-import-transaction'
const JOURNAL_VERSION = 1

function safeId(id, kind) {
  if (typeof id !== 'string' || !id || id.includes('/') || id.includes('..')) {
    throw typed('BOARD_IMPORT_INVALID', `${kind} ID is not safe for persistence`)
  }
  return id
}

function journalPaths(transactionId, transactionDir) {
  return {
    preparing: `${transactionDir}/${transactionId}.preparing.json`,
    final: `${transactionDir}/${transactionId}.json`,
  }
}

function entityEntry(kind, id, transactionId, directories) {
  const dir = kind === 'board' ? directories.boards : directories.runs
  return {
    kind,
    id,
    stagePath: `${dir}/.${id}.${transactionId}.stage`,
    finalPath: `${dir}/${id}.json`,
  }
}

function buildJournal({ transactionId, board, runs, now, directories, assetIds = [], previousBoard }) {
  const paths = journalPaths(transactionId, directories.transactions)
  return {
    format: JOURNAL_FORMAT,
    formatVersion: previousBoard ? 3 : assetIds.length ? 2 : JOURNAL_VERSION,
    ...(assetIds.length || previousBoard ? { assetIds } : {}),
    ...(previousBoard ? { previousBoard } : {}),
    transactionId,
    createdAt: now(),
    journalPaths: paths,
    ownedIds: {
      boardIds: [board.id],
      runIds: runs.map((run) => run.id),
    },
    entries: [
      ...runs.map((run) => entityEntry('run', run.id, transactionId, directories)),
      entityEntry('board', board.id, transactionId, directories),
    ],
  }
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateJournal(journal, directories) {
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal must be an object')
  }
  const transactionId = safeId(journal.transactionId, 'Transaction')
  if (journal.format !== JOURNAL_FORMAT || ![JOURNAL_VERSION, 2, 3].includes(journal.formatVersion)) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal format is unsupported')
  }
  if (journal.formatVersion >= 2 && (!Array.isArray(journal.assetIds)
    || journal.assetIds.length > 10000 || new Set(journal.assetIds).size !== journal.assetIds.length
    || journal.assetIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal material identities are invalid')
  }
  if (journal.formatVersion === 1 && journal.assetIds !== undefined) throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Legacy journal cannot own materials')
  const boardIds = journal.ownedIds?.boardIds
  const runIds = journal.ownedIds?.runIds
  if (!Array.isArray(boardIds) || boardIds.length !== 1 || !Array.isArray(runIds)) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal owned IDs are invalid')
  }
  const owned = {
    boardIds: boardIds.map((id) => safeId(id, 'Board')),
    runIds: runIds.map((id) => safeId(id, 'Run')),
  }
  if (journal.formatVersion === 3) defaultBoardValidator(journal.previousBoard, owned.boardIds[0])
  else if (journal.previousBoard !== undefined) throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Legacy journal cannot replace a Board')
  if (new Set(owned.runIds).size !== owned.runIds.length) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal Run IDs are duplicated')
  }
  const expectedPaths = journalPaths(transactionId, directories.transactions)
  if (!sameValues(journal.journalPaths, expectedPaths)) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal paths are invalid')
  }
  const expectedEntries = [
    ...owned.runIds.map((id) => entityEntry('run', id, transactionId, directories)),
    entityEntry('board', owned.boardIds[0], transactionId, directories),
  ]
  if (!sameValues(journal.entries, expectedEntries)) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import journal entity paths are invalid')
  }
  if (journal.entries.some((entry) => entry.stagePath.endsWith('.json'))) {
    throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Import entity stages cannot be JSON members')
  }
  return { ...journal, transactionId, ownedIds: owned, entries: expectedEntries }
}

async function exists(fs, path) {
  try {
    await fs.readText(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function removeIfPresent(fs, path) {
  try {
    await fs.remove(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || !await exists(fs, path)) return
    throw error
  }
}

function defaultBoardValidator(board, expectedId) {
  const errors = validateBoardV2(board)
  if (board?.id !== expectedId) errors.push(`Board id ${board?.id} does not match ${expectedId}`)
  if (errors.length > 0) {
    throw typed('BOARD_IMPORT_INVALID', `Imported Board is invalid: ${errors.join('; ')}`, errors)
  }
  return board
}

function defaultRunValidator(run, expectedId) {
  try {
    return validatePersistedRun(run, expectedId)
  } catch (error) {
    throw typed('BOARD_IMPORT_INVALID', error.message, undefined, error)
  }
}

export function createBoardImportCommitter({
  fs,
  coordinator,
  newId,
  now = () => new Date().toISOString(),
  validateBoard = defaultBoardValidator,
  validateRun = defaultRunValidator,
  directories = {},
  managedMaterials,
} = {}) {
  if (!fs || !coordinator || typeof newId !== 'function') {
    throw new TypeError('Import committer requires fs, coordinator, and newId')
  }
  const resolvedDirectories = {
    boards: directories.boards || 'boards-v2',
    runs: directories.runs || 'runs-v2',
    transactions: directories.transactions || 'transactions-v2',
  }

  function validateEntities({ board, runs, assets = [], previousBoard }) {
    validateManagedAssets(assets)
    if (assets.length && !managedMaterials) throw typed('BOARD_IMPORT_INVALID', 'This host cannot install managed materials')
    safeId(board?.id, 'Board')
    if (!Array.isArray(runs)) throw typed('BOARD_IMPORT_INVALID', 'Imported Runs must be an array')
    const runIds = runs.map((run) => safeId(run?.id, 'Run'))
    if (new Set(runIds).size !== runIds.length) {
      throw typed('BOARD_IMPORT_INVALID', 'Imported Run IDs must be unique')
    }
    validateBoard(board, board.id)
    for (const run of runs) {
      validateRun(run, run.id)
      if (run.boardId !== board.id) {
        throw typed('BOARD_IMPORT_INVALID', `Run ${run.id} belongs to another Board`)
      }
    }
    if (previousBoard) {
      validateBoard(previousBoard, board.id)
      if (runs.length || board.revision !== (previousBoard.revision || 0) + 1) throw typed('BOARD_IMPORT_INVALID', 'Card import must append to exactly one Board revision')
    }
    return { board, runs, assets, ...(previousBoard ? { previousBoard } : {}) }
  }

  async function assertNoFinalCollisions(journal) {
    const conflicts = []
    for (const entry of journal.entries) {
      try {
        if (entry.kind === 'board' && journal.previousBoard) {
          const current = normalizeBoardLifecycle(JSON.parse(await fs.readText(entry.finalPath)))
          if (!sameValues(current, journal.previousBoard)) throw typed('BOARD_CONFLICT', '目标画板已变化，请重新核对。')
          continue
        }
        if (await exists(fs, entry.finalPath)) conflicts.push({ kind: entry.kind, id: entry.id })
      } catch (error) {
        if (error?.code === 'BOARD_CONFLICT') throw error
        throw typed(
          'BOARD_IMPORT_READ_FAILED',
          `Could not check imported ${entry.kind} ${entry.id}: ${error?.message || error}`,
          undefined,
          error,
        )
      }
    }
    if (conflicts.length > 0) {
      throw typed('BOARD_IMPORT_COLLISION', 'Imported IDs already exist', conflicts)
    }
  }

  async function parseAndValidate(path, validator, expectedId) {
    let parsed
    try {
      parsed = JSON.parse(await fs.readText(path))
    } catch (error) {
      throw typed(
        'BOARD_IMPORT_WRITE_FAILED',
        `Could not re-read staged import entity ${expectedId}: ${error?.message || error}`,
        undefined,
        error,
      )
    }
    validator(parsed, expectedId)
    return parsed
  }

  async function writeJournal(journal) {
    const serialized = JSON.stringify(journal, null, 2)
    await fs.writeText(journal.journalPaths.preparing, serialized)
    let prepared
    try {
      prepared = validateJournal(
        JSON.parse(await fs.readText(journal.journalPaths.preparing)),
        resolvedDirectories,
      )
    } catch (error) {
      throw typed(
        'BOARD_IMPORT_WRITE_FAILED',
        `Could not verify import journal: ${error?.message || error}`,
        undefined,
        error,
      )
    }
    if (!sameValues(prepared, journal)) {
      throw typed('BOARD_IMPORT_WRITE_FAILED', 'Import journal changed during verification')
    }
    await fs.replace(journal.journalPaths.preparing, journal.journalPaths.final)
    let committedJournal
    try {
      committedJournal = validateJournal(
        JSON.parse(await fs.readText(journal.journalPaths.final)),
        resolvedDirectories,
      )
    } catch (error) {
      throw typed(
        'BOARD_IMPORT_WRITE_FAILED',
        `Could not re-read import journal: ${error?.message || error}`,
        undefined,
        error,
      )
    }
    if (!sameValues(committedJournal, journal)) {
      throw typed('BOARD_IMPORT_WRITE_FAILED', 'Committed import journal changed')
    }
  }

  async function rollback(journal) {
    const cleanupPaths = [
      ...journal.entries.filter(entry => !(entry.kind === 'board' && journal.previousBoard)).map((entry) => entry.finalPath).reverse(),
      ...journal.entries.map((entry) => entry.stagePath).reverse(),
    ]
    try {
      for (const path of cleanupPaths) await removeIfPresent(fs, path)
      if (journal.previousBoard) {
        const entry = journal.entries.find(item => item.kind === 'board')
        await fs.writeText(entry.stagePath, JSON.stringify(journal.previousBoard, null, 2))
        const previous = await parseAndValidate(entry.stagePath, validateBoard, entry.id)
        if (!sameValues(previous, journal.previousBoard)) throw typed('BOARD_IMPORT_RECOVERY_FAILED', 'Previous Board staging changed')
        await fs.replace(entry.stagePath, entry.finalPath)
      }
      if (journal.assetIds?.length) {
        if (!managedMaterials) throw typed('BOARD_IMPORT_RECOVERY_FAILED', 'Material recovery adapter is missing')
        await managedMaterials.rollback(journal.assetIds)
      }
      await removeIfPresent(fs, journal.journalPaths.preparing)
      await removeIfPresent(fs, journal.journalPaths.final)
      return true
    } catch {
      return false
    }
  }

  async function commit(input, lease) {
    const entities = validateEntities(input)
    const transactionId = safeId(newId('import-transaction'), 'Transaction')
    return coordinator.withImport(async (importLease) =>
      coordinator.withBoard(entities.board.id, importLease, async () => {
        const assetIds = managedMaterials ? await managedMaterials.missing(entities.assets) : []
        const journal = validateJournal(buildJournal({ transactionId, ...entities, assetIds, now, directories: resolvedDirectories }), resolvedDirectories)
        await assertNoFinalCollisions(journal)
        let reservation
        try {
          reservation = coordinator.reserveImportIds(transactionId, journal.ownedIds)
        } catch (error) {
          if (error?.code === 'IMPORT_ID_RESERVED') {
            throw typed('BOARD_IMPORT_COLLISION', 'Imported IDs are reserved', error.details)
          }
          throw error
        }
        const runsById = new Map(entities.runs.map((run) => [run.id, run]))
        try {
          await writeJournal(journal)
          if (entities.assets.length) await managedMaterials.install(entities.assets, importLease)
          for (const entry of journal.entries) {
            const value = entry.kind === 'board'
              ? entities.board
              : runsById.get(entry.id)
            await fs.writeText(entry.stagePath, JSON.stringify(value, null, 2))
            const validator = entry.kind === 'board' ? validateBoard : validateRun
            const verified = await parseAndValidate(entry.stagePath, validator, entry.id)
            if (!sameValues(verified, value)) {
              throw typed('BOARD_IMPORT_WRITE_FAILED', `${entry.kind} ${entry.id} changed in staging`)
            }
          }
          for (const entry of journal.entries) {
            await fs.replace(entry.stagePath, entry.finalPath)
          }
          const finalIds = { boardIds: [], runIds: [] }
          for (const entry of journal.entries) {
            const validator = entry.kind === 'board' ? validateBoard : validateRun
            const verified = await parseAndValidate(entry.finalPath, validator, entry.id)
            if (entry.kind === 'board') finalIds.boardIds.push(verified.id)
            else finalIds.runIds.push(verified.id)
          }
          if (!sameValues(finalIds, journal.ownedIds)) {
            throw typed('BOARD_IMPORT_WRITE_FAILED', 'Committed import entity IDs changed')
          }

          try {
            await fs.remove(journal.journalPaths.final)
          } catch (error) {
            if (await exists(fs, journal.journalPaths.final)) throw error
          }
          coordinator.releaseImportIds(reservation)
          return { boardId: entities.board.id, runIds: entities.runs.map((run) => run.id) }
        } catch (error) {
          const cleaned = await rollback(journal)
          if (cleaned) coordinator.releaseImportIds(reservation)
          if (!cleaned) {
            throw typed(
              'BOARD_IMPORT_ROLLBACK_FAILED',
              'Import failed and cleanup could not complete; recovery is required',
              { transactionId },
              error,
            )
          }
          if (error?.code?.startsWith('BOARD_IMPORT_')) throw error
          throw typed(
            'BOARD_IMPORT_WRITE_FAILED',
            `Import could not be committed safely: ${error?.message || error}`,
            { transactionId },
            error,
          )
        }
      }), lease)
  }

  async function recover() {
    return coordinator.withImport(async () => {
      let names
      try {
        names = await fs.listJson(resolvedDirectories.transactions)
      } catch (error) {
        if (error?.code === 'ENOENT') return { recoveredTransactionIds: [] }
        throw typed('BOARD_IMPORT_RECOVERY_FAILED', 'Import journals could not be listed', undefined, error)
      }
      const journals = new Map()
      for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
        const path = `${resolvedDirectories.transactions}/${name}`
        let journal
        try {
          journal = validateJournal(JSON.parse(await fs.readText(path)), resolvedDirectories)
        } catch (error) {
          throw typed(
            'BOARD_IMPORT_JOURNAL_INVALID',
            `Import journal ${name} is invalid: ${error?.message || error}`,
            { path },
            error,
          )
        }
        const existing = journals.get(journal.transactionId)
        if (existing && !sameValues(existing, journal)) {
          throw typed('BOARD_IMPORT_JOURNAL_INVALID', 'Duplicate import journals disagree')
        }
        if (!existing) journals.set(journal.transactionId, journal)
      }

      const reserved = []
      try {
        for (const journal of journals.values()) {
          reserved.push({
            journal,
            reservation: coordinator.reserveImportIds(journal.transactionId, journal.ownedIds),
          })
        }
      } catch (error) {
        for (const { reservation } of [...reserved].reverse()) {
          coordinator.releaseImportIds(reservation)
        }
        throw typed(
          'BOARD_IMPORT_RECOVERY_FAILED',
          `Import journal reservations conflict: ${error?.message || error}`,
          undefined,
          error,
        )
      }

      const recoveredTransactionIds = []
      for (const { journal, reservation } of reserved) {
        if (!await rollback(journal)) {
          throw typed(
            'BOARD_IMPORT_RECOVERY_FAILED',
            `Import transaction ${journal.transactionId} could not be recovered`,
            { transactionId: journal.transactionId },
          )
        }
        coordinator.releaseImportIds(reservation)
        recoveredTransactionIds.push(journal.transactionId)
      }
      return { recoveredTransactionIds }
    })
  }

  return Object.freeze({ commit, recover })
}
