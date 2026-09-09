import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useV2Canvas } from '../../v2Store'
import { createDraftSnapshot, reconcileDraftSnapshot } from '../drawerSafety'
import { TextCursorInput } from 'lucide-react'
import { useInspectorDraft } from '../inspectorDrafts'

export function CardNameEditor({ cardId, name, title, autoFocus, disabled, onDirtyChange }: {
  cardId: string
  name?: string
  title: string
  autoFocus: boolean
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
}) {
  const renameCard = useV2Canvas((state) => state.renameCard)
  const drawerRequest = useV2Canvas((state) => state.drawer)
  const input = useRef<HTMLInputElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(autoFocus)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(() => createDraftSnapshot(cardId, name || '', name || ''))
  useEffect(() => {
    setDraft(current => reconcileDraftSnapshot(current,
      { scopeId: cardId, revision: name || '', value: name || '' }, (a, b) => a === b, true))
  }, [cardId, name])
  useEffect(() => { if (autoFocus) setEditing(true) }, [autoFocus, cardId, drawerRequest])
  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select() }
    else if (wasEditing.current) renameButton.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing, cardId])
  const dirty = draft.value !== draft.baseline
  useLayoutEffect(() => { onDirtyChange(dirty || saving) }, [dirty, saving, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  const invalid = [...draft.value.trim()].length > 120 || /[\r\n\u0000-\u001f\u007f]/u.test(draft.value)
  const conflict = draft.upstreamChanged && dirty
  const save = async () => {
    if (!dirty) return true
    if (invalid || conflict || disabled || lock.current) return false
    lock.current = true
    setSaving(true)
    setError(null)
    const value = draft.value.trim()
    try {
      const saved = await renameCard(cardId, value || null, draft.revision || null)
      if (saved) { setDraft(createDraftSnapshot(cardId, value, value)); setEditing(false) }
      else setError('名称未保存，草稿已保留。请核对提示后重试。')
      return saved
    } finally { lock.current = false; setSaving(false) }
  }
  useInspectorDraft(`name:${cardId}`, dirty, save, saving || disabled)
  const cancel = () => { setDraft(createDraftSnapshot(cardId, name || '', name || '')); setError(null); setEditing(false) }
  if (!editing) return <div className="v2-inspector-name"><h2 tabIndex={-1} title={title}>{title}</h2><button ref={renameButton} className="v2-icon-button" type="button" aria-label="重命名卡片" title="重命名" onClick={() => setEditing(true)}><TextCursorInput size={16} /></button></div>
  return <form className="v2-card-name-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <label htmlFor="v2-card-name">卡片名称</label>
    <div><input id="v2-card-name" ref={input} value={draft.value} disabled={disabled || saving}
      placeholder="未设置时使用正文首行" data-drawer-dirty={dirty ? 'true' : undefined}
      onChange={event => { setDraft(current => ({ ...current, value: event.target.value })); setError(null) }}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!saving) cancel() } }} />
      <button type="submit" className="v2-secondary-button" disabled={!dirty || invalid || conflict || disabled || saving}>{saving ? '保存中…' : '保存名称'}</button>
      <button type="button" className="v2-quiet-button" disabled={disabled || saving} onClick={cancel}>取消改名</button>
    </div>
    {invalid && <p role="alert">名称最多 120 个字符，不能换行。</p>}
    {conflict && <p role="alert">最新名称：{name || '未设置'}。你的草稿已保留。
      <button type="button" className="v2-quiet-button" onClick={() => setDraft(current => ({ ...createDraftSnapshot(cardId, name || '', name || ''), value: current.value }))}>已核对，保留我的草稿</button>
    </p>}
    {error && <p role="alert">{error}</p>}
  </form>
}
