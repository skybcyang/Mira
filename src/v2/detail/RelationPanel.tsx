import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Transformation, TransformationRun } from '../../domain'
import { v2Api } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { cardSummary } from '../../v2View'
import {
  workflowExtractionPreview,
  workflowExtractionReady,
  workflowExternalSources,
  transformationSourcesReady,
} from '../../workflows'
import { useDrawerAction } from '../drawerIntent'
import { SaveWorkflowControl, WorkflowProvenancePanel } from './WorkflowPanels'
import { TransformationDeleteControl, TransformationEditForm, transformationEditCommandLabel } from './TransformationControls'
import { TransformationRunControl } from './RunPanel'
import { SourceManager } from './SourceManager'
import { sourceEditBlock } from '../transformationSources'
import { RunRangePreview } from './RunRangePreview'
import { sourceComparisonRows } from '../sourceComparison'
import { useSourcePreview } from '../sourcePreviewContext'

function appliedRunForRelation(
  transformation: Transformation,
  runs: Record<string, TransformationRun>,
): TransformationRun | undefined {
  if (transformation.lastAppliedRunId) return runs[transformation.lastAppliedRunId]
  const latestRun = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
  return latestRun?.status === 'succeeded' && latestRun.result?.disposition === 'applied'
    ? latestRun
    : undefined
}

