import { describe, expect, it } from 'vitest'
import type { TransformationRun } from '../domain'
import { mergeCheckpointPreviewRuns } from './checkpointPreviewRuns'

function run(status: TransformationRun['status'], disposition?: 'candidate' | 'applied' | 'discarded'): TransformationRun {
  return {
    id: 'run-1', boardId: 'board-1', transformationId: 'step-1', status,
    sourceSnapshot: [], targetCardId: 'card-1', targetBaseVersionId: null,
    intent: 'update', createdAt: '2026-09-05T00:00:00.000Z',
    ...(disposition ? { result: { disposition, output: 'done', digest: 'digest' } } : {}),
  }
}

describe('checkpoint preview complete history and live Run merge', () => {
  it('does not replace a confirmed terminal status with a conflicting terminal cache entry', () => {
    const terminal = run('interrupted')
    expect(mergeCheckpointPreviewRuns('board-1', { 'run-1': terminal }, {
      'run-1': run('succeeded', 'applied'),
    })).toEqual({ 'run-1': terminal })
  })

  it('preserves old history while appending new live Runs, excluding other Boards', () => {
    const historical = { ...run('succeeded', 'applied'), id: 'history' }
    const live = run('running')
    const other = { ...run('running'), boardId: 'other', id: 'other' }
    expect(mergeCheckpointPreviewRuns('board-1', { history: historical, other }, { live, other }))
      .toEqual({ history: historical, 'run-1': live })
  })

  it.each([
    [run('queued'), run('running')],
    [run('running'), run('succeeded', 'candidate')],
    [run('running'), run('failed')],
    [run('running'), run('interrupted')],
    [run('succeeded', 'candidate'), run('succeeded', 'applied')],
    [run('succeeded', 'candidate'), run('succeeded', 'discarded')],
  ])('keeps the most advanced lifecycle regardless of cache/response ordering (%j -> %j)', (before, after) => {
    expect(mergeCheckpointPreviewRuns('board-1', { 'run-1': before }, { 'run-1': after }))
      .toEqual({ 'run-1': after })
    expect(mergeCheckpointPreviewRuns('board-1', { 'run-1': after }, { 'run-1': before }))
      .toEqual({ 'run-1': after })
  })
})
