import { createStorageCoordinator } from './storage-coordinator.js'
import { typed } from './domain/errors.js'
import { appendTerminalRunProgress, runProgressErrors } from './domain/run-progress.js'

const TERMINAL = new Set(['succeeded', 'failed', 'interrupted'])
const ACTIVE = new Set(['queued', 'running'])
const STATUSES = new Set([...ACTIVE, ...TERMINAL])
const DISPOSITIONS = new Set(['applied', 'candidate', 'discarded'])

export function validatePersistedRun(run, expectedId) {
  const errors = []
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    errors.push('Run must be an object')
  } else {
    if (run.id !== expectedId) errors.push('Run id does not match its file name')
    if (typeof run.boardId !== 'string' || !run.boardId) errors.push('Run boardId is invalid')
    if (typeof run.targetCardId !== 'string' || !run.targetCardId) {
      errors.push('Run targetCardId is invalid')
    }
    if (!STATUSES.has(run.status)) errors.push('Run status is invalid')
    errors.push(...runProgressErrors(run))
    if (
      run.modelSnapshot !== undefined
      && (
        !run.modelSnapshot
        || typeof run.modelSnapshot.provider !== 'string'
        || !run.modelSnapshot.provider.trim()
        || typeof run.modelSnapshot.model !== 'string'
        || !run.modelSnapshot.model.trim()
      )
    ) {
      errors.push('Run modelSnapshot is invalid')
    }
    if (run.status === 'succeeded') {
      if (!DISPOSITIONS.has(run.result?.disposition)) {
        errors.push('Succeeded Run disposition is invalid')
      }
      if (typeof run.result?.output !== 'string' || !run.result.output) {
        errors.push('Succeeded Run output is invalid')
      }
    }
  }
  if (errors.length > 0) {
    throw typed('RUN_CORRUPT', `Run ${expectedId} is invalid: ${errors.join('; ')}`)
  }
  return run
}

