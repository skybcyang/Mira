import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import MarkdownContent from './MarkdownContent'
import { v2Api } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import { diffLines, headVersion, sourceCardPresentations } from '../v2View'
import type { SourcePreviewRequest } from './sourcePreviewContext'
import { readerKeyDown } from './cardReadingEvents'

export function SourcePreviewPanel({ request, onClose, returnLabel = '返回原任务' }: { request: SourcePreviewRequest; onClose: () => void; returnLabel?: string }) {
  return <SourcePreviewContent
    key={JSON.stringify([request.boardId, request.cardId, request.runId, request.snapshot?.versionId])}
    request={request}
    onClose={onClose}
    returnLabel={returnLabel}
  />
}

function SourcePreviewContent({ request, onClose, returnLabel }: { request: SourcePreviewRequest; onClose: () => void; returnLabel: string }) {
  const board = useV2Canvas((state) => state.board?.id === request.boardId ? state.board : null)
  const card = board?.cards.find((item) => item.id === request.cardId)
  const currentHead = card ? headVersion(card) : undefined
  const [pinned, setPinned] = useState(currentHead)
  const [mode, setMode] = useState<'historical' | 'current'>(request.snapshot ? 'historical' : 'current')
  const [reload, setReload] = useState(0)
  const [file, setFile] = useState<{
    loading: boolean; content: string; error?: string; readAt?: string; versionId?: string; path?: string
  }>({ loading: true, content: '' })
  const snapshot = request.snapshot
  const available = Boolean(card && currentHead)
  const historical = mode === 'historical' && snapshot
  const changed = available && currentHead?.id !== pinned?.id
  const path = file.path || (pinned?.content.kind === 'file-reference' ? pinned.content.path : undefined)
  const fileReference = pinned?.content.kind === 'file-reference'

  useEffect(() => {
    if (mode !== 'current' || !available || !fileReference) return
    let active = true
    setFile({ loading: true, content: '' })
    void v2Api.getCardContent(request.boardId, request.cardId).then(
      (result) => {
        if (!active) return
        if (typeof result?.content !== 'string' || typeof result.versionId !== 'string') {
          setFile({ loading: false, content: '', error: '文件内容读取失败。' })
          return
        }
        setFile({ loading: false, content: result.content, readAt: new Date().toISOString(), versionId: result.versionId, path: result.path })
      },
      () => {
        if (!active) return
        setFile({ loading: false, content: '', error: '文件内容读取失败。' })
      },
    )
    return () => { active = false }
  }, [request.boardId, request.cardId, mode, available, fileReference, pinned?.id, reload])

  const title = card ? sourceCardPresentations([card])[0].label : '历史来源'
  const body = historical ? snapshot.resolvedContent
    : pinned?.content.kind === 'markdown' ? pinned.content.markdown : file.content
  const markdown = historical ? snapshot.contentKind === 'markdown'
    : pinned?.content.kind === 'markdown' || /\.(?:md|markdown|mdown|mkd)$/i.test(path || '')
  const loading = !historical && fileReference && file.loading
  const error = !historical && fileReference ? file.error : undefined
  const refresh = () => {
    setPinned(currentHead)
    setReload((value) => value + 1)
  }
  const compare = !historical && snapshot && available && !loading && !error
  // ponytail: bound the existing quadratic line diff; long documents retain both full reading views.
  const diffWithinLimit = compare && snapshot.resolvedContent.split('\n').length * body.split('\n').length <= 40_000
  const comparison = diffWithinLimit ? diffLines(snapshot.resolvedContent, body) : []

  return <section className="v2-source-preview" aria-label="来源预览">
    <header className="v2-source-preview-header">
      <button className="v2-source-return" type="button" title={returnLabel} aria-label={returnLabel} onClick={onClose}><ArrowLeft size={16} /><span>{returnLabel}</span></button>
      <strong>{title}</strong>
    </header>
    {snapshot && <div className="v2-source-preview-modes" role="group" aria-label="来源版本">
      <button type="button" aria-pressed={mode === 'historical'} onClick={() => setMode('historical')}>当时</button>
      <button type="button" aria-pressed={mode === 'current'} onClick={() => setMode('current')}>当前</button>
    </div>}
    <dl className="v2-source-preview-versions">
      {snapshot && <><dt>当时版本</dt><dd><code>{snapshot.versionId}</code></dd></>}
      <dt>{historical ? '当前版本' : '查看版本'}</dt><dd><code>{historical ? currentHead?.id || '不可用' : fileReference ? file.versionId || '等待读取' : pinned?.id || '不可用'}</code></dd>
    </dl>
    {!historical && !available
      ? <p className="v2-empty-detail" role="status">当前来源不可用。</p>
      : <>
        {!historical && (changed || fileReference) && <div className="v2-source-preview-update">
          {changed && <span role="status">来源有更新</span>}
          <button className="v2-icon-button" type="button" title="刷新来源" aria-label="刷新来源" disabled={loading} onClick={refresh}><RefreshCw size={15} /></button>
        </div>}
        {!historical && fileReference && <p className="v2-detail-note">当前文件内容{file.readAt && <> · <time dateTime={file.readAt}>读取于 {new Date(file.readAt).toLocaleTimeString()}</time></>}</p>}
        <div className="v2-content-reader nokey" data-card-reader="true" tabIndex={0} onKeyDown={readerKeyDown}>
          {path && !historical && <code>{path}</code>}
          {loading ? <p className="v2-content-reader-state" role="status">正在读取…</p>
            : error ? <div className="v2-content-reader-state is-error" role="alert"><p>{error}</p><button className="v2-secondary-button" type="button" onClick={refresh}>重试</button></div>
              : markdown ? <div className="v2-content-reader-prose"><MarkdownContent>{body}</MarkdownContent></div> : <pre>{body}</pre>}
        </div>
        {compare && <details className="v2-source-preview-diff">
          <summary>正文差异</summary>
          {!diffWithinLimit ? <p>正文较长，未生成逐行差异。</p>
            : comparison.every((line) => line.kind === 'same') ? <p>本次读取的正文与当时输入相同。</p>
              : <pre className="nokey" data-card-reader="true" tabIndex={0} onKeyDown={readerKeyDown}>{comparison.map((line, index) => <span key={index} className={`is-${line.kind}`}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}{line.text}{'\n'}</span>)}</pre>}
        </details>}
      </>}
  </section>
}
