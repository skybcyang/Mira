import { v2Api } from '../v2Api'
import type { TextSpan } from '../domain/sourceScopes.js'
import type { CanvasStoreContext } from './storeContext'
import type { SplitStatus } from './extractionSlice'
import { userFacingStoreError } from './storePolicy'

export interface MaterialActions { saveMaterial(previewId: string, spans: TextSpan[]): Promise<SplitStatus> }
export function createMaterialSlice({ get, contextFor, contextIsCurrent, setForBoard, project, historyLimit, noticePatch }: CanvasStoreContext): MaterialActions {
  const receipts = new Map<string, { fingerprint: string; state: 'pending' | 'uncertain' | 'created' }>()
  return { async saveMaterial(previewId, spans) {
    const { boardId } = get()
    if (!boardId) return 'cancelled'
    const fingerprint = JSON.stringify([boardId, spans]), prior = receipts.get(previewId)
    if (prior) return prior.fingerprint !== fingerprint ? 'failed' : prior.state === 'pending' ? 'cancelled' : prior.state
    const request = contextFor(boardId)
    receipts.set(previewId, { fingerprint, state: 'pending' })
    try {
      const { card } = await v2Api.saveMaterial(boardId, previewId, spans)
      if (!card?.id || !card.headVersionId) throw new Error('Missing material receipt')
      receipts.set(previewId, { fingerprint, state: 'created' })
      if (!contextIsCurrent(request)) return 'cancelled'
      setForBoard(request, state => {
        if (!state.board || state.board.cards.some(item => item.id === card.id)) return {}
        const board = { ...state.board, cards: [...state.board.cards, card] }
        return { board, ...project(board, state.runs, state.selectedCardIds), historyPast: [...state.historyPast, { kind: 'create' as const, boardId, cardIds: [card.id] }].slice(-historyLimit), historyFuture: [],
          ...noticePatch(state, 'success', '所选材料已保存为卡片，可使用画板撤销。', { boardId }) }
      })
      return 'created'
    } catch (error) {
      const status = (error as { status?: number })?.status
      const uncertain = !status || status >= 500
      if (uncertain) receipts.set(previewId, { fingerprint, state: 'uncertain' }); else receipts.delete(previewId)
      setForBoard(request, state => noticePatch(state, 'error', uncertain ? '保存结果待核对，请刷新画板检查。当前选择已保留，不会重复提交。' : userFacingStoreError(error), { boardId }))
      return uncertain ? 'uncertain' : 'failed'
    } finally {
      // Receipt identities are session-only; retain a bounded recent window.
      if (receipts.size > 100) for (const [id, item] of receipts) if (item.state === 'created' && id !== previewId) { receipts.delete(id); break }
    }
  } }
}
