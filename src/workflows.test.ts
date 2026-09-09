import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard, Transformation } from './domain'
import {
  linearWorkflowChain,
  transformationSourcesReady,
  workflowExternalSources,
  workflowExtractionPreview,
  workflowChainHasCommittedTargets,
} from './workflows'

function transformation(
  id: string,
  sourceCardIds: string[],
  targetCardId: string,
): Transformation {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: id,
    instruction: `执行 ${id}`,
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function card(id: string, markdown: string): ContentCard {
  const versionId = `version-${id}`
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `digest-${id}`,
      origin: 'human',
      createdAt: '2026-08-23T00:00:00.000Z',
    }],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function fileCard(id: string, path: string): ContentCard {
  const versionId = `version-${id}`
  return {
    ...card(id, ''),
    contentKind: 'file-reference',
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'file-reference', path, readonly: true },
      digest: `digest-${id}`,
      origin: 'human',
      createdAt: '2026-08-23T00:00:00.000Z',
    }],
  }
}

function board(transformations: Transformation[], cards: ContentCard[] = []): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '研究画板',
    cards,
    transformations,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

describe('linearWorkflowChain', () => {
  it('derives the maximal downstream linear chain from the selected transformation', () => {
    const first = transformation('collect', ['source-a', 'source-b'], 'draft')
    const second = transformation('review', ['draft'], 'reviewed')
    const third = transformation('publish', ['reviewed'], 'published')

    expect(linearWorkflowChain(board([third, first, second]), first.id).map((item) => item.id))
      .toEqual(['collect', 'review', 'publish'])
  })

  it('stops before a fan-out because the next step is ambiguous', () => {
    const first = transformation('collect', ['source'], 'draft')
    const polish = transformation('polish', ['draft'], 'polished')
    const summarize = transformation('summarize', ['draft'], 'summary')

    expect(linearWorkflowChain(board([first, polish, summarize]), first.id).map((item) => item.id))
      .toEqual(['collect'])
  })

  it('keeps a linear backbone when a later step also consumes an external input', () => {
    const first = transformation('collect', ['source'], 'draft')
    const merge = transformation('merge', ['draft', 'reference'], 'merged')

    expect(linearWorkflowChain(board([first, merge]), first.id).map((item) => item.id))
      .toEqual(['collect', 'merge'])
  })

  it('rejects a cycle instead of silently saving a truncated workflow', () => {
    const first = transformation('first', ['card-b'], 'card-a')
    const second = transformation('second', ['card-a'], 'card-b')

    expect(linearWorkflowChain(board([first, second]), first.id)).toEqual([])
  })

  it('returns an empty chain when the selected transformation no longer exists', () => {
    expect(linearWorkflowChain(board([]), 'missing')).toEqual([])
  })
})

