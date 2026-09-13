import { expect, it } from 'vitest'
import { exactItemCorrespondences } from './extractionComparison'

it('prefills only unique exact title and body matches, ignoring index, ids and similar text', () => {
  const old = [{ itemId: 'a', title: '同题', markdown: '相同正文' }, { itemId: 'b', title: '变化', markdown: '旧正文' }, { itemId: 'c', title: '重复', markdown: '重复正文' }]
  const next = [{ itemId: 'different-id', title: '同题', markdown: '相同正文' }, { itemId: 'b', title: '变化', markdown: '新正文' }, { itemId: 'd', title: '重复', markdown: '重复正文' }, { itemId: 'e', title: '重复', markdown: '重复正文' }]
  expect(exactItemCorrespondences(old, next)).toEqual({ a: 'different-id' })
  expect(exactItemCorrespondences([...old, { ...old[0], itemId: 'duplicate' }], next)).toEqual({})
  expect(exactItemCorrespondences(null, next)).toEqual({})
})
