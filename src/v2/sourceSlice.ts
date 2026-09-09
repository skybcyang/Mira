import type { CanvasStoreContext } from './storeContext'
import type { V2CanvasState } from './storeTypes'
import { appendedSources, sourceEditBlock, sourceListError } from './transformationSources'

export interface SourcePicker {
  transformationId: string
  baseUpdatedAt: string
  cardIds: string[]
  saving: boolean
}

export type SourceActions = Pick<V2CanvasState, 'appendTransformationSources' | 'beginSourcePicker' | 'toggleSourcePickerCard' | 'cancelSourcePicker' | 'confirmSourcePicker'>

export function createSourceSlice({ get, contextFor, setForBoard, setNoticeForBoard }: Pick<CanvasStoreContext, 'get' | 'contextFor' | 'setForBoard' | 'setNoticeForBoard'>): SourceActions {
  return {
    async appendTransformationSources(transformationId, cardIds) {
      const { board } = get()
      const step = board?.transformations.find(item => item.id === transformationId)
      if (!board || !step) return false
      const sourceCardIds = appendedSources(step, cardIds)
      if (sourceCardIds.length === step.sourceCardIds.length) {
        setNoticeForBoard(contextFor(board.id), 'info', '该卡片已是来源。')
        return true
      }
      return get().updateTransformation(transformationId, { sourceCardIds })
    },
    beginSourcePicker(transformationId) {
      const { board, runs, workflowDraft, branchDraft } = get()
      const step = board?.transformations.find(item => item.id === transformationId)
      if (!board || !step) return
      const context = contextFor(board.id)
      const blocked = sourceEditBlock(board, step, runs)
      if (blocked || workflowDraft || branchDraft) {
        setNoticeForBoard(context, 'attention', blocked || '请先完成或取消当前步骤草稿。')
        return
      }
      get().openDrawer(null)
      setForBoard(context, { sourcePicker: { transformationId, baseUpdatedAt: step.updatedAt, cardIds: [], saving: false } })
    },
    toggleSourcePickerCard(cardId) {
      const { board, sourcePicker, runs } = get()
      const step = board?.transformations.find(item => item.id === sourcePicker?.transformationId)
      if (!board || !sourcePicker || !step || sourcePicker.saving) return
      const context = contextFor(board.id)
      if (sourcePicker.cardIds.includes(cardId)) {
        setForBoard(context, { sourcePicker: { ...sourcePicker, cardIds: sourcePicker.cardIds.filter(id => id !== cardId) } })
        return
      }
      const error = sourceEditBlock(board, step, runs) || sourceListError(board, step, appendedSources(step, [cardId]))
      if (error || step.sourceCardIds.includes(cardId)) {
        setNoticeForBoard(context, 'attention', error || '该卡片已是来源。')
        return
      }
      setForBoard(context, { sourcePicker: { ...sourcePicker, cardIds: [...sourcePicker.cardIds, cardId] } })
    },
    cancelSourcePicker() {
      const { boardId, sourcePicker, drawer, panel } = get()
      if (!boardId || !sourcePicker) return
      setForBoard(contextFor(boardId), { sourcePicker: null })
      if (!drawer && !panel) get().openDrawer({ tab: 'relation', transformationId: sourcePicker.transformationId })
    },
    async confirmSourcePicker() {
      const { board, sourcePicker } = get()
      const step = board?.transformations.find(item => item.id === sourcePicker?.transformationId)
      if (!board || !step || !sourcePicker || sourcePicker.saving || !sourcePicker.cardIds.length) return
      const context = contextFor(board.id)
      const savingPicker = { ...sourcePicker, saving: true }
      setForBoard(context, { sourcePicker: savingPicker })
      const saved = await get().updateTransformation(step.id, {
        sourceCardIds: appendedSources(step, sourcePicker.cardIds),
      }, sourcePicker.baseUpdatedAt)
      if (get().sourcePicker !== savingPicker) return
      if (saved) get().cancelSourcePicker()
      else setForBoard(context, { sourcePicker: { ...sourcePicker, saving: false } })
    },
  }
}
