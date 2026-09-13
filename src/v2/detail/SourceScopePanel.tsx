import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SourceScope, TextSpan } from '../../domain/sourceScopes.js'
import { assembleScopedText, nativeSelectionSpan, textChapters } from '../../domain/sourceScopes.js'
import { v2Api, type CardContentResponse } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { cardSummary } from '../../v2View'
import { useInspectorDraft } from '../inspectorDrafts'
import { userFacingStoreError as safeMessage } from '../storePolicy'
import { useDrawerAction } from '../drawerIntent'
import { sourceEditBlock } from '../transformationSources'

export function SourceScopePanel({ transformationId, cardId, onDirtyChange }: {
  transformationId: string; cardId: string; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const update = useV2Canvas(state => state.updateTransformation)
  const open = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const step = board?.transformations.find(item => item.id === transformationId)
  const card = board?.cards.find(item => item.id === cardId)
  const [initial] = useState(() => step?.sourceScopes?.find(scope => scope.cardId === cardId))
  const [base, setBase] = useState(() => step?.updatedAt || '')
  const [mode, setMode] = useState<'full' | 'ranges'>(initial ? 'ranges' : 'full')
  const [spans, setSpans] = useState<TextSpan[]>(initial?.mode === 'ranges' ? initial.spans : [])
  const [content, setContent] = useState<CardContentResponse>()
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const [reviewNeeded, setReviewNeeded] = useState(false)
  const [error, setError] = useState('')
  const text = useRef<HTMLTextAreaElement>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    setLoading(true)
    if (board) void v2Api.getCardContent(board.id, cardId).then(result => {
      if (!current) return
      if (result.content.length > 1000000) { setError('这份原文超过 100 万字符，请先整理为较小的文本材料。'); return }
      setContent(result); setError('')
    }).catch(failure => { if (current) setError(safeMessage(failure)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [board?.id, cardId, reload])
  const dirty = !finished && (mode !== (initial ? 'ranges' : 'full')
    || JSON.stringify(spans) !== JSON.stringify(initial?.mode === 'ranges' ? initial.spans : []))
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const blocked = !board || !step || !card || !step.sourceCardIds.includes(cardId) ? '来源已不可用。'
    : sourceEditBlock(board, step, runs)
  const changed = content?.versionId !== card?.headVersionId
    || (reload === 0 && initial?.mode === 'ranges' && (initial.versionId !== content?.versionId || initial.contentDigest !== content?.contentDigest))
  let preview = '', invalid = ''
  if (content && mode === 'ranges' && spans.length) {
    try { preview = assembleScopedText(content.content, spans).resolvedContent }
    catch (failure) { invalid = (failure as Error).message }
  }
  const save = async () => {
    if (!step || lock.current || blocked || reviewNeeded || (mode === 'ranges' && (loading || changed || invalid || !spans.length || !content?.contentDigest))) return false
    lock.current = true; setSaving(true); setError('')
    const startedDrawer = useV2Canvas.getState().drawer
    const scopes: SourceScope[] = (step.sourceScopes || []).filter(scope => scope.cardId !== cardId)
    if (mode === 'ranges' && content?.contentDigest) scopes.push({ cardId, mode: 'ranges', versionId: content.versionId, contentDigest: content.contentDigest, spans })
    try {
      const saved = await update(transformationId, { sourceScopes: scopes }, base)
      if (!alive.current) return saved
      if (saved) {
        setFinished(true)
        if (useV2Canvas.getState().drawer === startedDrawer) open({ tab: 'relation', transformationId })
      } else { setReviewNeeded(true); setError('未确认范围已保存，选择已保留。请返回核对已保存范围，或重新读取后再选择。') }
      return saved
    } finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  useInspectorDraft(`scope:${transformationId}:${cardId}`, dirty, save, saving || Boolean(blocked))
  const add = (span: TextSpan) => {
    if (!content || changed) return
    try { assembleScopedText(content.content, [...spans, span]); setSpans([...spans, span]); setError('') }
    catch (failure) { setError((failure as Error).message) }
  }
  const chapters = useMemo(() => content ? textChapters(content.content) : [], [content])
  return <section className="v2-scope-panel" aria-label="输入范围" aria-busy={loading || saving}>
    <header><h3>输入范围</h3><p>{card ? cardSummary(card).title : '来源不可用'}</p></header>
    <fieldset disabled={saving || Boolean(blocked)}><legend>使用哪些内容</legend>
      <label><input type="radio" name="source-scope-mode" checked={mode === 'full'} onChange={() => setMode('full')} />全文</label>
      <label><input type="radio" name="source-scope-mode" checked={mode === 'ranges'} onChange={() => setMode('ranges')} />选择片段</label>
    </fieldset>
    {mode === 'ranges' && <>
      <p>在原文中选中文字，再添加片段。片段会按下方顺序送入模型。</p>
      {loading ? <p role="status">正在读取原文…</p> : content && <>
        {changed && <p role="alert">原文已变化。重新读取后，请重新选择片段。</p>}
        {!content.contentDigest && <p role="alert">当前服务不支持范围校验，请更新服务后重试。</p>}
        <label>原文<textarea ref={text} readOnly value={content.content} rows={12} spellCheck={false} /></label>
        <button className="v2-secondary-button" type="button" disabled={saving || changed || Boolean(blocked)} onClick={() => {
          if (!text.current) return
          try { add(nativeSelectionSpan(content.content, text.current.selectionStart, text.current.selectionEnd)) }
          catch { setError('请先在原文中选择非空白文字。') }
        }}>添加选中文字</button>
        {chapters.length > 0 && <details><summary>按原文章节选择</summary><ul className="v2-scope-chapters">{chapters.map(chapter => <li key={chapter.start}><button type="button" className="v2-quiet-button" disabled={saving || changed || Boolean(blocked)} onClick={() => add({ start: chapter.start, end: chapter.end })}>{chapter.title}</button></li>)}</ul></details>}
      </>}
      <h4>已选片段（{spans.length}）</h4>
      {!spans.length && <p>尚未选择片段。</p>}
      <ol className="v2-scope-spans">{spans.map((span, index) => <li key={`${span.start}:${span.end}`}>
        <p>{content?.content.slice(span.start, span.end)}</p>
        <div>{([-1, 1] as const).map(direction => <button type="button" className="v2-secondary-button" key={direction} disabled={saving || index + direction < 0 || index + direction >= spans.length} aria-label={`${direction < 0 ? '上移' : '下移'}片段 ${index + 1}`} onClick={() => { const next = [...spans]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setSpans(next) }}>{direction < 0 ? '上移' : '下移'}</button>)}
          <button type="button" className="v2-secondary-button" disabled={saving} aria-label={`移除片段 ${index + 1}`} onClick={() => setSpans(spans.filter((_, i) => i !== index))}>移除</button></div>
      </li>)}</ol>
      <details open><summary>实际输入预览</summary><pre>{invalid || preview || '选择片段后在这里预览。'}</pre></details>
    </>}
    {(mode === 'ranges' || reviewNeeded) && <button type="button" className="v2-quiet-button" disabled={loading || saving} onClick={() => { setSpans([]); setContent(undefined); setBase(step?.updatedAt || ''); setReviewNeeded(false); setReload(value => value + 1) }}>重新读取并清空选择</button>}
    {(error || blocked) && <p role="alert">{error || blocked}</p>}
    <footer className="v2-scope-footer"><button type="button" className="v2-secondary-button" disabled={saving} onClick={() => action(() => open({ tab: 'relation', transformationId }))}>返回生成步骤</button>
      <button type="button" className="v2-primary-button" disabled={saving || reviewNeeded || Boolean(blocked) || (mode === 'ranges' && (loading || changed || Boolean(invalid) || !spans.length || !content?.contentDigest))} onClick={() => void save()}>{saving ? '正在保存…' : '保存范围'}</button>
    </footer>
  </section>
}
