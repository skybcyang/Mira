import { applyEdgeChanges, applyNodeChanges, type NodeChange } from '@xyflow/react'
import type { CanvasGroup, ContentCard } from '../domain'
import { groupPasteInputs, projectGroupFrames, reverseOrganization } from './canvasOrganization'
import {
  cardSelectionDeleteBlocker,
  copyCards,
  pastedCardInputs,
  type CanvasClipboard,
} from '../canvasOperations'
import { canvasDragAlignment, type CanvasAlignmentGuide } from '../canvasAlignment'
import { v2Api } from '../v2Api'
import { orderedSelection } from '../v2State'
import {
  isPermanentCanvasHistoryError,
  transitionDetailSurface,
  userFacingStoreError as safeMessage,
} from './storePolicy'
import type { V2CanvasState, CanvasHistoryEntry } from './storeTypes'
import type { CanvasStoreContext } from './storeContext'
import { HISTORY_LIMIT } from './storeContext'

const TRANSFORMATION_NODE_PREFIX = 'transformation-node:'

type CanvasSliceDependencies = Pick<
  CanvasStoreContext,
  | 'set'
  | 'get'
  | 'contextFor'
  | 'setForBoard'
  | 'setNoticeForBoard'
  | 'noticePatch'
  | 'project'
  | 'currentDetailSurface'
>

type CanvasSliceActions = Pick<
  V2CanvasState,
  | 'copySelectedCards'
  | 'pasteCards'
  | 'duplicateSelectedCards'
  | 'requestDeleteSelectedCards'
  | 'cancelDeleteSelectedCards'
  | 'confirmDeleteSelectedCards'
  | 'undo'
  | 'redo'
  | 'selectAllCards'
  | 'clearSelection'
  | 'clearClipboard'
  | 'toggleMultiSelectMode'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'reorderSources'
  | 'removeSource'
  | 'setSelectedCardIds'
  | 'beginBranch'
  | 'cancelBranch'
>

