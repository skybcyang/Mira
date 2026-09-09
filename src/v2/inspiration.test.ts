import { describe, expect, it } from 'vitest'
import type { BoardV2, CardContent, ContentCard } from '../domain'
import * as inspirationPolicy from './inspiration'
import {
  filterInspirationCards,
  mapInspirationSelectionToSnapshots,
  toggleInspirationSelection,
} from './inspiration'

const now = '2026-09-01T00:00:00.000Z'

interface InspirationCandidate {
  key: string
  boardId: string
  boardTitle: string
  cardId: string
  versionId: string
  content: CardContent
  tags: string[]
  width: number
  height: number
  updatedAt: string
}

interface InspirationSnapshotPlan {
  createInputs: Array<{
    x: number
    y: number
    width: number
    height: number
    contentKind: ContentCard['contentKind']
    tags: string[]
    inspirationRef: { boardId: string; cardId: string; versionId: string }
    markdown?: string
    filePath?: string
    readonly?: boolean
  }>
  selection: Array<
    | { kind: 'existing'; cardId: string }
    | { kind: 'create'; createIndex: number }
  >
}

type FilterInspirationCards = (
  board: BoardV2,
  filters: { query: string; tags: string[] },
) => InspirationCandidate[]
type ToggleInspirationSelection = (
  selected: InspirationCandidate[],
  candidate: InspirationCandidate,
) => InspirationCandidate[]
type MapInspirationSelectionToSnapshots = (
  selected: InspirationCandidate[],
  currentBoardId: string,
  anchor: { x: number; y: number },
) => InspirationSnapshotPlan
type MapInspirationCaptureToCardInput = (
  sourceBoard: BoardV2,
  capture: { markdown: string; tags: string[] },
) => {
  contentKind: 'markdown'
  markdown: string
  tags: string[]
  placement: 'board-bottom'
  width: number
  height: number
  inspirationRef?: never
}
type InspirationCaptureErrorMessage = (error: unknown) => string
type AppendInspirationCaptureTag = (tags: string[], rawTag: string) => string[]

const filterCards = filterInspirationCards as unknown as FilterInspirationCards
const toggleSelection = toggleInspirationSelection as unknown as ToggleInspirationSelection
const mapSnapshots = mapInspirationSelectionToSnapshots as unknown as MapInspirationSelectionToSnapshots
const mapCapture = (inspirationPolicy as unknown as {
  mapInspirationCaptureToCardInput?: MapInspirationCaptureToCardInput
}).mapInspirationCaptureToCardInput
const captureErrorMessage = (inspirationPolicy as unknown as {
  inspirationCaptureErrorMessage?: InspirationCaptureErrorMessage
}).inspirationCaptureErrorMessage
const appendCaptureTag = (inspirationPolicy as unknown as {
  appendInspirationCaptureTag?: AppendInspirationCaptureTag
}).appendInspirationCaptureTag

type TaggedCard = ContentCard & {
  tags?: string[]
  inspirationRef?: { boardId: string; cardId: string; versionId: string }
}

function markdownCard(
  id: string,
  markdown: string,
  tags: string[] = [],
  options: { previousMarkdown?: string; headVersionId?: string | null } = {},
): TaggedCard {
  const versions = [
    ...(options.previousMarkdown === undefined ? [] : [{
      id: `${id}-v1`,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown' as const, markdown: options.previousMarkdown },
      digest: `${id}-digest-1`,
      origin: 'human' as const,
      createdAt: now,
    }]),
    {
      id: `${id}-v2`,
      cardId: id,
      sequence: options.previousMarkdown === undefined ? 1 : 2,
      content: { kind: 'markdown' as const, markdown },
      digest: `${id}-digest-2`,
      origin: 'human' as const,
      createdAt: now,
    },
  ]
  return {
    id,
    contentKind: 'markdown',
    tags,
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: options.headVersionId === undefined ? `${id}-v2` : options.headVersionId,
    versions,
    createdAt: now,
    updatedAt: now,
  }
}

