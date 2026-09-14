import { useEffect, useLayoutEffect, useState } from 'react'
import { useV2Canvas } from '../../v2Store'
import { cardSummary, headVersion } from '../../v2View'
import { useInspectorDraft } from '../inspectorDrafts'
import { useDrawerAction } from '../drawerIntent'

export function AppendNotePanel({ cardId, onDirtyChange }: {
  cardId: string
  onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const card = board?.cards.find(item => item.id === cardId)
  const head = card ? headVersion(card) : undefined
  const [baseVersionId] = useState(() => head?.id || '')
  const [original] = useState(() => head?.content.kind === 'markdown' ? head.content.markdown : '')
  const [markdown, setMarkdown] = useState('')
  const [pending, setPending] = useState(false)
  const [finished, setFinished] = useState(false)
  const continueCard = useV2Canvas(state => state.continueCard)
  const openDrawer = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const dirty = !finished && Boolean(markdown)
  const changed = head?.id !== baseVersionId
  useLayoutEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useInspectorDraft(`append-note:${cardId}`, dirty, async () => false, true)

  if (!card || !baseVersionId || head?.content.kind !== 'markdown') {
    return <p className="v2-empty-detail">这张卡目前不能追加笔记。</p>
  }
  return <div className="v2-extraction-panel v2-append-note-panel" aria-busy={pending}>
    <div className="v2-extraction-source"><span>接续</span><strong>{cardSummary(card).title}</strong></div>
    <section className="v2-append-original" aria-label="原卡当前内容">
      <strong>原卡内容（只读）</strong>
      <pre>{original}</pre>
    </section>
    <label htmlFor="append-note-markdown">追加内容</label>
    <textarea id="append-note-markdown" autoFocus rows={9} maxLength={1_000_000} value={markdown} disabled={pending}
      onChange={event => setMarkdown(event.target.value)} />
    <p className="v2-detail-note">保存后会创建一张保留原文的新卡，并把原卡已有的下游步骤接到新卡。</p>
    {changed && <p role="alert">原卡已有新版本。追加草稿已保留，请返回内容核对后重新打开。</p>}
    <footer className="v2-extraction-footer">
      <button type="button" className="v2-secondary-button" disabled={pending} onClick={() => action(() => openDrawer({ tab: 'content', cardId }))}>返回内容</button>
      <button type="button" className="v2-primary-button" disabled={pending || changed || !markdown.trim()} onClick={() => {
        setPending(true)
        void continueCard(cardId, baseVersionId, markdown).then(created => {
          if (created) { setFinished(true); openDrawer({ tab: 'content', cardId: created.id }) }
        }).finally(() => setPending(false))
      }}>{pending ? '保存中…' : '保存为新卡并接续'}</button>
    </footer>
  </div>
}
