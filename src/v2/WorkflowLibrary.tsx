import { ArrowDown, ArrowUp, ArrowLeft, ArrowRight, LayoutTemplate, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useId, useState, useLayoutEffect } from 'react'
import type { WorkflowTemplate } from '../domain'
import { useV2Canvas } from '../v2Store'
import { normalizeWorkflowContract } from '../workflows'
import {
  adHocPlanReady,
  adHocPlanStep,
  reorderAdHocPlanSteps,
  type AdHocPlanInput,
} from './workflowDraft'

type LibraryState = 'idle' | 'loading' | 'ready' | 'error'

const emptyPlan = (): AdHocPlanInput => ({ title: '', finalOutcome: '', steps: [{label:'',instruction:''}] })

export function PlanComposer({
  value,
  onChange,
  onCancel,
  onPreview,
}: {
  value: AdHocPlanInput
  onChange: (value: AdHocPlanInput) => void
  onCancel: () => void
  onPreview: (value: AdHocPlanInput) => void
}) {
  const finalOutcomeHelpId = useId()
  const updateStep = (index: number, step: {label:string;instruction:string}) => {
    const steps = [...value.steps]
    steps[index] = step
    onChange({ ...value, steps })
  }
  const removeStep = (index: number) => {
    if (value.steps.length <= 1) return
    onChange({ ...value, steps: value.steps.filter((_step, itemIndex) => itemIndex !== index) })
  }
  return <form
    className="v2-plan-composer"
    aria-label="搭一个计划"
    onSubmit={(event) => { event.preventDefault(); if (adHocPlanReady(value)) onPreview(value) }}
  >
    <p className="v2-plan-description">先想清楚要得到什么，再安排推进步骤。</p>
    <label>计划名称<input
      value={value.title}
      required
      maxLength={120}
      placeholder="例如：验证一个产品想法"
      onChange={(event) => onChange({ ...value, title: event.target.value })}
    /></label>
    <label><span>最终成果名称</span><small id={finalOutcomeHelpId}>最后一步直接使用这个成果名称</small><input
      value={value.finalOutcome}
      required
      placeholder="例如：一页产品验证方案"
      aria-describedby={finalOutcomeHelpId}
      onChange={(event) => onChange({ ...value, finalOutcome: event.target.value })}
    /></label>
    <div className="v2-plan-section-title"><h3>推进步骤</h3><span>{value.steps.length} 个步骤</span></div>
    <ol className="v2-plan-step-editor">
      {value.steps.map((rawStep, index) => {
        const step = adHocPlanStep(rawStep)
        const final = index === value.steps.length - 1
        return <li key={index}>
        <strong>步骤 {String(index + 1).padStart(2, '0')}</strong>
        <div>
          <button
            className="v2-icon-button"
            type="button"
            aria-label={`上移步骤 ${index + 1}`}
            title="上移"
            disabled={index === 0}
            onClick={() => onChange({
              ...value,
              steps: reorderAdHocPlanSteps(value.steps, index, index - 1),
            })}
          ><ArrowUp size={14} /></button>
          <button
            className="v2-icon-button"
            type="button"
            aria-label={`下移步骤 ${index + 1}`}
            title="下移"
            disabled={index === value.steps.length - 1}
            onClick={() => onChange({
              ...value,
              steps: reorderAdHocPlanSteps(value.steps, index, index + 1),
            })}
          ><ArrowDown size={14} /></button>
          <button
            className="v2-icon-button"
            type="button"
            aria-label={`删除步骤 ${index + 1}`}
            title="删除步骤"
            disabled={value.steps.length === 1}
            onClick={() => removeStep(index)}
          ><Trash2 size={14} /></button>
        </div>
        <label><span>{final ? '这一步的成果（同最终成果）' : '这一步的成果'}</span><input
          value={final ? value.finalOutcome : step.label}
          required={!final} readOnly={final}
          placeholder={final ? '填写上方的最终成果后显示在这里' : '例如：用户问题清单'}
          onChange={event => updateStep(index, {...step,label:event.target.value})}
        /></label>
        <label><span>步骤 {index + 1} · 处理要求</span><textarea rows={3} required value={step.instruction}
          placeholder="说明如何处理材料，以及希望保留哪些信息"
          onChange={event => updateStep(index,{...step,instruction:event.target.value})} /></label>
      </li>})}
    </ol>
    <button
      className="v2-secondary-button"
      type="button"
      aria-label="新增步骤"
      onClick={() => onChange({ ...value, steps: [...value.steps.map((step,index) => index === value.steps.length - 1 ? {...adHocPlanStep(step),label:value.finalOutcome} : step), {label:'',instruction:''}] })}
    ><Plus size={14} />添加步骤</button>
    <p className="v2-plan-description">下一步在画布预览，并明确绑定起始内容。确认添加前，不会创建卡片或运行任务。</p>
    <footer>
      <button className="v2-secondary-button" type="button" aria-label="取消搭计划" onClick={onCancel}>取消</button>
      <button
        className="v2-primary-button"
        type="submit"
        aria-label="在画布预览计划"
        disabled={!adHocPlanReady(value)}
      >预览计划<ArrowRight size={15} /></button>
    </footer>
  </form>
}

