import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useV2Canvas } from '../../v2Store'
import { cardSummary, headVersion } from '../../v2View'
import { parseExtractionList, validateExtractionItems, type ExtractionItem } from '../../domain/extraction.js'
import { useInspectorDraft } from '../inspectorDrafts'
import { useDrawerAction } from '../drawerIntent'
import { useSourcePreview } from '../sourcePreviewContext'

export function ExtractionPanel({ cardId, mode, onDirtyChange }: {
  cardId: string; mode: 'extract' | 'split'; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const createStep = useV2Canvas(state => state.createExtractionStep)
  const split = useV2Canvas(state => state.splitExtraction)
  const openDrawer = useV2Canvas(state => state.openDrawer)
  const reviewBoard = useV2Canvas(state => state.reviewExtractionBoard)
  const allowNewRequest = useV2Canvas(state => state.allowNewExtractionRequest)
  const action = useDrawerAction()
  const preview = useSourcePreview()
  const card = board?.cards.find(item => item.id === cardId)
  const head = card ? headVersion(card) : undefined
  const [base] = useState(() => head?.id || '')
  const [requirement, setRequirement] = useState('')
  const [initial] = useState(() => {
    try { return { items: head?.content.kind === 'markdown' ? parseExtractionList(head.content.markdown) : null, error: '' } }
    catch (error) { return { items: null, error: (error as Error).message } }
  })
  const [items, setItems] = useState<ExtractionItem[]>(initial.items || [])
  const [selected, setSelected] = useState(() => new Set(items.map(item => item.itemId)))
  const [pending, setPending] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const changed = head?.id !== base
  const dirty = !finished && (mode === 'extract' ? !!requirement : JSON.stringify(items) !== JSON.stringify(initial.items || []) || selected.size !== items.length)
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  // Leaving can discard a preview, but must never materialize cards as an implicit draft save.
  useInspectorDraft(`extraction:${cardId}`, dirty, async () => false, true)
  const blockedRun = Object.values(runs).some(run => run.targetCardId === cardId && (['queued', 'running'].includes(run.status) || run.result?.disposition === 'candidate'))
  const fileUnsupported = head?.content.kind === 'file-reference' && !/\.(md|markdown|txt|csv|tsv|json|jsonl|yaml|yml|xml|html|htm|log|srt|vtt)$/i.test(head.content.path)
  const unavailable = !card || !base || board?.lifecycle?.state === 'archived' || board?.lifecycle?.state === 'trashed'
  const chosen = items.filter(item => selected.has(item.itemId))
  const previous = board?.cards.filter(item => item.extractionRef?.boardId === board.id && item.extractionRef.cardId === cardId) || []
  const batches = new Map<string, typeof previous>()
  for (const item of previous) {
    const batch = item.extractionRef!.batchId
    batches.set(batch, [...(batches.get(batch) || []), item])
  }
  const submit = async () => {
    if (lock.current || uncertain || changed || unavailable || blockedRun || fileUnsupported) return
    if (mode === 'split') {
      try { validateExtractionItems(chosen, initial.items || []) } catch (failure) { setError((failure as Error).message); return }
    }
    lock.current = true; setPending(true); setError('')
    const startedDrawer = useV2Canvas.getState().drawer
    try {
      if (mode === 'extract') {
        const status = await createStep(cardId, base, requirement)
        if (alive.current) {
          if (status === 'created') setFinished(true)
          else { setError('未确认步骤创建成功，要求已保留。请核对画板和错误提示。'); setUncertain(status === 'uncertain') }
        }
      } else {
        const status = await split(cardId, base, chosen)
        if (!alive.current) return
        if (status === 'created') { setFinished(true); if (useV2Canvas.getState().drawer === startedDrawer) openDrawer({ tab: 'content', cardId, mode: 'read' }) }
        else if (status === 'uncertain') { setUncertain(true); setError('结果待核对，请先刷新并检查已有批次。') }
        else setError('没有完成创建，选择和编辑已保留。请检查错误提示。')
      }
    } finally { lock.current = false; if (alive.current) setPending(false) }
  }
  return <div className="v2-extraction-panel" aria-busy={pending}>
    <div className="v2-extraction-source"><span>来源</span><strong>{card ? cardSummary(card).title : '来源不可用'}</strong>
      {card && board && preview && <button type="button" className="v2-quiet-button" onClick={() => {
        const version = card.versions.find(item => item.id === base)
        preview({ boardId: board.id, cardId, ...(version?.content.kind === 'markdown' ? { snapshot: { cardId, versionId: base, contentKind: 'markdown', resolvedContent: version.content.markdown, digest: version.digest } } : {}) })
      }}>{card.contentKind === 'file-reference' ? '查看当前文件' : '查看原文'}</button>}
    </div>
    {changed && <p role="alert">清单或来源已有新版本，当前草稿仍基于打开时的版本。请保留所需修改，返回内容后重新打开。</p>}
    {blockedRun && <p role="alert">请先结束当前生成，或处理待比较结果，再继续。</p>}
    {fileUnsupported && <p role="alert">首版支持文本文件。请先准备可核对的正文或字幕；PDF、音视频解析尚未接入。</p>}
    {mode === 'extract' ? <>
      <label htmlFor="extraction-requirement">你想从中提取什么？</label>
      <textarea id="extraction-requirement" autoFocus value={requirement} maxLength={10000} rows={6} disabled={pending} onChange={event => setRequirement(event.target.value)} />
      <p className="v2-detail-note">按内容决定条目数量。先添加步骤，不会自动生成；运行后可预览、编辑并选择需要的卡片。</p>
    </> : <>
      {initial.error && <p role="alert">{initial.error}</p>}
      {!initial.items && !initial.error && <p>当前正文不是可拆分清单。请先明确提取并生成清单。</p>}
      {initial.items?.length === 0 && <p>没有提取到符合要求的条目。可以返回生成步骤修改要求后重新运行。</p>}
      {items.length > 0 && <div className="v2-extraction-selection"><span>共 {items.length} 项 · 已选 {chosen.length} 项</span>
        <button type="button" className="v2-quiet-button" disabled={pending} onClick={() => setSelected(new Set(selected.size === items.length ? [] : items.map(item => item.itemId)))}>{selected.size === items.length ? '取消全选' : '全选'}</button></div>}
      <ol className="v2-extraction-items">{items.map((item, index) => <li key={item.itemId}>
        <div className="v2-extraction-item-heading"><label><input type="checkbox" disabled={pending} checked={selected.has(item.itemId)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.itemId); else next.delete(item.itemId); return next })} /><span>{item.title}</span></label>
          {[[-1, '上移'], [1, '下移']].map(([delta, label]) => <button type="button" className="v2-icon-button" key={label} aria-label={`${label}第 ${index + 1} 项`} disabled={pending || index + Number(delta) < 0 || index + Number(delta) >= items.length} onClick={() => setItems(current => { const next = [...current]; const target = index + Number(delta); [next[index], next[target]] = [next[target], next[index]]; return next })}>{delta === -1 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>)}
        </div>
        <p className="v2-extraction-summary">{item.markdown}</p>
        <details><summary>编辑条目与查看依据</summary>
          <label>标题<input value={item.title} maxLength={120} disabled={pending} onChange={event => setItems(current => current.map(value => value.itemId === item.itemId ? { ...value, title: event.target.value } : value))} /></label>
          <label>正文<textarea value={item.markdown} maxLength={20000} rows={7} disabled={pending} onChange={event => setItems(current => current.map(value => value.itemId === item.itemId ? { ...value, markdown: event.target.value } : value))} /></label>
        </details>
      </li>)}</ol>
      <p className="v2-detail-note">每个选中条目创建一张新卡片。这里的编辑只影响本次新卡，原清单保留。</p>
    </>}
    {previous.length > 0 && <details className="v2-extraction-history" open={uncertain}><summary>此前已创建 {previous.length} 张卡片 · {batches.size} 个批次</summary>
      {[...batches.entries()].map(([batch, cards], index) => <section key={batch}><strong>批次 {index + 1} · 清单版本 {cards[0].extractionRef!.versionId}</strong>
        <button type="button" className="v2-secondary-button" onClick={() => action(() => openDrawer({ tab: 'content', cardId, mode: 'compare', batchId: batch }))}>与本批旧卡对照</button>
        {cards.map(item => <button type="button" className="v2-quiet-button" key={item.id} onClick={() => action(() => openDrawer({ tab: 'content', cardId: item.id }))}>{cardSummary(item).title}</button>)}</section>)}
      <p>再次确认将创建新卡片，已有卡片不会更新。</p>
    </details>}
    {error && <p role="alert">{error}</p>}
    {uncertain && <div className="v2-extraction-recovery">
      <button type="button" className="v2-secondary-button" onClick={async () => { const ok = await reviewBoard(); if (alive.current) { setReviewed(ok); if (!ok) setError('刷新失败，请稍后重新核对；尚未解除重复提交保护。') } }}>刷新并核对画板</button>
      {reviewed && <button type="button" className="v2-secondary-button" onClick={() => { allowNewRequest(cardId, base); setUncertain(false); setReviewed(false); setError('请确认确实需要再次创建。') }}>已核对，允许新的创建</button>}
    </div>}
    <footer className="v2-extraction-footer"><button type="button" className="v2-secondary-button" disabled={pending} onClick={() => action(() => openDrawer({ tab: 'content', cardId, mode: 'read' }))}>返回内容</button>
      <button type="button" className="v2-generate-button" disabled={pending || uncertain || changed || unavailable || blockedRun || fileUnsupported || (mode === 'extract' ? !requirement.trim() : chosen.length === 0 || !initial.items)} onClick={() => void submit()}>{pending ? '提交中…' : mode === 'extract' ? '添加提取步骤' : `创建 ${chosen.length} 张卡片`}</button>
    </footer>
  </div>
}
