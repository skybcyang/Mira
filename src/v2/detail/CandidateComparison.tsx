import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import type { ContentCard, TransformationRun } from '../../domain'
import { useV2Canvas } from '../../v2Store'
import { cardSummary, headVersion } from '../../v2View'
import { compareVersionText } from '../cardVersions'
import { readerKeyDown } from '../cardReadingEvents'
import { restoreFocusAfterRender } from '../drawerIntent'
import { runExclusiveAction } from '../drawerSafety'
import MarkdownContent from '../MarkdownContent'

export function CandidateDecisionActions({ onAdopt, onDiscard, disabled = false, adoptDisabled = false, onPendingChange }: {
  onAdopt: () => void | Promise<void>
  onDiscard: () => void | Promise<void>
  disabled?: boolean
  adoptDisabled?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const decisionLock = useRef(false)
  const [decisionPending, setDecisionPending] = useState<'adopt' | 'discard' | null>(null)
  const decide = (kind: 'adopt' | 'discard', action: () => void | Promise<void>) => {
    const task = runExclusiveAction(decisionLock, action)
    if (!task) return
    setDecisionPending(kind)
    onPendingChange?.(true)
    const settle = () => { setDecisionPending(null); onPendingChange?.(false) }
    void task.then(settle, settle)
  }
  return <div className="v2-candidate-actions" aria-busy={Boolean(decisionPending)}>
    <button className="v2-primary-button" type="button" disabled={disabled || adoptDisabled || Boolean(decisionPending)} onClick={() => decide('adopt', onAdopt)}>
      {decisionPending === 'adopt' ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}{decisionPending === 'adopt' ? '正在采用…' : '采用为最新版本'}
    </button>
    <button className="v2-danger-button" type="button" disabled={disabled || Boolean(decisionPending)} onClick={() => decide('discard', onDiscard)}>
      {decisionPending === 'discard' ? <LoaderCircle className="is-spinning" size={15} /> : <Trash2 size={15} />}{decisionPending === 'discard' ? '正在丢弃…' : '丢弃结果'}
    </button>
  </div>
}

export function ComparisonContent({ before, after, leftLabel, mode }: { before: string; after: string; leftLabel: string; mode: 'read' | 'diff' }) {
  const comparison = useMemo(() => compareVersionText(before, after), [before, after])
  let left = 0
  let right = 0
  return <>
    <div className="v2-comparison-reading" hidden={mode !== 'read'}>
      <section aria-label={leftLabel}><h3>{leftLabel}</h3><div className="v2-comparison-prose" data-card-reader tabIndex={0} onKeyDown={readerKeyDown}><MarkdownContent>{before || '尚无内容'}</MarkdownContent></div></section>
      <section aria-label="生成结果"><h3>生成结果</h3><div className="v2-comparison-prose" data-card-reader tabIndex={0} onKeyDown={readerKeyDown}><MarkdownContent>{after}</MarkdownContent></div></section>
    </div>
    <div className="v2-comparison-difference" hidden={mode !== 'diff'} data-card-reader tabIndex={0} onKeyDown={readerKeyDown} aria-label="正文差异">
      {comparison.tooLarge ? <p role="status">内容较长，请使用完整阅读比较。</p>
        : !comparison.hasChanges ? <p role="status">正文没有差异。</p>
          : <><p className="v2-diff-legend">− 删除（当前版本）　+ 新增（生成结果）</p><div className="v2-comparison-lines">{comparison.lines.map((line, index) => {
            if (line.kind !== 'added') left += 1
            if (line.kind !== 'removed') right += 1
            return <div className={`is-${line.kind}`} key={index}><span className="v2-diff-line-number" aria-hidden="true">{line.kind !== 'added' ? left : ''}</span><span className="v2-diff-line-number" aria-hidden="true">{line.kind !== 'removed' ? right : ''}</span><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>
          })}</div></>}
    </div>
  </>
}

function snapshotFor(card: ContentCard, run: TransformationRun) {
  const head = headVersion(card)
  return {
    boardId: run.boardId, cardId: card.id, runId: run.id,
    baseVersionId: card.headVersionId, sequence: head?.sequence,
    title: cardSummary(card).title,
    before: head?.content.kind === 'markdown' ? head.content.markdown : '',
    after: run.result?.output || '',
  }
}

export default function CandidateComparison({ card, run, onClose }: { card: ContentCard; run: TransformationRun; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(() => snapshotFor(card, run))
  const [mode, setMode] = useState<'read' | 'diff'>('read')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [needsCheck, setNeedsCheck] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const stateBoardId = useV2Canvas((state) => state.boardId)
  const current = useV2Canvas((state) => state.board?.cards.find((item) => item.id === snapshot.cardId))
  const latest = useV2Canvas((state) => state.runs[snapshot.runId])
  const active = stateBoardId === snapshot.boardId && Boolean(current)
  const pending = active && latest?.status === 'succeeded' && latest.result?.disposition === 'candidate'
  const changed = current?.headVersionId !== snapshot.baseVersionId
  const setPending = (value: boolean) => { busyRef.current = value; setBusy(value) }
  const close = () => { if (!busyRef.current) onClose() }

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current!
    dialog.showModal()
    titleRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      restoreFocusAfterRender(opener, ['.v2-detail-drawer h2', '.v2-workbench-navigation button'])
    }
  }, [])

  const recompare = async () => {
    if (busyRef.current) return
    setPending(true)
    const refreshed = await useV2Canvas.getState().refreshCandidate(snapshot.runId)
    const state = useV2Canvas.getState()
    if (state.boardId === snapshot.boardId) {
      const nextCard = state.board?.cards.find((item) => item.id === snapshot.cardId)
      const nextRun = state.runs[snapshot.runId]
      if (refreshed && nextCard && nextRun) {
        setSnapshot(snapshotFor(nextCard, nextRun))
        setNeedsCheck(false)
        setError(null)
      } else {
        setNeedsCheck(true)
        setError(state.message || '暂时无法核对结果，请稍后重试。')
      }
    }
    setPending(false)
  }
  const decide = async (kind: 'adopt' | 'discard') => {
    if (!pending || needsCheck) return
    const state = useV2Canvas.getState()
    const success = kind === 'adopt'
      ? await state.adoptCandidate(snapshot.runId, snapshot.baseVersionId)
      : await state.discardCandidate(snapshot.runId)
    if (success) onClose()
    else {
      setNeedsCheck(true)
      setError(useV2Canvas.getState().message || '未能确认处理结果，请重新核对后再操作。')
    }
  }
  const leftLabel = snapshot.sequence ? `当前版本 · v${snapshot.sequence}` : '当前版本 · 尚无内容'
  return createPortal(<dialog ref={dialogRef} className="v2-candidate-dialog" aria-labelledby="v2-comparison-title" aria-describedby="v2-comparison-note"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close() }}
    onKeyDown={(event) => { event.stopPropagation() }}
    onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <header><div><h2 id="v2-comparison-title" ref={titleRef} tabIndex={-1}>比较生成结果</h2><p title={snapshot.title}>{snapshot.title}</p></div><button type="button" className="v2-icon-button" title="关闭比较" aria-label="关闭比较" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div className="v2-comparison-toolbar"><div role="group" aria-label="比较方式">
      <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}><span className="v2-comparison-wide-label">并排阅读</span><span className="v2-comparison-narrow-label">完整阅读</span></button>
      <button type="button" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>查看差异</button>
    </div><span id="v2-comparison-note">采用会追加新版本，旧版本保持可查。</span></div>
    {(changed || needsCheck || !pending) && <div className="v2-comparison-status" role="status">
      <span>{!active ? '原画板或内容已不可用。' : !pending ? latest?.result?.disposition === 'applied' ? '这个结果已经采用。' : latest?.result?.disposition === 'discarded' ? '这个结果已经丢弃。' : '结果状态需要重新核对。' : needsCheck ? error : '当前内容已更新，请重新比较后再采用。'}</span>
      {active && <button className="v2-secondary-button" type="button" disabled={busy} onClick={() => void recompare()}><RefreshCw size={14} />{needsCheck ? '重新核对并比较' : '重新比较'}</button>}
    </div>}
    <ComparisonContent key={snapshot.baseVersionId ?? 'empty'} before={snapshot.before} after={snapshot.after} leftLabel={leftLabel} mode={mode} />
    <footer><button className="v2-secondary-button" type="button" disabled={busy} onClick={close}>{pending ? '稍后处理' : '关闭比较'}</button>
      {pending && <CandidateDecisionActions disabled={needsCheck || busy} adoptDisabled={changed} onPendingChange={setPending} onAdopt={() => decide('adopt')} onDiscard={() => decide('discard')} />}
      {busy && <span className="v2-comparison-busy" role="status">正在处理结果…</span>}
    </footer>
  </dialog>, document.body)
}
