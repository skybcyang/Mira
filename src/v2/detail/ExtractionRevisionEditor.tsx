import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContentCard } from '../../domain'
import type { ExtractionItem } from '../../domain/extraction.js'
import { useV2Canvas } from '../../v2Store'
import { headVersion } from '../../v2View'
import { useInspectorDraft } from '../inspectorDrafts'
import { useDrawerAction } from '../drawerIntent'
import { compareVersionText } from '../cardVersions'

export function ExtractionRevisionEditor({ target, sourceCardId, sourceVersionId, items, original, matchedId, onBack, onDirtyChange }: {
  target: ContentCard; sourceCardId: string; sourceVersionId: string; items: ExtractionItem[]
  original?: ExtractionItem; matchedId?: string; onBack: () => void; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const revise = useV2Canvas(state => state.reviseExtractionCard)
  const review = useV2Canvas(state => state.reviewExtractionBoard)
  const allow = useV2Canvas(state => state.allowNewExtractionRequest)
  const action = useDrawerAction()
  const [base] = useState(() => headVersion(target))
  const [selected, setSelected] = useState<string[]>(matchedId ? [matchedId] : [])
  const before = base?.content.kind === 'markdown' ? base.content.markdown : ''
  const [markdown, setMarkdown] = useState(before)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true), lock = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const dirty = !finished && (markdown !== before || JSON.stringify(selected) !== JSON.stringify(matchedId ? [matchedId] : []))
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const current = board?.cards.find(card => card.id === target.id)
  const changed = current?.headVersionId !== base?.id || board?.cards.find(card => card.id === sourceCardId)?.headVersionId !== sourceVersionId
  const busy = Object.values(runs).some(run => [target.id, sourceCardId].includes(run.targetCardId) && (run.status === 'running' || run.status === 'queued' || run.result?.disposition === 'candidate'))
  const blocked = !base || changed || busy || (board?.lifecycle && board.lifecycle.state !== 'active')
  const save = async () => {
    if (lock.current || blocked || uncertain || finished || !selected.length || !markdown.trim() || markdown.length > 1000000 || !base) return false
    lock.current = true; setSaving(true); setError('')
    try {
      const status = await revise(target.id, base.id, { cardId: sourceCardId, versionId: sourceVersionId, itemIds: selected }, markdown)
      if (!alive.current) return status === 'created'
      if (status === 'created') { setFinished(true); setError('这张卡已核对保存。') }
      else { setUncertain(status === 'uncertain'); setError('未确认更新成功，草稿已保留。请核对当前版本与错误提示。') }
      return status === 'created'
    } finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  useInspectorDraft(`extraction-revision:${target.id}`, dirty, save, saving || Boolean(blocked) || uncertain)
  const diff = useMemo(() => compareVersionText(before, markdown), [before, markdown])
  return <section className="v2-extraction-panel" aria-label="核对并更新旧卡" aria-busy={saving}>
    <h3>{target.name || '核对旧卡'}</h3>
    <details open><summary>旧卡当前内容</summary><pre className="v2-reconcile-text">{before}</pre></details>
    <details><summary>最初拆分条目</summary>{original ? <><strong>{original.title}</strong><pre className="v2-reconcile-text">{original.markdown}</pre></> : <p>原条目不可核对，历史清单已不可用。</p>}</details>
    <fieldset disabled={saving || finished}><legend>明确对应的新条目</legend>{items.map(item => <label key={item.itemId}><input type="checkbox" checked={selected.includes(item.itemId)} onChange={event => setSelected(current => event.target.checked ? [...current, item.itemId] : current.filter(id => id !== item.itemId))} />{item.title}</label>)}</fieldset>
    <button type="button" className="v2-secondary-button" disabled={!selected.length || saving || finished} onClick={() => setMarkdown(selected.map(id => items.find(item => item.itemId === id)!).map(item => selected.length === 1 ? item.markdown : `## ${item.title}\n\n${item.markdown}`).join('\n\n'))}>将所选条目填入草稿</button>
    <label>拟采用的完整正文<textarea value={markdown} rows={10} maxLength={1000000} disabled={saving || finished} onChange={event => setMarkdown(event.target.value)} /></label>
    <p>保留哪些人工补充，由你在草稿中决定。确认只更新这张卡。</p>
    {diff.hasChanges && <section aria-label="旧卡正文差异"><h4>正文差异</h4>{diff.tooLarge ? <p>内容较长，请对照完整正文阅读。</p> : <div className="v2-diff">{diff.lines.map((line, index) => <div key={index} className={line.kind}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text}</div>)}</div>}</section>}
    {!finished && blocked && <p role="alert">来源或旧卡已变化、正在生成或不可写。请保留草稿，重新打开后核对。</p>}
    {error && <p role="status">{error}</p>}
    {uncertain && <div><button type="button" className="v2-secondary-button" onClick={async () => { const ok = await review(); if (alive.current) setReviewed(ok) }}>刷新并核对当前版本</button>
      {reviewed && !changed && <button type="button" className="v2-secondary-button" onClick={() => { allow(target.id, base!.id); setUncertain(false); setReviewed(false) }}>已核对，允许重新提交</button>}</div>}
    <footer className="v2-scope-footer"><button type="button" className="v2-secondary-button" disabled={saving} onClick={() => action(onBack)}>返回对照列表</button>
      <button type="button" className="v2-primary-button" disabled={saving || finished || uncertain || Boolean(blocked) || !selected.length || !markdown.trim()} onClick={() => void save()}>{saving ? '正在更新…' : '确认更新这张卡'}</button></footer>
  </section>
}
