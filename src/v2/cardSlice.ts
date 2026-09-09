import type { ContentCard } from '../domain'
import { v2Api } from '../v2Api'
import { collisionFreeCanvasCardPosition } from '../canvasOperations'
import {
  type DetailSurfaceSnapshot,
  resolveAsyncDetailSurface,
  userFacingStoreError as safeMessage,
} from './storePolicy'
import type { V2CanvasState } from './storeTypes'
import type { CanvasStoreContext } from './storeContext'
import type { BoardRequestContext } from './storeContext'
import { HISTORY_LIMIT } from './storeContext'

interface CreateCardNavigationRequest {
  context: BoardRequestContext
  startedDetailSurface: DetailSurfaceSnapshot
  cardId?: string
}

type CardSliceDependencies = Pick<
  CanvasStoreContext,
  | 'set'
  | 'get'
  | 'contextFor'
  | 'contextIsCurrent'
  | 'setForBoard'
  | 'setNoticeForBoard'
  | 'noticePatch'
  | 'project'
  | 'currentDetailSurface'
  | 'replaceCard'
  | 'recordHistory'
>

type CardSliceActions = Pick<
  V2CanvasState,
  | 'createCard'
  | 'createFileCard'
  | 'bindCardFile'
  | 'unbindCardFile'
  | 'syncCardFile'
  | 'refreshCardFileBinding'
  | 'updateCardTags'
  | 'renameCard'
  | 'commitCard'
  | 'saveAndCreateNext'
  | 'restoreVersion'
  | 'setEditingCardId'
>

