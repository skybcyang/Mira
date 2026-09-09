import type { Edge, Node } from '@xyflow/react'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from './domain'

export interface V2CardNodeData extends Record<string, unknown> {
  card: ContentCard
  markdown: string
  filePath?: string
  versionLabel: string
  stale: boolean
  runStatus?: TransformationRun['status']
  runId?: string
  candidateRunId?: string
  waitingExecution: boolean
}

export interface V2TransformationNodeData extends Record<string, unknown> {
  transformationId: string
  label: string
  sourceCount: number
  modelId?: string
  status: TransformationRun['status'] | 'idle'
  runId?: string
  stale: boolean
  candidateRunId?: string
  collapsedSources: boolean
  workflowStepIndex?: number
  workflowStepTotal?: number
}

const COLLAPSED_FAN_IN_THRESHOLD = 13
export const TRANSFORMATION_NODE_WIDTH = 232
const TRANSFORMATION_NODE_HEIGHT = 124

export type EdgeDrawerIntent =
  | { tab: 'relation'; transformationId: string }

export function edgeDrawerIntent(data: Record<string, unknown> | undefined): EdgeDrawerIntent | null {
  const transformationId = data?.transformationId
  if (typeof transformationId === 'string') return { tab: 'relation', transformationId }
  return null
}

function head(card: ContentCard) {
  return card.versions.find((version) => version.id === card.headVersionId)
}

function runMakesTransformationStale(
  board: BoardV2,
  transformation: Transformation,
  run: TransformationRun | undefined,
): boolean {
  if (run?.status !== 'succeeded' || run.result?.disposition !== 'applied') return false
  const snapshotCardIds = run.sourceSnapshot.map((snapshot) => snapshot.cardId)
  if (
    transformation.sourceCardIds.length !== snapshotCardIds.length
    || transformation.sourceCardIds.some((cardId, index) => cardId !== snapshotCardIds[index])
  ) return true
  return run.sourceSnapshot.some((snapshot) => {
    const card = board.cards.find((item) => item.id === snapshot.cardId)
    return !card || card.headVersionId !== snapshot.versionId
  })
}

function appliedRunFor(
  transformation: Transformation,
  runs: Record<string, TransformationRun>,
): TransformationRun | undefined {
  if (transformation.lastAppliedRunId) return runs[transformation.lastAppliedRunId]
  const latestRun = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
  return latestRun?.status === 'succeeded' && latestRun.result?.disposition === 'applied'
    ? latestRun
    : undefined
}

