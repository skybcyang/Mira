import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { useV2Canvas } from '../../v2Store'
import { previewRunTo, runPreviewReasonLabels, runPreviewStatusLabels } from '../runPreview'
import { useDrawerIntent } from '../drawerIntent'
import { useSourcePreview } from '../sourcePreviewContext'

export function RunRangePreview({ transformationId, initiallyOpen = false }: { transformationId: string; initiallyOpen?: boolean }) {
  const board = useV2Canvas((state) => state.board)
  const runs = useV2Canvas((state) => state.runs)
  const storeOpen = useV2Canvas((state) => state.openDrawer)
  const open = useDrawerIntent(storeOpen)
  const source = useSourcePreview()
  const [expanded, setExpanded] = useState(initiallyOpen)
  useEffect(() => { if (initiallyOpen) setExpanded(true) }, [initiallyOpen])
  if (!board) return null
  const preview = expanded ? previewRunTo(board, runs, transformationId) : null
  return <details className="v2-run-range" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><ListChecks size={16} />查看运行范围</summary>
    {preview && <>
      <strong className="v2-run-range-end">终点：{preview.targetLabel}</strong>
      <p className="v2-detail-note">预计生成 {preview.summary.generate} 步 · 保留 {preview.summary.keep} 步 · 待检查 {preview.summary.check} 步</p>
      <ol>{preview.rows.map((row, index) => <li key={`${row.transformationId}:${index}`} data-status={row.status}>
        <span className="v2-run-range-index">{index + 1}</span>
        <div><strong>{row.label}</strong><span>{runPreviewStatusLabels[row.status]}</span><small>{runPreviewReasonLabels[row.reason]}</small>
          {row.runId && runs[row.runId] && <button type="button" className="v2-quiet-button" onClick={() => open({ tab: 'run', runId: row.runId! })}>查看运行</button>}
          {row.sourceCardId && source && <button type="button" className="v2-quiet-button" onClick={() => source({ boardId: board.id, cardId: row.sourceCardId! })}>查看来源</button>}
        </div>
      </li>)}</ol>
    </>}
  </details>
}
