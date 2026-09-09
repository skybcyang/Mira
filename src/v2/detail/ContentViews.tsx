import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, Pencil, Plus, Save, Tag, X } from 'lucide-react'
import MarkdownContent from '../MarkdownContent'
import type { ContentCard } from '../../domain'
import {
  createDraftSnapshot,
  hasUnsavedTagDraft,
  reconcileDraftSnapshot,
  type DraftSnapshot,
} from '../drawerSafety'
import { readerKeyDown } from '../cardReadingEvents'
import { useInspectorDraft } from '../inspectorDrafts'
import { appendInspirationCaptureTag } from '../inspiration'

export function ContentReaderView({
  contentKind,
  title,
  path,
  content,
  loading = false,
  error,
  onRetry,
  hideTitle = false,
}: {
  contentKind: ContentCard['contentKind']
  title: string
  path?: string
  content: string
  loading?: boolean
  error?: string
  onRetry?: () => void
  hideTitle?: boolean
}) {
  const markdownFile = contentKind === 'file-reference'
    && /\.(?:md|markdown|mdown|mkd)$/i.test(path || '')
  return <section className={`v2-content-reader ${contentKind === 'file-reference' ? 'v2-content-reader-file' : 'v2-content-reader-markdown'}`}>
    {!hideTitle && <header><strong>{title}</strong>{path && <code>{path}</code>}</header>}
    {loading
      ? <div className="v2-content-reader-state" role="status">正在读取…</div>
      : error
        ? <div className="v2-content-reader-state is-error" role="alert"><span>{error}</span>{onRetry && <button className="v2-secondary-button" type="button" onClick={onRetry}>重试</button>}</div>
        : contentKind === 'markdown' || markdownFile
          ? <div className="v2-content-reader-prose nokey" data-card-reader tabIndex={0} onKeyDown={readerKeyDown}><MarkdownContent>{content}</MarkdownContent></div>
          : <pre className="nokey" data-card-reader tabIndex={0} onKeyDown={readerKeyDown}>{content}</pre>}
  </section>
}

export function ContentEditorView({
  title,
  content,
  dirty,
  headChanged = false,
  saving,
  onChange,
  onSave,
  onCancel,
  mode = 'edit',
  onModeChange,
  onSaveNext,
  nextBlocked = false,
  message,
  hideTitle = false,
}: {
  title: string
  content: string
  dirty: boolean
  headChanged?: boolean
  saving: boolean
  onChange: (content: string) => void
  onSave: () => void
  onCancel: () => void
  mode?: 'read' | 'edit'
  onModeChange?: (mode: 'read' | 'edit') => void
  onSaveNext?: () => void
  nextBlocked?: boolean
  message?: string | null
  hideTitle?: boolean
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (mode !== 'edit') return
    editorRef.current?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      if (window.innerWidth < 720 && (window.visualViewport?.height ?? window.innerHeight) < 540) {
        editorRef.current?.scrollIntoView({ block: 'center' })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [mode])
  return <section className="v2-content-presentation">
    {onModeChange && <div className="v2-content-actions" role="group" aria-label="正文呈现">
      <span>{dirty ? '未保存的草稿' : '正文'}</span>
      <button className="v2-quiet-button" type="button" disabled={saving} onClick={() => onModeChange(mode === 'read' ? 'edit' : 'read')}>{mode === 'read' ? <Pencil size={14} /> : <BookOpen size={14} />}{mode === 'read' ? '编辑' : '预览'}</button>
    </div>}
    {message && <p className="v2-recording-message" role="status">{message}</p>}
    <div hidden={mode !== 'read'}>
      {dirty && <p className="v2-draft-label">未保存的草稿</p>}
      <ContentReaderView contentKind="markdown" title={title} content={content} hideTitle={hideTitle} />
    </div>
    <form hidden={mode !== 'edit'} className="v2-content-editor" onSubmit={(event) => { event.preventDefault(); if (dirty && !saving) onSave() }}>
    {!hideTitle && <header><strong>{title}</strong><span>{dirty ? '有未保存修改' : '已保存'}</span></header>}
    {headChanged && <p className="v2-head-change-warning" role="alert">当前 Head 已变化。你的本地草稿仍保留，保存前请核对最新内容。</p>}
    <textarea
      ref={editorRef}
      autoFocus={mode === 'edit'}
      readOnly={saving}
      className="nowheel"
      value={content}
      aria-label="编辑卡片内容"
      data-drawer-dirty={dirty ? 'true' : undefined}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' && (dirty || saving)) {
          event.preventDefault()
          event.stopPropagation()
          if (!saving) onCancel()
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          if (dirty && !saving) onSave()
        }
      }}
    />
    <footer>
      <button type="button" disabled={saving} onClick={onCancel}><X size={14} />取消修改</button>
      <button className="v2-primary-button" type="submit" disabled={!dirty || saving}><Save size={14} />{saving ? '保存中…' : '保存正文'}</button>
      {onSaveNext && <button type="button" disabled={!content.trim() || saving || nextBlocked || headChanged} onClick={onSaveNext}><Plus size={14} />保存并新建</button>}
    </footer>
  </form></section>
}

