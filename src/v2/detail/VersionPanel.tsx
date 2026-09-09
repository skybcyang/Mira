import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ContentCard } from '../../domain'
import { useV2Canvas } from '../../v2Store'
import { headVersion } from '../../v2View'
import { when } from './formatters'
import { cardVersionComparison, cardVersionPreview, cardVersionRows, restoreVersionMessage, selectedCardVersion } from '../cardVersions'
import MarkdownContent from '../MarkdownContent'

export function VersionPanelView({
  card,
  selectedId,
  confirming,
  restoring,
  onSelect,
  onRequestRestore,
  onCancelRestore,
  onConfirmRestore,
}: {
  card: ContentCard
  selectedId?: string | null
  confirming: boolean
  restoring: boolean
  onSelect: (versionId: string) => void
  onRequestRestore: () => void
  onCancelRestore: () => void
  onConfirmRestore: () => void | Promise<void>
}) {
  const rows = cardVersionRows(card)
  const current = headVersion(card)
  const selected = selectedCardVersion(card, selectedId)
  const comparison = selected && current && selected.id !== current.id
    ? cardVersionComparison(selected, current)
    : null
  return <div className="v2-version-panel">
    <div className="v2-version-current"><span>当前版本</span><strong>{current ? `当前 v${current.sequence}` : '不可用'}</strong></div>
    <div className="v2-version-timeline">
      {rows.map((row) => <button type="button" className={row.id === selected?.id ? 'is-active' : ''} key={row.id} onClick={() => onSelect(row.id)}>
        <span>{row.isCurrent ? `当前 ${row.label}` : row.label}</span>
        <small>{when(row.createdAt)} · {row.originLabel}</small>
      </button>)}
    </div>
    {selected && current && comparison && <>
      {comparison.tooLarge
        ? <><p role="status">内容较长，请使用完整阅读比较。</p><section aria-label="所选历史版本"><MarkdownContent>{cardVersionPreview(selected)}</MarkdownContent></section><section aria-label="当前版本"><MarkdownContent>{cardVersionPreview(current)}</MarkdownContent></section></>
        : comparison.hasChanges
        ? <div className="v2-diff" aria-label="版本差异">{comparison.lines.map((line, index) => <div className={line.kind} key={`${index}:${line.text}`}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text || ' '}</div>)}</div>
        : <p className="v2-version-diff-empty" role="status">{comparison.emptyMessage}</p>}
      {!confirming
        ? <button className="v2-primary-button" type="button" onClick={onRequestRestore}><RotateCcw size={15} />恢复为最新版本</button>
        : <section className="v2-version-restore-confirm" role="alert" aria-busy={restoring}>
          <strong>恢复为最新版本？</strong>
          <p>{restoreVersionMessage(card)}</p>
          <div><button type="button" disabled={restoring} onClick={onCancelRestore}>取消</button><button className="v2-primary-button" type="button" disabled={restoring} onClick={() => void onConfirmRestore()}>{restoring ? '正在恢复…' : '确认恢复'}</button></div>
        </section>}
    </>}
    {selected?.id === current?.id && current && <div className="v2-version-preview"><MarkdownContent>{cardVersionPreview(current)}</MarkdownContent></div>}
  </div>
}

export function VersionPanel({ cardId }: { cardId: string }) {
  const card = useV2Canvas((state) => state.board?.cards.find((item) => item.id === cardId))
  const restore = useV2Canvas((state) => state.restoreVersion)
  const [selectedId, setSelectedId] = useState(card?.headVersionId)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  if (!card) return <p className="v2-empty-detail">这张卡已不在当前画板中。</p>
  const selected = selectedCardVersion(card, selectedId)
  const confirmRestore = async () => {
    if (!selected || selected.id === card.headVersionId || restoring) return
    setRestoring(true)
    try {
      await restore(card.id, selected.id)
    } finally {
      setRestoring(false)
      setConfirmingId(null)
    }
  }
  return <VersionPanelView
    card={card}
    selectedId={selectedId}
    confirming={confirmingId === selected?.id}
    restoring={restoring}
    onSelect={(versionId) => { setSelectedId(versionId); setConfirmingId(null) }}
    onRequestRestore={() => selected && setConfirmingId(selected.id)}
    onCancelRestore={() => setConfirmingId(null)}
    onConfirmRestore={confirmRestore}
  />
}
