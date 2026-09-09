import { typed } from './domain/errors.js'

function readonlyIds(ids) {
  const values = new Set(ids)
  return Object.freeze({
    get size() {
      return values.size
    },
    has(id) {
      return values.has(id)
    },
    values() {
      return values.values()
    },
    [Symbol.iterator]() {
      return values[Symbol.iterator]()
    },
  })
}

function createVisibilitySnapshot(boardIds = [], runIds = []) {
  return Object.freeze({
    boardIds: readonlyIds(boardIds),
    runIds: readonlyIds(runIds),
  })
}

function createFairLeaseQueue() {
  const waiting = []
  let activeMutations = 0
  let snapshotActive = false

  function pump() {
    if (snapshotActive || waiting.length === 0) return
    if (waiting[0].kind === 'snapshot') {
      if (activeMutations > 0) return
      const request = waiting.shift()
      snapshotActive = true
      request.resolve(() => {
        snapshotActive = false
        pump()
      })
      return
    }
    while (!snapshotActive && waiting[0]?.kind === 'mutation') {
      const request = waiting.shift()
      activeMutations += 1
      request.resolve(() => {
        activeMutations -= 1
        pump()
      })
    }
  }

  function acquire(kind) {
    return new Promise((resolve) => {
      waiting.push({ kind, resolve })
      pump()
    })
  }

  return { acquire }
}

function createSerialQueue() {
  const waiting = []
  let active = false

  function pump() {
    if (active || waiting.length === 0) return
    active = true
    const request = waiting.shift()
    let result
    try {
      result = request.operation()
    } catch (error) {
      result = Promise.reject(error)
    }
    Promise.resolve(result).then(request.resolve, request.reject).finally(() => {
      active = false
      pump()
    })
  }

  return function withSerial(operation) {
    return new Promise((resolve, reject) => {
      waiting.push({ operation, resolve, reject })
      pump()
    })
  }
}

