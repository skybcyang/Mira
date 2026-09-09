import { readStyles } from '../../test/helpers/read-styles.js'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import BoardManager, {
  BoardDangerConfirm,
  BoardImportPreview,
  BoardRenameForm,
  BoardRow,
  restoreBoardManagerDialogFocus,
  runExclusiveBoardNavigation,
} from './BoardManager'
import type { BoardArtifactPreview, BoardCatalogEntry } from './boardManagerPolicy'

const entries: BoardCatalogEntry[] = [
  { id: 'current', title: '正在整理的年度访谈研究与竞争格局判断', state: 'active', revision: 8, updatedAt: '2026-09-02T09:00:00.000Z' },
  { id: 'other', title: '产品机会地图', state: 'active', revision: 3, updatedAt: '2026-09-01T09:00:00.000Z' },
  { id: 'archive', title: '去年研究', state: 'archived', revision: 2, updatedAt: '2026-08-01T09:00:00.000Z' },
  { id: 'trash', title: '待恢复课题', state: 'trashed', revision: 5, updatedAt: '2026-07-01T09:00:00.000Z' },
]

const callbacks = {
  onClose: () => undefined,
  onReload: () => undefined,
  onOpen: () => undefined,
  onCreate: () => undefined,
  onRename: () => undefined,
  onArchive: () => undefined,
  onTrash: () => undefined,
  onRestore: () => undefined,
  onPurge: () => undefined,
  onExport: () => undefined,
  onImport: () => undefined,
  onBackup: () => undefined,
  onHistory: () => undefined,
}

const preview: BoardArtifactPreview = {
  formatVersion: 1,
  title: '访谈研究',
  cardCount: 12,
  versionCount: 28,
  transformationCount: 3,
  runCount: 6,
  externalReferenceCount: 2,
  fileDependencyCount: 1,
  workflowProvenanceCount: 1,
}

