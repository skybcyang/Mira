import { digestContent, isUsableContent } from './domain/content.js'
import { typed } from './domain/errors.js'
import { nextUpdatedAt, normalizeTags } from './v2-http-policy.js'

export const INSPIRATION_POOL_ID = 'inspiration-pool'
export const INSPIRATION_POOL_PATH = 'inspiration-pool-v2.json'

export function emptyInspirationPool(now = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    id: INSPIRATION_POOL_ID,
    entries: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function validateInspirationPool(pool) {
  const errors = []
  if (!pool || pool.schemaVersion !== 1 || pool.id !== INSPIRATION_POOL_ID) {
    return ['inspiration pool schema is invalid']
  }
  if (!Array.isArray(pool.entries)) errors.push('inspiration pool entries must be an array')
  if (typeof pool.createdAt !== 'string' || !pool.createdAt) errors.push('pool createdAt is invalid')
  if (typeof pool.updatedAt !== 'string' || !pool.updatedAt) errors.push('pool updatedAt is invalid')

  const entryIds = new Set()
  const versionIds = new Set()
  for (const entry of pool.entries || []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || entryIds.has(entry.id)) {
      errors.push(`entry id is invalid or duplicated: ${entry?.id}`)
      continue
    }
    entryIds.add(entry.id)
    if (entry.tags !== undefined) {
      try { normalizeTags(entry.tags) } catch { errors.push(`entry ${entry.id} has invalid tags`) }
    }
    if (!Array.isArray(entry.versions)) {
      errors.push(`entry ${entry.id} versions must be an array`)
      continue
    }
    if (entry.headVersionId !== null && !entry.versions.some((version) => version.id === entry.headVersionId)) {
      errors.push(`entry ${entry.id} head version is missing`)
    }
    entry.versions.forEach((version, index) => {
      if (!version || typeof version.id !== 'string' || !version.id.trim() || versionIds.has(version.id)) {
        errors.push(`entry ${entry.id} has invalid or duplicated version`)
        return
      }
      versionIds.add(version.id)
      if (version.entryId !== entry.id || version.sequence !== index + 1) {
        errors.push(`entry ${entry.id} version sequence or owner is invalid`)
      }
      if (!isUsableContent(version.content) || version.content.kind !== 'markdown') {
        errors.push(`entry ${entry.id} version content is invalid`)
      }
      if (typeof version.digest !== 'string' || !version.digest || typeof version.createdAt !== 'string' || !version.createdAt) {
        errors.push(`entry ${entry.id} version metadata is invalid`)
      }
      if (!['human', 'restore', 'import'].includes(version.origin)) {
        errors.push(`entry ${entry.id} version origin is invalid`)
      }
    })
    if (typeof entry.createdAt !== 'string' || !entry.createdAt || typeof entry.updatedAt !== 'string' || !entry.updatedAt) {
      errors.push(`entry ${entry.id} timestamps are invalid`)
    }
  }
  return errors
}

function assertValid(pool) {
  const errors = validateInspirationPool(pool)
  if (errors.length > 0) throw typed('INSPIRATION_INVALID', errors.join('; '), errors)
}

export class InspirationPoolStore {
  constructor(fs, options = {}) {
    this.fs = fs
    this.path = options.path || INSPIRATION_POOL_PATH
    this.newId = options.newId || ((prefix) => `${prefix}-${Date.now().toString(36)}`)
    this.now = options.now || (() => new Date().toISOString())
    this.coordinator = options.coordinator
    this.mutationQueue = Promise.resolve()
  }

  async load() {
    let text
    try {
      text = await this.fs.readText(this.path)
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyInspirationPool(this.now())
      throw typed('INSPIRATION_READ_FAILED', '灵感池无法读取')
    }
    let pool
    try { pool = JSON.parse(text) } catch { throw typed('INSPIRATION_INVALID', '灵感池不是有效 JSON') }
    assertValid(pool)
    return pool
  }

  async save(pool) {
    assertValid(pool)
    const tempPath = `${this.path}.tmp`
    try {
      await this.fs.writeText(tempPath, JSON.stringify(pool, null, 2))
      const verified = JSON.parse(await this.fs.readText(tempPath))
      assertValid(verified)
      if (JSON.stringify(verified) !== JSON.stringify(pool)) throw new Error('temporary pool changed')
      await this.fs.replace(tempPath, this.path)
      return pool
    } catch (error) {
      throw typed('INSPIRATION_WRITE_FAILED', `灵感池无法安全保存：${error?.message || error}`)
    }
  }

  async update(change) {
    const operation = async () => {
      const current = await this.load()
      const next = await change(structuredClone(current))
      next.updatedAt = this.now()
      return this.save(next)
    }
    const pending = this.mutationQueue.then(() => this.coordinator?.withMutation ? this.coordinator.withMutation(operation) : operation())
    this.mutationQueue = pending.catch(() => {})
    return pending
  }

  async updateEntry(entryId, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['markdown', 'tags', 'baseVersionId', 'baseUpdatedAt'].includes(key))
      || typeof body.markdown !== 'string' || !body.markdown.trim()
      || !Array.isArray(body.tags)
      || typeof body.baseVersionId !== 'string' || !body.baseVersionId
      || typeof body.baseUpdatedAt !== 'string' || !body.baseUpdatedAt) {
      throw typed('BAD_REQUEST', '灵感内容和编辑基线不完整，请重新打开后重试。')
    }
    const tags = normalizeTags(body.tags)
    const content = { kind: 'markdown', markdown: body.markdown.trim() }
    let updated
    await this.update(pool => {
      const entry = pool.entries.find(item => item.id === entryId)
      if (!entry) throw typed('INSPIRATION_NOT_FOUND', '灵感条目已不存在。')
      if (entry.headVersionId !== body.baseVersionId || entry.updatedAt !== body.baseUpdatedAt) {
        throw typed('INSPIRATION_CONFLICT', '这条灵感已被修改，请核对最新内容。')
      }
      const head = entry.versions.find(item => item.id === entry.headVersionId)
      const changed = head.content.markdown !== content.markdown
      if (changed || JSON.stringify(tags) !== JSON.stringify(entry.tags ?? [])) {
        const timestamp = nextUpdatedAt(entry.updatedAt, this.now())
        if (changed) {
          const version = { id: this.newId('inspiration-version'), entryId, sequence: entry.versions.length + 1, content, digest: digestContent(content), origin: 'human', createdAt: timestamp }
          entry.versions.push(version)
          entry.headVersionId = version.id
        }
        entry.tags = tags
        entry.updatedAt = timestamp
      }
      updated = entry
      return pool
    })
    return updated
  }

  async createEntry({ markdown, tags = [] } = {}) {
    const content = { kind: 'markdown', markdown: String(markdown || '').trim() }
    if (!content.markdown) throw typed('INSPIRATION_INVALID', '灵感内容不能为空')
    const normalizedTags = normalizeTags(tags)
    let created
    await this.update((pool) => {
      const timestamp = this.now()
      const entryId = this.newId('inspiration')
      const versionId = this.newId('inspiration-version')
      const entry = {
        id: entryId,
        tags: normalizedTags,
        headVersionId: versionId,
        versions: [{
          id: versionId,
          entryId,
          sequence: 1,
          content,
          digest: digestContent(content),
          origin: 'human',
          createdAt: timestamp,
        }],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      pool.entries.push(entry)
      created = entry
      return pool
    })
    return created
  }
}
