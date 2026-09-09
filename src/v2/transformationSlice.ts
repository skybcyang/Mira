import { v2Api } from '../v2Api'
import { collisionFreeBranchOrigin, sourceRefsFor, targetPositionForSelection } from '../v2State'
import {
  resolveAsyncDetailSurface,
  transitionDetailSurface,
  userFacingStoreError as safeMessage,
} from './storePolicy'
import type { V2CanvasState } from './storeTypes'
import type { CanvasStoreContext } from './storeContext'
import { createSourceSlice, type SourceActions } from './sourceSlice'
import { sourceEditBlock, sourceListError } from './transformationSources'

type TransformationSliceDependencies = Pick<
  CanvasStoreContext,
  | 'get'
  | 'contextFor'
  | 'contextIsCurrent'
  | 'setForBoard'
  | 'setNoticeForBoard'
  | 'noticePatch'
  | 'project'
  | 'currentDetailSurface'
  | 'refreshBoard'
  | 'nextOperationSequence'
>

type TransformationSliceActions = Pick<
  V2CanvasState,
  | 'requestSuggestions'
  | 'generate'
  | 'generateBranches'
  | 'updateTransformation'
  | 'deleteTransformation'
>

export function createTransformationSlice(
  context: TransformationSliceDependencies,
): TransformationSliceActions & SourceActions {
  const {
    get,
    contextFor,
    contextIsCurrent,
    setForBoard,
    setNoticeForBoard,
    noticePatch,
    project,
    currentDetailSurface,
    refreshBoard,
    nextOperationSequence,
  } = context

  const pendingSourceWrites = new Set<string>()
  return {
    ...createSourceSlice(context),
    async requestSuggestions() {
      const { boardId, board, selectedCardIds, branchDraft } = get()
      const sourceIds = branchDraft?.sourceCardIds || selectedCardIds
      if (!boardId || !board || sourceIds.length === 0) return
      const context = contextFor(boardId)
      setForBoard(context, { suggestionState: 'loading', message: null })
      try {
        const refs = sourceRefsFor(board, sourceIds)
        const result = await v2Api.suggest(boardId, refs)
        if (!contextIsCurrent(context)) return
        const currentIds = get().branchDraft?.sourceCardIds || get().selectedCardIds
        if (currentIds.join('|') !== sourceIds.join('|')) return
        setForBoard(context, { suggestions: result.suggestions.slice(0, 3), suggestionState: 'ready' })
      } catch (error) {
        setForBoard(context, (state) => ({
          suggestionState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
      }
    },

    async generate(suggestion) {
      const { boardId, board, selectedCardIds, branchDraft } = get()
      const sourceIds = branchDraft?.sourceCardIds || selectedCardIds
      if (!boardId || !board || sourceIds.length === 0) return
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      const noticeOperation = {
        operationId: `create-step:${boardId}:${nextOperationSequence()}`,
        boardId,
      }
      setNoticeForBoard(context, 'progress', `正在创建“${suggestion.label}”…`, noticeOperation)
      try {
        const created = await v2Api.createTransformation(boardId, {
          sourceRefs: sourceRefsFor(board, sourceIds),
          label: suggestion.label,
          instruction: suggestion.instruction,
          acceptance: suggestion.acceptance,
          targetPosition:
            branchDraft?.targetPosition || targetPositionForSelection(board, sourceIds),
        })
        if (!contextIsCurrent(context)) return
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const updatedBoard = {
            ...state.board,
            cards: [...state.board.cards, created.targetCard],
            transformations: [...state.board.transformations, created.transformation],
          }
          return {
            board: updatedBoard,
            ...project(updatedBoard, state.runs, []),
            selectedCardIds: [],
            deleteConfirmationIds: null,
            suggestions: [],
            suggestionState: 'idle',
            branchDraft: null,
            ...resolveAsyncDetailSurface(
              startedDetailSurface,
              currentDetailSurface(state),
              { tab: 'relation', transformationId: created.transformation.id },
            ),
            ...noticePatch(
              state,
              'info',
              '转化已创建，尚未生成。',
              noticeOperation,
            ),
          }
        })
      } catch (error) {
        setForBoard(context, (state) => ({
          suggestionState: 'error',
          ...noticePatch(
            state,
            'error',
            safeMessage(error),
            noticeOperation,
          ),
        }))
      }
    },

    async generateBranches(suggestions) {
      const { boardId, board, selectedCardIds, branchDraft } = get()
      const sourceIds = branchDraft?.sourceCardIds || selectedCardIds
      if (!boardId || !board || sourceIds.length === 0 || suggestions.length < 2) return
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      const noticeOperation = {
        operationId: `create-branches:${boardId}:${nextOperationSequence()}`,
        boardId,
      }
      const origin = collisionFreeBranchOrigin(
        board,
        sourceIds,
        suggestions.length,
        branchDraft?.targetPosition,
      )
      setNoticeForBoard(context, 'progress', `正在创建 ${suggestions.length} 个分支…`, noticeOperation)
      try {
        const created = await v2Api.createTransformations(boardId, {
          sourceRefs: sourceRefsFor(board, sourceIds),
          transformations: suggestions.map((suggestion, index) => ({
            label: suggestion.label,
            instruction: suggestion.instruction,
            acceptance: suggestion.acceptance,
            targetPosition: { x: origin.x, y: origin.y + index * 272 },
          })),
        })
        if (!contextIsCurrent(context)) return
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const nextBoard = {
            ...state.board,
            cards: [...state.board.cards, ...created.targetCards],
            transformations: [...state.board.transformations, ...created.transformations],
          }
          return {
            board: nextBoard,
            ...project(nextBoard, state.runs, []),
            selectedCardIds: [],
            deleteConfirmationIds: null,
            suggestions: [],
            suggestionState: 'idle',
            branchDraft: null,
            ...resolveAsyncDetailSurface(
              startedDetailSurface,
              currentDetailSurface(state),
              created.transformations[0]
                ? { tab: 'relation', transformationId: created.transformations[0].id }
                : null,
            ),
            saveState: 'saved',
            ...noticePatch(
              state,
              'info',
              `已创建 ${created.transformations.length} 个分支，尚未生成。`,
              noticeOperation,
            ),
          }
        })
      } catch (error) {
        setForBoard(context, (state) => ({
          suggestionState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), noticeOperation),
        }))
      }
    },

    async updateTransformation(transformationId, changes, baseUpdatedAt) {
      const { boardId, board } = get()
      const transformation = board?.transformations.find((item) => item.id === transformationId)
      if (!boardId || !board || !transformation) return false
      const context = contextFor(boardId)
      const key = boardId + ':' + transformationId
      if (pendingSourceWrites.has(key)) {
        setNoticeForBoard(context, 'attention', '正在保存转化，请稍后再试。')
        return false
      }
      if (changes.sourceCardIds) {
        const error = sourceEditBlock(board, transformation, get().runs)
          || sourceListError(board, transformation, changes.sourceCardIds)
        if (error) {
          setNoticeForBoard(context, 'attention', error)
          return false
        }
      }
      pendingSourceWrites.add(key)
      try {
        const { transformation: updated } = await v2Api.updateTransformation(boardId, transformationId, {
          baseUpdatedAt: baseUpdatedAt ?? transformation.updatedAt,
          ...(changes.label === undefined ? {} : { label: changes.label }),
          ...(changes.instruction === undefined ? {} : { instruction: changes.instruction }),
          ...(changes.acceptance === undefined ? {} : { acceptance: changes.acceptance }),
          ...(changes.modelId === undefined ? {} : { modelId: changes.modelId }),
          ...(changes.sourceCardIds === undefined
            ? {}
            : { sourceRefs: sourceRefsFor(board, changes.sourceCardIds) }),
        })
        if (!contextIsCurrent(context)) return false
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const nextBoard = {
            ...state.board,
            transformations: state.board.transformations.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
          const message = transformation.workflowRef
            ? '已调整当前步骤，保存的方法保持不变。'
            : '转化已更新。'
          return {
            board: nextBoard,
            ...project(nextBoard, state.runs, state.selectedCardIds),
            ...noticePatch(state, 'success', message, { boardId }),
          }
        })
        return true
      } catch (error) {
        if ((error as { code?: string })?.code === 'TRANSFORMATION_CONFLICT') {
          try {
            await refreshBoard(context)
          } catch {}
        }
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      } finally {
        pendingSourceWrites.delete(key)
      }
    },

    async deleteTransformation(transformationId) {
      const { boardId, board } = get()
      if (!boardId || !board?.transformations.some((item) => item.id === transformationId)) return false
      const context = contextFor(boardId)
      try {
        await v2Api.deleteTransformation(boardId, transformationId)
        if (!contextIsCurrent(context)) return false
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const nextBoard = {
            ...state.board,
            transformations: state.board.transformations.filter((item) => item.id !== transformationId),
          }
          const drawer = state.drawer?.tab === 'relation'
            && state.drawer.transformationId === transformationId
            ? null
            : state.drawer
          return {
            board: nextBoard,
            ...project(nextBoard, state.runs, state.selectedCardIds),
            ...transitionDetailSurface(currentDetailSurface(state), drawer, state.panel),
            ...noticePatch(
              state,
              'success',
              '转化已删除；目标卡、版本和已有运行均已保留。',
              { boardId },
            ),
          }
        })
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },
  }
}
