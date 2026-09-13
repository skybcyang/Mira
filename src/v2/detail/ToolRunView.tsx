import { useEffect, useRef, useState } from 'react'
import type { TransformationRun } from '../../domain'
import { toolPhases, type ToolFile } from '../../domain/toolPolicy.js'
import { v2Api } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { userFacingStoreError } from '../storePolicy'
import { reviewIdentity, toolSourceLabels } from './toolControls'

function ToolAttachment({ file }: { file: ToolFile }) {
  const [open, setOpen] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let url = ''
    try {
      if (!['image/png', 'text/csv', 'text/plain'].includes(file.mimeType) || file.data.length > 1398104) throw new Error('unsupported')
      const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0))
      url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
      setDownloadUrl(url)
      if (file.mimeType !== 'image/png') setText(new TextDecoder().decode(bytes))
    } catch { setError('附件无法预览，请核对运行记录。') }
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [open, file])
  return <div className="v2-tool-attachment"><button type="button" className="v2-secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '预览'} {file.name}</button>{open && <>{error ? <p role="alert">{error}</p> : <>{file.mimeType === 'image/png' ? <img src={downloadUrl || undefined} alt={file.name} /> : <pre>{text}</pre>}{downloadUrl && <a href={downloadUrl} download={file.name}>下载 {file.name}</a>}</>}</>}</div>
}