function serializeByKey(queues, key, operation) {
  const previous = queues.get(key) || Promise.resolve()
  let release
  const current = new Promise((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  queues.set(key, queued)
  return previous.then(async () => {
    try {
      return await operation()
    } finally {
      release()
      if (queues.get(key) === queued) queues.delete(key)
    }
  })
}

export function createStorageCoordinator() {
  const leases = new WeakMap()
  const reservations = new WeakMap()
  const activeReservations = new Map()
  const boardQueues = new Map()
  const workflowQueues = new Map()
  const checkpointQueues = new Map()
  const globalLeases = createFairLeaseQueue()
  const withSerialImport = createSerialQueue()
  let visibility = createVisibilitySnapshot()

  function leaseFor(metadata) {
    const lease = Object.freeze({})
    leases.set(lease, Object.freeze({
      ...metadata,
      boardIds: Object.freeze([...(metadata.boardIds || [])]),
      workflowIds: Object.freeze([...(metadata.workflowIds || [])]),
      checkpointIds: Object.freeze([...(metadata.checkpointIds || [])]),
    }))
    return lease
  }

  function metadataFor(lease) {
    const metadata = lease && leases.get(lease)
    if (!metadata) {
      throw typed('STORAGE_LEASE_INVALID', 'Storage lease does not belong to this coordinator')
    }
    return metadata
  }

  async function withAcquired(kind, operation) {
    const release = await globalLeases.acquire(kind)
    const lease = leaseFor({ kind, boardIds: [], workflowIds: [], checkpointIds: [] })
    try {
      return await operation(lease)
    } finally {
      release()
    }
  }

  async function withMutation(operation, lease) {
    if (lease) {
      const metadata = metadataFor(lease)
      if (metadata.kind !== 'mutation' && metadata.kind !== 'import') {
        throw typed('STORAGE_LEASE_INVALID', 'A snapshot lease cannot perform mutations')
      }
      return operation(lease)
    }
    return withAcquired('mutation', operation)
  }

  async function withSnapshot(operation, lease) {
    if (lease) {
      const metadata = metadataFor(lease)
      if (metadata.kind !== 'snapshot') {
        throw typed('STORAGE_LEASE_INVALID', 'An exclusive snapshot lease is required')
      }
      return operation(lease)
    }
    return withAcquired('snapshot', operation)
  }

  async function withImport(operation, lease) {
    if (lease) {
      const metadata = metadataFor(lease)
      if (metadata.kind !== 'import') {
        throw typed('STORAGE_LEASE_INVALID', 'A serial import lease is required')
      }
      return operation(lease)
    }
    return withSerialImport(async () => {
      const release = await globalLeases.acquire('snapshot')
      const importLease = leaseFor({ kind: 'import', boardIds: [], workflowIds: [], checkpointIds: [] })
      try {
        return await operation(importLease)
      } finally {
        release()
      }
    })
  }

  async function withKey(queues, field, id, lease, operation) {
    if (typeof id !== 'string' || !id) {
      throw typed('STORAGE_LEASE_INVALID', 'A non-empty storage lock key is required')
    }
    const metadata = metadataFor(lease)
    if (metadata[field].includes(id)) return operation(lease)
    return serializeByKey(queues, id, () => {
      const heldLease = leaseFor({
        ...metadata,
        [field]: [...metadata[field], id],
      })
      return operation(heldLease)
    })
  }

  function rebuildVisibility() {
    const boardIds = []
    const runIds = []
    for (const reservation of activeReservations.values()) {
      boardIds.push(...reservation.boardIds)
      runIds.push(...reservation.runIds)
    }
    visibility = createVisibilitySnapshot(boardIds, runIds)
  }

  function normalizeReservedIds(kind, ids) {
    if (!Array.isArray(ids)) {
      throw typed('IMPORT_RESERVATION_INVALID', `${kind} IDs must be an array`)
    }
    const normalized = []
    const seen = new Set()
    for (const id of ids) {
      if (typeof id !== 'string' || !id || seen.has(id)) {
        throw typed('IMPORT_RESERVATION_INVALID', `${kind} IDs must be non-empty and unique`)
      }
      seen.add(id)
      normalized.push(id)
    }
    return normalized
  }

  function reserveImportIds(transactionId, ownedIds) {
    if (typeof transactionId !== 'string' || !transactionId || activeReservations.has(transactionId)) {
      throw typed('IMPORT_RESERVATION_INVALID', 'Import transaction ID must be unique')
    }
    const boardIds = normalizeReservedIds('Board', ownedIds?.boardIds)
    const runIds = normalizeReservedIds('Run', ownedIds?.runIds)
    const conflicts = [
      ...boardIds.filter((id) => visibility.boardIds.has(id)).map((id) => ({ kind: 'board', id })),
      ...runIds.filter((id) => visibility.runIds.has(id)).map((id) => ({ kind: 'run', id })),
    ]
    if (conflicts.length > 0) {
      throw typed('IMPORT_ID_RESERVED', 'An import ID is already reserved', conflicts)
    }
    const record = Object.freeze({
      transactionId,
      boardIds: Object.freeze([...boardIds]),
      runIds: Object.freeze([...runIds]),
    })
    const reservation = Object.freeze({})
    reservations.set(reservation, record)
    activeReservations.set(transactionId, record)
    rebuildVisibility()
    return reservation
  }

  function releaseImportIds(reservation) {
    const record = reservation && reservations.get(reservation)
    if (!record || activeReservations.get(record.transactionId) !== record) {
      throw typed('IMPORT_RESERVATION_INVALID', 'Import reservation is not active')
    }
    activeReservations.delete(record.transactionId)
    reservations.delete(reservation)
    rebuildVisibility()
  }

  return Object.freeze({
    withMutation,
    withSnapshot,
    withImport,
    withBoard(id, lease, operation) {
      return withKey(boardQueues, 'boardIds', id, lease, operation)
    },
    withWorkflow(id, lease, operation) {
      return withKey(workflowQueues, 'workflowIds', id, lease, operation)
    },
    withCheckpoint(id, lease, operation) {
      return withKey(checkpointQueues, 'checkpointIds', id, lease, operation)
    },
    reserveImportIds,
    releaseImportIds,
    visibilitySnapshot() {
      return visibility
    },
    isVisible(kind, id) {
      if (kind === 'board') return !visibility.boardIds.has(id)
      if (kind === 'run') return !visibility.runIds.has(id)
      throw typed('IMPORT_RESERVATION_INVALID', `Unknown visibility kind: ${kind}`)
    },
  })
}
