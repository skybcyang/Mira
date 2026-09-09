import type { StoreApi } from 'zustand'
import type { BoardV2, TransformationRun } from '../domain'
import { v2Api } from '../v2Api'
import {
  transformationDependencyOrder,
  transformationExecutionDecision,
} from '../v2State'
import type { V2CanvasState } from './storeTypes'
import type { Notice, NoticeKind } from './noticePolicy'
import {
  isMissingRunError,
  isTransientRunLoadError,
  missingRunMessage,
  resolveAsyncDetailSurface,
  userFacingStoreError as safeMessage,
  type DetailSurfaceSnapshot,
} from './storePolicy'

export const TERMINAL = new Set(['succeeded', 'failed', 'interrupted'])
export const RESUMABLE = new Set(['queued', 'running'])
const RUN_POLL_DELAY_MS = 500
const MAX_RUN_POLL_FAILURES = 3

interface BoardRequestContext {
  boardId: string
  generation: number
}

interface NoticeOperation {
  operationId: string
  boardId: string
}

type RunActions = Pick<
  V2CanvasState,
  | 'runToTransformation'
  | 'rerunTransformation'
  | 'interruptRun'
  | 'adoptCandidate'
  | 'discardCandidate'
  | 'refreshCandidate'
>

type SetForBoard = (
  context: BoardRequestContext,
  update:
    | Partial<V2CanvasState>
    | ((state: V2CanvasState) => Partial<V2CanvasState>),
  recordsBoardWrite?: boolean,
) => void

interface RunSliceDependencies {
  set: StoreApi<V2CanvasState>['setState']
  get: StoreApi<V2CanvasState>['getState']
  contextFor(boardId: string): BoardRequestContext
  contextIsCurrent(context: BoardRequestContext, state?: V2CanvasState): boolean
  setForBoard: SetForBoard
  setNoticeForBoard(
    context: BoardRequestContext,
    kind: NoticeKind,
    message: string,
    scope?: Pick<Notice, 'operationId'>,
  ): void
  refreshBoard(context: BoardRequestContext): Promise<void>
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
  currentDetailSurface(state?: V2CanvasState): DetailSurfaceSnapshot
  isBoardPending(): boolean
}