export function ToolRunView({ run, now: providedNow, onReview }: {
  run: TransformationRun; now?: number; onReview?: (runId: string, body: { requestId: string; digest: string; approve: boolean }) => Promise<unknown>
}) {
  const [clock, setClock] = useState(Date.now())
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState('')
  const [uncertain, setUncertain] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (!run.toolReview || run.status !== 'running' || providedNow !== undefined) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [run.toolReview, run.status, providedNow])
  const review = run.toolReview
  const identity = review ? reviewIdentity(run.id, review) : ''
  const now = providedNow ?? clock
  const valid = Boolean(review && run.status === 'running' && Date.parse(review.expiresAt) > now)
  const decided = identity === submitted || identity === uncertain
  const decide = async (approve: boolean) => {
    if (!review || !valid || decided || lock.current) return
    lock.current = true; setPending(true); setError('')
    try {
      await (onReview || v2Api.approveToolReview)(run.id, { requestId: review.requestId, digest: review.digest, approve })
      if (alive.current) setSubmitted(identity)
    } catch (cause) {
      if (alive.current) { setError(userFacingStoreError(cause)); setUncertain(identity) }
    } finally { lock.current = false; if (alive.current) setPending(false) }
  }
  const check = async () => {
    if (lock.current) return
    lock.current = true; setChecking(true)
    try {
      const current = (await v2Api.getRun(run.id)).run
      if (!alive.current) return
      // Refresh only an existing run in this same board; never revive a departed workspace.
      useV2Canvas.setState(state => state.boardId === run.boardId && state.runs[run.id]
        ? { runs: { ...state.runs, [run.id]: current } } : {})
      setUncertain(''); setError('')
      if (!current.toolReview || reviewIdentity(current.id, current.toolReview) !== identity || current.status !== 'running') setSubmitted(identity)
    } catch { if (alive.current) setError('无法核对运行状态，请稍后重新核对。不要重复执行。') }
    finally { lock.current = false; if (alive.current) setChecking(false) }
  }
  if (!run.toolPolicySnapshot && !run.toolExecutions?.length && !review) return null
  return <section className="v2-tool-run" aria-label="本次工具调用">
    {review && <section className="v2-tool-review" aria-label="工具执行审阅" aria-busy={pending || checking}>
      <h3>{valid ? '等待审阅' : '审阅已失效'} · {review.title}</h3>
      <p>版本：{review.version}</p><p>有效至 <time dateTime={review.expiresAt}>{new Date(review.expiresAt).toLocaleString()}</time></p>
      <h4>这次调用的完整参数</h4><pre>{JSON.stringify(review.arguments, null, 2)}</pre>
      {review.code && <><h4>完整代码</h4><pre className="v2-tool-code">{review.code}</pre></>}
      <p>输入仅来自本次冻结的来源与已确认参数。</p>
      <details onToggle={event => setSourcesOpen(event.currentTarget.open)}><summary>核对冻结来源 · {run.sourceSnapshot.length} 份</summary>{sourcesOpen && run.sourceSnapshot.map((source, index) => <div key={`${source.cardId}:${source.versionId}`}><h4>来源 {index + 1} · {source.cardId}</h4><p>版本：{source.versionId} · {source.scope ? '已选片段' : '本次读取内容'}</p><pre>{source.resolvedContent}</pre></div>)}</details>
      {run.toolPolicySnapshot?.tools.find(item => item.id === review.configId)?.urls?.length && <p>允许网址：{run.toolPolicySnapshot.tools.find(item => item.id === review.configId)?.urls?.join('、')}</p>}
      {review.environment && <><p>执行环境：{review.environment}</p><p>无网络、无宿主目录；内存 512 MiB、1 CPU、32 进程、临时空间 16 MiB。单次通常 30 秒，最多 60 秒。</p></>}
      <p className="v2-detail-note">只批准这一次请求。停止不会撤销已经发生的外部操作。</p>
      {valid && <div className="v2-tool-review-actions"><button type="button" className="v2-primary-button" disabled={pending || checking || decided} onClick={() => void decide(true)}>{pending ? '正在提交…' : review.code ? '执行这份代码' : '执行这次调用'}</button><button type="button" className="v2-danger-button" disabled={pending || checking || decided} onClick={() => void decide(false)}>拒绝并停止</button></div>}
      {submitted === identity && <p role="status">决定已提交，正在等待运行状态更新。</p>}
      {error && <p role="alert">{error}</p>}
      {uncertain === identity && <><p>提交结果需要核对，暂不重复发送。</p><button type="button" className="v2-secondary-button" disabled={pending || checking} onClick={() => void check()}>{checking ? '正在核对…' : '重新核对运行状态'}</button></>}
      <details><summary>请求身份</summary><p>{review.requestId}</p><p>{review.digest}</p></details>
    </section>}
    {run.toolPolicySnapshot && <details><summary>本次冻结工具 · {run.toolPolicySnapshot.tools.length} 项</summary><ol>{run.toolPolicySnapshot.tools.map(item => <li key={item.id}><strong>{item.tool.title}</strong><p>{toolSourceLabels[item.tool.source]} · {toolPhases[item.phase]} · {run.toolExecutions?.some(event => event.configId === item.id) ? '已有调用记录' : '尚未调用'}</p><p>版本：{item.tool.version}</p><pre>{JSON.stringify(item.arguments, null, 2)}</pre>{item.urls?.length && <p>允许网址：{item.urls.join('、')}</p>}</li>)}</ol><p>临时 Python：{run.toolPolicySnapshot.allowTemporaryPython ? '允许提出代码，执行前审阅' : '未开启'}</p></details>}
    {!!run.toolExecutions?.length && <><h3>实际调用</h3><ol className="v2-tool-executions">{run.toolExecutions.map(item => <li key={item.id}>
      <strong>{item.title} · {toolPhases[item.phase]} · {item.status === 'started' && run.status !== 'running' && run.status !== 'queued' ? '未完成' : { started: '正在执行', succeeded: '已完成', failed: '未通过' }[item.status]}</strong>
      <p><time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleString()}</time>{item.finishedAt && <> → <time dateTime={item.finishedAt}>{new Date(item.finishedAt).toLocaleString()}</time></>}</p>
      <details><summary>实际参数与版本</summary><pre>{JSON.stringify(item.arguments, null, 2)}</pre><p>{item.version}</p></details>
      {item.text !== undefined && <pre>{item.text}</pre>}{item.error && <p role="alert">{item.error}</p>}
      {item.files?.map((file, index) => <ToolAttachment key={`${item.id}:${index}`} file={file} />)}
      {item.filesOmitted && <p>附件未随数据包携带。</p>}
    </li>)}</ol></>}
  </section>
}
