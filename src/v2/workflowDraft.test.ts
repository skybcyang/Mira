import { describe, expect, it } from 'vitest'
import type { BoardV2, WorkflowTemplate } from '../domain'
import {
  collisionFreeWorkflowDraftOrigin,
  createAdHocWorkflowDraft,
  projectWorkflowDraft,
  reorderAdHocPlanSteps,
  workflowDraftProgress,
  workflowDraftReady,
  type WorkflowDraft,
} from './workflowDraft'

const workflow: WorkflowTemplate = {
  id: 'workflow-1',
  title: '需求落地',
  description: '',
  inputs: [
    { id: 'brief', name: '需求说明', description: '', required: true, cardinality: 'one' },
    { id: 'research', name: '调研资料', description: '', required: true, cardinality: 'many' },
  ],
  steps: [
    {
      id: 'step-1', label: '拆解需求', instruction: '拆解', acceptance: '',
      sources: [{ kind: 'input', inputId: 'brief' }],
    },
    {
      id: 'step-2', label: '形成方案', instruction: '方案', acceptance: '',
      sources: [
        { kind: 'previous-output' },
        { kind: 'input', inputId: 'research' },
      ],
    },
  ],
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

const board = {
  schemaVersion: 2,
  id: 'board-1',
  title: '画板',
  cards: [], transformations: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
} satisfies BoardV2

function draft(bindings: WorkflowDraft['bindings']): WorkflowDraft {
  return { workflowId: workflow.id, origin: { x: 500, y: 100 }, bindings }
}

describe('workflow draft projection', () => {
  it('separates intermediate outcomes from instructions and derives the last outcome', () => {
    const draft = createAdHocWorkflowDraft({ title:'验证', finalOutcome:'验证方案', steps:[{label:'问题清单',instruction:'提取问题和证据'},{label:'旧名称',instruction:'制定验证方式'}] }, {x:0,y:0})
    expect(draft.definition.steps.map(({label,instruction})=>({label,instruction}))).toEqual([
      {label:'问题清单',instruction:'提取问题和证据'}, {label:'验证方案',instruction:'制定验证方式'},
    ])
  })
  it('turns an ad-hoc plan into one explicit starting input and an ordered linear definition', () => {
    const created = createAdHocWorkflowDraft({
      title: '研究简报计划',
      finalOutcome: '一页研究简报',
      steps: ['提取关键证据', '整理为可审阅简报'],
    }, { x: 500, y: 100 })

    expect(created).toMatchObject({
      source: { kind: 'ad-hoc' },
      origin: { x: 500, y: 100 },
      bindings: {},
      definition: {
        title: '研究简报计划',
        inputs: [{
          name: '起始内容',
          required: true,
          cardinality: 'many',
        }],
      },
    })
    expect(created.definition.steps).toHaveLength(2)
    expect(created.definition.steps[0]).toMatchObject({
      label: '提取关键证据',
      instruction: '提取关键证据',
      sources: [{ kind: 'input', inputId: created.definition.inputs?.[0].id }],
    })
    expect(created.definition.steps[1]).toMatchObject({
      label: '一页研究简报',
      instruction: '整理为可审阅简报',
      sources: [{ kind: 'previous-output' }],
    })
  })

  it('keeps ad-hoc starting content unbound until the user explicitly binds cards', () => {
    const sourceCards = ['card-a', 'card-b'].map((id, index) => ({
      id,
      contentKind: 'markdown' as const,
      x: 0,
      y: index * 260,
      width: 360,
      height: 240,
      headVersionId: `${id}-v1`,
      versions: [{
        id: `${id}-v1`,
        cardId: id,
        sequence: 1,
        content: { kind: 'markdown' as const, markdown: `# ${id}` },
        digest: id,
        origin: 'human' as const,
        createdAt: board.createdAt,
      }],
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    }))
    const canvas = { ...board, cards: sourceCards }
    const created = createAdHocWorkflowDraft({
      title: '研究简报计划',
      finalOutcome: '一页研究简报',
      steps: ['提取关键证据', '整理为可审阅简报'],
    }, { x: 500, y: 100 })
    const inputId = created.definition.inputs?.[0].id

    expect(inputId).toBeTruthy()
    expect(created.bindings).toEqual({})
    expect(workflowDraftReady(created.definition, created)).toBe(false)

    const bound = {
      ...created,
      bindings: { [inputId!]: ['card-b', 'card-a'] },
    }
    const projected = projectWorkflowDraft(canvas, created.definition, bound)

    expect(workflowDraftReady(created.definition, bound)).toBe(true)
    expect(projected.edges.filter((edge) => edge.className === 'workflow-draft-binding-edge'))
      .toMatchObject([
        { source: 'card-b', targetHandle: `workflow-input:${inputId}` },
        { source: 'card-a', targetHandle: `workflow-input:${inputId}` },
      ])
  })

  it('reorders ad-hoc steps without mutating the form value', () => {
    const steps = ['提取证据', '形成判断', '整理简报']

    expect(reorderAdHocPlanSteps(steps, 2, 0)).toEqual([
      '整理简报',
      '提取证据',
      '形成判断',
    ])
    expect(steps).toEqual(['提取证据', '形成判断', '整理简报'])
  })

  it('summarizes required input progress for the inline draft controls', () => {
    expect(workflowDraftProgress(workflow, draft({ brief: ['card-a'] }))).toEqual({
      completed: 1,
      required: 2,
      ready: false,
    })
    expect(workflowDraftProgress(workflow, draft({ brief: ['card-a'], research: ['card-b'] })))
      .toEqual({ completed: 2, required: 2, ready: true })
  })

  it('keeps the draft incomplete until every required named input satisfies cardinality', () => {
    expect(workflowDraftReady(workflow, draft({ brief: ['card-a'] }))).toBe(false)
    expect(workflowDraftReady(workflow, draft({ brief: ['card-a'], research: ['card-b'] })))
      .toBe(true)
    const sameStepInputs = {
      ...workflow,
      steps: [
        { ...workflow.steps[0], sources: [{ kind: 'input' as const, inputId: 'brief' }, { kind: 'input' as const, inputId: 'research' }] },
        workflow.steps[1],
      ],
    }
    expect(workflowDraftReady(sameStepInputs, draft({ brief: ['card-a'], research: ['card-a'] })))
      .toBe(false)
    expect(workflowDraftReady(workflow, draft({ brief: ['card-a', 'card-b'], research: ['card-c'] })))
      .toBe(false)
  })

  it('projects step and empty-target nodes plus internal and bound input edges', () => {
    const projected = projectWorkflowDraft(
      board,
      workflow,
      draft({ brief: ['card-a'], research: ['card-b', 'card-c'] }),
    )

    expect(projected.nodes.map((node) => node.type)).toEqual([
      'workflowDraftStep', 'workflowDraftTarget',
      'workflowDraftStep', 'workflowDraftTarget',
    ])
    expect(projected.edges.filter((edge) => edge.className === 'workflow-draft-internal-edge'))
      .toHaveLength(3)
    expect(projected.edges.filter((edge) => edge.className === 'workflow-draft-binding-edge'))
      .toHaveLength(3)
    expect(projected.nodes.find((node) => node.id === 'workflow-draft-target:step-1')?.position.x)
      .toBe(700)
    expect(projected.nodes.find((node) => node.id === 'workflow-draft-target:step-2')?.position.x)
      .toBe(1292)
  })

  it('normalizes old templates as one named multi-card starting input', () => {
    const legacy = { ...workflow, inputs: undefined, steps: workflow.steps.map(({ sources: _sources, ...step }) => step) }
    const projected = projectWorkflowDraft(board, legacy, draft({ 'legacy-input:workflow-1': ['card-a'] }))

    expect(projected.nodes[0]?.data.inputs).toEqual([
      expect.objectContaining({ id: 'legacy-input:workflow-1', name: '起始内容' }),
    ])
    expect(workflowDraftReady(legacy, draft({ 'legacy-input:workflow-1': ['card-a'] }))).toBe(true)
  })

  it('moves the whole draft to a row that clears existing content cards', () => {
    const crowded = {
      ...board,
      cards: [{
        id: 'blocker', contentKind: 'markdown' as const, x: 700, y: 100,
        width: 360, height: 240, headVersionId: null, versions: [],
        createdAt: board.createdAt, updatedAt: board.updatedAt,
      }],
    }

    expect(collisionFreeWorkflowDraftOrigin(crowded, workflow, { x: 500, y: 100 }))
      .toEqual({ x: 500, y: 372 })
  })
})
