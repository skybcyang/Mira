import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  MousePointer2,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useV2Canvas } from '../v2Store'
import type { ReactNode } from 'react'
import { CanvasOrganizationControls, GroupSelectionToolbar } from './CanvasOrganizationControls'
import CardGeometryControls from './CardGeometryControls'

interface CanvasSelectionToolbarViewProps {
  organizationControls?: ReactNode
  selectedCount: number
  clipboardCount: number
  deleteConfirmationCount: number
  multiSelectMode: boolean
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onClearSelection: () => void
  onClearClipboard: () => void
  onToggleMultiSelect: () => void
}

export function CanvasSelectionToolbarView({
  organizationControls,
  selectedCount,
  clipboardCount,
  deleteConfirmationCount,
  multiSelectMode,
  onCopy,
  onPaste,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onClearSelection,
  onClearClipboard,
  onToggleMultiSelect,
}: CanvasSelectionToolbarViewProps) {
  if (selectedCount === 0 && clipboardCount === 0 && !multiSelectMode) return null

  if (deleteConfirmationCount > 0) {
    return <section className="v2-selection-toolbar is-confirming" aria-label="确认删除卡片">
      <strong>删除 {deleteConfirmationCount} 张卡片？</strong>
      <button type="button" onClick={onCancelDelete}>取消</button>
      <button className="danger" type="button" onClick={onConfirmDelete}>
        <Trash2 size={15} />确认删除
      </button>
    </section>
  }

  return <section className="v2-selection-toolbar" aria-label="卡片操作">
    <strong>
      {selectedCount > 0
        ? `已选 ${selectedCount} 张`
        : multiSelectMode
          ? '多选卡片'
          : `已复制 ${clipboardCount} 张`}
    </strong>
    {selectedCount > 0 && <>
      {organizationControls}
      <button type="button" aria-label="复制卡片" title="复制卡片" onClick={onCopy}>
        <Copy size={16} />
      </button>
      <button type="button" aria-label="创建副本" title="创建副本" onClick={onDuplicate}>
        <CopyPlus size={16} />
      </button>
      <details className="v2-selection-more" data-context-menu>
        <summary aria-label="更多卡片操作" title="更多卡片操作"><MoreHorizontal size={16} /></summary>
        <div className="v2-card-menu"><button className="danger-icon" type="button" aria-label="删除卡片" title="删除卡片" onClick={onRequestDelete}>
          <Trash2 size={16} />删除卡片
        </button></div>
      </details>
    </>}
    {clipboardCount > 0 && <button type="button" aria-label="粘贴卡片" title="粘贴卡片" onClick={onPaste}>
      <ClipboardPaste size={16} />
    </button>}
    <button
      className={multiSelectMode ? 'is-active' : ''}
      type="button"
      aria-label={multiSelectMode ? '结束多选' : '切换多选'}
      title={multiSelectMode ? '结束多选' : '切换多选'}
      aria-pressed={multiSelectMode}
      onClick={onToggleMultiSelect}
    >
      <MousePointer2 size={16} />
    </button>
    {selectedCount > 0
      ? <button type="button" aria-label="取消选择" title="取消选择" onClick={onClearSelection}><X size={16} /></button>
      : clipboardCount > 0 && !multiSelectMode
        ? <button type="button" aria-label="清空已复制卡片" title="清空已复制卡片" onClick={onClearClipboard}><X size={16} /></button>
        : null}
  </section>
}

export default function CanvasSelectionToolbar() {
  const selectedGroup = useV2Canvas((state) => state.board?.groups?.find((group) => group.id === state.selectedGroupId))
  const selectedCount = useV2Canvas((state) => state.selectedCardIds.length)
  const clipboardCount = useV2Canvas((state) => state.clipboard?.items.length || 0)
  const deleteConfirmationCount = useV2Canvas((state) => state.deleteConfirmationIds?.length || 0)
  const multiSelectMode = useV2Canvas((state) => state.multiSelectMode)
  const copySelectedCards = useV2Canvas((state) => state.copySelectedCards)
  const pasteCards = useV2Canvas((state) => state.pasteCards)
  const duplicateSelectedCards = useV2Canvas((state) => state.duplicateSelectedCards)
  const requestDeleteSelectedCards = useV2Canvas((state) => state.requestDeleteSelectedCards)
  const cancelDeleteSelectedCards = useV2Canvas((state) => state.cancelDeleteSelectedCards)
  const confirmDeleteSelectedCards = useV2Canvas((state) => state.confirmDeleteSelectedCards)
  const clearSelection = useV2Canvas((state) => state.clearSelection)
  const clearClipboard = useV2Canvas((state) => state.clearClipboard)
  const toggleMultiSelectMode = useV2Canvas((state) => state.toggleMultiSelectMode)
  const rf = useReactFlow()

  const center = () => rf.screenToFlowPosition({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  })

  if (selectedGroup) return <GroupSelectionToolbar key={selectedGroup.id} group={selectedGroup} onPaste={() => void pasteCards(center())} />
  return <CanvasSelectionToolbarView
    organizationControls={<><CanvasOrganizationControls /><CardGeometryControls /></>}
    selectedCount={selectedCount}
    clipboardCount={clipboardCount}
    deleteConfirmationCount={deleteConfirmationCount}
    multiSelectMode={multiSelectMode}
    onCopy={copySelectedCards}
    onPaste={() => void pasteCards(center())}
    onDuplicate={() => void duplicateSelectedCards()}
    onRequestDelete={requestDeleteSelectedCards}
    onCancelDelete={cancelDeleteSelectedCards}
    onConfirmDelete={() => void confirmDeleteSelectedCards()}
    onClearSelection={clearSelection}
    onClearClipboard={clearClipboard}
    onToggleMultiSelect={toggleMultiSelectMode}
  />
}
