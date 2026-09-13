import { sha256Text } from './digests.js'
import { assembleScopedText } from './sourceScopes.js'

const invalid = () => { throw Object.assign(new Error('材料出处或所选范围无效。'), { code: 'MATERIAL_INVALID' }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key))
const string = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\u0000\ufffd]/u.test(value)
const url = value => {
  try { const parsed = new URL(value); return string(value, 8192) && ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash } catch { return false }
}
export function validateMaterialOrigin(origin) {
  if (!keys(origin, ['kind', 'title', 'url', 'requestedUrl', 'path', 'assetPath', 'capturedAt', 'sourceDigest', 'textDigest', 'reader', 'locators'])
    || !['web', 'pdf'].includes(origin.kind) || !string(origin.title, 500)
    || !string(origin.capturedAt, 64) || !Number.isFinite(Date.parse(origin.capturedAt))
    || !['sourceDigest', 'textDigest'].every(key => typeof origin[key] === 'string' && /^[a-f0-9]{64}$/.test(origin[key]))
    || !keys(origin.reader, ['id', 'version']) || !string(origin.reader.id, 128) || !string(origin.reader.version, 64)
    || !Array.isArray(origin.locators) || !origin.locators.length || origin.locators.length > 100) invalid()
  if (origin.assetPath !== undefined && (typeof origin.assetPath !== 'string' || !/^materials\/[a-f0-9]{64}\/original\.(txt|pdf|bin)$/.test(origin.assetPath))) invalid()
  if (origin.kind === 'web' ? !url(origin.url) || origin.path !== undefined || (origin.requestedUrl !== undefined && !url(origin.requestedUrl))
    : !string(origin.path, 4096) || /^(?:\/|\\|[a-z]:)/i.test(origin.path) || origin.path.split(/[\\/]/).some(part => part === '..' || part === '.') || origin.url !== undefined || origin.requestedUrl !== undefined) invalid()
  for (const span of origin.locators) {
    if (!keys(span, ['start', 'end', 'page']) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
      || span.start < 0 || span.end <= span.start || span.end > 1000000
      || (origin.kind === 'pdf' ? !Number.isInteger(span.page) || span.page < 1 || span.page > 500 : span.page !== undefined)) invalid()
  }
  const sorted = [...origin.locators].sort((a, b) => a.start - b.start)
  if (sorted.some((span, index) => index > 0 && span.start < sorted[index - 1].end)) invalid()
  return origin
}

export function selectMaterial(preview, spans) {
  // Shared validation checks exact UTF-16 boundaries, overlap, blank text and count.
  try { assembleScopedText(preview.text, spans) } catch { invalid() }
  const locators = [], parts = []
  for (const span of spans) {
    if (preview.pages) {
      for (const page of preview.pages) {
        if (page.status === 'unreadable' && span.start <= page.start && span.end >= page.end) invalid()
        const start = Math.max(page.start, span.start), end = Math.min(page.end, span.end)
        if (start >= end || !preview.text.slice(start, end).trim()) continue
        if (page.status !== 'text') invalid()
        locators.push({ start, end, page: page.page })
        parts.push(`【物理页 ${page.page}】\n${preview.text.slice(start, end)}`)
      }
    } else {
      locators.push({ ...span })
      parts.push(assembleScopedText(preview.text, [span]).resolvedContent)
    }
  }
  const materialOrigin = validateMaterialOrigin({ ...preview.origin, locators })
  return { markdown: parts.join('\n\n'), materialOrigin }
}
export function materialTextDigest(text) { return sha256Text(text).slice(7) }
