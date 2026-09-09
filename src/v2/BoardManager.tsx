import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Check,
  Download,
  FolderOpen,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  BOARD_MANAGER_TABS,
  boardActionsForState,
  boardDangerCopy,
  boardManagerTabFromKey,
  boardsForTab,
  inspectBoardArtifact,
  normalizeBoardTitle,
  validateBoardArtifactFile,
  type BoardArtifactPreview,
  type BoardCatalogEntry,
  type BoardDangerAction,
  type BoardLifecycleState,
  type BoardManagerAction,
} from './boardManagerPolicy'

type AsyncResult = void | Promise<void>

function invokeCommand(command: () => AsyncResult): Promise<void> {
  return Promise.resolve().then(() => command())
}

export async function runExclusiveBoardNavigation(
  lock: { current: boolean },
  command: () => AsyncResult,
  onBusy: (busy: boolean) => void,
): Promise<boolean> {
  if (lock.current) return false
  lock.current = true
  onBusy(true)
  try {
    await invokeCommand(command)
    return true
  } finally {
    lock.current = false
    onBusy(false)
  }
}

export function restoreBoardManagerDialogFocus(
  dialog: { contains(element: unknown): boolean } | null,
  activeTab: BoardLifecycleState,
  documentRef: {
    activeElement: unknown
    getElementById(id: string): { focus(): void } | null
  } = document,
): boolean {
  if (!dialog || dialog.contains(documentRef.activeElement)) return false
  const tab = documentRef.getElementById(`v2-board-tab-${activeTab}`)
  if (!tab) return false
  tab.focus()
  return true
}

export interface BoardManagerProps {
  entries: BoardCatalogEntry[]
  currentBoardId: string | null
  loading: boolean
  error: string | null
  onClose: () => void
  onReload: () => AsyncResult
  onOpen: (boardId: string) => AsyncResult
  onCreate: (title: string) => AsyncResult
  onRename: (boardId: string, title: string, revision: number) => AsyncResult
  onArchive: (boardId: string, revision: number) => AsyncResult
  onTrash: (boardId: string, revision: number) => AsyncResult
  onRestore: (boardId: string, revision: number) => AsyncResult
  onPurge: (boardId: string, revision: number) => AsyncResult
  onExport: (boardId: string) => AsyncResult
  onImport: (file: File) => AsyncResult
  onBackup: () => AsyncResult
  onHistory: (entry: BoardCatalogEntry) => void
}

