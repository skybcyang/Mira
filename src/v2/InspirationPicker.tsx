import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Lightbulb, PenLine, Plus, Save, Search, Trash2, X } from 'lucide-react'
import MarkdownContent from './MarkdownContent'
import { useWorkbenchPreference } from './workbenchPreferences'
import type { InspirationPool } from '../domain'
import { v2Api } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import {
  appendInspirationCaptureTag,
  filterInspirationPool,
  inspirationCaptureErrorMessage,
  toggleInspirationSelection,
  type InspirationCandidate,
} from './inspiration'

type SourceState =
  | { status: 'loading'; pool: null; error: null }
  | { status: 'ready'; pool: InspirationPool; error: null }
  | { status: 'error'; pool: null; error: string }

const COMMON_CAPTURE_TAGS = ['主意', '约束', '技术', '事件'] as const

function candidateTitle(candidate: InspirationCandidate): string {
  if (candidate.content.kind === 'file-reference') {
    return candidate.content.path.split('/').filter(Boolean).pop() || candidate.content.path
  }
  const firstLine = candidate.content.markdown.split('\n').find((line) => line.trim()) || '未命名灵感'
  return firstLine.replace(/^#{1,6}\s*/, '').trim().slice(0, 90) || '未命名灵感'
}

function candidateExcerpt(candidate: InspirationCandidate): string {
  const value = candidate.content.kind === 'markdown'
    ? candidate.content.markdown
    : candidate.content.path
  return value.replace(/^#{1,6}[^\n]*\n*/, '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function moveCandidate(
  selected: InspirationCandidate[],
  fromIndex: number,
  toIndex: number,
): InspirationCandidate[] {
  if (toIndex < 0 || toIndex >= selected.length || fromIndex === toIndex) return selected
  const next = [...selected]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

export default function InspirationPicker({
  anchor,
  onAdded,
  onClose,
}: {
  anchor: { x: number; y: number }
  onAdded?: (cardIds: string[]) => void
  onClose: (outcome: 'cancel' | 'complete') => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const captureToggleRef = useRef<HTMLButtonElement>(null)
  const captureTextRef = useRef<HTMLTextAreaElement>(null)
  const addInspirationCards = useV2Canvas((state) => state.addInspirationCards)
  const recordInspiration = useV2Canvas((state) => state.recordInspiration)
  const [sourceState, setSourceState] = useState<SourceState>({
    status: 'loading',
    pool: null,
    error: null,
  })
  const [query, setQuery] = useState('')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [selected, setSelected] = useState<InspirationCandidate[]>([])
  const [mobilePane, setMobilePane] = useState<'results' | 'selected'>('results')
  const [retryToken, setRetryToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [mode, setMode] = useState<'browse' | 'capture'>('browse')
  const [captureMarkdown, setCaptureMarkdown] = useState('')
  const [captureTags, setCaptureTags] = useState<string[]>([])
  const [captureTagInput, setCaptureTagInput] = useState('')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const resultListRef = useRef<HTMLDivElement>(null)
  const densityAnchor = useRef<{ index: number; offset: number } | null>(null)
  const savedCaptureTags = useRef<string[]>([])
  const busy = submitting || recording
  const operationLock = useRef(false)
  const readOpener = useRef<HTMLButtonElement | null>(null)
  const readTitleRef = useRef<HTMLHeadingElement>(null)
  const [reading, setReading] = useState<InspirationCandidate | null>(null)
  const [editing, setEditing] = useState<InspirationCandidate | null>(null)
  const [editConflict, setEditConflict] = useState(false)
  const [density, setDensity] = useWorkbenchPreference('inspiration-density', ['summary', 'list'], 'summary')
  const [leaveIntent, setLeaveIntent] = useState<'browse' | 'close' | null>(null)
  const [addBlocked, setAddBlocked] = useState(false)
  const canAdd = useV2Canvas((state) => state.loadState === 'ready' && Boolean(state.board)
    && (!state.board?.lifecycle || state.board.lifecycle.state === 'active'))
  const captureDirty = Boolean((editing?.content.kind === 'markdown'
    ? captureMarkdown !== editing.content.markdown : captureMarkdown.trim()) || captureTagInput.trim()
    || JSON.stringify(captureTags) !== JSON.stringify(editing?.tags ?? savedCaptureTags.current))

  const changeDensity = (next: 'summary' | 'list') => {
    const list = resultListRef.current
    if (list) {
      const top = list.getBoundingClientRect().top
      const items = Array.from(list.querySelectorAll<HTMLElement>('.v2-inspiration-result-item'))
      const index = items.findIndex(item => item.getBoundingClientRect().bottom > top)
      if (index >= 0) densityAnchor.current = { index, offset: items[index].getBoundingClientRect().top - top }
    }
    setDensity(next)
  }
  useLayoutEffect(() => {
    const list = resultListRef.current
    const anchor = densityAnchor.current
    const item = anchor && list?.querySelectorAll<HTMLElement>('.v2-inspiration-result-item')[anchor.index]
    if (list && anchor && item) list.scrollTop += item.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.offset
    densityAnchor.current = null
  }, [density])

  useEffect(() => {
    if (reading) readTitleRef.current?.focus()
  }, [reading])

  const closeReading = () => {
    setReading(null)
    window.requestAnimationFrame(() => readOpener.current?.focus())
  }
  const leave = (intent: 'browse' | 'close') => {
    if (operationLock.current) return
    if (mode === 'capture' && captureDirty) { setLeaveIntent(intent); return }
    if (intent === 'close') onClose('cancel')
    else closeCapture()
  }
  const discardCapture = () => {
    setCaptureMarkdown('')
    setCaptureTags(savedCaptureTags.current)
    setCaptureTagInput('')
    const intent = leaveIntent
    setLeaveIntent(null)
    if (intent === 'close') onClose('cancel')
    else closeCapture()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      if (dialog.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    if (mode !== 'capture' || recording) return
    const frame = window.requestAnimationFrame(() => captureTextRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [mode, recording])

  useEffect(() => {
    let active = true
    setSourceState({ status: 'loading', pool: null, error: null })
    void v2Api.getInspirationPool().then(
      ({ pool }) => {
        if (active) setSourceState({ status: 'ready', pool, error: null })
      },
      (error: unknown) => {
        if (active) setSourceState({
          status: 'error',
          pool: null,
          error: error instanceof Error ? error.message : '灵感池读取失败',
        })
      },
    )
    return () => { active = false }
  }, [retryToken])

  const allCandidates = useMemo(() => sourceState.status === 'ready'
    ? filterInspirationPool(sourceState.pool, { query: '', tags: [] })
    : [], [sourceState])
  const availableTags = useMemo(() => [...new Set(allCandidates.flatMap((item) => item.tags))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [allCandidates])
  const results = useMemo(() => sourceState.status === 'ready'
    ? filterInspirationPool(sourceState.pool, { query, tags: tagFilters })
    : [], [query, sourceState, tagFilters])

  const toggleFilter = (tag: string) => {
    setTagFilters((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag])
  }
  const removeSelected = (candidate: InspirationCandidate) => {
    setSelected((current) => current.filter((item) => item.key !== candidate.key))
  }
  const hasCaptureTag = (tag: string) => captureTags.some(
    (item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase(),
  )
  const addCaptureTag = (rawTag: string) => {
    try {
      const tags = appendInspirationCaptureTag(captureTags, rawTag)
      setCaptureTags(tags)
      setCaptureTagInput('')
      setCaptureError(null)
      setCaptureNotice(null)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '标签没有添加。')
    }
  }
  const removeCaptureTag = (tag: string) => {
    setCaptureTags((current) => current.filter(
      (item) => item.toLocaleLowerCase() !== tag.toLocaleLowerCase(),
    ))
    setCaptureError(null)
    setCaptureNotice(null)
  }
  const openCapture = () => {
    setEditing(null)
    setEditConflict(false)
    setMode('capture')
    setCaptureError(null)
    setCaptureNotice(null)
  }
  const closeCapture = () => {
    setMode('browse')
    setCaptureError(null)
    setEditConflict(false)
    if (editing) {
      setReading(editing)
      setEditing(null)
      setCaptureMarkdown('')
      setCaptureTags(savedCaptureTags.current)
      setCaptureTagInput('')
      return
    }
    window.requestAnimationFrame(() => captureToggleRef.current?.focus())
  }
  const editCandidate = (candidate: InspirationCandidate) => {
    if (!candidate.poolId || !candidate.entryId || candidate.content.kind !== 'markdown') return
    setEditing(candidate)
    setReading(null)
    setCaptureMarkdown(candidate.content.markdown)
    setCaptureTags([...candidate.tags])
    setCaptureTagInput('')
    setCaptureError(null)
    setCaptureNotice(null)
    setEditConflict(false)
    setMode('capture')
  }
  const reloadEdit = async () => {
    if (!editing || operationLock.current) return
    operationLock.current = true
    setRecording(true)
    try {
      const { pool } = await v2Api.getInspirationPool()
      const latest = filterInspirationPool(pool, { query: '', tags: [] }).find(item => item.entryId === editing.entryId)
      if (!latest) throw Object.assign(new Error('missing'), { code: 'INSPIRATION_NOT_FOUND' })
      setSourceState({ status: 'ready', pool, error: null })
      editCandidate(latest)
      captureTextRef.current?.focus()
    } catch (error) { setCaptureError(inspirationCaptureErrorMessage(error)) }
    finally { operationLock.current = false; setRecording(false) }
  }
  const saveCapture = async () => {
    if (operationLock.current || editConflict || sourceState.status !== 'ready' || !captureMarkdown.trim()) return
    let submittedTags: string[]
    try {
      submittedTags = appendInspirationCaptureTag(captureTags, captureTagInput)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '标签没有添加。')
      return
    }
    operationLock.current = true
    setRecording(true)
    setCaptureError(null)
    setCaptureNotice(null)
    try {
      const input = {
        markdown: captureMarkdown,
        tags: submittedTags,
      }
      const entry = editing?.entryId
        ? (await v2Api.updateInspirationEntry(editing.entryId, { ...input, baseVersionId: editing.versionId, baseUpdatedAt: editing.updatedAt })).entry
        : await recordInspiration(input)
      setSourceState((current) => {
        if (current.status !== 'ready') return current
        return {
          status: 'ready',
          pool: { ...current.pool, entries: current.pool.entries.some(item => item.id === entry.id)
            ? current.pool.entries.map(item => item.id === entry.id ? entry : item)
            : [...current.pool.entries, entry] },
          error: null,
        }
      })
      setCaptureMarkdown('')
      if (editing) {
        setReading(filterInspirationPool({ ...sourceState.pool, entries: [entry] }, { query: '', tags: [] })[0])
        setEditing(null)
        setCaptureTags(savedCaptureTags.current)
        setCaptureTagInput('')
        setLeaveIntent(null)
        setMode('browse')
        setCaptureNotice('修改已保存；已添加到画板的卡片保持原样。')
        return
      }
      savedCaptureTags.current = submittedTags
      setCaptureTags(submittedTags)
      setLeaveIntent(null)
      setCaptureTagInput('')
      setCaptureNotice('已记录到灵感池')
      window.requestAnimationFrame(() => captureTextRef.current?.focus())
    } catch (error) {
      setCaptureError(inspirationCaptureErrorMessage(error))
      if ((error as { code?: string })?.code === 'INSPIRATION_CONFLICT') setEditConflict(true)
    } finally {
      operationLock.current = false
      setRecording(false)
    }
  }

  return <dialog
    ref={dialogRef}
    className={`v2-inspiration-picker ${mode === 'capture' ? 'is-capturing' : ''}`}
    role="dialog"
    aria-modal="true"
    aria-labelledby="v2-inspiration-picker-title"
    onCancel={(event) => {
      event.preventDefault()
      if (busy) return
      if (leaveIntent) { setLeaveIntent(null); return }
      if (reading) closeReading()
      else leave(mode === 'capture' ? 'browse' : 'close')
    }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) leave('close') }}
  >
    <header className="v2-inspiration-picker-head">
      <div><span>记录与检索</span><h2 id="v2-inspiration-picker-title"><Lightbulb size={18} />灵感池</h2></div>
      <span className="v2-inspiration-pool-status">工作区灵感 · {allCandidates.length} 条</span>
      <button
        ref={captureToggleRef}
        className="v2-secondary-button v2-inspiration-capture-toggle"
        type="button"
        aria-controls="v2-inspiration-capture"
        aria-expanded={mode === 'capture'}
        title={mode === 'capture' ? editing ? '返回全文' : '返回检索' : '记录灵感'}
        disabled={busy}
        onClick={mode === 'capture' ? () => leave('browse') : () => { setReading(null); openCapture() }}
      >{mode === 'capture' ? <ArrowLeft size={15} /> : <PenLine size={15} />}<span>{mode === 'capture' ? editing ? '返回全文' : '返回检索' : '记录灵感'}</span></button>
      <button className="v2-icon-button v2-inspiration-close" type="button" aria-label="关闭灵感池" title="关闭" disabled={busy} onClick={() => leave('close')}><X size={18} /></button>
    </header>

    {leaveIntent && <div className="v2-inspiration-leave" role="alert">
      <span>这条灵感还有未保存的修改。离开会丢弃正文和标签的修改。</span>
      <button type="button" className="v2-secondary-button" onClick={() => { setLeaveIntent(null); captureTextRef.current?.focus() }}>继续编辑</button>
      <button type="button" className="v2-secondary-button" onClick={discardCapture}>丢弃草稿并离开</button>
    </div>}
    {reading && <div className="v2-inspiration-full-read">
      <header><button type="button" className="v2-secondary-button" onClick={closeReading}><ArrowLeft size={15} />返回结果</button>
      <h3 ref={readTitleRef} tabIndex={-1}>{candidateTitle(reading)}</h3></header>
      <div className="v2-reading-scroll" tabIndex={0} aria-label="灵感全文"><MarkdownContent>{reading.content.kind === 'markdown' ? reading.content.markdown : reading.content.path}</MarkdownContent></div>
      <footer>{captureNotice && <span role="status">{captureNotice}</span>}
        {reading.entryId && reading.content.kind === 'markdown' && <button type="button" className="v2-secondary-button" onClick={() => editCandidate(reading)}><PenLine size={14} />编辑灵感</button>}
        <button type="button" className="v2-primary-button" aria-pressed={selected.some(item => item.key === reading.key)}
        onClick={() => setSelected(current => toggleInspirationSelection(current, reading))}>
        {selected.some(item => item.key === reading.key) ? '从已选中移除' : '加入已选'}</button></footer>
    </div>}
    <div className="v2-inspiration-capture-pane" hidden={mode !== 'capture' || Boolean(reading)}>
      <section className="v2-inspiration-capture" id="v2-inspiration-capture" aria-labelledby="v2-inspiration-capture-title">
        <form id="v2-inspiration-capture-form" onSubmit={(event) => { event.preventDefault(); void saveCapture() }}>
          <header><span>{editing ? '正文修改会保留旧版本' : '直接记录'}</span><h3 id="v2-inspiration-capture-title">{editing ? '编辑灵感' : '记录灵感'}</h3></header>
          <label className="v2-inspiration-capture-copy"><span>内容</span><textarea
            ref={captureTextRef}
            disabled={busy}
            value={captureMarkdown}
            placeholder="记下一个想法、约束、技术或事件"
            onChange={(event) => { setCaptureMarkdown(event.target.value); setCaptureError(null); setCaptureNotice(null) }}
          /></label>
          <fieldset className="v2-inspiration-capture-tags" disabled={busy}>
            <legend>标签</legend>
            <div className="v2-inspiration-capture-common" aria-label="常用标签">
              {COMMON_CAPTURE_TAGS.map((tag) => <button
                type="button"
                key={tag}
                aria-pressed={hasCaptureTag(tag)}
                onClick={() => hasCaptureTag(tag) ? removeCaptureTag(tag) : addCaptureTag(tag)}
              >{tag}</button>)}
            </div>
            {captureTags.length > 0 && <div className="v2-inspiration-capture-selected" aria-label="已选标签">{captureTags.map((tag) => <span key={tag.toLocaleLowerCase()}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} title="移除标签" onClick={() => removeCaptureTag(tag)}><X size={12} /></button></span>)}</div>}
            <div className="v2-inspiration-capture-tag-input"><input
              value={captureTagInput}
              maxLength={32}
              placeholder="自定义标签"
              aria-label="自定义标签"
              onChange={(event) => { setCaptureTagInput(event.target.value); setCaptureError(null) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                addCaptureTag(captureTagInput)
              }}
            /><button className="v2-icon-button" type="button" aria-label="添加自定义标签" title="添加标签" disabled={!captureTagInput.trim()} onClick={() => addCaptureTag(captureTagInput)}><Plus size={15} /></button></div>
          </fieldset>
          <div className="v2-inspiration-capture-status" aria-live="polite">{captureNotice}</div>
          {sourceState.status === 'error' && <div className="v2-inspiration-capture-error" role="alert">{sourceState.error}</div>}
          {captureError && <div className="v2-inspiration-capture-error" role="alert">{captureError}</div>}
          {editConflict && <button type="button" className="v2-secondary-button" disabled={busy} onClick={() => void reloadEdit()}>放弃草稿，载入最新内容</button>}
        </form>
      </section>
      <footer className="v2-inspiration-picker-footer">
        <div />
        <button className="v2-secondary-button" type="button" disabled={recording} onClick={() => leave('browse')}><ArrowLeft size={14} />{editing ? '取消编辑' : '返回检索'}</button>
        <button className="v2-primary-button v2-inspiration-save" type="submit" form="v2-inspiration-capture-form" disabled={sourceState.status !== 'ready' || !captureMarkdown.trim() || recording || editConflict || (Boolean(editing) && !captureDirty)}><Save size={15} />{recording ? '保存中…' : editing ? '保存修改' : '保存灵感'}</button>
      </footer>
    </div>
    <div className="v2-inspiration-browse" hidden={mode !== 'browse' || Boolean(reading)}>
      <div className="v2-inspiration-filter-bar">
        <label className="v2-inspiration-search"><Search size={16} /><input ref={searchRef} type="search" value={query} placeholder="搜索想法、约束、技术或事件" aria-label="搜索灵感" onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="v2-inspiration-filters" aria-label="标签筛选">
          {availableTags.map((tag) => <button className="v2-inspiration-filter" type="button" key={tag} aria-pressed={tagFilters.includes(tag)} onClick={() => toggleFilter(tag)}>{tag}</button>)}
        </div>
      </div>

      <div className="v2-inspiration-mobile-tabs" role="tablist" aria-label="灵感选择视图">
        <button type="button" role="tab" id="v2-inspiration-results-tab" aria-controls="v2-inspiration-results" aria-selected={mobilePane === 'results'} onClick={() => setMobilePane('results')}>结果 <span>{results.length}</span></button>
        <button type="button" role="tab" id="v2-inspiration-selected-tab" aria-controls="v2-inspiration-selected" aria-selected={mobilePane === 'selected'} onClick={() => setMobilePane('selected')}>已选 <span>{selected.length}</span></button>
      </div>

      <div className="v2-inspiration-picker-body">
        <section className={`v2-inspiration-results ${mobilePane === 'results' ? 'is-mobile-active' : ''}`} role="tabpanel" id="v2-inspiration-results" aria-labelledby="v2-inspiration-results-tab">
           <header><h3>结果 <span aria-live="polite">{results.length} 条</span></h3><div className="v2-inspiration-density" aria-label="结果显示方式">
            <button type="button" aria-pressed={density === 'summary'} onClick={() => changeDensity('summary')}>摘要</button>
            <button type="button" aria-pressed={density === 'list'} onClick={() => changeDensity('list')}>列表</button>
          </div></header>
          <div ref={resultListRef} className={`v2-inspiration-result-list is-${density}`}>
            {sourceState.status === 'loading' && <div className="v2-inspiration-state" role="status">正在读取灵感池…</div>}
            {sourceState.status === 'error' && <div className="v2-inspiration-state is-error" role="alert"><span>{sourceState.error}</span><button className="v2-secondary-button" type="button" onClick={() => setRetryToken((value) => value + 1)}>重新加载</button></div>}
            {sourceState.status === 'ready' && results.length === 0 && <div className="v2-inspiration-state">{allCandidates.length === 0 ? '还没有灵感。' : '没有找到匹配的灵感。'}<button type="button" className="v2-secondary-button" onClick={allCandidates.length === 0 ? openCapture : () => { setQuery(''); setTagFilters([]) }}>{allCandidates.length === 0 ? '记录灵感' : '清除筛选'}</button></div>}
            {results.map((candidate) => {
              const selectedIndex = selected.findIndex((item) => item.key === candidate.key)
              return <article className="v2-inspiration-result-item" key={candidate.key}><button className="v2-inspiration-result" type="button" disabled={busy} aria-pressed={selectedIndex >= 0} onClick={() => { setSelected((current) => toggleInspirationSelection(current, candidate)); setSubmitError(null) }}>
                <span className="v2-inspiration-result-index">{selectedIndex >= 0 ? selectedIndex + 1 : ''}</span>
                <span className="v2-inspiration-result-copy"><strong>{candidateTitle(candidate)}</strong><small>{candidateExcerpt(candidate)}</small><span>{candidate.tags.slice(0, 2).map((tag) => <i key={tag}>{tag}</i>)}{candidate.tags.length > 2 && <i>+{candidate.tags.length - 2}</i>}</span></span>
                <time dateTime={candidate.updatedAt}>{formatUpdatedAt(candidate.updatedAt)}</time>
              </button><button className="v2-inspiration-read-button" type="button" disabled={busy} aria-label={`阅读全文：${candidateTitle(candidate)}`}
                onClick={(event) => { readOpener.current = event.currentTarget; setCaptureNotice(null); setReading(candidate) }}>阅读全文</button></article>
            })}
          </div>
        </section>

        <section className={`v2-inspiration-selection ${mobilePane === 'selected' ? 'is-mobile-active' : ''}`} role="tabpanel" id="v2-inspiration-selected" aria-labelledby="v2-inspiration-selected-tab">
             <header><h3>已选</h3><span>{selected.length} 条</span></header>
          {selected.length === 0
            ? <div className="v2-inspiration-state">尚未选择灵感。</div>
            : <ol className="v2-inspiration-selected-list">{selected.map((candidate, index) => <li key={candidate.key}>
              <span>{index + 1}</span>
              <div><strong>{candidateTitle(candidate)}</strong><small>{allCandidates.some(item => item.entryId === candidate.entryId && item.versionId !== candidate.versionId) ? '已选旧版本 · 灵感池有新版' : '灵感池'}</small></div>
              <div className="v2-inspiration-selected-actions">
                <button className="v2-icon-button" type="button" aria-label={`上移 ${candidateTitle(candidate)}`} title="上移" disabled={busy || index === 0} onClick={() => setSelected((current) => moveCandidate(current, index, index - 1))}><ArrowUp size={14} /></button>
                <button className="v2-icon-button" type="button" aria-label={`下移 ${candidateTitle(candidate)}`} title="下移" disabled={busy || index === selected.length - 1} onClick={() => setSelected((current) => moveCandidate(current, index, index + 1))}><ArrowDown size={14} /></button>
                <button className="v2-icon-button" type="button" aria-label={`移除 ${candidateTitle(candidate)}`} title="移除" disabled={busy} onClick={() => removeSelected(candidate)}><Trash2 size={14} /></button>
              </div>
            </li>)}</ol>}
        </section>
      </div>

      <footer className="v2-inspiration-picker-footer">
        <div>{!canAdd && <span>打开一个可编辑画板后，即可添加灵感。</span>}{submitError && <span role="alert">{submitError}</span>}</div>
        <button className="v2-secondary-button" type="button" disabled={submitting} onClick={() => onClose('cancel')}>取消</button>
        <button className="v2-primary-button v2-inspiration-import" type="button" disabled={!canAdd || sourceState.status !== 'ready' || selected.length === 0 || busy || addBlocked} onClick={() => {
          if (operationLock.current || !canAdd || addBlocked) return
          operationLock.current = true
          setSubmitting(true)
          setSubmitError(null)
          void addInspirationCards(selected, anchor).then((cardIds) => {
            operationLock.current = false
            setSubmitting(false)
            if (cardIds) {
              onAdded?.(cardIds)
              onClose('complete')
            }
            else {
              setAddBlocked(true)
              setSubmitError((useV2Canvas.getState().message || '未能确认添加结果。') + ' 请先关闭灵感池核对画板，避免重复添加。')
            }
          })
        }}><Check size={15} />{submitting ? '正在添加…' : `添加到当前画板（${selected.length}）`}</button>
      </footer>
    </div>
  </dialog>
}
