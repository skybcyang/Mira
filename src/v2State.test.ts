import { describe, expect, it } from 'vitest'
import type { BoardV2, TransformationRun } from './domain'
import * as v2State from './v2State'
import {
  collisionFreeBranchOrigin,
  orderedSelection,
  sourceRefsFor,
  targetPositionForSelection,
} from './v2State'

const board = {
  cards: [
    { id: 'a', headVersionId: 'a-v1', x: 20, y: 100, width: 300, height: 180 },
    { id: 'b', headVersionId: 'b-v2', x: 20, y: 340, width: 320, height: 180 },
  ],
} as BoardV2

describe('v2 selection state', () => {
  it('preserves user selection order and removes deselected cards', () => {
    expect(orderedSelection(['a'], [{ type: 'select', id: 'b', selected: true }], new Set(['a', 'b']))).toEqual(['a', 'b'])
    expect(orderedSelection(['a', 'b'], [{ type: 'select', id: 'a', selected: false }], new Set(['a', 'b']))).toEqual(['b'])
  })

  it('uses explicit head versions in the same order as the context dock', () => {
    expect(sourceRefsFor(board, ['b', 'a'])).toEqual([
      { cardId: 'b', versionId: 'b-v2' },
      { cardId: 'a', versionId: 'a-v1' },
    ])
  })

  it('reserves room for a transformation node after the rightmost selected content card', () => {
    expect(targetPositionForSelection(board, ['a', 'b'])).toEqual({ x: 636, y: 220 })
  })

  it('moves a parallel branch batch below existing cards at its target column', () => {
    const crowded = {
      ...board,
      cards: [...board.cards, { ...board.cards[0], id: 'blocker', x: 552, y: 100, width: 360, height: 240 }],
    }
    expect(collisionFreeBranchOrigin(crowded, ['a'], 2)).toEqual({ x: 616, y: 372 })
  })
})

type ExecutionStateModule = {
  transformationDependencyOrder?: (board: BoardV2, transformationId: string) =>
    { transformationIds: string[]; reason: null | 'not-found' | 'cycle' }
  transformationExecutionDecision?: (
    board: BoardV2,
    runs: Record<string, TransformationRun>,
    transformationId: string,
  ) => { kind: 'run' | 'current' | 'candidate' | 'sources-unavailable' | 'tracking-unavailable'; reason?: string }
}

const executionState = v2State as ExecutionStateModule
const now = '2026-08-30T00:00:00.000Z'

function executionCard(id: string, headVersionId: string | null) {
  return {
    id,
    contentKind: 'markdown' as const,
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId,
    versions: headVersionId ? [{
      id: headVersionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown' as const, markdown: `# ${id}` },
      digest: `digest-${headVersionId}`,
      origin: 'human' as const,
      createdAt: now,
    }] : [],
    createdAt: now,
    updatedAt: now,
  }
}

function executionBoard(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'execution-board',
    title: '执行检查',
    cards: [
      executionCard('raw-a', 'raw-a-v2'),
      executionCard('raw-b', 'raw-b-v1'),
      executionCard('draft-a', 'draft-a-v1'),
      executionCard('draft-b', 'draft-b-v1'),
      executionCard('final', null),
    ],
    transformations: [
      { id: 'step-a', sourceCardIds: ['raw-a'], targetCardId: 'draft-a', label: 'A', instruction: 'A', acceptance: '', permissions: { workspaceWrite: false }, lastRunId: 'run-a', lastAppliedRunId: 'run-a', createdAt: now, updatedAt: now },
      { id: 'step-b', sourceCardIds: ['raw-b'], targetCardId: 'draft-b', label: 'B', instruction: 'B', acceptance: '', permissions: { workspaceWrite: false }, createdAt: now, updatedAt: now },
      { id: 'step-final', sourceCardIds: ['draft-a', 'draft-b'], targetCardId: 'final', label: 'Final', instruction: 'Final', acceptance: '', permissions: { workspaceWrite: false }, createdAt: now, updatedAt: now },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function appliedRun(overrides: Partial<TransformationRun> = {}): TransformationRun {
  return {
    id: 'run-a',
    boardId: 'execution-board',
    transformationId: 'step-a',
    targetCardId: 'draft-a',
    sourceSnapshot: [{
      cardId: 'raw-a',
      versionId: 'raw-a-v1',
      contentKind: 'markdown',
      resolvedContent: '# raw-a',
      digest: 'digest-raw-a-v1',
    }],
    targetBaseVersionId: null,
    intent: 'update',
    modelSnapshot: { provider: 'test', model: 'test' },
    status: 'succeeded',
    result: { output: '# draft-a', digest: 'draft-a', disposition: 'applied', appliedVersionId: 'draft-a-v1' },
    createdAt: now,
    ...overrides,
  }
}

describe('run-to-here planning', () => {
  it('orders every upstream dependency before the selected downstream step', () => {
    expect(executionState.transformationDependencyOrder?.(executionBoard(), 'step-final') ?? null)
      .toEqual({ transformationIds: ['step-a', 'step-b', 'step-final'], reason: null })

    const cyclic = executionBoard()
    cyclic.transformations[0] = { ...cyclic.transformations[0], sourceCardIds: ['final'] }
    expect(executionState.transformationDependencyOrder?.(cyclic, 'step-final') ?? null)
      .toEqual({ transformationIds: [], reason: 'cycle' })
  })

  it('runs only empty or stale results and preserves untracked human content', () => {
    const canvas = executionBoard()
    const stale = appliedRun()
    expect(executionState.transformationExecutionDecision?.(canvas, { [stale.id]: stale }, 'step-a') ?? null)
      .toEqual({ kind: 'run', reason: 'stale' })
    expect(executionState.transformationExecutionDecision?.(canvas, {}, 'step-b') ?? null)
      .toEqual({ kind: 'current' })
    expect(executionState.transformationExecutionDecision?.(canvas, {}, 'step-final') ?? null)
      .toEqual({ kind: 'run', reason: 'empty-target' })

    const current = appliedRun({
      sourceSnapshot: [{
        cardId: 'raw-a', versionId: 'raw-a-v2', contentKind: 'markdown',
        resolvedContent: '# raw-a', digest: 'digest-raw-a-v2',
      }],
    })
    expect(executionState.transformationExecutionDecision?.(canvas, { [current.id]: current }, 'step-a') ?? null)
      .toEqual({ kind: 'current' })
  })

  it('blocks at an unresolved Candidate or unavailable source', () => {
    const canvas = executionBoard()
    const candidate = appliedRun({
      id: 'candidate-run',
      result: { output: '# candidate', digest: 'candidate', disposition: 'candidate' },
    })
    canvas.transformations[0] = { ...canvas.transformations[0], lastRunId: candidate.id }
    expect(executionState.transformationExecutionDecision?.(canvas, { [candidate.id]: candidate }, 'step-a') ?? null)
      .toEqual({ kind: 'candidate', reason: 'candidate-run' })

    canvas.cards[0] = executionCard('raw-a', null)
    canvas.transformations[0] = { ...canvas.transformations[0], lastRunId: undefined, lastAppliedRunId: undefined }
    expect(executionState.transformationExecutionDecision?.(canvas, {}, 'step-a') ?? null)
      .toEqual({ kind: 'sources-unavailable', reason: 'raw-a' })
  })

  it('stops when referenced Run state is unavailable', () => {
    const canvas = executionBoard()

    expect(executionState.transformationExecutionDecision?.(canvas, {}, 'step-a') ?? null)
      .toEqual({ kind: 'tracking-unavailable', reason: 'run-a' })
  })
})
