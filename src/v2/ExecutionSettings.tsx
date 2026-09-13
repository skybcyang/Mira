import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { v2Api } from '../v2Api'
import { guidanceCatalog, importGuidanceText, updateExecutionSettings, type ExecutionSettings as Settings, type ExecutionSettingsInput, type GuidanceChange } from '../domain/executionSettings.js'
import { listOutputPolicies } from '../domain/outputPolicy.js'
import { useInspectorDraft } from './inspectorDrafts'
import { compareVersionText } from './cardVersions'

export default function ExecutionSettings({ onClose, onDirtyChange, onRequestLeave }: {
  onClose: () => void; onDirtyChange: (dirty: boolean) => void; onRequestLeave: (action: () => void) => void
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selection, setSelection] = useState('default')
  const [generation, setGeneration] = useState(0)
  const handleDirtyChange = useCallback((dirty: boolean) => { onDirtyChange(dirty); if (dirty) setNotice('') }, [onDirtyChange])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void v2Api.getExecutionSettings().then(result => { if (alive.current) setSettings(result.settings) })
      .catch(() => { if (alive.current) setError('无法读取项目设置。请重试；已保存设置不会被替换。') })
    return () => { alive.current = false }
  }, [])
  const load = async () => {
    setError('')
    try { const result = await v2Api.getExecutionSettings(); if (alive.current) { setSettings(result.settings); setGeneration(value => value + 1) } }
    catch { if (alive.current) setError('无法读取项目设置，请稍后重试。') }
  }
  const choices = settings ? guidanceCatalog(settings) : []
  if (settings) for (const id of settings.disabledGuidanceIds) {
    const item = [...settings.guidance].reverse().find(guide => guide.id === id)
    if (item) choices.push(item)
  }
  return <aside className="v2-model-settings v2-execution-settings" aria-label="能力管理">
    <header className="v2-model-settings-head"><div><span>当前项目</span><h2>能力管理</h2></div><button autoFocus type="button" className="v2-icon-button" aria-label="关闭能力管理" onClick={() => onRequestLeave(onClose)}><X size={18} /></button></header>
    {!settings ? <div className="v2-model-settings-state" role={error ? 'alert' : 'status'}>{error || '正在读取项目设置…'}{error && <button type="button" onClick={() => void load()}>重新读取</button>}</div> : <>
      <div className="v2-execution-navigation">
        <label>设置项目<select value={selection} onChange={event => { const value = event.target.value; onRequestLeave(() => { setSelection(value); setNotice('') }) }}>
          <option value="default">新步骤默认风格</option><optgroup label="指导目录（Skill）">
            <option value="new">新建或导入指导</option>
            {choices.map(item => <option key={item.id} value={item.id}>{item.title} · {item.origin === 'custom' ? '自定义' : item.origin === 'imported' ? '导入文本' : '内置'} · {item.version}{settings.disabledGuidanceIds.includes(item.id) ? ' · 已停用' : ''}</option>)}
          </optgroup>
        </select></label>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p className="v2-detail-note" role="status">{notice}</p>}
      <ExecutionSettingsEditor key={`${selection}:${generation}`} settings={settings} selection={selection}
        onDirtyChange={handleDirtyChange} onRequestLeave={onRequestLeave}
        onSaved={(saved, id) => { setSettings(saved); setNotice('已保存。已有步骤与 Run 保持原规则。'); if (id) setSelection(id); setGeneration(value => value + 1) }}
        onReload={() => void load()} />
    </>}
  </aside>
}