export function createCanvasSlice(
  context: CanvasSliceDependencies,
): CanvasSliceActions {
  const {
    set,
    get,
    contextFor,
    setForBoard,
    setNoticeForBoard,
    noticePatch,
    project,
    currentDetailSurface,
  } = context
  let movementGeneration = 0

  let transformationMovementGeneration = 0

  async function persistCardGeometry(
    boardId: string,
    updates: Array<{ cardId: string; x: number; y: number }>,
    history?: Extract<CanvasHistoryEntry, { kind: 'move' }>,
  ) {
    if (updates.length === 0) return
    const context = contextFor(boardId)
    const requestGeneration = ++movementGeneration
    setForBoard(context, { saveState: 'saving', message: null })
    try {
      const { cards } = await v2Api.updateCards(boardId, { updates })
      setForBoard(context, (state) => {
        if (!state.board || requestGeneration !== movementGeneration) return {}
        const updated = new Map(cards.map((card) => [card.id, card]))
        const board = {
          ...state.board,
          cards: state.board.cards.map((card) => updated.get(card.id) || card),
        }
        return {
          board,
          ...project(board, state.runs, state.selectedCardIds),
          saveState: 'saved',
          ...(history ? {
            historyPast: [...state.historyPast, history].slice(-HISTORY_LIMIT),
            historyFuture: [],
          } : {}),
        }
      })
    } catch (error) {
      setForBoard(context, (state) => {
        if (!state.board || requestGeneration !== movementGeneration) return {}
        return {
          ...project(state.board, state.runs, state.selectedCardIds),
          saveState: 'error',
          ...noticePatch(
            state,
            'error',
            `位置未保存，已恢复到上次状态。${safeMessage(error)}`,
            { boardId },
          ),
        }
      })
    }
  }

  async function persistTransformationGeometry(
    boardId: string,
    transformationId: string,
    position: { x: number; y: number },
  ) {
    const context = contextFor(boardId)
    const requestGeneration = ++transformationMovementGeneration
    setForBoard(context, { saveState: 'saving', message: null })
    try {
      const { transformation } = await v2Api.updateTransformationPosition(
        boardId,
        transformationId,
        position,
      )
      setForBoard(context, (state) => {
        if (!state.board || requestGeneration !== transformationMovementGeneration) return {}
        const board = {
          ...state.board,
          transformations: state.board.transformations.map((item) =>
            item.id === transformation.id ? transformation : item,
          ),
        }
        return {
          board,
          ...project(board, state.runs, state.selectedCardIds),
          saveState: 'saved',
        }
      })
    } catch (error) {
      setForBoard(context, (state) => {
        if (!state.board || requestGeneration !== transformationMovementGeneration) return {}
        return {
          ...project(state.board, state.runs, state.selectedCardIds),
          saveState: 'error',
          ...noticePatch(
            state,
            'error',
            `位置未保存，已恢复到上次状态。${safeMessage(error)}`,
            { boardId },
          ),
        }
      })
    }
  }

  async function createClipboardCards(
    clipboard: CanvasClipboard,
    anchor: { x: number; y: number },
    incrementClipboard: boolean,
  ) {
    if (get().organizationPending || get().historyState === 'applying') return
    const boardId = get().boardId
    if (!boardId || clipboard.items.length === 0) return
    const context = contextFor(boardId)
    setForBoard(context, { saveState: 'saving', message: null })
    try {
      const { cards, groups } = await v2Api.createCards(boardId, {
        cards: get().board && clipboard.group ? groupPasteInputs(get().board!, clipboard, anchor) : pastedCardInputs(clipboard, anchor),
        ...(clipboard.group ? { group: clipboard.group } : {}),
      })
      setForBoard(context, (state) => {
        if (!state.board) return {}
        const board = { ...state.board, cards: [...state.board.cards, ...cards], ...(groups ? { groups } : {}) }
        const selectedCardIds = cards.map((card) => card.id)
        return {
          board,
          ...project(board, state.runs, selectedCardIds),
          selectedCardIds,
          clipboard: incrementClipboard && state.clipboard === clipboard
            ? { ...clipboard, pasteCount: clipboard.pasteCount + 1 }
            : state.clipboard,
          deleteConfirmationIds: null,
          editingCardId: null,
          suggestions: [],
          suggestionState: 'idle',
          saveState: 'saved',
          historyPast: [
            ...state.historyPast,
            { kind: 'create' as const, boardId, cardIds: cards.map((card) => card.id) },
          ].slice(-HISTORY_LIMIT),
          historyFuture: [],
        }
      })
    } catch (error) {
      setForBoard(context, (state) => ({
        saveState: 'error',
        ...noticePatch(state, 'error', safeMessage(error), { boardId }),
      }))
    }
  }

  async function replayHistory(direction: 'undo' | 'redo') {
    const state = get()
    if (!state.boardId || !state.board || state.historyState === 'applying' || state.organizationPending || state.saveState === 'saving') return
    const stack = direction === 'undo' ? state.historyPast : state.historyFuture
    const entry = stack[stack.length - 1]
    if (!entry || entry.boardId !== state.boardId) return
    const boardId = state.boardId
    const context = contextFor(boardId)
    setForBoard(context, { historyState: 'applying', saveState: 'saving', message: null })

    try {
      if (entry.kind === 'organization') {
        const request = direction === 'undo' ? reverseOrganization(entry.request) : entry.request
        const saved = await get().submitOrganization(request, true)
        if (!saved) { setForBoard(context, { historyState: 'idle' }); return }
        setForBoard(context, (current) => {
          const active = direction === 'undo' ? current.historyPast : current.historyFuture
          if (active[active.length - 1] !== entry) return {
            historyPast: current.historyPast.filter((item) => item !== entry),
            historyFuture: current.historyFuture.filter((item) => item !== entry),
            historyState: 'idle',
          }
          return {
          historyPast: direction === 'undo' ? current.historyPast.slice(0, -1) : [...current.historyPast, entry].slice(-HISTORY_LIMIT),
          historyFuture: direction === 'undo' ? [...current.historyFuture, entry].slice(-HISTORY_LIMIT) : current.historyFuture.slice(0, -1),
          historyState: 'idle',
        }})
        return
      }
      let mode: 'merge' | 'add' | 'remove'
      let groups: CanvasGroup[] | undefined
      let cards: ContentCard[] = []
      let cardIds: string[] = []
      let replayedEntry = entry

      if (entry.kind === 'move') {
        const updates = direction === 'undo' ? entry.before : entry.after
        cards = (await v2Api.updateCards(boardId, { updates })).cards
        mode = 'merge'
      } else if (entry.kind === 'content') {
        const currentCard = get().board?.cards.find((card) => card.id === entry.cardId)
        if (!currentCard || currentCard.contentKind !== 'markdown') {
          throw new Error('这张卡已不在当前画板中。')
        }
        const markdown = direction === 'undo' ? entry.before : entry.after
        cards = [(await v2Api.commitVersion(boardId, entry.cardId, {
          baseVersionId: currentCard.headVersionId,
          markdown,
        })).card]
        mode = 'merge'
      } else {
        const shouldRemove = (entry.kind === 'create' && direction === 'undo')
          || (entry.kind === 'delete' && direction === 'redo')
        cardIds = entry.cardIds
        if (shouldRemove) {
          const deletion = await v2Api.deleteCards(boardId, { cardIds })
          groups = deletion.groups
          replayedEntry = { ...entry, restoreReceiptId: deletion.restoreReceiptId }
          mode = 'remove'
        } else {
          if (!entry.restoreReceiptId) {
            throw Object.assign(new Error('删除回执已失效'), {
              code: 'CARD_RESTORE_CONFLICT',
            })
          }
          const restored = await v2Api.restoreCards(boardId, {
            restoreReceiptId: entry.restoreReceiptId,
          })
          cards = restored.cards
          groups = restored.groups
          mode = 'add'
        }
      }

      setForBoard(context, (current) => {
        if (!current.board) return { historyState: 'idle', saveState: 'saved' }
        const activeStack = direction === 'undo' ? current.historyPast : current.historyFuture
        if (activeStack[activeStack.length - 1] !== entry) {
          return { historyState: 'idle', saveState: 'saved' }
        }
        const changed = new Map(cards.map((card) => [card.id, card]))
        const removed = new Set(cardIds)
        const nextCards = mode === 'merge'
          ? current.board.cards.map((card) => changed.get(card.id) || card)
          : mode === 'add'
            ? [...current.board.cards, ...cards]
            : current.board.cards.filter((card) => !removed.has(card.id))
        const board = { ...current.board, cards: nextCards, ...(groups ? { groups } : {}) }
        const selectedCardIds = mode === 'add'
          ? cards.map((card) => card.id)
          : current.selectedCardIds.filter((cardId) => !removed.has(cardId))
        const drawer = current.drawer
          && 'cardId' in current.drawer
          && removed.has(current.drawer.cardId)
          ? null
          : current.drawer
        return {
          board,
          ...project(board, current.runs, selectedCardIds),
          selectedCardIds,
          ...transitionDetailSurface(currentDetailSurface(current), drawer, current.panel),
          editingCardId: removed.has(current.editingCardId || '') ? null : current.editingCardId,
          deleteConfirmationIds: null,
          historyPast: direction === 'undo'
            ? current.historyPast.slice(0, -1)
            : [...current.historyPast, replayedEntry].slice(-HISTORY_LIMIT),
          historyFuture: direction === 'undo'
            ? [...current.historyFuture, replayedEntry].slice(-HISTORY_LIMIT)
            : current.historyFuture.slice(0, -1),
          historyState: 'idle',
          saveState: 'saved',
          ...noticePatch(
            current,
            'success',
            direction === 'undo' ? '已撤销上一步操作。' : '已重做上一步操作。',
            { boardId: context.boardId },
          ),
        }
      })
    } catch (error) {
      if (isPermanentCanvasHistoryError(error)) {
        setForBoard(context, (current) => {
          const activeStack = direction === 'undo' ? current.historyPast : current.historyFuture
          if (activeStack[activeStack.length - 1] !== entry) {
            return { historyState: 'idle', saveState: 'saved' }
          }
          return {
            historyPast: direction === 'undo'
              ? current.historyPast.slice(0, -1)
              : current.historyPast,
            historyFuture: direction === 'redo'
              ? current.historyFuture.slice(0, -1)
              : current.historyFuture,
            historyState: 'idle',
            saveState: 'saved',
            ...noticePatch(current, 'error', (error as { code?: string }).code === 'ORGANIZATION_CONFLICT'
              ? '这次整理记录已失效，已从历史移除；可继续操作更早记录。'
              : safeMessage(error), { boardId: context.boardId }),
          }
        })
        return
      }
      setForBoard(context, (state) => ({
        historyState: 'idle',
        saveState: 'error',
        ...noticePatch(state, 'error', safeMessage(error), { boardId: context.boardId }),
      }))
    }
  }

  return {
    copySelectedCards() {
      const { board, selectedCardIds } = get()
      if (!board || selectedCardIds.length === 0) return
      const clipboard = copyCards(board, selectedCardIds)
      if (!clipboard) return
      set((state) => ({
        clipboard,
        deleteConfirmationIds: null,
        ...noticePatch(
          state,
          'success',
          `已复制 ${clipboard.items.length} 张卡片。`,
          state.boardId ? { boardId: state.boardId } : {},
        ),
      }))
    },

    async pasteCards(position) {
      const clipboard = get().clipboard
      if (!clipboard) return
      await createClipboardCards(clipboard, position, true)
    },

    async duplicateSelectedCards() {
      const { board, selectedCardIds } = get()
      if (!board || selectedCardIds.length === 0) return
      const clipboard = copyCards(board, selectedCardIds)
      const selectedCards = selectedCardIds.flatMap((cardId) => {
        const card = board.cards.find((item) => item.id === cardId)
        return card ? [card] : []
      })
      if (!clipboard || selectedCards.length === 0) return
      const left = Math.min(...selectedCards.map((card) => card.x))
      const right = Math.max(...selectedCards.map((card) => card.x + card.width))
      const top = Math.min(...selectedCards.map((card) => card.y))
      const bottom = Math.max(...selectedCards.map((card) => card.y + card.height))
      await createClipboardCards(
        { ...clipboard, pasteCount: 1 },
        { x: (left + right) / 2, y: (top + bottom) / 2 },
        false,
      )
    },

    requestDeleteSelectedCards() {
      const { board, selectedCardIds } = get()
      if (!board || selectedCardIds.length === 0) return
      const blocker = cardSelectionDeleteBlocker(board, selectedCardIds)
      if (blocker) {
        set((state) => ({
          deleteConfirmationIds: null,
          ...noticePatch(
            state,
            'attention',
            '所选卡片中有卡片属于已有转化，请先删除相关转化。',
            state.boardId ? { boardId: state.boardId } : {},
          ),
        }))
        return
      }
      set({ deleteConfirmationIds: [...selectedCardIds], message: null })
    },

    cancelDeleteSelectedCards() {
      set({ deleteConfirmationIds: null })
    },

    async confirmDeleteSelectedCards() {
      if (get().organizationPending || get().historyState === 'applying') return
      const { boardId, deleteConfirmationIds } = get()
      if (!boardId || !deleteConfirmationIds?.length) return
      const context = contextFor(boardId)
      const cardIds = [...deleteConfirmationIds]
      const deletedCards = get().board?.cards
        .filter((card) => cardIds.includes(card.id))
        .map((card) => structuredClone(card)) || []
      setForBoard(context, { saveState: 'saving' })
      try {
        const deletion = await v2Api.deleteCards(boardId, { cardIds })
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const removed = new Set(cardIds)
          const board = {
            ...state.board,
            cards: state.board.cards.filter((card) => !removed.has(card.id)),
            ...(deletion.groups ? { groups: deletion.groups } : {}),
          }
          const message = `已删除 ${cardIds.length} 张卡片。`
          return {
            board,
            ...project(board, state.runs, []),
            selectedCardIds: [],
            deleteConfirmationIds: null,
            multiSelectMode: false,
            editingCardId: removed.has(state.editingCardId || '') ? null : state.editingCardId,
            suggestions: [],
            suggestionState: 'idle',
            saveState: 'saved',
            ...noticePatch(state, 'success', message, { boardId }),
            historyPast: [
              ...state.historyPast,
              {
                kind: 'delete' as const,
                boardId,
                cardIds: deletedCards.map((card) => card.id),
                restoreReceiptId: deletion.restoreReceiptId,
              },
            ].slice(-HISTORY_LIMIT),
            historyFuture: [],
          }
        })
      } catch (error) {
        setForBoard(context, (state) => ({
          deleteConfirmationIds: null,
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
      }
    },

    async undo() {
      await replayHistory('undo')
    },

    async redo() {
      await replayHistory('redo')
    },

    selectAllCards() {
      const cardIds = get().board?.cards.map((card) => card.id) || []
      get().setSelectedCardIds(cardIds)
    },

    clearSelection() {
      set((state) => ({
        selectedGroupId: null,
        selectedCardIds: [],
        nodes: state.nodes.map((node) => ({ ...node, selected: false })),
        deleteConfirmationIds: null,
        branchDraft: null,
        suggestions: [],
        suggestionState: 'idle',
      }))
    },

    clearClipboard() {
      set({ clipboard: null })
    },

    toggleMultiSelectMode() {
      set((state) => ({
        multiSelectMode: !state.multiSelectMode,
        deleteConfirmationIds: null,
      }))
    },

    onNodesChange(changes) {
      if (get().sourcePicker) changes = changes.filter(change => change.type === 'dimensions')
      if (get().organizationPending || get().historyState === 'applying') {
        changes = changes.filter((change) => change.type === 'dimensions')
        if (!changes.length) return
      }
      if (get().handleGroupChanges(changes)) return
      const contentIds = new Set(get().board?.cards.map((card) => card.id) || [])
      const positionChanges = changes.filter(
        (change): change is Extract<NodeChange, { type: 'position' }> =>
          change.type === 'position' && Boolean(change.position),
      )
      const draggedCardChanges = positionChanges.filter((change) => contentIds.has(change.id))
      let appliedChanges = changes
      let alignmentGuides: CanvasAlignmentGuide[] | null | undefined
      if (draggedCardChanges.length === 1) {
        const change = draggedCardChanges[0]
        const card = get().board?.cards.find((item) => item.id === change.id)
        if (card && change.position) {
          const others = (get().board?.cards || [])
            .filter((item) => item.id !== change.id)
            .map(({ x, y, width, height }) => ({ x, y, width, height }))
          const alignment = canvasDragAlignment(
            { x: change.position.x, y: change.position.y, width: card.width, height: card.height },
            others,
          )
          appliedChanges = changes.map((item) => item === change
            ? { ...item, position: { x: alignment.x, y: alignment.y } }
            : item)
          alignmentGuides = change.dragging && alignment.guides.length > 0
            ? alignment.guides
            : null
        }
      } else if (positionChanges.length > 0) {
        alignmentGuides = null
      }
      const selectedCardIds = orderedSelection(get().selectedCardIds, changes, contentIds)
      set((state) => {
        const updatedNodes = applyNodeChanges(appliedChanges, state.nodes).filter((node) => node.type !== 'canvasGroup')
        return {
        nodes: [...projectGroupFrames(state.board?.groups || [], updatedNodes, selectedCardIds.length ? null : state.selectedGroupId), ...updatedNodes],
        selectedGroupId: selectedCardIds.length ? null : state.selectedGroupId,
        ...(alignmentGuides !== undefined ? { alignmentGuides } : {}),
        selectedCardIds,
        deleteConfirmationIds:
          selectedCardIds.join('|') === state.selectedCardIds.join('|')
            ? state.deleteConfirmationIds
            : null,
        suggestions:
          selectedCardIds.join('|') === state.selectedCardIds.join('|')
            ? state.suggestions
            : [],
        suggestionState:
          selectedCardIds.join('|') === state.selectedCardIds.join('|')
            ? state.suggestionState
            : 'idle',
      }})
      const completedMoves = appliedChanges.filter(
        (change): change is Extract<NodeChange, { type: 'position' }> =>
          change.type === 'position' && change.dragging === false && Boolean(change.position),
      )
      const { boardId } = get()
      if (!boardId || completedMoves.length === 0) return
      for (const change of completedMoves) {
        if (!change.id.startsWith(TRANSFORMATION_NODE_PREFIX)) continue
        const transformationId = change.id.slice(TRANSFORMATION_NODE_PREFIX.length)
        const node = get().nodes.find((item) => item.id === change.id)
        if (!transformationId || !node) continue
        void persistTransformationGeometry(boardId, transformationId, {
          x: node.position.x,
          y: node.position.y,
        })
      }
      const updates = completedMoves.flatMap((change) => {
        const node = get().nodes.find((item) => item.id === change.id)
        return node && contentIds.has(change.id)
          ? [{ cardId: change.id, x: node.position.x, y: node.position.y }]
          : []
      })
      const before = updates.flatMap((update) => {
        const card = get().board?.cards.find((item) => item.id === update.cardId)
        return card && (card.x !== update.x || card.y !== update.y)
          ? [{ cardId: card.id, x: card.x, y: card.y }]
          : []
      })
      if (before.length === 0) return
      const movedIds = new Set(before.map((item) => item.cardId))
      const after = updates.filter((item) => movedIds.has(item.cardId))
      void persistCardGeometry(boardId, after, { kind: 'move', boardId, before, after })
    },

    onEdgesChange(changes) {
      set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }))
    },

    async onConnect(connection) {
      const { boardId, board } = get()
      if (!boardId || !connection.source || !connection.target) return
      if (connection.target.startsWith('workflow-draft-step:')
        && connection.targetHandle?.startsWith('workflow-input:')
        && board?.cards.some((card) => card.id === connection.source)) {
        get().bindWorkflowInput(
          connection.targetHandle.slice('workflow-input:'.length),
          [connection.source],
        )
        return
      }
      if (connection.target.startsWith('transformation-node:') && !connection.source.startsWith('transformation-node:')) {
        await get().appendTransformationSources(connection.target.slice('transformation-node:'.length), [connection.source])
        return
      }
      const context = contextFor(boardId)
      setNoticeForBoard(context, 'attention', '卡片之间不创建普通关系；请拖到空白处发起新转化。')
    },

    reorderSources(fromIndex, toIndex) {
      set((state) => {
        const next = [...state.selectedCardIds]
        const [item] = next.splice(fromIndex, 1)
        if (item) next.splice(toIndex, 0, item)
        return {
          selectedCardIds: next,
          branchDraft: state.branchDraft ? { ...state.branchDraft, sourceCardIds: next } : null,
          suggestions: [],
          suggestionState: 'idle',
        }
      })
    },

    removeSource(cardId) {
      set((state) => {
        const selectedCardIds = state.selectedCardIds.filter((id) => id !== cardId)
        return {
        selectedCardIds,
        nodes: state.nodes.map((node) =>
          node.id === cardId ? { ...node, selected: false } : node,
        ),
        branchDraft: state.branchDraft && selectedCardIds.length > 0
          ? { ...state.branchDraft, sourceCardIds: selectedCardIds }
          : null,
        suggestions: [],
        suggestionState: 'idle',
        deleteConfirmationIds: null,
      }})
    },

    setSelectedCardIds(cardIds) {
      const unique = [...new Set(cardIds)]
      set((state) => ({
        selectedGroupId: null,
        selectedCardIds: unique,
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: unique.includes(node.id),
        })),
        suggestions: [],
        suggestionState: 'idle',
        deleteConfirmationIds: null,
      }))
    },

    beginBranch(branchDraft) {
      set((state) => ({
        branchDraft,
        selectedCardIds: branchDraft.sourceCardIds,
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: branchDraft.sourceCardIds.includes(node.id),
        })),
        multiSelectMode: false,
        deleteConfirmationIds: null,
        suggestions: [],
        suggestionState: 'idle',
      }))
    },

    cancelBranch() {
      set({ branchDraft: null })
    },
  }
}
