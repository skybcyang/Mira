import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { useV2Canvas } from '../v2Store'
import { cardSummary } from '../v2View'
import { appendedSources, sourceEditBlock, sourceListError } from './transformationSources'

export default function SourcePickerToolbar() {
  const picker = useV2Canvas(state => state.sourcePicker)
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const toggle = useV2Canvas(state => state.toggleSourcePickerCard)
  const cancel = useV2Canvas(state => state.cancelSourcePicker)
  const confirm = useV2Canvas(state => state.confirmSourcePicker)
  const menu = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    // Let the closing drawer finish restoring focus before entering the new task.
    const frame = requestAnimationFrame(() => menu.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  const step = board?.transformations.find(item => item.id === picker?.transformationId)
  useEffect(() => {
    if (picker && board && !step) cancel()
  }, [picker, board, step, cancel])
  if (!board || !picker || !step) return null
  const blocked = sourceEditBlock(board, step, runs)
  return <section className="v2-source-picker" aria-label="添加转化来源">
    <header><strong title={step.label}>添加来源 · {step.label}</strong><span aria-live="polite">已选 {picker.cardIds.length} 张</span></header>
    <select ref={menu} aria-label="选择来源卡片" value="" disabled={picker.saving || Boolean(blocked)}
      onChange={event => { if (event.target.value) toggle(event.target.value) }}>
      <option value="">选择来源卡片</option>
      {board.cards.filter(card => !step.sourceCardIds.includes(card.id) && !picker.cardIds.includes(card.id)).map(card => {
        const error = sourceListError(board, step, appendedSources(step, [card.id]))
        return <option key={card.id} value={card.id} disabled={Boolean(error)}>{cardSummary(card).title}{error ? '（不可用）' : ''}</option>
      })}
    </select>
    {picker.cardIds.length > 0 && <ol>{picker.cardIds.map((id, index) => {
      const card = board.cards.find(item => item.id === id)
      const title = card ? cardSummary(card).title : '来源已移除'
      return <li key={id}><span title={title}>{index + 1}. {title}</span>
        <button className="v2-icon-button" type="button" title="取消选择" aria-label={'取消选择：' + title} disabled={picker.saving} onClick={() => toggle(id)}><X size={14} /></button>
      </li>
    })}</ol>}
    {blocked && <p role="status">{blocked}</p>}
    <footer><button type="button" onClick={cancel} disabled={picker.saving}>取消</button>
      <button type="button" className="v2-primary-button" disabled={picker.saving || !picker.cardIds.length || Boolean(blocked)}
        onClick={() => void confirm()}><Check size={15} />{picker.saving ? '正在添加…' : '确认添加（' + picker.cardIds.length + '）'}</button></footer>
  </section>
}
