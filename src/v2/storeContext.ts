import type { BoardV2, ContentCard } from '../domain'
import { v2Api } from '../v2Api'
import { projectV2Board } from '../v2Projection'
import { projectGroupFrames } from './canvasOrganization'
import { projectWorkflowDraft, type WorkflowDraft } from './workflowDraft'
import { detailSurfaceSnapshot, transitionDetailSurface } from './storePolicy'
import type { V2CanvasState, CanvasHistoryEntry } from './storeTypes'
import {
  dismissNotice as dismissNoticeFromCollection,
  expireNotice as expireNoticeFromCollection,
  publishNotice as publishNoticeToCollection,
  type Notice,
  type NoticeKind,
} from './noticePolicy'
import type { StoreApi } from 'zustand'
export const HISTORY_LIMIT = 50
export interface BoardRequestContext {
  boardId: string
  generation: number
}

export function createCanvasStoreContext(
  set: StoreApi<V2CanvasState>['setState'],
  get: StoreApi<V2CanvasState>['getState'],
) {
  const navigation = { boardGeneration: 0, pendingBoardGeneration: null as number | null }
  let noticeSequence = 0

  let operationSequence = 0

  const boardWriteSequences = new Map<string, number>()

  const boardRefreshes = new Map<string, {
    generation: number
    requested: number
    accepting: boolean
    promise: Promise<void>
  }>()
  function noticePatch(
    state: V2CanvasState,
    kind: NoticeKind,
    message: string,
    scope: Pick<Notice, 'operationId' | 'boardId'> = {},
  ): Pick<V2CanvasState, 'message' | 'notices'> {
    const notice: Notice = {
      id: `notice-${noticeSequence += 1}`,
      kind,
      message,
      ...scope,
    }
    return {
      message,
      notices: [...publishNoticeToCollection(state.notices, notice)],
    }
  }

  function setNoticeForBoard(
    context: BoardRequestContext,
    kind: NoticeKind,
    message: string,
    scope: Pick<Notice, 'operationId'> = {},
  ) {
    setForBoard(context, (state) => noticePatch(state, kind, message, {
      ...scope,
      boardId: context.boardId,
    }))
  }

  function setNotice(
    kind: NoticeKind,
    message: string,
    scope: Pick<Notice, 'operationId' | 'boardId'> = {},
  ) {
    set((state) => noticePatch(state, kind, message, {
      ...(state.boardId ? { boardId: state.boardId } : {}),
      ...scope,
    }))
  }

  function noticeCollectionPatch(notices: Notice[]) {
    return { notices, message: notices[notices.length - 1]?.message ?? null }
  }

  function project(
    board: BoardV2,
    runs = get().runs,
    selectedCardIds = get().selectedCardIds,
    workflowDraft: WorkflowDraft | null = get().workflowDraft,
  ) {
    const projected = projectV2Board(board, runs)
    const workflow = workflowDraft?.definition || (workflowDraft
      ? get().workflows.find((item) => item.id === workflowDraft.workflowId)
      : undefined)
    const draftProjection = workflow && workflowDraft
      ? projectWorkflowDraft(board, workflow, workflowDraft)
      : { nodes: [], edges: [] }
    const selected = new Set(selectedCardIds)
    return {
      edges: [...projected.edges, ...draftProjection.edges],
      nodes: [...projectGroupFrames(board.groups || [], projected.nodes, get().selectedGroupId), ...projected.nodes, ...draftProjection.nodes].map((node) => ({
        ...node,
        selected: node.type === 'canvasGroup' ? node.selected : selected.has(node.id),
      })),
    }
  }

  function contextFor(boardId: string): BoardRequestContext {
    return { boardId, generation: navigation.boardGeneration }
  }

  function currentDetailSurface(state: V2CanvasState = get()) {
    return detailSurfaceSnapshot(
      state.detailSurfaceRevision,
      state.drawer,
      state.panel,
    )
  }

  function recordBoardWrite(boardId: string) {
    boardWriteSequences.set(boardId, (boardWriteSequences.get(boardId) || 0) + 1)
  }

  function contextIsCurrent(
    context: BoardRequestContext,
    state = get(),
  ): boolean {
    return navigation.pendingBoardGeneration === null
      && context.generation === navigation.boardGeneration
      && state.boardId === context.boardId
  }

  function setForBoard(
    context: BoardRequestContext,
    update:
      | Partial<V2CanvasState>
      | ((state: V2CanvasState) => Partial<V2CanvasState>),
    recordsBoardWrite = true,
  ) {
    set((state) => {
      if (!contextIsCurrent(context, state)) return {}
      const patch = typeof update === 'function' ? update(state) : update
      if (
        recordsBoardWrite
        && Object.prototype.hasOwnProperty.call(patch, 'board')
        && patch.board !== state.board
      ) {
        recordBoardWrite(context.boardId)
      }
      return patch
    })
  }

  function recordHistory(
    context: BoardRequestContext,
    entry: CanvasHistoryEntry,
  ) {
    setForBoard(context, (state) => ({
      historyPast: [...state.historyPast, entry].slice(-HISTORY_LIMIT),
      historyFuture: [],
    }))
  }

  function replaceCard(context: BoardRequestContext, card: ContentCard) {
    setForBoard(context, (state) => {
      if (!state.board) return {}
      const board = {
        ...state.board,
        cards: state.board.cards.map((item) => (item.id === card.id ? card : item)),
      }
      return { board, ...project(board, state.runs, state.selectedCardIds) }
    })
  }

  function refreshBoard(context: BoardRequestContext): Promise<void> {
    const existing = boardRefreshes.get(context.boardId)
    if (existing?.generation === context.generation && existing.accepting) {
      existing.requested += 1
      return existing.promise
    }
    const flight = {
      generation: context.generation,
      requested: 1,
      accepting: true,
      promise: Promise.resolve(),
    }
    const refreshing = (async () => {
      try {
        let completed = 0
        while (completed < flight.requested) {
          const requestedAtStart = flight.requested
          let board: BoardV2
          while (true) {
            const writeSequence = boardWriteSequences.get(context.boardId) || 0
            const result = await v2Api.getBoard(context.boardId)
            if (!contextIsCurrent(context)) return
            if (writeSequence !== (boardWriteSequences.get(context.boardId) || 0)) continue
            board = result.board
            break
          }
          setForBoard(context, (state) => ({
            board,
            ...project(board, state.runs, state.selectedCardIds),
          }), false)
          completed = requestedAtStart
        }
      } finally {
        flight.accepting = false
      }
    })()
    const tracked = refreshing.then(
      () => {
        if (boardRefreshes.get(context.boardId)?.promise === tracked) {
          boardRefreshes.delete(context.boardId)
        }
      },
      (error: unknown) => {
        if (boardRefreshes.get(context.boardId)?.promise === tracked) {
          boardRefreshes.delete(context.boardId)
        }
        throw error
      },
    )
    flight.promise = tracked
    boardRefreshes.set(context.boardId, flight)
    return tracked
  }
  const actions: Pick<V2CanvasState, 'openDrawer' | 'openPanel' | 'clearMessage' | 'dismissNotice' | 'expireNotice'> = {
    openDrawer(drawer) {
      set((state) => {
        if (drawer && state.loadState === 'loading') return {}
        return { ...transitionDetailSurface(currentDetailSurface(state), drawer, null), sourcePicker: null }
      })
    },

    openPanel(panel) {
      set((state) => ({ ...transitionDetailSurface(currentDetailSurface(state), null, panel), sourcePicker: null }))
    },

    clearMessage() {
      set({ message: null })
    },

    dismissNotice(noticeId) {
      set((state) => {
        const notices = dismissNoticeFromCollection(state.notices, noticeId)
        if (notices === state.notices) return {}
        return noticeCollectionPatch([...notices])
      })
    },

    expireNotice(noticeId, expectedNotice) {
      set((state) => {
        const expired = expireNoticeFromCollection(state.notices, noticeId, expectedNotice)
        if (expired === state.notices) return {}
        return noticeCollectionPatch([...expired])
      })
    },
  }
  return {
    set,
    get,
    navigation,
    noticePatch,
    setNoticeForBoard,
    setNotice,
    project,
    contextFor,
    currentDetailSurface,
    recordBoardWrite,
    contextIsCurrent,
    setForBoard,
    recordHistory,
    replaceCard,
    refreshBoard,
    actions,
    historyLimit: HISTORY_LIMIT,
    nextOperationSequence: () => operationSequence += 1,
    boardWriteSequence: (boardId: string) => boardWriteSequences.get(boardId) || 0,
    isBoardPending: () => navigation.pendingBoardGeneration !== null,
  }
}
export type CanvasStoreContext = ReturnType<typeof createCanvasStoreContext>
