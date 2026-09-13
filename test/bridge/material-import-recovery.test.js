import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { createManagedMaterials } from '../../bridge/managed-materials.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { createBoardImportCommitter } from '../../bridge/board-import-committer.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'mira-import-recovery-')); roots.push(root); return root }
it.each([false, true])('recovers previous board and owned materials after a failed import (restart=%s)', async restart => {
  const source = await temporary(), root = await temporary()
  const sourceAssets = createManagedMaterials({ workspaceRoot: source, coordinator: createStorageCoordinator() })
  await writeFile(join(source, 'original.txt'), 'test original')
  await sourceAssets.importFile(join(source, 'original.txt'))
  const assets = await sourceAssets.export()
  const adapter = createNodeWorkspaceAdapter(root)
  const previousBoard = emptyBoardV2('target', 'previous', new Date().toISOString())
  await adapter.writeText('boards-v2/target.json', JSON.stringify(previousBoard))
  let failing = true, failedOnce = false
  const fs = { ...adapter, async replace(from, to) {
    if (to === 'boards-v2/target.json' && failing && (!failedOnce || restart)) { failedOnce = true; throw new Error('simulated disk interruption') }
    return adapter.replace(from, to)
  } }
  let coordinator = createStorageCoordinator()
  let materials = createManagedMaterials({ workspaceRoot: root, coordinator })
  let committer = createBoardImportCommitter({ fs, coordinator, managedMaterials: materials, newId: () => 'test-transaction' })
  await expect(committer.commit({ board: { ...previousBoard, title: 'changed', revision: 1 }, previousBoard, runs: [], assets })).rejects.toMatchObject({ code: restart ? 'BOARD_IMPORT_ROLLBACK_FAILED' : 'BOARD_IMPORT_WRITE_FAILED' })
  if (restart) {
    failing = false
    coordinator = createStorageCoordinator()
    materials = createManagedMaterials({ workspaceRoot: root, coordinator })
    committer = createBoardImportCommitter({ fs, coordinator, managedMaterials: materials, newId: () => 'other-transaction' })
    expect((await committer.recover()).recoveredTransactionIds).toEqual(['test-transaction'])
  }
  expect(JSON.parse(await readFile(join(root, 'boards-v2/target.json'), 'utf8'))).toEqual(previousBoard)
  expect(await materials.list()).toEqual([])
  expect(await adapter.listJson('transactions-v2')).toEqual([])
})
