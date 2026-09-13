import { parseExtractionList } from '../../src/domain/extraction.js'
import { appendVersion } from './versioning.js'
import { typed } from './errors.js'

const invalid = () => typed('EXTRACTION_REVISION_INVALID', '请核对旧卡、当前清单条目和拟采用正文。')
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)

export function reviseExtractionCard(board, cardId, body, { versionId, now }) {
  if (!record(body) || Object.keys(body).some(key => !['baseVersionId', 'source', 'markdown'].includes(key))
    || typeof body.baseVersionId !== 'string' || !body.baseVersionId
    || !record(body.source) || Object.keys(body.source).some(key => !['cardId', 'versionId', 'itemIds'].includes(key))
    || typeof body.markdown !== 'string' || !body.markdown.trim() || body.markdown.length > 1000000
    || !Array.isArray(body.source.itemIds) || body.source.itemIds.length < 1 || body.source.itemIds.length > 100
    || new Set(body.source.itemIds).size !== body.source.itemIds.length) throw invalid()
  const target = board.cards.find(card => card.id === cardId)
  const source = board.cards.find(card => card.id === body.source.cardId)
  if (!target || !source || target.id === source.id || target.contentKind !== 'markdown'
    || target.extractionRef?.boardId !== board.id || target.extractionRef.cardId !== source.id) throw invalid()
  if (target.headVersionId !== body.baseVersionId) throw typed('CARD_VERSION_CONFLICT', '旧卡已有新版本，请保留草稿并重新核对。')
  if (source.headVersionId !== body.source.versionId) throw typed('SOURCE_VERSION_CHANGED', '清单已有新版本，请保留草稿并重新核对。')
  const sourceVersion = source.versions.find(version => version.id === body.source.versionId)
  const items = sourceVersion?.content.kind === 'markdown' ? parseExtractionList(sourceVersion.content.markdown) : null
  if (!items || body.source.itemIds.some(id => typeof id !== 'string' || !items.some(item => item.itemId === id))) throw invalid()
  const head = target.versions.find(version => version.id === target.headVersionId)
  if (head?.content.kind !== 'markdown') throw invalid()
  if (head.content.markdown === body.markdown) return { card: target, noop: true }
  const card = appendVersion(target, {
    baseVersionId: body.baseVersionId, versionId, createdAt: now, origin: 'human',
    content: { kind: 'markdown', markdown: body.markdown },
    extractionSources: body.source.itemIds.map(itemId => ({ boardId: board.id, cardId: source.id, versionId: sourceVersion.id, itemId })),
  })
  return { card, noop: false }
}
