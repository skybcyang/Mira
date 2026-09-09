import { describe, expect, it } from 'vitest'
import { createBackupService } from '../../bridge/backup-service.js'
import { appendVersion } from '../../bridge/domain/versioning.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { V2BoardStore, emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { createV2Handlers } from '../../bridge/v2-http.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'
import { createWorkflowService } from '../../bridge/workflow-service.js'
import { WorkflowStore } from '../../bridge/workflow-store.js'

const NOW = '2026-09-02T09:00:00.000Z'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function memoryFs() {
  const files = new Map()
  return {
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

function instrumentedCoordinator() {
  const coordinator = createStorageCoordinator()
  const snapshotRequested = deferred()
  return {
    coordinator: Object.freeze({
      ...coordinator,
      withSnapshot(operation, lease) {
        snapshotRequested.resolve()
        return coordinator.withSnapshot(operation, lease)
      },
    }),
    snapshotRequested,
  }
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
    createdAt: NOW,
    updatedAt: NOW,
  }, {
    baseVersionId: null,
    versionId: `${id}-v1`,
    content: { kind: 'markdown', markdown },
    origin: 'human',
    createdAt: NOW,
  })
}

function boardWithRunTarget() {
  const board = emptyBoardV2('board-1', '研究课题', NOW)
  board.cards.push(
    markdownCard('source', '输入材料'),
    {
      id: 'target',
      contentKind: 'markdown',
      x: 480,
      y: 0,
      width: 360,
      height: 240,
      headVersionId: null,
      versions: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  )
  board.transformations.push({
    id: 'transformation-1',
    sourceCardIds: ['source'],
    targetCardId: 'target',
    label: '形成摘要',
    instruction: '整理输入材料',
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: NOW,
    updatedAt: NOW,
  })
  return board
}

function workflowBoard() {
  const board = emptyBoardV2('board-1', '研究课题', NOW)
  board.cards.push(markdownCard('source', '输入材料'), markdownCard('target', '已有成果'))
  board.transformations.push({
    id: 'transformation-1',
    sourceCardIds: ['source'],
    targetCardId: 'target',
    label: '形成摘要',
    instruction: '整理输入材料',
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: NOW,
    updatedAt: NOW,
  })
  return board
}

function workflowTemplate() {
  return {
    id: 'workflow-1',
    title: '摘要方法',
    description: '',
    steps: [{
      id: 'step-1',
      label: '形成摘要',
      instruction: '整理输入材料',
      acceptance: '',
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function persistedRun(overrides = {}) {
  return {
    id: 'run-1',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    sourceSnapshot: [{
      cardId: 'source',
      versionId: 'source-v1',
      contentKind: 'markdown',
      resolvedContent: '输入材料',
      digest: 'fnv1a:source',
    }],
    targetCardId: 'target',
    targetBaseVersionId: null,
    intent: 'create',
    status: 'succeeded',
    result: {
      output: '模型摘要',
      digest: 'fnv1a:output',
      disposition: 'candidate',
    },
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function boardWithAppliedCandidateVersion() {
  const board = boardWithRunTarget()
  const target = board.cards.find((card) => card.id === 'target')
  const applied = appendVersion(target, {
    baseVersionId: null,
    versionId: 'target-ai-v1',
    content: { kind: 'markdown', markdown: '模型摘要' },
    origin: 'ai',
    sourceRunId: 'run-1',
    createdAt: NOW,
  })
  board.cards = board.cards.map((card) => card.id === target.id ? applied : card)
  board.transformations[0].lastRunId = 'run-1'
  return board
}

function ids(...values) {
  return () => values.shift()
}

async function fixture(board) {
  const fs = memoryFs()
  const observed = instrumentedCoordinator()
  const boardStore = new V2BoardStore(fs, 'boards-v2', {
    coordinator: observed.coordinator,
    now: () => NOW,
  })
  const runStore = createV2RunStore(fs, 'runs-v2', {
    coordinator: observed.coordinator,
    now: () => NOW,
  })
  const workflowStore = new WorkflowStore(fs, 'workflows-v2', {
    coordinator: observed.coordinator,
  })
  await boardStore.save(board.id, board)
  const backupService = createBackupService({
    coordinator: observed.coordinator,
    boardStore,
    runStore,
    workflowStore,
    checkpointStore: { listStrict: async () => [] },
    now: () => NOW,
  })
  return { ...observed, boardStore, runStore, workflowStore, backupService }
}

async function expectSettled(promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('composed storage operation did not settle')),
          500,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('composed storage leases', () => {
  it('lets a queued backup follow a Run start that already owns the Board mutation', async () => {
    const {
      boardStore,
      runStore,
      backupService,
      snapshotRequested,
    } = await fixture(boardWithRunTarget())
    const modelResolutionEntered = deferred()
    const releaseModelResolution = deferred()
    const handlers = createV2Handlers({
      store: boardStore,
      runStore,
      newId: ids('run-1'),
      now: () => NOW,
      resolveModel: async () => {
        modelResolutionEntered.resolve()
        await releaseModelResolution.promise
        return { provider: 'openai-compatible', model: 'test-model' }
      },
      executeModel: () => new Promise(() => {}),
    })

    const startPromise = handlers.startRun('board-1', 'transformation-1')
    await modelResolutionEntered.promise
    const backupPromise = backupService.exportBackup()
    await snapshotRequested.promise
    releaseModelResolution.resolve()

    const outcomes = await expectSettled(Promise.allSettled([startPromise, backupPromise]))
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled' })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'EXPORT_BUSY' },
    })
  })

  it('keeps one lease through model result Candidate, Board, and final Run writes', async () => {
    const {
      boardStore,
      runStore,
      backupService,
      snapshotRequested,
    } = await fixture(boardWithRunTarget())
    const candidateSaveEntered = deferred()
    const releaseCandidateSave = deferred()
    const save = runStore.save.bind(runStore)
    runStore.save = async (run, lease) => {
      if (run.status === 'succeeded' && run.result?.disposition === 'candidate') {
        candidateSaveEntered.resolve()
        await releaseCandidateSave.promise
      }
      return save(run, lease)
    }
    const handlers = createV2Handlers({
      store: boardStore,
      runStore,
      newId: ids('run-1', 'target-ai-v1'),
      now: () => NOW,
      resolveModel: async () => ({ provider: 'openai-compatible', model: 'test-model' }),
      executeModel: async () => ({ outputText: '模型摘要' }),
    })

    await handlers.startRun('board-1', 'transformation-1')
    await candidateSaveEntered.promise
    const backupPromise = backupService.exportBackup()
    await snapshotRequested.promise
    releaseCandidateSave.resolve()

    const outcomes = await expectSettled(Promise.allSettled([
      (async () => {
        while ((await runStore.load('run-1')).result?.disposition !== 'applied') {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return runStore.load('run-1')
      })(),
      backupPromise,
    ]))
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(outcomes[0].value.result).toMatchObject({
      disposition: 'applied',
      appliedVersionId: 'target-ai-v1',
    })
  })

  it.each([
    ['Candidate adoption', 'adopt'],
    ['Candidate discard', 'discard'],
    ['boot Candidate reconciliation', 'reconcile'],
    ['Run interruption', 'interrupt'],
  ])('lets a queued backup follow %s under the locked Run lease', async (_label, command) => {
    const board = command === 'reconcile'
      ? boardWithAppliedCandidateVersion()
      : boardWithRunTarget()
    const {
      boardStore,
      runStore,
      backupService,
      snapshotRequested,
    } = await fixture(board)
    const run = command === 'interrupt'
      ? persistedRun({ status: 'running', result: undefined, finishedAt: undefined })
      : persistedRun()
    await runStore.save(run)
    const lockedRunEntered = deferred()
    const releaseLockedRun = deferred()
    const withLockedRun = runStore.withLockedRun.bind(runStore)
    let gated = false
    runStore.withLockedRun = (runId, operation, lease) => withLockedRun(
      runId,
      async (current, runLease) => {
        if (!gated) {
          gated = true
          lockedRunEntered.resolve()
          await releaseLockedRun.promise
        }
        return operation(current, runLease)
      },
      lease,
    )
    const handlers = createV2Handlers({
      store: boardStore,
      runStore,
      newId: ids('target-ai-v1'),
      now: () => NOW,
    })
    const operationPromise = command === 'adopt'
      ? handlers.adoptCandidate('run-1', { baseVersionId: null })
      : command === 'discard'
        ? handlers.discardCandidate('run-1')
        : command === 'reconcile'
          ? handlers.reconcileAppliedCandidates()
          : handlers.interruptRun('run-1')
    await lockedRunEntered.promise
    const backupPromise = backupService.exportBackup()
    await snapshotRequested.promise
    releaseLockedRun.resolve()

    const outcomes = await expectSettled(Promise.allSettled([operationPromise, backupPromise]))
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
  })

  it('lets a queued backup follow template extraction inside a Board lock', async () => {
    const {
      boardStore,
      workflowStore,
      backupService,
      snapshotRequested,
    } = await fixture(workflowBoard())
    const saveEntered = deferred()
    const releaseSave = deferred()
    const save = workflowStore.save.bind(workflowStore)
    workflowStore.save = async (...args) => {
      saveEntered.resolve()
      await releaseSave.promise
      return save(...args)
    }
    const service = createWorkflowService({
      boardStore,
      workflowStore,
      newId: ids('workflow-2', 'step-2'),
      now: () => NOW,
    })

    const createPromise = service.create({
      title: '摘要方法副本',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-1'],
    })
    await saveEntered.promise
    const backupPromise = backupService.exportBackup()
    await snapshotRequested.promise
    releaseSave.resolve()

    const outcomes = await expectSettled(Promise.allSettled([createPromise, backupPromise]))
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(outcomes[1].value.workflows.map((workflow) => workflow.id)).toEqual(['workflow-2'])
  })

  it('lets a queued backup follow a workflow application under Board then Workflow locks', async () => {
    const {
      boardStore,
      workflowStore,
      backupService,
      snapshotRequested,
    } = await fixture(workflowBoard())
    await workflowStore.save('workflow-1', workflowTemplate())
    const lockOrder = []
    const withLockedBoard = boardStore.withLockedBoard.bind(boardStore)
    boardStore.withLockedBoard = (...args) => {
      lockOrder.push('board')
      return withLockedBoard(...args)
    }
    const withLockedWorkflow = workflowStore.withLockedWorkflow.bind(workflowStore)
    workflowStore.withLockedWorkflow = (...args) => {
      lockOrder.push('workflow')
      return withLockedWorkflow(...args)
    }
    const updateEntered = deferred()
    const releaseUpdate = deferred()
    const update = boardStore.update.bind(boardStore)
    boardStore.update = async (...args) => {
      updateEntered.resolve()
      await releaseUpdate.promise
      return update(...args)
    }
    const service = createWorkflowService({
      boardStore,
      workflowStore,
      newId: ids('application-1', 'card-1', 'transformation-2'),
      now: () => NOW,
    })

    const applyPromise = service.apply('board-1', 'workflow-1', {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      targetPosition: { x: 600, y: 120 },
    })
    await updateEntered.promise
    const backupPromise = backupService.exportBackup()
    await snapshotRequested.promise
    releaseUpdate.resolve()

    const outcomes = await expectSettled(Promise.allSettled([applyPromise, backupPromise]))
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(lockOrder.slice(0, 2)).toEqual(['board', 'workflow'])
    expect(outcomes[1].value.boards[0].cards).toHaveLength(3)
  })
})
