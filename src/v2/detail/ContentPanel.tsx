import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Link2 } from 'lucide-react'
import { v2Api, type FileBindingStatus, type FileSyncStatus } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { cardSummary, headVersion } from '../../v2View'
import {
  createDraftSnapshot,
  reconcileDraftSnapshot,
  reconcileRevisionNotice,
  type DraftSnapshot,
} from '../drawerSafety'
import { CardTagEditor, ContentEditorView, ContentReaderView } from './ContentViews'
import { useSourcePreview } from '../sourcePreviewContext'
import { CardNameEditor } from './CardNameEditor'
import { useInspectorDraft } from '../inspectorDrafts'

function fileSyncLabel(status: FileSyncStatus): string {
  return {
    unbound: '未绑定',
    synced: '已同步',
    unsynced: '待同步',
    conflict: '本地有修改',
    missing: '文件缺失',
    error: '同步异常',
  }[status]
}

export function ContentPanel({
  cardId,
  onOpenFileBindingPicker,
  onDirtyChange,
  initialMode = 'read',
  nameTarget,
}: {
  cardId: string
  onOpenFileBindingPicker?: (cardId: string) => void
  onDirtyChange?: (dirty: boolean) => void
  initialMode?: 'read' | 'edit' | 'rename'
  nameTarget?: HTMLElement | null
}) {
  const boardId = useV2Canvas((state) => state.boardId)
  const drawerRequest = useV2Canvas((state) => state.drawer)
  const sourceIds = useV2Canvas((state) => state.board?.transformations.find((item) => item.targetCardId === cardId)?.sourceCardIds)
  const sourcePreview = useSourcePreview()
  const card = useV2Canvas((state) => state.board?.cards.find((item) => item.id === cardId))
  const boards = useV2Canvas((state) => state.boards)
  const updateCardTags = useV2Canvas((state) => state.updateCardTags)
  const commitCard = useV2Canvas((state) => state.commitCard)
  const saveAndCreateNext = useV2Canvas((state) => state.saveAndCreateNext)
  const [mode, setMode] = useState<'read' | 'edit'>(initialMode === 'rename' ? 'read' : initialMode)
  const [continuing, setContinuing] = useState(false)
  const [nextBlocked, setNextBlocked] = useState(false)
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null)
  const recordingLock = useRef(false)
  const currentScope = useRef(cardId)
  currentScope.current = cardId
  useEffect(() => { setMode(initialMode === 'rename' ? 'read' : initialMode) }, [initialMode, drawerRequest])
  const unbindCardFile = useV2Canvas((state) => state.unbindCardFile)
  const syncCardFile = useV2Canvas((state) => state.syncCardFile)
  const refreshCardFileBinding = useV2Canvas((state) => state.refreshCardFileBinding)
  const saving = useV2Canvas((state) => state.saveState === 'saving')
  const head = card ? headVersion(card) : undefined
  const markdown = head?.content.kind === 'markdown' ? head.content.markdown : ''
  const [draft, setDraft] = useState<DraftSnapshot<string>>(() => (
    createDraftSnapshot(cardId, head?.id || '', markdown)
  ))
  const [tagsDirty, setTagsDirty] = useState(false)
  const [nameDirty, setNameDirty] = useState(false)
  const [headNotice, setHeadNotice] = useState(() => ({
    scopeId: cardId,
    revision: head?.id || '',
    changed: false,
  }))
  const [reload, setReload] = useState(0)
  const [fileBindingStatus, setFileBindingStatus] = useState<FileBindingStatus | null>(null)
  const [fileState, setFileState] = useState<{
    loading: boolean
    content: string
    error?: string
  }>({ loading: card?.contentKind === 'file-reference', content: '' })

  useEffect(() => {
    if (!boardId || !card || card.contentKind !== 'file-reference') return
    let active = true
    setFileState({ loading: true, content: '' })
    void v2Api.getCardContent(boardId, card.id).then(
      (result) => { if (active) setFileState({ loading: false, content: result.content }) },
      (error: unknown) => {
        if (active) setFileState({
          loading: false,
          content: '',
          error: error instanceof Error ? error.message : '文件内容读取失败',
        })
      },
    )
    return () => { active = false }
  }, [boardId, card?.id, card?.contentKind, head?.id, reload])

  useEffect(() => {
    setDraft((current) => reconcileDraftSnapshot(
      current,
      { scopeId: cardId, revision: head?.id || '', value: markdown },
      (left, right) => left === right,
      true,
    ))
  }, [cardId, head?.id, markdown])

  const contentDirty = draft.value !== draft.baseline
  useEffect(() => {
    setHeadNotice((current) => reconcileRevisionNotice(
      current,
      { scopeId: cardId, revision: head?.id || '' },
      tagsDirty || (contentDirty && draft.value !== markdown),
    ))
  }, [cardId, contentDirty, draft.value, head?.id, markdown, tagsDirty])
  useLayoutEffect(() => { onDirtyChange?.(contentDirty || tagsDirty || nameDirty) }, [contentDirty, onDirtyChange, tagsDirty, nameDirty])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useInspectorDraft(`body:${cardId}`, contentDirty, () => commitCard(cardId, draft.value, draft.revision || null), saving || continuing)

  useEffect(() => {
    if (!card?.fileBinding) {
      setFileBindingStatus(null)
      return
    }
    let active = true
    void refreshCardFileBinding(card.id).then((status) => {
      if (active) setFileBindingStatus(status)
    })
    return () => { active = false }
  }, [card?.id, card?.fileBinding?.path, card?.fileBinding?.lastSyncedVersionId, refreshCardFileBinding])

  if (!card) return <p className="v2-empty-detail">这张卡已不在当前画板中。</p>
  const path = head?.content.kind === 'file-reference' ? head.content.path : undefined
  const content = head?.content.kind === 'markdown' ? head.content.markdown : fileState.content
  const sourceBoard = card.inspirationRef?.boardId
    ? boards.find((item) => item.id === card.inspirationRef?.boardId)
    : undefined
  return <div className="v2-content-detail">
    {nameTarget && createPortal(<CardNameEditor key={card.id} cardId={card.id} name={card.name} title={cardSummary(card).title} autoFocus={initialMode === 'rename'} disabled={continuing} onDirtyChange={setNameDirty} />, nameTarget)}
    {sourceIds?.length && sourcePreview && boardId ? <div className="v2-content-sources" aria-label="成果来源">
      {sourceIds.map((id, index) => <button className="v2-quiet-button" type="button" key={id} onClick={() => sourcePreview({ boardId, cardId: id })}><BookOpen size={14} />查看来源 {index + 1}</button>)}
    </div> : null}
    <details className="v2-content-metadata"><summary><span>标签</span>{card.tags?.length ? card.tags.slice(0, 2).map(tag => <span className="v2-inspector-tag" key={tag}>{tag}</span>) : <span className="v2-detail-note">添加标签</span>}{(card.tags?.length || 0) > 2 && <span className="v2-inspector-tag">+{card.tags!.length - 2}</span>}</summary><fieldset disabled={continuing} className="v2-tag-editor-fieldset"><CardTagEditor
      scopeId={card.id}
      tags={card.tags || []}
      onSave={(tags) => updateCardTags(card.id, tags)}
      onDirtyChange={setTagsDirty}
    /></fieldset></details>
    <details className="v2-card-info"><summary>卡片信息{card.fileBinding ? ' · 已绑定文件' : ''}{card.inspirationRef ? ' · 来自灵感池' : ''}</summary>
    {card.inspirationRef && <section className="v2-inspiration-provenance" aria-label="灵感出处">
      <header><Link2 size={14} /><strong>来自灵感池</strong></header>
      {card.inspirationRef.poolId
        ? <dl><dt>来源</dt><dd>工作区灵感池</dd><dt>池条目</dt><dd><code>{card.inspirationRef.entryId}</code></dd><dt>所选版本</dt><dd><code>{card.inspirationRef.versionId}</code></dd></dl>
        : <dl><dt>来源画板</dt><dd>{sourceBoard?.title || card.inspirationRef.boardId}</dd><dt>来源卡片</dt><dd><code>{card.inspirationRef.cardId}</code></dd><dt>所选版本</dt><dd><code>{card.inspirationRef.versionId}</code></dd></dl>}
    </section>}
    {card.contentKind === 'markdown' && <div className="v2-content-file-metadata">
        <section className="v2-file-binding" aria-label="本地文件">
          <header><strong>本地文件</strong>{card.fileBinding && <span className={`v2-file-binding-status is-${fileBindingStatus?.status || 'synced'}`}>{fileSyncLabel(fileBindingStatus?.status || 'synced')}</span>}</header>
          {card.fileBinding
            ? <>
              <code title={card.fileBinding.path}>{card.fileBinding.path}</code>
              <div className="v2-file-binding-actions">
                {(fileBindingStatus?.status === 'conflict' || fileBindingStatus?.status === 'missing') && <button className="v2-secondary-button" type="button" onClick={() => void syncCardFile(card.id, 'overwrite')}>用 Mira 版本覆盖</button>}
                {fileBindingStatus?.status === 'conflict' && <button className="v2-secondary-button" type="button" onClick={() => void syncCardFile(card.id, 'import')}>导入本地修改</button>}
                <button className="v2-quiet-button" type="button" onClick={() => void unbindCardFile(card.id)}>解除绑定</button>
              </div>
            </>
            : <button className="v2-secondary-button" type="button" onClick={() => onOpenFileBindingPicker?.(card.id)}><Link2 size={14} />绑定本地文件</button>}
          {fileBindingStatus?.message && <p className="v2-detail-note">{fileBindingStatus.message}</p>}
        </section>
    </div>}
    {path && <p className="v2-detail-note">引用文件：{path}</p>}
    </details>
    {card.contentKind === 'markdown'
      ? <>
        <ContentEditorView
          title={cardSummary(card).title}
          hideTitle
          content={draft.value}
          dirty={contentDirty}
          headChanged={(draft.upstreamChanged && contentDirty) || headNotice.changed}
          saving={saving || continuing}
          mode={mode}
          onModeChange={setMode}
          message={recordingMessage || (nameDirty ? '名称尚未保存，请先保存名称再连续新建。' : tagsDirty ? '标签尚未保存，请先保存标签再连续新建。' : null)}
          nextBlocked={nextBlocked || tagsDirty || nameDirty}
          onChange={(value) => setDraft((current) => reconcileDraftSnapshot(
            { ...current, value },
            { scopeId: card.id, revision: head?.id || '', value: markdown },
            (left, right) => left === right, true,
          ))}
          onSave={() => void commitCard(card.id, draft.value, draft.revision || null).then(saved => { if (saved) setMode('read') })}
          onSaveNext={() => {
            if (recordingLock.current || nextBlocked || tagsDirty || nameDirty) return
            recordingLock.current = true
            setContinuing(true)
            setRecordingMessage(null)
            const scope = card.id
            void saveAndCreateNext(card.id, draft.value, draft.revision || null).then((result) => {
              if (currentScope.current !== scope) return
              if (result.status === 'creation-uncertain') {
                setNextBlocked(true)
                setRecordingMessage('正文已保存，新卡状态待核对。请重新打开画板检查，不要重复创建。')
              } else if (result.status === 'creation-failed') {
                setRecordingMessage('正文已保存，新卡未创建。可以再次尝试。')
              } else if (result.status === 'save-failed') {
                setRecordingMessage('正文未保存，草稿已保留。请处理保存错误后重试。')
              }
            }).finally(() => { recordingLock.current = false; if (currentScope.current === scope) setContinuing(false) })
          }}
          onCancel={() => { setDraft(createDraftSnapshot(card.id, head?.id || '', markdown)); setMode('read') }}
        />

      </>
      : <ContentReaderView
        hideTitle
        contentKind={card.contentKind}
        title={card.name || path?.split('/').pop() || cardSummary(card).title}
        path={path}
        content={content}
        loading={card.contentKind === 'file-reference' && fileState.loading}
        error={fileState.error}
        onRetry={() => setReload((value) => value + 1)}
      />}
  </div>
}
