import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useV2Canvas } from '../v2Store'
import { drawerTabTargets, type DrawerTabId } from './drawerTabs'
import { nextDrawerTabIndex } from './drawerSafety'
import type { DrawerState } from './storeTypes'
import { ContentPanel } from './detail/ContentPanel'
import { VersionPanel } from './detail/VersionPanel'
import { RelationPanel } from './detail/RelationPanel'
import { RunPanel } from './detail/RunPanel'
import { SourcePreviewPanel } from './SourcePreview'
import type { SourcePreviewRequest } from './sourcePreviewContext'
import { cardSummary } from '../v2View'

export { ContentReaderView, ContentEditorView, CardTagEditor } from './detail/ContentViews'
export { SaveWorkflowForm, SaveWorkflowControl, WorkflowProvenancePanel } from './detail/WorkflowPanels'
export { TransformationEditForm, TransformationDeleteControl, transformationEditCommandLabel } from './detail/TransformationControls'
export { TransformationRunControl, RunStopButton, CandidateDecisionActions, RunPanelView } from './detail/RunPanel'
export { VersionPanelView } from './detail/VersionPanel'

const DRAWER_TAB_LABELS: Record<DrawerTabId, string> = {
  content: '内容',
  relation: '关系',
  versions: '版本',
  run: '运行',
}

export default function DetailDrawer({
  onOpenFileBindingPicker,
  onDirtyChange,
  onRequestDrawerChange,
  sourcePreview,
  onCloseSource = () => {},
}: {
  onOpenFileBindingPicker?: (cardId: string) => void
  onDirtyChange?: (dirty: boolean) => void
  onRequestDrawerChange?: (drawer: DrawerState) => void
  sourcePreview?: SourcePreviewRequest | null
  onCloseSource?: () => void
}) {
  const drawer = useV2Canvas((state) => state.drawer)
  const board = useV2Canvas((state) => state.board)
  const runs = useV2Canvas((state) => state.runs)
  const close = useV2Canvas((state) => state.openDrawer)
  const [expanded, setExpanded] = useState(false)
  const [nameTarget, setNameTarget] = useState<HTMLDivElement | null>(null)
  const [sourceExpanded, setSourceExpanded] = useState<boolean | null>(null)
  useEffect(() => { setSourceExpanded(null) }, [sourcePreview])
  const sourceRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (sourcePreview) sourceRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }) }, [sourcePreview])
  if (!drawer && !sourcePreview) return null
  const requestDrawerChange = onRequestDrawerChange || close
  const card = drawer && (drawer.tab === 'content' || drawer.tab === 'versions') ? board?.cards.find((item) => item.id === drawer.cardId) : undefined
  const title = !drawer ? '来源预览' : drawer.tab === 'versions'
    ? '版本历史'
    : drawer.tab === 'content'
      ? card ? cardSummary(card).title : '完整内容'
    : drawer.tab === 'relation'
      ? '转化设置'
      : '运行详情'
  const tabs = drawerTabTargets(drawer, board, runs).filter(entry => entry.target || entry.active)
  const isExpanded = sourcePreview && drawer ? sourceExpanded ?? true : expanded
  return <aside className={`v2-detail-drawer${isExpanded ? ' is-expanded' : ''}${sourcePreview ? ' has-source-preview' : ''}`} aria-label={title}>
    <header><div className="v2-inspector-title" ref={setNameTarget}>{(drawer?.tab !== 'content' || !card) && <h2 tabIndex={-1} title={title}>{title}</h2>}</div><div className="v2-drawer-heading-actions">
      <button className="v2-icon-button v2-drawer-expand" type="button" aria-label={isExpanded ? '收起阅读区' : '展开阅读区'} title={isExpanded ? '收起阅读区' : '展开阅读区'} onClick={() => { setExpanded(!isExpanded); if (sourcePreview) setSourceExpanded(!isExpanded) }}>{isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      <button className="v2-icon-button" type="button" aria-label="关闭详情" title="关闭详情" onClick={() => drawer ? requestDrawerChange(null) : onCloseSource()}><X size={18} /></button>
    </div></header>
    {drawer && <nav className="v2-drawer-tabs" role="tablist" aria-label="详情视图">{tabs.map((entry, index) => <button
      key={entry.tab}
      id={`v2-drawer-tab-${entry.tab}`}
      type="button"
      role="tab"
      className={entry.active ? 'is-active' : ''}
      aria-selected={entry.active}
      aria-controls="v2-drawer-tabpanel"
      tabIndex={entry.active ? 0 : -1}
      disabled={!entry.target}
      onClick={() => !entry.active && entry.target && requestDrawerChange(entry.target)}
      onKeyDown={(event) => {
        const nextIndex = nextDrawerTabIndex(
          tabs.map((tab) => Boolean(tab.target)),
          index,
          event.key,
        )
        if (nextIndex === index) return
        event.preventDefault()
        const next = tabs[nextIndex]
        document.getElementById(`v2-drawer-tab-${next.tab}`)?.focus()
        if (next.target) requestDrawerChange(next.target)
      }}
    >{entry.tab === 'relation' ? '生成步骤' : entry.tab === 'run' ? '运行记录' : DRAWER_TAB_LABELS[entry.tab]}</button>)}</nav>}
    <div className={`v2-detail-workspace${drawer ? '' : ' source-only'}`}>
    {drawer && <div
      id="v2-drawer-tabpanel"
      className="v2-drawer-body"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={`v2-drawer-tab-${drawer.tab}`}
    >{drawer.tab === 'content'
      ? <ContentPanel key={drawer.cardId} cardId={drawer.cardId} initialMode={drawer.mode} nameTarget={nameTarget} onOpenFileBindingPicker={onOpenFileBindingPicker} onDirtyChange={onDirtyChange} />
      : drawer.tab === 'versions'
        ? <VersionPanel cardId={drawer.cardId} />
      : drawer.tab === 'relation'
         ? <RelationPanel key={drawer.transformationId} transformationId={drawer.transformationId} initialEditing={drawer.edit} initialPreview={drawer.preview} onDirtyChange={onDirtyChange} />
         : <RunPanel key={drawer.runId} runId={drawer.runId} />}</div>}
    {sourcePreview && <div ref={sourceRef} className="v2-source-companion"><SourcePreviewPanel request={sourcePreview} onClose={onCloseSource} returnLabel={drawer?.tab === 'content' ? '返回正文' : '返回原任务'} /></div>}
    </div>
  </aside>
}
