import { V2BoardStore } from './v2-board-store.js'
import { createBackupService } from './backup-service.js'
import { createBoardImportCommitter } from './board-import-committer.js'
import { createBoardPortabilityService } from './board-portability-service.js'
import { createV2Handlers } from './v2-http.js'
import { dispatchV2Route } from './v2-routes.js'
import { createV2RunStore } from './v2-run-store.js'
import { createStorageCoordinator } from './storage-coordinator.js'
import { createWorkflowService } from './workflow-service.js'
import { WorkflowStore } from './workflow-store.js'
import { InspirationPoolStore } from './inspiration-pool-store.js'
import { createInspirationPoolHandlers } from './inspiration-pool-http.js'
import { BoardCheckpointStore } from './board-checkpoint-store.js'
import { createBoardCheckpointService } from './board-checkpoint-service.js'

function defaultNewId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
}

export async function recoverRunsAtBoot({ handlers, runStore }) {
  const reconciled = await handlers.reconcileAppliedCandidates()
  const interrupted = await runStore.markBootInterrupted()
  return { reconciled, interrupted }
}

export function createTransformationModelExecutor(execute) {
  if (!execute) return null
  return ({ boardId, transformation, prompt, signal, onProgress, modelSnapshot }) =>
    execute({
      boardId,
      subject: { id: transformation.id, goal: transformation.instruction },
      prompt,
      toolFilter: { allow: [] },
      signal,
      onProgress,
      modelSnapshot,
    })
}

export function createMiraStores({
  fs,
  newId = defaultNewId,
  now = () => new Date().toISOString(),
  directories = {},
}) {
  if (!fs) throw new TypeError('A storage adapter is required')
  const coordinator = createStorageCoordinator()
  const boardStore = new V2BoardStore(fs, directories.boards || 'boards-v2', {
    coordinator,
    newId,
    now,
  })
  const runStore = createV2RunStore(fs, directories.runs || 'runs-v2', { coordinator, now })
  const workflowStore = new WorkflowStore(fs, directories.workflows || 'workflows-v2', {
    coordinator,
  })
  const inspirationPoolStore = new InspirationPoolStore(fs, {
    coordinator,
    path: directories.inspirationPool || 'inspiration-pool-v2.json',
    newId,
    now,
  })
  const checkpointStore = new BoardCheckpointStore(
    fs,
    directories.checkpoints || 'board-checkpoints-v1',
    { coordinator, now },
  )
  return {
    fs,
    coordinator,
    boardStore,
    runStore,
    workflowStore,
    inspirationPoolStore,
    checkpointStore,
  }
}

export function createMiraApplication({
  fs,
  coordinator: suppliedCoordinator,
  stores,
  newId = defaultNewId,
  now = () => new Date().toISOString(),
  directories,
  readFileContent,
  executeSuggestion,
  executeModel,
  resolveModel,
  onRecovery,
  fileLibrary,
} = {}) {
  const resolvedStores = stores || createMiraStores({ fs, newId, now, directories })
  const { boardStore, runStore, workflowStore, inspirationPoolStore } = resolvedStores
  if (!boardStore || !runStore || !workflowStore || !inspirationPoolStore) {
    throw new TypeError('Board, Run, Workflow, and Inspiration Pool stores are required')
  }
  const coordinator = suppliedCoordinator || resolvedStores.coordinator
  const storageFs = fs || resolvedStores.fs
  if (!coordinator) throw new TypeError('A shared storage coordinator is required')
  if (
    boardStore.coordinator !== coordinator
    || runStore.coordinator !== coordinator
    || workflowStore.coordinator !== coordinator
    || inspirationPoolStore.coordinator !== coordinator
  ) {
    throw new TypeError('Mira stores must share the supplied storage coordinator')
  }
  if (!storageFs) throw new TypeError('A storage adapter is required for Board import recovery')
  const checkpointStore = resolvedStores.checkpointStore || new BoardCheckpointStore(
    storageFs,
    directories?.checkpoints || 'board-checkpoints-v1',
    { coordinator, now },
  )
  if (checkpointStore.coordinator !== coordinator) {
    throw new TypeError('Mira stores must share the supplied storage coordinator')
  }

  const handlers = createV2Handlers({
    store: boardStore,
    inspirationPoolStore,
    runStore,
    newId,
    now,
    readFileContent,
    fs: storageFs,
    executeSuggestion,
    executeModel,
    resolveModel,
    checkpointStore,
  })
  const workflowService = createWorkflowService({
    boardStore,
    workflowStore,
    newId,
    now,
  })
  const inspirationPoolHandlers = createInspirationPoolHandlers({ poolStore: inspirationPoolStore })
  const importCommitter = createBoardImportCommitter({
    fs: storageFs,
    coordinator,
    newId,
    now,
    directories,
  })
  const boardPortabilityService = createBoardPortabilityService({
    boardStore,
    runStore,
    workflowStore,
    committer: importCommitter,
    newId,
    now,
  })
  const checkpointService = createBoardCheckpointService({
    boardStore,
    runStore,
    checkpointStore,
    boardPortabilityService,
    newId,
    now,
  })
  const backupService = createBackupService({
    coordinator,
    boardStore,
    runStore,
    workflowStore,
    inspirationPoolStore,
    checkpointStore,
    now,
  })
  const ready = (async () => {
    let imported
    try {
      imported = await importCommitter.recover()
    } catch (error) {
      if (error?.code === 'BOARD_IMPORT_RECOVERY_FAILED'
        || error?.code === 'BOARD_IMPORT_JOURNAL_INVALID') {
        throw error
      }
      throw Object.assign(
        new Error(`Board import recovery failed: ${error?.message || error}`, { cause: error }),
        { code: 'BOARD_IMPORT_RECOVERY_FAILED' },
      )
    }

    let runRecovery
    try {
      runRecovery = await recoverRunsAtBoot({ handlers, runStore })
    } catch (error) {
      throw Object.assign(
        new Error(`Run recovery failed: ${error?.message || error}`, { cause: error }),
        { code: 'RUN_RECOVERY_FAILED' },
      )
    }
    const result = { imported, ...runRecovery }
    try {
      await onRecovery?.(result)
    } catch (error) {
      throw Object.assign(
        new Error(`Run recovery failed: ${error?.message || error}`, { cause: error }),
        { code: 'RUN_RECOVERY_FAILED' },
      )
    }
    return result
  })()

  async function dispatch(method, segments, body) {
    await ready
    return (
      (await dispatchV2Route(method, segments, body, {
        store: boardStore,
        handlers,
        workflowService,
        inspirationPoolHandlers,
        boardPortabilityService,
        checkpointService,
        backupService,
        fileLibrary,
      })) || {
        status: 404,
        body: { code: 'NOT_FOUND', message: `${method} /${segments.join('/')}` },
      }
    )
  }

  return {
    ...resolvedStores,
    handlers,
    workflowService,
    inspirationPoolStore,
    inspirationPoolHandlers,
    checkpointStore,
    checkpointService,
    importCommitter,
    boardPortabilityService,
    backupService,
    ready,
    dispatch,
  }
}
