import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'

export const WORKSPACE_DATA_PATHS = Object.freeze({
  boards: 'boards-v2', runs: 'runs-v2', workflows: 'workflows-v2',
  checkpoints: 'board-checkpoints-v1', inspirationPool: 'inspiration-pool-v2.json',
  executionSettings: 'execution-settings-v1.json',
  capabilities: 'capability-settings-v1.json',
  transactions: 'transactions-v2', purged: 'purged-boards-v2',
})
const fail = message => { throw Object.assign(new Error(message), { code: 'WORKSPACE_FORMAT_INVALID' }) }
function info(path) { try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
function validateDataPaths(root) {
  for (const [key, path] of Object.entries(WORKSPACE_DATA_PATHS)) {
    const value = info(join(root, path))
    if (value && (value.isSymbolicLink() || !(['inspirationPool', 'executionSettings', 'capabilities'].includes(key) ? value.isFile() : value.isDirectory()))) fail(`工作区格式无效：${path} 不能是链接或错误类型。`)
  }
}

// Called by the Node host only after acquiring the shared workspace writer lock.
export function initializeProjectWorkspace(root, { mode = 'open-or-create' } = {}) {
  if (!['open', 'create', 'open-or-create'].includes(mode)) fail('工作区初始化方式无效。')
  const internal = join(root, '.mira'), existing = info(internal)
  validateDataPaths(root)
  const legacy = Object.values(WORKSPACE_DATA_PATHS).filter(path => info(join(root, path)))
  if (mode === 'create' && (existing || legacy.length)) fail('这个文件夹已包含 Mira 项目，请使用“打开项目”。')
  if (mode === 'open' && !existing && !legacy.length) fail('所选文件夹不是现有 Mira 项目，请使用“新建项目”。')
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) fail('工作区格式无效：.mira 必须是普通目录。')
    validateDataPaths(internal)
    if (legacy.some(path => { const value = info(join(root, path)); return value.isFile() || (value.isDirectory() && readdirSync(join(root, path)).length > 0) })) fail('工作区存在两套数据布局，请先明确选择要保留的数据。')
    let workspace
    try {
      const manifestPath = join(internal, 'workspace.json')
      if (info(manifestPath)?.isSymbolicLink()) fail('工作区格式无效。')
      workspace = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch { fail('工作区格式损坏或缺少 workspace.json。') }
    if (workspace.format !== 'mira-workspace' || workspace.formatVersion !== 1
      || typeof workspace.id !== 'string' || !workspace.id || typeof workspace.name !== 'string'
      || !Number.isFinite(Date.parse(workspace.createdAt))) fail('工作区格式不受支持。')
    return { layout: 'project', workspace, directories: Object.fromEntries(Object.entries(WORKSPACE_DATA_PATHS).map(([key, path]) => [key, `.mira/${path}`])) }
  }
  if (legacy.length) return { layout: 'legacy', workspace: null, directories: {} }
  const stage = join(root, `.mira-init-${randomUUID()}`)
  try {
    mkdirSync(stage)
    const workspace = { format: 'mira-workspace', formatVersion: 1, id: randomUUID(), name: basename(root), createdAt: new Date().toISOString() }
    writeFileSync(join(stage, 'workspace.json'), JSON.stringify(workspace, null, 2), { flag: 'wx' })
    if (JSON.parse(readFileSync(join(stage, 'workspace.json'), 'utf8')).id !== workspace.id) fail('工作区格式写入校验失败。')
    renameSync(stage, internal)
  } finally { rmSync(stage, { recursive: true, force: true }) }
  return initializeProjectWorkspace(root, { mode: 'open' })
}
