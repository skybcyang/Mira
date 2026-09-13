import { expect, it } from 'vitest'
import { reviseExtractionCard } from '../../bridge/domain/extraction-revisions.js'
import { appendVersion, restoreVersion } from '../../bridge/domain/versioning.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

function fixture() {
  const make = (id, markdown) => appendVersion({ id, contentKind: 'markdown', headVersionId: null, versions: [] }, { baseVersionId: null, versionId: `${id}-v1`, content: { kind: 'markdown', markdown }, origin: 'human', createdAt: 'now' })
  const list = make('list', '<!-- mira:extraction:v1 -->\n<!-- mira:item:new -->\n## 新观点\n新证据\n<!-- mira:end -->')
  const old = make('old', '旧观点\n我的补充')
  old.extractionRef = { boardId: 'board', cardId: 'list', versionId: 'historical-list', itemId: 'old', batchId: 'batch' }
  const board = { ...emptyBoardV2('board', '对照'), cards: [list, old] }
  const body = { baseVersionId: old.headVersionId, source: { cardId: list.id, versionId: list.headVersionId, itemIds: ['new'] }, markdown: '新证据\n我的补充' }
  return { board, body }
}

it('updates only the chosen old card, preserves its original provenance and supports restored provenance', () => {
  const { board, body } = fixture()
  const before = structuredClone(board)
  const result = reviseExtractionCard(board, 'old', body, { versionId: 'old-v2', now: 'later' })
  expect(board).toEqual(before)
  expect(result.card.extractionRef).toEqual(before.cards[1].extractionRef)
  expect(result.card.versions.at(-1)).toMatchObject({ origin: 'human', extractionSources: [{ boardId: 'board', cardId: 'list', versionId: 'list-v1', itemId: 'new' }] })
  expect(result.card.versions.at(-1).sourceRunId).toBeUndefined()
  const restored = restoreVersion(result.card, 'old-v2', { baseVersionId: 'old-v2', versionId: 'old-v3', createdAt: 'next' })
  expect(restored.versions.at(-1).extractionSources).toEqual(result.card.versions.at(-1).extractionSources)
})

it('rejects stale source or target and unknown items, and creates no version for identical text', () => {
  const { board, body } = fixture()
  const options = { versionId: 'next', now: 'next' }
  expect(() => reviseExtractionCard(board, 'old', { ...body, baseVersionId: 'stale' }, options)).toThrow()
  expect(() => reviseExtractionCard(board, 'old', { ...body, source: { ...body.source, versionId: 'stale' } }, options)).toThrow()
  expect(() => reviseExtractionCard(board, 'old', { ...body, source: { ...body.source, itemIds: ['unknown'] } }, options)).toThrow()
  expect(reviseExtractionCard(board, 'old', { ...body, markdown: '旧观点\n我的补充' }, options)).toMatchObject({ noop: true, card: board.cards[1] })
})
