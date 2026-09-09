import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Group, Palette, Plus, Save, Ungroup, X, MousePointer2, ClipboardPaste } from 'lucide-react'
import type { CanvasGroup, CardColor } from '../domain'
import { useV2Canvas } from '../v2Store'
import { CARD_COLORS, COLOR_LABELS } from './canvasOrganization'

export function ColorSwatches({ value, busy, onChange }: {
  value: CardColor | null | 'mixed'; busy: boolean; onChange: (color: CardColor | null) => void
}) {
  return <div className="v2-color-swatches" role="group" aria-label="颜色">
    {([null, ...CARD_COLORS] as const).map((color) => <button key={color || 'default'} type="button"
      aria-label={color ? COLOR_LABELS[color] : '默认颜色'} title={color ? COLOR_LABELS[color] : '默认颜色'}
      aria-pressed={value === color} disabled={busy} onClick={() => onChange(color)}>
      <span data-card-color={color || undefined}>{value === color ? <Check size={16} /> : !color ? <X size={16} /> : null}</span>
    </button>)}
  </div>
}

function OrganizationDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    return () => {
      dialog.close()
      if (active?.isConnected) active.focus()
    }
  }, [])
  return createPortal(<dialog ref={ref} className="v2-organization-dialog" aria-label={title} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onKeyDown={(event) => event.stopPropagation()}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="v2-organization-dialog-content">
      <header><h3>{title}</h3><button type="button" aria-label="关闭整理菜单" title="关闭" onClick={onClose}><X size={16} /></button></header>
      {children}
    </div>
  </dialog>, document.querySelector('.v2-app') || document.body)
}

export function CanvasOrganizationControls() {
  const state = useV2Canvas()
  const [mode, setMode] = useState<'color' | 'group' | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState(false)
  const boardId = state.boardId
  const selectionKey = state.selectedCardIds.join('|')
  useEffect(() => { setMode(null); setError(false) }, [boardId, selectionKey])
  const selected = state.board?.cards.filter((card) => state.selectedCardIds.includes(card.id)) || []
  const colors = new Set(selected.map((card) => card.color || null))
  const value = colors.size === 1 ? selected[0]?.color || null : 'mixed'
  const busy = state.saveState === 'saving' || state.historyState === 'applying'
  async function save(command: Promise<boolean>) {
    const success = await command
    if (success) { setMode(null); setTitle(''); setError(false) }
    else setError(true)
  }
  return <>
    <button type="button" aria-label="卡片颜色" title="卡片颜色" aria-haspopup="dialog" aria-expanded={mode === 'color'} disabled={busy || selected.length > 100} onClick={() => { setMode('color'); setError(false) }}><Palette size={16} /></button>
    <button type="button" aria-label="卡片分组" title="卡片分组" aria-haspopup="dialog" aria-expanded={mode === 'group'} disabled={busy || selected.length > 100} onClick={() => { setMode('group'); setError(false) }}><Group size={16} /></button>
    {mode && <OrganizationDialog title={mode === 'color' ? `卡片颜色 · ${selected.length} 张` : `卡片分组 · ${selected.length} 张`} onClose={() => setMode(null)}>
      {mode === 'color' ? <ColorSwatches value={value} busy={busy} onChange={(color) => void save(state.setSelectedCardColor(color))} /> : <>
        <form onSubmit={(event) => { event.preventDefault(); void save(state.createSelectedGroup(title)) }}>
          <label>分组名称<input value={title} maxLength={80} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <button type="submit" disabled={busy || !title.trim()}><Plus size={16} />建立分组</button>
        </form>
        {(state.board?.groups || []).map((group) => <button className="v2-group-command" key={group.id} type="button" disabled={busy || new Set([...group.cardIds, ...state.selectedCardIds]).size > 100}
          onClick={() => void save(state.transferSelectedCards(group.id))}><Group size={16} /><span>移入：{group.title}</span></button>)}
        <button className="v2-group-command" type="button" disabled={busy || !state.board?.groups?.some((group) => group.cardIds.some((id) => state.selectedCardIds.includes(id)))}
          onClick={() => void save(state.transferSelectedCards(null))}><Ungroup size={16} />移出分组</button>
      </>}
      {error && <p role="alert">未保存，请检查当前画布后重试。</p>}
    </OrganizationDialog>}
  </>
}

export function GroupSelectionToolbar({ group, onPaste }: { group: CanvasGroup; onPaste: () => void }) {
  const state = useV2Canvas()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(group.title)
  const [error, setError] = useState(false)
  const busy = state.saveState === 'saving' || state.historyState === 'applying'
  async function save(command: Promise<boolean>) {
    const success = await command
    setError(!success)
    if (success) setOpen(false)
  }
  return <section className="v2-selection-toolbar" aria-label="分组操作">
    <strong title={group.title}>{group.title} · {group.cardIds.length}</strong>
    <button type="button" aria-label="编辑分组" title="编辑分组" disabled={busy} onClick={() => { setTitle(group.title); setOpen(true) }}><Group size={16} /></button>
    <button type="button" aria-label="选择组内卡片" title="选择组内卡片" onClick={() => state.selectGroupCards(group.id)}><MousePointer2 size={16} /></button>
    <button type="button" aria-label="复制整组" title="复制整组" onClick={() => state.copyGroup(group.id)}><Copy size={16} /></button>
    {state.clipboard && <button type="button" aria-label="粘贴卡片" title="粘贴卡片" disabled={busy} onClick={onPaste}><ClipboardPaste size={16} /></button>}
    <button type="button" aria-label="解散分组" title="解散分组" disabled={busy} onClick={() => void state.dissolveGroup(group.id)}><Ungroup size={16} /></button>
    <button type="button" aria-label="取消分组选择" title="取消选择" onClick={state.clearSelection}><X size={16} /></button>
    {open && <OrganizationDialog title="编辑分组" onClose={() => setOpen(false)}>
      <form onSubmit={(event) => { event.preventDefault(); void save(state.updateGroup(group.id, { title })) }}>
        <label>分组名称<input value={title} maxLength={80} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
        <button type="submit" disabled={busy || !title.trim()}><Save size={16} />保存名称</button>
      </form>
      <ColorSwatches value={group.color || null} busy={busy} onChange={(color) => void save(state.updateGroup(group.id, { color }))} />
      {error && <p role="alert">未保存，请检查当前画布后重试。</p>}
    </OrganizationDialog>}
  </section>
}
