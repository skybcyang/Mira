import { describe, expect, it, vi } from 'vitest'
import * as main from '../../bridge/main.js'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
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
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
      files.delete(path)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

describe('host-neutral Mira application', () => {
  it('injects one storage coordinator into all managed stores', () => {
    const stores = main.createMiraStores({ fs: memoryFs() })

    expect(stores.coordinator).toBeDefined()
    expect(stores.boardStore.coordinator).toBe(stores.coordinator)
    expect(stores.runStore.coordinator).toBe(stores.coordinator)
    expect(stores.workflowStore.coordinator).toBe(stores.coordinator)
    expect(stores.inspirationPoolStore.coordinator).toBe(stores.coordinator)
    expect(stores.checkpointStore.coordinator).toBe(stores.coordinator)
  })

  it('supports injected stores through explicit public fs and coordinator dependencies', async () => {
    const fs = memoryFs()
    const managed = main.createMiraStores({ fs })
    const stores = {
      boardStore: managed.boardStore,
      runStore: managed.runStore,
      workflowStore: managed.workflowStore,
      inspirationPoolStore: managed.inspirationPoolStore,
    }

    const application = main.createMiraApplication({
      fs,
      coordinator: managed.coordinator,
      stores,
    })

    await expect(application.ready).resolves.toMatchObject({
      imported: { recoveredTransactionIds: [] },
      reconciled: [],
      interrupted: [],
    })
  })

  it('rejects injected stores whose coordinator differs from the supplied atomic boundary', () => {
    const fs = memoryFs()
    const left = main.createMiraStores({ fs })
    const right = main.createMiraStores({ fs })

    expect(() => main.createMiraApplication({
      fs,
      coordinator: left.coordinator,
      stores: {
        boardStore: left.boardStore,
        runStore: right.runStore,
        workflowStore: left.workflowStore,
        inspirationPoolStore: left.inspirationPoolStore,
      },
    })).toThrow('Mira stores must share the supplied storage coordinator')
  })

  it('recovers import journals before Candidate and active Run recovery', async () => {
    const fs = memoryFs()
    const operations = []
    const listJson = fs.listJson.bind(fs)
    fs.listJson = async (dir) => {
      operations.push(`list:${dir}`)
      return listJson(dir)
    }
    const stores = main.createMiraStores({ fs })
    const listRuns = stores.runStore.list.bind(stores.runStore)
    stores.runStore.list = async () => {
      operations.push('reconcile-runs')
      return listRuns()
    }
    const markBootInterrupted = stores.runStore.markBootInterrupted.bind(stores.runStore)
    stores.runStore.markBootInterrupted = async (...args) => {
      operations.push('interrupt-runs')
      return markBootInterrupted(...args)
    }
    const onRecovery = vi.fn()

    const application = main.createMiraApplication({ fs, stores, onRecovery })
    await application.ready

    expect(operations.indexOf('list:transactions-v2')).toBeGreaterThanOrEqual(0)
    expect(operations.indexOf('list:transactions-v2')).toBeLessThan(
      operations.indexOf('reconcile-runs'),
    )
    expect(onRecovery).toHaveBeenCalledWith({
      imported: { recoveredTransactionIds: [] },
      reconciled: [],
      interrupted: [],
    })
  })

  it('fails startup with an import-specific code before touching Run recovery', async () => {
    const fs = memoryFs()
    const listJson = fs.listJson.bind(fs)
    fs.listJson = async (dir) => {
      if (dir === 'transactions-v2') throw new Error('journal directory failed')
      return listJson(dir)
    }
    const stores = main.createMiraStores({ fs })
    const markBootInterrupted = vi.spyOn(stores.runStore, 'markBootInterrupted')

    const application = main.createMiraApplication({ fs, stores })

    await expect(application.ready).rejects.toMatchObject({
      code: 'BOARD_IMPORT_RECOVERY_FAILED',
    })
    expect(markBootInterrupted).not.toHaveBeenCalled()
    await expect(application.dispatch('GET', ['v2', 'boards'])).rejects.toMatchObject({
      code: 'BOARD_IMPORT_RECOVERY_FAILED',
    })
  })

  it('serves the v2 board API with storage alone', async () => {
    expect(main.createMiraApplication).toBeTypeOf('function')

    const application = main.createMiraApplication({
      fs: memoryFs(),
      newId: () => 'board-standalone',
      now: () => '2026-08-24T01:00:00.000Z',
    })

    const created = await application.dispatch('POST', ['v2', 'boards'], {
      title: 'Standalone board',
    })
    const listed = await application.dispatch('GET', ['v2', 'boards'])

    expect(created).toMatchObject({
      status: 201,
      body: { boardId: 'board-standalone', board: { title: 'Standalone board' } },
    })
    expect(listed).toEqual({
      status: 200,
      body: { boards: [{
        id: 'board-standalone',
        title: 'Standalone board',
        state: 'active',
        revision: 0,
        updatedAt: '2026-08-24T01:00:00.000Z',
      }] },
    })
  })

  it('creates, lists, reads, renames, exports, forks, and deletes Board checkpoints', async () => {
    const fs = memoryFs()
    const ids = ['board-1', 'checkpoint-1', 'board-copy', 'import-transaction-1']
    const application = main.createMiraApplication({
      fs,
      newId: () => ids.shift(),
      now: () => '2026-09-05T08:00:00.000Z',
    })
    await application.dispatch('POST', ['v2', 'boards'], { title: '原画板' })

    const created = await application.dispatch(
      'POST', ['v2', 'boards', 'board-1', 'checkpoints'],
      { title: ' 第一稿 ', note: ' 稳定 ', baseRevision: 0 },
    )
    const listed = await application.dispatch(
      'GET', ['v2', 'boards', 'board-1', 'checkpoints'],
    )
    const read = await application.dispatch(
      'GET', ['v2', 'boards', 'board-1', 'checkpoints', 'checkpoint-1'],
    )
    const updated = await application.dispatch(
      'PATCH', ['v2', 'boards', 'board-1', 'checkpoints', 'checkpoint-1'],
      { title: '定稿', baseMetadataUpdatedAt: created.body.checkpoint.metadataUpdatedAt },
    )
    const exported = await application.dispatch(
      'GET', ['v2', 'boards', 'board-1', 'checkpoints', 'checkpoint-1', 'export'],
    )
    const forked = await application.dispatch(
      'POST', ['v2', 'boards', 'board-1', 'checkpoints', 'checkpoint-1', 'forks'],
      { title: '版本副本' },
    )
    const removed = await application.dispatch(
      'DELETE', ['v2', 'boards', 'board-1', 'checkpoints', 'checkpoint-1'],
      { confirmation: 'delete-checkpoint' },
    )

    expect(created).toMatchObject({ status: 201, body: { checkpoint: { title: '第一稿', note: '稳定' } } })
    expect(listed).toMatchObject({ body: { checkpoints: [{ id: 'checkpoint-1', counts: { cards: 0 } }] } })
    expect(read.body.checkpoint.artifact.board.id).toBe('board-1')
    expect(updated.body.checkpoint.title).toBe('定稿')
    expect(exported.body).toMatchObject({ format: 'mira-board', board: { id: 'board-1' } })
    expect(forked).toMatchObject({ status: 201, body: { boardId: 'board-copy', board: { title: '版本副本' } } })
    expect(removed.body).toEqual({ deletedCheckpointId: 'checkpoint-1' })
    await expect(application.checkpointStore.listSummaries('board-1')).resolves.toEqual([])
  })

  it('routes file binding through the host-neutral application', async () => {
    const fs = memoryFs()
    const ids = ['board-1', 'card-1', 'card-1-v1', 'file-sync-temp', 'card-1-v2']
    const application = main.createMiraApplication({
      fs,
      newId: () => ids.shift(),
      now: () => '2026-09-03T09:00:00.000Z',
    })
    await application.ready
    const createdBoard = await application.dispatch('POST', ['v2', 'boards'], { title: '绑定测试' })
    const boardId = createdBoard.body.boardId
    const createdCard = await application.dispatch('POST', ['v2', 'boards', boardId, 'cards'], {
      x: 0,
      y: 0,
      markdown: '第一版',
    })
    const cardId = createdCard.body.card.id
    fs.files.set('docs/spec.md', '第一版')

    const bound = await application.dispatch('PUT', [
      'v2', 'boards', boardId, 'cards', cardId, 'file-binding',
    ], { path: 'docs/spec.md' })
    const edited = await application.dispatch('POST', [
      'v2', 'boards', boardId, 'cards', cardId, 'versions',
    ], { baseVersionId: 'card-1-v1', markdown: '第二版' })
    const status = await application.dispatch('GET', [
      'v2', 'boards', boardId, 'cards', cardId, 'file-binding',
    ])

    expect(bound.status).toBe(200)
    expect(edited.body.fileSync.status).toBe('synced')
    expect(fs.files.get('docs/spec.md')).toBe('第二版')
    expect(status.body.status).toBe('synced')
  })

  it('exports a Board and immediately imports the same artifact into independent copies', async () => {
    const fs = memoryFs()
    const counts = new Map()
    const application = main.createMiraApplication({
      fs,
      newId: (prefix) => {
        const next = (counts.get(prefix) || 0) + 1
        counts.set(prefix, next)
        return `${prefix}-${next}`
      },
      now: () => '2026-09-02T10:00:00.000Z',
    })
    const created = await application.dispatch('POST', ['v2', 'boards'], { title: '可移植课题' })
    const exported = await application.dispatch(
      'GET', ['v2', 'boards', created.body.boardId, 'export'],
    )

    const first = await application.dispatch(
      'POST', ['v2', 'boards', 'imports'], { artifact: exported.body },
    )
    const second = await application.dispatch(
      'POST', ['v2', 'boards', 'imports'], { artifact: exported.body },
    )

    expect(exported).toMatchObject({
      status: 200,
      body: { format: 'mira-board', formatVersion: 1, board: { id: 'board-1' } },
    })
    expect(first).toMatchObject({
      status: 201,
      body: {
        boardId: 'board-2',
        board: { id: 'board-2', revision: 0, lifecycle: { state: 'active' } },
      },
    })
    expect(second.body.boardId).toBe('board-3')
    expect(new Set([created.body.boardId, first.body.boardId, second.body.boardId]).size).toBe(3)
    await expect(application.boardStore.list()).resolves.toHaveLength(3)
    await expect(application.runStore.listStrict()).resolves.toEqual([])
    await expect(application.workflowStore.listStrict()).resolves.toEqual([])
  })

  it('rejects an invalid artifact before any Board, Run, or Workflow becomes visible', async () => {
    const fs = memoryFs()
    const application = main.createMiraApplication({ fs })

    await expect(application.dispatch(
      'POST',
      ['v2', 'boards', 'imports'],
      { artifact: { format: 'mira-board', formatVersion: 999 } },
    )).rejects.toMatchObject({ code: 'BOARD_IMPORT_INVALID' })

    await expect(application.boardStore.list()).resolves.toEqual([])
    await expect(application.runStore.listStrict()).resolves.toEqual([])
    await expect(application.workflowStore.listStrict()).resolves.toEqual([])
    expect([...fs.files.keys()].filter((path) => path.endsWith('.stage'))).toEqual([])
  })

  it('persists a direct plan through the real v2 dispatch without creating runs', async () => {
    const fs = memoryFs()
    const counts = new Map()
    const application = main.createMiraApplication({
      fs,
      newId: (prefix) => {
        const next = (counts.get(prefix) || 0) + 1
        counts.set(prefix, next)
        return `${prefix}-${next}`
      },
      now: () => '2026-08-31T01:00:00.000Z',
    })
    const createdBoard = await application.dispatch('POST', ['v2', 'boards'], {
      title: 'Direct plan board',
    })
    const boardId = createdBoard.body.boardId
    const createdSource = await application.dispatch(
      'POST',
      ['v2', 'boards', boardId, 'cards'],
      { x: 40, y: 80, markdown: '# 研究材料' },
    )
    const source = createdSource.body.card

    const createdPlan = await application.dispatch(
      'POST',
      ['v2', 'boards', boardId, 'plans'],
      {
        title: '材料到判断',
        sourceRefs: [{ cardId: source.id, versionId: source.headVersionId }],
        steps: [
          { label: '提炼证据', instruction: '提炼关键证据', acceptance: '' },
          { label: '形成判断', instruction: '形成可追溯判断', acceptance: '' },
        ],
        targetPosition: { x: 520, y: 80 },
      },
    )
    const persisted = await application.dispatch('GET', ['v2', 'boards', boardId])

    expect(createdPlan).toMatchObject({
      status: 201,
      body: {
        title: '材料到判断',
        targetCards: [{ headVersionId: null }, { headVersionId: null }],
        transformations: [
          { planRef: { source: 'ad-hoc', stepIndex: 1, stepTotal: 2 } },
          { planRef: { source: 'ad-hoc', stepIndex: 2, stepTotal: 2 } },
        ],
      },
    })
    expect(persisted.body.board.cards).toHaveLength(3)
    expect(persisted.body.board.transformations).toHaveLength(2)
    expect([...fs.files.keys()].some((path) => path.startsWith('runs-v2/'))).toBe(false)
  })
})
