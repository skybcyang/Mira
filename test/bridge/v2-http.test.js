import { describe, expect, it, vi } from 'vitest'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { appendVersion } from '../../bridge/domain/versioning.js'
import { createV2Handlers } from '../../bridge/v2-http.js'

function memoryBoardStore(initial) {
  let board = structuredClone(initial)
  let boardQueue = Promise.resolve()
  async function withBoardLock(operation) {
    const previous = boardQueue
    let release
    boardQueue = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
  return {
    load: vi.fn(async () => {
      if (!board) throw Object.assign(new Error('missing'), { code: 'BOARD_NOT_FOUND' })
      return structuredClone(board)
    }),
    save: vi.fn(async (_id, next) => {
      board = structuredClone(next)
    }),
    update: vi.fn(async (_id, change) => withBoardLock(async () => {
      const next = await change(structuredClone(board))
      board = structuredClone(next)
      return structuredClone(board)
    })),
    withLockedBoard: vi.fn(async (_id, operation) =>
      withBoardLock(() => operation(structuredClone(board)))),
    purge: vi.fn(async (_id, collectFiles) => {
      const collected = await collectFiles(structuredClone(board))
      board = undefined
      return collected.result
    }),
    current: () => structuredClone(board),
  }
}

function memoryBoardsStore(initials) {
  const boards = new Map(initials.map((board) => [board.id, structuredClone(board)]))
  return {
    load: vi.fn(async (id) => structuredClone(boards.get(id))),
    update: vi.fn(async (id, change) => {
      const next = await change(structuredClone(boards.get(id)))
      boards.set(id, structuredClone(next))
      return structuredClone(next)
    }),
    current: (id) => structuredClone(boards.get(id)),
  }
}

describe('independent card names', () => {
  it('renames with a name baseline, preserving content, generation and portable data', async () => {
    const store = memoryBoardStore(emptyBoardV2('named-board', '课题'))
    let serial = 0
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: prefix => `${prefix}-${++serial}` })
    const { card } = await handlers.createCard('named-board', { markdown: '# 正文标题\n正文', x: 0, y: 0 })
    const { card: named } = await handlers.updateCard('named-board', card.id, { name: '  卡片名称  ', baseName: null })
    expect(named.name).toBe('卡片名称')
    expect(named.headVersionId).toBe(card.headVersionId)
    expect(named.versions).toEqual(card.versions)
    await expect(handlers.updateCard('named-board', card.id, { name: '旧窗口', baseName: null, x: 500 })).rejects.toMatchObject({ code: 'CARD_NAME_CONFLICT' })
    expect(store.current().cards[0]).toEqual(named)
    const generated = appendVersion(named, { content: { kind: 'markdown', markdown: '# 新正文' }, baseVersionId: named.headVersionId, versionId: 'generated', origin: 'ai', sourceRunId: 'run-1', createdAt: '2026-09-08T00:00:00Z' })
    expect(generated.name).toBe('卡片名称')
    const { card: copied } = await handlers.createCard('named-board', { name: named.name, markdown: '# 副本', x: 1, y: 1 })
    expect(copied.name).toBe(named.name)
    const { card: cleared } = await handlers.updateCard('named-board', card.id, { name: null, baseName: named.name })
    expect(cleared).not.toHaveProperty('name')
    expect(cleared.versions).toEqual(card.versions)
  })

  it.each([123, 'a\nb', 'x'.repeat(121), ''])('rejects invalid name %j before any write', async name => {
    const store = memoryBoardStore(emptyBoardV2('named-board', '课题'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore() })
    await expect(handlers.createCard('named-board', { name, markdown: '正文' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })
})

function memoryRunStore() {
  const runs = new Map()
  const operationQueues = new Map()
  const targetQueues = new Map()
  async function serialize(queues, key, operation) {
    const previous = queues.get(key) || Promise.resolve()
    let release
    const current = new Promise((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    queues.set(key, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (queues.get(key) === queued) queues.delete(key)
    }
  }
  const store = {
    save: vi.fn(async (run) => {
      runs.set(run.id, structuredClone(run))
      return run
    }),
    load: vi.fn(async (id) => {
      if (!runs.has(id)) throw Object.assign(new Error('missing'), { code: 'RUN_NOT_FOUND' })
      return structuredClone(runs.get(id))
    }),
    list: vi.fn(async () => [...runs.values()].map((run) => structuredClone(run))),
    start: vi.fn(async (run) =>
      store.withTargetLock(run.boardId, run.targetCardId, async () => {
        const busy = [...runs.values()].some(
          (item) =>
            item.boardId === run.boardId &&
            item.targetCardId === run.targetCardId &&
            ['queued', 'running'].includes(item.status),
        )
        if (busy) throw Object.assign(new Error('target busy'), { code: 'TARGET_BUSY' })
        const candidatePending = [...runs.values()].some(
          (item) =>
            item.boardId === run.boardId &&
            item.targetCardId === run.targetCardId &&
            item.status === 'succeeded' &&
            item.result?.disposition === 'candidate',
        )
        if (candidatePending) {
          throw Object.assign(new Error('candidate pending'), { code: 'CANDIDATE_PENDING' })
        }
        runs.set(run.id, structuredClone(run))
        return structuredClone(run)
      }),
    ),
    withTargetLock: vi.fn(async (boardId, targetCardId, operation) =>
      serialize(targetQueues, JSON.stringify([boardId, targetCardId]), operation),
    ),
    withLockedRun: vi.fn(async (id, operation) => {
      return serialize(operationQueues, id, async () => operation(await store.load(id)))
    }),
    pathForRun: (id) => `runs-v2/${id}.json`,
  }
  return store
}

function memorySyncFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    readText: vi.fn(async (path) => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    }),
    writeText: vi.fn(async (path, content) => files.set(path, content)),
    replace: vi.fn(async (from, to) => {
      if (!files.has(from)) throw new Error('missing temp')
      files.set(to, files.get(from))
      files.delete(from)
    }),
    remove: vi.fn(async (path) => files.delete(path)),
  }
}

function ids(...values) {
  return vi.fn(() => values.shift())
}

describe('pool snapshot card creation', () => {
  function setup() {
    const board = emptyBoardV2('pool-board', '课题', '2026-09-08T00:00:00Z')
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    const pool = { id: 'inspiration-pool', entries: [{ id: 'entry', tags: ['技术'], headVersionId: 'v2', versions: [
      { id: 'v1', content: { kind: 'markdown', markdown: '选择时的正文' } },
      { id: 'v2', content: { kind: 'markdown', markdown: '后来的正文' } },
    ] }] }
    const handlers = createV2Handlers({ store, runStore, inspirationPoolStore: { load: async () => pool }, newId: ids('first', 'first-v1', 'second', 'second-v1') })
    return { store, handlers, runStore }
  }
  const input = { poolSource: { poolId: 'inspiration-pool', entryId: 'entry', versionId: 'v1' }, tags: ['主意'] }

  it('rejects forged pool provenance through ordinary single and batch creation', async () => {
    const { store, handlers } = setup()
    const forged = { x: 0, y: 0, markdown: '伪造正文', inspirationRef: input.poolSource }
    await expect(handlers.createCard('pool-board', forged)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.createCards('pool-board', { cards: [input, forged] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current().cards).toEqual([])
  })

  it('does not silently create an empty Card when a pool snapshot uses the single-card endpoint', async () => {
    const { store, handlers } = setup()
    await expect(handlers.createCard('pool-board', input)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current().cards).toEqual([])
  })

  it('reads the selected immutable version and lays out the entire batch on the server', async () => {
    const { store, handlers, runStore } = setup()
    const { cards } = await handlers.createCards('pool-board', { cards: [input, input] })
    expect(cards.map((card) => card.versions[0].content.markdown)).toEqual(['选择时的正文', '选择时的正文'])
    expect(cards.map((card) => card.inspirationRef)).toEqual([input.poolSource, input.poolSource])
    expect(cards[1].y).toBeGreaterThanOrEqual(cards[0].y + cards[0].height)
    expect(cards.map((card) => card.tags)).toEqual([['主意'], ['主意']])
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.current().transformations).toEqual([])
    expect(runStore.save).not.toHaveBeenCalled()
  })

  it.each([
    { ...input, x: 0 },
    { ...input, markdown: '伪造正文' },
    { ...input, inspirationRef: input.poolSource },
    { poolSource: { ...input.poolSource, versionId: 'missing' } },
    { poolSource: { ...input.poolSource, poolId: 'other' } },
  ])('rejects an invalid member without partially creating the batch: %j', async (invalid) => {
    const { store, handlers } = setup()
    await expect(handlers.createCards('pool-board', { cards: [input, invalid] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current().cards).toEqual([])
  })
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settleRun(runStore, runId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const run = await runStore.load(runId)
    if (['succeeded', 'failed', 'interrupted'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('run did not settle')
}

async function boardWithSources() {
  const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
  const store = memoryBoardStore(board)
  const runStore = memoryRunStore()
  const handlers = createV2Handlers({
    store,
    runStore,
    newId: ids('card-a', 'card-a-v1', 'card-b', 'card-b-v1'),
    now: () => '2026-08-23T02:01:00.000Z',
  })
  await handlers.createCard('board-1', { x: 0, y: 0, markdown: '材料 A' })
  await handlers.createCard('board-1', { x: 0, y: 240, markdown: '材料 B' })
  return { store, runStore }
}

function markdownCard(id, markdown) {
  const card = {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: null,
    versions: [],
    createdAt: '2026-08-23T02:00:00.000Z',
    updatedAt: '2026-08-23T02:00:00.000Z',
  }
  if (markdown === undefined) return card
  return appendVersion(card, {
    baseVersionId: null,
    versionId: `${id}-v1`,
    content: { kind: 'markdown', markdown },
    origin: 'human',
    createdAt: '2026-08-23T02:00:00.000Z',
  })
}

function editablePlanBoard() {
  const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
  board.cards.push(
    markdownCard('source-a', '材料 A'),
    markdownCard('source-b', '材料 B'),
    markdownCard('target', '已有成果'),
    markdownCard('other-target'),
  )
  board.transformations.push(
    {
      id: 'transformation-1',
      sourceCardIds: ['source-a'],
      targetCardId: 'target',
      label: '原步骤',
      instruction: '原目标',
      acceptance: '原验收',
      permissions: { workspaceWrite: false },
      workflowRef: {
        workflowId: 'workflow-1',
        stepId: 'workflow-step-1',
        applicationId: 'application-1',
      },
      lastRunId: 'run-old',
      lastAppliedRunId: 'run-applied',
      createdAt: '2026-08-23T02:00:00.000Z',
      updatedAt: '2026-08-23T02:00:00.000Z',
    },
    {
      id: 'transformation-2',
      sourceCardIds: ['source-a'],
      targetCardId: 'other-target',
      label: '保留步骤',
      instruction: '保持不变',
      acceptance: '',
      permissions: { workspaceWrite: false },
      createdAt: '2026-08-23T02:00:00.000Z',
      updatedAt: '2026-08-23T02:00:00.000Z',
    },
  )
  return board
}

function pendingCandidateRun(overrides = {}) {
  return {
    id: 'run-candidate',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    targetCardId: 'target',
    targetBaseVersionId: null,
    status: 'succeeded',
    result: {
      output: '待处理候选',
      digest: 'fnv1a:candidate',
      disposition: 'candidate',
    },
    ...overrides,
  }
}

function planPatch(overrides = {}) {
  return {
    baseUpdatedAt: '2026-08-23T02:00:00.000Z',
    ...overrides,
  }
}

describe('v2 HTTP application handlers', () => {
  it('purges only a trashed board after exact confirmation and current revision', async () => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.lifecycle = { state: 'trashed', trashedAt: '2026-08-23T02:01:00.000Z' }
    board.revision = 4
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    await runStore.save({ id: 'run-old', boardId: 'board-1', targetCardId: 'target', status: 'succeeded', result: { disposition: 'applied', output: 'done' } })
    await runStore.save({ id: 'run-other', boardId: 'board-other', targetCardId: 'target', status: 'succeeded', result: { disposition: 'applied', output: 'keep' } })
    const handlers = createV2Handlers({ store, runStore, newId: ids('unused') })

    await expect(handlers.purgeBoard('board-1', { baseRevision: 4 })).rejects.toMatchObject({ code: 'BOARD_PURGE_INVALID' })
    await expect(handlers.purgeBoard('board-1', { baseRevision: 3, confirmation: 'permanently-delete' })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' })
    await expect(handlers.purgeBoard('board-1', { baseRevision: 4, confirmation: 'permanently-delete' })).resolves.toEqual({ deletedBoardId: 'board-1', deletedRunIds: ['run-old'] })
    await expect(store.load('board-1')).rejects.toBeDefined()
  })

  it('creates and edits a card by appending versions', async () => {
    const store = memoryBoardStore(
      emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'),
    )
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('card-1', 'card-1-v1', 'card-1-v2'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    const created = await handlers.createCard('board-1', {
      x: 30,
      y: 40,
      markdown: '第一版',
    })
    const edited = await handlers.commitCardVersion('board-1', 'card-1', {
      baseVersionId: 'card-1-v1',
      markdown: '第二版',
    })

    expect(created.card.headVersionId).toBe('card-1-v1')
    expect(edited.card.versions).toHaveLength(2)
    expect(edited.card.versions[1].content.markdown).toBe('第二版')
    expect(store.current().cards[0].headVersionId).toBe('card-1-v2')
  })

  it('binds a markdown card and automatically syncs a new CardVersion', async () => {
    const store = memoryBoardStore({
      ...emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'),
      cards: [markdownCard('card-1', '第一版')],
    })
    const fs = memorySyncFs({ 'docs/spec.md': '第一版' })
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      fs,
      newId: ids('card-1-v2'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    const bound = await handlers.bindCardFile('board-1', 'card-1', { path: 'docs/spec.md' })
    const edited = await handlers.commitCardVersion('board-1', 'card-1', {
      baseVersionId: 'card-1-v1',
      markdown: '第二版',
    })

    expect(bound.card.fileBinding).toMatchObject({
      path: 'docs/spec.md',
      lastSyncedVersionId: 'card-1-v1',
    })
    expect(edited.fileSync).toMatchObject({ status: 'synced', path: 'docs/spec.md' })
    expect(fs.files.get('docs/spec.md')).toBe('第二版')
    expect(edited.card.fileBinding.lastSyncedVersionId).toBe('card-1-v2')
  })

  it('keeps the file unchanged and reports a conflict after an external edit', async () => {
    const store = memoryBoardStore({
      ...emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'),
      cards: [markdownCard('card-1', '第一版')],
    })
    const fs = memorySyncFs({ 'docs/spec.md': '第一版' })
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      fs,
      newId: ids('card-1-v2'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    await handlers.bindCardFile('board-1', 'card-1', { path: 'docs/spec.md' })
    fs.files.set('docs/spec.md', '本地修改')
    const edited = await handlers.commitCardVersion('board-1', 'card-1', {
      baseVersionId: 'card-1-v1',
      markdown: '第二版',
    })

    expect(edited.fileSync).toMatchObject({ status: 'conflict', path: 'docs/spec.md' })
    expect(fs.files.get('docs/spec.md')).toBe('本地修改')
    expect(edited.card.headVersionId).toBe('card-1-v2')
  })

  it('requires explicit overwrite for a first binding with different content', async () => {
    const store = memoryBoardStore({
      ...emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'),
      cards: [markdownCard('card-1', 'Mira 内容')],
    })
    const fs = memorySyncFs({ 'docs/spec.md': '本地内容' })
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), fs, newId: ids('temp') })

    await expect(handlers.bindCardFile('board-1', 'card-1', { path: 'docs/spec.md' }))
      .rejects.toMatchObject({ code: 'FILE_BINDING_CONFLICT' })
    expect(fs.files.get('docs/spec.md')).toBe('本地内容')
    expect(store.current().cards[0]).not.toHaveProperty('fileBinding')
  })

  it('imports a local conflict as a new human version', async () => {
    const store = memoryBoardStore({
      ...emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'),
      cards: [markdownCard('card-1', '第一版')],
    })
    const fs = memorySyncFs({ 'docs/spec.md': '第一版' })
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      fs,
      newId: ids('version-import'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    await handlers.bindCardFile('board-1', 'card-1', { path: 'docs/spec.md' })
    fs.files.set('docs/spec.md', '本地修改')
    const result = await handlers.syncCardFile('board-1', 'card-1', {
      resolution: 'import',
      expectedFileDigest: 'ignored-by-service-read',
    }).catch((error) => error)

    expect(result).toMatchObject({ code: 'FILE_SYNC_CONFLICT' })
    const status = await handlers.getCardFileBinding('board-1', 'card-1')
    const imported = await handlers.syncCardFile('board-1', 'card-1', {
      resolution: 'import',
      expectedFileDigest: status.fileDigest,
    })
    expect(imported.fileSync.status).toBe('synced')
    expect(imported.card.versions.at(-1)).toMatchObject({
      origin: 'human',
      content: { kind: 'markdown', markdown: '本地修改' },
    })
  })

  it('uses ordered multi-card context for suggestions and transformation creation', async () => {
    const { store, runStore } = await boardWithSources()
    const executeSuggestion = vi.fn(async ({ prompt }) =>
      JSON.stringify([
        { label: '形成决策', instruction: '综合材料形成决策', acceptance: '保留全部约束' },
      ]),
    )
    const handlers = createV2Handlers({
      store,
      runStore,
      executeSuggestion,
      newId: ids('target', 'transformation-1'),
      now: () => '2026-08-23T02:02:00.000Z',
    })
    store.update.mockClear()

    const sourceRefs = [
      { cardId: 'card-b', versionId: 'card-b-v1' },
      { cardId: 'card-a', versionId: 'card-a-v1' },
    ]
    const suggested = await handlers.suggest('board-1', { sourceRefs })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs,
      label: suggested.suggestions[0].label,
      instruction: suggested.suggestions[0].instruction,
      acceptance: suggested.suggestions[0].acceptance,
      modelId: 'reasoning-model',
      targetPosition: { x: 520, y: 80 },
    })

    expect(executeSuggestion.mock.calls[0][0].prompt.indexOf('材料 B')).toBeLessThan(
      executeSuggestion.mock.calls[0][0].prompt.indexOf('材料 A'),
    )
    expect(created.transformation.sourceCardIds).toEqual(['card-b', 'card-a'])
    expect(created.transformation.modelId).toBe('reasoning-model')
    expect(created.transformation).not.toHaveProperty('lastRunId')
    expect(created.transformation).not.toHaveProperty('lastAppliedRunId')
    expect(created.targetCard).toMatchObject({ id: 'target', headVersionId: null, versions: [] })
    expect(store.current().transformations).toHaveLength(1)
    expect(store.update).toHaveBeenCalledTimes(1)
  })

  it('creates parallel transformations and target cards atomically', async () => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(markdownCard('source', '可用内容'))
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('target-1', 'transformation-1', 'target-2', 'transformation-2'),
      now: () => '2026-08-23T02:02:00.000Z',
    })

    const result = await handlers.createTransformations('board-1', {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      transformations: [
        { label: '方向 A', instruction: '形成 A', acceptance: '', targetPosition: { x: 520, y: 80 } },
        { label: '方向 B', instruction: '形成 B', acceptance: '', targetPosition: { x: 520, y: 352 } },
      ],
    })

    expect(result.transformations.map((item) => item.sourceCardIds)).toEqual([['source'], ['source']])
    expect(result.targetCards.map((item) => item.id)).toEqual(['target-1', 'target-2'])
    expect(store.current().cards).toHaveLength(3)
    expect(store.current().transformations).toHaveLength(2)
    expect(store.update).toHaveBeenCalledOnce()
  })

  it('validates every parallel branch before writing any of them', async () => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(markdownCard('source', '可用内容'))
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createTransformations('board-1', {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      transformations: [
        { label: '方向 A', instruction: '形成 A' },
        { label: '', instruction: '形成 B' },
      ],
    })).rejects.toMatchObject({ code: 'TRANSFORMATION_INVALID' })
    expect(store.current().cards).toHaveLength(1)
    expect(store.current().transformations).toHaveLength(0)
    expect(store.update).toHaveBeenCalledOnce()
  })

  it('rejects a single parallel branch as outside the 2..16 batch contract', async () => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(markdownCard('source', '可用内容'))
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createTransformations('board-1', {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      transformations: [
        { label: '唯一方向', instruction: '形成唯一方向' },
      ],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current().cards).toHaveLength(1)
    expect(store.current().transformations).toHaveLength(0)
    expect(store.update).toHaveBeenCalledOnce()
  })

  it('rejects more than sixteen parallel branches before writing any of them', async () => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(markdownCard('source', '可用内容'))
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    const transformations = Array.from({ length: 17 }, (_item, index) => ({
      label: `方向 ${index + 1}`,
      instruction: `形成方向 ${index + 1}`,
    }))
    await expect(handlers.createTransformations('board-1', {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      transformations,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current().cards).toHaveLength(1)
    expect(store.current().transformations).toHaveLength(0)
    expect(store.update).toHaveBeenCalledOnce()
  })

  it.each([
    ['a null version id', markdownCard('source'), null],
    ['an empty version id', markdownCard('source', '可用内容'), ''],
    [
      'a dangling current Head',
      { ...markdownCard('source'), headVersionId: 'source-missing' },
      'source-missing',
    ],
    ['blank current Head content', markdownCard('source', '   '), 'source-v1'],
  ])('rejects a transformation source with %s', async (_case, sourceCard, versionId) => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(sourceCard)
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('target', 'transformation-1'),
    })

    await expect(
      handlers.createTransformation('board-1', {
        sourceRefs: [{ cardId: 'source', versionId }],
        label: '结果',
        instruction: '生成结果',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
    expect(store.current().transformations).toHaveLength(0)
  })

  it.each([
    ['a missing source object', [null]],
    ['an empty card id', [{ cardId: '', versionId: 'source-v1' }]],
    [
      'a duplicate card id',
      [
        { cardId: 'source', versionId: 'source-v1' },
        { cardId: 'source', versionId: 'source-v1' },
      ],
    ],
  ])('keeps %s as a malformed transformation source', async (_case, sourceRefs) => {
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    board.cards.push(markdownCard('source', '可用内容'))
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('target', 'transformation-1'),
    })

    await expect(
      handlers.createTransformation('board-1', {
        sourceRefs,
        label: '结果',
        instruction: '生成结果',
      }),
    ).rejects.toMatchObject({ code: 'TRANSFORMATION_SOURCE_INVALID' })
    expect(store.current().transformations).toHaveLength(0)
  })

  it('updates ordered step semantics while preserving target, provenance, and history identity', async () => {
    const store = memoryBoardStore(editablePlanBoard())
    const runStore = memoryRunStore()
    const handlers = createV2Handlers({
      store,
      runStore,
      newId: ids(),
      now: () => '2026-08-23T03:00:00.000Z',
    })
    const before = store.current().transformations[0]

    const result = await handlers.updateTransformation('board-1', 'transformation-1', {
      baseUpdatedAt: before.updatedAt,
      label: '新步骤',
      instruction: '综合两份材料',
      acceptance: '结论可追溯',
      modelId: 'reasoning-model',
      sourceRefs: [
        { cardId: 'source-b', versionId: 'source-b-v1' },
        { cardId: 'source-a', versionId: 'source-a-v1' },
      ],
      targetCardId: 'source-b',
      workflowRef: { workflowId: 'tampered' },
      createdAt: 'tampered',
      lastRunId: 'tampered',
      lastAppliedRunId: 'tampered',
    })

    expect(result.transformation).toMatchObject({
      id: 'transformation-1',
      sourceCardIds: ['source-b', 'source-a'],
      targetCardId: 'target',
      label: '新步骤',
      instruction: '综合两份材料',
      acceptance: '结论可追溯',
      modelId: 'reasoning-model',
      workflowRef: before.workflowRef,
      createdAt: before.createdAt,
      lastRunId: before.lastRunId,
      lastAppliedRunId: before.lastAppliedRunId,
      updatedAt: '2026-08-23T03:00:00.000Z',
    })
    expect(store.current().transformations[1]).toMatchObject({
      id: 'transformation-2',
      label: '保留步骤',
      instruction: '保持不变',
    })
  })

  it('rejects a source update that closes a multi-step dependency cycle without writing', async () => {
    const original = editablePlanBoard()
    const first = original.transformations[0]
    const second = original.transformations[1]
    second.sourceCardIds = [first.targetCardId]
    const sourceIndex = original.cards.findIndex(card => card.id === second.targetCardId)
    original.cards[sourceIndex] = appendVersion(original.cards[sourceIndex], {
      baseVersionId: original.cards[sourceIndex].headVersionId,
      versionId: 'downstream-v1', content: { kind: 'markdown', markdown: 'downstream' },
      origin: 'human', createdAt: '2026-09-07T00:00:00.000Z',
    })
    const store = memoryBoardStore(original)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })
    const source = original.cards.find(card => card.id === second.targetCardId)
    await expect(handlers.updateTransformation('board-1', first.id, {
      baseUpdatedAt: first.updatedAt,
      sourceRefs: [{ cardId: source.id, versionId: source.headVersionId }],
    })).rejects.toMatchObject({ code: 'TRANSFORMATION_SOURCE_INVALID' })
    expect(store.current()).toEqual(original)
  })

  it('persists that a planned step was adjusted when its semantics change', async () => {
    const board = editablePlanBoard()
    board.transformations[0].planRef = {
      planId: 'application-1',
      source: 'template',
      title: '研究方法',
      stepIndex: 1,
      stepTotal: 1,
    }
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T03:00:00.000Z',
    })

    const result = await handlers.updateTransformation('board-1', 'transformation-1', {
      baseUpdatedAt: board.transformations[0].updatedAt,
      instruction: '改用新的判断路径',
    })

    expect(result.transformation.planRef).toMatchObject({
      planId: 'application-1',
      adjusted: true,
    })
    expect(store.current().transformations[0].planRef.adjusted).toBe(true)
  })

  it('persists transformation position without changing its semantic revision', async () => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T03:00:00.000Z',
    })
    const revision = board.transformations[0].updatedAt

    const result = await handlers.updateTransformationPosition(
      'board-1',
      'transformation-1',
      { x: 360, y: 180 },
    )

    expect(result.transformation).toMatchObject({
      id: 'transformation-1',
      x: 360,
      y: 180,
      updatedAt: revision,
    })
    expect(store.current().transformations[0]).toEqual(result.transformation)
  })

  it.each([
    [{ x: Number.NaN, y: 180 }],
    [{ x: 360, y: Number.POSITIVE_INFINITY }],
    [{ x: 360 }],
  ])('rejects invalid transformation position %j without writing', async (position) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.updateTransformationPosition(
      'board-1',
      'transformation-1',
      position,
    )).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.current()).toEqual(board)
  })

  it('clears a transformation model override without changing other semantics', async () => {
    const board = editablePlanBoard()
    board.transformations[0].modelId = 'reasoning-model'
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T03:00:00.000Z',
    })

    const result = await handlers.updateTransformation('board-1', 'transformation-1', {
      baseUpdatedAt: board.transformations[0].updatedAt,
      modelId: null,
    })

    expect(result.transformation).not.toHaveProperty('modelId')
    expect(result.transformation).toMatchObject({
      label: '原步骤',
      instruction: '原目标',
      acceptance: '原验收',
    })
  })

  it.each(['', '   ', 42])('rejects an invalid transformation model override %j', async (modelId) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.updateTransformation('board-1', 'transformation-1', {
      baseUpdatedAt: board.transformations[0].updatedAt,
      modelId,
    })).rejects.toMatchObject({ code: 'TRANSFORMATION_INVALID' })
    expect(store.current()).toEqual(board)
  })

  it.each([
    ['a missing revision', { label: '不应写入' }],
    [
      'a stale revision',
      { baseUpdatedAt: '2026-08-23T01:59:59.000Z', label: '不应写入' },
    ],
  ])('rejects a transformation update with %s', async (_case, body) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(
      handlers.updateTransformation('board-1', 'transformation-1', body),
    ).rejects.toMatchObject({ code: 'TRANSFORMATION_CONFLICT' })
    expect(store.current()).toEqual(board)
  })

  it('allows only one concurrent transformation update from the same revision', async () => {
    const store = memoryBoardStore(editablePlanBoard())
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T03:00:00.000Z',
    })

    const outcomes = await Promise.allSettled([
      handlers.updateTransformation(
        'board-1',
        'transformation-1',
        planPatch({ label: '并发版本 A' }),
      ),
      handlers.updateTransformation(
        'board-1',
        'transformation-1',
        planPatch({ label: '并发版本 B' }),
      ),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason).toMatchObject({
      code: 'TRANSFORMATION_CONFLICT',
    })
    expect(['并发版本 A', '并发版本 B']).toContain(
      store.current().transformations[0].label,
    )
  })

  it('advances the revision when two updates happen in the same clock millisecond', async () => {
    const store = memoryBoardStore(editablePlanBoard())
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T02:00:00.000Z',
    })

    const outcomes = await Promise.allSettled([
      handlers.updateTransformation(
        'board-1',
        'transformation-1',
        planPatch({ label: '同毫秒 A' }),
      ),
      handlers.updateTransformation(
        'board-1',
        'transformation-1',
        planPatch({ label: '同毫秒 B' }),
      ),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason).toMatchObject({
      code: 'TRANSFORMATION_CONFLICT',
    })
    expect(store.current().transformations[0].updatedAt).toBe(
      '2026-08-23T02:00:00.001Z',
    )
  })

  it.each([
    ['a blank label', planPatch({ label: '   ' }), 'TRANSFORMATION_INVALID'],
    ['a blank instruction', planPatch({ instruction: '' }), 'TRANSFORMATION_INVALID'],
    [
      'its own target as a source',
      planPatch({ sourceRefs: [{ cardId: 'target', versionId: 'target-v1' }] }),
      'TRANSFORMATION_SOURCE_INVALID',
    ],
    [
      'a stale source Head',
      planPatch({ sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-stale' }] }),
      'SOURCE_VERSION_CHANGED',
    ],
  ])('rejects a transformation update with %s', async (_case, body, code) => {
    const store = memoryBoardStore(editablePlanBoard())
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
    })
    const before = store.current()

    await expect(
      handlers.updateTransformation('board-1', 'transformation-1', body),
    ).rejects.toMatchObject({ code })
    expect(store.current()).toEqual(before)
  })

  it('rejects a transformation update when the selected current Head has blank content', async () => {
    const board = editablePlanBoard()
    const source = board.cards.find((card) => card.id === 'source-b')
    source.versions[0].content.markdown = '   '
    const store = memoryBoardStore(board)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(
      handlers.updateTransformation('board-1', 'transformation-1', {
        baseUpdatedAt: '2026-08-23T02:00:00.000Z',
        sourceRefs: [{ cardId: 'source-b', versionId: 'source-b-v1' }],
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
    expect(store.current()).toEqual(board)
  })

  it('deletes only the selected transformation and preserves cards, runs, and other steps', async () => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    await runStore.save({
      id: 'run-old',
      boardId: 'board-1',
      transformationId: 'transformation-1',
      targetCardId: 'target',
      status: 'succeeded',
    })
    const handlers = createV2Handlers({ store, runStore, newId: ids() })

    await expect(
      handlers.deleteTransformation('board-1', 'transformation-1'),
    ).resolves.toEqual({ deletedTransformationId: 'transformation-1' })

    expect(store.current().transformations.map((item) => item.id)).toEqual([
      'transformation-2',
    ])
    expect(store.current().cards).toEqual(board.cards)
    await expect(runStore.load('run-old')).resolves.toMatchObject({ status: 'succeeded' })
  })

  it.each([
    [
      'update',
      (handlers) =>
        handlers.updateTransformation(
          'board-1',
          'transformation-1',
          planPatch({ label: '新步骤' }),
        ),
    ],
    [
      'delete',
      (handlers) => handlers.deleteTransformation('board-1', 'transformation-1'),
    ],
  ])('rejects a transformation %s while its target has an active Run', async (_case, mutate) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    await runStore.save({
      id: 'run-active',
      boardId: 'board-1',
      targetCardId: 'target',
      status: 'running',
    })
    const handlers = createV2Handlers({ store, runStore, newId: ids() })

    await expect(mutate(handlers)).rejects.toMatchObject({ code: 'TARGET_BUSY' })
    expect(store.current()).toEqual(board)
  })

  it.each([
    [
      'update',
      (handlers) =>
        handlers.updateTransformation(
          'board-1',
          'transformation-1',
          planPatch({ label: '新步骤' }),
        ),
    ],
    [
      'delete',
      (handlers) => handlers.deleteTransformation('board-1', 'transformation-1'),
    ],
  ])('keeps a pending Candidate reachable when asked to %s its transformation', async (_case, mutate) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    await runStore.save(pendingCandidateRun())
    const handlers = createV2Handlers({ store, runStore, newId: ids() })

    await expect(mutate(handlers)).rejects.toMatchObject({ code: 'CANDIDATE_PENDING' })
    expect(store.current()).toEqual(board)
  })

  it.each([
    [
      'adopted Candidate and update',
      async (handlers) => {
        await handlers.adoptCandidate('run-candidate', { baseVersionId: 'target-v1' })
        return handlers.updateTransformation(
          'board-1',
          'transformation-1',
          planPatch({
            baseUpdatedAt: '2026-08-23T03:01:00.000Z',
            label: '采用后可修改',
          }),
        )
      },
      'transformation-1',
    ],
    [
      'discarded Candidate and delete',
      async (handlers) => {
        await handlers.discardCandidate('run-candidate')
        return handlers.deleteTransformation('board-1', 'transformation-1')
      },
      'transformation-2',
    ],
  ])('allows mutation after an %s', async (_case, decideAndMutate, remainingId) => {
    const store = memoryBoardStore(editablePlanBoard())
    const runStore = memoryRunStore()
    await runStore.save(pendingCandidateRun())
    const handlers = createV2Handlers({
      store,
      runStore,
      newId: ids('candidate-adopted-v2'),
      now: () => '2026-08-23T03:01:00.000Z',
    })

    await expect(decideAndMutate(handlers)).resolves.toBeDefined()
    expect(store.current().transformations.map((item) => item.id)).toContain(remainingId)
  })

  it.each([
    [
      'update',
      (handlers) =>
        handlers.updateTransformation(
          'board-1',
          'transformation-1',
          planPatch({ label: '新步骤' }),
        ),
    ],
    [
      'delete',
      (handlers) => handlers.deleteTransformation('board-1', 'transformation-1'),
    ],
  ])('fails a transformation %s closed when Run history cannot be read', async (_case, mutate) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    runStore.list.mockRejectedValueOnce(
      Object.assign(new Error('disk offline'), { code: 'RUN_READ_FAILED' }),
    )
    const handlers = createV2Handlers({ store, runStore, newId: ids() })

    await expect(mutate(handlers)).rejects.toMatchObject({ code: 'RUN_READ_FAILED' })
    expect(store.current()).toEqual(board)
  })

  it.each([
    [
      'update',
      (handlers) =>
        handlers.updateTransformation(
          'board-1',
          'transformation-1',
          planPatch({ label: '新步骤' }),
        ),
    ],
    [
      'delete',
      (handlers) => handlers.deleteTransformation('board-1', 'transformation-1'),
    ],
  ])('fails a transformation %s closed when Run history is corrupt', async (_case, mutate) => {
    const board = editablePlanBoard()
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    runStore.list.mockRejectedValueOnce(
      Object.assign(new Error('invalid run json'), { code: 'RUN_CORRUPT' }),
    )
    const handlers = createV2Handlers({ store, runStore, newId: ids() })

    await expect(mutate(handlers)).rejects.toMatchObject({ code: 'RUN_CORRUPT' })
    expect(store.current()).toEqual(board)
  })

  it.each([
    [
      'adopt',
      ['run-blocked', 'candidate-adopted-v2', 'run-next'],
      (handlers) => handlers.adoptCandidate('run-candidate', { baseVersionId: 'target-v1' }),
    ],
    [
      'discard',
      ['run-blocked', 'run-next'],
      (handlers) => handlers.discardCandidate('run-candidate'),
    ],
  ])('blocks a new Run until the Candidate is %sed', async (_case, newIds, decide) => {
    const store = memoryBoardStore(editablePlanBoard())
    const runStore = memoryRunStore()
    await runStore.save(pendingCandidateRun())
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: () => new Promise(() => {}),
      newId: ids(...newIds),
      now: () => '2026-08-23T03:02:00.000Z',
    })

    await expect(
      handlers.startRun('board-1', 'transformation-1'),
    ).rejects.toMatchObject({ code: 'CANDIDATE_PENDING' })
    expect(store.current().transformations[0].lastRunId).toBe('run-old')

    await decide(handlers)
    await expect(
      handlers.startRun('board-1', 'transformation-1'),
    ).resolves.toMatchObject({ run: { id: 'run-next', status: 'running' } })
  })

  it('allows only one concurrent run start for the same board target', async () => {
    const { store, runStore } = await boardWithSources()
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: () => new Promise(() => {}),
      newId: ids('target', 'transformation-1', 'run-1', 'run-2'),
      now: () => '2026-08-23T02:03:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '把材料变成方案',
      acceptance: '可编辑',
    })

    const outcomes = await Promise.allSettled([
      handlers.startRun('board-1', created.transformation.id),
      handlers.startRun('board-1', created.transformation.id),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason).toMatchObject({
      code: 'TARGET_BUSY',
    })
    expect(runStore.start).toHaveBeenCalledTimes(2)
    expect(await runStore.list()).toHaveLength(1)
  })

  it('freezes the resolved model on the Run and uses it for execution', async () => {
    const { store, runStore } = await boardWithSources()
    const resolveModel = vi.fn(async ({ modelId }) => ({
      provider: 'openai-compatible',
      model: modelId || 'default-model',
    }))
    const executeModel = vi.fn(async () => ({ outputText: '# 模型结果' }))
    const handlers = createV2Handlers({
      store,
      runStore,
      resolveModel,
      executeModel,
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:08:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '深入整理材料',
      modelId: 'reasoning-model',
    })

    const started = await handlers.startRun('board-1', created.transformation.id)
    await settleRun(runStore, started.run.id)

    expect(resolveModel).toHaveBeenCalledWith({ modelId: 'reasoning-model' })
    expect(started.run.modelSnapshot).toEqual({
      provider: 'openai-compatible',
      model: 'reasoning-model',
    })
    expect(executeModel).toHaveBeenCalledWith(expect.objectContaining({
      modelSnapshot: {
        provider: 'openai-compatible',
        model: 'reasoning-model',
      },
    }))
  })

  it('asks the model for user-facing artifact text without execution commentary', async () => {
    const { store, runStore } = await boardWithSources()
    const executeModel = vi.fn(async () => ({ outputText: '# 可直接使用的成果' }))
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel,
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:09:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '可直接分享',
    })

    await handlers.startRun('board-1', created.transformation.id)
    await settleRun(runStore, 'run-1')

    const prompt = executeModel.mock.calls[0][0].prompt
    expect(prompt).toContain('# 输出规则')
    expect(prompt).toContain('只返回可直接写入成果卡片的正文')
    expect(prompt).toContain('不要提及 agent、会话、工具、report、文件写入或上级代理')
  })

  it('persists only a safe progress summary while a Run is running', async () => {
    const { store, runStore } = await boardWithSources()
    let reportProgress
    let finishModel
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: ({ onProgress }) => new Promise((resolve) => {
        reportProgress = onProgress
        finishModel = resolve
      }),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:10:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })

    await handlers.startRun('board-1', created.transformation.id)
    expect(reportProgress).toBeTypeOf('function')
    await Promise.all([
      reportProgress({
        phase: 'generating',
        label: '正在使用工具',
        detail: 'read_file',
        sessionId: 'child-private',
        rawEvent: { reasoning: 'must not persist' },
      }),
      reportProgress({
        phase: 'reviewing',
        label: '正在检查结果',
        prompt: 'private prompt',
        apiKey: 'private key',
        toolPayload: { output: 'private payload' },
      }),
    ])

    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'running',
      progress: {
        phase: 'reviewing',
        label: '正在检查结果',
        updatedAt: '2026-08-23T03:10:00.000Z',
      },
      progressEvents: [
        {
          sequence: 1,
          phase: 'generating',
          label: '正在使用工具',
          detail: 'read_file',
          occurredAt: '2026-08-23T03:10:00.000Z',
        },
        {
          sequence: 2,
          phase: 'reviewing',
          label: '正在检查结果',
          occurredAt: '2026-08-23T03:10:00.000Z',
        },
      ],
    })
    expect((await runStore.load('run-1')).progress).toEqual({
      phase: 'reviewing',
      label: '正在检查结果',
      updatedAt: '2026-08-23T03:10:00.000Z',
    })
    expect(JSON.stringify((await runStore.load('run-1')).progressEvents)).not.toMatch(
      /child-private|must not persist|private prompt|private key|private payload/,
    )

    finishModel({ outputText: '模型结果' })
    await settleRun(runStore, 'run-1')
    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'succeeded',
      progress: { phase: 'completed', label: '生成完成' },
      progressEvents: [
        expect.objectContaining({ sequence: 1, label: '正在使用工具' }),
        expect.objectContaining({ sequence: 2, label: '正在检查结果' }),
        expect.objectContaining({ sequence: 3, phase: 'completed', label: '生成完成' }),
      ],
    })
  })

  it('ignores progress that arrives after a Run reaches a terminal state', async () => {
    const { store, runStore } = await boardWithSources()
    let reportProgress
    let finishModel
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: ({ onProgress }) => new Promise((resolve) => {
        reportProgress = onProgress
        finishModel = resolve
      }),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:11:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })

    await handlers.startRun('board-1', created.transformation.id)
    await reportProgress({ phase: 'generating', label: '生成中' })
    finishModel({ outputText: '模型结果' })
    await settleRun(runStore, 'run-1')

    await reportProgress({ phase: 'reviewing', label: '迟到进度' })
    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'succeeded',
      progress: { phase: 'completed', label: '生成完成' },
      progressEvents: [
        expect.objectContaining({ sequence: 1, label: '生成中' }),
        expect.objectContaining({ sequence: 2, label: '生成完成' }),
      ],
    })
  })

  it('ignores progress that arrives after interrupt succeeds', async () => {
    const { store, runStore } = await boardWithSources()
    let reportProgress
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: ({ onProgress }) => new Promise(() => {
        reportProgress = onProgress
      }),
      newId: ids('target', 'transformation-1', 'run-1'),
      now: () => '2026-08-23T03:12:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })

    await handlers.startRun('board-1', created.transformation.id)
    await reportProgress({ phase: 'generating', label: '生成中' })
    await handlers.interruptRun('run-1')
    await reportProgress({ phase: 'reviewing', label: '迟到进度' })

    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'interrupted',
      progress: { phase: 'interrupted', label: '已停止' },
      progressEvents: [
        expect.objectContaining({ sequence: 1, label: '生成中' }),
        expect.objectContaining({ sequence: 2, label: '已停止' }),
      ],
    })
  })

  it('retries the terminal Run write without contradicting an applied Board version', async () => {
    const { store, runStore } = await boardWithSources()
    const save = runStore.save.getMockImplementation()
    let failTerminalWrite = true
    runStore.save.mockImplementation(async (run) => {
      if (run.status === 'succeeded' && failTerminalWrite) {
        failTerminalWrite = false
        throw new Error('transient run-store failure')
      }
      return save(run)
    })
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: vi.fn(async () => ({ outputText: '模型生成的方案' })),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T02:03:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '把材料变成方案',
      acceptance: '可编辑',
    })

    await handlers.startRun('board-1', created.transformation.id)
    const completed = await settleRun(runStore, 'run-1')

    expect(completed).toMatchObject({
      status: 'succeeded',
      result: { disposition: 'applied', appliedVersionId: 'target-ai-v1' },
    })
    expect(store.current().cards.find((card) => card.id === 'target')).toMatchObject({
      headVersionId: 'target-ai-v1',
    })
    expect(store.current().transformations[0]).toMatchObject({
      lastRunId: 'run-1',
      lastAppliedRunId: 'run-1',
    })
  })

  it('does not write model output to the Board when its safety persistence fails', async () => {
    const { store, runStore } = await boardWithSources()
    const save = runStore.save.getMockImplementation()
    runStore.save.mockImplementation(async (run) => {
      if (run.status === 'succeeded') {
        throw Object.assign(new Error('run disk unavailable'), { code: 'RUN_WRITE_FAILED' })
      }
      return save(run)
    })
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: vi.fn(async () => ({ outputText: '不能先写 Board 的结果' })),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:04:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })

    await handlers.startRun('board-1', created.transformation.id)
    await expect(settleRun(runStore, 'run-1')).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'RUN_WRITE_FAILED' },
    })
    expect(store.current().cards.find((card) => card.id === 'target')).toMatchObject({
      headVersionId: null,
      versions: [],
    })
    expect(store.current().transformations[0]).not.toHaveProperty('lastAppliedRunId')
  })

  it('retains full output as a Candidate when the Board write fails', async () => {
    const { store, runStore } = await boardWithSources()
    let finishModel
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: () => new Promise((resolve) => {
        finishModel = resolve
      }),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:05:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })
    await handlers.startRun('board-1', created.transformation.id)
    const boardWriteAttempted = deferred()
    store.update.mockImplementationOnce(async () => {
      boardWriteAttempted.resolve()
      throw Object.assign(new Error('board disk unavailable'), {
        code: 'BOARD_V2_WRITE_FAILED',
      })
    })

    finishModel({ outputText: '必须保住的候选结果' })
    await boardWriteAttempted.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'succeeded',
      result: { disposition: 'candidate', output: '必须保住的候选结果' },
    })
    expect(store.current().cards.find((card) => card.id === 'target')).toMatchObject({
      headVersionId: null,
      versions: [],
    })
  })

  it('keeps a recoverable Candidate when final applied persistence fails', async () => {
    const { store, runStore } = await boardWithSources()
    const save = runStore.save.getMockImplementation()
    const finalSaveFailed = deferred()
    let finalSaveAttempts = 0
    runStore.save.mockImplementation(async (run) => {
      if (run.status === 'succeeded' && run.result?.disposition === 'applied') {
        finalSaveAttempts += 1
        if (finalSaveAttempts === 3) finalSaveFailed.resolve()
        throw Object.assign(new Error('final Run write unavailable'), {
          code: 'RUN_WRITE_FAILED',
        })
      }
      return save(run)
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: vi.fn(async () => ({ outputText: '已写入 Board 的结果' })),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T03:06:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })

    try {
      await handlers.startRun('board-1', created.transformation.id)
      await finalSaveFailed.promise
      await new Promise((resolve) => setTimeout(resolve, 0))

      await expect(runStore.load('run-1')).resolves.toMatchObject({
        status: 'succeeded',
        result: { disposition: 'candidate', output: '已写入 Board 的结果' },
      })
      const committed = store.current().cards.find((card) => card.id === 'target')
      expect(committed).toMatchObject({ headVersionId: 'target-ai-v1' })
      expect(committed.versions).toHaveLength(1)
      expect(store.current().transformations[0].lastAppliedRunId).toBe('run-1')
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('remains a recoverable Candidate'),
        expect.objectContaining({ code: 'RUN_WRITE_FAILED' }),
      )

      runStore.save.mockImplementation(save)
      await handlers.adoptCandidate('run-1', { baseVersionId: 'target-ai-v1' })
      expect(store.current().cards.find((card) => card.id === 'target').versions).toHaveLength(1)
      await expect(runStore.load('run-1')).resolves.toMatchObject({
        result: { disposition: 'applied', appliedVersionId: 'target-ai-v1' },
      })
    } finally {
      errorLog.mockRestore()
    }
  })

  it('reconciles a persisted Candidate with its already committed version at boot', async () => {
    const board = editablePlanBoard()
    board.transformations[0] = {
      ...board.transformations[0],
      lastRunId: 'run-candidate',
    }
    delete board.transformations[0].lastAppliedRunId
    board.cards = board.cards.map((card) =>
      card.id === 'target'
        ? appendVersion(card, {
            baseVersionId: 'target-v1',
            versionId: 'target-ai-v2',
            content: { kind: 'markdown', markdown: '已经提交的模型结果' },
            origin: 'ai',
            sourceRunId: 'run-candidate',
            createdAt: '2026-08-23T03:07:00.000Z',
          })
        : card,
    )
    const store = memoryBoardStore(board)
    const runStore = memoryRunStore()
    await runStore.save(
      pendingCandidateRun({
        targetBaseVersionId: 'target-v1',
        result: {
          output: '已经提交的模型结果',
          digest: 'fnv1a:committed',
          disposition: 'candidate',
        },
      }),
    )
    const handlers = createV2Handlers({
      store,
      runStore,
      newId: ids(),
      now: () => '2026-08-23T03:08:00.000Z',
    })

    await expect(handlers.reconcileAppliedCandidates()).resolves.toEqual([
      expect.objectContaining({ id: 'run-candidate' }),
    ])
    await expect(handlers.reconcileAppliedCandidates()).resolves.toEqual([])
    expect(store.current().cards.find((card) => card.id === 'target').versions).toHaveLength(2)
    expect(store.current().transformations[0].lastAppliedRunId).toBe('run-candidate')
    await expect(runStore.load('run-candidate')).resolves.toMatchObject({
      result: { disposition: 'applied', appliedVersionId: 'target-ai-v2' },
    })
  })

  it.each([
    [
      'fails',
      async () => {
        throw Object.assign(new Error('private prompt api-key tool-payload'), {
          code: 'MODEL_EXECUTION_FAILED',
        })
      },
      async (_handlers, runStore) => settleRun(runStore, 'run-next'),
      'failed',
    ],
    [
      'is interrupted',
      () => new Promise(() => {}),
      async (handlers) => (await handlers.interruptRun('run-next')).run,
      'interrupted',
    ],
  ])(
    'keeps the previous applied Run when the latest attempt %s',
    async (_case, executeModel, finishAttempt, expectedStatus) => {
      const store = memoryBoardStore(editablePlanBoard())
      const runStore = memoryRunStore()
      const handlers = createV2Handlers({
        store,
        runStore,
        executeModel,
        newId: ids('run-next'),
        now: () => '2026-08-23T03:03:00.000Z',
      })

      await handlers.startRun('board-1', 'transformation-1')
      const completed = await finishAttempt(handlers, runStore)
      expect(completed).toMatchObject({
        status: expectedStatus,
        progress: {
          phase: expectedStatus,
          label: expectedStatus === 'failed' ? '生成未完成' : '已停止',
        },
      })
      expect(completed.progressEvents).toEqual([{
        sequence: 1,
        phase: expectedStatus,
        label: expectedStatus === 'failed' ? '生成未完成' : '已停止',
        occurredAt: '2026-08-23T03:03:00.000Z',
      }])
      expect(JSON.stringify(completed.progressEvents)).not.toMatch(
        /private prompt|api-key|tool-payload/,
      )
      expect(store.current().transformations[0]).toMatchObject({
        lastRunId: 'run-next',
        lastAppliedRunId: 'run-applied',
      })
    },
  )

  it('keeps a human edit and persists the completed model output as a candidate', async () => {
    const { store, runStore } = await boardWithSources()
    let finishModel
    const executeModel = vi.fn(
      () => new Promise((resolve) => {
        finishModel = resolve
      }),
    )
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel,
      newId: ids('target', 'transformation-1', 'run-1', 'human-v1', 'candidate-v2'),
      now: () => '2026-08-23T02:03:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '把材料变成方案',
      acceptance: '可编辑',
      targetPosition: { x: 520, y: 80 },
    })

    const started = await handlers.startRun('board-1', created.transformation.id, {})
    expect(started.run.targetBaseVersionId).toBe(null)
    expect(started.run.sourceSnapshot.map((item) => item.cardId)).toEqual(['card-a'])
    await handlers.commitCardVersion('board-1', 'target', {
      baseVersionId: null,
      markdown: '[人工决策-不可丢] 法务审批人：周岚。',
    })
    finishModel({ outputText: '模型生成的方案' })

    const completed = await settleRun(runStore, 'run-1')
    expect(completed.result).toMatchObject({
      output: '模型生成的方案',
      disposition: 'candidate',
    })
    expect(store.current().transformations[0]).not.toHaveProperty('lastAppliedRunId')
    expect(store.current().cards.find((card) => card.id === 'target').versions).toHaveLength(1)

    const adopted = await handlers.adoptCandidate('run-1', {
      baseVersionId: 'human-v1',
    })
    expect(adopted.card.headVersionId).toBe('candidate-v2')
    expect(adopted.card.versions[0].content.markdown).toContain('[人工决策-不可丢]')
    expect(adopted.card.versions[1].content.markdown).toBe('模型生成的方案')
    expect(store.current().transformations[0]).toMatchObject({
      lastRunId: 'run-1',
      lastAppliedRunId: 'run-1',
    })
  })

  it('allows only discard to succeed when adopt starts during the same candidate decision', async () => {
    const { store, runStore } = await boardWithSources()
    let finishModel
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: () => new Promise((resolve) => {
        finishModel = resolve
      }),
      newId: ids('target', 'transformation-1', 'run-1', 'human-v1', 'candidate-v2'),
      now: () => '2026-08-23T02:03:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '把材料变成方案',
      acceptance: '可编辑',
    })
    await handlers.startRun('board-1', created.transformation.id)
    await handlers.commitCardVersion('board-1', 'target', {
      baseVersionId: null,
      markdown: '人工版本',
    })
    finishModel({ outputText: '候选版本' })
    await settleRun(runStore, 'run-1')

    const discardSaveEntered = deferred()
    const releaseDiscardSave = deferred()
    const save = runStore.save.getMockImplementation()
    runStore.save.mockImplementation(async (run) => {
      if (run.result?.disposition === 'discarded') {
        discardSaveEntered.resolve()
        await releaseDiscardSave.promise
      }
      return save(run)
    })

    const discardPromise = handlers.discardCandidate('run-1')
    await discardSaveEntered.promise
    const adoptPromise = handlers.adoptCandidate('run-1', {
      baseVersionId: 'human-v1',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseDiscardSave.resolve()
    const outcomes = await Promise.allSettled([discardPromise, adoptPromise])

    expect(outcomes[0]).toMatchObject({ status: 'fulfilled' })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'RUN_CANDIDATE_REQUIRED' },
    })
    await expect(runStore.load('run-1')).resolves.toMatchObject({
      result: { disposition: 'discarded' },
    })
    expect(store.current().transformations[0]).not.toHaveProperty('lastAppliedRunId')
    expect(store.current().cards.find((card) => card.id === 'target')).toMatchObject({
      headVersionId: 'human-v1',
      versions: [expect.objectContaining({ id: 'human-v1' })],
    })
  })

  it('does not finalize a late model result after interrupt succeeds at the Board lock', async () => {
    const { store, runStore } = await boardWithSources()
    let finishModel
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: () => new Promise((resolve) => {
        finishModel = resolve
      }),
      newId: ids('target', 'transformation-1', 'run-1', 'target-ai-v1'),
      now: () => '2026-08-23T02:04:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案',
      instruction: '整理材料',
      acceptance: '',
    })
    await handlers.startRun('board-1', created.transformation.id)

    const boardUpdateEntered = deferred()
    const releaseBoardUpdate = deferred()
    const boardUpdateFinished = deferred()
    const update = store.update.getMockImplementation()
    store.update.mockImplementationOnce(async (...args) => {
      boardUpdateEntered.resolve()
      await releaseBoardUpdate.promise
      try {
        return await update(...args)
      } finally {
        boardUpdateFinished.resolve()
      }
    })

    finishModel({ outputText: '迟到的模型结果' })
    await boardUpdateEntered.promise
    const interruptPromise = handlers.interruptRun('run-1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseBoardUpdate.resolve()
    await boardUpdateFinished.promise
    const interrupted = await interruptPromise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(interrupted.run).toMatchObject({
      status: 'interrupted',
      error: { code: 'RUN_INTERRUPTED' },
    })
    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'interrupted',
      error: { code: 'RUN_INTERRUPTED' },
    })
    expect(store.current().cards.find((card) => card.id === 'target')).toMatchObject({
      headVersionId: null,
      versions: [],
    })
  })

  it('keeps an interrupted run terminal when the aborted model promise rejects later', async () => {
    const { store, runStore } = await boardWithSources()
    const handlers = createV2Handlers({
      store,
      runStore,
      executeModel: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('adapter aborted')))
      }),
      newId: ids('target', 'transformation-1', 'run-1'),
      now: () => '2026-08-23T02:04:00.000Z',
    })
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'card-a', versionId: 'card-a-v1' }],
      label: '形成方案', instruction: '整理材料', acceptance: '',
      targetPosition: { x: 520, y: 80 },
    })
    await handlers.startRun('board-1', created.transformation.id)
    await handlers.interruptRun('run-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(runStore.load('run-1')).resolves.toMatchObject({
      status: 'interrupted', error: { code: 'RUN_INTERRUPTED' },
    })
    expect(store.current().transformations[0]).not.toHaveProperty('lastAppliedRunId')
  })

  it('deletes an unused empty card but protects transformation history', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('empty', 'used', 'used-v1', 'target', 'transformation-1'),
      newRestoreReceiptId: ids('restore-empty'),
    })
    await handlers.createCard('board-1', { x: 0, y: 0, markdown: '' })
    await handlers.createCard('board-1', { x: 0, y: 0, markdown: '来源' })
    await handlers.deleteCard('board-1', 'empty')
    const created = await handlers.createTransformation('board-1', {
      sourceRefs: [{ cardId: 'used', versionId: 'used-v1' }],
      label: '结果', instruction: '生成结果', acceptance: '', targetPosition: { x: 400, y: 0 },
    })

    expect(store.current().cards.map((card) => card.id)).toEqual(['used', 'target'])
    await expect(handlers.deleteCard('board-1', created.targetCard.id)).rejects.toMatchObject({ code: 'CARD_IN_USE' })
  })

  it('creates a card with normalized tags and independent inspiration provenance', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('idea', 'idea-v1'),
      now: () => '2026-08-23T02:01:00.000Z',
    })
    const inspirationRef = {
      boardId: 'pool-board',
      cardId: 'pool-card',
      versionId: 'pool-card-v3',
    }

    const { card: created } = await handlers.createCard('board-1', {
      contentKind: 'markdown',
      markdown: '一个可继续推进的主意',
      tags: [' 主意 ', 'NewTech'],
      inspirationRef,
      x: 10,
      y: 20,
    })

    expect(created).toMatchObject({
      id: 'idea',
      tags: ['主意', 'NewTech'],
      inspirationRef,
      headVersionId: 'idea-v1',
    })
    expect(created.versions).toHaveLength(1)
    expect(created.versions[0]).toMatchObject({ origin: 'human' })
    expect(store.current().cards).toEqual([created])
  })

  it('creates and moves card groups atomically', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('copy-a', 'copy-a-v1', 'copy-b', 'copy-b-v1'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    const created = await handlers.createCards('board-1', {
      cards: [
        {
          contentKind: 'markdown', markdown: 'A', tags: ['主意'],
          inspirationRef: { boardId: 'pool', cardId: 'source-a', versionId: 'source-a-v2' },
          x: 10, y: 20, width: 300, height: 180,
        },
        {
          contentKind: 'file-reference', filePath: 'docs/b.md', readonly: true,
          tags: ['技术', '事件'],
          inspirationRef: { boardId: 'pool', cardId: 'source-b', versionId: 'source-b-v1' },
          x: 400, y: 220, width: 280, height: 160,
        },
      ],
    })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(created.cards.map((card) => card.id)).toEqual(['copy-a', 'copy-b'])
    expect(created.cards[0].versions).toHaveLength(1)
    expect(created.cards[1].versions[0].content).toEqual({
      kind: 'file-reference', path: 'docs/b.md', readonly: true,
    })
    expect(created.cards.map(({ tags, inspirationRef }) => ({ tags, inspirationRef }))).toEqual([
      {
        tags: ['主意'],
        inspirationRef: { boardId: 'pool', cardId: 'source-a', versionId: 'source-a-v2' },
      },
      {
        tags: ['技术', '事件'],
        inspirationRef: { boardId: 'pool', cardId: 'source-b', versionId: 'source-b-v1' },
      },
    ])

    store.update.mockClear()
    const moved = await handlers.updateCards('board-1', {
      updates: [
        { cardId: 'copy-a', x: 60, y: 70 },
        { cardId: 'copy-b', x: 450, y: 270 },
      ],
    })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(moved.cards.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: 'copy-a', x: 60, y: 70 },
      { id: 'copy-b', x: 450, y: 270 },
    ])
  })

  it.each([
    ['invalid tags', {
      tags: ['Idea', 'idea'],
      inspirationRef: { boardId: 'pool', cardId: 'source-b', versionId: 'source-b-v1' },
    }],
    ['an invalid inspiration reference', {
      tags: ['主意'],
      inspirationRef: { boardId: '', cardId: 'source-b', versionId: 'source-b-v1' },
    }],
  ])('rejects an entire inspiration batch containing %s before writing', async (_case, invalid) => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('copy-a', 'copy-a-v1', 'copy-b', 'copy-b-v1'),
    })

    await expect(handlers.createCards('board-1', {
      cards: [
        { contentKind: 'markdown', markdown: 'valid', tags: ['约束'], x: 10, y: 20 },
        { contentKind: 'markdown', markdown: 'invalid', ...invalid, x: 400, y: 20 },
      ],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
    expect(store.current().cards).toEqual([])
  })

  it('patches tags without appending a Version or changing the current Head', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    const inspirationRef = {
      boardId: 'pool-board', cardId: 'pool-card', versionId: 'pool-card-v1',
    }
    const original = {
      ...markdownCard('idea', '保留正文'),
      tags: ['主意'],
      inspirationRef,
    }
    canvas.cards.push(original)
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      now: () => '2026-08-23T02:05:00.000Z',
    })

    const { card: updated } = await handlers.updateCard('board-1', 'idea', {
      tags: [' 约束 ', '事件'],
    })

    expect(updated.tags).toEqual(['约束', '事件'])
    expect(updated.inspirationRef).toEqual(inspirationRef)
    expect(updated.headVersionId).toBe(original.headVersionId)
    expect(updated.versions).toEqual(original.versions)
    expect(store.current().cards).toEqual([updated])
  })

  it('preflights a card group deletion and never deletes only the free subset', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    canvas.cards.push(
      markdownCard('free', '可删除'),
      markdownCard('source', '来源'),
      markdownCard('target', '成果'),
    )
    canvas.transformations.push({
      id: 'transformation-1', sourceCardIds: ['source'], targetCardId: 'target',
      label: '成果', instruction: '形成成果', acceptance: '',
      permissions: { workspaceWrite: false },
      createdAt: '2026-08-23T02:00:00.000Z', updatedAt: '2026-08-23T02:00:00.000Z',
    })
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids('restore-free'),
    })

    await expect(handlers.deleteCards('board-1', { cardIds: ['free', 'source'] }))
      .rejects.toMatchObject({ code: 'CARD_IN_USE' })
    expect(store.current().cards.map((card) => card.id)).toEqual(['free', 'source', 'target'])

    await handlers.deleteCards('board-1', { cardIds: ['free'] })
    expect(store.current().cards.map((card) => card.id)).toEqual(['source', 'target'])
  })

  it('restores deleted cards with their identity and full version history intact', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    const deleted = markdownCard('draft', '第一版')
    deleted.versions.push({
      ...deleted.versions[0],
      id: 'draft-v2',
      sequence: 2,
      content: { kind: 'markdown', markdown: '第二版' },
    })
    deleted.headVersionId = 'draft-v2'
    canvas.cards.push(deleted)
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids('restore-draft'),
    })

    await expect(handlers.restoreCards('board-1', { restoreReceiptId: 'forged' }))
      .rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    const deletion = await handlers.deleteCards('board-1', { cardIds: ['draft'] })
    expect(deletion).toEqual({
      deletedCardIds: ['draft'],
      restoreReceiptId: 'restore-draft',
      groups: [],
    })
    await expect(handlers.restoreCards('board-1', {
      restoreReceiptId: deletion.restoreReceiptId,
    }))
      .resolves.toEqual({ cards: [deleted], groups: [] })
    expect(store.current().cards).toEqual([deleted])

    store.update.mockClear()
    await expect(handlers.restoreCards('board-1', {
      restoreReceiptId: deletion.restoreReceiptId,
    }))
      .rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    expect(store.update).not.toHaveBeenCalled()
    expect(store.current().cards).toEqual([deleted])
  })

  it('retains restore capacity by deletion batch instead of card count', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    canvas.cards = Array.from({ length: 600 }, (_, index) =>
      markdownCard(`card-${index}`, `内容 ${index}`))
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids(...Array.from({ length: 6 }, (_, index) => `receipt-${index}`)),
    })
    const receipts = []

    for (let batch = 0; batch < 6; batch += 1) {
      const cardIds = Array.from({ length: 100 }, (_, index) => `card-${batch * 100 + index}`)
      receipts.push((await handlers.deleteCards('board-1', { cardIds })).restoreReceiptId)
    }

    await expect(handlers.restoreCards('board-1', {
      restoreReceiptId: receipts[0],
    })).resolves.toMatchObject({ cards: expect.arrayContaining([
      expect.objectContaining({ id: 'card-0' }),
      expect.objectContaining({ id: 'card-99' }),
    ]) })
    expect(store.current().cards).toHaveLength(100)
  })

  it('keeps only the latest 50 deletion batches for each board', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    canvas.cards = Array.from({ length: 51 }, (_, index) => markdownCard(`card-${index}`, `${index}`))
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids(...Array.from({ length: 51 }, (_, index) => `receipt-${index}`)),
    })
    const receipts = []

    for (let index = 0; index < 51; index += 1) {
      receipts.push((await handlers.deleteCard('board-1', `card-${index}`)).restoreReceiptId)
    }

    await expect(handlers.restoreCards('board-1', { restoreReceiptId: receipts[0] }))
      .rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    await expect(handlers.restoreCards('board-1', { restoreReceiptId: receipts[1] }))
      .resolves.toMatchObject({ cards: [expect.objectContaining({ id: 'card-1' })] })
  })

  it('scopes restore receipts to the board where deletion occurred', async () => {
    const boardA = emptyBoardV2('board-a', 'A', '2026-08-23T02:00:00.000Z')
    const boardB = emptyBoardV2('board-b', 'B', '2026-08-23T02:00:00.000Z')
    boardA.cards.push(markdownCard('card-a', 'A'))
    boardB.cards.push(markdownCard('card-b', 'B'))
    const store = memoryBoardsStore([boardA, boardB])
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids('receipt-a'),
    })
    const deletion = await handlers.deleteCard('board-a', 'card-a')

    await expect(handlers.restoreCards('board-b', {
      restoreReceiptId: deletion.restoreReceiptId,
    })).rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    await expect(handlers.restoreCards('board-a', {
      restoreReceiptId: deletion.restoreReceiptId,
    })).resolves.toMatchObject({ cards: [expect.objectContaining({ id: 'card-a' })] })
    expect(store.current('board-b').cards).toEqual([markdownCard('card-b', 'B')])
  })

  it('does not accept a receipt after handler restart or while a card id conflicts', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    const deleted = markdownCard('draft', '原文')
    canvas.cards.push(deleted)
    const store = memoryBoardStore(canvas)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
      newRestoreReceiptId: ids('restore-draft'),
    })
    const deletion = await handlers.deleteCard('board-1', 'draft')
    const restarted = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids(),
    })

    await expect(restarted.restoreCards('board-1', {
      restoreReceiptId: deletion.restoreReceiptId,
    })).rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })

    await store.update('board-1', async (board) => {
      board.cards.push(markdownCard('draft', '占用 ID'))
      return board
    })
    store.update.mockClear()
    await expect(handlers.restoreCards('board-1', {
      restoreReceiptId: deletion.restoreReceiptId,
    })).rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    expect(store.update).toHaveBeenCalledOnce()
    expect(store.current().cards).toEqual([markdownCard('draft', '占用 ID')])
  })

  it('resolves the current file-reference Head for the content reader', async () => {
    const canvas = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    const store = memoryBoardStore(canvas)
    const readFileContent = vi.fn(async () => '# 完整材料\n\n正文')
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      readFileContent,
      newId: ids('file-card', 'file-version'),
    })
    await handlers.createCard('board-1', {
      filePath: 'docs/source.md', readonly: true, x: 0, y: 0,
    })

    await expect(handlers.readCardContent('board-1', 'file-card')).resolves.toEqual({
      cardId: 'file-card',
      versionId: 'file-version',
      contentKind: 'file-reference',
      path: 'docs/source.md',
      content: '# 完整材料\n\n正文',
    })
    expect(readFileContent).toHaveBeenCalledWith('docs/source.md')
  })

  it('rejects malformed card groups before writing the board', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCards('board-1', { cards: [] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.updateCards('board-1', {
      updates: [{ cardId: 'missing', x: 20 }, { cardId: 'missing', y: 30 }],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.deleteCards('board-1', { cardIds: ['missing', 'missing'] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('rejects unsupported automatic card placement before writing the board', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '不应创建',
      placement: 'sideways',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('rejects automatic placement mixed with explicit coordinates', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '不应创建',
      placement: 'board-bottom',
      x: 0,
      y: 0,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('rejects invalid board-bottom capture content before writing the board', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '  \n ',
      placement: 'board-bottom',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.createCard('board-1', {
      contentKind: 'file-reference',
      filePath: 'docs/evidence.md',
      placement: 'board-bottom',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('normalizes board-bottom capture content and owns its geometry', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '灵感池', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('captured', 'captured-v1'),
      now: () => '2026-08-23T02:01:00.000Z',
    })

    const { card } = await handlers.createCard('board-1', {
      contentKind: 'markdown',
      markdown: '  需要保留的灵感  ',
      tags: [' 主意 '],
      placement: 'board-bottom',
    })

    expect(card).toMatchObject({
      id: 'captured',
      contentKind: 'markdown',
      tags: ['主意'],
      x: 0,
      y: 0,
      width: 312,
      height: 208,
      headVersionId: 'captured-v1',
    })
    expect(card).not.toHaveProperty('inspirationRef')
    expect(card.versions).toEqual([
      expect.objectContaining({
        origin: 'human',
        content: { kind: 'markdown', markdown: '需要保留的灵感' },
      }),
    ])
  })

  it('rejects client geometry or provenance on board-bottom capture', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '不应创建',
      placement: 'board-bottom',
      width: 1,
      height: -10,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(handlers.createCard('board-1', {
      markdown: '不应创建',
      placement: 'board-bottom',
      inspirationRef: { boardId: 'source', cardId: 'card', versionId: 'version' },
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('fails closed when existing card geometry cannot support board-bottom placement', async () => {
    const broken = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    broken.cards.push({ ...markdownCard('broken', '已有内容'), height: -20 })
    const store = memoryBoardStore(broken)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '不应覆盖已有卡片',
      placement: 'board-bottom',
    })).rejects.toMatchObject({ code: 'BOARD_V2_INVALID' })
    expect(store.current().cards).toHaveLength(1)
  })

  it('fails closed when finite card geometry overflows while computing its bottom', async () => {
    const broken = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    broken.cards.push({
      ...markdownCard('overflow', '已有内容'),
      y: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
    })
    const store = memoryBoardStore(broken)
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCard('board-1', {
      markdown: '不应回退到原点',
      placement: 'board-bottom',
    })).rejects.toMatchObject({ code: 'BOARD_V2_INVALID' })
    expect(store.current().cards).toHaveLength(1)
  })

  it('places capture below the actual bottom of an all-negative board', async () => {
    const source = emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z')
    source.cards.push({ ...markdownCard('negative', '已有内容'), y: -1000, height: 208 })
    const store = memoryBoardStore(source)
    const handlers = createV2Handlers({
      store,
      runStore: memoryRunStore(),
      newId: ids('captured', 'captured-v1'),
    })

    const { card } = await handlers.createCard('board-1', {
      markdown: '紧接实际底部',
      placement: 'board-bottom',
    })

    expect(card).toMatchObject({ x: 0, y: -760, width: 312, height: 208 })
  })

  it('rejects automatic placement in a card batch before writing the board', async () => {
    const store = memoryBoardStore(emptyBoardV2('board-1', '课题', '2026-08-23T02:00:00.000Z'))
    const handlers = createV2Handlers({ store, runStore: memoryRunStore(), newId: ids() })

    await expect(handlers.createCards('board-1', {
      cards: [{ markdown: '不应创建', placement: 'board-bottom' }],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })
})
