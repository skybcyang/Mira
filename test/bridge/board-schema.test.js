import { describe, expect, it } from 'vitest'
import { validateBoardV2 } from '../../bridge/domain/validation.js'

function board(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'board',
    title: 'Board',
    cards: [],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  }
}

function card(id) {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    headVersionId: null,
    versions: [],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function transformation(overrides = {}) {
  return {
    id: 'transformation-1',
    sourceCardIds: ['source'],
    targetCardId: 'target',
    label: '形成方案',
    instruction: '整理来源形成方案',
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('current board schema', () => {
  it('accepts boards without relations and ignores legacy relation entries', () => {
    expect(validateBoardV2(board())).toEqual([])
    const legacy = board({
      relations: [{ id: 'r1', fromCardId: 'x', toCardId: 'y', kind: 'reference' }],
    })
    expect(validateBoardV2(legacy)).toEqual([])
  })

  it('accepts legacy lifecycle omissions and validates explicit lifecycle metadata', () => {
    expect(validateBoardV2(board())).toEqual([])
    expect(validateBoardV2(board({ revision: 0, lifecycle: { state: 'active' } }))).toEqual([])
    expect(validateBoardV2(board({ revision: -1 }))).toContain('board revision is invalid')
    expect(validateBoardV2(board({ revision: 1.5 }))).toContain('board revision is invalid')
    expect(validateBoardV2(board({ lifecycle: { state: 'deleted' } })))
      .toContain('board lifecycle is invalid')
    expect(validateBoardV2(board({ lifecycle: { state: 'archived', archivedAt: 42 } })))
      .toContain('board lifecycle is invalid')
  })

  it('requires a normalized title between one and 120 characters', () => {
    expect(validateBoardV2(board({ title: '  Board  ' }))).toContain('board title is invalid')
    expect(validateBoardV2(board({ title: '' }))).toContain('board title is invalid')
    expect(validateBoardV2(board({ title: '画'.repeat(121) }))).toContain('board title is invalid')
    expect(validateBoardV2(board({ title: '💡'.repeat(120) }))).toEqual([])
  })

  it('accepts neutral runtime metadata', () => {
    expect(validateBoardV2(board({ runtime: { rootSessionId: 'session-1' } }))).toEqual([])
  })

  it('rejects the removed legacy object graph', () => {
    expect(
      validateBoardV2(
        board({
          legacy: {
            schemaVersion: 1,
            nodes: [],
            edges: [],
            transformations: [],
          },
        }),
      ),
    ).toContain('board legacy graph is not supported')
  })

  it('keeps cards without tags or inspiration provenance backward compatible', () => {
    expect(validateBoardV2(board({ cards: [card('source')] }))).toEqual([])
  })

  it('accepts flat tags and a complete inspiration source reference', () => {
    expect(validateBoardV2(board({
      cards: [{
        ...card('source'),
        tags: ['主意', 'NewTech'],
        inspirationRef: {
          boardId: 'source-board',
          cardId: 'source-card',
          versionId: 'source-version',
        },
      }],
    }))).toEqual([])
  })

  it.each([
    ['a non-array value', '主意'],
    ['a non-string item', ['主意', 42]],
    ['a blank item', ['主意', '   ']],
    ['more than twenty items', Array.from({ length: 21 }, (_, index) => `tag-${index}`)],
    ['an item longer than 32 characters', ['x'.repeat(33)]],
    ['case-insensitive duplicates', ['Idea', 'idea']],
  ])('rejects card tags containing %s', (_case, tags) => {
    const errors = validateBoardV2(board({ cards: [{ ...card('source'), tags }] }))

    expect(errors.some((error) => error.includes('card source') && error.includes('tags')))
      .toBe(true)
  })

  it.each([
    [{ boardId: '', cardId: 'source-card', versionId: 'source-version' }],
    [{ boardId: 'source-board', cardId: '   ', versionId: 'source-version' }],
    [{ boardId: 'source-board', cardId: 'source-card' }],
  ])('rejects an incomplete inspiration source reference %j', (inspirationRef) => {
    const errors = validateBoardV2(board({
      cards: [{ ...card('source'), inspirationRef }],
    }))

    expect(errors.some((error) => error.includes('card source') && error.includes('inspirationRef')))
      .toBe(true)
  })

  it('accepts optional latest-attempt and latest-applied Run references', () => {
    const cards = [card('source'), card('target')]

    expect(
      validateBoardV2(board({ cards, transformations: [transformation()] })),
    ).toEqual([])
    expect(
      validateBoardV2(
        board({
          cards,
          transformations: [
            transformation({ lastRunId: 'run-attempt', lastAppliedRunId: 'run-applied' }),
          ],
        }),
      ),
    ).toEqual([])
  })

  it('accepts a non-empty per-transformation model override', () => {
    const cards = [card('source'), card('target')]

    expect(validateBoardV2(board({
      cards,
      transformations: [transformation({ modelId: 'reasoning-model' })],
    }))).toEqual([])
  })

  it('accepts a complete finite transformation position', () => {
    const cards = [card('source'), card('target')]

    expect(validateBoardV2(board({
      cards,
      transformations: [transformation({ x: 320, y: 180 })],
    }))).toEqual([])
  })

  it('accepts complete direct-plan provenance on a transformation', () => {
    const cards = [card('source'), card('target')]

    expect(validateBoardV2(board({
      cards,
      transformations: [transformation({
        planRef: {
          planId: 'plan-1',
          source: 'ad-hoc',
          title: '访谈到简报',
          stepIndex: 1,
          stepTotal: 3,
        },
      })],
    }))).toEqual([])
  })

  it('accepts a boolean plan adjustment marker and rejects other values', () => {
    const planRef = {
      planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 1, stepTotal: 1,
    }
    const cards = [card('source'), card('target')]

    expect(validateBoardV2(board({
      cards,
      transformations: [transformation({ planRef: { ...planRef, adjusted: true } })],
    }))).toEqual([])
    expect(validateBoardV2(board({
      cards,
      transformations: [transformation({ planRef: { ...planRef, adjusted: 'yes' } })],
    }))).toContain('transformation transformation-1 has invalid planRef')
  })

  it.each([
    [{ planId: '', source: 'ad-hoc', title: '计划', stepIndex: 1, stepTotal: 1 }],
    [{ planId: 'plan-1', source: 'other', title: '计划', stepIndex: 1, stepTotal: 1 }],
    [{ planId: 'plan-1', source: 'ad-hoc', title: '   ', stepIndex: 1, stepTotal: 1 }],
    [{ planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 0, stepTotal: 1 }],
    [{ planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 2, stepTotal: 1 }],
    [{ planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 1.5, stepTotal: 2 }],
  ])('rejects invalid transformation plan provenance %j', (planRef) => {
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target')],
      transformations: [transformation({ planRef })],
    }))

    expect(errors).toContain('transformation transformation-1 has invalid planRef')
  })

  it('rejects template plan provenance that does not match its workflow application', () => {
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target')],
      transformations: [transformation({
        planRef: {
          planId: 'application-other',
          source: 'template',
          title: '研究到决策',
          stepIndex: 1,
          stepTotal: 1,
        },
        workflowRef: {
          workflowId: 'workflow-1',
          stepId: 'workflow-step-1',
          applicationId: 'application-1',
        },
      })],
    }))

    expect(errors).toContain('transformation transformation-1 has invalid planRef')
  })

  it.each([
    ['duplicate indexes',
      { planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 1, stepTotal: 2 },
      { planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 1, stepTotal: 2 }],
    ['different titles',
      { planId: 'plan-1', source: 'ad-hoc', title: '计划 A', stepIndex: 1, stepTotal: 2 },
      { planId: 'plan-1', source: 'ad-hoc', title: '计划 B', stepIndex: 2, stepTotal: 2 }],
    ['different totals',
      { planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 1, stepTotal: 2 },
      { planId: 'plan-1', source: 'ad-hoc', title: '计划', stepIndex: 2, stepTotal: 3 }],
  ])('rejects plan groups with %s', (_case, firstPlanRef, secondPlanRef) => {
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target'), card('target-2')],
      transformations: [
        transformation({ id: 'transformation-1', planRef: firstPlanRef }),
        transformation({
          id: 'transformation-2',
          sourceCardIds: ['target'],
          targetCardId: 'target-2',
          planRef: secondPlanRef,
        }),
      ],
    }))

    expect(errors).toContain('plan plan-1 has inconsistent planRef')
  })

  it.each([
    ['different workflow ids', 'workflow-1', 'workflow-2', 'workflow-step-1', 'workflow-step-2'],
    ['duplicate workflow step ids', 'workflow-1', 'workflow-1', 'workflow-step-1', 'workflow-step-1'],
  ])('rejects template plan groups with %s', (_case, firstWorkflowId, secondWorkflowId, firstStepId, secondStepId) => {
    const planRef = (stepIndex) => ({
      planId: 'application-1', source: 'template', title: '研究方法', stepIndex, stepTotal: 2,
    })
    const workflowRef = (workflowId, stepId) => ({
      workflowId, stepId, applicationId: 'application-1',
    })
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target'), card('target-2')],
      transformations: [
        transformation({
          id: 'transformation-1',
          planRef: planRef(1),
          workflowRef: workflowRef(firstWorkflowId, firstStepId),
        }),
        transformation({
          id: 'transformation-2',
          sourceCardIds: ['target'],
          targetCardId: 'target-2',
          planRef: planRef(2),
          workflowRef: workflowRef(secondWorkflowId, secondStepId),
        }),
      ],
    }))

    expect(errors).toContain('plan application-1 has inconsistent planRef')
  })

  it.each([
    [{ x: 320 }],
    [{ y: 180 }],
    [{ x: Number.NaN, y: 180 }],
    [{ x: 320, y: Number.POSITIVE_INFINITY }],
  ])('rejects an incomplete or non-finite transformation position %j', (position) => {
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target')],
      transformations: [transformation(position)],
    }))

    expect(errors).toContain('transformation transformation-1 has invalid position')
  })

  it.each(['', '   ', null, 42])('rejects an invalid transformation modelId %j', (modelId) => {
    const errors = validateBoardV2(board({
      cards: [card('source'), card('target')],
      transformations: [transformation({ modelId })],
    }))

    expect(errors).toContain('transformation transformation-1 has invalid modelId')
  })

  it.each([
    ['lastRunId', ''],
    ['lastRunId', null],
    ['lastAppliedRunId', ''],
    ['lastAppliedRunId', 42],
  ])('rejects an invalid optional transformation %s', (field, value) => {
    const errors = validateBoardV2(
      board({
        cards: [card('source'), card('target')],
        transformations: [transformation({ [field]: value })],
      }),
    )

    expect(errors).toContain(`transformation transformation-1 has invalid ${field}`)
  })
})
