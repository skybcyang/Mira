import { typed } from './domain/errors.js'
import { normalizeTags } from './v2-http-policy.js'

export function poolSnapshotInput(pool, input) {
  const ref = input.poolSource
  if (Object.keys(input).some((key) => !['poolSource', 'tags'].includes(key))
    || !ref || typeof ref !== 'object' || Array.isArray(ref)
    || Object.keys(ref).some((key) => !['poolId', 'entryId', 'versionId'].includes(key))
    || !['poolId', 'entryId', 'versionId'].every((key) => typeof ref[key] === 'string' && ref[key].trim())) {
    throw typed('BAD_REQUEST', '灵感快照只接受池、条目、版本与标签。')
  }
  const entry = pool?.id === ref.poolId ? pool.entries.find((item) => item.id === ref.entryId) : null
  const version = entry?.versions.find((item) => item.id === ref.versionId)
  if (!version || version.content?.kind !== 'markdown' || !version.content.markdown.trim()) {
    throw typed('BAD_REQUEST', '所选灵感版本已不可用，请重新选择。')
  }
  return {
    placement: 'board-bottom',
    markdown: version.content.markdown,
    tags: normalizeTags(input.tags ?? entry.tags ?? []),
    inspirationRef: { ...ref },
  }
}

export function createInspirationPoolHandlers({ poolStore } = {}) {
  if (!poolStore) throw new TypeError('An inspiration pool store is required')
  return {
    async getPool() {
      return { pool: await poolStore.load() }
    },
    async createEntry(body = {}) {
      return { entry: await poolStore.createEntry(body) }
    },
    async updateEntry(entryId, body = {}) {
      return { entry: await poolStore.updateEntry(entryId, body) }
    },
  }
}
