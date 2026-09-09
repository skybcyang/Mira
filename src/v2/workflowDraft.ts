import type { Edge, Node } from '@xyflow/react'
import type { BoardV2, SourceRef, WorkflowInputSlot, WorkflowTemplate } from '../domain'
import { normalizeWorkflowContract } from '../workflows'

const STEP_WIDTH = 168
const STEP_HEIGHT = 156
const TARGET_WIDTH = 360
const TARGET_HEIGHT = 240
const STEP_TO_TARGET_GAP = 32
const TARGET_TO_STEP_GAP = 32
const HORIZONTAL_STEP = STEP_WIDTH + STEP_TO_TARGET_GAP + TARGET_WIDTH + TARGET_TO_STEP_GAP
const CLEARANCE = 32
const VERTICAL_STEP = TARGET_HEIGHT + CLEARANCE
export const AD_HOC_PLAN_INPUT_ID = 'ad-hoc-plan-input'
const AD_HOC_PLAN_WORKFLOW_ID = 'ad-hoc-plan-draft'

export interface AdHocPlanInput {
  title: string
  finalOutcome: string
  steps: Array<string | AdHocPlanStep>
}
export interface AdHocPlanStep { label: string; instruction: string }
export function adHocPlanStep(step: string | AdHocPlanStep): AdHocPlanStep {
  return typeof step === 'string' ? {label:step, instruction:step} : step
}

export type WorkflowDraftSource =
  | { kind: 'template'; workflowId: string }
  | { kind: 'ad-hoc' }

export interface WorkflowDraft {
  workflowId: string
  source?: WorkflowDraftSource
  definition?: WorkflowTemplate
  origin: { x: number; y: number }
  bindings: Record<string, string[]>
  bindingSourceRefs?: Record<string, SourceRef[]>
}

export interface AdHocWorkflowDraft extends WorkflowDraft {
  source: { kind: 'ad-hoc' }
  definition: WorkflowTemplate
}

export interface WorkflowDraftInputData extends WorkflowInputSlot {
  boundCardIds: string[]
  boundCardTitles: string[]
}

export interface WorkflowDraftStepData extends Record<string, unknown> {
  workflowId: string
  workflowTitle: string
  stepId: string
  label: string
  instruction: string
  stepIndex: number
  stepTotal: number
  inputs: WorkflowDraftInputData[]
}

export function adHocPlanReady(plan: AdHocPlanInput): boolean {
  return Boolean(
    plan.title.trim()
    && plan.finalOutcome.trim()
    && plan.steps.length > 0
    && plan.steps.every((step, index) => {
      const value = adHocPlanStep(step)
      return value.instruction.trim() && (index === plan.steps.length - 1 || value.label.trim())
    }),
  )
}

export function reorderAdHocPlanSteps<T>(
  steps: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const reordered = [...steps]
  if (
    !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || fromIndex >= reordered.length
    || toIndex < 0
    || toIndex >= reordered.length
    || fromIndex === toIndex
  ) return reordered
  const [step] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, step)
  return reordered
}

export function createAdHocWorkflowDraft(
  plan: AdHocPlanInput,
  origin: { x: number; y: number },
): AdHocWorkflowDraft {
  const title = plan.title.trim()
  const finalOutcome = plan.finalOutcome.trim()
  const steps = plan.steps.map(adHocPlanStep)
  const now = ''
  const definition: WorkflowTemplate = {
    id: AD_HOC_PLAN_WORKFLOW_ID,
    title,
    description: '',
    inputs: [{
      id: AD_HOC_PLAN_INPUT_ID,
      name: '起始内容',
      description: '计划第一步使用的内容',
      required: true,
      cardinality: 'many',
    }],
    steps: steps.map((step, index) => ({
      id: `ad-hoc-plan-step-${index + 1}`,
      label: index === steps.length - 1 ? finalOutcome : step.label.trim(),
      instruction: step.instruction.trim(),
      acceptance: '',
      sources: index === 0
        ? [{ kind: 'input', inputId: AD_HOC_PLAN_INPUT_ID }]
        : [{ kind: 'previous-output' }],
    })),
    createdAt: now,
    updatedAt: now,
  }
  return {
    workflowId: definition.id,
    source: { kind: 'ad-hoc' },
    definition,
    origin,
    bindings: {},
    bindingSourceRefs: {},
  }
}

function rectanglesClear(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return left.x + left.width + CLEARANCE <= right.x
    || right.x + right.width + CLEARANCE <= left.x
    || left.y + left.height + CLEARANCE <= right.y
    || right.y + right.height + CLEARANCE <= left.y
}

export function collisionFreeWorkflowDraftOrigin(
  board: BoardV2,
  workflow: WorkflowTemplate,
  requested: { x: number; y: number },
) {
  let y = requested.y
  while (true) {
    const collides = workflow.steps.some((_step, index) => {
      const stepX = requested.x + index * HORIZONTAL_STEP
      const rectangles = [
        { x: stepX, y: y + 42, width: STEP_WIDTH, height: STEP_HEIGHT },
        { x: stepX + STEP_WIDTH + STEP_TO_TARGET_GAP, y, width: TARGET_WIDTH, height: TARGET_HEIGHT },
      ]
      return rectangles.some((rectangle) => board.cards.some((card) =>
        !rectanglesClear(rectangle, card)))
    })
    if (!collides) return { x: requested.x, y }
    y += VERTICAL_STEP
  }
}

