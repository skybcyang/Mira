import { describe, expect, it } from 'vitest'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('storage coordinator', () => {
  it('serializes the same Board while allowing unrelated Boards to proceed', async () => {
    const coordinator = createStorageCoordinator()
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const events = []

    const first = coordinator.withMutation((mutationLease) =>
      coordinator.withBoard('board-1', mutationLease, async () => {
        events.push('board-1:first:start')
        firstStarted.resolve()
        await releaseFirst.promise
        events.push('board-1:first:end')
      }))
    await firstStarted.promise
    const second = coordinator.withMutation((mutationLease) =>
      coordinator.withBoard('board-1', mutationLease, async () => {
        events.push('board-1:second')
      }))
    const unrelated = coordinator.withMutation((mutationLease) =>
      coordinator.withBoard('board-2', mutationLease, async () => {
        events.push('board-2')
      }))

    await unrelated
    expect(events).toEqual(['board-1:first:start', 'board-2'])
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(events).toEqual([
      'board-1:first:start',
      'board-2',
      'board-1:first:end',
      'board-1:second',
    ])
  })

  it('gives a queued snapshot an exclusive boundary before later mutations', async () => {
    const coordinator = createStorageCoordinator()
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const releaseSnapshot = deferred()
    const snapshotStarted = deferred()
    const events = []

    const first = coordinator.withMutation(async () => {
      events.push('mutation:first:start')
      firstStarted.resolve()
      await releaseFirst.promise
      events.push('mutation:first:end')
    })
    await firstStarted.promise
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot:start')
      snapshotStarted.resolve()
      await releaseSnapshot.promise
      events.push('snapshot:end')
    })
    const later = coordinator.withMutation(async () => {
      events.push('mutation:later')
    })

    releaseFirst.resolve()
    await snapshotStarted.promise
    expect(events).toEqual(['mutation:first:start', 'mutation:first:end', 'snapshot:start'])
    releaseSnapshot.resolve()
    await Promise.all([first, snapshot, later])
    expect(events).toEqual([
      'mutation:first:start',
      'mutation:first:end',
      'snapshot:start',
      'snapshot:end',
      'mutation:later',
    ])
  })

  it('reuses an explicit mutation lease instead of deadlocking behind a queued snapshot', async () => {
    const coordinator = createStorageCoordinator()
    const outerStarted = deferred()
    const continueOuter = deferred()
    const nestedFinished = deferred()
    const events = []

    const outer = coordinator.withMutation(async (lease) => {
      events.push('outer:start')
      outerStarted.resolve()
      await continueOuter.promise
      await coordinator.withMutation(async () => {
        events.push('nested')
        nestedFinished.resolve()
      }, lease)
      events.push('outer:end')
    })
    await outerStarted.promise
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot')
    })
    continueOuter.resolve()

    await nestedFinished.promise
    await Promise.all([outer, snapshot])
    expect(events).toEqual(['outer:start', 'nested', 'outer:end', 'snapshot'])
  })

  it('serializes imports and never overlaps an import with a snapshot', async () => {
    const coordinator = createStorageCoordinator()
    const releaseImport = deferred()
    const firstStarted = deferred()
    const events = []

    const first = coordinator.withImport(async () => {
      events.push('import:first:start')
      firstStarted.resolve()
      await releaseImport.promise
      events.push('import:first:end')
    })
    await firstStarted.promise
    const second = coordinator.withImport(async () => {
      events.push('import:second')
    })
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot')
    })

    releaseImport.resolve()
    await Promise.all([first, second, snapshot])
    expect(events).toEqual([
      'import:first:start',
      'import:first:end',
      'snapshot',
      'import:second',
    ])
  })

  it('runs an import exclusively between earlier and later mutations', async () => {
    const coordinator = createStorageCoordinator()
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const releaseImport = deferred()
    const importStarted = deferred()
    const events = []
    let laterStarted = false

    const first = coordinator.withMutation(async () => {
      events.push('mutation:first:start')
      firstStarted.resolve()
      await releaseFirst.promise
      events.push('mutation:first:end')
    })
    await firstStarted.promise
    const importing = coordinator.withImport(async () => {
      events.push('import:start')
      importStarted.resolve()
      await releaseImport.promise
      events.push('import:end')
    })
    const later = coordinator.withMutation(async () => {
      laterStarted = true
      events.push('mutation:later')
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['mutation:first:start'])
    releaseFirst.resolve()
    await importStarted.promise
    expect(laterStarted).toBe(false)
    releaseImport.resolve()

    await Promise.all([first, importing, later])
    expect(events).toEqual([
      'mutation:first:start',
      'mutation:first:end',
      'import:start',
      'import:end',
      'mutation:later',
    ])
  })

  it('publishes import visibility reservations with synchronous immutable snapshots', () => {
    const coordinator = createStorageCoordinator()
    const initial = coordinator.visibilitySnapshot()
    const reservation = coordinator.reserveImportIds('tx-1', {
      boardIds: ['board-new'],
      runIds: ['run-new'],
    })
    const reserved = coordinator.visibilitySnapshot()

    expect(initial).not.toBe(reserved)
    expect(initial.boardIds.has('board-new')).toBe(false)
    expect(reserved.boardIds.has('board-new')).toBe(true)
    expect(coordinator.isVisible('board', 'board-new')).toBe(false)
    expect(coordinator.isVisible('run', 'run-new')).toBe(false)
    expect(() => coordinator.reserveImportIds('tx-2', {
      boardIds: ['board-new'], runIds: [],
    })).toThrow(expect.objectContaining({ code: 'IMPORT_ID_RESERVED' }))

    coordinator.releaseImportIds(reservation)
    const released = coordinator.visibilitySnapshot()
    expect(released).not.toBe(reserved)
    expect(coordinator.isVisible('board', 'board-new')).toBe(true)
    expect(coordinator.isVisible('run', 'run-new')).toBe(true)
  })
})
