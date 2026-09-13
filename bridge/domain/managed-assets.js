import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { typed } from './errors.js'

export const MAX_MATERIAL_BYTES = 64 * 1024 * 1024
const fail = message => { throw typed('MATERIAL_INVALID', message) }
export function materialExtension(bytes) {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'pdf'
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return text.includes('\0') ? 'bin' : 'txt' } catch { return 'bin' }
}
export function isManagedMaterialPath(path) { return typeof path === 'string' && /^materials\/[a-f0-9]{64}\/original\.(txt|pdf|bin)$/.test(path) }
export function validateManagedAsset(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
    || Object.keys(asset).some(key => !['formatVersion', 'id', 'path', 'name', 'byteLength', 'sha256', 'createdAt', 'data', 'source'].includes(key))
    || asset.formatVersion !== 1 || typeof asset.id !== 'string' || !/^[a-f0-9]{64}$/.test(asset.id) || asset.sha256 !== asset.id
    || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 500 || /[\u0000-\u001f]/.test(asset.name)
    || typeof asset.createdAt !== 'string' || !Number.isFinite(Date.parse(asset.createdAt)) || !Number.isSafeInteger(asset.byteLength)
    || asset.byteLength < 0 || asset.byteLength > MAX_MATERIAL_BYTES
    || typeof asset.data !== 'string' || asset.data.length !== Math.ceil(asset.byteLength / 3) * 4
    || /[^A-Za-z0-9+/=]/.test(asset.data)) fail('材料包字段或大小无效。')
  if (asset.source !== undefined) {
    const source = asset.source
    if (!source || typeof source !== 'object' || Object.keys(source).some(key => !['url', 'title', 'capturedAt'].includes(key)) || typeof source.title !== 'string' || source.title.length > 500 || !Number.isFinite(Date.parse(source.capturedAt))) fail('网页材料出处无效。')
    let url
    try { url = new URL(source.url) } catch { fail('网页材料地址无效。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || source.url.length > 8192) fail('网页材料地址无效。')
  }
  let decoded
  try { decoded = atob(asset.data) } catch { fail('材料包编码无效。') }
  if (btoa(decoded) !== asset.data) fail('材料包编码不规范。')
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0))
  if (bytes.length !== asset.byteLength || bytesToHex(sha256(bytes)) !== asset.id
    || asset.path !== `materials/${asset.id}/original.${materialExtension(bytes)}`) fail('材料包字节、路径或摘要不匹配。')
  return bytes
}
export function validateManagedAssets(assets) {
  if (!Array.isArray(assets) || assets.length > 10000) fail('材料包数量无效。')
  const ids = new Set()
  for (const asset of assets) { validateManagedAsset(asset); if (ids.has(asset.id)) fail('材料包身份重复。'); ids.add(asset.id) }
  return assets
}
export function collectManagedPaths(value, paths = new Set()) {
  if (Array.isArray(value)) value.forEach(item => collectManagedPaths(item, paths))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'assets') continue
      if ((key === 'path' || key === 'assetPath') && isManagedMaterialPath(item)) paths.add(item)
      else if (item && typeof item === 'object') collectManagedPaths(item, paths)
    }
  }
  return paths
}
export function validateAssetClosure(value, assets, { exact = false } = {}) {
  validateManagedAssets(assets)
  const paths = collectManagedPaths(value), supplied = new Set(assets.map(asset => asset.path))
  if ([...paths].some(path => !supplied.has(path)) || (exact && assets.some(asset => !paths.has(asset.path)))) fail('材料包不完整或包含无关原件。')
}
