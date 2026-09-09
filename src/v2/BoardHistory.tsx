import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  CopyPlus,
  Download,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import type {
  BoardCheckpointSummary,
  BoardCheckpointV1,
  BoardV2,
  TransformationRun,
} from '../domain'
import type { BoardCheckpointSaveStatus, BoardSummary } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import {
  checkpointCardContentComparison,
  compareCheckpointToCurrent,
  compareCheckpointOrganization,
  type CheckpointCardContentChange,
} from './checkpointDiff'
import {
  checkpointSaveBlocker,
  checkpointSaveBlockerFromStatus,
  checkpointSaveResolution,
  checkpointSaveResolutionFromStatus,
  defaultCheckpointForkTitle,
  normalizeCheckpointDraft,
} from './boardHistoryPolicy'
import { userFacingStoreError } from './storePolicy'
import { createBoardHistoryRequestScope } from './boardHistoryRequests'
import { mergeCheckpointPreviewRuns } from './checkpointPreviewRuns'
import { groupBounds } from './canvasOrganization'

type AsyncResult = void | Promise<void>

export interface BoardHistoryListViewProps {
  checkpoints: BoardCheckpointSummary[]
  loading: boolean
  error: string | null
  saveBlocker: string | null
  saveBlockerAction?: { label: string; onSelect: () => void }
  onSave: () => void
  onSelect: (checkpoint: BoardCheckpointSummary) => void
  onExport: (checkpoint: BoardCheckpointSummary) => AsyncResult
  onRename: (checkpoint: BoardCheckpointSummary) => void
  onDelete: (checkpoint: BoardCheckpointSummary) => void
  onReload?: () => AsyncResult
}

export function BoardHistoryListView({
  checkpoints,
  loading,
  error,
  saveBlocker,
  saveBlockerAction,
  onSave,
  onSelect,
  onExport,
  onRename,
  onDelete,
  onReload = () => undefined,
}: BoardHistoryListViewProps) {
  if (loading && checkpoints.length === 0) {
    return <div className="v2-board-history-state" role="status">
      <LoaderCircle className="is-spinning" size={17} />正在读取画布版本…
    </div>
  }
  if (error && checkpoints.length === 0) {
    return <div className="v2-board-history-state is-error" role="alert">
      <span>{error}</span>
      <button className="v2-secondary-button" type="button" onClick={() => void onReload()}>
        <RefreshCw size={14} />重新加载
      </button>
    </div>
  }

  return <div className="v2-board-history-list-view">
    <section className="v2-board-history-save-entry">
      <div><strong>保存当前画布状态</strong><span>{saveBlocker || '之后可从独立副本继续工作。'}</span></div>
      <div className="v2-board-history-save-actions">
        <button className="v2-primary-button" type="button" data-history-autofocus disabled={Boolean(saveBlocker)} onClick={onSave}>
          <Save size={15} />保存画布版本
        </button>
        {saveBlockerAction && <button className="v2-secondary-button" type="button" onClick={saveBlockerAction.onSelect}>{saveBlockerAction.label}</button>}
      </div>
    </section>
    {error && <div className="v2-board-history-inline-error" role="alert">{error}</div>}
    {checkpoints.length === 0
      ? <section className="v2-board-history-empty">
        <History size={22} aria-hidden="true" />
        <strong>还没有保存画布版本</strong>
        <span>在关键节点保存，之后可回来查看或创建副本。</span>
        <button type="button" disabled={Boolean(saveBlocker)} onClick={onSave}>
          <Plus size={14} />保存当前版本
        </button>
        {saveBlockerAction && <button className="v2-secondary-button" type="button" onClick={saveBlockerAction.onSelect}>{saveBlockerAction.label}</button>}
      </section>
      : <ol className="v2-board-history-list">
        {checkpoints.map((checkpoint) => <li key={checkpoint.id}>
          <button className="v2-board-history-summary" type="button" onClick={() => onSelect(checkpoint)}>
            <span><strong>{checkpoint.title}</strong><time dateTime={checkpoint.createdAt}>{formatDate(checkpoint.createdAt)}</time></span>
            <small>{checkpoint.counts.cards} 张卡片 · {checkpoint.counts.transformations} 个步骤 · {checkpoint.counts.runs} 次运行</small>
            {checkpoint.note && <p>{checkpoint.note}</p>}
          </button>
          <div className="v2-board-history-row-actions">
            <button className="v2-icon-button" type="button" aria-label={`导出画布版本 ${checkpoint.title}`} title="导出" onClick={() => void onExport(checkpoint)}><Download size={15} /></button>
            <button className="v2-icon-button" type="button" aria-label={`重命名画布版本 ${checkpoint.title}`} title="重命名" onClick={() => onRename(checkpoint)}><Pencil size={15} /></button>
            <button className="v2-icon-button is-danger" type="button" aria-label={`删除画布版本 ${checkpoint.title}`} title="删除" onClick={() => onDelete(checkpoint)}><Trash2 size={15} /></button>
          </div>
        </li>)}
      </ol>}
  </div>
}