export function projectV2Board(
  board: BoardV2,
  runs: Record<string, TransformationRun>,
): { nodes: Node[]; edges: Edge[] } {
  const planPositions = new Map<string, { index: number; total: number }>()
  const legacyWorkflowApplications = new Map<string, typeof board.transformations>()
  for (const transformation of board.transformations) {
    if (transformation.planRef) {
      planPositions.set(transformation.id, {
        index: transformation.planRef.stepIndex,
        total: transformation.planRef.stepTotal,
      })
      continue
    }
    if (!transformation.workflowRef) continue
    const key = `${transformation.workflowRef.workflowId}\u0000${transformation.workflowRef.applicationId}`
    legacyWorkflowApplications.set(key, [
      ...(legacyWorkflowApplications.get(key) || []),
      transformation,
    ])
  }
  for (const transformations of legacyWorkflowApplications.values()) {
    transformations.forEach((transformation, index) => {
      planPositions.set(transformation.id, { index: index + 1, total: transformations.length })
    })
  }
  const targetState = new Map<
    string,
    Pick<V2CardNodeData, 'stale' | 'runStatus' | 'runId' | 'candidateRunId' | 'waitingExecution'>
  >()
  for (const transformation of board.transformations) {
    const run = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
    const appliedRun = appliedRunFor(transformation, runs)
    targetState.set(transformation.targetCardId, {
      stale: runMakesTransformationStale(board, transformation, appliedRun),
      waitingExecution: !transformation.lastRunId,
      ...(run ? { runStatus: run.status, runId: run.id } : {}),
      ...(run?.result?.disposition === 'candidate' ? { candidateRunId: run.id } : {}),
    })
  }

  const nodes: Node[] = board.cards.map((card) => {
    const version = head(card)
    const content = version?.content
    return {
      id: card.id,
      type: 'contentCard',
      dragHandle: '.v2-card-heading',
      position: { x: card.x, y: card.y },
      style: { width: card.width, height: card.height },
      data: {
        card,
        markdown: content?.kind === 'markdown' ? content.markdown : '',
        ...(content?.kind === 'file-reference' ? { filePath: content.path } : {}),
        versionLabel: version ? `v${version.sequence}` : '未生成',
        stale: false,
        waitingExecution: false,
        ...targetState.get(card.id),
      } satisfies V2CardNodeData,
    }
  })
  const edges: Edge[] = []

  for (const transformation of board.transformations) {
    const run = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
    const appliedRun = appliedRunFor(transformation, runs)
    const workflowPosition = planPositions.get(transformation.id)
    const state: Pick<
      V2TransformationNodeData,
      'transformationId' | 'stale' | 'status' | 'workflowStepIndex' | 'workflowStepTotal'
    > = {
      transformationId: transformation.id,
      stale: runMakesTransformationStale(board, transformation, appliedRun),
      status: run?.status ?? 'idle',
      ...(workflowPosition ? {
        workflowStepIndex: workflowPosition.index,
        workflowStepTotal: workflowPosition.total,
      } : {}),
    }
    const sources = transformation.sourceCardIds
      .map((id) => board.cards.find((card) => card.id === id))
      .filter((card): card is ContentCard => Boolean(card))
    const target = board.cards.find((card) => card.id === transformation.targetCardId)
    const sourceRight = Math.max(0, ...sources.map((card) => card.x + card.width))
    const targetLeft = target?.x ?? sourceRight + 160
    const sourceCenter =
      sources.reduce((sum, card) => sum + card.y + card.height / 2, 0) /
      Math.max(1, sources.length)
    const transformationNodeId = `transformation-node:${transformation.id}`
    const collapsed = transformation.sourceCardIds.length >= COLLAPSED_FAN_IN_THRESHOLD
    nodes.push({
      id: transformationNodeId,
      type: 'transformation',
      position: {
        x: Number.isFinite(transformation.x)
          ? transformation.x as number
          : (sourceRight + targetLeft - TRANSFORMATION_NODE_WIDTH) / 2,
        y: Number.isFinite(transformation.y)
          ? transformation.y as number
          : sourceCenter - TRANSFORMATION_NODE_HEIGHT / 2,
      },
      draggable: true,
      data: {
        ...state,
        label: transformation.label,
        sourceCount: transformation.sourceCardIds.length,
        collapsedSources: collapsed,
        ...(run ? { runId: run.id } : {}),
        ...(transformation.modelId ? { modelId: transformation.modelId } : {}),
        ...(run?.result?.disposition === 'candidate' ? { candidateRunId: run.id } : {}),
      } satisfies V2TransformationNodeData,
      style: { width: TRANSFORMATION_NODE_WIDTH, height: TRANSFORMATION_NODE_HEIGHT },
    })
    if (!collapsed) {
      transformation.sourceCardIds.forEach((sourceCardId, index) => {
        edges.push({
          id: `transformation:${transformation.id}:source:${index}`,
          source: sourceCardId,
          target: transformationNodeId,
          className: 'transformation-source-edge',
          data: state,
        })
      })
    }
    edges.push({
      id: `transformation:${transformation.id}:main`,
      source: transformationNodeId,
      target: transformation.targetCardId,
      className: 'transformation-edge',
      data: state,
    })
  }

  return { nodes, edges }
}

export function branchIntentFromConnection(
  sourceCardId: string | null,
  targetCardId: string | null,
  targetPosition: { x: number; y: number },
) {
  if (!sourceCardId || targetCardId) return null
  return { sourceCardIds: [sourceCardId], targetPosition }
}