export function BoardRenameForm({
  entry,
  onCancel,
  onRename,
}: {
  entry: BoardCatalogEntry
  onCancel: () => void
  onRename: BoardManagerProps['onRename']
}) {
  const [draft, setDraft] = useState(entry.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return <form
    className="v2-board-rename-form"
    aria-label={`重命名 ${entry.title}`}
    aria-busy={busy}
    onSubmit={(event) => {
      event.preventDefault()
      const normalized = normalizeBoardTitle(draft)
      if (normalized.error) {
        setError(normalized.error)
        return
      }
      const title = normalized.title
      setBusy(true)
      setError(null)
      void invokeCommand(() => onRename(entry.id, title, entry.revision)).then(
        () => onCancel(),
        (reason: unknown) => setError(errorMessage(reason, '重命名失败，请基于最新画板重试。')),
      ).finally(() => setBusy(false))
    }}
  >
    <label><span>画板名称</span><input
      autoFocus
      value={draft}
      disabled={busy}
      aria-describedby={`v2-board-rename-help-${entry.id}`}
      onChange={(event) => { setDraft(event.target.value); setError(null) }}
    /></label>
    <small id={`v2-board-rename-help-${entry.id}`}>120 个字符以内</small>
    {error && <p role="alert">{error}</p>}
    <div>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="v2-primary-button" type="submit" disabled={busy || Boolean(normalizeBoardTitle(draft).error)}>
        {busy ? <LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}保存
      </button>
    </div>
  </form>
}

export function BoardDangerConfirm({
  entry,
  action,
  onCancel,
  onConfirm,
}: {
  entry: BoardCatalogEntry
  action: BoardDangerAction
  onCancel: () => void
  onConfirm: (boardId: string, revision: number) => AsyncResult
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = boardDangerCopy(action, entry.title)

  return <div className="v2-board-danger-confirm" role="group" aria-label={copy.title} aria-busy={busy}>
    <div><strong>{copy.title}</strong><span>{copy.description}</span></div>
    {error && <p role="alert">{error}</p>}
    <div>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="v2-danger-button" type="button" disabled={busy} onClick={() => {
        setBusy(true)
        setError(null)
        void invokeCommand(() => onConfirm(entry.id, entry.revision)).then(
          () => onCancel(),
          (reason: unknown) => setError(errorMessage(reason, `${copy.confirmLabel}失败，请重试。`)),
        ).finally(() => setBusy(false))
      }}>
        {busy ? <LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> : action === 'archive'
          ? <Archive size={14} aria-hidden="true" />
          : <Trash2 size={14} aria-hidden="true" />}{copy.confirmLabel}
      </button>
    </div>
  </div>
}

export function BoardImportPreview({
  fileName,
  preview,
  busy,
  error,
  onCancel,
  onImport,
}: {
  fileName: string
  preview: BoardArtifactPreview
  busy: boolean
  error: string | null
  onCancel: () => void
  onImport: () => AsyncResult
}) {
  return <section className="v2-board-import-preview" aria-labelledby="v2-board-import-preview-title" aria-busy={busy}>
    <header><div><span>Mira Board V1</span><h3 id="v2-board-import-preview-title">{preview.title}</h3></div><code>{fileName}</code></header>
    <dl>
      <div><dt>内容</dt><dd>{preview.cardCount} 张卡片 · {preview.versionCount} 个版本</dd></div>
      <div><dt>结构</dt><dd>{preview.transformationCount} 个转化</dd></div>
      <div><dt>运行</dt><dd>{preview.runCount} 次终态运行</dd></div>
      <div><dt>出处</dt><dd>{preview.externalReferenceCount} 个包外出处 · {preview.workflowProvenanceCount} 份方法出处</dd></div>
      <div><dt>文件</dt><dd>{preview.fileDependencyCount} 项文件依赖</dd></div>
    </dl>
    <p><strong>作为新画板导入，不覆盖现有内容。</strong><span>方法出处仅用于解释，不会安装到方法库。引用文件只保留路径，不读取正文。导入时 Mira 还会进行完整校验。</span></p>
    {error && <div className="v2-board-inline-error" role="alert">{error}</div>}
    <footer>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void onImport()}>
        {busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}{busy ? '正在导入…' : '导入新副本'}
      </button>
    </footer>
  </section>
}

export function BoardRow({
  entry,
  current,
  onOpen,
  onRename,
  onArchive,
  onTrash,
  onRestore,
  onPurge,
  onExport,
  onHistory,
  navigationBusy,
}: {
  entry: BoardCatalogEntry
  current: boolean
  onOpen: BoardManagerProps['onOpen']
  onRename: BoardManagerProps['onRename']
  onArchive: BoardManagerProps['onArchive']
  onTrash: BoardManagerProps['onTrash']
  onRestore: BoardManagerProps['onRestore']
  onPurge: BoardManagerProps['onPurge']
  onExport: BoardManagerProps['onExport']
  onHistory: BoardManagerProps['onHistory']
  navigationBusy: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState<BoardDangerAction | null>(null)
  const [busyAction, setBusyAction] = useState<BoardManagerAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actions = boardActionsForState(entry.state, current)

  const run = (action: BoardManagerAction, command: () => AsyncResult, fallback: string) => {
    setBusyAction(action)
    setError(null)
    void invokeCommand(command).catch((reason: unknown) => {
      setError(errorMessage(reason, fallback))
    }).finally(() => setBusyAction(null))
  }

  return <li className="v2-board-row" aria-busy={Boolean(busyAction) || navigationBusy}>
    <div className="v2-board-row-summary">
      <div><strong>{entry.title}</strong><span>{current ? '当前' : lifecycleLabel(entry.state)}</span></div>
      <time dateTime={entry.updatedAt}>{formatUpdatedAt(entry.updatedAt)}</time>
      <div className="v2-board-row-actions">
        <button
          className="v2-icon-button"
          type="button"
          aria-label={`查看画布版本 ${entry.title}`}
          title="画布版本"
          disabled={navigationBusy || Boolean(busyAction)}
          onClick={() => onHistory(entry)}
        ><History size={16} aria-hidden="true" /></button>
        {actions.map((action) => <BoardActionButton
          key={action}
          action={action}
          title={entry.title}
          busy={busyAction === action}
          disabled={navigationBusy || Boolean(busyAction)}
          onClick={() => {
            if (action === 'rename') {
              setRenaming(true)
              setConfirming(null)
              setError(null)
            } else if (action === 'archive' || action === 'trash' || action === 'purge') {
              setConfirming(action)
              setRenaming(false)
              setError(null)
            } else if (action === 'open') run(action, () => onOpen(entry.id), '画板暂时无法打开。')
            else if (action === 'restore') run(action, () => onRestore(entry.id, entry.revision), '恢复失败，请重试。')
            else if (action === 'export') run(action, () => onExport(entry.id), '导出失败，请重试。')
          }}
        />)}
      </div>
    </div>
    {renaming && <BoardRenameForm entry={entry} onRename={onRename} onCancel={() => setRenaming(false)} />}
    {confirming && <BoardDangerConfirm
      entry={entry}
      action={confirming}
      onCancel={() => setConfirming(null)}
      onConfirm={confirming === 'archive'
        ? onArchive
        : confirming === 'trash' ? onTrash : onPurge}
    />}
    {error && <div className="v2-board-inline-error" role="alert">{error}</div>}
  </li>
}

function BoardActionButton({
  action,
  title,
  busy,
  disabled,
  onClick,
}: {
  action: BoardManagerAction
  title: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  const copy = actionCopy(action, title)
  return <button
    className={`v2-icon-button ${action === 'trash' || action === 'purge' ? 'is-danger' : ''}`}
    type="button"
    aria-label={copy.label}
    title={copy.tooltip}
    disabled={disabled}
    onClick={onClick}
  >{busy ? <LoaderCircle className="is-spinning" size={16} aria-hidden="true" /> : actionIcon(action)}</button>
}

export default function BoardManager({
  entries,
  currentBoardId,
  loading,
  error,
  onClose,
  onReload,
  onOpen,
  onCreate,
  onRename,
  onArchive,
  onTrash,
  onRestore,
  onPurge,
  onExport,
  onImport,
  onBackup,
  onHistory,
}: BoardManagerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const navigationLockRef = useRef(false)
  const [activeTab, setActiveTab] = useState<BoardLifecycleState>('active')
  const [tool, setTool] = useState<'create' | 'import' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<BoardArtifactPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [navigationBusy, setNavigationBusy] = useState(false)
  const visibleBoards = boardsForTab(entries, activeTab)

  useEffect(() => {
    const dialog = dialogRef.current
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) dialog.showModal()
    return () => { openerRef.current?.focus() }
  }, [])

  useEffect(() => {
    restoreBoardManagerDialogFocus(dialogRef.current, activeTab)
  }, [activeTab, entries])

  const resetImport = () => {
    setSelectedFile(null)
    setImportPreview(null)
    setImportError(null)
    setImportBusy(false)
    if (importInputRef.current) importInputRef.current.value = ''
    setTool(null)
  }

  const chooseImportFile = (file: File | null) => {
    setSelectedFile(file)
    setImportPreview(null)
    setImportError(null)
    if (!file) return
    const fileError = validateBoardArtifactFile(file)
    if (fileError) {
      setTool('import')
      setImportError(fileError)
      return
    }
    setTool('import')
    setImportBusy(true)
    void Promise.resolve().then(() => file.text()).then((text) => {
      const parsed: unknown = JSON.parse(text)
      setImportPreview(inspectBoardArtifact(parsed))
    }).catch((reason: unknown) => {
      setImportError(errorMessage(reason, '画板文件无法读取或不是有效 JSON。'))
    }).finally(() => setImportBusy(false))
  }

  const createValidation = normalizeBoardTitle(newTitle)
  const runBoardTask = (command: () => AsyncResult) => runExclusiveBoardNavigation(
    navigationLockRef,
    command,
    setNavigationBusy,
  ).then((completed) => {
    if (!completed) throw new Error('请等待当前画板操作完成。')
  })
  const openBoard = (boardId: string) => runBoardTask(
    () => onOpen(boardId),
  ).then(onClose)

  return <dialog
    ref={dialogRef}
    className="v2-board-manager"
    aria-modal="true"
    aria-labelledby="v2-board-manager-title"
    onCancel={(event) => { event.preventDefault(); if (!navigationBusy) onClose() }}
    onClick={(event) => {
      if (event.target === event.currentTarget && !navigationBusy) onClose()
    }}
  >
    <header className="v2-board-manager-head">
      <div><span>课题与数据</span><h2 id="v2-board-manager-title">管理画板</h2></div>
      <div className="v2-board-manager-head-actions">
        <button className="v2-icon-button" type="button" aria-label="刷新画板目录" title="刷新" disabled={loading || navigationBusy} onClick={() => void onReload()}><RefreshCw size={17} /></button>
        <button className="v2-icon-button" type="button" aria-label="关闭画板管理" title="关闭" disabled={navigationBusy} onClick={onClose}><X size={18} /></button>
      </div>
    </header>

    <section className="v2-board-manager-tools" aria-label="画板与数据命令">
      <div>
        <button className="v2-secondary-button" type="button" disabled={navigationBusy} aria-expanded={tool === 'create'} onClick={() => { setTool(tool === 'create' ? null : 'create'); setCreateError(null) }}><Plus size={15} />新建画板</button>
        <label className="v2-secondary-button v2-board-import-file"><Upload size={15} />导入画板副本<input
          ref={importInputRef}
          type="file"
          accept=".mira-board.json,application/json"
          disabled={navigationBusy || importBusy}
          onChange={(event) => chooseImportFile(event.target.files?.[0] || null)}
        /></label>
        <button className="v2-secondary-button" type="button" disabled={navigationBusy || backupBusy} onClick={() => {
          setBackupBusy(true)
          setBackupError(null)
          void invokeCommand(onBackup).catch((reason: unknown) => {
            setBackupError(errorMessage(reason, '备份失败，请重试。'))
          }).finally(() => setBackupBusy(false))
        }}>{backupBusy ? <LoaderCircle className="is-spinning" size={15} /> : <Download size={15} />}{backupBusy ? '正在备份…' : '备份 Mira 数据'}</button>
      </div>
      <p><span>导入会创建独立副本，不覆盖现有内容。</span><span>备份包含工作中、已归档、废纸篓画板、运行记录和方法，不含 API 密钥、页面草稿和引用文件正文。</span></p>
      {backupError && <div className="v2-board-inline-error" role="alert">{backupError}</div>}
    </section>

    {tool === 'create' && <form className="v2-board-create-form" onSubmit={(event) => {
      event.preventDefault()
      if (createValidation.error) {
        setCreateError(createValidation.error)
        return
      }
      setCreateBusy(true)
      setCreateError(null)
      void runBoardTask(
        () => onCreate(createValidation.title),
      ).then(() => {
        setNewTitle('')
        setTool(null)
        setActiveTab('active')
      }, (reason: unknown) => setCreateError(errorMessage(reason, '画板创建失败，请重试。')))
        .finally(() => setCreateBusy(false))
    }}>
      <label><span>画板名称</span><input autoFocus value={newTitle} disabled={navigationBusy || createBusy} onChange={(event) => { setNewTitle(event.target.value); setCreateError(null) }} /></label>
      {createError && <p role="alert">{createError}</p>}
      <div><button type="button" disabled={navigationBusy || createBusy} onClick={() => setTool(null)}>取消</button><button className="v2-primary-button" type="submit" disabled={navigationBusy || createBusy || Boolean(createValidation.error)}><Plus size={14} />创建</button></div>
    </form>}

    {tool === 'import' && selectedFile && importPreview && <BoardImportPreview
      fileName={selectedFile.name}
      preview={importPreview}
      busy={importBusy}
      error={importError}
      onCancel={resetImport}
      onImport={() => {
        setImportBusy(true)
        setImportError(null)
        return runBoardTask(
          () => onImport(selectedFile),
        ).then(() => {
          resetImport()
        }, (reason: unknown) => {
          setImportError(errorMessage(reason, '导入失败，文件与预览已保留。'))
          setImportBusy(false)
        })
      }}
    />}
    {tool === 'import' && selectedFile && !importPreview && <section className="v2-board-import-state" aria-busy={importBusy}>
      <strong>{selectedFile.name}</strong>
      {importBusy ? <span role="status"><LoaderCircle className="is-spinning" size={15} />正在读取画板文件…</span> : importError && <span role="alert">{importError}</span>}
      <button type="button" disabled={importBusy} onClick={resetImport}>取消</button>
    </section>}

    <nav className="v2-board-manager-tabs" role="tablist" aria-label="画板状态">
      {BOARD_MANAGER_TABS.map((tab) => <button
        key={tab.id}
        type="button"
        role="tab"
        id={`v2-board-tab-${tab.id}`}
        aria-selected={activeTab === tab.id}
        tabIndex={activeTab === tab.id ? 0 : -1}
        aria-controls={`v2-board-panel-${tab.id}`}
        onClick={() => setActiveTab(tab.id)}
        onKeyDown={(event) => {
          const nextTab = boardManagerTabFromKey(activeTab, event.key)
          if (!nextTab) return
          event.preventDefault()
          setActiveTab(nextTab)
          window.requestAnimationFrame(() => document.getElementById(`v2-board-tab-${nextTab}`)?.focus())
        }}
      >{tab.label}<span>{entries.filter((entry) => entry.state === tab.id).length}</span></button>)}
    </nav>

    <section
      className="v2-board-manager-body"
      role="tabpanel"
      id={`v2-board-panel-${activeTab}`}
      aria-labelledby={`v2-board-tab-${activeTab}`}
    >
      {loading && entries.length === 0 && <div className="v2-board-manager-state" role="status"><LoaderCircle className="is-spinning" size={17} />正在读取画板…</div>}
      {error && <div className="v2-board-manager-state is-error" role="alert"><span>{error}</span><button className="v2-secondary-button" type="button" onClick={() => void onReload()}><RefreshCw size={14} />重新加载</button></div>}
      {!error && !loading && visibleBoards.length === 0 && <div className="v2-board-manager-state">{emptyStateCopy(activeTab)}</div>}
      {visibleBoards.length > 0 && <ul className="v2-board-list">{visibleBoards.map((entry) => <BoardRow
        key={entry.id}
        entry={entry}
        current={entry.id === currentBoardId}
        onRename={(boardId, title, revision) => runBoardTask(
          () => onRename(boardId, title, revision),
        )}
        onArchive={(boardId, revision) => runBoardTask(
          () => onArchive(boardId, revision),
        )}
        onTrash={(boardId, revision) => runBoardTask(
          () => onTrash(boardId, revision),
        )}
        onRestore={(boardId, revision) => runBoardTask(
          () => onRestore(boardId, revision),
        )}
        onPurge={(boardId, revision) => runBoardTask(
          () => onPurge(boardId, revision),
        )}
        onExport={onExport}
        onHistory={onHistory}
        onOpen={openBoard}
        navigationBusy={navigationBusy}
      />)}</ul>}
    </section>
  </dialog>
}

function actionCopy(action: BoardManagerAction, title: string): { label: string; tooltip: string } {
  if (action === 'open') return { label: `打开画板 ${title}`, tooltip: '打开画板' }
  if (action === 'rename') return { label: `重命名画板 ${title}`, tooltip: '重命名' }
  if (action === 'export') return { label: `导出画板 ${title}`, tooltip: '导出画板' }
  if (action === 'archive') return { label: `归档画板 ${title}`, tooltip: '归档' }
  if (action === 'trash') return { label: `将画板移到废纸篓 ${title}`, tooltip: '移到废纸篓' }
  if (action === 'purge') return { label: `永久删除画板 ${title}`, tooltip: '永久删除' }
  return { label: `恢复画板 ${title}`, tooltip: '恢复' }
}

function actionIcon(action: BoardManagerAction) {
  if (action === 'open') return <FolderOpen size={16} aria-hidden="true" />
  if (action === 'rename') return <Pencil size={16} aria-hidden="true" />
  if (action === 'export') return <Download size={16} aria-hidden="true" />
  if (action === 'archive') return <Archive size={16} aria-hidden="true" />
  if (action === 'trash') return <Trash2 size={16} aria-hidden="true" />
  if (action === 'purge') return <Trash2 size={16} aria-hidden="true" />
  return <ArchiveRestore size={16} aria-hidden="true" />
}

function lifecycleLabel(state: BoardLifecycleState): string {
  if (state === 'active') return '工作中'
  if (state === 'archived') return '已归档'
  return '废纸篓'
}

function emptyStateCopy(state: BoardLifecycleState): string {
  if (state === 'active') return '还没有工作中的画板。'
  if (state === 'archived') return '还没有归档的画板。'
  return '废纸篓是空的。'
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '更新时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback
}
