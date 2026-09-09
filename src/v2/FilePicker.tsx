import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, FolderClosed, Home, LoaderCircle, X } from 'lucide-react'
import { v2Api, type FileBrowseEntry, type FileBrowseResult } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import { confirmLabel, locationLabel, pickModeForEntry, selectionDetail, browseErrorMessage } from './filePickerPolicy'

export default function FilePicker({
  anchor,
  mode = 'card',
  cardId,
  onClose,
}: {
  anchor: { x: number; y: number }
  mode?: 'card' | 'binding'
  cardId?: string
  onClose: (outcome: 'cancel' | 'complete') => void
}) {
  const createFileCard = useV2Canvas((state) => state.createFileCard)
  const bindCardFile = useV2Canvas((state) => state.bindCardFile)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [result, setResult] = useState<FileBrowseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FileBrowseEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const browse = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      setResult(await v2Api.browseFiles(path))
    } catch (cause) {
      setError(browseErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    void browse()
  }, [browse])

  async function confirm(overwrite = false) {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      let path = selected.workspaceRelative
      if (mode === 'binding') {
        if (!cardId || path === null) throw new Error('只能绑定工作区内文件')
        if (!(await bindCardFile(cardId, path, overwrite))) return
      } else if (path === null) {
        path = (await v2Api.importFile(selected.path)).path
        await createFileCard(anchor, path)
      } else {
        await createFileCard(anchor, path)
      }
      onClose('complete')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件添加失败')
    } finally {
      setBusy(false)
    }
  }

  const selectedMode = selected ? pickModeForEntry(selected) : null

  return <dialog
    ref={dialogRef}
    className="v2-file-picker"
    role="dialog"
    aria-modal="true"
    aria-labelledby="v2-file-picker-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose('cancel') }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose('cancel') }}
  >
    <header className="v2-file-picker-head">
      <h2 id="v2-file-picker-title"><FileText size={17} />{mode === 'binding' ? '绑定本地文件' : '添加文件材料'}</h2>
      <button className="v2-icon-button" type="button" aria-label="关闭文件选择器" title="关闭" disabled={busy} onClick={() => onClose('cancel')}><X size={17} /></button>
    </header>
    <nav className="v2-file-picker-nav" aria-label="目录导航">
      <button
        className="v2-icon-button"
        type="button"
        aria-label="回到工作区"
        title="回到工作区"
        disabled={loading || busy || result?.workspaceRelative === ''}
        onClick={() => void browse()}
      ><Home size={15} /></button>
      <button
        className="v2-icon-button"
        type="button"
        aria-label="上一级目录"
        title="上一级目录"
        disabled={loading || busy || !result?.parent}
        onClick={() => { if (result?.parent) void browse(result.parent) }}
      ><ArrowUp size={15} /></button>
      <span className="v2-file-picker-location" title={result?.path}>{result ? locationLabel(result) : ''}</span>
    </nav>
    <div className="v2-file-picker-body">
      {loading && <div className="v2-file-picker-state" role="status"><LoaderCircle className="is-spinning" size={15} />正在读取目录…</div>}
      {!loading && error && <div className="v2-file-picker-state" role="alert">{error}</div>}
      {!loading && !error && result && result.entries.length === 0
        && <div className="v2-file-picker-state">这个目录没有可选择的文件</div>}
      {!loading && !error && result && <ul className="v2-file-picker-list">
        {result.entries.map((entry) => <li key={entry.path}>
          {entry.kind === 'directory'
            ? <button type="button" className="v2-file-picker-entry" disabled={busy} onClick={() => void browse(entry.path)}>
              <FolderClosed size={15} /><span>{entry.name}</span>
            </button>
            : <button
              type="button"
              className={`v2-file-picker-entry ${selected?.path === entry.path ? 'is-selected' : ''}`}
              disabled={busy || (mode === 'binding' && entry.workspaceRelative === null)}
              aria-pressed={selected?.path === entry.path}
              onClick={() => setSelected(entry)}
            >
              <FileText size={15} /><span>{entry.name}</span>
              {entry.workspaceRelative === null && <em>工作区外</em>}
            </button>}
        </li>)}
      </ul>}
    </div>
    <footer className="v2-file-picker-foot">
      {selected && selectedMode
        ? <span className="v2-file-picker-selection">{mode === 'binding' ? `将绑定 ${selected.workspaceRelative || selected.path}` : selectionDetail(selected, selectedMode)}</span>
        : <span className="v2-file-picker-selection is-empty">选择一个文件以{mode === 'binding' ? '绑定' : '添加为材料'}</span>}
      <div className="v2-file-picker-actions">
        <button
          className="v2-file-picker-confirm"
          type="button"
          disabled={!selected || busy}
          onClick={() => void confirm()}
        >{busy ? (mode === 'binding' ? '正在绑定…' : '正在添加…') : (mode === 'binding' ? '绑定此文件' : confirmLabel(selectedMode || 'reference'))}</button>
        {mode === 'binding' && <button
          className="v2-file-picker-overwrite"
          type="button"
          disabled={!selected || busy}
          onClick={() => void confirm(true)}
        >覆盖并绑定</button>}
      </div>
    </footer>
  </dialog>
}