export function RelationPanel({ transformationId, initialEditing = false, initialPreview = false, onDirtyChange }: { transformationId: string; initialEditing?: boolean; initialPreview?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const runDrawerAction = useDrawerAction()
  const board = useV2Canvas((state) => state.board)
  const runs = useV2Canvas((state) => state.runs)
  const runTo = useV2Canvas((state) => state.runToTransformation)
  const interrupt = useV2Canvas((state) => state.interruptRun)
  const runningToTransformationId = useV2Canvas((state) => state.runningToTransformationId)
  const createWorkflow = useV2Canvas((state) => state.createWorkflowFromTransformation)
  const workflows = useV2Canvas((state) => state.workflows)
  const workflowState = useV2Canvas((state) => state.workflowState)
  const open = useV2Canvas((state) => state.openDrawer)
  const updateTransformation = useV2Canvas((state) => state.updateTransformation)
  const deleteTransformation = useV2Canvas((state) => state.deleteTransformation)
  const [editing, setEditing] = useState(initialEditing)
  const sourcePreview = useSourcePreview()
  useEffect(() => { if (initialEditing) setEditing(true) }, [initialEditing])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [modelOverrideSupported, setModelOverrideSupported] = useState(true)
  useEffect(() => {
    let current = true
    void v2Api.getModelSettings().catch(() => {
      if (current) setModelOverrideSupported(false)
    })
    return () => { current = false }
  }, [])
  const transformation = board?.transformations.find((item) => item.id === transformationId)
  if (!board || !transformation) return <p className="v2-empty-detail">这条关系已不在当前画板中。</p>
  const run = transformation.lastRunId ? runs[transformation.lastRunId] : undefined
  const activeRun = Object.values(runs).find((item) => item.status === 'queued' || item.status === 'running')
  const appliedRun = appliedRunForRelation(transformation, runs)
  const appliedSourceIds = appliedRun?.sourceSnapshot.map((snapshot) => snapshot.cardId)
  const sourceStructureChanged = Boolean(appliedSourceIds
    && (appliedSourceIds.length !== transformation.sourceCardIds.length
      || transformation.sourceCardIds.some((cardId, index) => cardId !== appliedSourceIds[index])))
  const candidatePending = run?.result?.disposition === 'candidate'
  const extractionPreview = workflowExtractionPreview(board, transformation.id)
  const extractionReady = workflowExtractionReady(board, transformation.id, extractionPreview)
  const sourcesReady = transformationSourcesReady(board, transformation)
  const extractionSources = workflowExternalSources(board, extractionPreview.chain)
  const workflowRef = transformation.workflowRef
  const planRef = transformation.planRef
  const workflowPlan = planRef
    ? board.transformations
      .filter((item) => item.planRef?.planId === planRef.planId)
      .sort((left, right) => (left.planRef?.stepIndex || 0) - (right.planRef?.stepIndex || 0))
    : workflowRef
      ? board.transformations.filter((item) => item.workflowRef?.workflowId === workflowRef.workflowId
        && item.workflowRef.applicationId === workflowRef.applicationId)
      : []
  const workflow = workflowRef
    ? workflows.find((item) => item.id === workflowRef.workflowId)
    : undefined
  return <div className="v2-relation-panel">
    {(planRef || workflowRef) && <WorkflowProvenancePanel
      workflow={workflow}
      templateState={workflowState}
      applicationId={workflowRef?.applicationId}
      planId={planRef?.planId}
      planTitle={planRef?.title}
      planSource={planRef?.source || 'template'}
      planStepTotal={planRef?.stepTotal}
      steps={workflowPlan}
      currentTransformationId={transformation.id}
      onNavigate={(nextId) => open({ tab: 'relation', transformationId: nextId })}
    />}
    {editing && !candidatePending
      ? <TransformationEditForm
        onDirtyChange={onDirtyChange}
        transformation={transformation}
        modelOverrideSupported={modelOverrideSupported}
        onCancel={() => setEditing(false)}
        onSave={(changes) => updateTransformation(transformation.id, changes)}
      />
      : <><div className="v2-structure-toolbar"><button className="v2-secondary-button" type="button" disabled={candidatePending} onClick={() => setEditing(true)}><Pencil size={14} />{transformationEditCommandLabel(transformation)}</button></div>
    <dl><dt>成果</dt><dd>{transformation.label}</dd><dt>目标</dt><dd>{transformation.instruction}</dd><dt>模型</dt><dd>{transformation.modelId || '继承默认模型'}</dd>
      {transformation.acceptance && <><dt>完成标准</dt><dd>{transformation.acceptance}</dd></>}</dl>
    <SourceManager transformation={transformation} blocked={sourceEditBlock(board, transformation, runs)} sources={transformation.sourceCardIds.map((cardId) => {
      const card = board.cards.find((item) => item.id === cardId)
      const snap = appliedRun?.sourceSnapshot.find((item) => item.cardId === cardId)
      const changed = Boolean(snap && card?.headVersionId !== snap.versionId)
      const sourceState = !appliedRun
        ? '尚无已采用结果'
        : sourceStructureChanged
          ? '来源或顺序已变化'
          : changed
            ? '来源已变化'
            : '与最近结果一致'
      return { cardId, title: card ? cardSummary(card).title : '来源已移除', status: sourceState }
    })} />
    <details className="v2-source-state-summary"><summary>来源状态摘要</summary>
    <ul className="v2-source-comparison">{sourceComparisonRows(board, transformation, appliedRun).map((row) => <li key={row.cardId}>
      <button type="button" disabled={!sourcePreview} onClick={() => sourcePreview?.({ boardId: board.id, cardId: row.cardId, snapshot: row.snapshot, runId: appliedRun?.id })}>
        <strong>{row.currentOrder ?? '已移除'} · {row.title}</strong>
        <span>当时 {row.historicalVersionLabel} / 当前 {row.currentVersionLabel}</span>
        <small>{{ same: '与已采用输入一致', changed: '来源已变化', added: '新增来源', removed: '来源已移除', reordered: `顺序 ${row.historicalOrder} → ${row.currentOrder}`, unknown: '尚未确认' }[row.status]}</small>
      </button>
    </li>)}</ul></details>
    {candidatePending && <p className="v2-candidate-structure-block">先采用或丢弃待比较结果，再修改、删除或重新生成。</p>}
    {run && <button className="v2-secondary-button" type="button" onClick={() => open({ tab: 'run', runId: run.id })}>{candidatePending ? '比较待处理结果' : '查看最近运行'}</button>}
    <TransformationRunControl
      workflowStep={Boolean(transformation.planRef || transformation.workflowRef)}
      hasRun={Boolean(transformation.lastRunId)}
      sourcesReady={sourcesReady}
      candidatePending={candidatePending}
      busy={Boolean(runningToTransformationId)}
      running={runningToTransformationId === transformation.id}
      onRun={() => runDrawerAction(() => runTo(transformation.id))}
      onStop={activeRun ? () => interrupt(activeRun.id) : undefined}
    />
    <RunRangePreview transformationId={transformation.id} initiallyOpen={initialPreview} />
    <SaveWorkflowControl
      preview={extractionPreview}
      sources={extractionSources}
      disabled={!extractionReady}
      onSave={async (title, description, inputs) => Boolean(await createWorkflow(transformation.id, title, description, inputs))}
    />
    <TransformationDeleteControl
      confirming={confirmingDelete}
      disabled={candidatePending}
      onRequest={() => setConfirmingDelete(true)}
      onCancel={() => setConfirmingDelete(false)}
      onConfirm={() => { void deleteTransformation(transformation.id) }}
    /></>}
  </div>
}
