import { useEffect, useRef, useState } from 'react'
import { FilePlus2, FolderOpen, History, Lightbulb, ListTodo, MousePointer2, Palette, Plus, Redo2, Search, Settings2, Undo2, X, Workflow } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useV2Canvas } from '../v2Store'
import { cardFocusViewport } from '../canvasOperations'
import type { Appearance } from './appearance'
import AppearanceSwitcher from './AppearanceSwitcher'
import CommandPalette, { type CommandItem } from './CommandPalette'
import { WorkbenchNavigation } from './WorkbenchNavigation'
import BoardMenu from './BoardMenu'
import { useCardSelection } from './drawerIntent'
import { useWorkbenchPreference } from './workbenchPreferences'

const BLOCKING_OVERLAY_SELECTOR = 'dialog[open]:not(.v2-command-palette), [aria-modal="true"]:not(.v2-command-palette)'

export function hasBlockingOverlay(root: Pick<Document, 'querySelector'> = document) {
  return Boolean(root.querySelector(BLOCKING_OVERLAY_SELECTOR))
}

export function canOpenCommandPalette(
  commandBlocked: boolean,
  root: Pick<Document, 'querySelector'> = document,
) {
  return !commandBlocked && !hasBlockingOverlay(root)
}

export function restoreAppBarTriggerFocus(
  trigger: {
    focus: () => void
    isConnected?: boolean
    disabled?: boolean
    getClientRects?: () => ArrayLike<unknown>
  } | null,
  fallbacks: Array<{
    focus: () => void
    isConnected?: boolean
    disabled?: boolean
    getClientRects?: () => ArrayLike<unknown>
  } | null> = [],
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  const available = (target: typeof trigger) => Boolean(
    target
    && target.isConnected !== false
    && target.disabled !== true
    && (!target.getClientRects || target.getClientRects().length > 0),
  )
  if (![trigger, ...fallbacks].some(available)) return false
  schedule(() => [trigger, ...fallbacks].find(available)?.focus())
  return true
}