export function WorkflowDeleteControl({
  workflow,
  confirming,
  onRequest,
  onCancel,
  onConfirm,
}: {
  workflow: WorkflowTemplate
  confirming: boolean
  onRequest: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!confirming) return <button className="v2-icon-button" type="button" aria-label={`删除方法 ${workflow.title}`} title="删除方法" onClick={onRequest}><Trash2 size={15} /></button>
  return <div className="v2-workflow-delete-confirm" role="alert">
    <p><strong>删除模板？</strong><span>不影响已有计划。</span></p>
    <div><button type="button" onClick={onCancel}>取消</button><button className="v2-danger-button" type="button" onClick={onConfirm}>确认删除</button></div>
  </div>
}

export function WorkflowLibraryView({
  workflows,
  state,
  onClose,
  onDelete,
  onUse,
  onBuildPlan,
  onRefresh,
}: {
  workflows: WorkflowTemplate[]
  state: LibraryState
  onClose: () => void
  onDelete: (workflowId: string) => void
  onUse: (workflowId: string) => void
  onBuildPlan?: () => void
  onRefresh?: () => void
}) {
  const [confirmingWorkflowId, setConfirmingWorkflowId] = useState<string | null>(null)
  return <aside className="v2-workflow-library" aria-label="方法与计划">
    <header className="v2-workflow-library-head">
      <div><span>安排下一步</span><h2>方法与计划</h2></div>
      <button autoFocus className="v2-icon-button" type="button" aria-label="关闭方法与计划" title="关闭方法与计划" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="v2-workflow-library-body">
      {onBuildPlan && <div className="v2-plan-entry">
        <button className="v2-secondary-button" type="button" onClick={onBuildPlan}>
          <Plus size={18} /><span><strong>搭一个计划</strong><small>从零安排这次任务的步骤</small></span><ArrowRight size={16} />
        </button>
      </div>}
      <div className="v2-library-section-title"><h3>已保存的方法</h3><p>把走通的步骤，用在新的材料上。</p></div>
      {state === 'loading' && workflows.length === 0 && <div className="v2-library-state">正在读取方法…</div>}
      {state === 'error' && <div className="v2-library-state is-error" role="alert"><span>{workflows.length > 0 ? '刷新失败，当前显示上次载入的方法。' : '方法暂时无法读取'}</span>{onRefresh && <button className="v2-secondary-button" type="button" onClick={onRefresh}><RefreshCw size={14} />重新加载</button>}</div>}
      {state === 'ready' && workflows.length === 0 && <div className="v2-library-state">还没有保存的方法。先搭一个计划，走通后可以保存为方法。</div>}
      {workflows.length > 0 && <div className="v2-workflow-list">
        {workflows.map((workflow) => {
          const contract = normalizeWorkflowContract(workflow)
          return <article className="v2-workflow-item" key={workflow.id}>
          <header><div><h3>{workflow.title}</h3>{workflow.description && <p>{workflow.description}</p>}</div><WorkflowDeleteControl
            workflow={workflow}
            confirming={confirmingWorkflowId === workflow.id}
            onRequest={() => setConfirmingWorkflowId(workflow.id)}
            onCancel={() => setConfirmingWorkflowId(null)}
            onConfirm={() => { setConfirmingWorkflowId(null); onDelete(workflow.id) }}
          /></header>
          <div className="v2-workflow-summary"><p className="v2-workflow-outcome"><span>最终成果</span><strong>{workflow.steps[workflow.steps.length - 1]?.label || '未命名成果'}</strong></p><span>{workflow.steps.length} 步</span></div>
          <div className="v2-workflow-input-list"><span>需要</span>{contract.inputs.map((input) => <strong key={input.id}>{input.name}<small>{input.cardinality === 'many' ? '可多选' : '单张'}{input.required ? ' · 必填' : ''}</small></strong>)}</div>
          <details className="v2-workflow-details"><summary>完整步骤</summary>
          <ol className="v2-workflow-step-list">{workflow.steps.map((step, index) => <li key={step.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.label}</strong><small>{step.instruction}</small></div></li>)}</ol>
          </details>
          <button className="v2-secondary-button v2-workflow-use" type="button" onClick={() => onUse(workflow.id)}><LayoutTemplate size={15} />使用方法</button>
        </article>})}
      </div>}
    </div>
  </aside>
}

