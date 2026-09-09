import { describe, expect, it, vi } from 'vitest'
import { createBoardImportCommitter } from '../../bridge/board-import-committer.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { V2BoardStore, emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'

function memoryFs() {
  const files = new Map()
  const operations = []
  return {
    files,
    operations,
    async readText(path) {
      operations.push(['readText', path])
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) {
      operations.push(['writeText', path])
      files.set(path, content)
    },
    async replace(from, to) {
      operations.push(['replace', from, to])
      if (!files.has(from)) throw Object.assign(new Error(`missing: ${from}`), { code: 'ENOENT' })
      files.set(to, files.get(from))
      files.delete(from)
    },
    async remove(path) {
      operations.push(['remove', path])
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      files.delete(path)
    },
    async listJson(dir) {
      operations.push(['listJson', dir])
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function importedEntities(suffix = '1') {
  const boardId = `board-import-${suffix}`
  return {
    board: emptyBoardV2(boardId, `导入课题 ${suffix}`, '2026-09-02T01:00:00.000Z'),
    runs: [
      {
        id: `run-import-${suffix}-a`,
        boardId,
        targetCardId: 'historical-target-a',
        status: 'failed',
      },
      {
        id: `run-import-${suffix}-b`,
        boardId,
        targetCardId: 'historical-target-b',
        status: 'interrupted',
      },
    ],
  }
}

function setup(fs = memoryFs()) {
  const coordinator = createStorageCoordinator()
  const boardStore = new V2BoardStore(fs, 'boards-v2', { coordinator })
  const runStore = createV2RunStore(fs, 'runs-v2', { coordinator })
  const committer = createBoardImportCommitter({
    fs,
    coordinator,
    newId: () => 'tx-fixed',
    now: () => '2026-09-02T02:00:00.000Z',
  })
  return { fs, coordinator, boardStore, runStore, committer }
}

function mutableSetup({ fs = memoryFs(), newId = () => 'tx-fixed' } = {}) {
  const coordinator = createStorageCoordinator()
  const boardStore = new V2BoardStore(fs, 'boards-v2', { coordinator })
  const runStore = createV2RunStore(fs, 'runs-v2', { coordinator })
  const committer = createBoardImportCommitter({
    fs,
    coordinator,
    newId,
    now: () => '2026-09-02T02:00:00.000Z',
  })
  return { fs, coordinator, boardStore, runStore, committer }
}

function importedFinalPaths(entities) {
  return [
    ...entities.runs.map((run) => `runs-v2/${run.id}.json`),
    `boards-v2/${entities.board.id}.json`,
  ]
}

async function expectCleanRollback(context, entities) {
  await expect(context.boardStore.list()).resolves.toEqual([])
  await expect(context.runStore.list()).resolves.toEqual([])
  expect([...context.fs.files.keys()].filter((path) =>
    path.startsWith('transactions-v2/') || path.endsWith('.stage'))).toEqual([])
  expect(importedFinalPaths(entities).some((path) => context.fs.files.has(path))).toBe(false)
  expect(context.coordinator.visibilitySnapshot().boardIds.size).toBe(0)
  expect(context.coordinator.visibilitySnapshot().runIds.size).toBe(0)
}

async function leaveRecoverableTransaction({
  fs = memoryFs(),
  suffix = '1',
  transactionId = `tx-${suffix}`,
  renamedFinalCount,
}) {
  const context = mutableSetup({ fs, newId: () => transactionId })
  const entities = importedEntities(suffix)
  const replace = fs.replace.bind(fs)
  const remove = fs.remove.bind(fs)
  let finalRename = 0
  let commitRemoveFailed = false
  fs.replace = async (from, to) => {
    if (!to.startsWith('transactions-v2/')) {
      finalRename += 1
      if (finalRename === renamedFinalCount + 1) throw new Error('leave partial finals')
    }
    return replace(from, to)
  }
  const cleanupFailurePath = renamedFinalCount === 0
    ? `boards-v2/.${entities.board.id}.${transactionId}.stage`
    : renamedFinalCount === 3
      ? `boards-v2/${entities.board.id}.json`
      : `runs-v2/${entities.runs[renamedFinalCount - 1].id}.json`
  fs.remove = async (path) => {
    if (
      renamedFinalCount === 3
      && path === `transactions-v2/${transactionId}.json`
      && !commitRemoveFailed
    ) {
      commitRemoveFailed = true
      throw new Error('leave committed finals journaled')
    }
    if (path === cleanupFailurePath) throw new Error('leave cleanup incomplete')
    return remove(path)
  }

  await expect(context.committer.commit(entities)).rejects.toMatchObject({
    code: 'BOARD_IMPORT_ROLLBACK_FAILED',
  })
  fs.replace = replace
  fs.remove = remove
  return { fs, entities, transactionId }
}

describe('board import committer', () => {
  it('journals first, verifies stages, renames Runs before the Board, and commits by removing the journal', async () => {
    const { fs, boardStore, runStore, committer } = setup()
    const entities = importedEntities()

    await expect(committer.commit(entities)).resolves.toEqual({
      boardId: entities.board.id,
      runIds: entities.runs.map((run) => run.id),
    })

    const journalReplaceIndex = fs.operations.findIndex(
      (entry) => entry[0] === 'replace' && entry[2] === 'transactions-v2/tx-fixed.json',
    )
    const firstEntityWriteIndex = fs.operations.findIndex(
      (entry) => entry[0] === 'writeText' && !entry[1].startsWith('transactions-v2/'),
    )
    const finalRenames = fs.operations.filter(
      (entry) => entry[0] === 'replace' && !entry[2].startsWith('transactions-v2/'),
    )
    const journalRemoveIndex = fs.operations.findIndex(
      (entry) => entry[0] === 'remove' && entry[1] === 'transactions-v2/tx-fixed.json',
    )
    expect(journalReplaceIndex).toBeGreaterThanOrEqual(0)
    expect(firstEntityWriteIndex).toBeGreaterThan(journalReplaceIndex)
    expect(finalRenames.map((entry) => entry[2])).toEqual([
      'runs-v2/run-import-1-a.json',
      'runs-v2/run-import-1-b.json',
      'boards-v2/board-import-1.json',
    ])
    expect(finalRenames.every((entry) => !entry[1].endsWith('.json'))).toBe(true)
    expect(journalRemoveIndex).toBeGreaterThan(
      fs.operations.findLastIndex((entry) => entry[0] === 'readText' && entry[1].endsWith('.json')),
    )
    await expect(boardStore.load(entities.board.id)).resolves.toEqual(entities.board)
    await expect(runStore.listStrict()).resolves.toEqual(
      [...entities.runs].sort((left, right) => left.id.localeCompare(right.id)),
    )
  })

  it('rejects existing final ID collisions before writing or reserving anything', async () => {
    const { fs, coordinator, committer } = setup()
    const entities = importedEntities()
    fs.files.set(`runs-v2/${entities.runs[1].id}.json`, JSON.stringify(entities.runs[1]))
    fs.operations.length = 0

    await expect(committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_COLLISION',
    })
    expect(fs.operations.filter((entry) => ['writeText', 'replace', 'remove'].includes(entry[0])))
      .toEqual([])
    expect(coordinator.visibilitySnapshot().boardIds.size).toBe(0)
    expect(coordinator.visibilitySnapshot().runIds.size).toBe(0)
  })

  it('keeps all imported entities invisible while final renames are only partially complete', async () => {
    const fs = memoryFs()
    const { coordinator, boardStore, runStore, committer } = setup(fs)
    const entities = importedEntities()
    let releaseSecondRunRename
    const mayRenameSecondRun = new Promise((resolve) => {
      releaseSecondRunRename = resolve
    })
    let firstRunRenamed
    const didRenameFirstRun = new Promise((resolve) => {
      firstRunRenamed = resolve
    })
    const replace = fs.replace.bind(fs)
    let runRenameCount = 0
    fs.replace = vi.fn(async (from, to) => {
      if (to.startsWith('runs-v2/') && to.endsWith('.json')) {
        runRenameCount += 1
        if (runRenameCount === 2) await mayRenameSecondRun
      }
      await replace(from, to)
      if (runRenameCount === 1 && to.startsWith('runs-v2/')) firstRunRenamed()
    })

    const pending = committer.commit(entities)
    await didRenameFirstRun
    await expect(boardStore.list()).resolves.toEqual([])
    await expect(runStore.list()).resolves.toEqual([])
    await expect(boardStore.load(entities.board.id)).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    })
    await expect(runStore.load(entities.runs[0].id)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    })
    expect(coordinator.isVisible('run', entities.runs[0].id)).toBe(false)

    releaseSecondRunRename()
    await pending
    await expect(boardStore.list()).resolves.toEqual([entities.board.id])
    await expect(runStore.list()).resolves.toHaveLength(2)
  })

  it('rejects ordinary Run writes to reserved IDs while an import is paused', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const writeText = context.fs.writeText.bind(context.fs)
    let continueJournal
    const mayContinue = new Promise((resolve) => {
      continueJournal = resolve
    })
    let journalStarted
    const didStart = new Promise((resolve) => {
      journalStarted = resolve
    })
    context.fs.writeText = async (path, content) => {
      if (path === 'transactions-v2/tx-fixed.preparing.json') {
        journalStarted()
        await mayContinue
      }
      return writeText(path, content)
    }

    const pendingImport = context.committer.commit(entities)
    await didStart
    const importedRun = entities.runs[0]
    await expect(context.runStore.save({ ...importedRun, status: 'interrupted' }))
      .rejects.toMatchObject({ code: 'IMPORT_ID_RESERVED' })
    await expect(context.runStore.start({ ...importedRun, status: 'running' }))
      .rejects.toMatchObject({ code: 'IMPORT_ID_RESERVED' })
    expect(context.fs.files.has(`runs-v2/${importedRun.id}.json`)).toBe(false)

    continueJournal()
    await pendingImport
    await expect(context.runStore.load(importedRun.id)).resolves.toEqual(importedRun)
  })

  it('waits for an earlier Run temp write before collision checking the import', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const importedRun = entities.runs[0]
    const writeText = context.fs.writeText.bind(context.fs)
    let continueSave
    const mayContinue = new Promise((resolve) => {
      continueSave = resolve
    })
    let tempWritten
    const didWriteTemp = new Promise((resolve) => {
      tempWritten = resolve
    })
    let journalStarted
    const didStartJournal = new Promise((resolve) => {
      journalStarted = resolve
    })
    context.fs.writeText = async (path, content) => {
      await writeText(path, content)
      if (path === `runs-v2/${importedRun.id}.json.tmp`) {
        tempWritten()
        await mayContinue
      }
      if (path === 'transactions-v2/tx-fixed.preparing.json') journalStarted()
    }

    const ordinaryRun = { ...importedRun, targetCardId: 'ordinary-target' }
    const pendingSave = context.runStore.save(ordinaryRun)
    await didWriteTemp
    const pendingImport = context.committer.commit(entities)
    const journalReachedBeforeSave = await Promise.race([
      didStartJournal.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    ])
    continueSave()

    await pendingSave
    expect(journalReachedBeforeSave).toBe(false)
    await expect(pendingImport).rejects.toMatchObject({ code: 'BOARD_IMPORT_COLLISION' })
    await expect(context.runStore.load(importedRun.id)).resolves.toEqual(ordinaryRun)
    expect(context.fs.files.has('transactions-v2/tx-fixed.json')).toBe(false)
  })

  it.each([
    ['journal write', (fs) => {
      const writeText = fs.writeText.bind(fs)
      fs.writeText = async (path, content) => {
        if (path === 'transactions-v2/tx-fixed.preparing.json') throw new Error('journal write failed')
        return writeText(path, content)
      }
    }],
    ['journal preparing re-read', (fs) => {
      const readText = fs.readText.bind(fs)
      fs.readText = async (path) => path === 'transactions-v2/tx-fixed.preparing.json'
        ? '{bad journal'
        : readText(path)
    }],
    ['journal atomic replace', (fs) => {
      const replace = fs.replace.bind(fs)
      fs.replace = async (from, to) => {
        if (to === 'transactions-v2/tx-fixed.json') throw new Error('journal replace failed')
        return replace(from, to)
      }
    }],
    ['journal final re-read', (fs) => {
      const readText = fs.readText.bind(fs)
      fs.readText = async (path) => path === 'transactions-v2/tx-fixed.json'
        ? '{bad journal'
        : readText(path)
    }],
  ])('rolls back cleanly after a %s failure', async (_name, inject) => {
    const context = mutableSetup()
    const entities = importedEntities()
    inject(context.fs)

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it.each([
    ['first Run', 'runs-v2/.run-import-1-a.tx-fixed.stage'],
    ['second Run', 'runs-v2/.run-import-1-b.tx-fixed.stage'],
    ['Board', 'boards-v2/.board-import-1.tx-fixed.stage'],
  ])('rolls back every stage after the %s stage write fails', async (_name, failedPath) => {
    const context = mutableSetup()
    const entities = importedEntities()
    const writeText = context.fs.writeText.bind(context.fs)
    context.fs.writeText = async (path, content) => {
      if (path === failedPath) throw new Error('stage write failed')
      return writeText(path, content)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it.each([
    ['first Run', 'runs-v2/.run-import-1-a.tx-fixed.stage'],
    ['second Run', 'runs-v2/.run-import-1-b.tx-fixed.stage'],
    ['Board', 'boards-v2/.board-import-1.tx-fixed.stage'],
  ])('rolls back every stage after the %s stage re-read fails', async (_name, failedPath) => {
    const context = mutableSetup()
    const entities = importedEntities()
    const readText = context.fs.readText.bind(context.fs)
    context.fs.readText = async (path) => path === failedPath ? '{bad entity' : readText(path)

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it.each([1, 2, 3])('rolls back after final rename number %i fails', async (failedRename) => {
    const context = mutableSetup()
    const entities = importedEntities()
    const replace = context.fs.replace.bind(context.fs)
    let finalRename = 0
    context.fs.replace = async (from, to) => {
      if (!to.startsWith('transactions-v2/')) {
        finalRename += 1
        if (finalRename === failedRename) throw new Error('final rename failed')
      }
      return replace(from, to)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it.each([
    ['first Run', 'runs-v2/run-import-1-a.json'],
    ['second Run', 'runs-v2/run-import-1-b.json'],
    ['Board', 'boards-v2/board-import-1.json'],
  ])('rolls back after the %s final re-read fails', async (_name, failedPath) => {
    const context = mutableSetup()
    const entities = importedEntities()
    const readText = context.fs.readText.bind(context.fs)
    context.fs.readText = async (path) => {
      if (path === failedPath && context.fs.files.has(path)) {
        return '{bad entity'
      }
      return readText(path)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it('treats journal removal as the commit point and cleans up after a one-shot failure', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const remove = context.fs.remove.bind(context.fs)
    let failed = false
    context.fs.remove = async (path) => {
      if (path === 'transactions-v2/tx-fixed.json' && !failed) {
        failed = true
        throw new Error('journal remove failed')
      }
      return remove(path)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it('rolls back a stage write that completed before reporting failure', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const writeText = context.fs.writeText.bind(context.fs)
    context.fs.writeText = async (path, content) => {
      await writeText(path, content)
      if (path === 'runs-v2/.run-import-1-a.tx-fixed.stage') {
        throw new Error('stage write reported failure after persisting')
      }
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it('rolls back a final rename that completed before reporting failure', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const replace = context.fs.replace.bind(context.fs)
    context.fs.replace = async (from, to) => {
      await replace(from, to)
      if (to === 'runs-v2/run-import-1-a.json') {
        throw new Error('final rename reported failure after persisting')
      }
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it('finishes publication when journal removal committed before reporting failure', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const remove = context.fs.remove.bind(context.fs)
    context.fs.remove = async (path) => {
      await remove(path)
      if (path === 'transactions-v2/tx-fixed.json') {
        throw new Error('journal removal reported failure after commit')
      }
    }

    await expect(context.committer.commit(entities)).resolves.toEqual({
      boardId: entities.board.id,
      runIds: entities.runs.map((run) => run.id),
    })
    expect(context.coordinator.isVisible('board', entities.board.id)).toBe(true)
    await expect(context.boardStore.load(entities.board.id)).resolves.toEqual(entities.board)
    await expect(context.runStore.list()).resolves.toHaveLength(2)
  })

  it('keeps the journal, reservations, and partial entities hidden when rollback removal fails', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const replace = context.fs.replace.bind(context.fs)
    let finalRename = 0
    context.fs.replace = async (from, to) => {
      if (!to.startsWith('transactions-v2/')) {
        finalRename += 1
        if (finalRename === 2) throw new Error('second rename failed')
      }
      return replace(from, to)
    }
    const remove = context.fs.remove.bind(context.fs)
    context.fs.remove = async (path) => {
      if (path === 'runs-v2/run-import-1-a.json') throw new Error('rollback remove failed')
      return remove(path)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_ROLLBACK_FAILED',
    })
    expect(context.fs.files.has('transactions-v2/tx-fixed.json')).toBe(true)
    expect(context.fs.files.has('runs-v2/run-import-1-a.json')).toBe(true)
    expect(context.coordinator.isVisible('board', entities.board.id)).toBe(false)
    expect(context.coordinator.isVisible('run', entities.runs[0].id)).toBe(false)
    await expect(context.boardStore.list()).resolves.toEqual([])
    await expect(context.runStore.list()).resolves.toEqual([])
  })

  it('continues rollback when removal completed before reporting failure', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const replace = context.fs.replace.bind(context.fs)
    let finalRename = 0
    context.fs.replace = async (from, to) => {
      if (!to.startsWith('transactions-v2/')) {
        finalRename += 1
        if (finalRename === 2) throw new Error('second rename failed')
      }
      return replace(from, to)
    }
    const remove = context.fs.remove.bind(context.fs)
    let reported = false
    context.fs.remove = async (path) => {
      await remove(path)
      if (path === 'runs-v2/run-import-1-a.json' && !reported) {
        reported = true
        throw new Error('rollback remove reported failure after deleting')
      }
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
  })

  it('can retry the same import after a pre-commit failure was cleaned completely', async () => {
    const context = mutableSetup()
    const entities = importedEntities()
    const replace = context.fs.replace.bind(context.fs)
    let failOnce = true
    context.fs.replace = async (from, to) => {
      if (to === 'runs-v2/run-import-1-b.json' && failOnce) {
        failOnce = false
        throw new Error('one-shot final rename failure')
      }
      return replace(from, to)
    }

    await expect(context.committer.commit(entities)).rejects.toMatchObject({
      code: 'BOARD_IMPORT_WRITE_FAILED',
    })
    await expectCleanRollback(context, entities)
    await expect(context.committer.commit(entities)).resolves.toMatchObject({
      boardId: entities.board.id,
    })
  })

  it.each([0, 1, 3])(
    'recovers a restart with %i final entities already renamed',
    async (renamedFinalCount) => {
      const partial = await leaveRecoverableTransaction({ renamedFinalCount })
      const context = mutableSetup({ fs: partial.fs, newId: () => 'unused' })

      await expect(context.committer.recover()).resolves.toEqual({
        recoveredTransactionIds: [partial.transactionId],
      })
      await expectCleanRollback(context, partial.entities)
    },
  )

  it('reserves every journal-owned ID before startup cleanup exposes a partial final', async () => {
    const partial = await leaveRecoverableTransaction({ renamedFinalCount: 1 })
    const context = mutableSetup({ fs: partial.fs, newId: () => 'unused' })
    const remove = context.fs.remove.bind(context.fs)
    let continueCleanup
    const mayContinue = new Promise((resolve) => {
      continueCleanup = resolve
    })
    let cleanupStarted
    const didStart = new Promise((resolve) => {
      cleanupStarted = resolve
    })
    let paused = false
    context.fs.remove = async (path) => {
      if (!paused && path.endsWith('.json') && !path.startsWith('transactions-v2/')) {
        paused = true
        cleanupStarted()
        await mayContinue
      }
      return remove(path)
    }

    const recovery = context.committer.recover()
    await didStart
    expect(context.coordinator.isVisible('board', partial.entities.board.id)).toBe(false)
    expect(context.coordinator.isVisible('run', partial.entities.runs[0].id)).toBe(false)
    await expect(context.boardStore.list()).resolves.toEqual([])
    await expect(context.runStore.list()).resolves.toEqual([])

    continueCleanup()
    await recovery
    expect(context.coordinator.isVisible('board', partial.entities.board.id)).toBe(true)
    expect(context.coordinator.isVisible('run', partial.entities.runs[0].id)).toBe(true)
  })

  it('reserves all journals before cleaning the first transaction', async () => {
    const fs = memoryFs()
    const first = await leaveRecoverableTransaction({
      fs, suffix: '1', transactionId: 'tx-1', renamedFinalCount: 1,
    })
    const second = await leaveRecoverableTransaction({
      fs, suffix: '2', transactionId: 'tx-2', renamedFinalCount: 1,
    })
    const context = mutableSetup({ fs, newId: () => 'unused' })
    const remove = fs.remove.bind(fs)
    let continueCleanup
    const mayContinue = new Promise((resolve) => {
      continueCleanup = resolve
    })
    let cleanupStarted
    const didStart = new Promise((resolve) => {
      cleanupStarted = resolve
    })
    let paused = false
    fs.remove = async (path) => {
      if (!paused && path === `runs-v2/${first.entities.runs[0].id}.json`) {
        paused = true
        cleanupStarted()
        await mayContinue
      }
      return remove(path)
    }

    const recovery = context.committer.recover()
    await didStart
    expect(context.coordinator.isVisible('board', first.entities.board.id)).toBe(false)
    expect(context.coordinator.isVisible('board', second.entities.board.id)).toBe(false)
    expect(context.coordinator.isVisible('run', second.entities.runs[0].id)).toBe(false)
    continueCleanup()
    await expect(recovery).resolves.toEqual({
      recoveredTransactionIds: ['tx-1', 'tx-2'],
    })
  })

  it('releases earlier startup reservations when a later journal conflicts', async () => {
    const partial = await leaveRecoverableTransaction({
      suffix: '1', transactionId: 'tx-1', renamedFinalCount: 1,
    })
    const firstPath = 'transactions-v2/tx-1.json'
    const secondPath = 'transactions-v2/tx-2.json'
    const second = JSON.parse(partial.fs.files.get(firstPath))
    second.transactionId = 'tx-2'
    second.journalPaths = {
      preparing: 'transactions-v2/tx-2.preparing.json',
      final: secondPath,
    }
    second.entries = second.entries.map((entry) => ({
      ...entry,
      stagePath: entry.stagePath.replace('.tx-1.stage', '.tx-2.stage'),
    }))
    partial.fs.files.set(secondPath, JSON.stringify(second))
    const context = mutableSetup({ fs: partial.fs, newId: () => 'unused' })

    await expect(context.committer.recover()).rejects.toMatchObject({
      code: 'BOARD_IMPORT_RECOVERY_FAILED',
    })
    expect(context.coordinator.isVisible('board', partial.entities.board.id)).toBe(true)
    expect(context.coordinator.isVisible('run', partial.entities.runs[0].id)).toBe(true)
  })

  it('cleans matching preparing and final journals for the same transaction', async () => {
    const partial = await leaveRecoverableTransaction({ renamedFinalCount: 1 })
    const finalPath = `transactions-v2/${partial.transactionId}.json`
    const preparingPath = `transactions-v2/${partial.transactionId}.preparing.json`
    partial.fs.files.set(preparingPath, partial.fs.files.get(finalPath))
    const context = mutableSetup({ fs: partial.fs, newId: () => 'unused' })

    await expect(context.committer.recover()).resolves.toEqual({
      recoveredTransactionIds: [partial.transactionId],
    })
    expect(context.fs.files.has(preparingPath)).toBe(false)
    expect(context.fs.files.has(finalPath)).toBe(false)
  })

  it('fails startup closed without deleting anything when a journal is malformed', async () => {
    const context = mutableSetup()
    context.fs.files.set('transactions-v2/malformed.json', '{not json')
    const before = new Map(context.fs.files)

    await expect(context.committer.recover()).rejects.toMatchObject({
      code: 'BOARD_IMPORT_JOURNAL_INVALID',
    })
    expect(context.fs.files).toEqual(before)
  })

  it('keeps recovered IDs reserved when startup cleanup fails', async () => {
    const partial = await leaveRecoverableTransaction({ renamedFinalCount: 1 })
    const context = mutableSetup({ fs: partial.fs, newId: () => 'unused' })
    const remove = context.fs.remove.bind(context.fs)
    context.fs.remove = async (path) => {
      if (path === `runs-v2/${partial.entities.runs[0].id}.json`) {
        throw new Error('recovery cleanup failed')
      }
      return remove(path)
    }

    await expect(context.committer.recover()).rejects.toMatchObject({
      code: 'BOARD_IMPORT_RECOVERY_FAILED',
    })
    expect(context.coordinator.isVisible('board', partial.entities.board.id)).toBe(false)
    expect(context.coordinator.isVisible('run', partial.entities.runs[0].id)).toBe(false)
    await expect(context.runStore.list()).resolves.toEqual([])
  })
})