describe('BoardManager feature boundary', () => {
  it('exists as a lazy-ready UI feature', async () => {
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8').catch(() => null)

    expect(source, 'src/v2/BoardManager.tsx must exist').not.toBeNull()
  })

  it('exports independently testable row confirmation and import preview views', async () => {
    const module = await import('./BoardManager')

    expect(module).toMatchObject({
      default: expect.any(Function),
      BoardRenameForm: expect.any(Function),
      BoardDangerConfirm: expect.any(Function),
      BoardImportPreview: expect.any(Function),
    })
  })

  it('renders a compact lifecycle dialog with counted segments and top-level data tools', () => {
    const html = renderToStaticMarkup(createElement(BoardManager, {
      entries,
      currentBoardId: 'current',
      loading: false,
      error: null,
      ...callbacks,
    }))

    expect(html).toContain('aria-labelledby="v2-board-manager-title"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('工作中<span>2</span>')
    expect(html).toContain('已归档<span>1</span>')
    expect(html).toContain('废纸篓<span>1</span>')
    expect(html).toContain('新建画板')
    expect(html).toContain('导入画板副本')
    expect(html).toContain('accept=".mira-board.json,application/json"')
    expect(html).toContain('备份 Mira 数据')
    expect(html).toContain('导入会创建独立副本，不覆盖现有内容。')
    expect(html).toContain('备份包含工作中、已归档、废纸篓画板、运行记录和方法')
    expect(html).toContain('不含 API 密钥、页面草稿和引用文件正文。')
    expect(html).toContain('aria-label="刷新画板目录"')
    expect(html).toContain('aria-selected="true" tabindex="0"')
    expect(html.match(/aria-selected="false" tabindex="-1"/g)).toHaveLength(2)
  })

  it('shows only active rows initially and exposes allowed commands without permanent deletion', () => {
    const html = renderToStaticMarkup(createElement(BoardManager, {
      entries,
      currentBoardId: 'current',
      loading: false,
      error: null,
      ...callbacks,
    }))

    expect(html).toContain('正在整理的年度访谈研究与竞争格局判断')
    expect(html).toContain('产品机会地图')
    expect(html).not.toContain('去年研究</')
    expect(html).toContain('>当前</span>')
    expect(html).toContain('aria-label="打开画板 产品机会地图"')
    expect(html).not.toContain('aria-label="打开画板 正在整理的年度访谈研究与竞争格局判断"')
    expect(html).toContain('aria-label="重命名画板 产品机会地图"')
    expect(html).toContain('aria-label="查看画布版本 产品机会地图"')
    expect(html).toContain('aria-label="导出画板 产品机会地图"')
    expect(html).toContain('aria-label="归档画板 产品机会地图"')
    expect(html).toContain('aria-label="将画板移到废纸篓 产品机会地图"')
    expect(html).not.toContain('永久删除')
  })

  it('keeps canvas history reachable for active, archived, and trashed boards', () => {
    for (const entry of entries) {
      const html = renderToStaticMarkup(createElement(BoardRow, {
        entry,
        current: entry.id === 'current',
        navigationBusy: false,
        ...callbacks,
      }))
      expect(html).toContain(`aria-label="查看画布版本 ${entry.title}"`)
    }
  })

  it('keeps loading and catalog failure states actionable', () => {
    const loading = renderToStaticMarkup(createElement(BoardManager, {
      entries: [], currentBoardId: null, loading: true, error: null, ...callbacks,
    }))
    const failed = renderToStaticMarkup(createElement(BoardManager, {
      entries: [], currentBoardId: null, loading: false, error: '画板目录暂时无法读取', ...callbacks,
    }))

    expect(loading).toContain('role="status"')
    expect(loading).toContain('正在读取画板…')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('画板目录暂时无法读取')
    expect(failed).toContain('重新加载')
  })

  it('keeps rename editing inline and carries the visible revision in its callback contract', async () => {
    const html = renderToStaticMarkup(createElement(BoardRenameForm, {
      entry: entries[1],
      onCancel: () => undefined,
      onRename: callbacks.onRename,
    }))
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')

    expect(html).toContain('aria-label="重命名 产品机会地图"')
    expect(html).toContain('value="产品机会地图"')
    expect(html).toContain('120 个字符以内')
    expect(html).toContain('>取消</button>')
    expect(html).toContain('>保存</button>')
    expect(source).toMatch(/onRename\(entry\.id,\s*title,\s*entry\.revision\)/)
  })

  it('uses target-row confirmations that state the exact reversible impact', () => {
    const archive = renderToStaticMarkup(createElement(BoardDangerConfirm, {
      entry: entries[1], action: 'archive', onCancel: () => undefined, onConfirm: () => undefined,
    }))
    const trash = renderToStaticMarkup(createElement(BoardDangerConfirm, {
      entry: entries[2], action: 'trash', onCancel: () => undefined, onConfirm: () => undefined,
    }))

    expect(archive).toContain('归档“产品机会地图”？')
    expect(archive).toContain('归档后内容只读，可随时恢复。')
    expect(archive).toContain('确认归档')
    expect(trash).toContain('将“去年研究”移到废纸篓？')
    expect(trash).toContain('不会永久删除')
  })

  it('renders irreversible purge confirmation copy for a trashed board', () => {
    const purge = renderToStaticMarkup(createElement(BoardDangerConfirm, {
      entry: entries[3], action: 'purge', onCancel: () => undefined, onConfirm: () => undefined,
    }))
    expect(purge).toContain('永久删除“待恢复课题”？')
    expect(purge).toContain('将永久删除画板及其运行记录，无法恢复。')
    expect(purge).toContain('其他画板、方法和引用文件不受影响。')
    expect(purge).toContain('永久删除')
  })

  it('previews import scope and explains copy and provenance behavior before submission', () => {
    const html = renderToStaticMarkup(createElement(BoardImportPreview, {
      fileName: 'research.mira-board.json', preview, busy: false, error: null,
      onCancel: () => undefined, onImport: () => undefined,
    }))

    expect(html).toContain('research.mira-board.json')
    expect(html).toContain('Mira Board V1')
    expect(html).toContain('12 张卡片')
    expect(html).toContain('28 个版本')
    expect(html).toContain('6 次终态运行')
    expect(html).toContain('2 个包外出处')
    expect(html).toContain('1 项文件依赖')
    expect(html).toContain('1 份方法出处')
    expect(html).toContain('作为新画板导入，不覆盖现有内容。')
    expect(html).toContain('方法出处仅用于解释，不会安装到方法库。')
    expect(html).toContain('导入时 Mira 还会进行完整校验。')
  })

  it('uses native modal and opener focus restoration hooks', async () => {
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')

    expect(source).toContain('dialog.showModal()')
    expect(source).toContain('onCancel=')
    expect(source).toMatch(/opener[^\n]*\.focus\(/)
    expect(source).toContain('boardManagerTabFromKey(activeTab, event.key)')
    expect(source).toContain('event.preventDefault()')
    expect(source).toMatch(/getElementById\(`v2-board-tab-\$\{nextTab\}`\)[^\n]*\.focus\(/)
  })

  it('returns focus to the active lifecycle tab only when a catalog update orphaned it', () => {
    const focus = vi.fn()
    const activeElement = {}
    const documentRef = {
      activeElement,
      getElementById: vi.fn(() => ({ focus })),
    }

    expect(restoreBoardManagerDialogFocus(
      { contains: () => false },
      'trashed',
      documentRef,
    )).toBe(true)
    expect(documentRef.getElementById).toHaveBeenCalledWith('v2-board-tab-trashed')
    expect(focus).toHaveBeenCalledOnce()

    expect(restoreBoardManagerDialogFocus(
      { contains: (element) => element === activeElement },
      'active',
      documentRef,
    )).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('captures synchronous command failures inside the same row-level error path', async () => {
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Promise.resolve().then(() =>')
    expect(source).not.toMatch(/Promise\.resolve\((?:on|command\()/)
  })

  it('serializes board opening across every visible row', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const lock = { current: false }
    const busyStates: boolean[] = []
    const first = vi.fn(() => pending)
    const second = vi.fn(() => undefined)

    const opening = runExclusiveBoardNavigation(lock, first, (busy) => busyStates.push(busy))
    await expect(runExclusiveBoardNavigation(lock, second, () => undefined)).resolves.toBe(false)
    expect(second).not.toHaveBeenCalled()

    release()
    await expect(opening).resolves.toBe(true)
    expect(busyStates).toEqual([true, false])
    await expect(runExclusiveBoardNavigation(lock, second, () => undefined)).resolves.toBe(true)
    expect(second).toHaveBeenCalledOnce()

    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')
    expect(source).toContain('const runBoardTask =')
    expect(source.match(/runExclusiveBoardNavigation\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).toMatch(/disabled=\{navigationBusy \|\| importBusy\}/)
    expect(source).toMatch(/disabled=\{navigationBusy \|\| createBusy/)
  })

  it('uses the same task lock for lifecycle mutations and board navigation', async () => {
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const runBoardTask =')
    expect(source).toMatch(/onArchive=\{\([^)]*\) => runBoardTask/)
    expect(source).toMatch(/onTrash=\{\([^)]*\) => runBoardTask/)
    expect(source).toMatch(/onRestore=\{\([^)]*\) => runBoardTask/)
    expect(source).toMatch(/onPurge=\{\([^)]*\) => runBoardTask/)
  })

  it('checks the 64 MiB file boundary before reading import contents', async () => {
    const source = await readFile(new URL('./BoardManager.tsx', import.meta.url), 'utf8')
    const validation = source.indexOf('validateBoardArtifactFile(file)')
    const read = source.indexOf('file.text()')

    expect(validation).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(validation)
    expect(source.slice(validation, read)).toMatch(/if \(fileError\)[\s\S]*return/)
  })

  it('defines a bounded row layout and a full-width 390px sheet without page overflow', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))

    expect(styles).toMatch(/\.v2-board-manager\s*\{[^}]*width:\s*min\([^;]+;[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.v2-board-row-summary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^;]*;/s)
    expect(styles).toMatch(/\.v2-board-row-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s)
    expect(styles).toMatch(/@media \(max-width:\s*719px\)[\s\S]*\.v2-board-manager\s*\{[^}]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border-radius:\s*0;/s)
    expect(styles).toMatch(/@media \(max-width:\s*719px\)[\s\S]*\.v2-board-row-actions \.v2-icon-button[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s)
  })
})
