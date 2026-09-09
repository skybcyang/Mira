import { readStyles } from '../../test/helpers/read-styles.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2 } from '../domain'
import { projectV2Board } from '../v2Projection'
import { useV2Canvas } from '../v2Store'
import { CanvasSelectionToolbarView } from './CanvasSelectionToolbar'
import { restoreAppBarTriggerFocus } from './AppBar'

const now = '2026-08-23T00:00:00.000Z'
const board = {
  schemaVersion: 2,
  id: 'board-1',
  title: '课题',
  cards: [{
    id: 'card-1', contentKind: 'markdown', x: 0, y: 0, width: 300, height: 180,
    headVersionId: null, versions: [], createdAt: now, updatedAt: now,
  }],
  transformations: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: now,
  updatedAt: now,
} satisfies BoardV2

function renderToolbar() {
  const state = useV2Canvas.getState()
  return renderToStaticMarkup(createElement(CanvasSelectionToolbarView, {
    selectedCount: state.selectedCardIds.length,
    clipboardCount: state.clipboard?.items.length || 0,
    deleteConfirmationCount: state.deleteConfirmationIds?.length || 0,
    multiSelectMode: state.multiSelectMode,
    onCopy() {}, onPaste() {}, onDuplicate() {}, onRequestDelete() {},
    onCancelDelete() {}, onConfirmDelete() {}, onClearSelection() {},
    onClearClipboard() {}, onToggleMultiSelect() {},
  }))
}

beforeEach(() => {
  useV2Canvas.setState({
    boardId: board.id,
    board,
    ...projectV2Board(board, {}),
    selectedCardIds: [],
    clipboard: null,
    deleteConfirmationIds: null,
    message: null,
  })
})