function fileCard(id: string, path: string, tags: string[] = []): TaggedCard {
  return {
    id,
    contentKind: 'file-reference',
    tags,
    x: 0,
    y: 0,
    width: 360,
    height: 220,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`,
      cardId: id,
      sequence: 1,
      content: { kind: 'file-reference', path, readonly: true },
      digest: `${id}-digest-1`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function board(cards: TaggedCard[], id = 'pool', title = '灵感池'): BoardV2 {
  return {
    schemaVersion: 2,
    id,
    title,
    cards,
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function candidate(
  boardId: string,
  cardId: string,
  content: CardContent = { kind: 'markdown', markdown: cardId },
  tags: string[] = [],
): InspirationCandidate {
  return {
    key: `${boardId}\u0000${cardId}\u0000${cardId}-v1`,
    boardId,
    boardTitle: boardId === 'current' ? '当前课题' : '灵感池',
    cardId,
    versionId: `${cardId}-v1`,
    content,
    tags,
    width: content.kind === 'markdown' ? 312 : 360,
    height: content.kind === 'markdown' ? 208 : 220,
    updatedAt: now,
  }
}

describe('inspiration candidates', () => {
  it('projects only the current usable Head and never matches historical text', () => {
    const source = board([
      markdownCard('idea', 'Current local-first direction', ['技术'], {
        previousMarkdown: 'Retired cloud-only direction',
      }),
      markdownCard('empty', '   ', ['主意']),
      markdownCard('dangling', 'Invisible content', ['事件'], { headVersionId: 'missing' }),
      { ...markdownCard('no-head', 'Invisible without a Head'), headVersionId: null, versions: [] },
    ])

    expect(filterCards(source, { query: 'cloud-only', tags: [] })).toEqual([])
    expect(filterCards(source, { query: 'CURRENT LOCAL-FIRST', tags: [] })).toEqual([
      expect.objectContaining({
        boardId: 'pool',
        boardTitle: '灵感池',
        cardId: 'idea',
        versionId: 'idea-v2',
        content: { kind: 'markdown', markdown: 'Current local-first direction' },
        tags: ['技术'],
      }),
    ])
  })

  it('matches trimmed case-insensitive content and requires every selected tag', () => {
    const source = board([
      markdownCard('both', 'A LOCAL-first constraint for the product', ['技术', '约束']),
      markdownCard('one-tag', 'Another local-first approach', ['技术']),
      markdownCard('tag-only', 'Unrelated body', ['LOCAL', '技术', '约束']),
      fileCard('file', 'docs/LOCAL-first/constraints.md', ['技术', '约束']),
    ])

    const result = filterCards(source, { query: '  local-FIRST  ', tags: ['约束', '技术'] })

    expect(result.map((item) => item.cardId)).toEqual(['both', 'file'])
  })

  it('returns every usable current Head when both filters are empty', () => {
    const source = board([
      markdownCard('idea', '可用主意'),
      fileCard('file', 'docs/evidence.md'),
      markdownCard('blank', '   '),
    ])

    expect(filterCards(source, { query: ' ', tags: [] }).map((item) => item.cardId))
      .toEqual(['idea', 'file'])
  })
})

describe('ordered inspiration selection', () => {
  it('adds in click order, removes by candidate identity, and re-adds at the end', () => {
    const first = candidate('pool-a', 'first')
    const second = candidate('pool-b', 'second')

    const afterFirst = toggleSelection([], first)
    const afterSecond = toggleSelection(afterFirst, second)
    const afterRemoval = toggleSelection(afterSecond, { ...first })
    const afterReAdd = toggleSelection(afterRemoval, first)

    expect(afterFirst.map((item) => item.cardId)).toEqual(['first'])
    expect(afterSecond.map((item) => item.cardId)).toEqual(['first', 'second'])
    expect(afterRemoval.map((item) => item.cardId)).toEqual(['second'])
    expect(afterReAdd.map((item) => item.cardId)).toEqual(['second', 'first'])
  })

  it('does not mutate the selected snapshots when another board or filter is projected', () => {
    const selected = [candidate('pool-a', 'first'), candidate('pool-b', 'second')]
    const frozen = structuredClone(selected)

    const projected = filterCards(board([markdownCard('other', '另一条结果')], 'pool-c'), {
      query: '另一条',
      tags: [],
    })

    expect(projected.map((item) => item.cardId)).toEqual(['other'])
    expect(selected).toEqual(frozen)
    expect(selected.map((item) => item.key)).toEqual(frozen.map((item) => item.key))
  })
})

describe('direct inspiration capture', () => {
  it('creates one trimmed markdown input with authoritative board-bottom placement', () => {
    const first = markdownCard('first', '已有灵感')
    first.x = 120
    first.y = 40
    first.height = 180
    const second = fileCard('second', 'docs/evidence.md')
    second.x = -80
    second.y = 400
    second.height = 220
    const source = board([first, second])
    const before = structuredClone(source)

    expect(mapCapture).toBeTypeOf('function')
    if (!mapCapture) return

    const input = mapCapture(source, {
      markdown: '  一个直接记录的约束\n\n补充背景  ',
      tags: ['约束', '技术'],
    })

    expect(input).toEqual({
      contentKind: 'markdown',
      markdown: '一个直接记录的约束\n\n补充背景',
      tags: ['约束', '技术'],
      placement: 'board-bottom',
    })
    expect(input).not.toHaveProperty('inspirationRef')
    expect(source).toEqual(before)
  })

  it('maps transport details to stable local capture feedback', () => {
    expect(captureErrorMessage).toBeTypeOf('function')
    if (!captureErrorMessage) return

    expect(captureErrorMessage(Object.assign(new Error('Board missing'), {
      code: 'BOARD_NOT_FOUND',
    }))).toBe('来源画板已不存在，请重新选择。')
    expect(captureErrorMessage(Object.assign(new Error('tags invalid'), {
      code: 'BAD_REQUEST',
    }))).toBe('灵感内容或标签不符合要求，请检查后重试。')
    expect(captureErrorMessage(new Error('fetch failed')))
      .toBe('灵感没有保存，请重试。')
  })

  it('commits a pending custom tag when the capture form is saved', () => {
    expect(appendCaptureTag).toBeTypeOf('function')
    if (!appendCaptureTag) return

    expect(appendCaptureTag(['主意'], ' 离线 ')).toEqual(['主意', '离线'])
    expect(appendCaptureTag(['主意'], '主意')).toEqual(['主意'])
    expect(() => appendCaptureTag([], 'a'.repeat(33))).toThrow('标签不能超过 32 个字符。')
    expect(() => appendCaptureTag(
      Array.from({ length: 20 }, (_, index) => `标签${index}`),
      '新增',
    )).toThrow('每条灵感最多 20 个标签。')
  })
})

describe('inspiration snapshot mapping', () => {
  it('maps only external candidates to independent snapshot inputs and preserves mixed order', () => {
    const externalMarkdown = candidate(
      'pool-a',
      'idea',
      { kind: 'markdown', markdown: '# Local-first idea' },
      ['主意', '技术'],
    )
    const current = candidate('current', 'already-here')
    const externalFile = candidate(
      'pool-b',
      'evidence',
      { kind: 'file-reference', path: 'docs/evidence.md', readonly: true },
      ['事件'],
    )

    const plan = mapSnapshots(
      [externalMarkdown, current, externalFile],
      'current',
      { x: 900, y: 520 },
    )

    expect(plan).toMatchObject({
      createInputs: [
        {
          contentKind: 'markdown',
          markdown: '# Local-first idea',
          width: 312,
          height: 208,
          tags: ['主意', '技术'],
          inspirationRef: { boardId: 'pool-a', cardId: 'idea', versionId: 'idea-v1' },
        },
        {
          contentKind: 'file-reference',
          filePath: 'docs/evidence.md',
          readonly: true,
          width: 360,
          height: 220,
          tags: ['事件'],
          inspirationRef: { boardId: 'pool-b', cardId: 'evidence', versionId: 'evidence-v1' },
        },
      ],
      selection: [
        { kind: 'create', createIndex: 0 },
        { kind: 'existing', cardId: 'already-here' },
        { kind: 'create', createIndex: 1 },
      ],
    })
    expect(plan.createInputs.every((input) => Number.isFinite(input.x) && Number.isFinite(input.y)))
      .toBe(true)
  })

  it('uses a deterministic two-column layout by default', () => {
    const selected = ['one', 'two', 'three', 'four'].map((id) => candidate('pool', id))

    const first = mapSnapshots(selected, 'current', { x: 800, y: 500 })
    const second = mapSnapshots(selected, 'current', { x: 800, y: 500 })

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      createInputs: expect.any(Array),
      selection: expect.any(Array),
    })
    if (!Array.isArray(first.createInputs)) return
    expect(new Set(first.createInputs.map((input) => input.x))).toHaveLength(2)
    expect(first.createInputs[0].y).toBe(first.createInputs[1].y)
    expect(first.createInputs[2].y).toBe(first.createInputs[3].y)
    expect(first.createInputs[2].y).toBeGreaterThan(first.createInputs[0].y)
  })
})
