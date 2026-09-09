import { describe, expect, it, vi } from 'vitest'
import { appendVersion } from '../../bridge/domain/versioning.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { emptyBoardV2, V2BoardStore } from '../../bridge/v2-board-store.js'
import { createV2Handlers } from '../../bridge/v2-http.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'
import { assertBoardPurgeable } from '../../bridge/domain/board-lifecycle.js'
import { BoardCheckpointStore } from '../../bridge/board-checkpoint-store.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'

const CREATED_AT = '2026-09-02T01:00:00.000Z'
const UPDATED_AT = '2026-09-02T01:01:00.000Z'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      if (!files.has(from)) throw new Error(`missing temp: ${from}`)
      files.set(to, files.get(from))
      files.delete(from)
    },
    async remove(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      files.delete(path)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function ids(...values) {
  return vi.fn(() => values.shift())
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function markdownCard(id, markdown) {
  return appendVersion({
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: null,
    versions: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }, {
    baseVersionId: null,
    versionId: `${id}-v1`,
    content: { kind: 'markdown', markdown },
    origin: 'human',
    createdAt: CREATED_AT,
  })
}

function runnableBoard() {
  const board = emptyBoardV2('board-1', '课题', CREATED_AT)
  board.cards.push(
    markdownCard('source', '来源'),
    {
      id: 'target', contentKind: 'markdown', x: 480, y: 0, width: 312, height: 208,
      headVersionId: null, versions: [], createdAt: CREATED_AT, updatedAt: CREATED_AT,
    },
  )
  board.transformations.push({
    id: 'transformation-1', sourceCardIds: ['source'], targetCardId: 'target',
    label: '形成结果', instruction: '整理来源', acceptance: '',
    permissions: { workspaceWrite: false }, createdAt: CREATED_AT, updatedAt: CREATED_AT,
  })
  return board
}

async function fixture(board = runnableBoard(), options = {}) {
  const fs = memoryFs()
  const coordinator = createStorageCoordinator()
  const store = new V2BoardStore(fs, 'boards-v2', {
    coordinator,
    now: () => UPDATED_AT,
  })
  const runStore = createV2RunStore(fs, 'runs-v2', {
    coordinator,
    now: () => UPDATED_AT,
  })
  const checkpointStore = new BoardCheckpointStore(fs, undefined, { coordinator })
  await store.save(board.id, board)
  const handlers = createV2Handlers({
    store,
    runStore,
    newId: options.newId || ids('run-1'),
    now: () => UPDATED_AT,
    executeModel: options.executeModel || (() => new Promise(() => {})),
    checkpointStore,
  })
  return { fs, store, runStore, checkpointStore, handlers }
}

function candidateRun() {
  return {
    id: 'run-candidate',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    targetCardId: 'target',
    targetBaseVersionId: null,
    status: 'succeeded',
    result: { output: '候选结果', digest: 'candidate', disposition: 'candidate' },
  }
}

describe('board lifecycle application contract', () => {
  it('permanently removes a trashed board and its runs without touching other data', async () => {
    const { fs, store, runStore, checkpointStore, handlers } = await fixture()
    await store.updateMetadata('board-1', (board) => ({
      ...board,
      lifecycle: { state: 'trashed', trashedAt: UPDATED_AT },
    }))
    await runStore.save({
      id: 'run-board-1', boardId: 'board-1', targetCardId: 'target', status: 'succeeded',
      result: { disposition: 'applied', output: '已完成' },
    })
    const checkpointBoard = await store.load('board-1')
    await checkpointStore.save({
      schemaVersion: 1,
      id: 'checkpoint-board-1',
      boardId: 'board-1',
      title: '删除前版本',
      baseBoardRevision: checkpointBoard.revision,
      artifact: projectBoardArtifact({ board: checkpointBoard, runs: [], exportedAt: UPDATED_AT }),
      createdAt: UPDATED_AT,
      metadataUpdatedAt: UPDATED_AT,
    })
    await runStore.save({
      id: 'run-board-other', boardId: 'board-other', targetCardId: 'target', status: 'succeeded',
      result: { disposition: 'applied', output: '保留' },
    })
    await expect(handlers.purgeBoard('board-1', {
      baseRevision: 1,
      confirmation: 'permanently-delete',
    })).resolves.toEqual({
      deletedBoardId: 'board-1',
      deletedRunIds: ['run-board-1'],
      deletedCheckpointIds: ['checkpoint-board-1'],
    })
    expect(fs.files.has('boards-v2/board-1.json')).toBe(false)
    expect(fs.files.has('runs-v2/run-board-1.json')).toBe(false)
    expect(fs.files.has(checkpointStore.path('board-1', 'checkpoint-board-1'))).toBe(false)
    expect(fs.files.has('purged-boards-v2/board-1.json')).toBe(true)
    expect(fs.files.has('runs-v2/run-board-other.json')).toBe(true)
  })

  it('requires the trashed lifecycle and exact permanent-delete confirmation', () => {
    const board = emptyBoardV2('board-1', '课题', CREATED_AT)
    expect(() => assertBoardPurgeable(board, 'permanently-delete')).toThrowError(
      expect.objectContaining({ code: 'BOARD_PURGE_INVALID' }),
    )
    board.lifecycle = { state: 'trashed', trashedAt: UPDATED_AT }
    expect(() => assertBoardPurgeable(board, 'delete')).toThrowError(
      expect.objectContaining({ code: 'BOARD_PURGE_INVALID' }),
    )
    expect(() => assertBoardPurgeable(board, 'permanently-delete')).not.toThrow()
  })

  it('renames and transitions through archive, trash, and restore with revision CAS', async () => {
    const { store, handlers } = await fixture()
    const before = await store.load('board-1')
    const owned = structuredClone({
      cards: before.cards,
      transformations: before.transformations,
    })

    await expect(handlers.renameBoard('board-1', {
      title: '  新课题  ', baseRevision: 0,
    })).resolves.toMatchObject({ board: { title: '新课题', revision: 1 } })
    await expect(handlers.archiveBoard('board-1', { baseRevision: 1 }))
      .resolves.toMatchObject({ board: { revision: 2, lifecycle: { state: 'archived' } } })
    await expect(handlers.renameBoard('board-1', {
      title: '归档课题', baseRevision: 2,
    })).resolves.toMatchObject({ board: { title: '归档课题', revision: 3 } })
    await expect(handlers.trashBoard('board-1', { baseRevision: 3 }))
      .resolves.toMatchObject({ board: { revision: 4, lifecycle: { state: 'trashed' } } })
    await expect(handlers.renameBoard('board-1', {
      title: '回收站内改名', baseRevision: 4,
    })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    await expect(handlers.restoreBoard('board-1', { baseRevision: 4 }))
      .resolves.toMatchObject({ board: { revision: 5, lifecycle: { state: 'active' } } })

    const restored = await store.load('board-1')
    expect(restored.lifecycle).toEqual({ state: 'active' })
    expect({
      cards: restored.cards,
      transformations: restored.transformations,
    }).toEqual(owned)
    await expect(handlers.archiveBoard('board-1', { baseRevision: 4 }))
      .rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
  })

  it('rejects invalid titles, base revisions, and lifecycle transitions without writing', async () => {
    const { store, handlers } = await fixture()
    await expect(handlers.renameBoard('board-1', { title: '   ', baseRevision: 0 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.renameBoard('board-1', {
      title: '画'.repeat(121), baseRevision: 0,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.archiveBoard('board-1', { baseRevision: -1 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await handlers.archiveBoard('board-1', { baseRevision: 0 })
    await expect(handlers.archiveBoard('board-1', { baseRevision: 1 }))
      .rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
    expect((await store.load('board-1')).revision).toBe(1)
  })

  it.each([
    ['active run', { id: 'run-active', boardId: 'board-1', targetCardId: 'target', status: 'running' }, 'TARGET_BUSY'],
    ['candidate', candidateRun(), 'CANDIDATE_PENDING'],
  ])('blocks archive when the board has an %s', async (_case, run, code) => {
    const { store, runStore, handlers } = await fixture()
    await runStore.save(run)

    await expect(handlers.archiveBoard('board-1', { baseRevision: 0 }))
      .rejects.toMatchObject({ code })
    await expect(store.load('board-1')).resolves.toMatchObject({
      revision: 0, lifecycle: { state: 'active' },
    })
  })

  it('fails archive closed when run history is corrupt', async () => {
    const { fs, store, handlers } = await fixture()
    fs.files.set('runs-v2/broken.json', '{bad json')

    await expect(handlers.archiveBoard('board-1', { baseRevision: 0 }))
      .rejects.toMatchObject({ code: 'RUN_CORRUPT' })
    await expect(store.load('board-1')).resolves.toMatchObject({
      revision: 0, lifecycle: { state: 'active' },
    })
  })

  it.each(['archived', 'trashed'])('rejects content, structure, and Run writes to %s boards', async (state) => {
    const board = runnableBoard()
    board.lifecycle = { state }
    const { store, runStore, handlers } = await fixture(board)

    await expect(handlers.createCard('board-1', { x: 0, y: 300, markdown: '迟到内容' }))
      .rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    await expect(handlers.startRun('board-1', 'transformation-1'))
      .rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    expect(await runStore.list()).toEqual([])
    await expect(store.load('board-1')).resolves.toMatchObject({ revision: 0 })
  })

  it.each(['adopt', 'discard'])('rejects Candidate %s on an archived board', async (decision) => {
    const board = runnableBoard()
    board.lifecycle = { state: 'archived' }
    const { runStore, handlers } = await fixture(board, { newId: ids('candidate-version') })
    await runStore.save(candidateRun())

    const command = decision === 'adopt'
      ? handlers.adoptCandidate('run-candidate', { baseVersionId: null })
      : handlers.discardCandidate('run-candidate')
    await expect(command).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    await expect(runStore.load('run-candidate')).resolves.toMatchObject({
      result: { disposition: 'candidate' },
    })
  })
})

describe('board lifecycle lock ordering', () => {
  it('snapshots the new source Head when a source write commits before Run start', async () => {
    const { store, runStore, handlers } = await fixture(runnableBoard(), {
      newId: ids('source-v2', 'run-1'),
    })
    const writeEntered = deferred()
    const releaseWrite = deferred()
    const update = store.update.bind(store)
    vi.spyOn(store, 'update').mockImplementationOnce((boardId, change) =>
      update(boardId, async (board) => {
        writeEntered.resolve()
        await releaseWrite.promise
        return change(board)
      }))

    const writing = handlers.commitCardVersion('board-1', 'source', {
      baseVersionId: 'source-v1',
      markdown: '来源已更新',
    })
    await writeEntered.promise
    const starting = handlers.startRun('board-1', 'transformation-1')
    releaseWrite.resolve()

    await expect(writing).resolves.toMatchObject({ card: { headVersionId: 'source-v2' } })
    await expect(starting).resolves.toMatchObject({
      run: {
        id: 'run-1', status: 'running',
        sourceSnapshot: [{
          cardId: 'source', versionId: 'source-v2', resolvedContent: '来源已更新',
        }],
      },
    })
    await expect(runStore.list()).resolves.toHaveLength(1)
    await expect(store.load('board-1')).resolves.toMatchObject({ revision: 2 })
  })

  it.each(['update', 'delete'])('serializes Transformation %s before Run start on the Board lock', async (kind) => {
    const { store, runStore, handlers } = await fixture()
    const listEntered = deferred()
    const releaseList = deferred()
    const list = runStore.list
    vi.spyOn(runStore, 'list').mockImplementationOnce(async () => {
      listEntered.resolve()
      await releaseList.promise
      return list()
    })
    const mutation = kind === 'update'
      ? handlers.updateTransformation('board-1', 'transformation-1', {
          baseUpdatedAt: CREATED_AT,
          label: '更新后的步骤',
        })
      : handlers.deleteTransformation('board-1', 'transformation-1')
    await listEntered.promise
    const starting = handlers.startRun('board-1', 'transformation-1')
    releaseList.resolve()

    await expect(mutation).resolves.toBeDefined()
    if (kind === 'update') {
      await expect(starting).resolves.toMatchObject({ run: { status: 'running' } })
      await expect(store.load('board-1')).resolves.toMatchObject({
        revision: 2,
        transformations: [expect.objectContaining({
          label: '更新后的步骤', lastRunId: 'run-1',
        })],
      })
    } else {
      await expect(starting).rejects.toMatchObject({ code: 'TRANSFORMATION_NOT_FOUND' })
      expect(await runStore.list()).toEqual([])
    }
  })

  it('returns BOARD_CONFLICT when an ordinary write commits before an old archive request', async () => {
    const { store, handlers } = await fixture()
    const writeEntered = deferred()
    const releaseWrite = deferred()
    const write = store.update('board-1', async (board) => {
      writeEntered.resolve()
      await releaseWrite.promise
      board.title = '普通写入'
      return board
    })
    await writeEntered.promise
    const archive = handlers.archiveBoard('board-1', { baseRevision: 0 })
    releaseWrite.resolve()

    await expect(write).resolves.toMatchObject({ revision: 1 })
    await expect(archive).rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
    await expect(store.load('board-1')).resolves.toMatchObject({
      title: '普通写入', revision: 1, lifecycle: { state: 'active' },
    })
  })

  it('makes an old archive conflict when Candidate discard commits first', async () => {
    const { store, runStore, handlers } = await fixture()
    await runStore.save(candidateRun())
    const saveEntered = deferred()
    const releaseSave = deferred()
    const save = runStore.save
    vi.spyOn(runStore, 'save').mockImplementation(async (run) => {
      if (run.result?.disposition === 'discarded') {
        saveEntered.resolve()
        await releaseSave.promise
      }
      return save(run)
    })

    const discarding = handlers.discardCandidate('run-candidate')
    await saveEntered.promise
    const archive = handlers.archiveBoard('board-1', { baseRevision: 0 })
    releaseSave.resolve()

    await expect(discarding).resolves.toMatchObject({
      run: { result: { disposition: 'discarded' } },
    })
    await expect(archive).rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
    await expect(store.load('board-1')).resolves.toMatchObject({
      revision: 1, lifecycle: { state: 'active' },
    })
  })

  it('returns BOARD_READ_ONLY when archive commits before an ordinary write', async () => {
    const { store, runStore, handlers } = await fixture()
    const listEntered = deferred()
    const releaseList = deferred()
    const list = runStore.list
    vi.spyOn(runStore, 'list').mockImplementationOnce(async () => {
      listEntered.resolve()
      await releaseList.promise
      return list()
    })
    const archive = handlers.archiveBoard('board-1', { baseRevision: 0 })
    await listEntered.promise
    const write = handlers.createCard('board-1', { x: 0, y: 300, markdown: '迟到内容' })
    releaseList.resolve()

    await expect(archive).resolves.toMatchObject({ board: { lifecycle: { state: 'archived' } } })
    await expect(write).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    expect((await store.load('board-1')).cards.map((card) => card.id)).toEqual(['source', 'target'])
  })

  it('lets Run start win the board lock and makes the old archive request conflict', async () => {
    const { store, runStore, handlers } = await fixture()
    const startEntered = deferred()
    const releaseStart = deferred()
    const start = runStore.start
    vi.spyOn(runStore, 'start').mockImplementationOnce(async (run) => {
      startEntered.resolve()
      await releaseStart.promise
      return start(run)
    })
    const starting = handlers.startRun('board-1', 'transformation-1')
    await startEntered.promise
    const archive = handlers.archiveBoard('board-1', { baseRevision: 0 })
    releaseStart.resolve()

    await expect(starting).resolves.toMatchObject({ run: { status: 'running' } })
    await expect(archive).rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
    await expect(store.load('board-1')).resolves.toMatchObject({
      revision: 1, lifecycle: { state: 'active' },
      transformations: [expect.objectContaining({ lastRunId: 'run-1' })],
    })
  })

  it('lets archive win the board lock and prevents any Run from starting', async () => {
    const { runStore, handlers } = await fixture()
    const listEntered = deferred()
    const releaseList = deferred()
    const list = runStore.list
    vi.spyOn(runStore, 'list').mockImplementationOnce(async () => {
      listEntered.resolve()
      await releaseList.promise
      return list()
    })
    const archive = handlers.archiveBoard('board-1', { baseRevision: 0 })
    await listEntered.promise
    const starting = handlers.startRun('board-1', 'transformation-1')
    releaseList.resolve()

    await expect(archive).resolves.toMatchObject({ board: { lifecycle: { state: 'archived' } } })
    await expect(starting).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    expect(await runStore.list()).toEqual([])
  })
})
