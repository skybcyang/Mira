import { typed } from './domain/errors.js'
import { materialTextDigest, selectMaterial } from '../src/domain/materials.js'
import { normalizeTags } from './v2-http-policy.js'

const TTL = 600000, MAX_BYTES = 64 * 1024 * 1024
const fail = (code, message) => { throw typed(code, message) }
const inputKeys = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('MATERIAL_INVALID', '材料请求字段无效。')
}
export function createMaterialService({ readers = {}, createCard, capture, managedMaterials, newId = () => crypto.randomUUID(), now = Date.now } = {}) {
  const previews = new Map(), pending = new Set()
  let reserved = 0, closed = false
  const release = id => { const entry = previews.get(id); if (entry?.state === 'writing') return; entry?.dispose?.(); previews.delete(id) }
  const sweep = () => { for (const [id, entry] of previews) if (entry.expires <= now()) release(id) }
  const timer = setInterval(sweep, 30000); timer.unref?.()
  const get = id => { sweep(); const entry = previews.get(id); if (!entry || entry.expires <= now()) fail('MATERIAL_PREVIEW_EXPIRED', '阅读预览已过期，请重新读取并核对。'); return entry }
  async function saveOriginal(id) {
    const entry = get(id)
    if (!managedMaterials) fail('MATERIAL_UNAVAILABLE', '当前宿主不支持收纳原件。')
    if (!entry.original) {
      entry.original = entry.preview.origin.kind === 'web'
        ? managedMaterials.importText(entry.preview.text, entry.preview.origin.title, { url: entry.preview.origin.url, title: entry.preview.origin.title, capturedAt: entry.preview.origin.capturedAt })
        : managedMaterials.importFile(entry.preview.origin.path).then(result => {
          if (result.asset.sha256 !== entry.preview.origin.sourceDigest) fail('MATERIAL_PREVIEW_CONFLICT', 'PDF 在阅读后发生变化，请重新读取并核对。')
          return result
        })
      entry.original.catch(() => { entry.original = undefined })
    }
    return entry.original
  }
  async function consume(destination, body, save, captureMode = false) {
    inputKeys(body, captureMode ? ['previewId', 'spans', 'note', 'tags'] : ['previewId', 'spans'])
    const entry = get(body.previewId)
    let note, tags
    if (captureMode) {
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 20000)) fail('MATERIAL_INVALID', '备注最多 20,000 字。')
      note = body.note || ''; tags = normalizeTags(body.tags || [])
    }
    const selected = selectMaterial(entry.preview, body.spans)
    const fingerprint = materialTextDigest(JSON.stringify({ destination, spans: selected.materialOrigin.locators, note, tags }))
    if (entry.state === 'saved' && entry.fingerprint === fingerprint) return structuredClone(entry.result)
    if (entry.state !== 'ready') fail('MATERIAL_PREVIEW_CONFLICT', '这份预览已保存或结果待核对，请刷新核对，不要重复提交。')
    if (!save) fail('MATERIAL_UNAVAILABLE', '当前宿主不支持材料保存。')
    entry.state = 'writing'
    try {
      if (managedMaterials) selected.materialOrigin.assetPath = (await saveOriginal(body.previewId)).path
      const input = captureMode ? { ...selected, tags, markdown: `${selected.markdown.split('\n').map(line => `> ${line}`).join('\n')}${note ? `\n\n## 我的备注\n\n${note}` : ''}` } : { ...selected, name: entry.preview.origin.title.slice(0, 120) }
      const result = await save(input)
      entry.state = 'saved'; entry.fingerprint = fingerprint; entry.result = structuredClone(result)
      return result
    } catch (error) {
      // Known command rejections are safe; unknown errors require inspecting the destination.
      entry.state = error?.code && /^(BOARD_|CARD_|INSPIRATION_|MATERIAL_|VALIDATION_)/.test(error.code) ? 'ready' : 'uncertain'
      throw error
    }
  }
  return {
    saveOriginal,
    async preview(input, { signal } = {}) {
      inputKeys(input, input?.kind === 'web' ? ['kind', 'url'] : ['kind', 'path'])
      if (!['web', 'pdf'].includes(input.kind) || typeof input[input.kind === 'web' ? 'url' : 'path'] !== 'string') fail('MATERIAL_INVALID', '请选择网页地址或 PDF 文件。')
      if (!readers[input.kind] || closed) fail('MATERIAL_UNAVAILABLE', '当前宿主不支持这种材料读取。')
      sweep()
      const reservation = input.kind === 'pdf' ? 29 * 1024 * 1024 : 9 * 1024 * 1024
      if (previews.size + pending.size >= 5 || reserved + reservation + [...previews.values()].reduce((sum, item) => sum + item.bytes, 0) > MAX_BYTES) fail('MATERIAL_LIMIT', '打开的阅读预览过多，请关闭一份后再读取。')
      const controller = new AbortController(); pending.add(controller); reserved += reservation
      const abort = () => controller.abort()
      if (signal?.aborted) abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(), input.kind === 'web' ? 20000 : 60000)
      try {
        const result = await readers[input.kind](input, { signal: controller.signal })
        if (controller.signal.aborted || closed) { result.dispose?.(); fail('MATERIAL_READ_FAILED', '读取已取消或超时。') }
        if (typeof result.text !== 'string' || result.text.length > 1000000 || (!result.text.trim() && !result.pages)) { result.dispose?.(); fail('MATERIAL_LIMIT', '正文为空或超过读取上限。') }
        if (!Number.isSafeInteger(result.byteLength) || result.byteLength < 0 || result.byteLength > (input.kind === 'pdf' ? 25 : 5) * 1024 * 1024) { result.dispose?.(); fail('MATERIAL_LIMIT', '材料超过读取上限。') }
        const previewId = newId('material-preview'), expires = now() + TTL
        const origin = { kind: input.kind, title: result.title || '未命名材料', ...(input.kind === 'web' ? { url: result.url, ...(result.requestedUrl ? { requestedUrl: result.requestedUrl } : {}) } : { path: input.path }), capturedAt: new Date(now()).toISOString(), sourceDigest: result.sourceDigest, textDigest: materialTextDigest(result.text), reader: result.reader }
        const preview = { previewId, expiresAt: new Date(expires).toISOString(), origin, text: result.text, ...(result.pages ? { pages: result.pages } : {}), warnings: result.warnings || [] }
        previews.set(previewId, { preview, expires, bytes: result.byteLength + result.text.length * 2, state: 'ready', render: result.render, dispose: result.dispose })
        return { preview: structuredClone(preview) }
      } finally { signal?.removeEventListener('abort', abort); clearTimeout(timeout); pending.delete(controller); reserved -= reservation }
    },
    async page(id, page) {
      const entry = get(id)
      if (!entry.render || !Number.isInteger(page) || !entry.preview.pages?.some(item => item.page === page)) fail('MATERIAL_INVALID', '页面不存在。')
      return { image: await entry.render(page) }
    },
    release(id) { release(id); return { released: true } },
    saveCard(boardId, body) { return consume(`board:${boardId}`, body, input => createCard(boardId, input)) },
    saveCapture(body) { return consume('pool', body, capture, true) },
    close() { closed = true; clearInterval(timer); for (const controller of pending) controller.abort(); for (const id of previews.keys()) release(id) },
  }
}
