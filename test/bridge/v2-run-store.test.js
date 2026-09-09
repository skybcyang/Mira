import { describe, expect, it } from 'vitest'
import { createV2RunStore } from '../../bridge/v2-run-store.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      files.set(to, files.get(from))
      files.delete(from)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

describe('v2 run store', () => {
  it('serializes operations on one Run and supplies the latest persisted state', async () => {
    const store = createV2RunStore(memoryFs())
    await store.save({
      id: 'run-1',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'succeeded',
      result: { disposition: 'candidate', output: '候选结果' },
    })
    let releaseFirst
    const firstMayFinish = new Promise((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted
    const firstDidStart = new Promise((resolve) => {
      firstStarted = resolve
    })

    const first = store.withLockedRun('run-1', async (run) => {
      firstStarted()
      await firstMayFinish
      const discarded = {
        ...run,
        result: { ...run.result, disposition: 'discarded' },
      }
      await store.save(discarded)
      return discarded
    })
    await firstDidStart
    const second = store.withLockedRun('run-1', async (run) => run.result.disposition)
    releaseFirst()

    await expect(first).resolves.toMatchObject({ result: { disposition: 'discarded' } })
    await expect(second).resolves.toBe('discarded')
  })

  it('atomically starts only one active run for a board target', async () => {
    const store = createV2RunStore(memoryFs())
    const outcomes = await Promise.allSettled([
      store.start({
        id: 'run-a',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
      store.start({
        id: 'run-b',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason).toMatchObject({
      code: 'TARGET_BUSY',
    })
    expect(await store.list()).toHaveLength(1)
  })

  it('rejects a new claim while the board target has an unresolved Candidate', async () => {
    const store = createV2RunStore(memoryFs())
    await store.save({
      id: 'run-candidate',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'succeeded',
      result: { disposition: 'candidate', output: '待处理结果' },
    })

    await expect(
      store.start({
        id: 'run-next',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_PENDING' })
    expect((await store.list()).map((run) => run.id)).toEqual(['run-candidate'])
  })

  it.each(['applied', 'discarded'])(
    'releases the board target after its Candidate becomes %s',
    async (disposition) => {
      const store = createV2RunStore(memoryFs())
      const candidate = {
        id: 'run-candidate',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'succeeded',
        result: { disposition: 'candidate', output: '待处理结果' },
      }
      await store.save(candidate)
      await store.save({
        ...candidate,
        result: { ...candidate.result, disposition },
      })

      await expect(
        store.start({
          id: 'run-next',
          boardId: 'board-1',
          targetCardId: 'target-1',
          status: 'running',
        }),
      ).resolves.toMatchObject({ id: 'run-next' })
    },
  )

  it('does not let a Candidate on another board or target block a claim', async () => {
    const store = createV2RunStore(memoryFs())
    await store.save({
      id: 'run-candidate',
      boardId: 'board-other',
      targetCardId: 'target-1',
      status: 'succeeded',
      result: { disposition: 'candidate', output: '待处理结果' },
    })

    await expect(
      store.start({
        id: 'run-next',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    ).resolves.toMatchObject({ id: 'run-next' })
  })

  it('shares the board-target lock between explicit mutations and Run claims', async () => {
    const store = createV2RunStore(memoryFs())
    let releaseMutation
    const mutationMayFinish = new Promise((resolve) => {
      releaseMutation = resolve
    })
    let mutationStarted
    const mutationDidStart = new Promise((resolve) => {
      mutationStarted = resolve
    })
    let startSettled = false

    const mutation = store.withTargetLock('board-1', 'target-1', async () => {
      mutationStarted()
      await mutationMayFinish
      return 'mutated'
    })
    await mutationDidStart
    const start = store
      .start({
        id: 'run-after-mutation',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      })
      .finally(() => {
        startSettled = true
      })
    await Promise.resolve()
    await Promise.resolve()

    expect(startSettled).toBe(false)
    releaseMutation()
    await expect(mutation).resolves.toBe('mutated')
    await expect(start).resolves.toMatchObject({ id: 'run-after-mutation' })
  })

  it('reuses an explicit Board mutation lease when starting a Run with a snapshot queued', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const store = createV2RunStore(fs, 'runs-v2', { coordinator })
    let continueBoard
    const mayContinue = new Promise((resolve) => {
      continueBoard = resolve
    })
    let boardStarted
    const didStart = new Promise((resolve) => {
      boardStarted = resolve
    })
    const events = []

    const boardMutation = coordinator.withMutation((mutationLease) =>
      coordinator.withBoard('board-1', mutationLease, async (boardLease) => {
        events.push('board:start')
        boardStarted()
        await mayContinue
        await store.start({
          id: 'run-new',
          boardId: 'board-1',
          targetCardId: 'target-1',
          status: 'running',
        }, boardLease)
        events.push('board:end')
      }))
    await didStart
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot')
    })
    continueBoard()

    const timeout = new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50))
    await expect(Promise.race([
      Promise.all([boardMutation, snapshot]).then(() => 'completed'),
      timeout,
    ])).resolves.toBe('completed')
    expect(events).toEqual(['board:start', 'board:end', 'snapshot'])
  })

  it('scopes active run claims by both board and target card', async () => {
    const store = createV2RunStore(memoryFs())

    await store.start({
      id: 'run-board-1',
      boardId: 'board-1',
      targetCardId: 'shared-target-id',
      status: 'running',
    })
    await expect(
      store.start({
        id: 'run-board-2',
        boardId: 'board-2',
        targetCardId: 'shared-target-id',
        status: 'running',
      }),
    ).resolves.toMatchObject({ id: 'run-board-2' })
  })

  it.each(['succeeded', 'failed', 'interrupted'])(
    'releases the board target after a run becomes %s',
    async (terminalStatus) => {
      const store = createV2RunStore(memoryFs())
      const active = {
        id: 'run-active',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }
      await store.start(active)
      await store.save({
        ...active,
        status: terminalStatus,
        ...(terminalStatus === 'succeeded'
          ? { result: { disposition: 'applied', output: '已采用结果' } }
          : {}),
      })

      await expect(
        store.start({
          id: 'run-next',
          boardId: 'board-1',
          targetCardId: 'target-1',
          status: 'running',
        }),
      ).resolves.toMatchObject({ id: 'run-next' })
    },
  )

  it('persists immutable identifiers and interrupts active runs after restart', async () => {
    const store = createV2RunStore(memoryFs(), 'runs-v2', {
      now: () => '2026-08-23T03:00:00.000Z',
    })
    await store.save({
      id: 'done',
      boardId: 'board-1',
      targetCardId: 'target-done',
      status: 'succeeded',
      result: { disposition: 'applied', output: '完成结果' },
    })
    await store.save({
      id: 'active',
      boardId: 'board-1',
      targetCardId: 'target-active',
      status: 'running',
    })

    const recovered = await store.markBootInterrupted()

    expect(recovered.map((run) => run.id)).toEqual(['active'])
    expect(await store.load('active')).toMatchObject({
      id: 'active',
      status: 'interrupted',
      error: { code: 'RUN_INTERRUPTED' },
      progress: {
        phase: 'interrupted',
        label: '已停止',
        updatedAt: '2026-08-23T03:00:00.000Z',
      },
      progressEvents: [{
        sequence: 1,
        phase: 'interrupted',
        label: '已停止',
        occurredAt: '2026-08-23T03:00:00.000Z',
      }],
    })
    expect((await store.load('done')).status).toBe('succeeded')
  })

  it('accepts a legacy persisted Run with a progress mirror but no event history', async () => {
    const fs = memoryFs()
    fs.files.set('runs-v2/legacy.json', JSON.stringify({
      id: 'legacy',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'running',
      progress: {
        phase: 'generating',
        label: '生成中',
        updatedAt: '2026-09-04T00:00:00.000Z',
      },
    }))

    await expect(createV2RunStore(fs).load('legacy')).resolves.toMatchObject({
      id: 'legacy',
      progress: { phase: 'generating', label: '生成中' },
    })
  })

  it('rejects a terminal Run whose latest public event is not its fixed terminal state', async () => {
    const fs = memoryFs()
    fs.files.set('runs-v2/terminal.json', JSON.stringify({
      id: 'terminal',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'succeeded',
      result: { output: 'result', disposition: 'applied' },
      progress: { phase: 'generating', label: '仍在生成', updatedAt: 'now' },
      progressEvents: [{
        sequence: 1,
        phase: 'generating',
        label: '仍在生成',
        occurredAt: 'now',
      }],
    }))

    await expect(createV2RunStore(fs).load('terminal'))
      .rejects.toMatchObject({ code: 'RUN_CORRUPT' })
  })

  it('rejects detail text on the fixed terminal progress event', async () => {
    const fs = memoryFs()
    fs.files.set('runs-v2/terminal-detail.json', JSON.stringify({
      id: 'terminal-detail',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'failed',
      error: { code: 'MODEL_FAILED', message: 'private diagnostic' },
      progress: {
        phase: 'failed',
        label: '生成未完成',
        detail: 'private diagnostic',
        updatedAt: 'now',
      },
      progressEvents: [{
        sequence: 1,
        phase: 'failed',
        label: '生成未完成',
        detail: 'private diagnostic',
        occurredAt: 'now',
      }],
    }))

    await expect(createV2RunStore(fs).load('terminal-detail'))
      .rejects.toMatchObject({ code: 'RUN_CORRUPT' })
  })

  it.each([
    ['more than twenty progress events', {
      progressEvents: Array.from({ length: 21 }, (_, index) => ({
        sequence: index + 1,
        phase: 'generating',
        label: '生成中',
        occurredAt: '2026-09-04T00:00:00.000Z',
      })),
    }],
    ['non-increasing progress sequences', {
      progressEvents: [
        { sequence: 2, phase: 'generating', label: '第一条', occurredAt: 'now' },
        { sequence: 2, phase: 'reviewing', label: '第二条', occurredAt: 'later' },
      ],
    }],
    ['an event with a private payload field', {
      progressEvents: [{
        sequence: 1,
        phase: 'generating',
        label: '生成中',
        occurredAt: 'now',
        toolPayload: { prompt: 'private' },
      }],
    }],
    ['an over-length public event field', {
      progressEvents: [{
        sequence: 1,
        phase: 'p'.repeat(41),
        label: '生成中',
        occurredAt: 'now',
      }],
    }],
    ['a latest event that does not match progress', {
      progressEvents: [{
        sequence: 1,
        phase: 'reviewing',
        label: '检查中',
        occurredAt: 'later',
      }],
    }],
  ])('rejects a persisted Run with %s', async (_case, change) => {
    const fs = memoryFs()
    fs.files.set('runs-v2/invalid.json', JSON.stringify({
      id: 'invalid',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'running',
      progress: {
        phase: 'generating',
        label: '生成中',
        updatedAt: 'now',
      },
      ...change,
    }))

    await expect(createV2RunStore(fs).load('invalid'))
      .rejects.toMatchObject({ code: 'RUN_CORRUPT' })
  })

  it.each(['save', 'start'])(
    'rejects invalid progress history before %s writes any secret-bearing file',
    async (operation) => {
      const fs = memoryFs()
      const store = createV2RunStore(fs)
      const invalid = {
        id: `invalid-${operation}`,
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
        progress: { phase: 'generating', label: '生成中', updatedAt: 'now' },
        progressEvents: [{
          sequence: 1,
          phase: 'generating',
          label: '生成中',
          occurredAt: 'now',
          prompt: 'SECRET_PROMPT',
        }],
      }

      await expect(store[operation](invalid)).rejects.toMatchObject({
        code: 'RUN_WRITE_FAILED',
      })
      expect([...fs.files.values()].join('\n')).not.toContain('SECRET_PROMPT')
    },
  )

  it('distinguishes a missing run, corrupt JSON, and a storage read failure', async () => {
    const fs = memoryFs()
    const store = createV2RunStore(fs)
    fs.files.set('runs-v2/corrupt.json', '{not json')

    await expect(store.load('missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
    await expect(store.load('corrupt')).rejects.toMatchObject({ code: 'RUN_CORRUPT' })

    const failingStore = createV2RunStore({
      ...memoryFs(),
      async readText() {
        throw Object.assign(new Error('disk offline'), { code: 'EIO' })
      },
    })
    await expect(failingStore.load('run-1')).rejects.toMatchObject({
      code: 'RUN_READ_FAILED',
    })
  })

  it.each([
    ['invalid JSON', '{not json'],
    [
      'invalid Run semantics',
      JSON.stringify({
        id: 'invalid',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'unknown',
      }),
    ],
  ])('fails list closed for a file with %s', async (_case, content) => {
    const fs = memoryFs()
    fs.files.set('runs-v2/invalid.json', content)
    const store = createV2RunStore(fs)

    await expect(store.list()).rejects.toMatchObject({ code: 'RUN_CORRUPT' })
  })

  it('ignores only a Run that disappears concurrently during list', async () => {
    const fs = memoryFs()
    fs.files.set(
      'runs-v2/kept.json',
      JSON.stringify({
        id: 'kept',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    )
    const listJson = fs.listJson.bind(fs)
    fs.listJson = async (dir) => [...(await listJson(dir)), 'vanished.json']
    const store = createV2RunStore(fs)

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: 'kept', status: 'running' }),
    ])
  })

  it('lists strict Runs deterministically and hides reserved import IDs', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const store = createV2RunStore(fs, 'runs-v2', { coordinator })
    for (const id of ['run-z', 'run-a']) {
      fs.files.set(`runs-v2/${id}.json`, JSON.stringify({
        id, boardId: 'board-1', targetCardId: 'target-1', status: 'failed',
      }))
    }
    const reservation = coordinator.reserveImportIds('tx-1', {
      boardIds: [], runIds: ['run-z'],
    })

    coordinator.releaseImportIds(reservation)
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: 'run-z' }),
      expect.objectContaining({ id: 'run-a' }),
    ])
    const restoredReservation = coordinator.reserveImportIds('tx-1', {
      boardIds: [], runIds: ['run-z'],
    })
    await expect(store.listStrict()).resolves.toEqual([
      expect.objectContaining({ id: 'run-a' }),
    ])
    await expect(store.load('run-z')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
    coordinator.releaseImportIds(restoredReservation)
    await expect(store.listStrict()).resolves.toEqual([
      expect.objectContaining({ id: 'run-a' }),
      expect.objectContaining({ id: 'run-z' }),
    ])
  })

  it('does not start or recover any Run when history contains a corrupt file', async () => {
    const fs = memoryFs()
    fs.files.set('runs-v2/corrupt.json', '{not json')
    const before = new Map(fs.files)
    const store = createV2RunStore(fs)

    await expect(
      store.start({
        id: 'run-second',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'RUN_CORRUPT' })
    expect(fs.files).toEqual(before)

    await expect(store.markBootInterrupted()).rejects.toMatchObject({
      code: 'RUN_CORRUPT',
    })
    expect(fs.files).toEqual(before)
  })

  it('fails a target claim closed when an existing Run file cannot be read', async () => {
    const fs = memoryFs()
    const store = createV2RunStore(fs)
    await store.save({
      id: 'run-active',
      boardId: 'board-1',
      targetCardId: 'target-1',
      status: 'running',
    })
    const readText = fs.readText.bind(fs)
    fs.readText = async (path) => {
      if (path === 'runs-v2/run-active.json') {
        throw Object.assign(new Error('disk offline'), { code: 'EIO' })
      }
      return readText(path)
    }

    await expect(
      store.start({
        id: 'run-second',
        boardId: 'board-1',
        targetCardId: 'target-1',
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'RUN_READ_FAILED' })
    expect(fs.files.has('runs-v2/run-second.json')).toBe(false)
  })
})
