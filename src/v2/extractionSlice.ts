import type { ExtractionItem } from '../domain/extraction.js'
import { extractionInstruction } from '../domain/extraction.js'
import { v2Api } from '../v2Api'
import { targetPositionForSelection } from '../v2State'
import type { CanvasStoreContext } from './storeContext'
import { resolveAsyncDetailSurface, userFacingStoreError } from './storePolicy'

export type SplitStatus = 'created' | 'failed' | 'uncertain' | 'cancelled'
export interface ExtractionActions {
  reviseExtractionCard(cardId: string, baseVersionId: string, source: { cardId: string; versionId: string; itemIds: string[] }, markdown: string): Promise<SplitStatus>
  createExtractionStep(cardId: string, baseVersionId: string, requirement: string): Promise<SplitStatus>
  splitExtraction(cardId: string, baseVersionId: string, items: ExtractionItem[]): Promise<SplitStatus>
  reviewExtractionBoard(): Promise<boolean>
  allowNewExtractionRequest(cardId: string, baseVersionId: string): void
}

export function createExtractionSlice(context: CanvasStoreContext): ExtractionActions {
  const { get, contextFor, contextIsCurrent, setForBoard, project, currentDetailSurface, noticePatch, refreshBoard, historyLimit, replaceCard, recordHistory } = context
  const pending = new Set<string>()
  const uncertain = new Set<string>()
  const keyFor = (cardId: string, version: string) => JSON.stringify([get().boardId, cardId, version])
  const isUncertain = (error: unknown) => {
    const status = (error as { status?: number })?.status
    return !(status && status >= 400 && status < 500)
  }
  return {
    async reviseExtractionCard(cardId, baseVersionId, source, markdown) {
      const { boardId, board } = get()
      const before = board?.cards.find(card => card.id === cardId)?.versions.find(version => version.id === baseVersionId)
      if (!boardId || before?.content.kind !== 'markdown') return 'cancelled'
      const key = 'revision:' + keyFor(cardId, baseVersionId)
      if (uncertain.has(key)) return 'uncertain'
      if (pending.has(key)) return 'cancelled'
      pending.add(key)
      const request = contextFor(boardId)
      try {
        const result = await v2Api.reviseExtractionCard(boardId, cardId, { baseVersionId, source, markdown })
        if (!result.card?.headVersionId) throw new Error('Missing revision receipt')
        if (!contextIsCurrent(request)) return 'cancelled'
        const observed = get().board?.cards.find(card => card.id === cardId)
        const observedSequence = observed?.versions.find(version => version.id === observed.headVersionId)?.sequence || 0
        const savedSequence = result.card.versions.find(version => version.id === result.card.headVersionId)?.sequence || 0
        if (observedSequence <= savedSequence) replaceCard(request, result.card)
        if (!result.noop) recordHistory(request, { kind: 'content', boardId, cardId, before: before.content.markdown, after: markdown, beforeVersionId: baseVersionId, afterVersionId: result.card.headVersionId })
        const fileWarning = result.fileSync && !['unbound', 'synced'].includes(result.fileSync.status)
        setForBoard(request, state => noticePatch(state, fileWarning ? 'attention' : 'success',
          result.noop ? '正文相同，没有新增版本。' : fileWarning ? '旧卡已更新，本地文件尚未同步，请查看文件状态。' : '这张旧卡已更新，可使用画板撤销。', { boardId }))
        return 'created'
      } catch (error) {
        const ambiguous = isUncertain(error)
        if (ambiguous) uncertain.add(key)
        try { await refreshBoard(request) } catch {}
        setForBoard(request, state => noticePatch(state, 'error', ambiguous ? '更新结果待核对。请检查旧卡当前版本，草稿已保留。' : userFacingStoreError(error), { boardId }))
        return ambiguous ? 'uncertain' : 'failed'
      } finally { pending.delete(key) }
    },
    async reviewExtractionBoard() {
      const { boardId } = get()
      if (!boardId) return false
      const request = contextFor(boardId)
      try { await refreshBoard(request); return contextIsCurrent(request) } catch { return false }
    },
    allowNewExtractionRequest(cardId, version) {
      uncertain.delete(keyFor(cardId, version))
      uncertain.delete('revision:' + keyFor(cardId, version))
    },
    async createExtractionStep(cardId, baseVersionId, requirement) {
      const { boardId, board } = get()
      if (!boardId || !board || !requirement.trim()) return 'cancelled'
      const key = keyFor(cardId, baseVersionId)
      if (uncertain.has(key)) return 'uncertain'
      if (pending.has(key)) return 'cancelled'
      pending.add(key)
      const request = contextFor(boardId)
      const started = currentDetailSurface()
      try {
        const created = await v2Api.createTransformation(boardId, {
          sourceRefs: [{ cardId, versionId: baseVersionId }],
          label: '提取清单', instruction: extractionInstruction(requirement),
          acceptance: '条目符合用户要求、数量随内容确定，保留可核对依据；条目格式完整。',
          targetPosition: targetPositionForSelection(board, [cardId]),
        })
        if (!created?.targetCard?.id || !created?.transformation?.id) throw new Error('Missing extraction step receipt')
        if (!contextIsCurrent(request)) return 'cancelled'
        setForBoard(request, state => {
          if (!state.board) return {}
          const next = { ...state.board, cards: [...state.board.cards, created.targetCard], transformations: [...state.board.transformations, created.transformation] }
          return { board: next, ...project(next, state.runs, state.selectedCardIds),
            ...resolveAsyncDetailSurface(started, currentDetailSurface(state), { tab: 'relation', transformationId: created.transformation.id }, 'replace-origin'),
            ...noticePatch(state, 'success', '提取步骤已添加，点击“运行到这里”生成清单。', { boardId }) }
        })
        return 'created'
      } catch (error) {
        if (isUncertain(error)) uncertain.add(key)
        setForBoard(request, state => noticePatch(state, 'error', isUncertain(error)
          ? '步骤创建结果待核对。请刷新核对画板，再明确开始新的提取。' : userFacingStoreError(error), { boardId }))
        return isUncertain(error) ? 'uncertain' : 'failed'
      } finally { pending.delete(key) }
    },
    async splitExtraction(cardId, baseVersionId, items) {
      const { boardId, board } = get()
      if (!boardId || !board) return 'cancelled'
      const key = keyFor(cardId, baseVersionId)
      if (uncertain.has(key)) return 'uncertain'
      if (pending.has(key)) return 'cancelled'
      pending.add(key)
      const request = contextFor(boardId)
      try {
        const { cards } = await v2Api.extractCards(boardId, cardId, { baseVersionId, items })
        if (!Array.isArray(cards) || cards.length !== items.length || cards.some(card => !card.id)) throw new Error('Missing split receipt')
        if (!contextIsCurrent(request)) return 'cancelled'
        setForBoard(request, state => {
          if (!state.board) return {}
          const ids = new Set(cards.map(card => card.id))
          const next = { ...state.board, cards: [...state.board.cards.filter(card => !ids.has(card.id)), ...cards] }
          const selectedCardIds = cards.map(card => card.id)
          return { board: next, selectedCardIds, ...project(next, state.runs, selectedCardIds),
            historyPast: [...state.historyPast, { kind: 'create' as const, boardId, cardIds: cards.map(card => card.id) }].slice(-historyLimit), historyFuture: [],
            ...noticePatch(state, 'success', `已创建 ${cards.length} 张卡片，可使用画板撤销。`, { boardId }) }
        })
        return 'created'
      } catch (error) {
        const ambiguous = isUncertain(error)
        if (ambiguous) uncertain.add(key)
        setForBoard(request, state => noticePatch(state, 'error', ambiguous
          ? '建卡结果待核对，已阻止直接重试。请检查画板中的已有批次。' : userFacingStoreError(error), { boardId }))
        return ambiguous ? 'uncertain' : 'failed'
      } finally { pending.delete(key) }
    },
  }
}