export function ExecutionSettingsEditor({ settings, selection, onDirtyChange, onRequestLeave, onSaved, onReload }: {
  settings: Settings; selection: string; onDirtyChange: (dirty: boolean) => void; onRequestLeave: (action: () => void) => void
  onSaved: (settings: Settings, id?: string) => void; onReload: () => void
}) {
  const [initial] = useState(settings)
  const guide = guidanceCatalog(initial).find(item => item.id === selection) || [...initial.guidance].reverse().find(item => item.id === selection)
  const isDefault = selection === 'default', editable = !guide || Boolean(guide.origin)
  const policies = listOutputPolicies()
  const policyKey = (item: { id: string; version: string }) => `${item.id}@${item.version}`
  const initialPolicyKey = initial.defaultOutputPolicy ? policyKey(initial.defaultOutputPolicy) : ''
  const [policyId, setPolicyId] = useState(initialPolicyKey)
  const [title, setTitle] = useState(guide?.title || '')
  const [text, setText] = useState(isDefault ? initial.defaultOutputPolicy?.text || '' : guide?.text || '')
  const [origin, setOrigin] = useState<GuidanceChange['origin']>(guide?.origin || 'custom')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  const lock = useRef(false), alive = useRef(true)
  const firstInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const defaultSelect = useRef<HTMLSelectElement>(null)
  useEffect(() => { alive.current = true; (isDefault ? defaultSelect.current : firstInput.current)?.focus(); return () => { alive.current = false } }, [isDefault])
  const dirty = !saved && (isDefault ? policyId !== initialPolicyKey || (Boolean(policyId) && text !== initial.defaultOutputPolicy?.text)
    : editable && (title !== (guide?.title || '') || text !== (guide?.text || '')))
  useLayoutEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  const policy = policies.find(item => policyKey(item) === policyId)
  const historicalPolicy = initial.defaultOutputPolicy && !policies.some(item => policyKey(item) === initialPolicyKey) ? initial.defaultOutputPolicy : null
  const input: ExecutionSettingsInput = isDefault ? { baseRevision: initial.revision,
    defaultOutputPolicy: policy ? { id: policy.id, version: policy.version, text } : null }
    : { baseRevision: initial.revision, guidance: { ...(guide ? { id: guide.id } : {}), title, text, origin } }
  let validation = ''
  if (dirty) try { updateExecutionSettings(initial, input, () => 'guidance-preview') } catch (cause) { validation = cause instanceof Error ? cause.message : '请核对设置。' }
  const submit = async (body: ExecutionSettingsInput) => {
    if (lock.current || uncertain) return false
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await v2Api.updateExecutionSettings(body)
      if (!alive.current) return true
      setSaved(true)
      onSaved(result.settings, selection === 'new' ? result.settings.guidance[result.settings.guidance.length - 1]?.id : undefined)
      return true
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : '未确认保存成功。请保留草稿并重新核对。'); setUncertain(true) }
      return false
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const save = () => !dirty || validation || busy ? Promise.resolve(false) : submit(input)
  useInspectorDraft('execution-settings', dirty, save, busy || uncertain || Boolean(validation))
  const importFile = async (file: File | undefined) => {
    if (!file || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (file.size > 80000) throw new Error('文件过大，请选择正文不超过 20000 字符的文本。')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const draft = importGuidanceText(file.name, content)
      if (alive.current) { setTitle(draft.title); setText(draft.text); setOrigin('imported') }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '无法读取文本文件。') }
    finally { lock.current = false; if (alive.current) setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const diff = compareVersionText(isDefault ? initial.defaultOutputPolicy?.text || '' : guide?.text || '', text)
  return <section className="v2-model-settings-form v2-guidance-panel" aria-label={isDefault ? '新步骤默认风格' : '指导目录编辑'} aria-busy={busy}>
    <h3>{isDefault ? '新步骤默认风格' : guide ? `${guide.title} · ${guide.version}` : '新建指导'}</h3>
    <p className="v2-detail-note">{isDefault ? '只影响之后创建的步骤。已有步骤与方法保持原规则。具体字符和结构约束在步骤中设置。' : '指导只作为模型输入。保存不运行、不安装依赖，也不授予工具权限。'}</p>
    {isDefault ? <label>默认表达风格<select ref={defaultSelect} disabled={busy || uncertain} value={policyId} onChange={event => { setPolicyId(event.target.value); setText(policies.find(item => policyKey(item) === event.target.value)?.text || historicalPolicy?.text || '') }}>
      <option value="">原有表达</option>{historicalPolicy && <option value={initialPolicyKey}>{historicalPolicy.title} · {historicalPolicy.version} · 已保存版本</option>}{policies.map(item => <option key={item.id} value={policyKey(item)}>{item.title} · {item.version}</option>)}
    </select></label> : <label>指导名称<input ref={firstInput} value={title} maxLength={120} readOnly={!editable || uncertain} disabled={busy} data-drawer-dirty={dirty || undefined} onChange={event => setTitle(event.target.value)} /></label>}
    {(!isDefault || policyId) && <label>完整规则<textarea value={text} rows={10} maxLength={20000} readOnly={!editable || uncertain || (isDefault && !policy)} disabled={busy} data-drawer-dirty={dirty || undefined} onChange={event => setText(event.target.value)} /></label>}
    {!isDefault && <p className="v2-detail-note">{guide ? `${guide.origin === 'custom' ? '自定义' : guide.origin === 'imported' ? '导入文本' : '随应用发行'} · 版本 ${guide.version}` : origin === 'imported' ? '来源：明确导入的文本' : '来源：自定义文本'}{guide && editable ? ' · 保存修改会新增版本，旧步骤不变。' : ''}</p>}
    {selection === 'new' && <><input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" onChange={event => void importFile(event.target.files?.[0])} /><button type="button" className="v2-secondary-button" disabled={busy || uncertain} onClick={() => onRequestLeave(() => fileInput.current?.click())}>从文本导入…</button></>}
    {dirty && diff.hasChanges && <details className="v2-guidance-read"><summary>核对规则变更</summary>{diff.tooLarge ? <p>{isDefault ? initial.defaultOutputPolicy?.text : guide?.text}</p> : <div className="v2-diff">{diff.lines.map((line, index) => <div key={index} className={line.kind}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text}</div>)}</div>}</details>}
    {(error || validation) && <p role="alert">{error || validation}</p>}
    {uncertain && <><p>草稿仍保留在这里。请先复制需要的内容，再重新读取已保存设置；不会自动重试旧操作。</p><button type="button" onClick={() => onRequestLeave(onReload)}>重新读取并核对</button></>}
    {(isDefault || editable) && <footer><button type="button" className="v2-primary-button" disabled={!dirty || busy || uncertain || Boolean(validation)} onClick={() => void save()}>{busy ? '正在保存…' : isDefault ? '保存项目默认' : guide ? '保存为新版本' : '保存指导'}</button>
      {guide?.origin && <button type="button" className="v2-secondary-button" disabled={dirty || busy || uncertain} onClick={() => void submit({ baseRevision: initial.revision, disabledGuidance: { id: guide.id, disabled: !initial.disabledGuidanceIds.includes(guide.id) } })}>{initial.disabledGuidanceIds.includes(guide.id) ? '恢复可选' : '从目录停用'}</button>}
    </footer>}
  </section>
}