export default function WorkflowLibrary({
  onClose,
  draftOrigin,
  initialView = 'library',
  onDirtyChange,
  onRequestLeave = action => action(),
}: {
  onClose: () => void
  draftOrigin?: { x: number; y: number }
  initialView?: 'library' | 'plan'
  onDirtyChange?: (dirty:boolean) => void
  onRequestLeave?: (action:()=>void) => void
}) {
  const workflows = useV2Canvas((state) => state.workflows)
  const state = useV2Canvas((canvas) => canvas.workflowState)
  const refresh = useV2Canvas((canvas) => canvas.refreshWorkflows)
  const deleteWorkflow = useV2Canvas((canvas) => canvas.deleteWorkflow)
  const beginWorkflowDraft = useV2Canvas((canvas) => canvas.beginWorkflowDraft)
  const beginAdHocPlanDraft = useV2Canvas((canvas) => canvas.beginAdHocPlanDraft)
  const [view, setView] = useState<'library' | 'plan'>(initialView)
  const [plan, setPlan] = useState<AdHocPlanInput>(emptyPlan)
  const dirty = view === 'plan' && Boolean(plan.title || plan.finalOutcome || plan.steps.length > 1 || plan.steps.some(step => adHocPlanStep(step).label || adHocPlanStep(step).instruction))
  useLayoutEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty,onDirtyChange])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setView(initialView); setPlan(emptyPlan()) }, [initialView])

  if (view === 'plan') return <aside className="v2-workflow-library" aria-label="计划编辑">
    <header className="v2-workflow-library-head">
      <div><button className="v2-plan-back" type="button" onClick={() => onRequestLeave(() => {setPlan(emptyPlan());setView('library')})}><ArrowLeft size={14}/>方法与计划</button><h2>搭一个计划</h2></div>
      <button autoFocus className="v2-icon-button" type="button" aria-label="关闭计划编辑" title="关闭" onClick={() => onRequestLeave(onClose)}><X size={18} /></button>
    </header>
    <div className="v2-workflow-library-body">
      <PlanComposer
        value={plan}
        onChange={setPlan}
        onCancel={() => onRequestLeave(() => {setPlan(emptyPlan());setView('library')})}
        onPreview={(value) => {
          beginAdHocPlanDraft(value, draftOrigin)
          onClose()
        }}
      />
    </div>
  </aside>

  return <WorkflowLibraryView
    workflows={workflows}
    state={state}
    onClose={onClose}
    onDelete={(workflowId) => void deleteWorkflow(workflowId)}
    onUse={(workflowId) => { beginWorkflowDraft(workflowId, draftOrigin); onClose() }}
    onBuildPlan={() => setView('plan')}
    onRefresh={() => void refresh()}
  />
}
