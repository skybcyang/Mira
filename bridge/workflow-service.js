import { isUsableContent } from './domain/content.js'
import { assertBoardWritable } from './domain/board-lifecycle.js'
import { typed } from './domain/errors.js'
import { cardById, transformationById, validateSourceRefs } from './v2-http-policy.js'

const TARGET_CARD_WIDTH = 360
const TARGET_CARD_HEIGHT = 240
const TRANSFORMATION_GAP = 168 + 32 * 2
const PLAN_HORIZONTAL_STEP = TARGET_CARD_WIDTH + TRANSFORMATION_GAP
const CARD_CLEARANCE = 32
const PLAN_VERTICAL_STEP = TARGET_CARD_HEIGHT + CARD_CLEARANCE

function validateCreateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const sourceBoardId =
    typeof body?.sourceBoardId === 'string' ? body.sourceBoardId.trim() : ''
  const transformationIds = body?.transformationIds
  if (!title) throw typed('WORKFLOW_INVALID', 'Workflow title is required')
  if (!sourceBoardId) throw typed('WORKFLOW_INVALID', 'Source board is required')
  if (
    !Array.isArray(transformationIds) ||
    transformationIds.length === 0 ||
    transformationIds.some((id) => typeof id !== 'string' || !id)
  ) {
    throw typed('WORKFLOW_INVALID', 'At least one transformation is required')
  }
  if (new Set(transformationIds).size !== transformationIds.length) {
    throw typed('WORKFLOW_INVALID', 'A transformation cannot appear twice')
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    throw typed('WORKFLOW_INVALID', 'Workflow description must be text')
  }
  let inputs
  if (body.inputs !== undefined) {
    if (!Array.isArray(body.inputs) || body.inputs.length === 0) {
      throw typed('WORKFLOW_INPUT_INVALID', 'At least one workflow input is required')
    }
    const sourceIds = new Set()
    inputs = body.inputs.map((input) => {
      const sourceCardId = typeof input?.sourceCardId === 'string' ? input.sourceCardId.trim() : ''
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (!sourceCardId || !name || sourceIds.has(sourceCardId)) {
        throw typed('WORKFLOW_INPUT_INVALID', 'Workflow inputs require unique source cards and names')
      }
      if (input.description !== undefined && typeof input.description !== 'string') {
        throw typed('WORKFLOW_INPUT_INVALID', 'Workflow input description must be text')
      }
      if (typeof input.required !== 'boolean'
        || (input.cardinality !== 'one' && input.cardinality !== 'many')) {
        throw typed('WORKFLOW_INPUT_INVALID', 'Workflow input constraint is invalid')
      }
      sourceIds.add(sourceCardId)
      return {
        sourceCardId,
        name,
        description: String(input.description || '').trim(),
        required: input.required,
        cardinality: input.cardinality,
      }
    })
  }
  return {
    title,
    description: String(body.description || '').trim(),
    sourceBoardId,
    transformationIds,
    inputs,
  }
}

