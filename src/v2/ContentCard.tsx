import { Activity, AlertCircle, BookOpen, ChevronDown, GitCompareArrows, History, Maximize2, Pencil, RotateCw, Square, TextCursorInput } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import MarkdownContent from './MarkdownContent'
import type { V2CardNodeData } from '../v2Projection'
import { useV2Canvas } from '../v2Store'
import { canvasCardTags, cardSummary } from '../v2View'
import { useCardSelection, useDrawerAction, useDrawerIntent } from './drawerIntent'
import CardResizeHandle from './CardResizeHandle'
import { readerKeyDown } from './cardReadingEvents'

type ContentNode = Node<V2CardNodeData, 'contentCard'>

export function EmptyCardMessage({ waitingExecution }: { waitingExecution: boolean }) {
  return <div className={`v2-empty-card ${waitingExecution ? 'is-waiting' : ''}`}>
    {waitingExecution ? '等待生成' : '开始写下内容…'}
  </div>
}

export default function ContentCardNode({ id, data, selected }: NodeProps<ContentNode>) {
  const storeOpenDrawer = useV2Canvas((state) => state.openDrawer)
  const openDrawer = useDrawerIntent(storeOpenDrawer)
  const runDrawerAction = useDrawerAction()
  const interrupt = useV2Canvas((state) => state.interruptRun)
  const runTo = useV2Canvas((state) => state.runToTransformation)
  const runningToTransformationId = useV2Canvas((state) => state.runningToTransformationId)
  const selectedIds = useV2Canvas((state) => state.selectedCardIds)
  const setSelectedCardIds = useCardSelection(useV2Canvas((state) => state.setSelectedCardIds))
  const multiSelectMode = useV2Canvas((state) => state.multiSelectMode)
  const transformation = useV2Canvas((state) => state.board?.transformations.find((item) => item.targetCardId === id))
  const order = selectedIds.indexOf(id)
  const isRunning = data.runStatus === 'queued' || data.runStatus === 'running'
  const summary = cardSummary(data.card)
  const tags = canvasCardTags(data.card.tags)
  const contentRef = useRef<HTMLDivElement>(null)
  const [hasMore, setHasMore] = useState(false)
  const checkOverflow = () => {
    const element = contentRef.current
    if (element) setHasMore(element.scrollTop + element.clientHeight < element.scrollHeight - 2)
  }
  useEffect(() => {
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [data.markdown, data.filePath, data.runStatus])

  return <article data-card-color={data.card.color} className={`v2-card ${selected ? 'is-selected' : ''} ${isRunning ? 'is-running' : ''} ${data.runStatus === 'failed' ? 'is-failed' : ''}`}>
    {order >= 0 && selectedIds.length > 1 && <span className="v2-source-order" aria-label={`来源 ${order + 1}`}>{order + 1}</span>}
    <Handle className="v2-handle v2-handle-in" type="target" position={Position.Left} />
    <Handle className="v2-handle v2-handle-out" type="source" position={Position.Right} />
    {selected && selectedIds.length === 1 && <CardResizeHandle card={data.card} />}
    <header className="v2-card-heading" onPointerDown={() => window.getSelection()?.removeAllRanges()}>
      <strong className="v2-card-heading-title" title={summary.title}>{summary.title}</strong>
      <button className="v2-icon-button v2-card-rename nodrag" type="button" aria-label="重命名卡片" title="重命名" onClick={(event) => { event.stopPropagation(); openDrawer({ tab: 'content', cardId: id, mode: 'rename' }) }}><TextCursorInput size={14} /></button>
      <button className="v2-icon-button nodrag" type="button" aria-label="阅读完整内容" title="阅读完整内容" onClick={(event) => { event.stopPropagation(); openDrawer({ tab: 'content', cardId: id, mode: 'read' }) }}><BookOpen size={14} /></button>
      <button className="v2-icon-button nodrag" type="button" aria-label={data.card.contentKind === 'file-reference' ? '查看文件内容' : '编辑内容'} title={data.card.contentKind === 'file-reference' ? '查看文件内容' : '编辑内容'} onClick={(event) => { event.stopPropagation(); openDrawer({ tab: 'content', cardId: id, mode: 'edit' }) }}>{data.card.contentKind === 'file-reference' ? <Maximize2 size={13} /> : <Pencil size={13} />}</button>
    </header>
    <div className={`v2-card-content nodrag nowheel nokey${multiSelectMode ? ' is-multiselect' : ''}`} data-card-reader tabIndex={0}
      ref={contentRef} onScroll={checkOverflow} onLoadCapture={checkOverflow}
      onMouseDown={(event) => { if (!event.shiftKey && !multiSelectMode) event.stopPropagation() }}
      onClick={(event) => {
        event.stopPropagation()
        if ((event.target as HTMLElement).closest('a, button')) return
        if (!window.getSelection()?.isCollapsed) return
        if (useV2Canvas.getState().sourcePicker) { useV2Canvas.getState().toggleSourcePickerCard(id); return }
        setSelectedCardIds(!event.shiftKey && !multiSelectMode ? [id]
          : selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id], !event.shiftKey && !multiSelectMode)
      }}
      onKeyDown={readerKeyDown}
    >{isRunning && !data.markdown ? <div className="v2-running" aria-live="polite">
          <span>正在整理内容</span><i /><i /><i />
        </div> : data.runStatus === 'failed' && !data.markdown ? <div className="v2-failed-copy">
          <strong>生成未完成</strong><span>内容没有被覆盖，可以重新尝试。</span>
        </div> : data.card.contentKind === 'file-reference' ? <div className="v2-file-card">
          <span>文件材料</span><strong>{data.filePath?.split('/').pop()}</strong><code>{data.filePath}</code>
        </div> : data.markdown ? <MarkdownContent>{data.markdown}</MarkdownContent> : <EmptyCardMessage waitingExecution={data.waitingExecution} />}
    </div>
    <div className="v2-card-tags-slot">{tags.visible.length > 0 && <div className="v2-card-canvas-tags" role="list" aria-label={tags.accessibleLabel}>
      {tags.visible.map((tag) => <span role="listitem" key={tag} title={tag}>{tag}</span>)}
      {tags.overflow > 0 && <span aria-hidden="true">+{tags.overflow}</span>}
    </div>}</div>
    <footer className="v2-card-footer" aria-label="卡片操作" onClick={(event) => event.stopPropagation()}>
      <button className="v2-text-button nodrag" type="button" aria-label={`查看版本历史，${data.versionLabel}`} title="查看版本历史" onClick={() => openDrawer({ tab: 'versions', cardId: id })}>
        <History size={13} />{data.versionLabel}
      </button>
      <button className="v2-icon-button v2-overflow-hint nodrag" type="button" aria-label="继续阅读完整内容" title="继续阅读完整内容" style={{ visibility: hasMore ? 'visible' : 'hidden' }} onClick={() => openDrawer({ tab: 'content', cardId: id, mode: 'read' })}><ChevronDown size={13} /></button>
      {data.stale && <button className="v2-status warning nodrag" type="button" onClick={() => transformation && openDrawer({ tab: 'relation', transformationId: transformation.id })}>
        <RotateCw size={13} />来源已变化
      </button>}
      {data.candidateRunId && <button className="v2-status warning nodrag" type="button" onClick={() => openDrawer({ tab: 'run', runId: data.candidateRunId! })}>
        <GitCompareArrows size={13} />待比较
      </button>}
      {data.runStatus === 'failed' && <button className="v2-status danger nodrag" type="button" disabled={Boolean(runningToTransformationId)} onClick={() => transformation && runDrawerAction(() => runTo(transformation.id))}>
        <AlertCircle size={13} />重试
      </button>}
      {isRunning && data.runId && <>
        <button className="v2-icon-button nodrag" type="button" aria-label="查看运行进度" title="查看运行进度" onClick={(event) => {
          event.stopPropagation()
          openDrawer({ tab: 'run', runId: data.runId! })
        }}><Activity size={13} /></button>
        <button className="v2-icon-button nodrag" type="button" aria-label="停止生成" title="停止生成" onClick={(event) => {
          event.stopPropagation()
          void interrupt(data.runId!)
        }}><Square size={13} /></button>
      </>}
    </footer>
  </article>
}