export function createCardSlice(
  context: CardSliceDependencies,
): CardSliceActions {
  const {
    set,
    get,
    contextFor,
    contextIsCurrent,
    setForBoard,
    setNoticeForBoard,
    noticePatch,
    project,
    currentDetailSurface,
    replaceCard: replaceStoredCard,
    recordHistory,
  } = context
  let createCardRequestSequence = 0

  let resolvedCreateCardNavigationThrough = 0

  const createCardNavigationRequests = new Map<number, CreateCardNavigationRequest>()
  let recordingPending = false
  const committingCards = new Set<string>()
  const renamingCards = new Set<string>()

  function replaceCard(request: BoardRequestContext, incoming: ContentCard) {
    // Body, tag and file commands do not own names. A late receipt must not undo a rename.
    const current = get().board?.cards.find(card => card.id === incoming.id)
    const next = { ...incoming }
    if (current?.name === undefined) delete next.name
    else next.name = current.name
    replaceStoredCard(request, next)
  }

  function upsertCard(cards: ContentCard[], card: ContentCard): ContentCard[] {
    return cards.some((item) => item.id === card.id)
      ? cards.map((item) => item.id === card.id ? card : item)
      : [...cards, card]
  }

  function settleCreateCardNavigation() {
    const next = [...createCardNavigationRequests.entries()]
      .filter(([requestId]) => requestId > resolvedCreateCardNavigationThrough)
      .sort(([left], [right]) => right - left)[0]
    if (!next) return
    const [requestId, request] = next
    if (!request.cardId) return
    resolvedCreateCardNavigationThrough = requestId
    for (const candidateId of createCardNavigationRequests.keys()) {
      if (candidateId <= requestId) createCardNavigationRequests.delete(candidateId)
    }
    setForBoard(request.context, (state) => {
      if (!state.board) return {}
      const currentSurface = currentDetailSurface(state)
      const nextSurface = resolveAsyncDetailSurface(
        request.startedDetailSurface,
        currentSurface,
        { tab: 'content', cardId: request.cardId!, mode: 'edit' },
      )
      if (nextSurface === currentSurface) return {}
      const selectedCardIds = [request.cardId!]
      return {
        ...project(state.board, state.runs, selectedCardIds),
        selectedCardIds,
        ...nextSurface,
        editingCardId: null,
      }
    })
  }

  return {
    async renameCard(cardId, name, baseName) {
      const { boardId, board } = get()
      if (!boardId || !board?.cards.some((card) => card.id === cardId)) return false
      const request = contextFor(boardId)
      const key = `${boardId}\u0000${cardId}`
      const operationId = `card-name:${cardId}`
      if (renamingCards.has(key)) return false
      renamingCards.add(key)
      const mergeName = (incoming: ContentCard) => setForBoard(request, (state) => {
        if (!state.board) return {}
        const board = { ...state.board, cards: state.board.cards.map((card) => {
          if (card.id !== cardId || (card.name ?? null) !== baseName) return card
          const next = { ...card }
          if (incoming.name === undefined) delete next.name
          else next.name = incoming.name
          return next
        }) }
        return { board, ...project(board, state.runs, state.selectedCardIds) }
      })
      setForBoard(request, (state) => ({ saveState: 'saving', notices: state.notices.filter(notice => notice.boardId !== boardId || notice.operationId !== operationId) }))
      try {
        const { card } = await v2Api.updateCard(boardId, cardId, { name, baseName })
        if (!contextIsCurrent(request)) return false
        mergeName(card)
        setForBoard(request, { saveState: 'saved', message: null })
        return true
      } catch (error) {
        if ((error as { code?: string }).code === 'CARD_NAME_CONFLICT') {
          try {
            const { board } = await v2Api.getBoard(boardId)
            const latest = board.cards.find((card) => card.id === cardId)
            if (latest) mergeName(latest)
          } catch { /* Keep the draft and its baseline when reload fails. */ }
        }
        setForBoard(request, (state) => ({ saveState: 'error', ...noticePatch(state, 'error', safeMessage(error), { boardId, operationId }) }))
        return false
      } finally {
        renamingCards.delete(key)
      }
    },

    async createCard(position) {
      const boardId = get().boardId
      if (!boardId) return null
      const context = contextFor(boardId)
      const requestId = createCardRequestSequence += 1
      const startedDetailSurface = currentDetailSurface()
      createCardNavigationRequests.set(requestId, { context, startedDetailSurface })
      try {
        const { card } = await v2Api.createCard(boardId, { ...position, markdown: '' })
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const board = { ...state.board, cards: upsertCard(state.board.cards, card) }
          return {
            board,
            ...project(board, state.runs, state.selectedCardIds),
          }
        })
        const navigationRequest = createCardNavigationRequests.get(requestId)
        if (navigationRequest) navigationRequest.cardId = card.id
        settleCreateCardNavigation()
        return card
      } catch (error) {
        createCardNavigationRequests.delete(requestId)
        settleCreateCardNavigation()
        setNoticeForBoard(context, 'error', safeMessage(error))
        return null
      }
    },

    async createFileCard(position, path) {
      const boardId = get().boardId
      if (!boardId || !path.trim()) return
      const context = contextFor(boardId)
      try {
        const { card } = await v2Api.createCard(boardId, {
          ...position,
          filePath: path.trim(),
          readonly: true,
        })
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const board = { ...state.board, cards: upsertCard(state.board.cards, card) }
          return {
            board,
            ...project(board, state.runs, [card.id]),
            selectedCardIds: [card.id],
            historyPast: [
              ...state.historyPast,
              { kind: 'create' as const, boardId, cardIds: [card.id] },
            ].slice(-HISTORY_LIMIT),
            historyFuture: [],
          }
        })
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
      }
    },

    async bindCardFile(cardId, path, overwrite = false) {
      const { boardId, board } = get()
      if (!boardId || !board?.cards.some((card) => card.id === cardId)) return false
      const context = contextFor(boardId)
      setForBoard(context, { saveState: 'saving' })
      try {
        const result = await v2Api.bindCardFile(boardId, cardId, path, overwrite)
        if (!contextIsCurrent(context)) return false
        replaceCard(context, result.card)
        setForBoard(context, { saveState: 'saved', message: null })
        return true
      } catch (error) {
        setForBoard(context, (state) => ({
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
        return false
      }
    },

    async unbindCardFile(cardId) {
      const { boardId, board } = get()
      if (!boardId || !board?.cards.some((card) => card.id === cardId)) return false
      const context = contextFor(boardId)
      try {
        const result = await v2Api.unbindCardFile(boardId, cardId)
        if (!contextIsCurrent(context)) return false
        replaceCard(context, result.card)
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },

    async syncCardFile(cardId, resolution) {
      const { boardId, board } = get()
      if (!boardId || !board?.cards.some((card) => card.id === cardId)) return false
      const context = contextFor(boardId)
      try {
        const status = await v2Api.getCardFileBinding(boardId, cardId)
        const result = await v2Api.syncCardFile(
          boardId,
          cardId,
          resolution,
          status.fileDigest,
        )
        if (!contextIsCurrent(context)) return false
        replaceCard(context, result.card)
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },

    async refreshCardFileBinding(cardId) {
      const boardId = get().boardId
      if (!boardId) return null
      try {
        return await v2Api.getCardFileBinding(boardId, cardId)
      } catch (error) {
        setNoticeForBoard(contextFor(boardId), 'error', safeMessage(error))
        return null
      }
    },

    async updateCardTags(cardId, tags) {
      const { boardId, board } = get()
      if (!boardId || !board?.cards.some((card) => card.id === cardId)) return false
      const context = contextFor(boardId)
      setForBoard(context, { saveState: 'saving', message: null })
      try {
        const { card } = await v2Api.updateCard(boardId, cardId, { tags })
        if (!contextIsCurrent(context)) return false
        replaceCard(context, card)
        setForBoard(context, { saveState: 'saved', message: null })
        return true
      } catch (error) {
        setForBoard(context, (state) => ({
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
        return false
      }
    },

    async commitCard(cardId, markdown, baseVersionId) {
      const { boardId, board } = get()
      const card = board?.cards.find((item) => item.id === cardId)
      if (!boardId || !card || card.contentKind !== 'markdown') {
        if (get().editingCardId === cardId) set({ editingCardId: null })
        return false
      }
      const context = contextFor(boardId)
      if (!contextIsCurrent(context)) return false
      const lockKey = `${context.generation}:${boardId}:${cardId}`
      if (committingCards.has(lockKey)) return false
      if (baseVersionId !== undefined && baseVersionId !== card.headVersionId) {
        setForBoard(context, (state) => ({
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage({ code: 'CARD_VERSION_CONFLICT' }), { boardId }),
        }))
        return false
      }
      const current = card.versions.find((version) => version.id === card.headVersionId)
      if (current?.content.kind === 'markdown' && current.content.markdown === markdown) {
        setForBoard(context, (state) => ({
          ...(state.editingCardId === cardId ? { editingCardId: null } : {}),
          saveState: 'saved',
        }))
        return true
      }
      committingCards.add(lockKey)
      if (!card.headVersionId && !markdown.trim()) {
        try {
          const deletion = await v2Api.deleteCard(boardId, cardId)
          setForBoard(context, (state) => {
            if (!state.board) return { editingCardId: null }
            const next = { ...state.board, cards: state.board.cards.filter((item) => item.id !== cardId), ...(deletion.groups ? { groups: deletion.groups } : {}) }
            return {
              board: next,
              ...project(next, state.runs, []),
              selectedCardIds: [],
              editingCardId: null,
            }
          })
          return contextIsCurrent(context)
        } catch (error) {
          setForBoard(context, (state) => ({
            editingCardId: null,
            ...noticePatch(state, 'error', safeMessage(error), { boardId }),
          }))
          return false
        } finally {
          committingCards.delete(lockKey)
        }
      }
      setForBoard(context, { saveState: 'saving' })
      try {
        const { card: updated } = await v2Api.commitVersion(boardId, cardId, {
          baseVersionId: baseVersionId === undefined ? card.headVersionId : baseVersionId,
          markdown,
        })
        if (!contextIsCurrent(context)) return false
        const observed = get().board?.cards.find((item) => item.id === cardId)
        const observedSequence = observed?.versions.find((version) => version.id === observed.headVersionId)?.sequence || 0
        const savedSequence = updated.versions.find((version) => version.id === updated.headVersionId)?.sequence || 0
        if (observedSequence <= savedSequence) replaceCard(context, updated)
        recordHistory(context, {
          kind: 'content',
          boardId,
          cardId,
          before: current?.content.kind === 'markdown' ? current.content.markdown : '',
          after: markdown,
        })
        setForBoard(context, (state) => ({
          ...(state.editingCardId === cardId ? { editingCardId: null } : {}),
          saveState: 'saved', message: null,
        }))
        return true
      } catch (error) {
        setForBoard(context, (state) => ({
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
        return false
      } finally {
        committingCards.delete(lockKey)
      }
    },

    async saveAndCreateNext(cardId, markdown, baseVersionId) {
      if (recordingPending) return { status: 'busy' }
      const { boardId, board } = get()
      const original = board?.cards.find((card) => card.id === cardId)
      if (!boardId || !original || original.contentKind !== 'markdown' || !markdown.trim()) {
        return { status: 'save-failed' }
      }
      const context = contextFor(boardId)
      const started = currentDetailSurface()
      const size = { width: original.width, height: original.height }
      const anchor = { x: original.x + size.width / 2, y: original.y + size.height * 1.5 + 24 }
      const intentIsCurrent = () => contextIsCurrent(context)
        && currentDetailSurface().detailSurfaceRevision === started.detailSurfaceRevision
        && currentDetailSurface().drawer === started.drawer
        && currentDetailSurface().panel === started.panel
      recordingPending = true
      try {
        const saved = await get().commitCard(cardId, markdown, baseVersionId)
        if (!contextIsCurrent(context)) return { status: 'cancelled' }
        if (!saved) return { status: 'save-failed' }
        if (!intentIsCurrent()) return { status: 'cancelled' }
        const position = collisionFreeCanvasCardPosition(anchor, get().board?.cards || [], size)
        try {
          const { card } = await v2Api.createCard(boardId, { ...position, ...size, markdown: '' })
          if (!card?.id) throw new Error('Missing card receipt')
          setForBoard(context, (state) => {
            if (!state.board) return {}
            const next = { ...state.board, cards: upsertCard(state.board.cards, card) }
            return { board: next, ...project(next, state.runs, state.selectedCardIds) }
          })
          if (!intentIsCurrent()) return { status: 'cancelled' }
          setForBoard(context, (state) => ({
            ...resolveAsyncDetailSurface(started, currentDetailSurface(state),
              { tab: 'content', cardId: card.id, mode: 'edit' }, 'replace-origin'),
            selectedCardIds: [card.id], editingCardId: null,
            ...(state.board ? project(state.board, state.runs, [card.id]) : {}),
          }))
          return { status: 'created', card }
        } catch (error) {
          const status = (error as { status?: number })?.status
          return { status: status && status >= 400 && status < 500
            ? 'creation-failed' : 'creation-uncertain' }
        }
      } finally {
        recordingPending = false
      }
    },

    async restoreVersion(cardId, versionId) {
      const { boardId, board } = get()
      const card = board?.cards.find((item) => item.id === cardId)
      if (!boardId || !card) return
      const context = contextFor(boardId)
      try {
        const result = await v2Api.restoreVersion(
          boardId,
          cardId,
          versionId,
          card.headVersionId,
        )
        replaceCard(context, result.card)
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
      }
    },

    setEditingCardId(cardId) {
      if (cardId && get().board?.cards.find((card) => card.id === cardId)?.contentKind !== 'markdown') {
        set({ editingCardId: null })
        return
      }
      set({ editingCardId: cardId })
    },
  }
}