export function BoardHistoryPreviewView({
  checkpoint,
  currentBoard,
  currentRuns,
  liveRuns,
  onBack,
  onFork,
  onExport,
}: {
  checkpoint: BoardCheckpointV1
  currentBoard: BoardV2
  currentRuns: Record<string, TransformationRun>
  liveRuns?: Record<string, TransformationRun>
  onBack: () => void
  onFork: () => void
  onExport: () => AsyncResult
}) {
  const comparison = compareCheckpointToCurrent(
    checkpoint.artifact,
    currentBoard,
    mergeCheckpointPreviewRuns(currentBoard.id, currentRuns, liveRuns),
  )
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const organization = compareCheckpointOrganization(checkpoint.artifact.board, currentBoard)
  const structureChanges = comparison.transformations.added
    + comparison.transformations.removed
    + comparison.transformations.changed
  return <div className="v2-board-history-preview">
    <div className="v2-board-history-subhead">
      <button className="v2-icon-button" type="button" data-history-autofocus aria-label="返回画布版本列表" title="返回" onClick={onBack}><ArrowLeft size={17} /></button>
      <div><span>保存于 {formatDate(checkpoint.createdAt)}</span><strong>{checkpoint.title}</strong></div>
      <button className="v2-icon-button" type="button" aria-label={`导出画布版本 ${checkpoint.title}`} title="导出" onClick={() => void onExport()}><Download size={16} /></button>
    </div>
    <p className="v2-board-history-readonly">这是只读版本，不会改变当前画布。</p>
    <BoardMiniature board={checkpoint.artifact.board} />
    {checkpoint.note && <p className="v2-board-history-note">{checkpoint.note}</p>}
    <section className="v2-board-history-comparison" aria-label="与当前画板比较">
      <h3>与当前画板比较</h3>
      <dl>
        <div><dt>卡片</dt><dd>+{comparison.cards.added} / -{comparison.cards.removed}</dd></div>
        <div><dt>正文变化</dt><dd>{comparison.cards.contentChanged}</dd></div>
        <div><dt>布局变化</dt><dd>{comparison.cards.layoutChanged}</dd></div>
        <div><dt>颜色变化</dt><dd>{organization.colorsChanged}</dd></div>
        <div><dt>分组变化</dt><dd>+{organization.groupsAdded} / -{organization.groupsRemoved} / {organization.groupsChanged} 修改</dd></div>
        <div><dt>结构变化</dt><dd>{structureChanges}</dd></div>
        <div><dt>新增运行</dt><dd>{comparison.runs.added}</dd></div>
        <div><dt>待处理结果</dt><dd>{comparison.runs.pendingCandidates}</dd></div>
      </dl>
    </section>
    {comparison.cards.contentChanges.length > 0 && <section className="v2-board-history-content-diffs" aria-label="卡片正文差异">
      <h3>卡片正文差异</h3>
      {comparison.cards.contentChanges.map((change) => <article key={change.cardId}>
        <header><h4>{change.label}</h4><button type="button" onClick={() => setExpandedCardId(
          expandedCardId === change.cardId ? null : change.cardId,
        )}>{expandedCardId === change.cardId ? '收起差异' : '查看正文差异'}</button></header>
        {expandedCardId === change.cardId && <BoardHistoryCardDiffView change={change} />}
      </article>)}
    </section>}
    <footer>
      <button className="v2-primary-button" type="button" onClick={onFork}>
        <CopyPlus size={16} />从这个版本创建副本
      </button>
    </footer>
  </div>
}

