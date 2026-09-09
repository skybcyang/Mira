import type { BoardV2, TransformationRun } from '../domain'
import { v2Api, type BoardImportResult, type BoardLifecycleState, type BoardSummary } from '../v2Api'
import { type createRunSlice, RESUMABLE } from './runSlice'
import {
  isMissingRunError,
  isTransientRunLoadError,
  missingRunMessage,
  transitionDetailSurface,
  userFacingStoreError as safeMessage,
} from './storePolicy'
import type { V2CanvasState } from './storeTypes'
import { backupFileName, boardArtifactFileName, portableDownloads } from './portableDownloads'
import type { CanvasStoreContext } from './storeContext'
import { createCheckpointSlice, type CheckpointActions } from './checkpointSlice'
import { readBoardNavigation, writeBoardNavigation, rememberOpenedBoard } from './boardNavigation'

const LAST_BOARD = 'mira.v2.lastBoardId'
type InitialRunLoad =
  | { kind: 'loaded'; run: TransformationRun }
  | { kind: 'failed'; runId: string; error: unknown }

interface BoardOpenSnapshot {
  board: BoardV2
  runs: Record<string, TransformationRun>
  runEntries: InitialRunLoad[]
  missingRunIds: string[]
}
function rememberBoard(boardId: string) {
  try {
    localStorage.setItem(LAST_BOARD, boardId)
  } catch {}
}

function rememberedBoard() {
  try {
    return localStorage.getItem(LAST_BOARD) || ''
  } catch {
    return ''
  }
}

function boardLifecycleState(board: BoardV2): BoardLifecycleState {
  return board.lifecycle?.state || 'active'
}

function boardSummary(board: BoardV2): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    state: boardLifecycleState(board),
    revision: board.revision || 0,
    updatedAt: board.updatedAt,
  }
}
type BoardSliceDependencies = Pick<
  CanvasStoreContext,
  | 'set'
  | 'get'
  | 'contextFor'
  | 'setNotice'
  | 'noticePatch'
  | 'project'
  | 'currentDetailSurface'
  | 'refreshBoard'
  | 'nextOperationSequence'
  | 'navigation'
  | 'recordBoardWrite'
  | 'boardWriteSequence'
>

type BoardSliceActions = Pick<
  V2CanvasState,
  | 'load'
  | 'switchBoard'
  | 'closeBoard'
  | 'togglePinnedBoard'
  | 'createBoard'
  | 'refreshBoardCatalog'
  | 'renameBoard'
  | 'archiveBoard'
  | 'trashBoard'
  | 'restoreBoard'
  | 'purgeBoard'
  | 'exportBoardFile'
  | 'importBoardFile'
  | 'backupMira'
>