const COMMON_CARD_TAGS = ['主意', '约束', '技术', '事件'] as const

export function CardTagEditor({
  scopeId = 'card-tags',
  tags,
  onSave,
  onDirtyChange,
}: {
  scopeId?: string
  tags: string[]
  onSave: (tags: string[]) => Promise<boolean>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const tagsRevision = JSON.stringify(tags)
  const [draft, setDraft] = useState<DraftSnapshot<string[]>>(() => (
    createDraftSnapshot(scopeId, tagsRevision, [...tags])
  ))
  const [tagInput, setTagInput] = useState('')
  const activeScopeRef = useRef(scopeId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const sameTags = (left: string[], right: string[]) => (
    left.length === right.length && left.every((tag, index) => tag === right[index])
  )
  const draftTags = draft.value

  useEffect(() => {
    if (activeScopeRef.current !== scopeId) {
      activeScopeRef.current = scopeId
      setTagInput('')
    }
    setDraft((current) => reconcileDraftSnapshot(
      current,
      { scopeId, revision: tagsRevision, value: [...tags] },
      sameTags,
    ))
    setError(null)
  }, [scopeId, tagsRevision])

  const hasTag = (tag: string) => draftTags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())
  const addTag = (rawTag: string) => {
    const tag = rawTag.trim()
    if (!tag) return
    if (tag.length > 32) {
      setError('标签不能超过 32 个字符。')
      return
    }
    if (hasTag(tag)) {
      setTagInput('')
      setError(null)
      return
    }
    if (draftTags.length >= 20) {
      setError('每张卡最多 20 个标签。')
      return
    }
    setDraft((current) => ({ ...current, value: [...current.value, tag] }))
    setTagInput('')
    setError(null)
  }
  const removeTag = (tag: string) => {
    setDraft((current) => ({
      ...current,
      value: current.value.filter((item) => item.toLocaleLowerCase() !== tag.toLocaleLowerCase()),
    }))
    setError(null)
  }
  const tagsChanged = !sameTags(draftTags, draft.baseline)
  const dirty = hasUnsavedTagDraft(tagsChanged, tagInput)

  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const save = async () => {
    if (saving) return false
    let submitted: string[]
    try { submitted = appendInspirationCaptureTag(draftTags, tagInput) }
    catch (error) { setError(error instanceof Error ? error.message : '标签无效'); return false }
    setSaving(true)
    try {
      const saved = await onSave(submitted)
      if (saved) {
        setDraft(createDraftSnapshot(scopeId, JSON.stringify(submitted), submitted))
        setTagInput('')
        setError(null)
      } else setError('标签没有保存，请重试。')
      return saved
    } finally { setSaving(false) }
  }
  useInspectorDraft(`tags:${scopeId}`, dirty, save, saving)

  return <section className="v2-card-tags" aria-labelledby="v2-card-tags-title">
    <header><div><Tag size={15} /><h3 id="v2-card-tags-title">标签</h3></div><span>{draftTags.length}/20</span></header>
    <div className="v2-card-common-tags" aria-label="常用标签">
      {COMMON_CARD_TAGS.map((tag) => <button
        type="button"
        key={tag}
        aria-pressed={hasTag(tag)}
        className={hasTag(tag) ? 'is-active' : ''}
        onClick={() => hasTag(tag) ? removeTag(tag) : addTag(tag)}
      >{tag}</button>)}
    </div>
    {draftTags.length > 0 && <div className="v2-card-tag-list" aria-label="已添加标签">{draftTags.map((tag) => <span key={tag.toLocaleLowerCase()}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} title="移除标签" onClick={() => removeTag(tag)}><X size={12} /></button></span>)}</div>}
    <form className="v2-card-tag-input" onSubmit={(event) => { event.preventDefault(); addTag(tagInput) }}>
      <input value={tagInput} maxLength={32} placeholder="输入标签" aria-label="输入标签" data-drawer-dirty={tagInput.trim() ? 'true' : undefined} onChange={(event) => { setTagInput(event.target.value); setError(null) }} />
      <button className="v2-icon-button" type="submit" aria-label="添加标签" title="添加标签" disabled={!tagInput.trim()}><Plus size={15} /></button>
    </form>
    {error && <p role="alert">{error}</p>}
    <button
      className="v2-secondary-button v2-save-tags"
      type="button"
      data-drawer-dirty={tagsChanged ? 'true' : undefined}
      disabled={!dirty || saving}
      onClick={() => void save()}
    ><Save size={14} />{saving ? '保存中…' : '保存标签'}</button>
  </section>
}