export function BoardHistoryCardDiffView({ change }: { change: CheckpointCardContentChange }) {
  const comparison = checkpointCardContentComparison(change)
  if (comparison.emptyMessage) return <p role="status">{comparison.emptyMessage}</p>
  return <ol>{comparison.lines.map((line, index) => <li
    className={`is-${line.kind}`}
    key={`${change.cardId}-${index}`}
  >
    <span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
    <code>{line.text || ' '}</code>
  </li>)}</ol>
}

function BoardMiniature({ board }: { board: BoardV2 }) {
  const geometry = useMemo(() => {
    const nodes = board.cards.map((card) => ({ id: card.id, data: {}, position: { x: card.x, y: card.y }, style: { width: card.width, height: card.height } }))
    const groups = (board.groups || []).flatMap((group) => {
      const bounds = groupBounds(group, nodes)
      return bounds ? [{ group, ...bounds }] : []
    })
    const boxes = [...board.cards, ...groups]
    if (!boxes.length) return { groups, viewBox: '0 0 1 1' }
    const x = Math.min(...boxes.map((item) => item.x)) - 12
    const y = Math.min(...boxes.map((item) => item.y)) - 12
    return { groups, viewBox: `${x} ${y} ${Math.max(...boxes.map((item) => item.x + item.width)) - x + 12} ${Math.max(...boxes.map((item) => item.y + item.height)) - y + 12}` }
  }, [board])
  return <div className="v2-board-history-miniature" aria-label={`${board.title} 的只读画布预览`}>
    {board.cards.length === 0
      ? <span>这个版本还没有卡片</span>
      : <svg viewBox={geometry.viewBox} role="img" aria-label="卡片颜色与分组预览">
        {geometry.groups.map(({ group, x, y, width, height }) => <g key={group.id} data-card-color={group.color}>
          <title>{group.title}</title>
          <rect x={x} y={y} width={width} height={height} fill="none" stroke="var(--mira-card-color, var(--mira-border-strong))" strokeDasharray="8 6" strokeWidth="2" />
          <text x={x + 12} y={y + 32} fill="var(--mira-ink)" fontSize="24">{group.title}</text>
        </g>)}
        {board.cards.map((card) => <g key={card.id} data-card-color={card.color}>
          <title>{cardHeadLabel(card)}</title>
          <rect x={card.x} y={card.y} width={card.width} height={card.height} rx="6" fill="var(--mira-surface)" stroke="var(--mira-border-strong)" strokeWidth="2" />
          {card.color && <rect x={card.x + 4} y={card.y + 2} width={card.width - 8} height="8" fill="var(--mira-card-color)" />}
        </g>)}
      </svg>}
  </div>
}

type BoardHistoryMode = 'list' | 'save' | 'preview' | 'rename' | 'delete' | 'fork'