describe('workflowExtractionPreview', () => {
  it('returns only the completed linear prefix when the next target is unfinished', () => {
    const first = transformation('collect', ['source'], 'draft')
    const second = transformation('review', ['draft'], 'final')
    const canvas = board([first, second], [card('draft', '# 草稿'), card('final', '   ')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first],
      stopReason: 'downstream-unfinished',
    })
  })

  it('reports fan-out after the completed prefix', () => {
    const first = transformation('collect', ['source'], 'draft')
    const polish = transformation('polish', ['draft'], 'polished')
    const summarize = transformation('summarize', ['draft'], 'summary')
    const canvas = board(
      [first, polish, summarize],
      [card('draft', '# 草稿'), card('polished', '# 润色'), card('summary', '# 摘要')],
    )

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first],
      stopReason: 'fan-out',
    })
  })

  it('includes a completed step that adds an external input', () => {
    const first = transformation('collect', ['source'], 'draft')
    const merge = transformation('merge', ['draft', 'reference'], 'final')
    const canvas = board([first, merge], [card('draft', '# 草稿'), card('final', '# 结论')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first, merge],
      stopReason: null,
    })
  })

  it('rejects a cycle and reports it instead of saving a partial loop', () => {
    const first = transformation('first', ['card-b'], 'card-a')
    const second = transformation('second', ['card-a'], 'card-b')
    const canvas = board([first, second], [card('card-a', '# A'), card('card-b', '# B')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [],
      stopReason: 'cycle',
    })
  })

  it('has no stop reason when every step reaches the natural end of the path', () => {
    const first = transformation('collect', ['source'], 'draft')
    const second = transformation('review', ['draft'], 'final')
    const canvas = board([first, second], [card('draft', '# 草稿'), card('final', '# 结论')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first, second],
      stopReason: null,
    })
  })

  it('extracts the complete numbered plan even when opened from a later step with an exploration branch', () => {
    const first = {
      ...transformation('collect', ['source'], 'draft'),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 1, stepTotal: 2 },
    }
    const second = {
      ...transformation('review', ['draft'], 'final'),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 2, stepTotal: 2 },
    }
    const exploration = transformation('explore', ['draft'], 'alternative')
    const canvas = board(
      [first, exploration, second],
      [card('draft', '# 草稿'), card('final', '# 结论'), card('alternative', '# 另一方向')],
    )

    expect(workflowExtractionPreview(canvas, second.id)).toEqual({
      chain: [first, second],
      stopReason: null,
    })
  })

  it('keeps the complete plan visible but blocks extraction while a planned target is unfinished', () => {
    const first = {
      ...transformation('collect', ['source'], 'draft'),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 1, stepTotal: 2 },
    }
    const second = {
      ...transformation('review', ['draft'], 'final'),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 2, stepTotal: 2 },
    }
    const canvas = board([first, second], [card('draft', '# 草稿'), card('final', '   ')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first, second],
      stopReason: 'downstream-unfinished',
    })
  })

  it('blocks extraction when a numbered plan step has been removed', () => {
    const first = {
      ...transformation('collect', ['source'], 'draft'),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 1, stepTotal: 2 },
    }
    const canvas = board([first], [card('draft', '# 草稿')])

    expect(workflowExtractionPreview(canvas, first.id)).toEqual({
      chain: [first],
      stopReason: 'plan-incomplete',
    })
  })
})

describe('workflowExternalSources', () => {
  it('returns each external card once and excludes previous step outputs', () => {
    const first = transformation('collect', ['brief', 'research'], 'draft')
    const second = transformation('review', ['draft', 'policy'], 'reviewed')
    const third = transformation('publish', ['reviewed', 'research'], 'published')
    const canvas = board(
      [first, second, third],
      [
        card('brief', '# 产品需求'),
        card('research', '# 调研资料'),
        card('policy', '# 约束条件'),
      ],
    )

    expect(workflowExternalSources(canvas, [first, second, third]).map((source) => source.cardId))
      .toEqual(['brief', 'research', 'policy'])
  })
})

describe('workflowChainHasCommittedTargets', () => {
  it('accepts human-edited target Heads when every step has nonempty content', () => {
    const first = transformation('collect', ['source'], 'draft')
    const second = transformation('review', ['draft'], 'final')
    const canvas = board([first, second], [card('draft', '# 草稿'), card('final', '# 结论')])

    expect(workflowChainHasCommittedTargets(canvas, [first, second])).toBe(true)
  })

  it('rejects an existing Head whose content is blank', () => {
    const first = transformation('collect', ['source'], 'draft')
    const canvas = board([first], [card('draft', '   ')])

    expect(workflowChainHasCommittedTargets(canvas, [first])).toBe(false)
  })

  it('rejects a chain when any step target has no Head version', () => {
    const first = transformation('collect', ['source'], 'draft')
    const uncommitted = { ...card('draft', '# 草稿'), headVersionId: null, versions: [] }
    const canvas = board([first], [uncommitted])

    expect(workflowChainHasCommittedTargets(canvas, [first])).toBe(false)
  })
})

describe('transformationSourcesReady', () => {
  it('accepts current nonblank markdown and file-reference Heads', () => {
    const step = transformation('collect', ['notes', 'source-file'], 'draft')
    const canvas = board([step], [card('notes', '# 研究笔记'), fileCard('source-file', 'docs/source.md')])

    expect(transformationSourcesReady(canvas, step)).toBe(true)
  })

  it('rejects the step when any current source Head has no usable content', () => {
    const step = transformation('review', ['draft', 'notes'], 'final')
    const canvas = board([step], [card('draft', '   '), card('notes', '# 笔记')])

    expect(transformationSourcesReady(canvas, step)).toBe(false)
  })
})
