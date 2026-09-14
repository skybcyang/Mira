import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { acquireNodeWorkspaceWriteLock } from './node-workspace-lock.js'
import { createNodeWorkspaceAdapter } from './node-workspace-adapter.js'
import { createMiraStores } from './mira-application.js'
import { createBackupService } from './backup-service.js'
import { createManagedMaterials } from './managed-materials.js'
import { restoreWorkspaceBackup } from './node-backup-restore.js'
import { typed } from './domain/errors.js'
import { WORKSPACE_DATA_PATHS, initializeProjectWorkspace } from './project-workspace.js'

export async function migrateProjectWorkspace({ sourceRoot, targetRoot } = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot || typeof targetRoot !== 'string' || !targetRoot) throw typed('WORKSPACE_MIGRATION_INVALID', '必须指定旧工作区和全新目标目录。')
  const source = await realpath(sourceRoot), target = resolve(await realpath(dirname(resolve(targetRoot))), resolve(targetRoot).split(sep).at(-1))
  const inside = relative(source, target)
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside))) throw typed('WORKSPACE_MIGRATION_INVALID', '目标必须位于旧工作区之外。')
  if (!(await lstat(source)).isDirectory()) throw typed('WORKSPACE_MIGRATION_INVALID', '旧工作区必须是目录。')
  try { await readFile(join(source, '.mira/workspace.json')); throw typed('WORKSPACE_MIGRATION_INVALID', '这个工作区已经使用项目布局。') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const lock = acquireNodeWorkspaceWriteLock(source)
  let temporary
  try {
    const markers = await Promise.all(Object.values(WORKSPACE_DATA_PATHS).map(async path => {
      try { return await lstat(join(source, path)) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }))
    if (!markers.some(Boolean)) throw typed('WORKSPACE_MIGRATION_INVALID', '源目录不包含旧版 Mira 工作区数据。')
    // With a legacy marker present this only validates; it cannot initialize a new workspace.
    if (initializeProjectWorkspace(source, { mode: 'open' }).layout !== 'legacy') throw typed('WORKSPACE_MIGRATION_INVALID', '源目录不是旧版工作区。')
    const fs = createNodeWorkspaceAdapter(source)
    // Pending import journals require opening the old workspace for its normal recovery first.
    try { if ((await fs.listJson('transactions-v2')).length) throw typed('WORKSPACE_MIGRATION_INVALID', '存在未完成导入，请先打开旧工作区完成恢复并退出。') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const stores = createMiraStores({ fs })
    const materials = createManagedMaterials({ workspaceRoot: source, coordinator: stores.coordinator })
    const backup = await createBackupService({ ...stores, managedMaterials: materials }).exportBackup()
    temporary = await mkdtemp(join(tmpdir(), 'mira-layout-migration-'))
    const inputPath = join(temporary, 'workspace.mira-backup.json')
    await writeFile(inputPath, JSON.stringify(backup), { flag: 'wx', mode: 0o600 })
    const result = await restoreWorkspaceBackup({ inputPath, workspaceRoot: target })
    return { ...result, sourceUnchanged: true }
  } finally { try { if (temporary) await rm(temporary, { recursive: true, force: true }) } finally { lock.release() } }
}