async function serializeByKey(queues, key, operation) {
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

export function createV2RunStore(fs, dir = 'runs-v2', options = {}) {
  const now = options.now || (() => new Date().toISOString())
  const coordinator = options.coordinator || createStorageCoordinator()
  const startQueues = new Map()
  const operationQueues = new Map()

  function path(id) {
    if (typeof id !== 'string' || !id || id.includes('/') || id.includes('..')) {
      throw typed('RUN_INVALID', 'Run id is invalid')
    }
    return `${dir}/${id}.json`
  }

  async function saveRaw(run) {
    const target = path(run?.id)
    const temp = `${target}.tmp`
    try {
      const serialized = JSON.stringify(run, null, 2)
      validatePersistedRun(JSON.parse(serialized), run.id)
      await fs.writeText(temp, serialized)
      const verified = JSON.parse(await fs.readText(temp))
      if (verified.id !== run.id) throw typed('RUN_INVALID', 'Run verification failed')
      validatePersistedRun(verified, run.id)
      await fs.replace(temp, target)
      return run
    } catch (error) {
      if (error?.code === 'RUN_INVALID') throw error
      throw typed(
        'RUN_WRITE_FAILED',
        `Run ${run.id} could not be saved safely: ${error?.message || error}`,
      )
    }
  }

  async function save(run, lease) {
    if (!coordinator.isVisible('run', run?.id)) {
      throw typed('IMPORT_ID_RESERVED', `Run ${run?.id} is reserved by an import`)
    }
    return coordinator.withMutation(() => {
      if (!coordinator.isVisible('run', run?.id)) {
        throw typed('IMPORT_ID_RESERVED', `Run ${run?.id} is reserved by an import`)
      }
      return saveRaw(run)
    }, lease)
  }

  async function load(id) {
    if (!coordinator.isVisible('run', id)) {
      throw typed('RUN_NOT_FOUND', `Run ${id} was not found`)
    }
    let text
    try {
      text = await fs.readText(path(id))
    } catch (error) {
      if (error?.code === 'RUN_INVALID') throw error
      if (error?.code === 'ENOENT') throw typed('RUN_NOT_FOUND', `Run ${id} was not found`)
      throw typed('RUN_READ_FAILED', `Run ${id} could not be read`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw typed('RUN_CORRUPT', `Run ${id} contains invalid JSON`)
    }
    return validatePersistedRun(parsed, id)
  }

  async function readList(strict) {
    let names
    try {
      names = await fs.listJson(dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('RUN_READ_FAILED', 'Run history could not be read')
    }
    const runs = []
    const members = names.filter((item) => item.endsWith('.json'))
    if (strict) members.sort((left, right) => left.localeCompare(right))
    for (const name of members) {
      const id = name.slice(0, -5)
      if (!coordinator.isVisible('run', id)) continue
      try {
        runs.push(await load(id))
      } catch (error) {
        if (!strict && error?.code === 'RUN_NOT_FOUND') continue
        throw error
      }
    }
    return runs
  }

  async function list() {
    return readList(false)
  }

  async function listStrict() {
    return readList(true)
  }

  async function withLockedRun(id, operation, lease) {
    return coordinator.withMutation(
      (mutationLease) => serializeByKey(operationQueues, id, async () =>
        operation(await load(id), mutationLease)),
      lease,
    )
  }

  async function withTargetLock(boardId, targetCardId, operation) {
    const key = JSON.stringify([boardId, targetCardId])
    return serializeByKey(startQueues, key, operation)
  }

  async function start(run, lease) {
    if (!coordinator.isVisible('run', run?.id)) {
      throw typed('IMPORT_ID_RESERVED', `Run ${run?.id} is reserved by an import`)
    }
    return coordinator.withMutation(() =>
      withTargetLock(run?.boardId, run?.targetCardId, async () => {
        if (!coordinator.isVisible('run', run?.id)) {
          throw typed('IMPORT_ID_RESERVED', `Run ${run?.id} is reserved by an import`)
        }
        const existing = await list()
        const busy = existing.some(
          (item) =>
            item.boardId === run?.boardId &&
            item.targetCardId === run?.targetCardId &&
            ACTIVE.has(item.status),
        )
        if (busy) throw typed('TARGET_BUSY', '这个成果正在生成中')
        const candidatePending = existing.some(
          (item) =>
            item.boardId === run?.boardId &&
            item.targetCardId === run?.targetCardId &&
            item.status === 'succeeded' &&
            item.result?.disposition === 'candidate',
        )
        if (candidatePending) {
          throw typed('CANDIDATE_PENDING', '请先采用或舍弃这个成果的候选结果')
        }
        return saveRaw(run)
      }),
      lease,
    )
  }

  async function markBootInterrupted(lease) {
    return coordinator.withMutation(async () => {
      const recovered = []
      for (const listedRun of await list()) {
        if (TERMINAL.has(listedRun.status)) continue
        await serializeByKey(operationQueues, listedRun.id, async () => {
          const run = await load(listedRun.id)
          if (TERMINAL.has(run.status)) return
          const finishedAt = run.finishedAt || now()
          const interrupted = appendTerminalRunProgress({
            ...run,
            status: 'interrupted',
            error: {
              code: 'RUN_INTERRUPTED',
              message: '服务重启中断了本次生成，已有内容保持不变',
              retryable: true,
            },
            finishedAt,
          }, 'interrupted', finishedAt)
          await saveRaw(interrupted)
          recovered.push(interrupted)
        })
      }
      return recovered
    }, lease)
  }

  return {
    save,
    load,
    list,
    listStrict,
    start,
    withLockedRun,
    withTargetLock,
    markBootInterrupted,
    pathForRun: path,
    listBoardRunIds: async (boardId) => (await list()).filter((run) => run.boardId === boardId).map((run) => run.id),
    coordinator,
  }
}
