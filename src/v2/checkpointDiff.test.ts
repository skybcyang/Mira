import { describe, expect, it } from 'vitest'
import * as checkpointDiff from './checkpointDiff'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from '../domain'
import {
  checkpointCardContentComparison,
  checkpointDiffWithinBudget,
  compareCheckpointToCurrent,
} from './checkpointDiff'

const now = '2026-09-05T00:00:00.000Z'

function card(id: string, markdown: string, x = 0): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: `${id}-${markdown}`,
    versions: [{
      id: `${id}-${markdown}`,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `digest-${markdown}`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function transformation(id: string, label: string): Transformation {
  return {
    id,
    sourceCardIds: ['a'],
    targetCardId: 'b',
    label,
    instruction: label,
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: now,
    updatedAt: now,
  }
}

function board(cards: ContentCard[], transformations: Transformation[] = []): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board',
    title: 'Board',
    cards,
    transformations,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function run(id: string, candidate = false): TransformationRun {
  return {
    id,
    boardId: 'board',
    transformationId: 't',
    status: 'succeeded',
    sourceSnapshot: [],
    targetCardId: 'b',
    targetBaseVersionId: null,
    intent: 'update',
    result: candidate ? {
      disposition: 'candidate',
      output: 'candidate',
      digest: 'candidate',
    } : { disposition: 'applied', output: 'applied', digest: 'applied', appliedVersionId: 'b-v2' },
    createdAt: now,
    startedAt: now,
    finishedAt: now,
  }
}

describe('compareCheckpointToCurrent', () => {
  it('compares card colors and group membership independently of content', () => {
    const compare = checkpointDiff.compareCheckpointOrganization
    expect(compare).toBeTypeOf('function')
    if (!compare) return
    const saved = board([card('a', 'same')])
    const current = structuredClone(saved)
    current.cards[0].color = 'blue'
    current.groups = [{ id: 'g', title: 'Research', cardIds: ['a'] }]
    expect(compare(saved, current)).toEqual({ colorsChanged: 1, groupsAdded: 1, groupsRemoved: 0, groupsChanged: 0 })
  })
  it('reports stable-id content, layout, structure, and run changes', () => {
    const checkpointBoard = board(
      [card('a', 'old'), card('removed', 'gone')],
      [transformation('t', 'old step')],
    )
    const currentBoard = board(
      [card('a', 'new', 40), card('added', 'here')],
      [transformation('t', 'new step'), transformation('added-t', 'added')],
    )

    expect(compareCheckpointToCurrent(
      { board: checkpointBoard, runs: [run('old-run')] },
      currentBoard,
      { 'old-run': run('old-run'), 'new-run': run('new-run', true) },
    )).toEqual({
      cards: {
        added: 1,
        removed: 1,
        contentChanged: 1,
        layoutChanged: 1,
        contentChanges: [expect.objectContaining({ cardId: 'a' })],
      },
      transformations: { added: 1, removed: 0, changed: 1 },
      runs: { added: 1, pendingCandidates: 1 },
    })
  })

  it('treats equal semantic snapshots as unchanged despite object identity', () => {
    const saved = board([card('a', 'same')], [transformation('t', 'same')])
    const current = structuredClone(saved)
    const savedRun = run('same-run')

    expect(compareCheckpointToCurrent(
      { board: saved, runs: [savedRun] },
      current,
      { [savedRun.id]: structuredClone(savedRun) },
    )).toEqual({
      cards: {
        added: 0, removed: 0, contentChanged: 0, layoutChanged: 0, contentChanges: [],
      },
      transformations: { added: 0, removed: 0, changed: 0 },
      runs: { added: 0, pendingCandidates: 0 },
    })
  })

  it('reports a Head change even when the new version keeps identical content', () => {
    const savedCard = card('a', 'same')
    const currentCard = structuredClone(savedCard)
    currentCard.headVersionId = 'a-new-head'
    currentCard.versions.push({
      ...currentCard.versions[0],
      id: 'a-new-head',
      sequence: 2,
    })

    expect(compareCheckpointToCurrent(
      { board: board([savedCard]), runs: [] },
      board([currentCard]),
      {},
    ).cards).toMatchObject({
      contentChanged: 1,
      contentChanges: [{ cardId: 'a', hasTextChanges: false }],
    })
  })

  it('defers one bounded Card diff and handles a previously blank Head', () => {
    const saved = card('a', 'old')
    const current = card('a', 'new')
    const change = compareCheckpointToCurrent(
      { board: board([saved]), runs: [] }, board([current]), {},
    ).cards.contentChanges[0]

    expect(change).not.toHaveProperty('lines')
    expect(checkpointCardContentComparison(change)).toMatchObject({
      tooLarge: false,
      lines: expect.arrayContaining([
        { kind: 'removed', text: 'old' },
        { kind: 'added', text: 'new' },
      ]),
    })

    const blank = structuredClone(saved)
    blank.headVersionId = null
    blank.versions = []
    const blankChange = compareCheckpointToCurrent(
      { board: board([blank]), runs: [] }, board([current]), {},
    ).cards.contentChanges[0]
    expect(checkpointCardContentComparison(blankChange).lines)
      .toContainEqual({ kind: 'added', text: 'new' })
  })

  it('does not allocate an unbounded LCS matrix for very large Card content', () => {
    const saved = card('a', Array.from({ length: 800 }, (_, index) => `old-${index}`).join('\n'))
    const current = card('a', Array.from({ length: 800 }, (_, index) => `new-${index}`).join('\n'))
    const change = compareCheckpointToCurrent(
      { board: board([saved]), runs: [] }, board([current]), {},
    ).cards.contentChanges[0]

    expect(checkpointCardContentComparison(change)).toEqual({
      tooLarge: true,
      lines: [],
      emptyMessage: '正文过长，面板不展开差异；可导出这个画布版本查看。',
    })
  })

  it('rejects newline-dense content before line splitting', () => {
    expect(checkpointDiffWithinBudget('a\n'.repeat(70_000), 'b')).toBe(false)
    expect(checkpointDiffWithinBudget('旧\n'.repeat(100), '新\n'.repeat(100))).toBe(true)
  })
})
