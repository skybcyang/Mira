import { useEffect, useLayoutEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Transformation } from '../../domain'

export function transformationEditCommandLabel(transformation: Transformation): string {
  return transformation.planRef || transformation.workflowRef ? '编辑步骤' : '编辑转化'
}

export function TransformationEditForm({
  transformation,
  modelOverrideSupported = true,
  onCancel,
  onSave,
  onDirtyChange,
}: {
  transformation: Transformation
  modelOverrideSupported?: boolean
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
  onSave: (changes: {
    label: string
    instruction: string
    acceptance: string
    modelId?: string | null
    sourceCardIds?: string[]
  }) => Promise<boolean>
}) {
  const [label, setLabel] = useState(transformation.label)
  const [instruction, setInstruction] = useState(transformation.instruction)
  const [acceptance, setAcceptance] = useState(transformation.acceptance)
  const [modelMode, setModelMode] = useState<'inherit' | 'fixed'>(transformation.modelId ? 'fixed' : 'inherit')
  const [modelId, setModelId] = useState(transformation.modelId || '')
  const [saving, setSaving] = useState(false)
  const dirty = label !== transformation.label || instruction !== transformation.instruction
    || acceptance !== transformation.acceptance
    || (modelOverrideSupported && (modelMode !== (transformation.modelId ? 'fixed' : 'inherit')
      || (modelMode === 'fixed' && modelId !== (transformation.modelId || ''))))
  useLayoutEffect(() => { onDirtyChange?.(dirty || saving) }, [dirty, saving, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  return <form className="v2-transformation-edit-form" onSubmit={(event) => {
    event.preventDefault()
    if (!label.trim() || !instruction.trim() || (modelMode === 'fixed' && !modelId.trim()) || saving) return
    setSaving(true)
    void onSave({
      label: label.trim(),
      instruction: instruction.trim(),
      acceptance: acceptance.trim(),
      ...(modelOverrideSupported
        ? { modelId: modelMode === 'fixed' ? modelId.trim() : null }
        : {}),
    }).then((saved) => {
      setSaving(false)
      if (saved) onCancel()
    })
  }}>
    <label><span>成果名称</span><input autoFocus data-drawer-dirty={dirty ? 'true' : undefined} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    <label><span>生成目标</span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
    <label><span>完成标准</span><textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} /></label>
    <fieldset className="v2-model-strategy">
      <legend>模型</legend>
      {modelOverrideSupported
        ? <>
          <div role="radiogroup" aria-label="模型策略">
            <label><input type="radio" name="model-mode" checked={modelMode === 'inherit'} onChange={() => setModelMode('inherit')} /><span>继承默认模型</span></label>
            <label><input type="radio" name="model-mode" checked={modelMode === 'fixed'} onChange={() => setModelMode('fixed')} /><span>固定模型 ID</span></label>
          </div>
          {modelMode === 'fixed' && <input autoComplete="off" value={modelId} aria-label="模型 ID" placeholder="例如 reasoning-model" onChange={(event) => setModelId(event.target.value)} />}
          <p>{modelMode === 'fixed' ? '仅覆盖这一张转化块；连接地址和密钥仍使用全局设置。' : '执行时使用当前全局或宿主模型。'}</p>
        </>
        : <p className="v2-model-host-note">模型由当前宿主决定，这里只读且不会保存步骤覆盖。</p>}
    </fieldset>
    <p className="v2-structure-retention-note">保留目标卡、流程归属和运行历史。</p>
    <footer><button type="button" onClick={onCancel}>取消</button><button className="v2-primary-button" type="submit" disabled={!label.trim() || !instruction.trim() || (modelMode === 'fixed' && !modelId.trim()) || saving}>{saving ? '正在保存…' : '保存修改'}</button></footer>
  </form>
}

export function TransformationDeleteControl({
  confirming,
  disabled = false,
  onRequest,
  onCancel,
  onConfirm,
}: {
  confirming: boolean
  disabled?: boolean
  onRequest: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!confirming) return <button className="v2-danger-button v2-delete-structure-trigger" type="button" disabled={disabled} onClick={onRequest}><Trash2 size={15} />删除转化</button>
  return <div className="v2-structure-delete-confirm" role="alert">
    <p><strong>只删除这条转化关系。</strong><span>目标卡、版本和已有运行都会保留。</span></p>
    <div><button type="button" onClick={onCancel}>取消</button><button className="v2-danger-button" type="button" disabled={disabled} onClick={onConfirm}>确认删除转化</button></div>
  </div>
}