function cardTitle(board: BoardV2, cardId: string) {
  const card = board.cards.find((item) => item.id === cardId)
  const head = card?.versions.find((version) => version.id === card.headVersionId)
  if (head?.content.kind === 'markdown') {
    return head.content.markdown.split('\n').find((line) => line.trim())
      ?.replace(/^#{1,6}\s*/, '').trim() || '未命名内容'
  }
  if (head?.content.kind === 'file-reference') {
    const parts = head.content.path.split('/').filter(Boolean)
    return parts[parts.length - 1] || head.content.path
  }
  return cardId
}

export function workflowDraftReady(workflow: WorkflowTemplate, draft: WorkflowDraft): boolean {
  const contract = normalizeWorkflowContract(workflow)
  const inputsReady = contract.inputs.every((input) => {
    const count = draft.bindings[input.id]?.length || 0
    if (input.required && count === 0) return false
    return input.cardinality === 'many' || count <= 1
  })
  return inputsReady && !workflowDraftHasSourceConflict(workflow, draft)
}

export function workflowDraftProgress(workflow: WorkflowTemplate, draft: WorkflowDraft) {
  const requiredInputs = normalizeWorkflowContract(workflow).inputs.filter((input) => input.required)
  return {
    completed: requiredInputs.filter((input) => (draft.bindings[input.id]?.length || 0) > 0).length,
    required: requiredInputs.length,
    ready: workflowDraftReady(workflow, draft),
  }
}

export function workflowDraftHasSourceConflict(
  workflow: WorkflowTemplate,
  draft: WorkflowDraft,
): boolean {
  const contract = normalizeWorkflowContract(workflow)
  return workflow.steps.some((step) => {
    const cardIds = (contract.stepSources[step.id] || []).flatMap((source) =>
      source.kind === 'input' ? draft.bindings[source.inputId] || [] : [])
    return new Set(cardIds).size !== cardIds.length
  })
}

export function projectWorkflowDraft(
  board: BoardV2,
  workflow: WorkflowTemplate,
  draft: WorkflowDraft,
): { nodes: Node[]; edges: Edge[] } {
  const contract = normalizeWorkflowContract(workflow)
  const inputById = new Map(contract.inputs.map((input) => [input.id, input]))
  const nodes: Node[] = []
  const edges: Edge[] = []

  workflow.steps.forEach((step, index) => {
    const stepNodeId = `workflow-draft-step:${step.id}`
    const targetNodeId = `workflow-draft-target:${step.id}`
    const sources = contract.stepSources[step.id] || []
    const stepInputs = sources.flatMap((source) => {
      if (source.kind !== 'input') return []
      const input = inputById.get(source.inputId)
      if (!input) return []
      const boundCardIds = draft.bindings[input.id] || []
      return [{
        ...input,
        boundCardIds,
        boundCardTitles: boundCardIds.map((cardId) => cardTitle(board, cardId)),
      }]
    })
    const stepX = draft.origin.x + index * HORIZONTAL_STEP
    nodes.push({
      id: stepNodeId,
      type: 'workflowDraftStep',
      position: { x: stepX, y: draft.origin.y + 42 },
      draggable: false,
      selectable: false,
      style: { width: STEP_WIDTH, minHeight: STEP_HEIGHT },
      data: {
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        stepId: step.id,
        label: step.label,
        instruction: step.instruction,
        stepIndex: index + 1,
        stepTotal: workflow.steps.length,
        inputs: stepInputs,
      } satisfies WorkflowDraftStepData,
    })
    nodes.push({
      id: targetNodeId,
      type: 'workflowDraftTarget',
      position: { x: stepX + STEP_WIDTH + STEP_TO_TARGET_GAP, y: draft.origin.y },
      draggable: false,
      selectable: false,
      style: { width: TARGET_WIDTH, height: TARGET_HEIGHT },
      data: { label: step.label, stepIndex: index + 1, stepTotal: workflow.steps.length },
    })
    edges.push({
      id: `workflow-draft:${step.id}:target`,
      source: stepNodeId,
      target: targetNodeId,
      className: 'workflow-draft-internal-edge',
    })
    if (index > 0) {
      edges.push({
        id: `workflow-draft:${workflow.steps[index - 1].id}:${step.id}`,
        source: `workflow-draft-target:${workflow.steps[index - 1].id}`,
        target: stepNodeId,
        targetHandle: 'workflow-previous-output',
        className: 'workflow-draft-internal-edge',
      })
    }
    for (const input of stepInputs) {
      input.boundCardIds.forEach((cardId, bindingIndex) => {
        edges.push({
          id: `workflow-draft:${step.id}:${input.id}:${cardId}:${bindingIndex}`,
          source: cardId,
          target: stepNodeId,
          targetHandle: `workflow-input:${input.id}`,
          className: 'workflow-draft-binding-edge',
        })
      })
    }
  })

  return { nodes, edges }
}
