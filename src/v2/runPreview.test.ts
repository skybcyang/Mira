import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard, TransformationRun } from '../domain'
import { previewRunTo } from './runPreview'

const now = '2026-09-07T00:00:00.000Z'
const card = (id: string, markdown = ''): ContentCard => ({
  id, contentKind: 'markdown', x: 0, y: 0, width: 312, height: 208,
  headVersionId: markdown ? `${id}-v1` : null,
  versions: markdown ? [{ id: `${id}-v1`, cardId: id, sequence: 1,
    content: { kind: 'markdown', markdown }, digest: id, origin: 'human', createdAt: now }] : [],
  createdAt: now, updatedAt: now,
})
const board = (): BoardV2 => ({
  schemaVersion: 2, id: 'board', title: 'test',
  cards: [card('raw', 'material'), card('a'), card('b'), card('c'), card('d')],
  transformations: ['a', 'b', 'c', 'd'].map((id, index) => ({
    id: `step-${id}`, label: id, sourceCardIds: [index ? ['a', 'b', 'c'][index - 1] : 'raw'],
    targetCardId: id, instruction: id, acceptance: '', permissions: { workspaceWrite: false },
    createdAt: now, updatedAt: now,
  })),
  viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now,
})

function apply(canvas: BoardV2, index: number): TransformationRun {
  const step = canvas.transformations[index]
  canvas.cards[index + 1] = card(step.targetCardId, `result ${index}`)
  step.lastRunId = step.lastAppliedRunId = `run-${index}`
  return {
    id: step.lastRunId, boardId: canvas.id, transformationId: step.id, status: 'succeeded',
    sourceSnapshot: step.sourceCardIds.map((cardId) => ({
      cardId, versionId: canvas.cards.find((item) => item.id === cardId)!.headVersionId!,
      contentKind: 'markdown', resolvedContent: 'material', digest: cardId,
    })),
    targetCardId: step.targetCardId, targetBaseVersionId: null, intent: 'create',
    result: { output: 'result', digest: 'result', disposition: 'applied' }, createdAt: now,
  }
}

describe('read-only run range preview', () => {
  it('predicts a whole empty chain without inventing committed versions or runs', () => {
    const canvas = board()
    const before = structuredClone(canvas)
    const result = previewRunTo(canvas, {}, 'step-d')
    expect(result.rows.map((row) => row.status)).toEqual(['generate', 'generate', 'generate', 'generate'])
    expect(result.rows.map((row) => row.reason)).toEqual(['empty-target', 'waiting-upstream', 'waiting-upstream', 'waiting-upstream'])
    expect(result.summary).toEqual({ generate: 4, keep: 0, check: 0, blocked: 0, unreached: 0 })
    expect(result.rows[1].upstreamTransformationIds).toEqual(['step-a'])
    expect(canvas).toEqual(before)
  })

  it('propagates possible new heads through applied downstream outputs', () => {
    const canvas = board()
    const runs = Object.fromEntries([0, 1, 2].map((index) => { const run = apply(canvas, index); return [run.id, run] }))
    runs['run-0'].sourceSnapshot[0].versionId = 'old'
    const result = previewRunTo(canvas, runs, 'step-c')
    expect(result.rows.map((row) => row.reason)).toEqual(['stale', 'upstream-change', 'upstream-change'])
    expect(result.rows.every((row) => row.status === 'generate')).toBe(true)
  })

  it('preserves never-applied manual targets and stops imaginary downstream propagation', () => {
    const canvas = board()
    const first = apply(canvas, 0)
    first.sourceSnapshot[0].versionId = 'old'
    canvas.cards[2] = card('b', 'manual decision')
    const third = apply(canvas, 2)
    const result = previewRunTo(canvas, { [first.id]: first, [third.id]: third }, 'step-c')
    expect(result.rows.map((row) => row.status)).toEqual(['generate', 'keep', 'keep'])
    expect(result.rows[1].reason).toBe('manual-content')
  })

  it.each(['candidate', 'running', 'queued'] as const)('exposes a %s stop without hiding possible earlier writes', (state) => {
    const canvas = board()
    const run = apply(canvas, 2)
    if (state === 'candidate') run.result!.disposition = 'candidate'
    else run.status = state
    const result = previewRunTo(canvas, { [run.id]: run }, 'step-d')
    expect(result.rows.map((row) => row.status)).toEqual(['generate', 'generate', 'blocked', 'unreached'])
    expect(result.rows[2].runId).toBe(run.id)
    expect(result.rows[2].reason).toBe(state === 'candidate' ? 'candidate' : 'active-run')
  })

  it('marks missing historical tracking as unchecked and stops further evaluation', () => {
    const canvas = board()
    apply(canvas, 1)
    const result = previewRunTo(canvas, {}, 'step-d')
    expect(result.rows.map((row) => row.status)).toEqual(['generate', 'check', 'unreached', 'unreached'])
    expect(result.rows[1]).toMatchObject({ reason: 'run-unavailable', runId: 'run-1' })
  })

  it('does not classify a path-only file source as current', () => {
    const canvas = board()
    canvas.cards[0].contentKind = 'file-reference'
    canvas.cards[0].versions[0].content = { kind: 'file-reference', path: 'materials.md', readonly: true }
    const run = apply(canvas, 0)
    expect(previewRunTo(canvas, { [run.id]: run }, 'step-b').rows).toMatchObject([
      { status: 'check', reason: 'file-unchecked', sourceCardId: 'raw' },
      { status: 'unreached' },
    ])
  })

  it('reports actual missing material even when another source will be generated upstream', () => {
    const canvas = board()
    canvas.transformations[1].sourceCardIds.push('missing')
    expect(previewRunTo(canvas, {}, 'step-c').rows).toMatchObject([
      { status: 'generate' },
      { status: 'blocked', reason: 'source-unavailable', sourceCardId: 'missing' },
      { status: 'unreached' },
    ])
  })

  it('does not promise generation or preservation when a committed Head is not loaded', () => {
    const canvas = board()
    canvas.cards[1].headVersionId = 'not-loaded'
    expect(previewRunTo(canvas, {}, 'step-b').rows).toMatchObject([
      { status: 'check', reason: 'content-unavailable' }, { status: 'unreached' },
    ])
    canvas.cards[1].headVersionId = null
    canvas.cards[0].versions = []
    expect(previewRunTo(canvas, {}, 'step-a').rows).toMatchObject([
      { status: 'check', reason: 'content-unavailable', sourceCardId: 'raw' },
    ])
  })

  it('blocks a deleted output instead of predicting a new identity', () => {
    const canvas = board()
    canvas.cards = canvas.cards.filter((item) => item.id !== 'a')
    expect(previewRunTo(canvas, {}, 'step-b').rows).toMatchObject([
      { status: 'blocked', reason: 'target-unavailable', targetCardId: 'a' }, { status: 'unreached' },
    ])
  })

  it('rejects cycles and deleted endpoints using the execution dependency gate', () => {
    const canvas = board()
    canvas.transformations[0].sourceCardIds = ['d']
    expect(previewRunTo(canvas, {}, 'step-d')).toMatchObject({ reason: 'cycle', rows: [{ status: 'blocked', reason: 'cycle' }] })
    expect(previewRunTo(canvas, {}, 'deleted')).toMatchObject({ reason: 'not-found', rows: [{ status: 'blocked', reason: 'not-found' }] })
  })
})
