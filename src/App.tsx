import DrawerLeaveConfirmation from './v2/DrawerLeaveConfirmation'
import { InspectorDraftContext } from './v2/inspectorDrafts'
import { followCardSelection, saveInspectorDrafts, type InspectorDraft } from './v2/inspectorBehavior'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  SelectionMode, useReactFlow, ViewportPortal, type OnConnectEnd,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useV2Canvas } from './v2Store'
import {
  canvasInitialFocusNodeIds,
  canvasActiveBranchElementIds,
  canvasKeyboardIntent,
  canvasMinimumZoom,
  collisionFreeCanvasCardPosition,
  shouldFitCanvasBoard,
  workflowDraftFocusNodeIds,
  type CanvasRectangle,
} from './canvasOperations'
import {
  materializedPlanCanvasFocus,
  type MaterializedPlanFocusIntent,
} from './canvasViewport'
import { branchIntentFromConnection, edgeDrawerIntent } from './v2Projection'
import AppBar from './v2/AppBar'
import ContentCardNode from './v2/ContentCard'
import CanvasGroupNode from './v2/CanvasGroupNode'
import ContextDock from './v2/ContextDock'
import CanvasSelectionToolbar from './v2/CanvasSelectionToolbar'
import SourcePickerToolbar from './v2/SourcePickerToolbar'
import TransformationNode from './v2/TransformationNode'
import { WorkflowDraftStepNode, WorkflowDraftTargetNode } from './v2/WorkflowDraftNodes'
import NoticeRegion from './v2/NoticeRegion'
import useMobilePanelModal from './v2/useMobilePanelModal'
import useTaskViewport from './v2/useTaskViewport'
import {
  DrawerIntentContext,
  restoreDrawerEditingFocus,
  restoreFocusAfterRender,
} from './v2/drawerIntent'
import type { DrawerState } from './v2/storeTypes'
import { SourcePreviewContext, type SourcePreviewRequest } from './v2/sourcePreviewContext'
import type { BoardSummary } from './v2Api'
import {
  applyAppearance,
  browserAppearance,
  persistAppearance,
  reactFlowColorMode,
  type Appearance,
} from './v2/appearance'

const nodeTypes = {
  contentCard: ContentCardNode,
  canvasGroup: CanvasGroupNode,
  transformation: TransformationNode,
  workflowDraftStep: WorkflowDraftStepNode,
  workflowDraftTarget: WorkflowDraftTargetNode,
}
const DetailDrawer = lazy(() => import('./v2/DetailDrawer'))
const WorkflowLibrary = lazy(() => import('./v2/WorkflowLibrary'))
const ModelSettings = lazy(() => import('./v2/ModelSettings'))
const InspirationPicker = lazy(() => import('./v2/InspirationPicker'))
const FilePicker = lazy(() => import('./v2/FilePicker'))
const BoardManager = lazy(() => import('./v2/BoardManager'))
const BoardHistory = lazy(() => import('./v2/BoardHistory'))

