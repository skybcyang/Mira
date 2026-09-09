import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard, SourceSnapshot, Transformation, TransformationRun } from '../domain'
import { sourceComparisonRows } from './sourceComparison'

const now = '2026-09-07T00:00:00.000Z'
function card(id: string): ContentCard {
  return { id, contentKind: 'markdown', x: 0, y: 0, width: 300, height: 180,
    headVersionId: `${id}-v1`, versions: [{ id: `${id}-v1`, cardId: id, sequence: 1,
      content: { kind: 'markdown', markdown: `# ${id}` }, digest: id, origin: 'human', createdAt: now }],
    createdAt: now, updatedAt: now }
}
function snapshot(id: string): SourceSnapshot {
  return { cardId: id, versionId: `${id}-v1`, contentKind: 'markdown', resolvedContent: `# ${id}`, digest: id }
}
const transformation: Transformation = { id: 'step', sourceCardIds: ['a', 'b'], targetCardId: 'target',
  label: 'Outcome', instruction: 'Compare', acceptance: '', permissions: { workspaceWrite: false },
  lastAppliedRunId: 'applied', createdAt: now, updatedAt: now }
function board(): BoardV2 {
  return { schemaVersion: 2, id: 'board', title: 'Board', cards: [card('a'), card('b')],
    transformations: [transformation], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now }
}
function run(): TransformationRun {
  return { id: 'applied', boardId: 'board', transformationId: 'step', targetCardId: 'target',
    targetBaseVersionId: null, status: 'succeeded', intent: 'create', createdAt: now,
    sourceSnapshot: [snapshot('a'), snapshot('b')],
    result: { disposition: 'applied', output: 'Result', digest: 'result', appliedVersionId: 'target-v1' } }
}

describe('source comparison rows', () => {
  it('compares the latest applied snapshot without changing the supplied objects', () => {
    const input = board()
    const applied = run()
    const before = JSON.stringify({ input, applied })
    expect(sourceComparisonRows(input, transformation, applied)).toMatchObject([
      { cardId: 'a', title: 'a', status: 'same', currentVersionLabel: 'v1', historicalVersionLabel: 'v1', currentOrder: 1, historicalOrder: 1 },
      { cardId: 'b', status: 'same', currentOrder: 2, historicalOrder: 2 },
    ])
    expect(JSON.stringify({ input, applied })).toBe(before)
  })

  it('keeps current source order and appends removed historical inputs', () => {
    const input = board()
    input.cards.push(card('c'))
    const rows = sourceComparisonRows(input, { ...transformation, sourceCardIds: ['c', 'a'] }, run())
    expect(rows).toMatchObject([
      { cardId: 'c', status: 'added', currentOrder: 1 },
      { cardId: 'a', status: 'reordered', currentOrder: 2, historicalOrder: 1 },
      { cardId: 'b', status: 'removed', historicalOrder: 2, snapshot: snapshot('b') },
    ])
  })

  it('marks a changed version or content digest as changed', () => {
    const input = board()
    input.cards[0].versions[0].digest = 'changed'
    input.cards[1].headVersionId = 'b-v2'
    input.cards[1].versions.push({ ...input.cards[1].versions[0], id: 'b-v2', sequence: 2 })
    expect(sourceComparisonRows(input, transformation, run()).map((row) => row.status)).toEqual(['changed', 'changed'])
  })

  it('does not declare unchanged external files from their path version alone', () => {
    const input = board()
    input.cards[0].contentKind = 'file-reference'
    input.cards[0].versions[0].content = { kind: 'file-reference', path: 'brief.md', readonly: true }
    const applied = run()
    applied.sourceSnapshot[0].contentKind = 'file-reference'
    expect(sourceComparisonRows(input, transformation, applied)[0]).toMatchObject({ title: 'brief.md', status: 'unknown' })
  })

  it('retains a removed snapshot after the source card has been deleted', () => {
    const input = board()
    input.cards = []
    expect(sourceComparisonRows(input, { ...transformation, sourceCardIds: [] }, run())[0])
      .toMatchObject({ cardId: 'a', status: 'removed', historicalVersionLabel: 'a-v1', snapshot: snapshot('a') })
  })

  it('treats missing or dangling current heads as unknown', () => {
    const input = board()
    input.cards[0].headVersionId = 'missing'
    input.cards.pop()
    expect(sourceComparisonRows(input, transformation, run()).map((row) => row.status)).toEqual(['unknown', 'unknown'])
  })

  it.each(['missing', 'different-board', 'latest-failed', 'candidate'])('does not substitute %s for the applied run', (kind) => {
    const applied = run()
    if (kind === 'different-board') applied.boardId = 'another-board'
    if (kind === 'latest-failed') { applied.id = 'latest'; applied.status = 'failed' }
    if (kind === 'candidate') applied.result!.disposition = 'candidate'
    const rows = sourceComparisonRows(board(), transformation, kind === 'missing' ? undefined : applied)
    expect(rows.map((row) => row.status)).toEqual(['unknown', 'unknown'])
    expect(rows.every((row) => row.snapshot === undefined)).toBe(true)
  })
})