describe('canvas selection toolbar', () => {
  it('keeps the empty-state command on the hit layer and routes every content entry through one command', async () => {
    const [app, styles] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readStyles(new URL('../styles.css', import.meta.url)),
    ])

    expect(app).toMatch(/const createCanvasCard\s*=/)
    expect(app).toMatch(/createContentCard=\{createCanvasCard\}/)
    expect(app).toMatch(/intent === 'create'[\s\S]*createCanvasCard/)
    expect(app).toMatch(/onDoubleClick=[\s\S]*createCanvasCard/)
    expect(app).toMatch(/v2-empty-canvas[\s\S]*onClick=\{\(\) => void createCanvasCard/)
    expect(app).not.toContain('setInspirationFocusSequence')
    expect(styles).toMatch(/\.v2-empty-canvas\s*\{[^}]*z-index:\s*\d+;[^}]*pointer-events:\s*none;/s)
    expect(styles).toMatch(/\.v2-empty-canvas button\s*\{[^}]*pointer-events:\s*auto;/s)
  })

  it('routes a single card click through the guarded contextual selection', async () => {
    const [app, card] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).not.toMatch(/if \(!event\.shiftKey && !multiSelectMode\) \{\s*openDrawer\(\{ tab: 'content', cardId: node\.id \}\)/)
    expect(app).toMatch(/requestCardSelection\(\s*!event\.shiftKey && !multiSelectMode\s*\? \[node\.id\]/)
    expect(app).toContain("if (intent === 'edit')")
    expect(card).toContain("openDrawer({ tab: 'content', cardId: id, mode: 'edit' })")
    expect(card).toContain("openDrawer({ tab: 'content', cardId: id, mode: 'read' })")
    expect(card).not.toContain('onDoubleClick')
    expect(card).not.toContain('v2-card-editor')
  })

  it('keeps progress and stop actions reachable on a running target without selecting the card', async () => {
    const card = await readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8')

    expect(card).toContain('Activity')
    expect(card).toContain('aria-label="查看运行进度"')
    expect(card).toContain("openDrawer({ tab: 'run', runId: data.runId! })")
    expect(card).toContain('aria-label="停止生成"')
    expect(card).toMatch(/aria-label="查看运行进度"[\s\S]{0,240}stopPropagation\(\)/)
    expect(card).toMatch(/aria-label="停止生成"[\s\S]{0,240}stopPropagation\(\)/)
  })

  it('tolerates small pointer movement before treating a card gesture as a drag', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toContain('nodeDragThreshold={4}')
  })

  it('offers touch-accessible copy, duplicate, delete, and clear commands for a selection', () => {
    useV2Canvas.getState().setSelectedCardIds(['card-1'])

    const html = renderToolbar()

    expect(html).toContain('已选 1 张')
    expect(html).toContain('aria-label="复制卡片"')
    expect(html).toContain('aria-label="创建副本"')
    expect(html).toContain('aria-label="删除卡片"')
    expect(html).toContain('aria-label="取消选择"')
  })

  it('keeps paste reachable after changing boards or clearing selection', () => {
    useV2Canvas.setState({
      clipboard: {
        items: [{
          contentKind: 'markdown', markdown: '内容', width: 300, height: 180,
          offsetX: -150, offsetY: -90,
        }],
        pasteCount: 0,
      },
    })

    const html = renderToolbar()

    expect(html).toContain('已复制 1 张')
    expect(html).toContain('aria-label="粘贴卡片"')
  })

  it('keeps undo and redo in the header with the existing history actions', async () => {
    const appBar = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')
    const history = appBar.match(
      /<div className="v2-app-actions">([\s\S]*?)<\/div>/,
    )?.[1]

    expect(history).toContain('onClick={() => void undo()}')
    expect(history).toContain('onClick={() => void redo()}')
    expect(history).toContain("historyState === 'applying'")
  })

  it('keeps work tools direct and settings separate while retaining searchable commands', async () => {
    const appBar = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')
    const primaryActions = appBar.match(
      /<div className="v2-app-actions">([\s\S]*?)<\/div>/,
    )?.[1]
    const moreMenu = appBar.match(
      /id="mira-more-menu"([\s\S]*?)<CommandPalette/,
    )?.[1]

    expect(primaryActions).toContain('系统设置')
    expect(primaryActions).not.toContain('新建内容')
    expect(appBar).toContain('<WorkbenchNavigation')
    expect(primaryActions).not.toContain('v2-multi-select-command')
    expect(primaryActions).not.toContain('v2-file-command')
    expect(primaryActions).not.toContain('v2-plan-command')
    expect(primaryActions).not.toContain('v2-workflow-command')
    expect(primaryActions).not.toContain('v2-board-manager-command')
    expect(appBar).toContain('onFile=')
    expect(appBar).toContain('onPlan=')
    expect(appBar).toContain('onHistory=')
    expect(appBar).toContain('onWorkflow=')
    expect(appBar).toContain('<BoardMenu')
    expect(appBar).toContain('openBoardManager()')
    expect(moreMenu).toContain('模型设置')
    expect(appBar).toContain("id: 'file'")
    expect(appBar).toContain("id: 'plan'")
    expect(appBar).toContain("id: 'workflow'")
    expect(appBar).toContain("id: 'boards'")
    expect(appBar).toContain("id: 'models'")
  })

  it('lazy-loads BoardManager and exposes it from desktop and mobile AppBar commands', async () => {
    const [app, appBar] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toMatch(/const BoardManager = lazy\(\(\) => import\('\.\/v2\/BoardManager'\)\)/)
    expect(app).toMatch(/boardManagerOpen && <Suspense[\s\S]*<BoardManager/)
    expect(appBar).toMatch(
      /runToolbarAction\(\(\) => \{ boardManagerTriggerRef\.current = boardsButtonRef\.current; openBoardManager\(\) \}\)/,
    )
    expect(appBar).not.toContain('<h3>新建画板</h3>')
  })

  it('exposes canvas versions from AppBar commands', async () => {
    const source = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')

    expect(source).toContain("id: 'history'")
    expect(source).toContain('画布版本')
    expect(source).toContain('openBoardHistory')
  })

  it('uses a real blocking modal while lazy dialog code is loading', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toContain('function ModalTaskLoading')
    expect(app).toMatch(/inspirationPickerOpen && <Suspense fallback=\{<ModalTaskLoading/)
    expect(app).toMatch(/filePickerOpen && <Suspense fallback=\{<ModalTaskLoading/)
    expect(app).toMatch(/boardManagerOpen && <Suspense fallback=\{<ModalTaskLoading/)
    expect(app).toMatch(/<Suspense fallback=\{<ModalTaskLoading label="正在打开侧栏"/)
    expect(app).toContain("target?.closest?.('.v2-modal-loading')")
    expect(app).toMatch(/commandBlocked=\{drawerDirty \|\| planDirty \|\| loadState === 'loading' \|\| modalTaskOpen\}/)
  })

  it('keeps the opener across an asynchronous action until its detail surface mounts', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toContain('pendingSurfaceActionRef')
    expect(app).toMatch(/requestDrawerAction[\s\S]*pendingSurfaceActionRef\.current[\s\S]*Promise\.resolve\(\)\.then\(action\)/)
    expect(app).toMatch(/!mobilePanelIdentity && !pendingSurfaceActionRef\.current/)
    expect(app).toMatch(/active\.closest\('\.v2-detail-drawer, \.v2-workflow-library, \.v2-model-settings, \.v2-board-history'\)/)
  })

  it('restores focus to the header board trigger after BoardManager closes', async () => {
    const focus = vi.fn()
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const appBar = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')

    expect(restoreAppBarTriggerFocus({ focus }, [], schedule)).toBe(true)
    expect(schedule).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(restoreAppBarTriggerFocus(null, [], schedule)).toBe(false)
    expect(appBar).toMatch(/boardManagerTriggerRef\.current = boardsButtonRef\.current/)
  })

  it('falls back to a connected AppBar control when the original trigger unmounts', () => {
    const detachedFocus = vi.fn()
    const fallbackFocus = vi.fn()
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    expect(restoreAppBarTriggerFocus(
      { focus: detachedFocus, isConnected: false },
      [{ focus: fallbackFocus, isConnected: true, getClientRects: () => [{ width: 40 }] }],
      schedule,
    )).toBe(true)
    expect(detachedFocus).not.toHaveBeenCalled()
    expect(fallbackFocus).toHaveBeenCalledOnce()
  })

  it('skips a disabled AppBar fallback while board navigation is pending', () => {
    const disabledFocus = vi.fn()
    const moreFocus = vi.fn()
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    expect(restoreAppBarTriggerFocus(
      null,
      [
        { focus: disabledFocus, isConnected: true, disabled: true, getClientRects: () => [{ width: 180 }] },
        { focus: moreFocus, isConnected: true, disabled: false, getClientRects: () => [{ width: 40 }] },
      ],
      schedule,
    )).toBe(true)
    expect(disabledFocus).not.toHaveBeenCalled()
    expect(moreFocus).toHaveBeenCalledOnce()
  })

  it('gives replacement side panels an initial focus target', async () => {
    const [workflow, models] = await Promise.all([
      readFile(new URL('./WorkflowLibrary.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./ModelSettings.tsx', import.meta.url), 'utf8'),
    ])

    expect(workflow).toMatch(/<button autoFocus className="v2-icon-button"[^>]*aria-label="关闭方法与计划"/)
    expect(workflow).toMatch(/<button autoFocus className="v2-icon-button"[^>]*aria-label="关闭计划编辑"/)
    expect(models).toMatch(/<button autoFocus className="v2-icon-button"[^>]*aria-label="关闭模型设置"/)
  })

  it('keeps manager command rejections observable and closes only after a board opens', async () => {
    const [app, manager] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toContain('onOpen={switchBoard}')
    expect(manager).toMatch(/runExclusiveBoardNavigation[\s\S]*onOpen\(boardId\)[\s\S]*onClose\(\)/)
    expect(app).toMatch(/onRename=\{renameBoard\}/)
    expect(app).toMatch(/onArchive=\{archiveBoard\}/)
    expect(app).toMatch(/onTrash=\{trashBoard\}/)
    expect(app).toMatch(/onRestore=\{restoreBoard\}/)
    expect(app).toMatch(/onExport=\{exportBoardFile\}/)
    expect(app).toMatch(/onImport=\{importBoardFile\}/)
    expect(app).toMatch(/onBackup=\{backupMira\}/)
  })

  it('adds a dismissible mobile scrim without resizing the canvas for drawers', async () => {
    const [app, styles] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readStyles(new URL('../styles.css', import.meta.url)),
    ])

    expect(app).toContain('className="v2-drawer-scrim"')
    expect(app).toContain('aria-label="关闭侧栏"')
    expect(styles).toMatch(/\.v2-app\.has-drawer \.v2-canvas-shell\s*\{[^}]*right:\s*0;/s)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-drawer-scrim\s*\{[^}]*display:\s*block;/)
  })

  it('turns a destructive request into an inline second confirmation', () => {
    useV2Canvas.getState().setSelectedCardIds(['card-1'])
    useV2Canvas.getState().requestDeleteSelectedCards()

    const html = renderToolbar()

    expect(html).toContain('删除 1 张卡片？')
    expect(html).toContain('>取消<')
    expect(html).toContain('>确认删除<')
  })
})