export function createBoardSlice(
  context: BoardSliceDependencies,
  runSlice: Pick<ReturnType<typeof createRunSlice>, 'resumeTrackRun' | 'retryInitialRunLoad'>,
): BoardSliceActions & CheckpointActions {
  const {
    set,
    get,
    contextFor,
    setNotice,
    noticePatch,
    project,
    currentDetailSurface,
    refreshBoard,
    nextOperationSequence,
    navigation,
    recordBoardWrite,
    boardWriteSequence,
  } = context
  let boardNavigationSequence = 0

  let activeBoardNavigation: number | null = null

  let boardCatalogSequence = 0

  async function readBoardForOpen(
    boardId: string,
    requestIsCurrent: () => boolean,
  ): Promise<BoardOpenSnapshot | null> {
    const { board } = await v2Api.getBoard(boardId)
    if (!requestIsCurrent()) return null
    if (boardLifecycleState(board) !== 'active') {
      throw new Error('这个画板已不在工作中，请刷新画板目录后重试。')
    }
    const runIds = [...new Set(
      board.transformations.flatMap((transformation) =>
        [transformation.lastRunId, transformation.lastAppliedRunId]
          .filter((runId): runId is string => Boolean(runId)),
      ),
    )]
    const runEntries: InitialRunLoad[] = await Promise.all(
      runIds.map(async (runId) => {
        try {
          const { run } = await v2Api.getRun(runId)
          return { kind: 'loaded' as const, run }
        } catch (error) {
          return { kind: 'failed' as const, runId, error }
        }
      }),
    )
    if (!requestIsCurrent()) return null
    const runs: Record<string, TransformationRun> = Object.fromEntries(
      runEntries.flatMap((entry) =>
        entry.kind === 'loaded' ? [[entry.run.id, entry.run] as const] : [],
      ),
    )
    const missingRunIds = runEntries.flatMap((entry) =>
      entry.kind === 'failed' && isMissingRunError(entry.error) ? [entry.runId] : [],
    )
    return { board, runs, runEntries, missingRunIds }
  }

  function commitOpenedBoard(
    boardId: string,
    generation: number,
    snapshot: BoardOpenSnapshot,
  ) {
    const { board, runs, runEntries, missingRunIds } = snapshot
    const projected = project(board, runs, [], null)
    navigation.pendingBoardGeneration = null
    set((state) => ({
      boardId,
      openedBoardIds: rememberOpenedBoard(state.openedBoardIds, boardId),
      board,
      runs,
      boards: state.boards.some(item => item.id === boardId) ? state.boards : [...state.boards, boardSummary(board)],
      ...projected,
      selectedCardIds: [],
      selectedGroupId: null,
      organizationPending: false,
      deleteConfirmationIds: null,
      multiSelectMode: false,
      suggestions: [],
      suggestionState: 'idle',
      ...transitionDetailSurface(currentDetailSurface(state), null, state.panel),
      branchDraft: null,
      workflowDraft: null,
      sourcePicker: null,
      editingCardId: null,
      applyingWorkflowId: null,
      runningToTransformationId: null,
      saveState: 'saved',
      historyPast: [],
      historyFuture: [],
      historyState: 'idle',
      ...(missingRunIds.length > 0
        ? noticePatch(
          { ...state, notices: [] },
          'attention',
          missingRunMessage(missingRunIds),
          { boardId },
        )
        : { message: null, notices: [] }),
    }))
    rememberBoard(boardId)
    persistNavigation()
    const startedDetailSurface = currentDetailSurface()
    for (const run of Object.values(runs)) {
      if (RESUMABLE.has(run.status)) {
        runSlice.resumeTrackRun(boardId, run, undefined, startedDetailSurface)
      }
    }
    const context = { boardId, generation }
    for (const entry of runEntries) {
      if (entry.kind === 'failed' && isTransientRunLoadError(entry.error)) {
        void runSlice.retryInitialRunLoad(context, entry.runId)
      }
    }
  }

  async function openBoard(boardId: string, generation: number): Promise<boolean> {
    const snapshot = await readBoardForOpen(boardId, () => generation === navigation.boardGeneration)
    if (!snapshot) return false
    commitOpenedBoard(boardId, generation, snapshot)
    return true
  }

  function replaceBoardSummary(
    summaries: BoardSummary[],
    next: BoardSummary,
  ): BoardSummary[] {
    return summaries.some((item) => item.id === next.id)
      ? summaries.map((item) => item.id === next.id ? next : item)
      : [...summaries, next]
  }

  function applyCommittedBoard(board: BoardV2, expectedWriteSequence?: number) {
    boardCatalogSequence += 1
    const summary = boardSummary(board)
    set((state) => {
      const boardCatalog = replaceBoardSummary(state.boardCatalog, summary)
      const boards = summary.state === 'active'
        ? state.boards.some((item) => item.id === board.id)
          ? state.boards.map((item) => item.id === board.id
            ? { id: board.id, title: board.title }
            : item)
          : [...state.boards, { id: board.id, title: board.title }]
        : state.boards.filter((item) => item.id !== board.id)
      if (state.boardId !== board.id || summary.state !== 'active') {
        return { boardCatalog, boards }
      }
      const nextBoard = expectedWriteSequence !== undefined
        && expectedWriteSequence !== (boardWriteSequence(board.id))
        && state.board
        ? {
          ...state.board,
          title: board.title,
          revision: board.revision,
          lifecycle: board.lifecycle,
          updatedAt: board.updatedAt,
        }
        : board
      if (state.board !== nextBoard) recordBoardWrite(board.id)
      return {
        boardCatalog,
        boards,
        board: nextBoard,
        ...project(nextBoard, state.runs, state.selectedCardIds),
      }
    })
  }

  function invalidateCurrentBoard(boardId: string): number | null {
    if (get().boardId !== boardId) return null
    const generation = ++navigation.boardGeneration
    navigation.pendingBoardGeneration = generation
    set((state) => ({
      boardId: null,
      board: null,
      nodes: [],
      edges: [],
      runs: {},
      selectedCardIds: [],
      selectedGroupId: null,
      organizationPending: false,
      deleteConfirmationIds: null,
      multiSelectMode: false,
      suggestions: [],
      suggestionState: 'idle',
      editingCardId: null,
      ...transitionDetailSurface(currentDetailSurface(state), null, state.panel),
      branchDraft: null,
      workflowDraft: null,
      sourcePicker: null,
      applyingWorkflowId: null,
      runningToTransformationId: null,
      historyPast: [],
      historyFuture: [],
      historyState: 'idle',
      loadState: 'loading',
      saveState: 'saved',
      message: null,
      notices: [],
    }))
    return generation
  }

  async function readBoardLists() {
    const [{ boards }, { boards: boardCatalog }] = await Promise.all([
      v2Api.listBoards(),
      v2Api.listBoardCatalog(),
    ])
    return { boards, boardCatalog }
  }

  function applyBoardLists(lists: {
    boards: BoardSummary[]
    boardCatalog: BoardSummary[]
  }) {
    boardCatalogSequence += 1
    set({
      boards: lists.boards,
      boardCatalog: lists.boardCatalog,
      boardCatalogState: 'ready',
      boardCatalogError: null,
    })
  }

  function committedReconciliationError(label: string, error: unknown, currentInvalid: boolean) {
    navigation.pendingBoardGeneration = null
    const detail = safeMessage(error)
    set((state) => ({
      boardCatalogState: 'error',
      boardCatalogError: detail,
      ...(currentInvalid ? { loadState: 'error' as const } : {}),
      ...noticePatch(
        state,
        'error',
        `画板${label}，但最新目录暂时无法加载。请重新加载后继续。`,
      ),
    }))
  }

  async function reconcileCommittedBoard(
    board: BoardV2,
    label: string,
    expectedWriteSequence?: number,
  ) {
    const leavingCurrent = get().boardId === board.id && boardLifecycleState(board) !== 'active'
    applyCommittedBoard(board, expectedWriteSequence)
    const generation = leavingCurrent ? invalidateCurrentBoard(board.id) : null
    try {
      const lists = await readBoardLists()
      applyBoardLists(lists)
      if (generation === null) return
      if (lists.boards.length === 0) {
        navigation.pendingBoardGeneration = null
        await get().createBoard('Mira 画板')
        return
      }
      const opened = await openBoard(lists.boards[0].id, generation)
      if (opened && generation === navigation.boardGeneration) set({ loadState: 'ready' })
    } catch (error) {
      committedReconciliationError(label, error, leavingCurrent)
    }
  }

  async function recoverBoardCommandFailure(boardId: string) {
    try {
      const lists = await readBoardLists()
      applyBoardLists(lists)
      if (get().boardId !== boardId) return
      if (lists.boards.some((item) => item.id === boardId)) {
        await refreshBoard(contextFor(boardId))
        return
      }
      const generation = invalidateCurrentBoard(boardId)
      if (generation === null) return
      if (lists.boards.length > 0) {
        const opened = await openBoard(lists.boards[0].id, generation)
        if (opened && generation === navigation.boardGeneration) set({ loadState: 'ready' })
      } else {
        navigation.pendingBoardGeneration = null
        await get().createBoard('Mira 画板')
      }
    } catch (refreshError) {
      navigation.pendingBoardGeneration = null
      set({
        boardCatalogState: 'error',
        boardCatalogError: safeMessage(refreshError),
        ...(get().boardId === null ? { loadState: 'error' as const } : {}),
      })
    }
  }

  async function runBoardCommand(
    boardId: string,
    command: () => Promise<{ board: BoardV2 }>,
    committedLabel: string,
  ) {
    const expectedWriteSequence = boardWriteSequence(boardId)
    let result: { board: BoardV2 }
    try {
      result = await command()
    } catch (error) {
      await recoverBoardCommandFailure(boardId)
      throw error
    }
    await reconcileCommittedBoard(result.board, committedLabel, expectedWriteSequence)
  }

  async function runBoardPurgeCommand(boardId: string, revision: number) {
    const leavingCurrent = get().boardId === boardId
    try {
      await v2Api.purgeBoard(boardId, revision)
    } catch (error) {
      await recoverBoardCommandFailure(boardId)
      throw error
    }
    boardCatalogSequence += 1
    const generation = leavingCurrent ? invalidateCurrentBoard(boardId) : null
    try {
      const lists = await readBoardLists()
      applyBoardLists(lists)
      if (generation === null) return
      if (lists.boards.length === 0) {
        navigation.pendingBoardGeneration = null
        await get().createBoard('Mira 画板')
        return
      }
      const opened = await openBoard(lists.boards[0].id, generation)
      if (opened && generation === navigation.boardGeneration) set({ loadState: 'ready' })
    } catch (error) {
      committedReconciliationError('永久删除', error, leavingCurrent)
    }
  }

  function captureForkIntegration() {
    const generation = navigation.boardGeneration
    const navigationSequence = boardNavigationSequence
    const detailRevision = get().detailSurfaceRevision
    const isCurrent = () => navigation.boardGeneration === generation
      && boardNavigationSequence === navigationSequence
      && get().detailSurfaceRevision === detailRevision
      && navigation.pendingBoardGeneration === null
    return async (result: BoardImportResult, checkpointTitle: string, canNavigate: () => boolean = () => true) => {
      applyCommittedBoard(result.board)
      let openingNavigationId: number | null = null
      const cancelOpening = () => {
        if (openingNavigationId === null || activeBoardNavigation !== openingNavigationId) return
        activeBoardNavigation = null
        if (navigation.boardGeneration === generation && navigation.pendingBoardGeneration === null) {
          set({ loadState: get().board ? 'ready' : 'error' })
        }
      }
      try {
        applyBoardLists(await readBoardLists())
        if (!canNavigate() || !isCurrent()) return
        const navigationId = boardNavigationSequence += 1
        openingNavigationId = navigationId
        activeBoardNavigation = navigationId
        const requestIsCurrent = () => canNavigate()
          && activeBoardNavigation === navigationId
          && navigation.boardGeneration === generation
          && navigation.pendingBoardGeneration === null
          && get().detailSurfaceRevision === detailRevision
        set({ loadState: 'loading' })
        const snapshot = await readBoardForOpen(result.boardId, requestIsCurrent)
        if (!snapshot || !requestIsCurrent()) {
          cancelOpening()
          return
        }
        activeBoardNavigation = null
        commitOpenedBoard(result.boardId, ++navigation.boardGeneration, snapshot)
        set({ loadState: 'ready' })
        setNotice('success', `已从“${checkpointTitle}”创建画板副本。`, { boardId: result.boardId })
      } catch (error) {
        cancelOpening()
        setNotice('error', '画板副本已创建，但暂时无法打开。请在画板管理中刷新后继续。', {
          boardId: result.boardId,
        })
        throw error
      }
    }
  }

  const checkpointDependencies = {
    integrateFork: (result: BoardImportResult, title: string) => captureForkIntegration()(result, title),
    captureForkIntegration,
    downloadArtifact(artifact: Parameters<typeof portableDownloads.downloadJson>[0], fileTitle: string) {
      portableDownloads.downloadJson(artifact, boardArtifactFileName(fileTitle))
    },
    notify(message: string, boardId: string) {
      setNotice('success', message, { boardId })
    },
  }

  function persistNavigation() {
    writeBoardNavigation({ opened:get().openedBoardIds, pinned:get().pinnedBoardIds })
  }

  return {
    ...createCheckpointSlice(checkpointDependencies),
    togglePinnedBoard(boardId) {
      if (!boardId) return
      set(state => ({ pinnedBoardIds:state.pinnedBoardIds.includes(boardId)
        ? state.pinnedBoardIds.filter(id => id !== boardId) : [...state.pinnedBoardIds, boardId] }))
      persistNavigation()
    },
    async closeBoard(boardId) {
      if (get().closingBoardId || get().loadState !== 'ready' || !get().openedBoardIds.includes(boardId)) return false
      const generation = navigation.boardGeneration
      const sequence = boardNavigationSequence
      const currentId = get().boardId
      set({ closingBoardId:boardId })
      try {
        const { activity } = await v2Api.getBoardActivity()
        if (navigation.boardGeneration !== generation || boardNavigationSequence !== sequence) return false
        const counts = activity[boardId]
        const loadedBusy = Object.values(get().runs).some(run => run.boardId === boardId &&
          (RESUMABLE.has(run.status) || (run.status === 'succeeded' && run.result?.disposition === 'candidate')))
        if (counts?.activeRuns || counts?.pendingCandidates || loadedBusy) {
          setNotice('attention', '画板还有运行或待处理结果，请先打开画板处理后再关闭。')
          return false
        }
        if (currentId === boardId) {
          if (get().saveState === 'saving' || get().historyState === 'applying') {
            setNotice('attention', '请等待当前保存完成后再关闭画板。')
            return false
          }
          const next = get().openedBoardIds.find(id => id !== boardId && get().boards.some(board => board.id === id))
          if (next) {
            await get().switchBoard(next)
            if (get().boardId !== next || boardNavigationSequence !== sequence + 1) return false
          } else {
            ++navigation.boardGeneration
            ++boardNavigationSequence
            activeBoardNavigation = null
            navigation.pendingBoardGeneration = null
            set(state => ({ boardId:null, board:null, runs:{}, nodes:[], edges:[],
              selectedCardIds:[], selectedGroupId:null, alignmentGuides:null, multiSelectMode:false,
              organizationPending:false, deleteConfirmationIds:null, suggestions:[], suggestionState:'idle',
              ...transitionDetailSurface(currentDetailSurface(state), null, null),
              branchDraft:null, workflowDraft:null, sourcePicker:null, editingCardId:null,
              applyingWorkflowId:null, runningToTransformationId:null, saveState:'saved',
              historyPast:[], historyFuture:[], historyState:'idle', notices:[], message:null, loadState:'ready' }))
            rememberBoard('')
          }
        }
        set(state => ({ openedBoardIds:state.openedBoardIds.filter(id => id !== boardId) }))
        persistNavigation()
        return true
      } catch (error) {
        setNotice('error', `未能关闭画板：${safeMessage(error)}`)
        throw error
      } finally { set({closingBoardId:null}) }
    },
    async load() {
      activeBoardNavigation = null
      boardNavigationSequence += 1
      const generation = ++navigation.boardGeneration
      navigation.pendingBoardGeneration = generation
      set({ loadState: 'loading', message: null })
      try {
        let { boards } = await v2Api.listBoards()
        if (generation !== navigation.boardGeneration) return
        const preferences = readBoardNavigation()
        if (preferences?.opened.length === 0 && !get().board) {
          navigation.pendingBoardGeneration = null
          set({ boards, openedBoardIds:[], pinnedBoardIds:preferences.pinned, loadState:'ready' })
          await get().refreshWorkflows()
          return
        }
        if (boards.length === 0) {
          const created = await v2Api.createBoard('Mira 画板')
          if (generation !== navigation.boardGeneration) return
          boards = [boardSummary(created.board)]
        }
        set({ boards })
        if (preferences) {
          set({ openedBoardIds:preferences.opened.filter(id => boards.some(board => board.id === id)), pinnedBoardIds:preferences.pinned })
        }
        const preferred = rememberedBoard()
        const opened = await openBoard(
          boards.some((board) => board.id === preferred) ? preferred : boards[0].id,
          generation,
        )
        if (!opened || generation !== navigation.boardGeneration) return
        await get().refreshWorkflows()
        if (generation === navigation.boardGeneration) set({ loadState: 'ready' })
      } catch (error) {
        if (generation === navigation.boardGeneration) {
          navigation.pendingBoardGeneration = null
          set((state) => ({
            loadState: state.board ? 'ready' : 'error',
            ...noticePatch(state, 'error', safeMessage(error)),
          }))
        }
      }
    },

    async switchBoard(boardId) {
      if (!boardId || boardId === get().boardId) return
      const startingGeneration = navigation.boardGeneration
      const navigationId = boardNavigationSequence += 1
      activeBoardNavigation = navigationId
      set((state) => ({
        loadState: 'loading',
        message: null,
        notices: [],
      }))
      try {
        const requestIsCurrent = () => activeBoardNavigation === navigationId
          && navigation.boardGeneration === startingGeneration
          && navigation.pendingBoardGeneration === null
        const snapshot = await readBoardForOpen(boardId, requestIsCurrent)
        if (!snapshot || !requestIsCurrent()) return
        activeBoardNavigation = null
        const generation = ++navigation.boardGeneration
        commitOpenedBoard(boardId, generation, snapshot)
        set({ loadState: 'ready' })
      } catch (error) {
        if (
          activeBoardNavigation === navigationId
          && navigation.boardGeneration === startingGeneration
          && navigation.pendingBoardGeneration === null
        ) {
          activeBoardNavigation = null
          set((state) => ({
            loadState: state.board ? 'ready' : 'error',
            ...noticePatch(state, 'error', safeMessage(error), { boardId }),
          }))
        }
        throw error
      }
    },

    async createBoard(title) {
      const startingGeneration = navigation.boardGeneration
      const navigationId = boardNavigationSequence += 1
      activeBoardNavigation = navigationId
      set({
        loadState: 'loading',
        message: null,
        notices: [],
      })
      const requestIsCurrent = () => activeBoardNavigation === navigationId
        && navigation.boardGeneration === startingGeneration
        && navigation.pendingBoardGeneration === null
      let created: Awaited<ReturnType<typeof v2Api.createBoard>>
      try {
        created = await v2Api.createBoard(title)
      } catch (error) {
        if (requestIsCurrent()) {
          activeBoardNavigation = null
          set((state) => ({
            loadState: state.board ? 'ready' : 'error',
            ...noticePatch(state, 'error', safeMessage(error)),
          }))
        }
        throw error
      }

      applyCommittedBoard(created.board)
      if (!requestIsCurrent()) return
      let catalogReconciled = false
      try {
        const [{ boards }, { boards: boardCatalog }] = await Promise.all([
          v2Api.listBoards(),
          v2Api.listBoardCatalog(),
        ])
        if (!requestIsCurrent()) return
        set({
          boards,
          boardCatalog,
          boardCatalogState: 'ready',
          boardCatalogError: null,
        })
        applyCommittedBoard(created.board)
        catalogReconciled = true
        const snapshot = await readBoardForOpen(created.boardId, requestIsCurrent)
        if (!snapshot || !requestIsCurrent()) return
        activeBoardNavigation = null
        const generation = ++navigation.boardGeneration
        commitOpenedBoard(created.boardId, generation, snapshot)
        set({ loadState: 'ready' })
      } catch (error) {
        if (
          activeBoardNavigation === navigationId
          && navigation.boardGeneration === startingGeneration
          && navigation.pendingBoardGeneration === null
        ) {
          activeBoardNavigation = null
          set((state) => ({
            loadState: state.board ? 'ready' : 'error',
            ...(!catalogReconciled ? {
              boardCatalogState: 'error' as const,
              boardCatalogError: safeMessage(error),
            } : {}),
            ...noticePatch(
              state,
              'error',
              '画板已创建，但暂时无法打开。请在画板管理中刷新后继续。',
              { boardId: created.boardId },
            ),
          }))
        }
      }
    },

    async refreshBoardCatalog() {
      const requestSequence = boardCatalogSequence += 1
      set({ boardCatalogState: 'loading', boardCatalogError: null })
      try {
        const { boards: boardCatalog } = await v2Api.listBoardCatalog()
        if (requestSequence !== boardCatalogSequence) return
        set({ boardCatalog, boardCatalogState: 'ready', boardCatalogError: null })
      } catch (error) {
        if (requestSequence !== boardCatalogSequence) return
        const boardCatalogError = safeMessage(error)
        set({ boardCatalogState: 'error', boardCatalogError })
        throw error
      }
    },

    async renameBoard(boardId, title, revision) {
      await runBoardCommand(
        boardId,
        () => v2Api.renameBoard(boardId, title, revision),
        '已重命名',
      )
    },

    async archiveBoard(boardId, revision) {
      await runBoardCommand(
        boardId,
        () => v2Api.archiveBoard(boardId, revision),
        '已归档',
      )
    },

    async trashBoard(boardId, revision) {
      await runBoardCommand(
        boardId,
        () => v2Api.trashBoard(boardId, revision),
        '已移到废纸篓',
      )
    },

    async restoreBoard(boardId, revision) {
      await runBoardCommand(
        boardId,
        () => v2Api.restoreBoard(boardId, revision),
        '已恢复',
      )
    },

    async purgeBoard(boardId, revision) {
      await runBoardPurgeCommand(boardId, revision)
    },

    async exportBoardFile(boardId) {
      const generation = navigation.boardGeneration
      const currentBoardId = get().boardId
      const operation = {
        operationId: `board-export:${boardId}:${nextOperationSequence()}`,
        ...(currentBoardId ? { boardId: currentBoardId } : {}),
      }
      setNotice('progress', '正在导出画板…', operation)
      try {
        const artifact = await v2Api.exportBoard(boardId)
        const title = get().boardCatalog.find((item) => item.id === boardId)?.title
          || (get().boardId === boardId ? get().board?.title : undefined)
          || boardId
        portableDownloads.downloadJson(artifact, boardArtifactFileName(title))
        if (generation === navigation.boardGeneration) {
          setNotice('success', '画板已导出。', operation)
        }
      } catch (error) {
        if (generation === navigation.boardGeneration) {
          setNotice('error', safeMessage(error), operation)
        }
        throw error
      }
    },

    async importBoardFile(file) {
      const generation = navigation.boardGeneration
      const navigationSequenceAtStart = boardNavigationSequence
      const currentBoardId = get().boardId
      const operation = {
        operationId: `board-import:${nextOperationSequence()}`,
        ...(currentBoardId ? { boardId: currentBoardId } : {}),
      }
      setNotice('progress', '正在导入画板副本…', operation)
      let result
      try {
        const artifact: unknown = JSON.parse(await file.text())
        result = await v2Api.importBoard(artifact)
      } catch (error) {
        if (generation === navigation.boardGeneration) {
          setNotice('error', safeMessage(error), operation)
        }
        throw error
      }

      applyCommittedBoard(result.board)
      if (
        generation !== navigation.boardGeneration
        || navigationSequenceAtStart !== boardNavigationSequence
      ) {
        try {
          applyBoardLists(await readBoardLists())
        } catch (error) {
          set({ boardCatalogState: 'error', boardCatalogError: safeMessage(error) })
        }
        return
      }

      let opening: { navigationId: number; startingGeneration: number } | null = null
      try {
        const lists = await readBoardLists()
        if (
          generation !== navigation.boardGeneration
          || navigationSequenceAtStart !== boardNavigationSequence
        ) {
          applyBoardLists(lists)
          return
        }
        applyBoardLists(lists)
        const startingGeneration = navigation.boardGeneration
        const navigationId = boardNavigationSequence += 1
        opening = { navigationId, startingGeneration }
        activeBoardNavigation = navigationId
        set({ loadState: 'loading' })
        const requestIsCurrent = () => activeBoardNavigation === navigationId
          && navigation.boardGeneration === startingGeneration
          && navigation.pendingBoardGeneration === null
        const snapshot = await readBoardForOpen(result.boardId, requestIsCurrent)
        if (!snapshot || !requestIsCurrent()) return
        activeBoardNavigation = null
        const openGeneration = ++navigation.boardGeneration
        commitOpenedBoard(result.boardId, openGeneration, snapshot)
        set({ loadState: 'ready' })
        setNotice('success', '画板副本已导入并打开。', {
          operationId: operation.operationId,
          boardId: result.boardId,
        })
      } catch (error) {
        const ownsCurrentTask = opening
          ? activeBoardNavigation === opening.navigationId
            && navigation.boardGeneration === opening.startingGeneration
            && navigation.pendingBoardGeneration === null
          : generation === navigation.boardGeneration
            && navigationSequenceAtStart === boardNavigationSequence
        if (!ownsCurrentTask) return
        if (opening) activeBoardNavigation = null
        set((state) => ({
          loadState: state.boardId ? 'ready' : 'error',
          boardCatalogState: 'error',
          boardCatalogError: safeMessage(error),
          ...noticePatch(
            state,
            'error',
            '画板副本已导入，但暂时无法打开。请刷新画板目录后继续。',
            operation,
          ),
        }))
      }
    },

    async backupMira() {
      const generation = navigation.boardGeneration
      const currentBoardId = get().boardId
      const operation = {
        operationId: `mira-backup:${nextOperationSequence()}`,
        ...(currentBoardId ? { boardId: currentBoardId } : {}),
      }
      setNotice('progress', '正在备份 Mira 数据…', operation)
      try {
        const backup = await v2Api.exportBackup()
        portableDownloads.downloadJson(backup, backupFileName())
        if (generation === navigation.boardGeneration) {
          setNotice('success', 'Mira 数据备份已下载。', operation)
        }
      } catch (error) {
        if (generation === navigation.boardGeneration) {
          setNotice('error', safeMessage(error), operation)
        }
        throw error
      }
    },
  }
}
