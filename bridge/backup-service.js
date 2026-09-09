import { projectWorkspaceBackup } from './domain/workspace-backup.js'
import { typed } from './domain/errors.js'

const ACTIVE_RUN_STATUSES = new Set(['queued', 'running'])

export function createBackupService({
  coordinator,
  boardStore,
  runStore,
  workflowStore,
  inspirationPoolStore,
  checkpointStore,
  now = () => new Date().toISOString(),
} = {}) {
  if (!coordinator || !boardStore || !runStore || !workflowStore || !checkpointStore) {
    throw new TypeError('Backup service requires a coordinator and all Mira stores')
  }

  async function exportBackup() {
    return coordinator.withSnapshot(async () => {
      const boards = await boardStore.listStrict()
      const runs = await runStore.listStrict()
      const workflows = await workflowStore.listStrict()
      const checkpoints = await checkpointStore.listStrict()
      if (runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
        throw typed('EXPORT_BUSY', 'Workspace has an active Run')
      }
      const inspirationPool = inspirationPoolStore ? await inspirationPoolStore.load() : undefined
      return projectWorkspaceBackup({
        boards,
        runs,
        workflows,
        inspirationPool,
        checkpoints,
        exportedAt: now(),
      })
    })
  }

  return Object.freeze({ exportBackup })
}
