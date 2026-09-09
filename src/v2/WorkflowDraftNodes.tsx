import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Link2, Plus, X } from 'lucide-react'
import type { WorkflowTemplate } from '../domain'
import { useV2Canvas } from '../v2Store'
import {
  workflowDraftProgress,
  type WorkflowDraft,
  type WorkflowDraftStepData,
} from './workflowDraft'
import { useDrawerAction } from './drawerIntent'

export function WorkflowDraftActions({
  workflow,
  draft,
  applying = false,
  onCancel,
  onCreate,
}: {
  workflow: WorkflowTemplate
  draft: WorkflowDraft
  applying?: boolean
  onCancel: () => void
  onCreate: () => void
}) {
  const progress = workflowDraftProgress(workflow, draft)
  const directPlan = draft.source?.kind === 'ad-hoc'
  const cancelLabel = directPlan ? '取消搭计划' : '取消使用方法'
  return <footer className="v2-draft-actions nodrag">
    <span><b>{progress.completed}/{progress.required} 必填</b><small>只添加步骤，不会自动生成</small></span>
    <div>
      <button className="v2-draft-cancel" type="button" aria-label={cancelLabel} title={cancelLabel} disabled={applying} onClick={onCancel}><X size={13} /></button>
      <button className="v2-draft-confirm" type="button" disabled={!progress.ready || applying} onClick={onCreate}><Plus size={13} />{applying ? '添加中…' : directPlan ? '添加计划' : '添加步骤'}</button>
    </div>
  </footer>
}

export function WorkflowDraftStepNode({ data }: NodeProps) {
  const runDrawerAction = useDrawerAction()
  const step = data as WorkflowDraftStepData
  const selectedCount = useV2Canvas((state) => state.selectedCardIds.length)
  const draft = useV2Canvas((state) => state.workflowDraft)
  const workflow = useV2Canvas((state) => state.workflowDraft?.definition?.id === step.workflowId
    ? state.workflowDraft.definition
    : state.workflows.find((item) => item.id === step.workflowId))
  const applyingWorkflowId = useV2Canvas((state) => state.applyingWorkflowId)
  const bindSelected = useV2Canvas((state) => state.bindSelectedCardsToWorkflowInput)
  const unbind = useV2Canvas((state) => state.unbindWorkflowInput)
  const cancel = useV2Canvas((state) => state.cancelWorkflowDraft)
  const materialize = useV2Canvas((state) => state.materializeWorkflowDraft)
  return <article className="v2-workflow-draft-step">
    <Handle type="target" id="workflow-previous-output" position={Position.Left} className="v2-draft-previous-handle" />
    <header><span>正在连接</span><small>{step.stepIndex}/{step.stepTotal}</small></header>
    <strong>{step.label}</strong>
    {step.inputs.length > 0 && <div className="v2-draft-inputs">{step.inputs.map((input, index) => <section key={input.id}>
      <Handle
        type="target"
        id={`workflow-input:${input.id}`}
        position={Position.Left}
        className="v2-draft-input-handle"
        style={{ top: 82 + index * 58 }}
      />
      <div><b>{input.name}</b><small>{input.cardinality === 'many' ? '可多张' : '1 张'}{input.required ? ' · 必填' : ''}</small></div>
      {input.boundCardTitles.map((title, bindingIndex) => <span className="v2-draft-binding" key={input.boundCardIds[bindingIndex]}>
        {title}<button className="nodrag" type="button" aria-label={`移除 ${title}`} title="移除绑定" disabled={Boolean(applyingWorkflowId)} onClick={() => unbind(input.id, input.boundCardIds[bindingIndex])}><X size={11} /></button>
      </span>)}
      <button className="v2-draft-use-selection nodrag" type="button" disabled={selectedCount === 0 || Boolean(applyingWorkflowId)} onClick={() => bindSelected(input.id)}><Link2 size={12} />使用已选</button>
    </section>)}</div>}
    {step.stepIndex === 1 && workflow && draft && <WorkflowDraftActions
      workflow={workflow}
      draft={draft}
      applying={applyingWorkflowId === workflow.id}
      onCancel={cancel}
      onCreate={() => runDrawerAction(materialize)}
    />}
    <Handle type="source" position={Position.Right} />
  </article>
}

export function WorkflowDraftTargetNode({ data }: NodeProps) {
  const target = data as { label: string; stepIndex: number; stepTotal: number }
  return <article className="v2-workflow-draft-target">
    <Handle type="target" position={Position.Left} />
    <div><span>结果 {target.stepIndex}/{target.stepTotal}</span><strong>{target.label}</strong><small>添加后成为内容卡</small></div>
    <Handle type="source" position={Position.Right} />
  </article>
}
