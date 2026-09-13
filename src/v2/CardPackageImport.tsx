import { useRef, useState } from 'react'
import { useV2Canvas } from '../v2Store'
import { inspectBoardArtifact, type BoardArtifactPreview } from './boardManagerPolicy'

export function CardPackageImport({ disabled, onBusy }: { disabled: boolean; onBusy: (busy: boolean) => void }) {
  const board = useV2Canvas(state => state.board), importCards = useV2Canvas(state => state.importCardPackage)
  const [draft, setDraft] = useState<{ artifact: unknown; preview: BoardArtifactPreview; boardId: string }>()
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false)
  const lock = useRef(false), input = useRef<HTMLInputElement>(null)
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setError(''); setMessage('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '文件无法读取。') }
    finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  return <section className="v2-card-package-import" aria-label="导入卡片到当前画板">
    <label className="v2-secondary-button v2-board-import-file">导入卡片到当前画板<input ref={input} type="file" accept=".mira-cards.json" disabled={disabled || busy || !board || (board.lifecycle && board.lifecycle.state !== 'active')} onChange={event => {
      const file = event.target.files?.[0]
      if (!file || !board) return
      void run(async () => {
        setDraft(undefined); setUncertain(false)
        if (!file.name.endsWith('.mira-cards.json') || file.size > 64 * 1024 * 1024) throw new Error('请选择不超过 64 MiB 的 .mira-cards.json 文件。')
        const artifact = JSON.parse(await file.text())
        if (artifact.selection !== true || artifact.formatVersion !== 2) throw new Error('这不是所选卡片包。完整画板请使用“导入画板副本”。')
        setDraft({ artifact, preview: inspectBoardArtifact(artifact), boardId: board.id })
      })
    }} /></label>
    {draft && <div className="v2-board-import-preview"><p>{draft.preview.cardCount} 张卡片 · {draft.preview.materialCount || 0} 份原件</p><p>添加到“{board?.title}”，创建独立副本，不运行模型。</p>
      <button className="v2-secondary-button" type="button" disabled={busy} onClick={() => { setDraft(undefined); setError(''); if (input.current) input.current.value = '' }}>取消</button>
      <button className="v2-primary-button" type="button" disabled={busy || disabled || uncertain || draft.boardId !== board?.id} onClick={() => void run(async () => {
        try { await importCards(draft.artifact, { x: 80, y: 80 }) }
        catch (cause) { const status = (cause as { status?: number }).status; if (!status || status >= 500) { setUncertain(true); throw new Error('导入结果待核对。请关闭后检查画布，确认结果前不要重复导入。') } throw cause }
        setDraft(undefined); setMessage('卡片和材料已导入。'); if (input.current) input.current.value = ''
      })}>{busy ? '正在导入…' : '确认导入卡片'}</button>
    </div>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>
}
