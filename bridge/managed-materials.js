import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join, relative, resolve, sep } from 'node:path'
import { typed } from './domain/errors.js'
import { MAX_MATERIAL_BYTES, materialExtension as extension, isManagedMaterialPath, validateManagedAsset, validateManagedAssets } from './domain/managed-assets.js'
export { MAX_MATERIAL_BYTES, isManagedMaterialPath, validateManagedAsset, validateManagedAssets } from './domain/managed-assets.js'

const ID = /^[a-f0-9]{64}$/
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = (message, code = 'MATERIAL_INVALID') => { throw typed(code, message) }

export function createManagedMaterials({ workspaceRoot, coordinator }) {
  if (!coordinator) throw new TypeError('Managed materials require the shared storage coordinator')
  const root = resolve(workspaceRoot), directory = join(root, 'materials')
  async function noLinks(target) {
    const canonicalRoot = await realpath(root)
    const parts = relative(root, target).split(sep)
    if (parts.includes('..')) fail('材料路径越出工作区。')
    let current = canonicalRoot
    for (const part of parts) {
      current = join(current, part)
      try { if ((await lstat(current)).isSymbolicLink()) fail('材料目录不能包含符号链接。') } catch (error) { if (error.code === 'ENOENT') break; throw error }
    }
  }
  async function boundedRead(target) {
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_MATERIAL_BYTES) fail('材料必须是最多 64 MiB 的普通文件。', 'MATERIAL_LIMIT')
      const buffer = Buffer.alloc(stat.size + 1)
      let count = 0
      while (count < buffer.length) { const result = await handle.read(buffer, count, buffer.length - count, count); if (!result.bytesRead) break; count += result.bytesRead }
      if (count !== stat.size) fail('材料在复制期间发生变化，请重新导入。')
      return buffer.subarray(0, count)
    } finally { await handle.close() }
  }
  async function load(id) {
    if (!ID.test(id)) fail('材料身份无效。')
    const assetDir = join(directory, id)
    await noLinks(join(assetDir, 'record.json'))
    if (!(await lstat(assetDir)).isDirectory()) fail('材料目录损坏。', 'MATERIAL_CORRUPT')
    let record
    try { const info = await lstat(join(assetDir, 'record.json')); if (info.size > 16384) fail('材料记录过大。'); record = JSON.parse(await readFile(join(assetDir, 'record.json'), 'utf8')) } catch { fail('材料记录损坏。', 'MATERIAL_CORRUPT') }
    if (!isManagedMaterialPath(record.path) || record.id !== id || !record.path.startsWith(`materials/${id}/`)) fail('材料记录路径损坏。', 'MATERIAL_CORRUPT')
    await noLinks(join(root, record.path))
    try { const bytes = await boundedRead(join(root, record.path)); const asset = { ...record, data: bytes.toString('base64') }; validateManagedAsset(asset); return asset } catch { fail('材料原件缺失或已被修改，请从可信备份恢复。', 'MATERIAL_CORRUPT') }
  }
  async function loadPath(path) {
    if (!isManagedMaterialPath(path)) fail('材料路径无效。')
    const asset = await load(path.split('/')[1])
    if (asset.path !== path) fail('材料路径与原件不匹配。')
    return asset
  }
  async function listUnlocked() {
    await noLinks(directory)
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const assets = []
    for (const entry of entries) {
      if (!ID.test(entry.name)) continue
      const { data: _data, ...asset } = await load(entry.name)
      assets.push(asset)
    }
    return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name))
  }
  async function installUnlocked(assets) {
    validateManagedAssets(assets)
    await noLinks(directory)
    const missing = []
    for (const asset of assets) {
      try { const existing = await load(asset.id); if (existing.path !== asset.path) fail('已有材料路径冲突。') } catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(asset) }
    }
    await mkdir(directory, { recursive: true })
    const installed = []
    try {
      for (const asset of missing) {
        const stage = join(directory, `.stage-${randomUUID()}`)
        try {
          await mkdir(stage)
          const { data, ...record } = asset
          await writeFile(join(stage, basename(asset.path)), Buffer.from(data, 'base64'), { flag: 'wx' })
          await writeFile(join(stage, 'record.json'), JSON.stringify(record), { flag: 'wx' })
          const verified = JSON.parse(await readFile(join(stage, 'record.json'), 'utf8'))
          validateManagedAsset({ ...verified, data: (await readFile(join(stage, basename(asset.path)))).toString('base64') })
          await rename(stage, join(directory, asset.id)); installed.push(asset.id)
        } finally { await rm(stage, { recursive: true, force: true }) }
      }
    } catch (error) { await rollback(installed); throw error }
    return installed
  }
  async function rollback(ids) {
    for (const id of ids) { if (!ID.test(id)) fail('材料回滚身份无效。'); await noLinks(join(directory, id)); await rm(join(directory, id), { recursive: true, force: true }) }
  }
  async function importBytes(bytes, name, source) {
    if (bytes.length > MAX_MATERIAL_BYTES) fail('材料超过 64 MiB。', 'MATERIAL_LIMIT')
    const id = digest(bytes), path = `materials/${id}/original.${extension(bytes)}`
    const asset = { formatVersion: 1, id, path, name, byteLength: bytes.length, sha256: id, createdAt: new Date().toISOString(), ...(source ? { source } : {}), data: bytes.toString('base64') }
    await installUnlocked([asset])
    const { data: _data, ...record } = await load(id)
    return { path, copied: true, asset: record }
  }
  return Object.freeze({
    list: () => coordinator.withSnapshot(listUnlocked),
    async importFile(path) {
      if (typeof path !== 'string' || !path.trim() || path.includes('\0')) fail('请选择有效文件。')
      const target = resolve(root, path)
      if ((await lstat(target)).isSymbolicLink()) fail('请直接选择原文件，不要导入符号链接。')
      return coordinator.withImport(async () => {
        const rel = relative(root, target).split(sep).join('/')
        if (isManagedMaterialPath(rel)) { const { data: _data, ...asset } = await loadPath(rel); return { path: asset.path, copied: false, asset } }
        return importBytes(await boundedRead(target), basename(target))
      })
    },
    importText: (text, name, source) => coordinator.withImport(() => importBytes(Buffer.from(text, 'utf8'), name, source)),
    async readText(path) { const asset = await loadPath(path); return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(asset.data, 'base64')) },
    verify: loadPath,
    async export(paths) { if (paths) return Promise.all([...new Set(paths.filter(isManagedMaterialPath))].map(loadPath)); return Promise.all((await listUnlocked()).map(asset => load(asset.id))) },
    install: (assets, lease) => coordinator.withImport(() => installUnlocked(assets), lease),
    missing: async assets => { validateManagedAssets(assets); const ids = []; for (const asset of assets) { try { await load(asset.id) } catch (error) { if (error.code !== 'ENOENT') throw error; ids.push(asset.id) } } return ids },
    rollback,
  })
}
