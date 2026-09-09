import { useState } from 'react'
import { AlignLeft, AlignRight, AlignStartHorizontal, AlignEndHorizontal, Columns2, Rows2, Ruler } from 'lucide-react'
import { useV2Canvas } from '../v2Store'
import { cardSizeRequest, geometryOrganizationRequest, type GeometryOperation } from './cardGeometry'

const operations = [
  ['same-width', '同宽', Columns2],
  ['align-left', '左对齐', AlignLeft],
  ['align-right', '右对齐', AlignRight],
  ['align-top', '顶端对齐', AlignStartHorizontal],
  ['align-bottom', '底端对齐', AlignEndHorizontal],
  ['distribute-horizontal', '水平等间距', Columns2],
  ['distribute-vertical', '垂直等间距', Rows2],
] as const

export default function CardGeometryControls() {
  const board = useV2Canvas((state) => state.board)
  const ids = useV2Canvas((state) => state.selectedCardIds)
  const pending = useV2Canvas((state) => state.organizationPending || state.historyState === 'applying' || state.saveState === 'saving' || state.loadState !== 'ready')
  const submit = useV2Canvas((state) => state.submitOrganization)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const cards = ids.flatMap((id) => board?.cards.find((card) => card.id === id) || [])
  if (!cards.length) return null
  const custom = cardSizeRequest(cards, width ? Number(width) : undefined, height ? Number(height) : undefined)
  const size = (w?: number, h?: number) => {
    const request = cardSizeRequest(cards, w, h)
    if (request && !pending) void submit(request)
  }
  const organize = (operation: GeometryOperation) => {
    const request = geometryOrganizationRequest(cards, operation)
    if (request && !pending) void submit(request)
  }
  return <details className="v2-geometry-controls" data-context-menu>
    <summary aria-label="整理卡片" title="整理卡片"><Ruler size={16} /></summary>
    <div className="v2-geometry-menu">
      <strong>卡片尺寸</strong>
      <div className="v2-size-presets"><span>宽度</span>{[312, 440, 560].map((value) => <button key={value} type="button" disabled={pending} onClick={() => size(value)}>{value}</button>)}</div>
      <div className="v2-size-presets"><span>高度</span>{[208, 320, 480].map((value) => <button key={value} type="button" disabled={pending} onClick={() => size(undefined, value)}>{value}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); if (custom && !pending) void submit(custom) }}>
        <label>宽<input type="number" min={280} max={960} step={1} aria-label="卡片宽度" placeholder={String(cards[0].width)} value={width} onChange={(event) => setWidth(event.target.value)} /></label>
        <label>高<input type="number" min={208} max={960} step={1} aria-label="卡片高度" placeholder={String(cards[0].height)} value={height} onChange={(event) => setHeight(event.target.value)} /></label>
        <button type="submit" disabled={pending || !custom}>应用</button>
      </form>
      <div className="v2-layout-actions">{operations.map(([operation, label, Icon]) => <button key={operation} type="button"
        title={operation === 'same-width' ? `以第 1 张卡的 ${cards[0].width}px 为准` : label}
        disabled={pending || !geometryOrganizationRequest(cards, operation)} onClick={() => organize(operation)}><Icon size={14} />{label}</button>)}</div>
    </div>
  </details>
}
