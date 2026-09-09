import { describe, expect, it } from 'vitest'
import type { CardVersion, ContentCard } from '../domain'
import {
  cardVersionComparison,
  cardVersionRows,
  restoreVersionMessage,
  selectedCardVersion,
} from './cardVersions'

function version(
  id: string,
  sequence: number,
  origin: CardVersion['origin'],
  content: CardVersion['content'] = { kind: 'markdown', markdown: `# version ${sequence}` },
): CardVersion {
  return {
    id,
    cardId: 'card-1',
    sequence,
    content,
    digest: `digest-${sequence}`,
    origin,
    createdAt: `2026-09-0${sequence}T08:00:00.000Z`,
  }
}

function card(versions: CardVersion[], headVersionId = versions[versions.length - 1]?.id || null): ContentCard {
  return {
    id: 'card-1',
    contentKind: versions[0]?.content.kind || 'markdown',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId,
    versions,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
  }
}

describe('card version projection', () => {
  it('maps newest-first rows with stable origin labels and the current marker', () => {
    const target = card([
      version('v1', 1, 'human'),
      version('v2', 2, 'ai'),
      version('v3', 3, 'restore'),
      version('v4', 4, 'import'),
    ])

    expect(cardVersionRows(target)).toEqual([
      expect.objectContaining({ id: 'v4', label: 'v4', originLabel: '导入', isCurrent: true }),
      expect.objectContaining({ id: 'v3', label: 'v3', originLabel: '恢复', isCurrent: false }),
      expect.objectContaining({ id: 'v2', label: 'v2', originLabel: '生成结果', isCurrent: false }),
      expect.objectContaining({ id: 'v1', label: 'v1', originLabel: '人工编辑', isCurrent: false }),
    ])
  })

  it('reports an explicit empty state when two markdown versions have the same body', () => {
    const earlier = version('v1', 1, 'human', { kind: 'markdown', markdown: '# 相同正文' })
    const current = version('v2', 2, 'restore', { kind: 'markdown', markdown: '# 相同正文' })

    expect(cardVersionComparison(earlier, current)).toMatchObject({
      hasChanges: false,
      emptyMessage: '所选版本与当前版本的正文没有变化。',
    })
  })

  it('bounds line-diff work without claiming long different documents are identical', () => {
    const earlier = version('v1', 1, 'human', { kind: 'markdown', markdown: 'old\n'.repeat(1100) })
    const current = version('v2', 2, 'human', { kind: 'markdown', markdown: 'new\n'.repeat(1100) })
    expect(cardVersionComparison(earlier, current)).toMatchObject({ tooLarge: true, hasChanges: true, lines: [] })
  })

  it('compares both the path and readonly state of file-reference versions', () => {
    const earlier = version('v1', 1, 'import', {
      kind: 'file-reference', path: 'reference/brief.md', readonly: true,
    })
    const current = version('v2', 2, 'import', {
      kind: 'file-reference', path: 'reference/brief.md', readonly: false,
    })

    expect(cardVersionComparison(earlier, current)).toMatchObject({
      hasChanges: true,
      lines: expect.arrayContaining([
        { kind: 'removed', text: '状态：只读' },
        { kind: 'added', text: '状态：可写' },
      ]),
    })
  })

  it('names the next appended version and keeps the selected history after Head changes', () => {
    const before = card([
      version('v1', 1, 'human'),
      version('v7', 7, 'human'),
    ])
    const after = card([
      ...before.versions,
      version('v8', 8, 'restore'),
    ])

    expect(restoreVersionMessage(before)).toBe('将创建 v8，旧版本保持不变。')
    expect(selectedCardVersion(after, 'v1')?.id).toBe('v1')
  })
})
