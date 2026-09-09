import { useState } from 'react'
import { Save } from 'lucide-react'
import type { CreateWorkflowInputSlot, Transformation, WorkflowTemplate } from '../../domain'
import type {
  WorkflowExtractionPreview,
  WorkflowExtractionStopReason,
  WorkflowSourceSummary,
} from '../../workflows'

const STOP_REASON_COPY: Record<WorkflowExtractionStopReason, string> = {
  'downstream-unfinished': '后续成果尚未完成，方法只保存到当前已完成步骤。',
  'plan-incomplete': '计划步骤已调整或缺失，不能保存为完整方法。',
  'fan-out': '下游存在多个方向，方法只保存到分支之前。',
  merge: '下游需要合并其他来源，方法只保存到合并之前。',
  cycle: '检测到循环关系，不能保存为方法。',
}

export function SaveWorkflowForm({
  preview,
  sources,
  initialTitle,
  onCancel,
  onSave,
}: {
  preview: WorkflowExtractionPreview
  sources: WorkflowSourceSummary[]
  initialTitle: string
  onCancel: () => void
  onSave: (title: string, description: string, inputs: CreateWorkflowInputSlot[]) => Promise<boolean>
}) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [inputs, setInputs] = useState<CreateWorkflowInputSlot[]>(() => sources.map((source) => ({
    sourceCardId: source.cardId,
    name: source.title,
    description: '',
    required: true,
    cardinality: 'one',
  })))
  return <form className="v2-save-workflow-form" onSubmit={(event) => {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    void onSave(title.trim(), description.trim(), inputs).then((saved) => {
      setSaving(false)
      if (saved) onCancel()
    })
  }}>
    <label><span>方法名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label><span>方法说明（可选）</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个方法适合解决什么问题" /></label>
    <section className="v2-workflow-extraction-section"><h3>外部输入</h3><div className="v2-workflow-input-editor">
      {sources.map((source, index) => <fieldset key={source.cardId}><legend><span>{index + 1}</span>{source.title}<small>{source.versionLabel}</small></legend>
        <label><span>输入名称</span><input value={inputs[index]?.name || ''} onChange={(event) => setInputs((current) => current.map((input, itemIndex) => itemIndex === index ? { ...input, name: event.target.value } : input))} /></label>
        <label><span>用途说明（可选）</span><input value={inputs[index]?.description || ''} placeholder="这类内容在方法中的作用" onChange={(event) => setInputs((current) => current.map((input, itemIndex) => itemIndex === index ? { ...input, description: event.target.value } : input))} /></label>
        <div><label><span>数量</span><select value={inputs[index]?.cardinality || 'one'} onChange={(event) => setInputs((current) => current.map((input, itemIndex) => itemIndex === index ? { ...input, cardinality: event.target.value as 'one' | 'many' } : input))}><option value="one">单张</option><option value="many">可多选</option></select></label>
          <label className="v2-workflow-required"><input type="checkbox" checked={inputs[index]?.required ?? true} onChange={(event) => setInputs((current) => current.map((input, itemIndex) => itemIndex === index ? { ...input, required: event.target.checked } : input))} /><span>必填</span></label></div>
      </fieldset>)}
    </div></section>
    <section className="v2-workflow-extraction-section"><h3>将保存的步骤</h3><ol className="v2-chain-preview">{preview.chain.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><strong>{item.label}</strong><p>{item.instruction}</p>{item.acceptance && <small>完成标准：{item.acceptance}</small>}</div></li>)}</ol></section>
    {preview.stopReason && <p className={`v2-workflow-stop-reason ${preview.stopReason}`}>{STOP_REASON_COPY[preview.stopReason]}</p>}
    <p className="v2-workflow-method-note">只保存方法，不复制当前内容。</p>
    <div><button type="button" onClick={onCancel}>取消</button><button className="v2-primary-button" type="submit" disabled={!title.trim() || inputs.some((input) => !input.name.trim()) || saving}>{saving ? '正在保存…' : '保存'}</button></div>
  </form>
}

export function SaveWorkflowControl({
  preview,
  sources,
  disabled = false,
  onSave,
}: {
  preview: WorkflowExtractionPreview
  sources: WorkflowSourceSummary[]
  disabled?: boolean
  onSave: (title: string, description: string, inputs: CreateWorkflowInputSlot[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const unavailable = disabled || preview.chain.length === 0
  const status = preview.stopReason === 'cycle'
    ? '存在循环'
    : unavailable
      ? '成果未完成'
      : `${preview.chain.length} 步`
  if (!open) return <button className="v2-secondary-button v2-save-workflow-trigger" type="button" disabled={unavailable} onClick={() => setOpen(true)}><Save size={15} />保存为方法<span>{status}</span></button>
  return <SaveWorkflowForm
    preview={preview}
    sources={sources}
    initialTitle={preview.chain[0]?.label || ''}
    onCancel={() => setOpen(false)}
    onSave={onSave}
  />
}

export function WorkflowProvenancePanel({
  workflow,
  templateState = 'ready',
  applicationId,
  planId,
  planTitle,
  planSource = 'template',
  planStepTotal,
  steps,
  currentTransformationId,
  onNavigate,
}: {
  workflow?: WorkflowTemplate
  templateState?: 'idle' | 'loading' | 'ready' | 'error'
  applicationId?: string
  planId?: string
  planTitle?: string
  planSource?: 'ad-hoc' | 'template'
  planStepTotal?: number
  steps: Transformation[]
  currentTransformationId: string
  onNavigate: (transformationId: string) => void
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentTransformationId))
  const currentStep = steps[currentIndex]
  const currentPosition = currentStep?.planRef
    ? `${currentStep.planRef.stepIndex}/${currentStep.planRef.stepTotal}`
    : `${currentIndex + 1}/${steps.length}`
  const direct = planSource === 'ad-hoc'
  const title = direct
    ? planTitle || '未命名计划'
    : workflow?.title || planTitle
      || (templateState === 'ready' ? '模板已删除' : '模板信息暂未载入')
  const adjusted = Boolean(
    (planStepTotal && steps.length !== planStepTotal)
    || steps.some((step) => step.planRef?.adjusted),
  )
  return <section className="v2-workflow-provenance" aria-label={direct ? '计划步骤' : '方法步骤'}>
    <header><div><span>{direct ? '直接计划' : '来自方法'}</span><strong>{title}</strong></div><span>当前步骤 {currentPosition}</span></header>
    <dl><dt>{direct ? '计划 ID' : '应用 ID'}</dt><dd><code>{direct ? planId : applicationId}</code></dd></dl>
    <nav aria-label="同计划步骤">{steps.map((step, index) => {
      const stepIndex = step.planRef?.stepIndex || index + 1
      const stepTotal = step.planRef?.stepTotal || steps.length
      return <button
      type="button"
      className={step.id === currentTransformationId ? 'is-active' : ''}
      aria-current={step.id === currentTransformationId ? 'step' : undefined}
      aria-label={`打开步骤 ${stepIndex}：${step.label}`}
      key={step.id}
      onClick={() => onNavigate(step.id)}
    ><span>{stepIndex}/{stepTotal}</span><strong>{step.label}</strong></button>
    })}</nav>
    {adjusted && <p>计划已调整，剩余步骤仍按当前依赖继续工作。</p>}
    {!direct && !workflow && templateState === 'ready' && <p>模板已删除，已有计划仍可运行到任一步。</p>}
  </section>
}
