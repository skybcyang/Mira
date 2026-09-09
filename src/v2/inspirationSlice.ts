import type { StoreApi } from 'zustand'
import type { BoardV2, ContentCard, InspirationEntry, TransformationRun } from '../domain'
import { v2Api } from '../v2Api'
import {
  mapInspirationCaptureToCardInput,
  mapInspirationPoolSelectionToSnapshotInputs,
  mapInspirationSelectionToSnapshots,
  type InspirationCapture,
  type InspirationCandidate,
} from './inspiration'
import type { Notice, NoticeKind } from './noticePolicy'
import { userFacingStoreError as safeMessage } from './storePolicy'
import type { V2CanvasState } from './storeTypes'

interface BoardRequestContext {
  boardId: string
  generation: number
}

type SetForBoard = (
  context: BoardRequestContext,
  update:
    | Partial<V2CanvasState>
    | ((state: V2CanvasState) => Partial<V2CanvasState>),
  recordsBoardWrite?: boolean,
) => void

interface InspirationSliceDependencies {
  get: StoreApi<V2CanvasState>['getState']
  contextFor(boardId: string): BoardRequestContext
  contextIsCurrent(context: BoardRequestContext, state?: V2CanvasState): boolean
  setForBoard: SetForBoard
  project(
    board: BoardV2,
    runs?: Record<string, TransformationRun>,
    selectedCardIds?: string[],
  ): Pick<V2CanvasState, 'nodes' | 'edges'>
  noticePatch(
    state: V2CanvasState,
    kind: NoticeKind,
    message: string,
    scope?: Pick<Notice, 'operationId' | 'boardId'>,
  ): Pick<V2CanvasState, 'message' | 'notices'>
  historyLimit: number
}

interface InspirationActions {
  addInspirationCards(
    selected: InspirationCandidate[],
    anchor: { x: number; y: number },
  ): Promise<string[] | undefined>
  recordInspiration(capture: InspirationCapture): Promise<InspirationEntry>
  recordInspiration(sourceBoard: BoardV2, capture: InspirationCapture): Promise<ContentCard>
}

export function createInspirationSlice({
  get,
  contextFor,
  contextIsCurrent,
  setForBoard,
  project,
  noticePatch,
  historyLimit,
}: InspirationSliceDependencies): InspirationActions {
  async function addInspirationCards(
    selected: InspirationCandidate[],
    anchor: { x: number; y: number },
  ): Promise<string[] | undefined> {
    const { boardId, board } = get()
    if (!boardId || !board) return undefined
    const context = contextFor(boardId)
    const poolSelection = selected.length > 0
      && selected.every((candidate) => candidate.poolId && candidate.entryId)
    const plan = poolSelection
      ? {
          createInputs: mapInspirationPoolSelectionToSnapshotInputs(selected, anchor),
          selection: selected.map((_, index) => ({ kind: 'create' as const, createIndex: index })),
        }
      : mapInspirationSelectionToSnapshots(selected, boardId, anchor)
    let cards: ContentCard[] = []

    if (plan.createInputs.length > 0) {
      setForBoard(context, { saveState: 'saving', message: null })
      try {
        cards = (await v2Api.createCards(boardId, { cards: plan.createInputs })).cards
      } catch (error) {
        setForBoard(context, (state) => ({
          saveState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
        return undefined
      }
    }

    if (!contextIsCurrent(context)) return undefined
    const selectedCardIds = plan.selection.flatMap((item) => {
      if (item.kind === 'existing') return [item.cardId]
      const created = cards[item.createIndex]
      return created ? [created.id] : []
    })

    setForBoard(context, (state) => {
      if (!state.board) return {}
      const nextBoard = cards.length > 0
        ? { ...state.board, cards: [...state.board.cards, ...cards] }
        : state.board
      return {
        board: nextBoard,
        ...project(nextBoard, state.runs, poolSelection ? state.selectedCardIds : selectedCardIds),
        ...(!poolSelection ? {
          selectedCardIds,
          deleteConfirmationIds: null,
          multiSelectMode: false,
          editingCardId: null,
          suggestions: [],
          suggestionState: 'idle' as const,
          branchDraft: null,
        } : {}),
        ...(poolSelection ? noticePatch(state, 'success', `已添加 ${cards.length} 条灵感到当前画板`, { boardId }) : { message: null }),
        ...(cards.length > 0 ? {
          saveState: 'saved' as const,
          historyPast: [
            ...state.historyPast,
            { kind: 'create' as const, boardId, cardIds: cards.map((card) => card.id) },
          ].slice(-historyLimit),
          historyFuture: [],
        } : {}),
      }
    })
    return selectedCardIds
  }

  async function recordInspiration(capture: InspirationCapture): Promise<InspirationEntry>
  async function recordInspiration(
    sourceBoard: BoardV2,
    capture: InspirationCapture,
  ): Promise<ContentCard>
  async function recordInspiration(
    captureOrSourceBoard: InspirationCapture | BoardV2,
    legacyCapture?: InspirationCapture,
  ): Promise<ContentCard | InspirationEntry> {
    if (legacyCapture === undefined) {
      const { entry } = await v2Api.createInspirationEntry(
        captureOrSourceBoard as InspirationCapture,
      )
      return entry
    }

    const sourceBoard = captureOrSourceBoard as BoardV2
    const input = mapInspirationCaptureToCardInput(sourceBoard, legacyCapture)
    const currentBoardId = get().boardId
    const context = currentBoardId && sourceBoard.id === currentBoardId
      ? contextFor(currentBoardId)
      : null
    const { card } = await v2Api.createCard(sourceBoard.id, input)

    if (context && contextIsCurrent(context)) {
      setForBoard(context, (state) => {
        if (!state.board) return {}
        const board = { ...state.board, cards: [...state.board.cards, card] }
        return {
          board,
          ...project(board, state.runs, state.selectedCardIds),
          historyPast: [
            ...state.historyPast,
            { kind: 'create' as const, boardId: context.boardId, cardIds: [card.id] },
          ].slice(-historyLimit),
          historyFuture: [],
        }
      })
    }

    return card
  }

  return { addInspirationCards, recordInspiration }
}
