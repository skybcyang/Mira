import { describe, expect, it } from 'vitest'
import type { ContentCard } from './domain'
import {
  cardSummary,
  canvasCardTags,
  createCustomSuggestion,
  diffLines,
  sourceCardPresentations,
  versionTimeline,
} from './v2View'

const card: ContentCard = {
  id: 'card-1',
  contentKind: 'markdown',
  x: 0,
  y: 0,
  width: 312,
  height: 208,
  headVersionId: 'v2',
  versions: [
    {
      id: 'v1', cardId: 'card-1', sequence: 1, digest: 'a', origin: 'human',
      createdAt: '2026-08-23T01:00:00.000Z', content: { kind: 'markdown', markdown: '# 初稿\n第一段' },
    },
    {
      id: 'v2', cardId: 'card-1', sequence: 2, digest: 'b', origin: 'ai',
      createdAt: '2026-08-23T02:00:00.000Z', content: { kind: 'markdown', markdown: '# 决策稿\n第一段\n新增' },
    },
  ],
  createdAt: '2026-08-23T01:00:00.000Z',
  updatedAt: '2026-08-23T02:00:00.000Z',
}

describe('v2 view model', () => {
  it('uses independent names without changing content or legacy fallback', () => {
    const named = { ...card, name: '本地文件同步' }
    expect(cardSummary(named).title).toBe('本地文件同步')
    expect(sourceCardPresentations([named])[0].label).toBe('本地文件同步')
    expect(cardSummary(card).title).toBe('决策稿')
    expect(named.versions).toEqual(card.versions)
  })
  it('uses the latest readable content without exposing markdown syntax', () => {
    expect(cardSummary(card)).toEqual({ title: '决策稿', preview: '第一段 新增' })
  })

  it('presents at most two canvas tags while preserving the full accessible label', () => {
    expect(canvasCardTags([])).toEqual({ visible: [], overflow: 0, accessibleLabel: undefined })
    expect(canvasCardTags(['研究'])).toEqual({
      visible: ['研究'], overflow: 0, accessibleLabel: '标签：研究',
    })
    expect(canvasCardTags(['研究', '决策', '这是一个很长但不能丢失的中文标签'])).toEqual({
      visible: ['研究', '决策'],
      overflow: 1,
      accessibleLabel: '标签：研究、决策、这是一个很长但不能丢失的中文标签',
    })
    const many = Array.from({ length: 20 }, (_, index) => `标签${index + 1}`)
    expect(canvasCardTags(many)).toMatchObject({ visible: ['标签1', '标签2'], overflow: 18 })
  })

  it('keeps custom generation available independently of suggestions', () => {
    expect(createCustomSuggestion('  一页试点决策  ')).toEqual({
      id: 'custom', label: '一页试点决策', instruction: '一页试点决策', acceptance: '',
    })
    expect(createCustomSuggestion('   ')).toBeNull()
  })

  it('names file sources by basename and disambiguates duplicates with the shortest parent suffix', () => {
    const fileCard = (id: string, path: string): ContentCard => ({
      ...card,
      id,
      contentKind: 'file-reference',
      headVersionId: `${id}-v1`,
      versions: [{
        ...card.versions[0],
        id: `${id}-v1`,
        cardId: id,
        content: { kind: 'file-reference', path, readonly: true },
      }],
    })

    expect(sourceCardPresentations([
      fileCard('first', ' research//alpha/./brief.md '),
      fileCard('second', 'research\\beta\\brief.md'),
      fileCard('third', 'research/beta/notes.md'),
    ])).toEqual([
      { cardId: 'first', label: 'alpha/brief.md', fullPath: 'research/alpha/brief.md' },
      { cardId: 'second', label: 'beta/brief.md', fullPath: 'research/beta/brief.md' },
      { cardId: 'third', label: 'notes.md', fullPath: 'research/beta/notes.md' },
    ])
  })

  it('falls back from an unusable file basename without changing markdown summaries', () => {
    const fileCard = (id: string, path: string): ContentCard => ({
      ...card,
      id,
      contentKind: 'file-reference',
      headVersionId: `${id}-v1`,
      versions: [{
        ...card.versions[0],
        id: `${id}-v1`,
        cardId: id,
        content: { kind: 'file-reference', path, readonly: true },
      }],
    })

    expect(sourceCardPresentations([fileCard('root', ' / '), fileCard('blank', '  ')])).toEqual([
      { cardId: 'root', label: '/', fullPath: '/' },
      { cardId: 'blank', label: '文件材料' },
    ])
    expect(cardSummary(card)).toEqual({ title: '决策稿', preview: '第一段 新增' })
  })

  it('shows newest versions first and produces a line-level comparison', () => {
    expect(versionTimeline(card).map((version) => version.id)).toEqual(['v2', 'v1'])
    expect(diffLines('# 初稿\n第一段', '# 决策稿\n第一段\n新增')).toEqual([
      { kind: 'removed', text: '# 初稿' },
      { kind: 'added', text: '# 决策稿' },
      { kind: 'same', text: '第一段' },
      { kind: 'added', text: '新增' },
    ])
  })
})
