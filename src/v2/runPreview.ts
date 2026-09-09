import type { BoardV2, ContentCard, TransformationRun } from '../domain'
import { transformationDependencyOrder, transformationExecutionDecision } from '../v2State'

export type RunPreviewStatus = 'generate' | 'keep' | 'check' | 'blocked' | 'unreached'
export type RunPreviewReason = 'empty-target' | 'waiting-upstream' | 'stale' | 'upstream-change'
  | 'current' | 'manual-content' | 'candidate' | 'active-run' | 'run-unavailable'
  | 'source-unavailable' | 'target-unavailable' | 'content-unavailable' | 'file-unchecked' | 'earlier-stop' | 'cycle' | 'not-found'

export interface RunPreviewRow {
  transformationId: string
  targetCardId: string
  label: string
  status: RunPreviewStatus
  reason: RunPreviewReason
  sourceCardId?: string
  runId?: string
  upstreamTransformationIds: string[]
}

export interface RunPreview {
  targetTransformationId: string
  targetLabel: string
  reason: null | 'not-found' | 'cycle'
  rows: RunPreviewRow[]
  summary: Record<RunPreviewStatus, number>
}

export const runPreviewStatusLabels: Record<RunPreviewStatus, string> = {
  generate: '预计生成', keep: '保留', check: '待检查', blocked: '阻塞', unreached: '尚未到达',
}

export const runPreviewReasonLabels: Record<RunPreviewReason, string> = {
  'empty-target': '目标尚无内容',
  'waiting-upstream': '等待上游生成后继续',
  stale: '来源已有变化',
  'upstream-change': '上游预计变化，可能更新',
  current: '当前来源版本未变化',
  'manual-content': '保留尚无已采用运行的人工内容',
  candidate: '先处理待比较结果',
  'active-run': '先等待或停止当前运行',
  'run-unavailable': '运行信息尚未载入',
  'source-unavailable': '来源没有可用内容',
  'target-unavailable': '目标卡已不可用',
  'content-unavailable': '当前版本正文尚未载入',
  'file-unchecked': '文件实际内容尚未确认',
  'earlier-stop': '前序步骤尚未通过检查',
  cycle: '存在循环关系',
  'not-found': '步骤已不在当前画板',
}

const headContent = (card: ContentCard | undefined) => card?.versions.find((version) => version.id === card.headVersionId)?.content
const hasContent = (card: ContentCard | undefined) => {
  const content = headContent(card)
  return content?.kind === 'markdown' ? Boolean(content.markdown.trim()) : Boolean(content?.path.trim())
}

export function previewRunTo(board: BoardV2, runs: Record<string, TransformationRun>, targetId: string): RunPreview {
  const order = transformationDependencyOrder(board, targetId)
  const target = board.transformations.find((step) => step.id === targetId)
  const result: RunPreview = {
    targetTransformationId: targetId, targetLabel: target?.label || '这一步', reason: order.reason,
    rows: [], summary: { generate: 0, keep: 0, check: 0, blocked: 0, unreached: 0 },
  }
  if (order.reason) {
    result.rows.push({ transformationId: targetId, targetCardId: target?.targetCardId || '',
      label: result.targetLabel, status: 'blocked', reason: order.reason, upstreamTransformationIds: [] })
    result.summary.blocked = 1
    return result
  }

  // Predicted outputs are separate facts, never temporary Heads or successful Runs.
  const predictedOutputs = new Map<string, string>()
  let stopped = false
  for (const id of order.transformationIds) {
    const step = board.transformations.find((item) => item.id === id)!
    const row: RunPreviewRow = {
      transformationId: id, targetCardId: step.targetCardId, label: step.label,
      status: 'unreached', reason: 'earlier-stop', upstreamTransformationIds: [],
    }
    result.rows.push(row)
    if (stopped) {
      result.summary.unreached++
      continue
    }
    const decision = transformationExecutionDecision(board, runs, id)
    const latestRun = step.lastRunId ? runs[step.lastRunId] : undefined
    const appliedRun = step.lastAppliedRunId ? runs[step.lastAppliedRunId]
      : latestRun?.status === 'succeeded' && latestRun.result?.disposition === 'applied' ? latestRun : undefined
    const targetCard = board.cards.find((item) => item.id === step.targetCardId)
    row.upstreamTransformationIds = step.sourceCardIds.flatMap((cardId) => {
      const producer = predictedOutputs.get(cardId)
      return producer ? [producer] : []
    })
    const unavailableSource = step.sourceCardIds.find((cardId) =>
      !predictedOutputs.has(cardId) && !hasContent(board.cards.find((item) => item.id === cardId)))
    const unknownFile = step.sourceCardIds.find((cardId) =>
      !predictedOutputs.has(cardId) && headContent(board.cards.find((item) => item.id === cardId))?.kind === 'file-reference')
    const unloadedSource = step.sourceCardIds.find((cardId) => {
      const source = board.cards.find((item) => item.id === cardId)
      return !predictedOutputs.has(cardId) && source?.headVersionId && !headContent(source)
    })
    const missingRunId = [step.lastRunId, step.lastAppliedRunId].find((runId) => runId && !runs[runId])

    if (decision.kind === 'candidate') {
      Object.assign(row, { status: 'blocked', reason: 'candidate', runId: decision.reason })
    } else if (latestRun?.status === 'running' || latestRun?.status === 'queued') {
      Object.assign(row, { status: 'blocked', reason: 'active-run', runId: latestRun.id })
    } else if (missingRunId) {
      Object.assign(row, { status: 'check', reason: 'run-unavailable', runId: missingRunId })
    } else if (!targetCard) {
      Object.assign(row, { status: 'blocked', reason: 'target-unavailable' })
    } else if (unloadedSource || (targetCard.headVersionId && !headContent(targetCard))) {
      Object.assign(row, { status: 'check', reason: 'content-unavailable', sourceCardId: unloadedSource })
    } else if (unavailableSource) {
      Object.assign(row, { status: 'blocked', reason: 'source-unavailable', sourceCardId: unavailableSource })
    } else if (unknownFile || headContent(targetCard)?.kind === 'file-reference') {
      Object.assign(row, { status: 'check', reason: 'file-unchecked', sourceCardId: unknownFile })
    } else if (!hasContent(targetCard)) {
      Object.assign(row, { status: 'generate', reason: row.upstreamTransformationIds.length ? 'waiting-upstream' : 'empty-target' })
    } else if (!appliedRun) {
      Object.assign(row, { status: 'keep', reason: 'manual-content' })
    } else if (decision.kind === 'run') {
      Object.assign(row, { status: 'generate', reason: decision.reason })
    } else if (row.upstreamTransformationIds.length) {
      Object.assign(row, { status: 'generate', reason: 'upstream-change' })
    } else {
      Object.assign(row, { status: 'keep', reason: 'current' })
    }
    if (row.status === 'generate') predictedOutputs.set(step.targetCardId, step.id)
    stopped = row.status === 'blocked' || row.status === 'check'
    result.summary[row.status]++
  }
  return result
}