export default function AppBar({
  inspirationPickerOpen = false,
  openInspirationPicker = () => {},
  createContentCard,
  filePickerOpen = false,
  openFilePicker = () => {},
  openPlanComposer,
  openWorkflowLibrary,
  boardManagerOpen = false,
  openBoardManager = () => {},
  boardHistoryOpen = false,
  openBoardHistory = () => {},
  openModelSettings,
  appearance,
  onAppearanceChange,
  onSwitchBoard,
  onCloseBoard,
  onCreateBoard,
  commandBlocked = false,
  onCanvas = () => {},
}: {
  inspirationPickerOpen?: boolean
  openInspirationPicker?: () => void
  createContentCard?: (anchor: { x: number; y: number }) => void | Promise<void>
  filePickerOpen?: boolean
  openFilePicker?: () => void
  openPlanComposer: () => void
  openWorkflowLibrary: () => void
  boardManagerOpen?: boolean
  openBoardManager?: () => void
  boardHistoryOpen?: boolean
  openBoardHistory?: () => void
  openModelSettings: () => void
  appearance?: Appearance
  onAppearanceChange?: (appearance: Appearance) => void
  onSwitchBoard?: (boardId: string) => void | Promise<void>
  onCloseBoard?: (boardId: string) => void
  onCreateBoard?: (title: string) => void
  commandBlocked?: boolean
  onCanvas?: () => void
}) {
  const selectCards = useCardSelection(useV2Canvas(state => state.setSelectedCardIds))
  const boardId = useV2Canvas((state) => state.boardId)
  const board = useV2Canvas((state) => state.board)
  const panel = useV2Canvas((state) => state.panel)
  const [grid, setGrid] = useWorkbenchPreference('grid', ['visible', 'hidden'], 'visible')
  useEffect(() => {
    document.documentElement.dataset.canvasGrid = grid
    return () => { delete document.documentElement.dataset.canvasGrid }
  }, [grid])
  const [navigation, setNavigation] = useWorkbenchPreference('navigation', ['expanded', 'collapsed'], 'expanded')
  useEffect(() => {
    document.documentElement.dataset.navigationCollapsed = String(navigation === 'collapsed')
    return () => { delete document.documentElement.dataset.navigationCollapsed }
  }, [navigation])
  const loadState = useV2Canvas((state) => state.loadState)
  const saveState = useV2Canvas((state) => state.saveState)
  const switchBoard = useV2Canvas((state) => state.switchBoard)
  const createCard = useV2Canvas((state) => state.createCard)
  const multiSelectMode = useV2Canvas((state) => state.multiSelectMode)
  const toggleMultiSelectMode = useV2Canvas((state) => state.toggleMultiSelectMode)
  const historyPast = useV2Canvas((state) => state.historyPast)
  const historyFuture = useV2Canvas((state) => state.historyFuture)
  const historyState = useV2Canvas((state) => state.historyState)
  const undo = useV2Canvas((state) => state.undo)
  const redo = useV2Canvas((state) => state.redo)
  const rf = useReactFlow()
  const [menu, setMenu] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const boardsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const commandButtonRef = useRef<HTMLButtonElement>(null)
  const commandPaletteTriggerRef = useRef<HTMLElement | null>(null)
  const boardManagerTriggerRef = useRef<HTMLElement | null>(null)
  const switchBoardAction = onSwitchBoard || switchBoard
  const canvasUnavailable = loadState !== 'ready' || !boardId
  const navigationPending = loadState === 'loading'

  useEffect(() => {
    if (boardManagerOpen || !boardManagerTriggerRef.current) return
    const trigger = boardManagerTriggerRef.current
    boardManagerTriggerRef.current = null
    restoreAppBarTriggerFocus(trigger, [commandButtonRef.current, boardsButtonRef.current])
  }, [boardManagerOpen])

  useEffect(() => {
    if (!menu) return
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    })
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return
      setMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenu(false)
      settingsButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menu])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (!canOpenCommandPalette(commandBlocked)) return
      setMenu(false)
      if (!commandOpen) {
        commandPaletteTriggerRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : commandButtonRef.current
      }
      setCommandOpen((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandBlocked, commandOpen])

  const center = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const addContent = createContentCard || createCard
  const locateCard = (cardId: string) => {
    const current = useV2Canvas.getState()
    if (current.loadState !== 'ready' || current.boardId !== boardId || !current.board?.cards.some((card) => card.id === cardId)) return
    selectCards([cardId])
    requestAnimationFrame(() => {
      if (useV2Canvas.getState().boardId !== boardId) return
      const node = rf.getNode(cardId)
      const canvas = document.querySelector<HTMLElement>('.v2-canvas-shell')?.getBoundingClientRect()
      if (!node || !canvas) return
      let top = canvas.top + 16
      let bottom = canvas.bottom - 16
      let right = canvas.right - 16
      const visibleRect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        return element?.getClientRects().length ? element.getBoundingClientRect() : null
      }
      const toolbar = visibleRect('.v2-selection-toolbar')
      const dock = visibleRect('.v2-context-dock')
      const panel = visibleRect('.v2-detail-drawer, .v2-workflow-library, .v2-model-settings')
      if (toolbar) top = Math.max(top, toolbar.bottom + 16)
      if (dock) bottom = Math.min(bottom, dock.top - 16)
      if (panel) right = Math.min(right, panel.left - 16)
      const viewport = cardFocusViewport(node, {
        x: 16, y: top - canvas.top,
        width: Math.max(1, right - canvas.left - 16), height: Math.max(1, bottom - top),
      })
      // A nonzero transition interrupts any initial-fit animation still in flight.
      void rf.setViewport(viewport, { duration: 1 }).then(() => {
        if (useV2Canvas.getState().boardId !== boardId) return
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(cardId)}"]`)
          ?.focus({ preventScroll: true })
      })
    })
  }
  const runToolbarAction = (action: () => void) => {
    setMenu(false)
    if (menu) settingsButtonRef.current?.focus()
    action()
  }
  const commands: CommandItem[] = [
    { id: 'content', label: '新建内容卡', description: '在当前视口创建并开始编辑', shortcut: 'N', icon: <Plus size={17} />, disabled: canvasUnavailable, action: () => { void addContent(center()) } },
    { id: 'file', label: '添加文件材料', description: '浏览 workspace 或备份外部文件', icon: <FilePlus2 size={17} />, disabled: canvasUnavailable, action: openFilePicker },
    { id: 'inspiration', label: '打开灵感池', description: '记录灵感或添加到当前画板', icon: <Lightbulb size={17} />, action: openInspirationPicker },
    { id: 'plan', label: '搭一个计划', description: '只铺步骤，不自动运行', icon: <ListTodo size={17} />, disabled: canvasUnavailable, action: openPlanComposer },
    { id: 'workflow', label: '方法与计划', description: '搭计划或使用已经验证的方法', icon: <Workflow size={17} />, disabled: canvasUnavailable, action: openWorkflowLibrary },
    { id: 'select', label: multiSelectMode ? '结束多选' : '进入多选', description: '按顺序组织多个来源', icon: <MousePointer2 size={17} />, disabled: canvasUnavailable, action: toggleMultiSelectMode },
    { id: 'undo', label: '撤销', description: '撤销最近一次受支持的卡片操作', shortcut: '⌘Z', icon: <Undo2 size={17} />, disabled: canvasUnavailable || historyPast.length === 0 || historyState === 'applying', action: () => { void undo() } },
    { id: 'redo', label: '重做', description: '重新应用刚刚撤销的卡片操作', shortcut: '⇧⌘Z', icon: <Redo2 size={17} />, disabled: canvasUnavailable || historyFuture.length === 0 || historyState === 'applying', action: () => { void redo() } },
    { id: 'history', label: '画布版本', description: '保存、比较或从稳定版本创建副本', icon: <History size={17} />, disabled: canvasUnavailable, action: openBoardHistory },
    { id: 'boards', label: '管理画板', description: '新建、归档、导入或备份', icon: <FolderOpen size={17} />, disabled: navigationPending, action: () => { boardManagerTriggerRef.current = commandPaletteTriggerRef.current; openBoardManager() } },
    { id: 'models', label: '模型设置', description: '配置默认模型与连接', icon: <Settings2 size={17} />, disabled: navigationPending, action: openModelSettings },
  ]
  if (appearance && onAppearanceChange) commands.push({
    id: 'appearance',
    label: '调整外观',
    description: '切换设计方向与明暗',
    icon: <Palette size={17} />,
    action: () => setMenu(true),
  })
  return <><header className="v2-app-bar">
    <div className="v2-app-location"><strong className="v2-brand" aria-label="Mira">mira.</strong>
    <BoardMenu ref={boardsButtonRef} onSwitch={id => { void switchBoardAction(id) }}
      onCloseBoard={onCloseBoard || (id => { void useV2Canvas.getState().closeBoard(id).catch(() => {}) })}
      onCreate={onCreateBoard || (title => { void useV2Canvas.getState().createBoard(title).catch(() => {}) })}
      onManage={() => runToolbarAction(() => { boardManagerTriggerRef.current = boardsButtonRef.current; openBoardManager() })} />
    <span className={`v2-save-state ${saveState}`}>{saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : ''}</span></div>
    <button ref={commandButtonRef} className="v2-command-trigger" aria-label="搜索或执行命令" type="button" aria-haspopup="dialog" aria-expanded={commandOpen} disabled={commandBlocked} onClick={() => {
      if (!canOpenCommandPalette(commandBlocked)) return
      commandPaletteTriggerRef.current = commandButtonRef.current
      setMenu(false)
      setCommandOpen(true)
    }}>
      <Search size={16} /><span>搜索卡片或命令</span><kbd>⌘K</kbd>
    </button>
    <div className="v2-app-actions">
      <button className="v2-icon-button v2-history-command" type="button" aria-label="撤销" title="撤销 (Ctrl/⌘ Z)" disabled={canvasUnavailable || historyPast.length === 0 || historyState === 'applying'} onClick={() => void undo()}><Undo2 size={17} /></button>
      <button className="v2-icon-button v2-history-command" type="button" aria-label="重做" title="重做 (Ctrl/⌘ Shift Z)" disabled={canvasUnavailable || historyFuture.length === 0 || historyState === 'applying'} onClick={() => void redo()}><Redo2 size={17} /></button>
      <button ref={settingsButtonRef} className="v2-icon-button" type="button" aria-label="系统设置" title="系统设置" aria-haspopup="dialog" aria-controls="mira-more-menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Settings2 size={18} /></button>
    </div>
    <div ref={menuRef} id="mira-more-menu" className="v2-more-menu is-settings" hidden={!menu} role="dialog" aria-label="系统设置">
      <header className="v2-settings-heading"><h2>系统设置</h2><button className="v2-icon-button" type="button" aria-label="关闭系统设置" onClick={() => { setMenu(false); settingsButtonRef.current?.focus() }}><X size={16} /></button></header>
      <label className="v2-grid-setting"><span>显示网格线<small>仅改变画布背景</small></span><input type="checkbox" role="switch" checked={grid === 'visible'} onChange={(event) => setGrid(event.target.checked ? 'visible' : 'hidden')} /></label>
      {appearance && onAppearanceChange && <AppearanceSwitcher appearance={appearance} onChange={onAppearanceChange} embedded />}
      <button className="v2-settings-models" type="button" disabled={navigationPending} onClick={() => runToolbarAction(openModelSettings)}><Settings2 size={15} />模型设置</button>
    </div>
    <CommandPalette key={boardId} open={commandOpen} commands={commands}
      cards={canvasUnavailable ? [] : board?.cards} onLocateCard={locateCard}
      onClose={() => {
        setCommandOpen(false)
        restoreAppBarTriggerFocus(commandPaletteTriggerRef.current, [commandButtonRef.current, boardsButtonRef.current])
      }} />
  </header>
  <WorkbenchNavigation active={inspirationPickerOpen ? 'inspiration' : filePickerOpen ? 'file' : boardHistoryOpen ? 'history' : panel === 'plan' || panel === 'workflow' ? 'workflow' : 'canvas'}
    collapsed={navigation === 'collapsed'} unavailable={canvasUnavailable}
    onCreate={() => runToolbarAction(() => { void addContent(center()) })} onMultiSelect={() => runToolbarAction(toggleMultiSelectMode)} multiSelectMode={multiSelectMode}
    onCanvas={() => runToolbarAction(onCanvas)} onInspiration={() => runToolbarAction(openInspirationPicker)}
    onWorkflow={() => runToolbarAction(openWorkflowLibrary)} onFile={() => runToolbarAction(openFilePicker)}
    onPlan={() => runToolbarAction(openPlanComposer)} onHistory={() => runToolbarAction(openBoardHistory)}
    onToggle={() => setNavigation((current) => current === 'expanded' ? 'collapsed' : 'expanded')} />
  </>
}