function assertLinear(transformations) {
  for (let index = 1; index < transformations.length; index += 1) {
    const previous = transformations[index - 1]
    const current = transformations[index]
    if (
      current.sourceCardIds.filter((cardId) => cardId === previous.targetCardId).length !== 1
    ) {
      throw typed(
        'WORKFLOW_NOT_LINEAR',
        `Transformation ${current.id} must read ${previous.targetCardId} exactly once`,
      )
    }
    const otherStepTargets = new Set(transformations.map((item) => item.targetCardId))
    for (const sourceCardId of current.sourceCardIds) {
      if (sourceCardId !== previous.targetCardId && otherStepTargets.has(sourceCardId)) {
        throw typed('WORKFLOW_NOT_LINEAR', `Transformation ${current.id} skips across workflow steps`)
      }
    }
  }

  const outgoing = new Map()
  const nodes = new Set()
  for (const transformation of transformations) {
    nodes.add(transformation.targetCardId)
    for (const sourceCardId of transformation.sourceCardIds) {
      nodes.add(sourceCardId)
      const targets = outgoing.get(sourceCardId) || []
      targets.push(transformation.targetCardId)
      outgoing.set(sourceCardId, targets)
    }
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(cardId) {
    if (visiting.has(cardId)) {
      throw typed('WORKFLOW_NOT_LINEAR', 'Selected transformations form a cycle')
    }
    if (visited.has(cardId)) return
    visiting.add(cardId)
    for (const targetCardId of outgoing.get(cardId) || []) visit(targetCardId)
    visiting.delete(cardId)
    visited.add(cardId)
  }
  for (const cardId of nodes) visit(cardId)
}

function externalSourceIds(transformations) {
  const result = []
  const seen = new Set()
  for (let index = 0; index < transformations.length; index += 1) {
    const previousTarget = index > 0 ? transformations[index - 1].targetCardId : undefined
    for (const cardId of transformations[index].sourceCardIds) {
      if (cardId === previousTarget || seen.has(cardId)) continue
      seen.add(cardId)
      result.push(cardId)
    }
  }
  return result
}

function normalizeWorkflowContract(workflow) {
  const hasContract = Array.isArray(workflow.inputs)
    && workflow.steps.every((step) => Array.isArray(step.sources))
  if (hasContract) return { inputs: workflow.inputs, legacy: false }
  const inputId = `legacy-input:${workflow.id}`
  return {
    legacy: true,
    inputs: [{
      id: inputId,
      name: '起始内容',
      description: '流程开始时使用的内容',
      required: true,
      cardinality: 'many',
    }],
    inputId,
  }
}

function validateInputBindings(board, workflow, body) {
  const contract = normalizeWorkflowContract(workflow)
  const rawBindings = Array.isArray(body?.inputBindings)
    ? body.inputBindings
    : contract.legacy && Array.isArray(body?.sourceRefs)
      ? [{ inputId: contract.inputId, sourceRefs: body.sourceRefs }]
      : []
  const slots = new Map(contract.inputs.map((input) => [input.id, input]))
  const bindings = new Map()
  for (const binding of rawBindings) {
    if (!binding || typeof binding.inputId !== 'string' || !slots.has(binding.inputId)
      || bindings.has(binding.inputId) || !Array.isArray(binding.sourceRefs)) {
      throw typed('WORKFLOW_BINDING_INVALID', 'Workflow input binding is invalid')
    }
    bindings.set(binding.inputId, binding.sourceRefs)
  }
  if (contract.legacy) validateSourceRefs(board, bindings.get(contract.inputId) || [])
  for (const slot of contract.inputs) {
    const refs = bindings.get(slot.id) || []
    if ((slot.required && refs.length === 0)
      || (slot.cardinality === 'one' && refs.length > 1)) {
      throw typed('WORKFLOW_BINDING_INVALID', `Workflow input ${slot.name} is incomplete`)
    }
    if (!contract.legacy && refs.length > 0) validateSourceRefs(board, refs)
    bindings.set(slot.id, refs)
  }
  return { contract, bindings }
}

function stepSources(workflow, contract, index) {
  if (contract.legacy) {
    return index === 0
      ? [{ kind: 'input', inputId: contract.inputId }]
      : [{ kind: 'previous-output' }]
  }
  return workflow.steps[index].sources
}

function assertVerifiedTargets(board, transformations) {
  for (const transformation of transformations) {
    const target = cardById(board, transformation.targetCardId)
    if (typeof target.headVersionId !== 'string' || !target.headVersionId) {
      throw typed(
        'WORKFLOW_STEP_UNVERIFIED',
        `Transformation ${transformation.id} target has no current Head version`,
      )
    }
    const head = target.versions.find((version) => version.id === target.headVersionId)
    if (!isUsableContent(head?.content)) {
      throw typed(
        'WORKFLOW_STEP_UNVERIFIED',
        `Transformation ${transformation.id} target current Head has no usable content`,
      )
    }
  }
}

function assertCompletePlanExtraction(board, transformations) {
  const planRefs = transformations.map((item) => item.planRef).filter(Boolean)
  if (planRefs.length === 0) return
  const planId = planRefs[0].planId
  if (planRefs.length !== transformations.length || planRefs.some((item) => item.planId !== planId)) {
    throw typed('WORKFLOW_PLAN_INCOMPLETE', 'A workflow must include one complete plan')
  }
  const planned = board.transformations
    .filter((item) => item.planRef?.planId === planId)
    .sort((left, right) => left.planRef.stepIndex - right.planRef.stepIndex)
  const expectedTotal = planRefs[0].stepTotal
  const completeGroup = planned.length === expectedTotal && planned.every((item, index) =>
    item.planRef.stepIndex === index + 1 && item.planRef.stepTotal === expectedTotal,
  )
  const exactSelection = completeGroup
    && transformations.length === planned.length
    && planned.every((item, index) => item.id === transformations[index].id)
  if (!exactSelection) {
    throw typed('WORKFLOW_PLAN_INCOMPLETE', 'Every planned step must be included in order')
  }
}

function hasClearance(left, right) {
  return (
    left.x + left.width + CARD_CLEARANCE <= right.x ||
    right.x + right.width + CARD_CLEARANCE <= left.x ||
    left.y + left.height + CARD_CLEARANCE <= right.y ||
    right.y + right.height + CARD_CLEARANCE <= left.y
  )
}

function findPlanY(cards, stepCount, startX, requestedY) {
  let candidateY = requestedY
  while (true) {
    const collides = Array.from({ length: stepCount }, (_, index) => ({
      x: startX + index * PLAN_HORIZONTAL_STEP,
      y: candidateY,
      width: TARGET_CARD_WIDTH,
      height: TARGET_CARD_HEIGHT,
    })).some((target) => cards.some((card) => !hasClearance(target, card)))
    if (!collides) return candidateY
    candidateY += PLAN_VERTICAL_STEP
  }
}

function validateDirectPlan(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) throw typed('PLAN_INVALID', 'Plan title is required')
  if (!Array.isArray(body?.steps) || body.steps.length === 0) {
    throw typed('PLAN_INVALID', 'Plan requires at least one step')
  }
  const steps = body.steps.map((step) => {
    const label = typeof step?.label === 'string' ? step.label.trim() : ''
    const instruction = typeof step?.instruction === 'string' ? step.instruction.trim() : ''
    if (!label || !instruction || typeof step?.acceptance !== 'string') {
      throw typed('PLAN_INVALID', 'Every plan step requires a label, instruction, and acceptance')
    }
    let modelId
    if (Object.prototype.hasOwnProperty.call(step, 'modelId')) {
      modelId = typeof step.modelId === 'string' ? step.modelId.trim() : ''
      if (!modelId) throw typed('PLAN_INVALID', 'Plan step model id must be non-empty text')
    }
    return {
      label,
      instruction,
      acceptance: step.acceptance.trim(),
      ...(modelId ? { modelId } : {}),
    }
  })
  if (!Number.isFinite(body?.targetPosition?.x) || !Number.isFinite(body?.targetPosition?.y)) {
    throw typed('PLAN_INVALID', 'Plan target position requires finite x and y')
  }
  return {
    title,
    sourceRefs: body.sourceRefs,
    steps,
    targetPosition: { x: body.targetPosition.x, y: body.targetPosition.y },
  }
}

