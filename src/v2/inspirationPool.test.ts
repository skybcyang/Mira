import { describe, expect, it } from 'vitest'
import { filterInspirationPool, mapInspirationPoolSelectionToSnapshotInputs } from './inspiration'
import type { InspirationPool } from '../domain'

const now = '2026-09-04T00:00:00.000Z'

function pool(): InspirationPool {
  return {
    schemaVersion: 1,
    id: 'inspiration-pool',
    entries: [
      {
        id: 'idea-1',
        tags: ['主意', '技术'],
        headVersionId: 'idea-1-v1',
        versions: [{
          id: 'idea-1-v1', entryId: 'idea-1', sequence: 1,
          content: { kind: 'markdown', markdown: '独立的本地优先想法' },
          digest: 'digest-1', origin: 'human', createdAt: now,
        }],
        createdAt: now, updatedAt: now,
      },
      {
        id: 'idea-2',
        tags: ['约束'],
        headVersionId: 'idea-2-v1',
        versions: [{
          id: 'idea-2-v1', entryId: 'idea-2', sequence: 1,
          content: { kind: 'markdown', markdown: '响应式约束' },
          digest: 'digest-2', origin: 'human', createdAt: now,
        }],
        createdAt: now, updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

describe('inspiration pool projection', () => {
  it('filters pool entries without requiring a Board', () => {
    expect(filterInspirationPool(pool(), { query: '本地', tags: ['技术'] })[0]).toMatchObject({
      poolId: 'inspiration-pool',
      entryId: 'idea-1',
      versionId: 'idea-1-v1',
      content: { kind: 'markdown', markdown: '独立的本地优先想法' },
    })
  })

  it('sends only the chosen pool version and tags, leaving content and placement to the server', () => {
    const [input] = mapInspirationPoolSelectionToSnapshotInputs(
      filterInspirationPool(pool(), { query: '', tags: [] }),
      { x: 500, y: 300 },
    )

    expect(input).toEqual({
      tags: ['主意', '技术'],
      poolSource: {
        poolId: 'inspiration-pool',
        entryId: 'idea-1',
        versionId: 'idea-1-v1',
      },
    })
  })
})
