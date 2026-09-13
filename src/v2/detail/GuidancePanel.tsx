import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GuidanceSnapshot } from '../../domain/guidance.js'
import { v2Api } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { useDrawerAction } from '../drawerIntent'
import { useInspectorDraft } from '../inspectorDrafts'
import { sourceEditBlock } from '../transformationSources'
import { compareVersionText } from '../cardVersions'

const key = (item: GuidanceSnapshot) => `${item.id}@${item.version}`

export function GuidancePanel({ transformationId, onDirtyChange }: {
  transformationId: string; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const update = useV2Canvas(state => state.updateTransformation)
  const open = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const step = board?.transformations.find(item => item.id === transformationId)
  const [initial] = useState(() => step)
  const [catalog, setCatalog] = useState<GuidanceSnapshot[]>([])
  const [choice, setChoice] = useState(initial?.guidance ? key(initial.guidance) : '')
  const [text, setText] = useState(initial?.guidance?.text || '')
  const [acceptance, setAcceptance] = useState(initial?.acceptance || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    void v2Api.getGuidance().then(result => { if (current) setCatalog(result.guidance) })
      .catch(() => { if (current) setError('未能读取内置指导。已保存的指导仍可查看和用于运行。') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])
  const selected = catalog.find(item => key(item) === choice)
    || (initial?.guidance && key(initial.guidance) === choice ? initial.guidance : undefined)
  const editable = catalog.some(item => key(item) === choice)
  const changedGuide = choice !== (initial?.guidance ? key(initial.guidance) : '') || text !== (initial?.guidance?.text || '')
  const dirty = !finished && (changedGuide || acceptance !== initial?.acceptance)
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const blocked = !board || !step ? '这一步已不可用。' : sourceEditBlock(board, step, runs)
  const conflict = step?.updatedAt !== initial?.updatedAt
  const missingCriteria = selected?.id === 'mira-evidence-review' && !acceptance.trim()
  const invalid = Boolean(choice && (!text.trim() || text.length > 20000 || (changedGuide && !editable)))
  const save = async () => {
    if (lock.current || blocked || conflict || invalid || missingCriteria || !initial) return false
    lock.current = true; setSaving(true); setError('')
    const startedDrawer = useV2Canvas.getState().drawer
    try {
      const saved = await update(transformationId, {
        acceptance,
        ...(changedGuide ? { guidance: selected ? { id: selected.id, version: selected.version, text } : null } : {}),
      }, initial.updatedAt)
      if (!alive.current) return saved
      if (saved) { setFinished(true); if (useV2Canvas.getState().drawer === startedDrawer) open({ tab: 'relation', transformationId }) }
      else setError('未确认指导已保存，修改已保留。请核对画板提示后再操作。')
      return saved
    } finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  useInspectorDraft(`guidance:${transformationId}`, dirty, save, saving || Boolean(blocked) || conflict || invalid || missingCriteria)
  const diff = useMemo(() => compareVersionText(initial?.guidance?.text || '', text), [initial, text])
  return <section className="v2-extraction-panel v2-guidance-panel" aria-label="本步指导" aria-busy={loading || saving}>
    <h3>本步指导</h3><p>指导只辅助完成你填写的目标。默认不使用，也可以修改指导正文。</p>
    <label>选择指导<select disabled={saving || loading || Boolean(blocked)} value={choice} onChange={event => {
      const value = event.target.value
      setChoice(value); setText(catalog.find(item => key(item) === value)?.text || (initial?.guidance && key(initial.guidance) === value ? initial.guidance.text : ''))
    }}><option value="">不使用指导</option>
      {initial?.guidance && !catalog.some(item => key(item) === key(initial.guidance!)) && <option value={key(initial.guidance)}>已保存：{initial.guidance.title} · {initial.guidance.version}</option>}
      {catalog.map(item => <option key={key(item)} value={key(item)}>{item.title} · {item.version}</option>)}
    </select></label>
    {selected && <>
      <label>完整指导正文<textarea rows={10} value={text} readOnly={!editable} disabled={saving} maxLength={20000} onChange={event => setText(event.target.value)} /></label>
      {!editable && !loading && <p>这是已保存的旧版本或导入快照。可以继续使用；替换时请先查看新旧差异。</p>}
      {editable && text !== catalog.find(item => key(item) === choice)?.text && <button type="button" className="v2-quiet-button" disabled={saving} onClick={() => setText(catalog.find(item => key(item) === choice)!.text)}>使用内置原文</button>}
    </>}
    <label>完成标准<textarea value={acceptance} rows={3} disabled={saving} onChange={event => setAcceptance(event.target.value)} /></label>
    {missingCriteria && <p role="status">请填写你要核对的标准。</p>}
    {initial?.guidance && diff.hasChanges && <section aria-label="指导变更"><h4>指导变更</h4>{diff.tooLarge
      ? <><p>内容较长，请对照原文阅读。</p><pre>{initial.guidance.text}</pre></>
      : <div className="v2-diff">{diff.lines.map((line, index) => <div key={index} className={line.kind}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text}</div>)}</div>}</section>}
    {(error || blocked || conflict) && <p role="alert">{error || blocked || '步骤已在别处修改，请保留这份草稿，重新打开后核对。'}</p>}
    <footer className="v2-scope-footer"><button type="button" className="v2-secondary-button" disabled={saving} onClick={() => action(() => open({ tab: 'relation', transformationId }))}>返回生成步骤</button>
      <button type="button" className="v2-primary-button" disabled={!dirty || saving || Boolean(blocked) || conflict || invalid || missingCriteria} onClick={() => void save()}>{saving ? '正在保存…' : '保存指导'}</button></footer>
  </section>
}
