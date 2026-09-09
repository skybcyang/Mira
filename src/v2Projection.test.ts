import { describe, expect, it } from 'vitest'
import type { BoardV2, TransformationRun } from './domain'
import { branchIntentFromConnection, edgeDrawerIntent, projectV2Board } from './v2Projection'
import { targetPositionForSelection } from './v2State'

function board(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards: [
      {
        id: 'a',
        contentKind: 'markdown',
        x: 0,
        y: 0,
        width: 312,
        height: 208,
        headVersionId: 'a-v2',
        versions: [
          { id: 'a-v1', cardId: 'a', sequence: 1, content: { kind: 'markdown', markdown: '旧材料' }, digest: 'old', origin: 'human', createdAt: '1' },
          { id: 'a-v2', cardId: 'a', sequence: 2, content: { kind: 'markdown', markdown: '新材料' }, digest: 'new', origin: 'human', createdAt: '2' },
        ],
        createdAt: '1',
        updatedAt: '2',
      },
      {
        id: 'b', contentKind: 'markdown', x: 0, y: 260, width: 312, height: 208,
        headVersionId: 'b-v1', versions: [{ id: 'b-v1', cardId: 'b', sequence: 1, content: { kind: 'markdown', markdown: '材料 B' }, digest: 'b', origin: 'human', createdAt: '1' }], createdAt: '1', updatedAt: '1',
      },
      {
        id: 'target', contentKind: 'markdown', x: 520, y: 80, width: 360, height: 240,
        headVersionId: 'target-v1', versions: [{ id: 'target-v1', cardId: 'target', sequence: 1, content: { kind: 'markdown', markdown: '当前成果' }, digest: 'target', origin: 'ai', sourceRunId: 'run-old', createdAt: '1' }], createdAt: '1', updatedAt: '1',
      },
    ],
    transformations: [{
      id: 't1', sourceCardIds: ['a', 'b'], targetCardId: 'target', label: '形成决策',
      instruction: '综合材料', acceptance: '完整', permissions: { workspaceWrite: false },
      lastRunId: 'run-new', createdAt: '1', updatedAt: '2',
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: '1', updatedAt: '2',
  }
}

describe('v2 canvas projection', () => {
  it('restricts card dragging to the title bar', () => {
    expect(projectV2Board(board(), {}).nodes.find((node) => node.id === 'a')?.dragHandle)
      .toBe('.v2-card-heading')
  })
  it('projects every transformation as a compact step between sources and target', () => {
    const canvas = board()
    canvas.transformations = [{
      ...canvas.transformations[0],
      modelId: 'reasoning-model',
      lastRunId: undefined,
      x: 360,
      y: 180,
    }]
    const projected = projectV2Board(canvas, {})

    expect(projected.nodes.find((node) => node.id === 'a')?.data).toMatchObject({
      markdown: '新材料',
      versionLabel: 'v2',
    })
    expect(projected.nodes.find((node) => node.id === 'transformation-node:t1')).toMatchObject({
      type: 'transformation',
      draggable: true,
      position: { x: 360, y: 180 },
      style: { width: 232, height: 124 },
      data: {
        transformationId: 't1',
        label: '形成决策',
        sourceCount: 2,
        modelId: 'reasoning-model',
        status: 'idle',
      },
    })
    expect(projected.edges.filter((edge) => edge.data?.transformationId === 't1')).toHaveLength(3)
    expect(projected.edges.filter((edge) => edge.source === 'transformation-node:t1')).toHaveLength(1)
    expect(projected.nodes.find((node) => node.type === 'junction')).toBeUndefined()
  })

  it('keeps at least 32px clear on both sides of a newly positioned transformation', () => {
    const canvas = board()
    const target = canvas.cards.find((card) => card.id === 'target')!
    const targetPosition = targetPositionForSelection(canvas, ['a', 'b'])
    canvas.cards = canvas.cards.map((card) => card.id === target.id
      ? { ...card, ...targetPosition }
      : card)
    canvas.transformations = [{
      ...canvas.transformations[0],
      lastRunId: undefined,
      x: undefined,
      y: undefined,
    }]

    const projected = projectV2Board(canvas, {})
    const step = projected.nodes.find((node) => node.id === 'transformation-node:t1')!
    const projectedTarget = projected.nodes.find((node) => node.id === target.id)!
    const sourceRight = Math.max(...canvas.cards
      .filter((card) => ['a', 'b'].includes(card.id))
      .map((card) => card.x + card.width))
    const stepWidth = Number(step.style?.width)

    expect(step.position.x - sourceRight).toBeGreaterThanOrEqual(32)
    expect(projectedTarget.position.x - step.position.x - stepWidth).toBeGreaterThanOrEqual(32)
  })

  it('collapses a very large fan-in into one traceable aggregate junction', () => {
    const canvas = board()
    const target = canvas.cards.find((card) => card.id === 'target')!
    const sources = Array.from({ length: 13 }, (_, index) => ({
      ...canvas.cards[0],
      id: `source-${index + 1}`,
      x: 0,
      y: index * 260,
      headVersionId: null,
      versions: [],
    }))
    canvas.cards = [...sources, target]
    canvas.transformations = [{
      ...canvas.transformations[0],
      sourceCardIds: sources.map((card) => card.id),
    }]

    const projected = projectV2Board(canvas, {})
    const step = projected.nodes.find((node) => node.id === 'transformation-node:t1')
    const transformationEdges = projected.edges.filter(
      (edge) => edge.data?.transformationId === 't1',
    )

    expect(step).toMatchObject({
      type: 'transformation',
      data: { collapsedSources: true, sourceCount: 13, label: '形成决策' },
    })
    expect(transformationEdges).toHaveLength(1)
    expect(transformationEdges[0]).toMatchObject({
      source: 'transformation-node:t1',
      target: 'target',
    })
  })

  it('derives stale and candidate states from the latest run', () => {
    const run: TransformationRun = {
      id: 'run-new', boardId: 'board-1', transformationId: 't1', status: 'succeeded',
      sourceSnapshot: [
        { cardId: 'a', versionId: 'a-v1', contentKind: 'markdown', resolvedContent: '旧材料', digest: 'old' },
        { cardId: 'b', versionId: 'b-v1', contentKind: 'markdown', resolvedContent: '材料 B', digest: 'b' },
      ],
      targetCardId: 'target', targetBaseVersionId: 'target-v1', intent: 'update',
      result: { output: '候选结果', digest: 'candidate', disposition: 'candidate' }, createdAt: '2',
    }
    const projected = projectV2Board(board(), { 'run-new': run })

    expect(projected.nodes.find((node) => node.id === 'target')?.data).toMatchObject({
      stale: false,
      candidateRunId: 'run-new',
    })
    expect(projected.nodes.find((node) => node.id === 'transformation-node:t1')?.data)
      .toMatchObject({ runId: 'run-new' })
    const applied = {
      ...run,
      result: { ...run.result!, disposition: 'applied' as const, appliedVersionId: 'target-v1' },
    }
    const stale = projectV2Board(board(), { 'run-new': applied })
    expect(stale.nodes.find((node) => node.id === 'target')?.data).toMatchObject({ stale: true })
  })

  it('keeps candidate state on the latest run while deriving stale from the last applied run', () => {
    const canvas = board()
    canvas.transformations = [{
      ...canvas.transformations[0],
      lastRunId: 'run-candidate',
      lastAppliedRunId: 'run-applied',
    }]
    const applied: TransformationRun = {
      id: 'run-applied', boardId: canvas.id, transformationId: 't1', status: 'succeeded',
      sourceSnapshot: [
        { cardId: 'a', versionId: 'a-v1', contentKind: 'markdown', resolvedContent: '旧材料', digest: 'old' },
        { cardId: 'b', versionId: 'b-v1', contentKind: 'markdown', resolvedContent: '材料 B', digest: 'b' },
      ],
      targetCardId: 'target', targetBaseVersionId: 'target-v1', intent: 'update',
      result: { output: '已采用结果', digest: 'applied', disposition: 'applied', appliedVersionId: 'target-v1' },
      createdAt: '1',
    }
    const candidate: TransformationRun = {
      ...applied,
      id: 'run-candidate',
      result: { output: '待比较结果', digest: 'candidate', disposition: 'candidate' },
      createdAt: '2',
    }

    const projected = projectV2Board(canvas, {
      [applied.id]: applied,
      [candidate.id]: candidate,
    })

    expect(projected.nodes.find((node) => node.id === 'target')?.data).toMatchObject({
      candidateRunId: candidate.id,
      runId: candidate.id,
      stale: true,
    })
  })

  it('marks an applied result stale when current source ids or their order changes', () => {
    const canvas = board()
    canvas.transformations = [{
      ...canvas.transformations[0],
      sourceCardIds: ['b', 'a'],
      lastRunId: 'run-applied',
      lastAppliedRunId: 'run-applied',
    }]
    const applied: TransformationRun = {
      id: 'run-applied', boardId: canvas.id, transformationId: 't1', status: 'succeeded',
      sourceSnapshot: [
        { cardId: 'a', versionId: 'a-v2', contentKind: 'markdown', resolvedContent: '新材料', digest: 'new' },
        { cardId: 'b', versionId: 'b-v1', contentKind: 'markdown', resolvedContent: '材料 B', digest: 'b' },
      ],
      targetCardId: 'target', targetBaseVersionId: 'target-v1', intent: 'update',
      result: { output: '已采用结果', digest: 'applied', disposition: 'applied', appliedVersionId: 'target-v1' },
      createdAt: '2',
    }

    const reordered = projectV2Board(canvas, { [applied.id]: applied })
    expect(reordered.nodes.find((node) => node.id === 'target')?.data)
      .toMatchObject({ stale: true })

    canvas.transformations = [{ ...canvas.transformations[0], sourceCardIds: ['b'] }]
    const replaced = projectV2Board(canvas, { [applied.id]: applied })
    expect(replaced.nodes.find((node) => node.id === 'target')?.data)
      .toMatchObject({ stale: true })
  })

  it('creates a branch intent only when a user ends a source connection on empty canvas', () => {
    expect(branchIntentFromConnection('a', null, { x: 640, y: 320 })).toEqual({
      sourceCardIds: ['a'],
      targetPosition: { x: 640, y: 320 },
    })
    expect(branchIntentFromConnection('a', 'target', { x: 0, y: 0 })).toBeNull()
    expect(branchIntentFromConnection(null, null, { x: 0, y: 0 })).toBeNull()
  })

  it('opens the matching detail surface for transformation edges', () => {
    expect(edgeDrawerIntent({ transformationId: 't1' })).toEqual({
      tab: 'relation',
      transformationId: 't1',
    })
    expect(edgeDrawerIntent({})).toBeNull()
  })

  it('marks only an unexecuted workflow target as waiting for execution', () => {
    const canvas = board()
    canvas.cards = [
      ...canvas.cards.map((card) => card.id === 'target'
        ? { ...card, headVersionId: null, versions: [] }
        : card),
      {
        id: 'ordinary-empty', contentKind: 'markdown', x: 920, y: 360, width: 312, height: 208,
        headVersionId: null, versions: [], createdAt: '1', updatedAt: '1',
      },
    ]
    canvas.transformations = [{
      ...canvas.transformations[0],
      lastRunId: undefined,
      workflowRef: {
        workflowId: 'workflow-1',
        stepId: 'step-1',
        applicationId: 'application-1',
      },
    }]

    const projected = projectV2Board(canvas, {})

    expect(projected.nodes.find((node) => node.id === 'target')?.data)
      .toMatchObject({ waitingExecution: true })
    expect(projected.nodes.find((node) => node.id === 'ordinary-empty')?.data)
      .toMatchObject({ waitingExecution: false })
  })

  it('uses the explicit planRef position even when ad-hoc plan transformations are stored out of order', () => {
    const canvas = board()
    canvas.cards.push({
      id: 'plan-final', contentKind: 'markdown', x: 960, y: 80, width: 360, height: 240,
      headVersionId: null, versions: [], createdAt: '1', updatedAt: '1',
    })
    const first = {
      ...canvas.transformations[0],
      lastRunId: undefined,
      planRef: {
        planId: 'plan-1',
        source: 'ad-hoc',
        title: '研究简报计划',
        stepIndex: 1,
        stepTotal: 2,
      },
    }
    const second = {
      id: 't2', sourceCardIds: ['target'], targetCardId: 'plan-final', label: '一页研究简报',
      instruction: '整理为可审阅简报', acceptance: '', permissions: { workspaceWrite: false },
      planRef: {
        planId: 'plan-1',
        source: 'ad-hoc',
        title: '研究简报计划',
        stepIndex: 2,
        stepTotal: 2,
      },
      createdAt: '2', updatedAt: '2',
    }
    canvas.transformations = [second, first] as unknown as BoardV2['transformations']

    const projected = projectV2Board(canvas, {})

    expect(projected.nodes.find((node) => node.id === 'transformation-node:t1')).toMatchObject({
      data: { workflowStepIndex: 1, workflowStepTotal: 2 },
    })
    expect(projected.nodes.find((node) => node.id === 'transformation-node:t2')).toMatchObject({
      data: { workflowStepIndex: 2, workflowStepTotal: 2 },
    })
    expect(projected.edges.find((edge) => edge.id === 'transformation:t1:main')).toMatchObject({
      data: { workflowStepIndex: 1, workflowStepTotal: 2 },
    })
    expect(projected.edges.find((edge) => edge.id === 'transformation:t2:main')).toMatchObject({
      data: { workflowStepIndex: 2, workflowStepTotal: 2 },
    })
  })

  it('keeps deriving a lightweight ordered position for legacy workflowRef applications', () => {
    const canvas = board()
    canvas.cards.push({
      id: 'workflow-final', contentKind: 'markdown', x: 960, y: 80, width: 360, height: 240,
      headVersionId: null, versions: [], createdAt: '1', updatedAt: '1',
    })
    canvas.transformations = [
      {
        ...canvas.transformations[0],
        lastRunId: undefined,
        workflowRef: { workflowId: 'workflow-1', stepId: 'step-1', applicationId: 'application-1' },
      },
      {
        id: 't2', sourceCardIds: ['target'], targetCardId: 'workflow-final', label: '形成结论',
        instruction: '形成结论', acceptance: '结论可追溯', permissions: { workspaceWrite: false },
        workflowRef: { workflowId: 'workflow-1', stepId: 'step-2', applicationId: 'application-1' },
        createdAt: '2', updatedAt: '2',
      },
    ]

    const projected = projectV2Board(canvas, {})
    const firstStep = projected.nodes.find((node) => node.id === 'transformation-node:t1')
    const secondStep = projected.nodes.find((node) => node.id === 'transformation-node:t2')

    expect(firstStep).toMatchObject({
      data: { label: '形成决策', workflowStepIndex: 1, workflowStepTotal: 2 },
    })
    expect(secondStep).toMatchObject({
      data: { label: '形成结论', workflowStepIndex: 2, workflowStepTotal: 2 },
    })
    expect(projected.edges.find((edge) => edge.id === 'transformation:t1:main')).toMatchObject({
      data: { workflowStepIndex: 1, workflowStepTotal: 2 },
    })
    expect(projected.edges.find((edge) => edge.id === 'transformation:t2:main')).toMatchObject({
      data: { workflowStepIndex: 2, workflowStepTotal: 2 },
    })
    expect(projected.edges.find((edge) => edge.id === 'transformation:t2:source:0'))
      .toMatchObject({ source: 'target', target: 'transformation-node:t2' })
    expect(projected.edges.some((edge) =>
      edge.source === 'transformation-node:t1' && edge.target === 'transformation-node:t2',
    )).toBe(false)
  })
})