export function createRunSlice({
  set,
  get,
  contextFor,
  contextIsCurrent,
  setForBoard,
  setNoticeForBoard,
  refreshBoard,
  project,
  noticePatch,
  currentDetailSurface,
  isBoardPending,
}: RunSliceDependencies): {
  actions: RunActions
  resumeTrackRun(
    boardId: string,
    run: TransformationRun,
    noticeOperation?: NoticeOperation,
    startedDetailSurface?: DetailSurfaceSnapshot,
  ): Promise<void>
  retryInitialRunLoad(context: BoardRequestContext, runId: string): Promise<void>
} {
  const trackedRuns = new Map<string, Promise<void>>()

  function setRunForBoard(boardId: string, run: TransformationRun) {
    set((state) => {
      if (isBoardPending() || !state.board || state.boardId !== boardId) return {}
      const runs = { ...state.runs, [run.id]: run }
      return { runs, ...project(state.board, runs, state.selectedCardIds) }
    })
  }

  async function trackRun(
    boardId: string,
    initial: TransformationRun,
    noticeOperation?: NoticeOperation,
    startedDetailSurface?: DetailSurfaceSnapshot,
  ) {
    let run = initial
    let consecutiveFailures = 0
    let delay = RUN_POLL_DELAY_MS
    setRunForBoard(boardId, run)
    while (!TERMINAL.has(run.status)) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        run = (await v2Api.getRun(run.id)).run
        consecutiveFailures = 0
        delay = RUN_POLL_DELAY_MS
        setRunForBoard(boardId, run)
      } catch {
        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_RUN_POLL_FAILURES) {
          if (get().boardId === boardId) {
            const message = '运行状态暂时无法更新，请稍后重新打开画板继续跟踪。'
            setNoticeForBoard(contextFor(boardId), 'error', message, noticeOperation)
          }
          return
        }
        delay *= 2
      }
    }
    if (isBoardPending() || get().boardId !== boardId) return
    const context = contextFor(boardId)
    try {
      await refreshBoard(context)
    } catch (error) {
      if (contextIsCurrent(context)) {
        setNoticeForBoard(context, 'error', safeMessage(error), noticeOperation)
      }
      return
    }
    if (
      startedDetailSurface
      && run.result?.disposition === 'candidate'
      && contextIsCurrent(context)
    ) {
      setForBoard(context, (state) => ({
        ...resolveAsyncDetailSurface(
          startedDetailSurface,
          currentDetailSurface(state),
          { tab: 'run', runId: run.id },
        ),
        ...noticePatch(
          state,
          'attention',
          '生成结果需要比较，请先采用或丢弃。',
          noticeOperation || { boardId },
        ),
      }))
      return
    }
    if (noticeOperation && contextIsCurrent(context)) {
      if (run.status === 'failed') {
        setNoticeForBoard(context, 'error', safeMessage(run.error), noticeOperation)
      } else if (run.status === 'interrupted') {
        setNoticeForBoard(context, 'attention', '生成已中断。', noticeOperation)
      } else if (run.result?.disposition === 'candidate') {
        setNoticeForBoard(context, 'attention', '生成结果需要比较，请先采用或丢弃。', noticeOperation)
      } else {
        setNoticeForBoard(context, 'success', '生成完成。', noticeOperation)
      }
    } else if (run.status === 'failed' && contextIsCurrent(context)) {
      setNoticeForBoard(context, 'error', safeMessage(run.error))
    }
  }

  function resumeTrackRun(
    boardId: string,
    run: TransformationRun,
    noticeOperation?: NoticeOperation,
    startedDetailSurface?: DetailSurfaceSnapshot,
  ): Promise<void> {
    const existing = trackedRuns.get(run.id)
    if (existing) return existing
    const tracking = trackRun(boardId, run, noticeOperation, startedDetailSurface)
    trackedRuns.set(run.id, tracking)
    void tracking.finally(() => {
      if (trackedRuns.get(run.id) === tracking) trackedRuns.delete(run.id)
    })
    return tracking
  }

  async function retryInitialRunLoad(context: BoardRequestContext, runId: string) {
    const startedDetailSurface = currentDetailSurface()
    let delay = RUN_POLL_DELAY_MS
    for (let attempt = 0; attempt < MAX_RUN_POLL_FAILURES; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (!contextIsCurrent(context)) return
      try {
        const { run } = await v2Api.getRun(runId)
        if (!contextIsCurrent(context)) return
        setForBoard(context, (state) => {
          if (!state.board) return {}
          const runs = { ...state.runs, [run.id]: run }
          return { runs, ...project(state.board, runs, state.selectedCardIds) }
        })
        if (RESUMABLE.has(run.status)) {
          void resumeTrackRun(context.boardId, run, undefined, startedDetailSurface)
        } else if (TERMINAL.has(run.status)) {
          try {
            await refreshBoard(context)
            if (run.result?.disposition === 'candidate' && contextIsCurrent(context)) {
              setForBoard(context, (state) => ({
                ...resolveAsyncDetailSurface(
                  startedDetailSurface,
                  currentDetailSurface(state),
                  { tab: 'run', runId: run.id },
                ),
                ...noticePatch(
                  state,
                  'attention',
                  '生成结果需要比较，请先采用或丢弃。',
                  { boardId: context.boardId },
                ),
              }))
            }
          } catch (error) {
            setNoticeForBoard(context, 'error', safeMessage(error))
          }
        }
        return
      } catch (error) {
        if (isMissingRunError(error)) {
          setNoticeForBoard(context, 'attention', missingRunMessage([runId]))
          return
        }
        if (!isTransientRunLoadError(error)) return
        delay *= 2
      }
    }
    setNoticeForBoard(
      context, 'error', '运行信息暂时无法载入，请稍后重新打开画板继续跟踪。',
    )
  }

  const actions: RunActions = {
    async runToTransformation(transformationId) {
      const initial = get()
      if (!initial.boardId || !initial.board || initial.runningToTransformationId) return
      const context = contextFor(initial.boardId)
      const startedDetailSurface = currentDetailSurface(initial)
      const noticeOperation = {
        operationId: `run-to:${transformationId}`,
        boardId: initial.boardId,
      }
      const order = transformationDependencyOrder(initial.board, transformationId)
      const targetLabel = initial.board.transformations.find(
        (item) => item.id === transformationId,
      )?.label || '这一步'
      if (order.reason === 'not-found') {
        setNoticeForBoard(context, 'error', '这条成果关系已不在当前画板中。', noticeOperation)
        return
      }
      if (order.reason === 'cycle') {
        setNoticeForBoard(context, 'error', '检测到循环关系，无法运行到这里。', noticeOperation)
        return
      }

      setForBoard(context, (state) => ({
        runningToTransformationId: transformationId,
        ...noticePatch(
          state,
          'progress',
          `正在检查到“${targetLabel}”为止的内容…`,
          noticeOperation,
        ),
      }))
      let completedRuns = 0
      try {
        for (const [stepIndex, currentTransformationId] of order.transformationIds.entries()) {
          if (!contextIsCurrent(context)) return
          const state = get()
          if (!state.board) return
          const decision = transformationExecutionDecision(
            state.board,
            state.runs,
            currentTransformationId,
          )
          if (decision.kind === 'current') continue
          if (decision.kind === 'candidate') {
            setForBoard(context, (current) => ({
              ...resolveAsyncDetailSurface(
                startedDetailSurface,
                currentDetailSurface(current),
                { tab: 'run', runId: decision.reason },
              ),
              ...noticePatch(
                current,
                'attention',
                '上游有待比较结果，请先采用或丢弃，再运行到这里。',
                noticeOperation,
              ),
            }))
            return
          }
          if (decision.kind === 'sources-unavailable') {
            setNoticeForBoard(
              context, 'attention', '上游素材还没有可用内容，已停在这里。', noticeOperation,
            )
            return
          }
          if (decision.kind === 'tracking-unavailable') {
            setNoticeForBoard(
              context, 'error', '运行信息暂时无法确认，请重新打开画板后再运行到这里。', noticeOperation,
            )
            return
          }

          const currentLabel = state.board.transformations.find(
            (item) => item.id === currentTransformationId,
          )?.label || '这一步'
          setNoticeForBoard(
            context,
            'progress',
            `正在运行第 ${stepIndex + 1}/${order.transformationIds.length} 步：“${currentLabel}”…`,
            noticeOperation,
          )

          const { run } = await v2Api.startRun(context.boardId, currentTransformationId)
          if (!contextIsCurrent(context)) return
          setForBoard(context, (current) => {
            if (!current.board) return { runs: { ...current.runs, [run.id]: run } }
            const nextBoard = {
              ...current.board,
              transformations: current.board.transformations.map((item) =>
                item.id === currentTransformationId
                  ? { ...item, lastRunId: run.id }
                  : item,
              ),
            }
            const runs = { ...current.runs, [run.id]: run }
            return {
              board: nextBoard,
              runs,
              ...project(nextBoard, runs, current.selectedCardIds),
            }
          })
          await resumeTrackRun(context.boardId, run)
          if (!contextIsCurrent(context)) return
          const terminalRun = get().runs[run.id]
          if (!terminalRun || !TERMINAL.has(terminalRun.status)) {
            setNoticeForBoard(
              context, 'error', '运行状态暂时无法确认，已停止继续生成。', noticeOperation,
            )
            return
          }
          if (terminalRun.status === 'failed') {
            setNoticeForBoard(context, 'error', safeMessage(terminalRun.error), noticeOperation)
            return
          }
          if (terminalRun.status === 'interrupted') {
            setNoticeForBoard(
              context, 'attention', '运行已中断，未继续生成下游内容。', noticeOperation,
            )
            return
          }
          if (terminalRun.result?.disposition === 'candidate') {
            setForBoard(context, (current) => ({
              ...resolveAsyncDetailSurface(
                startedDetailSurface,
                currentDetailSurface(current),
                { tab: 'run', runId: terminalRun.id },
              ),
              ...noticePatch(
                current,
                'attention',
                '生成结果需要比较，请先采用或丢弃，再运行到这里。',
                noticeOperation,
              ),
            }))
            return
          }
          completedRuns += 1
        }

        setNoticeForBoard(
          context,
          completedRuns > 0 ? 'success' : 'info',
          completedRuns > 0
            ? `已更新到“${targetLabel}”（${completedRuns} 步）。`
            : `到“${targetLabel}”已经是最新。`,
          noticeOperation,
        )
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error), noticeOperation)
      } finally {
        setForBoard(context, (state) => state.runningToTransformationId === transformationId
          ? { runningToTransformationId: null }
          : {})
      }
    },

    async rerunTransformation(transformationId) {
      const boardId = get().boardId
      if (!boardId) return
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      try {
        const { run } = await v2Api.startRun(boardId, transformationId)
        setForBoard(context, (state) => {
          if (!state.board) return { runs: { ...state.runs, [run.id]: run } }
          const nextBoard = {
            ...state.board,
            transformations: state.board.transformations.map((item) =>
              item.id === transformationId ? { ...item, lastRunId: run.id } : item,
            ),
          }
          const runs = { ...state.runs, [run.id]: run }
          return {
            board: nextBoard,
            runs,
            ...project(nextBoard, runs, state.selectedCardIds),
          }
        })
        void resumeTrackRun(boardId, run, undefined, startedDetailSurface)
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
      }
    },

    async interruptRun(runId) {
      const boardId = get().boardId
      if (!boardId) return
      const context = contextFor(boardId)
      try {
        const { run } = await v2Api.interruptRun(runId)
        if (contextIsCurrent(context)) setRunForBoard(boardId, run)
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
      }
    },

    async refreshCandidate(runId) {
      const boardId = get().boardId
      if (!boardId) return false
      const context = contextFor(boardId)
      try {
        const { run } = await v2Api.getRun(runId)
        if (!contextIsCurrent(context) || run.boardId !== boardId) return false
        await refreshBoard(context)
        if (!contextIsCurrent(context)) return false
        setRunForBoard(boardId, run)
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },

    async adoptCandidate(runId, baseVersionId) {
      const run = get().runs[runId]
      const card = get().board?.cards.find((item) => item.id === run?.targetCardId)
      const boardId = get().boardId
      if (!run || !card || !boardId || baseVersionId === undefined) return false
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      try {
        const adopted = await v2Api.adoptCandidate(runId, baseVersionId)
        if (!contextIsCurrent(context)) return true
        setForBoard(context, (state) => {
          const runs = { ...state.runs, [runId]: adopted.run }
          if (!state.board) return { runs }
          const board = {
            ...state.board,
            cards: state.board.cards.map((item) =>
              item.id === adopted.card.id ? adopted.card : item,
            ),
          }
          return { board, runs, ...project(board, runs, state.selectedCardIds) }
        })
        await refreshBoard(context)
        setForBoard(context, (state) => resolveAsyncDetailSurface(
          startedDetailSurface,
          currentDetailSurface(state),
          { tab: 'versions', cardId: adopted.card.id },
          'replace-origin',
        ))
        setNoticeForBoard(context, 'success', `已采用为 v${adopted.card.versions.find((version) => version.id === adopted.card.headVersionId)?.sequence || adopted.card.versions.length}`)
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },

    async discardCandidate(runId) {
      const boardId = get().boardId
      if (!boardId) return false
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      try {
        const { run } = await v2Api.discardCandidate(runId)
        setForBoard(context, (state) => ({
          runs: { ...state.runs, [runId]: run },
          ...resolveAsyncDetailSurface(
            startedDetailSurface,
            currentDetailSurface(state),
            { tab: 'run', runId },
            'replace-origin',
          ),
        }))
        return true
      } catch (error) {
        setNoticeForBoard(context, 'error', safeMessage(error))
        return false
      }
    },
  }

  return { actions, resumeTrackRun, retryInitialRunLoad }
}
