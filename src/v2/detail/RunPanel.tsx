import { useRef, useState } from 'react'
import { GitCompareArrows, LoaderCircle, Play, Square } from 'lucide-react'
import type { TransformationRun } from '../../domain'
import { useV2Canvas } from '../../v2Store'
import { runExclusiveAction } from '../drawerSafety'
import { dateTime, elapsed, when } from './formatters'
import CandidateComparison from './CandidateComparison'
export { CandidateDecisionActions } from './CandidateComparison'

export function TransformationRunControl({
  candidatePending,
  busy = false,
  running = false,
  onRun,
  onStop,
}: {
  workflowStep: boolean
  hasRun: boolean
  sourcesReady: boolean
  candidatePending: boolean
  busy?: boolean
  running?: boolean
  onRun: () => void
  onStop?: () => void | Promise<void>
}) {
  if (running && onStop) return <RunStopButton onStop={onStop} />
  const label = candidatePending
    ? '先处理待比较结果'
    : running
      ? '正在运行到这里'
      : busy
        ? '正在运行其他位置'
        : '运行到这里'
  return <button className="v2-primary-button v2-run-transformation" type="button" disabled={candidatePending || busy} onClick={onRun}>
    {busy ? <LoaderCircle className="is-spinning" size={15} /> : <Play size={15} />}{label}
  </button>
}

export function RunStopButton({ onStop }: { onStop: () => void | Promise<void> }) {
  const stopLock = useRef(false)
  const [stopping, setStopping] = useState(false)
  return <button
    className="v2-danger-button v2-stop-run"
    type="button"
    aria-label="停止生成"
    aria-busy={stopping}
    disabled={stopping}
    onClick={() => {
      const task = runExclusiveAction(stopLock, onStop)
      if (!task) return
      setStopping(true)
      const settle = () => setStopping(false)
      void task.then(settle, settle)
    }}
  >{stopping ? <LoaderCircle className="is-spinning" size={15} /> : <Square size={14} />}{stopping ? '正在停止…' : '停止生成'}</button>
}

export function RunPanelView({
  run,
  now = Date.now(),
  step,
  onCompare,
  onStop,
}: {
  run: TransformationRun
  now?: number
  step?: { index: number; total: number; label: string }
  onStop?: () => void | Promise<void>
  onCompare?: () => void
}) {
  const candidate = run.result?.disposition === 'candidate' ? run.result.output : ''
  const active = run.status === 'queued' || run.status === 'running'
  const hasProgressHistory = Boolean(run.progressEvents?.length)
  const visibleProgress = active || hasProgressHistory ? run.progress : undefined
  const latestAt = active
    ? visibleProgress?.updatedAt || run.startedAt || run.createdAt
    : run.finishedAt || visibleProgress?.updatedAt || run.startedAt || run.createdAt
  const elapsedUntil = active ? now : run.finishedAt ? Date.parse(run.finishedAt) : null
  const elapsedText = elapsedUntil === null
    ? null
    : elapsed(run.startedAt || run.createdAt, elapsedUntil)
  const statusTitle = run.status === 'succeeded'
    ? candidate ? '有一个待比较结果' : run.result?.disposition === 'discarded' ? '已丢弃结果' : '生成完成'
    : run.status === 'failed'
      ? '生成未完成'
      : run.status === 'interrupted'
        ? '已停止'
        : '正在生成'
  const progressSummary = active
    ? visibleProgress?.label || run.error?.message || when(latestAt)
    : run.status === 'failed' || run.status === 'interrupted'
      ? run.error?.message || (visibleProgress?.label !== statusTitle ? visibleProgress?.label : '')
      : visibleProgress?.label !== statusTitle ? visibleProgress?.label : ''
  return <div className="v2-run-panel">
    {step && <div className="v2-run-step"><span>第 {step.index}/{step.total} 步</span><strong>{step.label}</strong></div>}
    <div className={`v2-run-state ${run.status}`}>
      <strong aria-live="polite" aria-atomic="true">{statusTitle}</strong>
      {(progressSummary || visibleProgress?.detail) && <div className="v2-run-current" aria-live="polite" aria-atomic="true">
        {progressSummary && <span>{progressSummary}</span>}
        {visibleProgress?.detail && <small>{visibleProgress.detail}</small>}
      </div>}
      <div className="v2-run-meta">
        {elapsedText && <span>已用 {elapsedText}</span>}
        <time dateTime={dateTime(latestAt)}>最后更新 {when(latestAt)}</time>
      </div>
    </div>
    {active && onStop && <RunStopButton onStop={onStop} />}
    {run.modelSnapshot && <div className="v2-run-model"><span>实际模型</span><code>{run.modelSnapshot.provider} / {run.modelSnapshot.model}</code></div>}
    {candidate && <><div className="v2-candidate-head"><GitCompareArrows size={16} />当前内容与生成结果</div>
      <p className="v2-candidate-excerpt">{candidate}</p>
      <button className="v2-primary-button" type="button" onClick={onCompare}><GitCompareArrows size={16} />查看待比较结果</button>
      <p className="v2-detail-note">采用会创建新版本，不会覆盖或删除人工编辑。</p></>}
    {run.error && <pre className="v2-diagnostic">{run.error.code}\n{run.error.message}</pre>}
    <section className="v2-run-progress" aria-labelledby="v2-run-progress-title">
      <h3 id="v2-run-progress-title">进度记录</h3>
      {run.progressEvents?.length
        ? <ol>{run.progressEvents.map((event) => <li key={event.sequence} className={event.phase}>
            <time dateTime={dateTime(event.occurredAt)}>{when(event.occurredAt)}</time>
            <div><strong>{event.label}</strong>{event.detail && <span>{event.detail}</span>}</div>
          </li>)}</ol>
        : <p>尚无可显示的进度记录</p>}
    </section>
  </div>
}

export function RunPanel({ runId }: { runId: string }) {
  const run = useV2Canvas((state) => state.runs[runId])
  const board = useV2Canvas((state) => state.board)
  const [comparing, setComparing] = useState(false)
  const interrupt = useV2Canvas((state) => state.interruptRun)
  if (!run) return <p className="v2-empty-detail">运行信息尚未载入。</p>
  const card = board?.cards.find((item) => item.id === run.targetCardId)
  const transformation = board?.transformations.find((item) => item.id === run.transformationId)
  const legacyApplication = transformation?.workflowRef
    ? board?.transformations.filter((item) => item.workflowRef?.workflowId === transformation.workflowRef?.workflowId
      && item.workflowRef?.applicationId === transformation.workflowRef?.applicationId) || []
    : []
  const legacyStepIndex = legacyApplication.findIndex((item) => item.id === transformation?.id)
  const step = transformation?.planRef
    ? {
        index: transformation.planRef.stepIndex,
        total: transformation.planRef.stepTotal,
        label: transformation.label,
      }
    : legacyStepIndex >= 0
      ? { index: legacyStepIndex + 1, total: legacyApplication.length, label: transformation?.label || '这一步' }
      : undefined
  return <><RunPanelView
    run={run}
    step={step}
    onCompare={() => setComparing(true)}
    onStop={() => interrupt(run.id)}
  />{comparing && card && <CandidateComparison card={card} run={run} onClose={() => setComparing(false)} />}</>
}
