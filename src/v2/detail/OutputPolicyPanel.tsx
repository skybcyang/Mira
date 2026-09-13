import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { outputFormats, resolveOutputPolicy, type OutputFormat, type OutputPolicy, type OutputPolicyInput } from '../../domain/outputPolicy.js'
import { extractionRequirement } from '../../domain/extraction.js'
import { v2Api } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { useDrawerAction } from '../drawerIntent'
import { useInspectorDraft } from '../inspectorDrafts'
import { sourceEditBlock } from '../transformationSources'

const key = (item: OutputPolicy) => `${item.id}@${item.version}`

export function OutputPolicyPanel({ transformationId, onDirtyChange }: {
  transformationId: string; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const update = useV2Canvas(state => state.updateTransformation)
  const open = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const step = board?.transformations.find(item => item.id === transformationId)
  const [initial] = useState(() => step)
  const original = initial?.outputPolicy
  const [catalog, setCatalog] = useState<OutputPolicy[]>([])
  const [choice, setChoice] = useState(original ? key(original) : '')
  const [text, setText] = useState(original?.text || '')
  const [limit, setLimit] = useState(original?.maxCharacters?.toString() || '')
  const [format, setFormat] = useState<OutputFormat>(original?.format || 'auto')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const styleSelect = useRef<HTMLSelectElement>(null)
  const alive = useRef(true)
  useEffect(() => { if (!loading && !styleSelect.current?.disabled) styleSelect.current?.focus() }, [loading])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    void v2Api.getOutputPolicies().then(result => { if (current) setCatalog(result.policies) })
      .catch(() => { if (current) setError('未能读取输出规则目录。已保存规则保持不变，请返回后重试。') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])
  const selected = catalog.find(item => key(item) === choice) || (original && key(original) === choice ? original : undefined)
  const editable = catalog.some(item => key(item) === choice)
  const changed = choice !== (original ? key(original) : '') || (Boolean(choice) && (
    text !== original?.text || limit !== (original?.maxCharacters?.toString() || '') || format !== (original?.format || 'auto')
  ))
  const dirty = changed && !finished
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const blocked = !board || !step ? '这一步已不可用。' : sourceEditBlock(board, step, runs)?.replace('来源', '设置')
  const conflict = step?.updatedAt !== initial?.updatedAt
  const extraction = extractionRequirement(initial?.instruction || '') !== null
  const input: OutputPolicyInput | null = selected ? { id: selected.id, version: selected.version, text, format,
    ...(limit === '' ? {} : { maxCharacters: Number(limit) }) } : null
  let validation = ''
  if (dirty && input) {
    try { resolveOutputPolicy(input) } catch (cause) { validation = cause instanceof Error ? cause.message : '请核对输出要求。' }
  }
  const disabled = saving || Boolean(blocked) || conflict
  const back = () => open({ tab: 'relation', transformationId, focusOutput: true })
  const save = async () => {
    if (lock.current || disabled || validation || !dirty || !initial || loading) return false
    lock.current = true; setSaving(true); setError('')
    const startedDrawer = useV2Canvas.getState().drawer
    try {
      const saved = await update(transformationId, { outputPolicy: input }, initial.updatedAt)
      if (!alive.current) return saved
      if (saved) {
        setFinished(true)
        if (useV2Canvas.getState().drawer === startedDrawer) back()
      } else setError('未确认输出要求已保存，草稿已保留。请核对画板提示后再操作。')
      return saved
    } catch {
      if (alive.current) setError('保存失败，草稿已保留。请重新核对后再操作。')
      return false
    } finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  useInspectorDraft(`output:${transformationId}`, dirty, save, disabled || Boolean(validation) || loading)
  return <section className="v2-extraction-panel v2-guidance-panel" aria-label="输出要求" aria-busy={loading || saving}>
    <h3>输出要求</h3>
    <p>风格控制表达，可与本步指导同时使用。保存后，下次明确运行才生效。</p>
    <label>表达风格<select ref={styleSelect} disabled={disabled || loading} value={choice} onChange={event => {
      const value = event.target.value
      setChoice(value)
      setText(catalog.find(item => key(item) === value)?.text || (original && key(original) === value ? original.text : ''))
    }}>
      <option value="">原有表达</option>
      {original && !catalog.some(item => key(item) === key(original)) && <option value={key(original)}>已保存：{original.title} · {original.version}</option>}
      {catalog.map(item => <option key={key(item)} value={key(item)}>{item.title} · {item.version}</option>)}
    </select></label>
    {selected ? <>
      <details open={Boolean(original?.customized)}>
        <summary>查看与调整规则 · {selected.version}</summary>
        <label>完整表达规则<textarea rows={7} value={text} maxLength={20000} readOnly={!editable} disabled={disabled} onChange={event => setText(event.target.value)} /></label>
        {editable && text !== selected.text && <button type="button" className="v2-quiet-button" disabled={disabled} onClick={() => setText(selected.text)}>恢复所选版本原文</button>}
        {!editable && !loading && <p>此版本仅作为已保存快照使用；更换规则时请核对新旧正文。</p>}
      </details>
      <label>字符上限（可选）<input type="number" min={1} max={100000} step={1} value={limit} disabled={disabled || !editable} onChange={event => setLimit(event.target.value)} /></label>
      <label>正文结构<select value={format} disabled={disabled || !editable || extraction} onChange={event => setFormat(event.target.value as OutputFormat)}>
        {Object.entries(outputFormats).map(([value, title]) => <option key={value} value={value}>{value === 'auto' && extraction ? '由提取格式确定' : title}</option>)}
      </select></label>
      <p className="v2-detail-note">字符包含标题、标点和空白。约束未通过仍保留完整结果，不自动截断或重跑。</p>
    </> : <p>使用原有基础输出规则，不附加风格或约束。</p>}
    {original && changed && <details className="v2-guidance-read"><summary>核对原设置</summary><p>{original.title} · {original.version} · {outputFormats[original.format]} · {original.maxCharacters ?? '不限'} 字符</p><p>{original.text}</p></details>}
    {(error || blocked || conflict || validation) && <p role="alert">{error || blocked || (conflict ? '步骤已在别处修改，请保留草稿并重新打开核对。' : validation)}</p>}
    <footer className="v2-scope-footer">
      <button type="button" className="v2-secondary-button" disabled={saving} onClick={() => action(back)}>返回生成步骤</button>
      <button type="button" className="v2-primary-button" disabled={!dirty || disabled || Boolean(validation) || loading} onClick={() => void save()}>{saving ? '正在保存…' : '保存输出要求'}</button>
    </footer>
  </section>
}