function ModalTaskLoading({ label }: { label: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  return <dialog
    ref={dialogRef}
    className="v2-modal-loading"
    aria-modal="true"
    aria-label={label}
    onCancel={(event) => event.preventDefault()}
  ><span role="status">{label}</span></dialog>
}

function V2Canvas({ appearance, setAppearance }: {
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
}) {
  const nodes = useV2Canvas((state) => state.nodes)
  const edges = useV2Canvas((state) => state.edges)
  const board = useV2Canvas((state) => state.board)
  const boardId = useV2Canvas((state) => state.boardId)
  const loadState = useV2Canvas((state) => state.loadState)
  const selectedIds = useV2Canvas((state) => state.selectedCardIds)
  const drawer = useV2Canvas((state) => state.drawer)
  const branchDraft = useV2Canvas((state) => state.branchDraft)
  const workflowDraft = useV2Canvas((state) => state.workflowDraft)
  const sourcePicker = useV2Canvas((state) => state.sourcePicker)
  const applyingWorkflowId = useV2Canvas((state) => state.applyingWorkflowId)
  const deleteConfirmationIds = useV2Canvas((state) => state.deleteConfirmationIds)
  const multiSelectMode = useV2Canvas((state) => state.multiSelectMode)
  const alignmentGuides = useV2Canvas((state) => state.alignmentGuides)
  const boardCatalog = useV2Canvas((state) => state.boardCatalog)
  const boardCatalogState = useV2Canvas((state) => state.boardCatalogState)
  const boardCatalogError = useV2Canvas((state) => state.boardCatalogError)
  const load = useV2Canvas((state) => state.load)
  const switchBoard = useV2Canvas((state) => state.switchBoard)
  const createBoard = useV2Canvas((state) => state.createBoard)
  const refreshBoardCatalog = useV2Canvas((state) => state.refreshBoardCatalog)
  const renameBoard = useV2Canvas((state) => state.renameBoard)
  const archiveBoard = useV2Canvas((state) => state.archiveBoard)
  const trashBoard = useV2Canvas((state) => state.trashBoard)
  const restoreBoard = useV2Canvas((state) => state.restoreBoard)
  const purgeBoard = useV2Canvas((state) => state.purgeBoard)
  const exportBoardFile = useV2Canvas((state) => state.exportBoardFile)
  const importBoardFile = useV2Canvas((state) => state.importBoardFile)
  const backupMira = useV2Canvas((state) => state.backupMira)
  const createCard = useV2Canvas((state) => state.createCard)
  const onNodesChange = useV2Canvas((state) => state.onNodesChange)
  const onEdgesChange = useV2Canvas((state) => state.onEdgesChange)
  const onConnect = useV2Canvas((state) => state.onConnect)
  const beginBranch = useV2Canvas((state) => state.beginBranch)
  const openDrawer = useV2Canvas((state) => state.openDrawer)
  const setSelectedCardIds = useV2Canvas((state) => state.setSelectedCardIds)
  const cancelBranch = useV2Canvas((state) => state.cancelBranch)
  const copySelectedCards = useV2Canvas((state) => state.copySelectedCards)
  const pasteCards = useV2Canvas((state) => state.pasteCards)
  const duplicateSelectedCards = useV2Canvas((state) => state.duplicateSelectedCards)
  const requestDeleteSelectedCards = useV2Canvas((state) => state.requestDeleteSelectedCards)
  const cancelDeleteSelectedCards = useV2Canvas((state) => state.cancelDeleteSelectedCards)
  const selectAllCards = useV2Canvas((state) => state.selectAllCards)
  const clearSelection = useV2Canvas((state) => state.clearSelection)
  const undo = useV2Canvas((state) => state.undo)
  const redo = useV2Canvas((state) => state.redo)
  const sidePanel = useV2Canvas((state) => state.panel)
  const openPanel = useV2Canvas((state) => state.openPanel)
  const surfaceOpenerRef = useRef<HTMLElement | null>(null)
  const pendingSurfaceActionRef = useRef<symbol | null>(null)
  const modalTaskOpenerRef = useRef<HTMLElement | null>(null)
  const [inspirationPickerOpen, setInspirationPickerOpen] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [fileBindingCardId, setFileBindingCardId] = useState<string | null>(null)
  const [boardManagerOpen, setBoardManagerOpen] = useState(false)
  const [boardHistoryTarget, setBoardHistoryTarget] = useState<BoardSummary | null>(null)
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewRequest | null>(null)
  const closeSourcePreview = useCallback(() => {
    useV2Canvas.setState((state) => ({ detailSurfaceRevision: state.detailSurfaceRevision + 1 }))
    setSourcePreview(null)
    restoreFocusAfterRender(document.querySelector<HTMLTextAreaElement>('.v2-content-editor textarea'), ['.v2-content-sources button', '.v2-command-trigger'])
  }, [])
  useEffect(() => { setSourcePreview(null) }, [boardId, drawer, sidePanel, boardHistoryTarget])
  const mobilePanelIdentity = sourcePreview ? `source:${sourcePreview.cardId}` : drawer
    ? drawer.tab === 'content' || drawer.tab === 'versions'
      ? `drawer:${drawer.tab}:${drawer.cardId}`
      : drawer.tab === 'relation'
        ? `drawer:${drawer.tab}:${drawer.transformationId}`
        : `drawer:${drawer.tab}:${drawer.runId}`
    : sidePanel
      ? `panel:${sidePanel}`
      : boardHistoryTarget
        ? `history:${boardHistoryTarget.id}`
        : null
  useMobilePanelModal(sourcePicker ? null : mobilePanelIdentity, surfaceOpenerRef.current)
  useTaskViewport()
  const modalTaskOpen = inspirationPickerOpen || filePickerOpen || boardManagerOpen
  const previewSource = useCallback((request: SourcePreviewRequest) => {
    if (request.boardId !== boardId || modalTaskOpen || loadState !== 'ready') return
    useV2Canvas.setState((state) => ({ detailSurfaceRevision: state.detailSurfaceRevision + 1 }))
    setSourcePreview(request)
  }, [boardId, modalTaskOpen, loadState])
  const [drawerDirty, setDrawerDirty] = useState(false)
  const drawerDirtyRef = useRef(false)
  const [planDirty, setPlanDirty] = useState(false)
  const planDirtyRef = useRef(false)
  const handlePlanDirtyChange = useCallback((dirty: boolean) => { planDirtyRef.current = dirty; setPlanDirty(dirty) }, [])
  const inspectorDrafts = useRef(new Map<string, InspectorDraft>())
  const [switchingCard, setSwitchingCard] = useState(false)
  const [pendingDrawerIntent, setPendingDrawerIntent] = useState<(() => void) | null>(null)
  const fittedBoardId = useRef<string | null>(null)
  const fittedWorkflowDraft = useRef<string | null>(null)
  const pendingCardPlacements = useRef<Array<CanvasRectangle & { boardId: string; key: number }>>([])
  const nextCardPlacementKey = useRef(0)
  const manualViewportRevision = useRef(0)
  const pendingPlanFocus = useRef<MaterializedPlanFocusIntent | null>(null)
  const rf = useReactFlow()
  const minimumZoom = canvasMinimumZoom(nodes.length)
  const navigationPending = loadState === 'loading'
  const canvasShellRef = useCallback((element: HTMLDivElement | null) => {
    if (element) element.inert = navigationPending
  }, [navigationPending])

  useEffect(() => {
    if (!navigationPending) return
    const selector = '.v2-detail-drawer, .v2-workflow-library, .v2-model-settings, .v2-board-history'
    const previous = new Map<HTMLElement, boolean>()
    const lock = () => {
      document.querySelectorAll<HTMLElement>(selector).forEach((surface) => {
        if (!previous.has(surface)) previous.set(surface, surface.inert)
        surface.inert = true
      })
    }
    const observer = new MutationObserver(lock)
    observer.observe(document.querySelector('.v2-app') || document.body, {
      childList: true,
      subtree: true,
    })
    lock()
    return () => {
      observer.disconnect()
      previous.forEach((wasInert, surface) => { surface.inert = wasInert })
    }
  }, [navigationPending])

  const handleDrawerDirtyChange = useCallback((dirty: boolean) => {
    drawerDirtyRef.current = dirty
    setDrawerDirty(dirty)
  }, [])

  const requestDrawerIntent = useCallback((intent: () => void, switching = false) => {
    if ((drawer && drawerDirtyRef.current) || planDirtyRef.current) {
      setSwitchingCard(switching)
      setPendingDrawerIntent(() => intent)
      return
    }
    intent()
  }, [drawer])

  const rememberSurfaceOpener = useCallback(() => {
    const active = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null
    if (!active) return
    if (
      (drawer || sidePanel || boardHistoryTarget)
      && active.closest('.v2-detail-drawer, .v2-workflow-library, .v2-model-settings, .v2-board-history')
    ) return
    surfaceOpenerRef.current = active
  }, [boardHistoryTarget, drawer, sidePanel])

  const requestDrawerChange = useCallback((nextDrawer: DrawerState) => {
    if (nextDrawer) rememberSurfaceOpener()
    requestDrawerIntent(() => {
      if (nextDrawer) setBoardHistoryTarget(null)
      openDrawer(nextDrawer)
    })
  }, [openDrawer, rememberSurfaceOpener, requestDrawerIntent])

  const requestCardSelection = useCallback((cardIds: string[], explicit = true) => {
    const current = useV2Canvas.getState()
    if (current.sourcePicker) return
    const next = followCardSelection(current.drawer, cardIds, explicit && !current.multiSelectMode && !sourcePreview)
    if (!next) { setSelectedCardIds(cardIds); return }
    if (drawerDirtyRef.current && current.drawer && 'cardId' in current.drawer) setSelectedCardIds([current.drawer.cardId])
    const originBoard = current.boardId
    requestDrawerIntent(() => {
      const latest = useV2Canvas.getState()
      if (latest.boardId !== originBoard || !latest.board?.cards.some(card => card.id === cardIds[0])) return
      setSelectedCardIds(cardIds)
      openDrawer(next)
    }, true)
  }, [openDrawer, requestDrawerIntent, setSelectedCardIds, sourcePreview])

  const requestPanelChange = useCallback((nextPanel: Parameters<typeof openPanel>[0]) => {
    if (nextPanel) rememberSurfaceOpener()
    requestDrawerIntent(() => {
      if (nextPanel) setBoardHistoryTarget(null)
      openPanel(nextPanel)
    })
  }, [openPanel, rememberSurfaceOpener, requestDrawerIntent])

  const requestDrawerAction = useCallback((action: () => void | Promise<void>) => {
    rememberSurfaceOpener()
    requestDrawerIntent(() => {
      const token = Symbol('surface-action')
      pendingSurfaceActionRef.current = token
      setBoardHistoryTarget(null)
      if (drawer) openDrawer(null)
      const finish = () => {
        if (pendingSurfaceActionRef.current !== token) return
        pendingSurfaceActionRef.current = null
        const state = useV2Canvas.getState()
        if (!state.drawer && !state.panel) surfaceOpenerRef.current = null
      }
      void Promise.resolve().then(action).then(finish, finish)
    })
  }, [drawer, openDrawer, rememberSurfaceOpener, requestDrawerIntent])

  useEffect(() => {
    if (drawer || planDirtyRef.current) return
    drawerDirtyRef.current = false
    setDrawerDirty(false)
    setPendingDrawerIntent(null)
  }, [drawer])

  useEffect(() => {
    if (!mobilePanelIdentity && !pendingSurfaceActionRef.current) surfaceOpenerRef.current = null
  }, [mobilePanelIdentity])

  const rememberModalTaskOpener = useCallback(() => {
    modalTaskOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  }, [])

  const restoreModalTaskFocus = useCallback((fallbackSelectors: string[] = []) => {
    const opener = modalTaskOpenerRef.current
    modalTaskOpenerRef.current = null
    restoreFocusAfterRender(opener, [
      ...fallbackSelectors,
      '.v2-content-editor textarea:not(:disabled)',
      '.v2-detail-drawer h2',
      '.v2-workbench-navigation button[aria-label="灵感池"]',
      '.v2-command-trigger:not(:disabled)',
      '.v2-app-actions button:not(:disabled)',
    ])
  }, [])

  const persistCanvasCard = useCallback(async (anchor: { x: number; y: number }) => {
    if (!board) return
    const placementKey = nextCardPlacementKey.current += 1
    const occupied = [
      ...board.cards.map(({ x, y, width, height }) => ({ x, y, width, height })),
      ...pendingCardPlacements.current
        .filter((placement) => placement.boardId === board.id)
        .map(({ x, y, width, height }) => ({ x, y, width, height })),
    ]
    const position = collisionFreeCanvasCardPosition(anchor, occupied)
    pendingCardPlacements.current.push({
      ...position,
      width: 312,
      height: 208,
      boardId: board.id,
      key: placementKey,
    })
    await createCard(position)
    pendingCardPlacements.current = pendingCardPlacements.current
      .filter((placement) => placement.key !== placementKey)
  }, [board, createCard])

  const createCanvasCard = useCallback((anchor: { x: number; y: number }) => {
    requestDrawerAction(() => persistCanvasCard(anchor))
  }, [persistCanvasCard, requestDrawerAction])

  useEffect(() => { void load() }, [load])
  useEffect(() => useV2Canvas.subscribe((state, previous) => {
    if (state.boardId !== previous.boardId) {
      pendingPlanFocus.current = null
      pendingCardPlacements.current = []
    }
    if (
      !previous.applyingWorkflowId
      && state.applyingWorkflowId
      && state.boardId
      && state.board
      && state.workflowDraft
    ) {
      pendingPlanFocus.current = {
        boardId: state.boardId,
        viewportRevision: manualViewportRevision.current,
        previousTransformationIds: state.board.transformations.map((item) => item.id),
      }
    }
    if (
      previous.applyingWorkflowId
      && !state.applyingWorkflowId
      && state.workflowDraft
    ) pendingPlanFocus.current = null
  }), [])
  useEffect(() => {
    if (!shouldFitCanvasBoard(fittedBoardId.current, board?.id, loadState, nodes.length)) return
    fittedBoardId.current = board!.id
    const viewportRevision = manualViewportRevision.current
    const timer = window.setTimeout(() => {
      if (
        manualViewportRevision.current !== viewportRevision
        || useV2Canvas.getState().selectedCardIds.length > 0
        || document.querySelector('.v2-command-palette[open]')
      ) return
      const focusNodeIds = canvasInitialFocusNodeIds(nodes, window.innerWidth)
      const focusNodes = focusNodeIds.length > 0
        ? nodes.filter((node) => focusNodeIds.includes(node.id))
        : undefined
      void rf.fitView({
        padding: focusNodes ? 0.1 : 0.18,
        duration: 180,
        minZoom: minimumZoom,
        ...(focusNodes ? { nodes: focusNodes } : {}),
      })
    }, 190)
    return () => window.clearTimeout(timer)
  }, [board?.id, loadState, minimumZoom, nodes.length, rf])
  useEffect(() => {
    if (!workflowDraft) {
      fittedWorkflowDraft.current = null
      return
    }
    const key = `${workflowDraft.workflowId}:${workflowDraft.origin.x}:${workflowDraft.origin.y}`
    if (fittedWorkflowDraft.current === key) return
    const focusNodeIds = workflowDraftFocusNodeIds(nodes, workflowDraft.origin)
    const focusNodes = nodes.filter((node) => focusNodeIds.includes(node.id))
    if (focusNodes.length === 0) return
    const timer = window.setTimeout(() => {
      const measuredFocusNodes = rf.getNodes().filter((node) => focusNodeIds.includes(node.id))
      if (measuredFocusNodes.length === 0) return
      fittedWorkflowDraft.current = key
      void rf.fitView({
        nodes: measuredFocusNodes,
        padding: window.innerWidth < 720 ? 0.22 : 0.2,
        duration: 220,
        minZoom: window.innerWidth < 720 ? 0.6 : 0.62,
        maxZoom: window.innerWidth < 720 ? 1 : 0.9,
      }).then(() => {
        if (window.innerWidth >= 720) return
        const dockHeight = document.querySelector<HTMLElement>('.v2-context-dock')
          ?.getBoundingClientRect().height ?? 0
        if (dockHeight <= 0) return
        const viewport = rf.getViewport()
        void rf.setViewport(
          { ...viewport, y: viewport.y - Math.max(0, dockHeight / 2 - 8) },
          { duration: 100 },
        )
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [nodes, rf, workflowDraft])
  useEffect(() => {
    const intent = pendingPlanFocus.current
    if (!intent || applyingWorkflowId || workflowDraft || !board) return
    if (
      board.id !== intent.boardId
      || manualViewportRevision.current !== intent.viewportRevision
    ) {
      pendingPlanFocus.current = null
      return
    }
    const focus = materializedPlanCanvasFocus(intent, {
      boardId: board.id,
      viewportRevision: manualViewportRevision.current,
      board,
      nodes,
    })
    if (!focus) return
    const timer = window.setTimeout(() => {
      const current = useV2Canvas.getState()
      if (pendingPlanFocus.current !== intent) return
      if (
        current.boardId !== intent.boardId
        || !current.board
        || manualViewportRevision.current !== intent.viewportRevision
      ) {
        pendingPlanFocus.current = null
        return
      }
      const measuredNodes = rf.getNodes()
      const latestFocus = materializedPlanCanvasFocus(intent, {
        boardId: current.boardId,
        viewportRevision: manualViewportRevision.current,
        board: current.board,
        nodes: measuredNodes,
      })
      if (!latestFocus) return
      const focusNodes = measuredNodes.filter((node) => latestFocus.nodeIds.includes(node.id))
      pendingPlanFocus.current = null
      void rf.fitView({
        nodes: focusNodes,
        padding: window.innerWidth < 720 ? 0.14 : 0.16,
        duration: 220,
        minZoom: window.innerWidth < 720 ? 0.6 : 0.68,
        maxZoom: window.innerWidth < 720 ? 0.92 : 0.9,
      })
    }, 90)
    return () => window.clearTimeout(timer)
  }, [applyingWorkflowId, board, nodes, rf, workflowDraft])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || (event.target instanceof Element && event.target.closest('dialog'))) return
      if (loadState === 'loading') return
      if (useV2Canvas.getState().sourcePicker) {
        if (event.key === 'Escape') {
          event.preventDefault()
          useV2Canvas.getState().cancelSourcePicker()
        }
        return
      }
      const target = event.target as HTMLElement
      const typing = Boolean(target?.closest?.('input, textarea, select, button, summary, [contenteditable="true"]'))
      const selection = window.getSelection()
      const selectionReader = selection?.anchorNode?.parentElement?.closest('[data-card-reader]')
      const readerFocused = target?.closest?.('[data-card-reader]')
      if (!typing && (readerFocused || (selectionReader && !selection?.isCollapsed))) {
        if (event.key === 'Escape') {
          event.preventDefault()
          selection?.removeAllRanges()
          if (readerFocused instanceof HTMLElement) readerFocused.blur()
        }
        return
      }
      if (event.key === 'Escape') {
        const menu = document.querySelector<HTMLDetailsElement>('[data-context-menu][open]')
        if (menu) {
          event.preventDefault(); menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus(); return
        }
        if (sourcePreview) { event.preventDefault(); closeSourcePreview(); return }
        if (target?.closest?.('.v2-command-palette')) return
        if (target?.closest?.('.v2-modal-loading')) return
        if (target?.closest?.('.v2-board-manager')) return
        if (target?.closest?.('.v2-inspiration-picker')) return
        if (target?.closest?.('.v2-file-picker')) return
        if (filePickerOpen) {
          event.preventDefault()
          setFilePickerOpen(false)
        }
        else if (inspirationPickerOpen) {
          event.preventDefault()
          setInspirationPickerOpen(false)
        }
        else if (sidePanel) requestDrawerIntent(() => openPanel(null))
        else if (boardHistoryTarget) setBoardHistoryTarget(null)
        else if (drawer) requestDrawerIntent(() => openDrawer(null))
        else if (deleteConfirmationIds) cancelDeleteSelectedCards()
        else if (branchDraft) cancelBranch()
        else clearSelection()
        return
      }
      if (loadState !== 'ready') return
      if (typing) return
      const intent = canvasKeyboardIntent(event, selectedIds.length)
      if (intent === 'undo') {
        event.preventDefault()
        void undo()
        return
      }
      if (intent === 'redo') {
        event.preventDefault()
        void redo()
        return
      }
      if (intent === 'select-all') {
        event.preventDefault()
        selectAllCards()
        return
      }
      if (intent === 'copy') {
        event.preventDefault()
        copySelectedCards()
        return
      }
      if (intent === 'paste') {
        event.preventDefault()
        void pasteCards(rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))
        return
      }
      if (intent === 'duplicate') {
        event.preventDefault()
        void duplicateSelectedCards()
        return
      }
      if (intent === 'create') {
        event.preventDefault()
        createCanvasCard(rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))
        return
      }
      if (intent === 'delete') {
        event.preventDefault()
        requestDeleteSelectedCards()
        return
      }
      if (intent === 'edit') {
        const card = board?.cards.find((item) => item.id === selectedIds[0])
        if (card) requestDrawerChange({ tab: 'content', cardId: card.id, mode: 'edit' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [board, boardHistoryTarget, branchDraft, cancelBranch, cancelDeleteSelectedCards, clearSelection, copySelectedCards, createCanvasCard, deleteConfirmationIds, drawer, duplicateSelectedCards, filePickerOpen, inspirationPickerOpen, loadState, openDrawer, openPanel, pasteCards, redo, requestDeleteSelectedCards, requestDrawerChange, requestDrawerIntent, rf, selectAllCards, selectedIds, sidePanel, undo, sourcePreview, closeSourcePreview])

  useEffect(() => {
    const dismiss = (event: Event) => {
      document.querySelectorAll<HTMLDetailsElement>('[data-context-menu][open]').forEach((menu) => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false
      })
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [])

  const onConnectEnd: OnConnectEnd = (event, state) => {
    if (state.fromNode && state.toNode && state.isValid !== true) {
      void onConnect({ source: state.fromNode.id, target: state.toNode.id, sourceHandle: null, targetHandle: null })
      return
    }
    if (!state.fromNode || state.toNode || state.isValid === true || !state.pointer) return
    const sourceId = state.fromNode.id
    if (!board?.cards.some((card) => card.id === sourceId)) return
    const sourceIds = selectedIds.includes(sourceId) ? selectedIds : [sourceId]
    const targetPosition = rf.screenToFlowPosition(state.pointer)
    const intent = branchIntentFromConnection(sourceId, null, targetPosition)
    if (intent) beginBranch({ sourceCardIds: sourceIds, targetPosition })
    if ('preventDefault' in event) event.preventDefault()
  }

  const focusedElements = useMemo(() => {
    if (sourcePicker || workflowDraft || multiSelectMode || selectedIds.length === 0) return null
    const focus = canvasActiveBranchElementIds(nodes, edges, selectedIds)
    return {
      nodeIds: new Set(focus.nodeIds),
      edgeIds: new Set(focus.edgeIds),
    }
  }, [edges, multiSelectMode, nodes, selectedIds, workflowDraft, sourcePicker])
  const displayNodes = useMemo(() => sourcePicker
    ? nodes.map(node => ({ ...node, selected: sourcePicker.cardIds.includes(node.id), draggable: false,
      className: sourcePicker.cardIds.includes(node.id) ? 'is-source-picked' : '' }))
    : focusedElements
    ? nodes.map((node) => ({
      ...node,
      className: [node.className, node.type === 'canvasGroup' || focusedElements.nodeIds.has(node.id) ? 'is-focus-active' : 'is-focus-muted']
        .filter(Boolean).join(' '),
    }))
    : nodes, [focusedElements, nodes, sourcePicker])
  const displayEdges = useMemo(() => focusedElements
    ? edges.map((edge) => ({
      ...edge,
      className: [edge.className, focusedElements.edgeIds.has(edge.id) ? 'is-focus-active' : 'is-focus-muted']
        .filter(Boolean).join(' '),
    }))
    : edges, [edges, focusedElements])
  const drawerIntentController = useMemo(() => ({
    open: requestDrawerChange,
    run: requestDrawerAction,
    select: requestCardSelection,
  }), [requestDrawerAction, requestDrawerChange, requestCardSelection])

  return <SourcePreviewContext.Provider value={previewSource}><DrawerIntentContext.Provider value={drawerIntentController}><InspectorDraftContext.Provider value={inspectorDrafts.current}><main className={`v2-app ${drawer || sidePanel || boardHistoryTarget || sourcePreview ? 'has-drawer' : ''}${workflowDraft ? ' has-workflow-draft' : ''}`}>
    <AppBar
      createContentCard={createCanvasCard}
      onCanvas={() => requestDrawerIntent(() => { closeSourcePreview(); openDrawer(null); openPanel(null); setBoardHistoryTarget(null) })}
      appearance={appearance}
      onAppearanceChange={setAppearance}
      onSwitchBoard={(boardId) => requestDrawerIntent(() => { setBoardHistoryTarget(null); void switchBoard(boardId).catch(() => {}) })}
      onCloseBoard={(id) => requestDrawerIntent(() => { void useV2Canvas.getState().closeBoard(id).then(closed => { if (closed) setBoardHistoryTarget(null) }, () => {}) })}
      onCreateBoard={(title) => requestDrawerIntent(() => { setBoardHistoryTarget(null); void createBoard(title).catch(() => {}) })}
      commandBlocked={drawerDirty || planDirty || loadState === 'loading' || modalTaskOpen}
      inspirationPickerOpen={inspirationPickerOpen}
      openInspirationPicker={() => {
        rememberModalTaskOpener()
        setInspirationPickerOpen(true)
      }}
      filePickerOpen={filePickerOpen}
      openFilePicker={() => {
        rememberModalTaskOpener()
        requestDrawerIntent(() => {
          openDrawer(null)
          openPanel(null)
          setBoardHistoryTarget(null)
          setFilePickerOpen(true)
        })
      }}
      openPlanComposer={() => requestPanelChange('plan')}
      openWorkflowLibrary={() => requestPanelChange('workflow')}
      boardHistoryOpen={Boolean(boardHistoryTarget)}
      openBoardHistory={() => {
        if (!board) return
        rememberSurfaceOpener()
        requestDrawerIntent(() => {
          openDrawer(null)
          openPanel(null)
          setBoardHistoryTarget({
            id: board.id,
            title: board.title,
            state: 'active',
            revision: board.revision || 0,
            updatedAt: board.updatedAt,
          })
        })
      }}
      boardManagerOpen={boardManagerOpen}
      openBoardManager={() => requestDrawerIntent(() => {
        openDrawer(null)
        openPanel(null)
        setBoardHistoryTarget(null)
        setInspirationPickerOpen(false)
        setBoardManagerOpen(true)
        void refreshBoardCatalog().catch(() => {})
      })}
      openModelSettings={() => requestPanelChange('model')}
    />
    <div ref={canvasShellRef} className="v2-canvas-shell" aria-busy={loadState === 'loading'}>
      <ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} onConnectEnd={onConnectEnd}
        onMoveStart={(event) => { if (event) manualViewportRevision.current += 1 }}
        onNodeClick={(event, node) => {
          if ((event.target as HTMLElement).closest('button, a, summary, details, input, textarea')) return
          const selection = window.getSelection()
          if (selection && !selection.isCollapsed && selection.anchorNode?.parentElement?.closest('[data-card-reader]')) return
          if (sourcePicker) {
            if (node.type === 'contentCard') useV2Canvas.getState().toggleSourcePickerCard(node.id)
            return
          }
          if (node.type === 'transformation' && typeof node.data.transformationId === 'string') {
            requestDrawerChange({ tab: 'relation', transformationId: node.data.transformationId })
            return
          }
          if (!board?.cards.some((card) => card.id === node.id)) return
          requestCardSelection(
            !event.shiftKey && !multiSelectMode
              ? [node.id]
              : selectedIds.includes(node.id)
                ? selectedIds.filter((id) => id !== node.id)
                : [...selectedIds, node.id],
            !event.shiftKey && !multiSelectMode,
          )
        }}
        onEdgeClick={(_, edge) => {
          if (sourcePicker) return
          const intent = edgeDrawerIntent(edge.data)
          if (intent) requestDrawerChange(intent)
        }}
        onDoubleClick={(event) => {
          if (sourcePicker) return
          const target = event.target as HTMLElement
          if (!target.classList?.contains('react-flow__pane')) return
          createCanvasCard(rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
        }}
        fitView minZoom={minimumZoom} maxZoom={2} selectionOnDrag={!sourcePicker} selectionMode={SelectionMode.Partial}
        nodesConnectable={!sourcePicker}
        panOnDrag={!multiSelectMode} nodeDragThreshold={4} multiSelectionKeyCode="Shift" deleteKeyCode={null}
        colorMode={reactFlowColorMode(appearance)} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Lines} gap={28} size={1} color="var(--mira-grid)" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap className="v2-minimap" pannable zoomable nodeColor="var(--mira-minimap-node)" />
        {loadState === 'ready' && nodes.length === 0 && <div className="v2-empty-canvas"><strong>{board ? '开始一个课题' : '未打开画板'}</strong>{board
          ? <button type="button" onClick={() => void createCanvasCard(rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))}>写下第一张卡</button>
          : <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('.v2-board-menu-trigger')?.click()}>选择或新建画板</button>}</div>}
        {loadState === 'loading' && <div className="v2-canvas-loading"><i /><i /><i /></div>}
        {loadState === 'error' && <div className="v2-load-error"><strong>画板暂时没有打开</strong><button type="button" onClick={() => void load()}>重新加载</button></div>}
        {alignmentGuides && alignmentGuides.length > 0 && <ViewportPortal>
          {alignmentGuides.map((guide) => (
            <div
              key={`${guide.axis}:${guide.position}:${guide.from}:${guide.to}`}
              className={`v2-alignment-guide v2-alignment-guide-${guide.axis}`}
              style={guide.axis === 'vertical'
                ? { left: guide.position, top: guide.from, height: guide.to - guide.from }
                : { top: guide.position, left: guide.from, width: guide.to - guide.from }}
            />
          ))}
        </ViewportPortal>}
      </ReactFlow>
      {sourcePicker ? <SourcePickerToolbar /> : <><CanvasSelectionToolbar /><ContextDock /></>}
    </div>
    {(drawer || sidePanel || boardHistoryTarget || sourcePreview) && <button
      className="v2-drawer-scrim"
      type="button"
      aria-label="关闭侧栏"
      onClick={() => sourcePreview ? closeSourcePreview() : requestDrawerIntent(() => { openDrawer(null); openPanel(null); setBoardHistoryTarget(null) })}
    />}
    {(drawer || sidePanel || boardHistoryTarget || sourcePreview) && <Suspense fallback={<ModalTaskLoading label="正在打开侧栏" />}>
      {(sidePanel || boardHistoryTarget) && <div className="v2-preserved-panel" hidden={Boolean(sourcePreview)}>{boardHistoryTarget
        ? <BoardHistory target={boardHistoryTarget} onClose={() => setBoardHistoryTarget(null)} />
        : sidePanel === 'workflow' || sidePanel === 'plan'
        ? <WorkflowLibrary
          key={boardId}
          onClose={() => openPanel(null)}
          onDirtyChange={handlePlanDirtyChange}
          onRequestLeave={requestDrawerIntent}
          initialView={sidePanel === 'plan' ? 'plan' : 'library'}
          draftOrigin={rf.screenToFlowPosition({ x: 120, y: 220 })}
        />
        : sidePanel === 'model'
          ? <ModelSettings onClose={() => openPanel(null)} />
          : null}</div>}
      {((!sidePanel && !boardHistoryTarget) || sourcePreview) && <DetailDrawer
            sourcePreview={sourcePreview}
            onCloseSource={closeSourcePreview}
            onDirtyChange={handleDrawerDirtyChange}
            onRequestDrawerChange={requestDrawerChange}
            onOpenFileBindingPicker={(cardId) => {
              rememberModalTaskOpener()
              setFileBindingCardId(cardId)
              setFilePickerOpen(true)
            }}
          />}
    </Suspense>}
    {pendingDrawerIntent && <DrawerLeaveConfirmation
      plan={planDirty}
      switching={switchingCard}
      onSave={drawer?.tab === 'content' ? async () => {
        const origin = useV2Canvas.getState()
        const saved = await saveInspectorDrafts(inspectorDrafts.current, () => {
          const current = useV2Canvas.getState()
          return current.boardId === origin.boardId && current.drawer === origin.drawer
        })
        if (!saved) return false
        setPendingDrawerIntent(null)
        pendingDrawerIntent()
        return true
      } : undefined}
      onContinue={() => {
        setPendingDrawerIntent(null)
        if (planDirty) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.v2-plan-composer input')?.focus())
        else restoreDrawerEditingFocus(document)
      }}
      onDiscard={() => {
          const intent = pendingDrawerIntent
          setPendingDrawerIntent(null)
          intent()
      }}
    />}
    {inspirationPickerOpen && <Suspense fallback={<ModalTaskLoading label="正在打开灵感选择器" />}>
      <InspirationPicker
        anchor={rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })}
        onClose={() => {
          setInspirationPickerOpen(false)
          restoreModalTaskFocus()
        }}
      />
    </Suspense>}
    {filePickerOpen && <Suspense fallback={<ModalTaskLoading label="正在打开文件选择器" />}>
      <FilePicker
        anchor={rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })}
        mode={fileBindingCardId ? 'binding' : 'card'}
        cardId={fileBindingCardId || undefined}
        onClose={(outcome) => {
          const wasBinding = Boolean(fileBindingCardId)
          setFilePickerOpen(false)
          setFileBindingCardId(null)
          restoreModalTaskFocus(wasBinding
            ? ['.v2-file-binding button:not(:disabled)', '.v2-detail-drawer button:not(:disabled)']
            : [])
        }}
      />
    </Suspense>}
    {boardManagerOpen && <Suspense fallback={<ModalTaskLoading label="正在打开画板管理" />}>
      <BoardManager
        entries={boardCatalog}
        currentBoardId={board?.id || null}
        loading={boardCatalogState === 'loading'}
        error={boardCatalogError}
        onClose={() => setBoardManagerOpen(false)}
        onReload={refreshBoardCatalog}
        onOpen={switchBoard}
        onCreate={createBoard}
        onRename={renameBoard}
        onArchive={archiveBoard}
        onTrash={trashBoard}
        onRestore={restoreBoard}
        onPurge={purgeBoard}
        onExport={exportBoardFile}
        onImport={importBoardFile}
        onBackup={backupMira}
        onHistory={(entry) => {
          setBoardManagerOpen(false)
          surfaceOpenerRef.current = document.querySelector<HTMLElement>('.v2-app-bar [aria-label="更多"]')
          setBoardHistoryTarget(entry)
        }}
      />
    </Suspense>}
    <NoticeRegion />
  </main></InspectorDraftContext.Provider></DrawerIntentContext.Provider></SourcePreviewContext.Provider>
}

export default function App() {
  const [appearance, setAppearance] = useState<Appearance>(browserAppearance)
  useEffect(() => {
    applyAppearance(document.documentElement, appearance)
    try { persistAppearance(localStorage, appearance) } catch {}
  }, [appearance])
  return <ReactFlowProvider><V2Canvas appearance={appearance} setAppearance={setAppearance} /></ReactFlowProvider>
}