export default function BoardHistory({
  target,
  onClose,
}: {
  target: BoardSummary
  onClose: () => void
}) {
  const currentBoardId = useV2Canvas((state) => state.boardId)
  const currentBoard = useV2Canvas((state) => state.board)
  const currentRuns = useV2Canvas((state) => state.runs)
  const listCheckpoints = useV2Canvas((state) => state.listBoardCheckpoints)
  const loadCheckpoint = useV2Canvas((state) => state.loadBoardCheckpoint)
  const createCheckpoint = useV2Canvas((state) => state.createBoardCheckpoint)
  const updateCheckpoint = useV2Canvas((state) => state.updateBoardCheckpoint)
  const deleteCheckpoint = useV2Canvas((state) => state.deleteBoardCheckpoint)
  const forkCheckpoint = useV2Canvas((state) => state.forkBoardCheckpoint)
  const exportCheckpoint = useV2Canvas((state) => state.exportBoardCheckpoint)
  const switchBoard = useV2Canvas((state) => state.switchBoard)
  const openDrawer = useV2Canvas((state) => state.openDrawer)
  const [checkpoints, setCheckpoints] = useState<BoardCheckpointSummary[]>([])
  const [saveStatus, setSaveStatus] = useState<BoardCheckpointSaveStatus | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<BoardHistoryMode>('list')
  const [selectedSummary, setSelectedSummary] = useState<BoardCheckpointSummary | null>(null)
  const [preview, setPreview] = useState<{
    checkpoint: BoardCheckpointV1
    board: BoardV2
    runs: Record<string, TransformationRun>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const requests = useMemo(() => createBoardHistoryRequestScope(), [target.id])

  const reload = useCallback(async () => {
    setLoadState('loading')
    setError(null)
    await requests.run(() => listCheckpoints(target.id), (result) => {
      setCheckpoints(result.checkpoints)
      setSaveStatus(result.saveStatus)
      setLoadState('ready')
    }, (reason) => {
      setError(userFacingStoreError(reason))
      setLoadState('ready')
    })
  }, [listCheckpoints, requests, target.id])

  useLayoutEffect(() => {
    setCheckpoints([])
    setSaveStatus(null)
    setLoadState('loading')
    setSelectedSummary(null)
    setPreview(null)
    setBusy(false)
    setMode('list')
    setError(null)
    return () => requests.invalidate()
  }, [requests])

  useEffect(() => { void reload() }, [reload])

  const changeMode = (next: BoardHistoryMode) => {
    requests.invalidate()
    setMode(next)
    setError(null)
  }
  const backToList = () => {
    changeMode('list')
    setPreview(null)
    void reload()
  }
  const close = () => {
    requests.invalidate()
    onClose()
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = bodyRef.current
      if (!container || container.contains(document.activeElement)) return
      const target = container.querySelector<HTMLElement>(
        '[data-history-autofocus]:not(:disabled), input:not(:disabled), button:not(:disabled)',
      )
      target?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode])

  const isCurrentBoard = currentBoardId === target.id
  const visibleRuns = isCurrentBoard ? Object.values(currentRuns) : []
  const currentRevision = currentBoardId === target.id && currentBoard
    ? currentBoard.revision || 0
    : target.revision
  const saveBlocker = isCurrentBoard
    ? checkpointSaveBlocker(target.state, visibleRuns, checkpoints.length)
    : saveStatus
      ? checkpointSaveBlockerFromStatus(saveStatus)
      : '正在确认画板是否可以保存版本。'
  const saveResolution = isCurrentBoard
    ? checkpointSaveResolution(visibleRuns)
    : saveStatus
      ? checkpointSaveResolutionFromStatus(saveStatus)
      : null
  const openBlockingRun = async (runId: string) => {
    setError(null)
    try {
      if (!isCurrentBoard) {
        await switchBoard(target.id)
        if (useV2Canvas.getState().boardId !== target.id) return
      }
      close()
      openDrawer({ tab: 'run', runId })
    } catch (reason) {
      setError(userFacingStoreError(reason))
    }
  }
  const selectCheckpoint = async (summary: BoardCheckpointSummary) => {
    setSelectedSummary(summary)
    changeMode('preview')
    setPreview(null)
    await requests.run(() => loadCheckpoint(
      target.id,
      summary.id,
      currentBoardId === target.id && currentBoard
        ? { board: currentBoard, runs: currentRuns }
        : undefined,
    ), setPreview, (reason) => {
      setError(userFacingStoreError(reason))
    })
  }
  const exportSelected = async (summary: BoardCheckpointSummary) => {
    setError(null)
    try {
      await exportCheckpoint(target.id, summary.id, `${target.title} - ${summary.title}`)
    } catch (reason) {
      setError(userFacingStoreError(reason))
    }
  }

  return <aside className="v2-board-history" aria-labelledby="v2-board-history-title">
    <header className="v2-board-history-head">
      <div><span>画布版本</span><h2 id="v2-board-history-title">{target.title}</h2></div>
      <button className="v2-icon-button" type="button" aria-label="关闭画布版本" title="关闭" disabled={busy} onClick={close}><X size={18} /></button>
    </header>
    <div className="v2-board-history-body" ref={bodyRef}>
      {mode === 'list' && <BoardHistoryListView
        checkpoints={checkpoints}
        loading={loadState === 'loading'}
        error={error}
        saveBlocker={saveBlocker}
        saveBlockerAction={saveResolution ? {
          label: saveResolution.label,
          onSelect: () => { void openBlockingRun(saveResolution.runId) },
        } : undefined}
        onReload={reload}
        onSave={() => changeMode('save')}
        onSelect={(summary) => { void selectCheckpoint(summary) }}
        onExport={exportSelected}
        onRename={(summary) => { setSelectedSummary(summary); changeMode('rename') }}
        onDelete={(summary) => { setSelectedSummary(summary); changeMode('delete') }}
      />}
      {mode === 'preview' && (!preview
        ? <div className={`v2-board-history-state ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
          {error || <><LoaderCircle className="is-spinning" size={17} />正在打开只读版本…</>}
          <button type="button" onClick={backToList}>返回列表</button>
        </div>
        : <BoardHistoryPreviewView
          checkpoint={preview.checkpoint}
          currentBoard={isCurrentBoard && currentBoard ? currentBoard : preview.board}
          currentRuns={preview.runs}
          liveRuns={isCurrentBoard ? currentRuns : undefined}
          onBack={backToList}
          onFork={() => setMode('fork')}
          onExport={() => exportSelected(summaryFor(preview.checkpoint))}
        />)}
      {mode === 'save' && <CheckpointEditTask
        heading="保存画布版本"
        description="保存当前稳定状态，之后可从副本继续。"
        submitLabel="保存版本"
        busy={busy}
        error={error}
        onCancel={() => { setMode('list'); setError(null) }}
        onSubmit={async (title, note) => {
          setBusy(true)
          setError(null)
          try {
            const created = await createCheckpoint(target.id, {
              title, ...(note ? { note } : {}), baseRevision: currentRevision,
            })
            setCheckpoints((items) => [summaryFor(created), ...items])
            setMode('list')
            void reload()
          } catch (reason) {
            setError(userFacingStoreError(reason))
          } finally {
            setBusy(false)
          }
        }}
      />}
      {mode === 'rename' && selectedSummary && <CheckpointEditTask
        heading="重命名画布版本"
        description="只修改名称和备注，保存的画布内容不会改变。"
        initialTitle={selectedSummary.title}
        initialNote={selectedSummary.note || ''}
        submitLabel="保存名称"
        busy={busy}
        error={error}
        onCancel={() => { setMode('list'); setError(null) }}
        onSubmit={async (title, note) => {
          setBusy(true)
          setError(null)
          try {
            const updated = await updateCheckpoint(target.id, selectedSummary.id, {
              title,
              note: note || null,
              baseMetadataUpdatedAt: selectedSummary.metadataUpdatedAt,
            })
            setCheckpoints((items) => items.map((item) =>
              item.id === updated.id ? summaryFor(updated) : item))
            setMode('list')
            void reload()
          } catch (reason) {
            setError(userFacingStoreError(reason))
          } finally {
            setBusy(false)
          }
        }}
      />}
      {mode === 'delete' && selectedSummary && <CheckpointConfirmTask
        icon={<Trash2 size={18} />}
        heading={`删除“${selectedSummary.title}”？`}
        description="这个画布版本会永久删除，不影响当前画板，也不能撤销。"
        confirmLabel="确认删除"
        danger
        busy={busy}
        error={error}
        onCancel={() => { setMode('list'); setError(null) }}
        onConfirm={async () => {
          setBusy(true)
          setError(null)
          try {
            await deleteCheckpoint(target.id, selectedSummary.id)
            setCheckpoints((items) => items.filter((item) => item.id !== selectedSummary.id))
            setMode('list')
            void reload()
          } catch (reason) {
            setError(userFacingStoreError(reason))
          } finally {
            setBusy(false)
          }
        }}
      />}
      {mode === 'fork' && preview && <CheckpointForkTask
        initialTitle={defaultCheckpointForkTitle(target.title)}
        checkpointTitle={preview.checkpoint.title}
        busy={busy}
        error={error}
        onCancel={() => { setMode('preview'); setError(null) }}
        onSubmit={async (title) => {
          setBusy(true)
          setError(null)
          await requests.run(
            () => forkCheckpoint(target.id, preview.checkpoint.id, title, requests.capture()),
            () => { setBusy(false); close() },
            (reason) => { setError(userFacingStoreError(reason)); setBusy(false) },
          )
        }}
      />}
    </div>
  </aside>
}

function CheckpointEditTask({
  heading,
  description,
  initialTitle = '',
  initialNote = '',
  submitLabel,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  heading: string
  description: string
  initialTitle?: string
  initialNote?: string
  submitLabel: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (title: string, note?: string) => AsyncResult
}) {
  const [title, setTitle] = useState(initialTitle)
  const [note, setNote] = useState(initialNote)
  const draft = normalizeCheckpointDraft(title, note)
  return <form className="v2-board-history-task" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault()
    if (!draft.error) void onSubmit(draft.title, draft.note)
  }}>
    <header><button className="v2-icon-button" type="button" aria-label="返回画布版本列表" title="返回" disabled={busy} onClick={onCancel}><ArrowLeft size={17} /></button><div><span>画布版本</span><h3>{heading}</h3></div></header>
    <p>{description}</p>
    <label><span>版本名称</span><input autoFocus data-history-autofocus value={title} disabled={busy} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label>
    <label><span>备注（可选）</span><textarea value={note} disabled={busy} maxLength={240} onChange={(event) => setNote(event.target.value)} /></label>
    {(draft.error || error) && <div className="v2-board-history-inline-error" role="alert">{error || draft.error}</div>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="v2-primary-button" type="submit" disabled={busy || Boolean(draft.error)}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}{busy ? '正在保存…' : submitLabel}</button></footer>
  </form>
}

function CheckpointConfirmTask({
  icon,
  heading,
  description,
  confirmLabel,
  danger = false,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  icon: ReactNode
  heading: string
  description: string
  confirmLabel: string
  danger?: boolean
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => AsyncResult
}) {
  return <section className="v2-board-history-task v2-board-history-confirm" aria-busy={busy}>
    <div className={danger ? 'is-danger' : ''}>{icon}</div><h3>{heading}</h3><p>{description}</p>
    {error && <div className="v2-board-history-inline-error" role="alert">{error}</div>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className={danger ? 'v2-danger-button' : 'v2-primary-button'} type="button" disabled={busy} onClick={() => void onConfirm()}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : icon}{busy ? '正在处理…' : confirmLabel}</button></footer>
  </section>
}

function CheckpointForkTask({
  initialTitle,
  checkpointTitle,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initialTitle: string
  checkpointTitle: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (title: string) => AsyncResult
}) {
  const [title, setTitle] = useState(initialTitle)
  const normalized = title.trim()
  const invalid = !normalized || [...normalized].length > 120
  return <form className="v2-board-history-task" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!invalid) void onSubmit(normalized) }}>
    <header><button className="v2-icon-button" type="button" aria-label="返回版本预览" title="返回" disabled={busy} onClick={onCancel}><ArrowLeft size={17} /></button><div><span>来自“{checkpointTitle}”</span><h3>创建画板副本</h3></div></header>
    <p>新画板拥有全新身份；当前画板和这个版本不会改变。</p>
    <label><span>新画板名称</span><input autoFocus data-history-autofocus value={title} maxLength={120} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
    {error && <div className="v2-board-history-inline-error" role="alert">{error}</div>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="v2-primary-button" type="submit" disabled={busy || invalid}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : <CopyPlus size={15} />}{busy ? '正在创建…' : '创建并打开副本'}</button></footer>
  </form>
}

function summaryFor(checkpoint: BoardCheckpointV1): BoardCheckpointSummary {
  return {
    id: checkpoint.id,
    boardId: checkpoint.boardId,
    title: checkpoint.title,
    ...(checkpoint.note ? { note: checkpoint.note } : {}),
    baseBoardRevision: checkpoint.baseBoardRevision,
    counts: {
      cards: checkpoint.artifact.board.cards.length,
      transformations: checkpoint.artifact.board.transformations.length,
      runs: checkpoint.artifact.runs.length,
    },
    createdAt: checkpoint.createdAt,
    metadataUpdatedAt: checkpoint.metadataUpdatedAt,
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '保存时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function cardHeadLabel(card: BoardV2['cards'][number]): string {
  const head = card.versions.find((version) => version.id === card.headVersionId)
  if (head?.content.kind === 'markdown') return head.content.markdown.trim().slice(0, 28) || '空白卡片'
  if (head?.content.kind === 'file-reference') return head.content.path.split('/').pop() || '文件材料'
  return '未完成卡片'
}