function materializeLinearPlan({
  board,
  steps,
  title,
  planId,
  planSource,
  targetPosition,
  sourceCardIdsForStep,
  workflowRefForStep,
  invalidSourceCode,
  newId,
  now,
}) {
  const targetCards = []
  const transformations = []
  const timestamp = now()
  const startY = findPlanY(board.cards, steps.length, targetPosition.x, targetPosition.y)

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const targetCard = {
      id: newId('card'),
      contentKind: 'markdown',
      x: targetPosition.x + index * PLAN_HORIZONTAL_STEP,
      y: startY,
      width: TARGET_CARD_WIDTH,
      height: TARGET_CARD_HEIGHT,
      headVersionId: null,
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const sourceCardIds = sourceCardIdsForStep(index, targetCards)
    if (sourceCardIds.length === 0 || new Set(sourceCardIds).size !== sourceCardIds.length) {
      throw typed(invalidSourceCode, `Plan step ${step.label} has invalid sources`)
    }
    const transformation = {
      id: newId('transformation'),
      sourceCardIds,
      targetCardId: targetCard.id,
      label: step.label,
      instruction: step.instruction,
      acceptance: step.acceptance,
      ...(step.modelId ? { modelId: step.modelId } : {}),
      permissions: { workspaceWrite: false },
      planRef: {
        planId,
        source: planSource,
        title,
        stepIndex: index + 1,
        stepTotal: steps.length,
      },
      ...(workflowRefForStep ? { workflowRef: workflowRefForStep(step) } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    targetCards.push(targetCard)
    transformations.push(transformation)
  }

  board.cards.push(...targetCards)
  board.transformations.push(...transformations)
  return { targetCards, transformations }
}

export function createWorkflowService({ boardStore, workflowStore, newId, now }) {
  return {
    list() {
      return workflowStore.list()
    },

    get(workflowId) {
      return workflowStore.load(workflowId)
    },

    delete(workflowId) {
      return workflowStore.delete(workflowId)
    },

    async create(body) {
      const input = validateCreateInput(body)
      return boardStore.withLockedBoard(input.sourceBoardId, async (board, boardLease) => {
        assertBoardWritable(board)
        const transformations = input.transformationIds.map((transformationId) =>
          transformationById(board, transformationId),
        )
        assertCompletePlanExtraction(board, transformations)
        assertLinear(transformations)
        assertVerifiedTargets(board, transformations)

        const externalIds = externalSourceIds(transformations)
        if (input.inputs) {
          const configuredIds = input.inputs.map((item) => item.sourceCardId)
          if (configuredIds.length !== externalIds.length
            || externalIds.some((cardId) => !configuredIds.includes(cardId))) {
            throw typed('WORKFLOW_INPUT_INVALID', 'Every external source must map to one workflow input')
          }
        }

        const timestamp = now()
        const workflowInputs = input.inputs?.map((item) => ({
          id: newId('workflow-input'),
          name: item.name,
          description: item.description,
          required: item.required,
          cardinality: item.cardinality,
          sourceCardId: item.sourceCardId,
        }))
        const inputIdByCard = new Map(workflowInputs?.map((item) => [item.sourceCardId, item.id]))
        const workflow = {
          id: newId('workflow'),
          title: input.title,
          description: input.description,
          ...(workflowInputs ? { inputs: workflowInputs.map(({ sourceCardId: _sourceCardId, ...item }) => item) } : {}),
          steps: transformations.map((transformation, index) => ({
            id: newId('workflow-step'),
            label: transformation.label,
            instruction: transformation.instruction,
            acceptance: transformation.acceptance,
            ...(transformation.modelId ? { modelId: transformation.modelId } : {}),
            ...(workflowInputs ? { sources: transformation.sourceCardIds.map((cardId) =>
              index > 0 && cardId === transformations[index - 1].targetCardId
                ? { kind: 'previous-output' }
                : { kind: 'input', inputId: inputIdByCard.get(cardId) }) } : {}),
          })),
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await workflowStore.save(workflow.id, workflow, boardLease)
        return workflow
      })
    },

    async createPlan(boardId, body) {
      const input = validateDirectPlan(body)
      const planId = newId('plan')
      let created
      await boardStore.update(boardId, async (board) => {
        validateSourceRefs(board, input.sourceRefs)
        created = materializeLinearPlan({
          board,
          steps: input.steps,
          title: input.title,
          planId,
          planSource: 'ad-hoc',
          targetPosition: input.targetPosition,
          sourceCardIdsForStep: (index, targetCards) => index === 0
            ? input.sourceRefs.map((sourceRef) => sourceRef.cardId)
            : [targetCards[index - 1].id],
          invalidSourceCode: 'PLAN_INVALID',
          newId,
          now,
        })
        return board
      })
      return { planId, title: input.title, ...created }
    },

    async apply(boardId, workflowId, body) {
      let result
      await boardStore.withLockedBoard(boardId, async (_board, boardLease) => {
        await workflowStore.withLockedWorkflow(workflowId, async (workflow, workflowLease) => {
          if (workflow.steps.length === 0) {
            throw typed('WORKFLOW_INVALID', 'Workflow requires at least one step')
          }

          let applicationId
          let created
          await boardStore.update(boardId, async (board) => {
            const { contract, bindings } = validateInputBindings(board, workflow, body)
            applicationId = newId('workflow-application')
            const startX = Number.isFinite(body?.targetPosition?.x) ? body.targetPosition.x : 480
            const requestedY = Number.isFinite(body?.targetPosition?.y) ? body.targetPosition.y : 80
            created = materializeLinearPlan({
              board,
              steps: workflow.steps,
              title: workflow.title,
              planId: applicationId,
              planSource: 'template',
              targetPosition: { x: startX, y: requestedY },
              sourceCardIdsForStep: (index, targetCards) =>
                stepSources(workflow, contract, index).flatMap((source) =>
                  source.kind === 'previous-output'
                    ? [targetCards[index - 1].id]
                    : (bindings.get(source.inputId) || []).map((sourceRef) => sourceRef.cardId)),
              workflowRefForStep: (step) => ({
                workflowId: workflow.id,
                stepId: step.id,
                applicationId,
              }),
              invalidSourceCode: 'WORKFLOW_BINDING_INVALID',
              newId,
              now,
            })
            return board
          }, workflowLease)

          result = { workflow, applicationId, ...created }
        }, boardLease)
      })
      return result
    },
  }
}
