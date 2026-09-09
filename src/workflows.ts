import type {
  BoardV2,
  Transformation,
  WorkflowInputSlot,
  WorkflowStepSource,
  WorkflowTemplate,
} from './domain'

export type WorkflowExtractionStopReason =
  | 'downstream-unfinished'
  | 'plan-incomplete'
  | 'fan-out'
  | 'merge'
  | 'cycle'

export interface WorkflowExtractionPreview {
  chain: Transformation[]
  stopReason: WorkflowExtractionStopReason | null
}

export interface WorkflowSourceSummary {
  cardId: string
  title: string
  versionId: string
  versionLabel: string
}

export function cardHeadHasUsableContent(board: BoardV2, cardId: string): boolean {
  const card = board.cards.find((item) => item.id === cardId)
  const head = card?.versions.find((version) => version.id === card.headVersionId)
  if (!head) return false
  return head.content.kind === 'markdown'
    ? Boolean(head.content.markdown.trim())
    : Boolean(head.content.path.trim())
}

export function linearWorkflowChain(
  board: BoardV2,
  transformationId: string,
): Transformation[] {
  const preview = structuralWorkflowChain(board, transformationId)
  return preview.stopReason === 'cycle' ? [] : preview.chain
}

function structuralWorkflowChain(
  board: BoardV2,
  transformationId: string,
): WorkflowExtractionPreview {
  const first = board.transformations.find((item) => item.id === transformationId)
  if (!first) return { chain: [], stopReason: null }

  const chain: Transformation[] = []
  const visited = new Set<string>()
  let current: Transformation | undefined = first

  while (current) {
    if (visited.has(current.id)) return { chain: [], stopReason: 'cycle' }
    chain.push(current)
    visited.add(current.id)

    const consumers = board.transformations.filter((candidate) =>
      candidate.sourceCardIds.includes(current!.targetCardId),
    )
    if (consumers.length === 0) return { chain, stopReason: null }
    if (consumers.length > 1) return { chain, stopReason: 'fan-out' }
    if (visited.has(consumers[0].id)) return { chain: [], stopReason: 'cycle' }
    current = consumers[0]
  }

  return { chain, stopReason: null }
}

function sourceTitle(board: BoardV2, cardId: string): string {
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
  return '未命名内容'
}

export function workflowExternalSources(
  board: BoardV2,
  chain: Transformation[],
): WorkflowSourceSummary[] {
  const previousTargets = new Map(chain.slice(1).map((step, index) => [step.id, chain[index].targetCardId]))
  const seen = new Set<string>()
  return chain.flatMap((step) => step.sourceCardIds.flatMap((cardId) => {
    if (cardId === previousTargets.get(step.id) || seen.has(cardId)) return []
    seen.add(cardId)
    const card = board.cards.find((item) => item.id === cardId)
    const head = card?.versions.find((version) => version.id === card.headVersionId)
    return [{
      cardId,
      title: sourceTitle(board, cardId),
      versionId: head?.id || '',
      versionLabel: head ? `v${head.sequence}` : '未完成',
    }]
  }))
}

export interface NormalizedWorkflowContract {
  inputs: WorkflowInputSlot[]
  stepSources: Record<string, WorkflowStepSource[]>
  legacy: boolean
}

export function normalizeWorkflowContract(workflow: WorkflowTemplate): NormalizedWorkflowContract {
  const hasContract = Array.isArray(workflow.inputs)
    && workflow.steps.every((step) => Array.isArray(step.sources))
  if (hasContract) {
    return {
      inputs: workflow.inputs || [],
      stepSources: Object.fromEntries(workflow.steps.map((step) => [step.id, step.sources || []])),
      legacy: false,
    }
  }
  const inputId = `legacy-input:${workflow.id}`
  return {
    inputs: [{
      id: inputId,
      name: '起始内容',
      description: '流程开始时使用的内容',
      required: true,
      cardinality: 'many',
    }],
    stepSources: Object.fromEntries(workflow.steps.map((step, index) => [
      step.id,
      index === 0
        ? [{ kind: 'input' as const, inputId }]
        : [{ kind: 'previous-output' as const }],
    ])),
    legacy: true,
  }
}

export function workflowExtractionPreview(
  board: BoardV2,
  transformationId: string,
): WorkflowExtractionPreview {
  const selected = board.transformations.find((item) => item.id === transformationId)
  if (selected?.planRef) {
    const { planId, stepTotal } = selected.planRef
    const chain = board.transformations
      .filter((item) => item.planRef?.planId === planId)
      .sort((left, right) => (left.planRef?.stepIndex || 0) - (right.planRef?.stepIndex || 0))
    const completePlan = chain.length === stepTotal && chain.every((item, index) =>
      item.planRef?.stepIndex === index + 1 && item.planRef.stepTotal === stepTotal,
    )
    if (!completePlan) return { chain, stopReason: 'plan-incomplete' }
    if (chain.some((item) => !cardHeadHasUsableContent(board, item.targetCardId))) {
      return { chain, stopReason: 'downstream-unfinished' }
    }
    return { chain, stopReason: null }
  }
  const structural = structuralWorkflowChain(board, transformationId)
  if (structural.stopReason === 'cycle') return structural
  const unfinishedIndex = structural.chain.findIndex((transformation) =>
    !cardHeadHasUsableContent(board, transformation.targetCardId),
  )
  if (unfinishedIndex >= 0) {
    return {
      chain: structural.chain.slice(0, unfinishedIndex),
      stopReason: 'downstream-unfinished',
    }
  }
  return structural
}

export function workflowExtractionReady(
  board: BoardV2,
  transformationId: string,
  preview = workflowExtractionPreview(board, transformationId),
): boolean {
  const selected = board.transformations.find((item) => item.id === transformationId)
  return preview.chain.length > 0 && (!selected?.planRef || preview.stopReason === null)
}

export function workflowChainHasCommittedTargets(
  board: BoardV2,
  chain: Transformation[],
): boolean {
  if (chain.length === 0) return false
  return chain.every((transformation) =>
    cardHeadHasUsableContent(board, transformation.targetCardId),
  )
}

export function transformationSourcesReady(
  board: BoardV2,
  transformation: Transformation,
): boolean {
  return transformation.sourceCardIds.length > 0 && transformation.sourceCardIds.every((cardId) =>
    cardHeadHasUsableContent(board, cardId),
  )
}
