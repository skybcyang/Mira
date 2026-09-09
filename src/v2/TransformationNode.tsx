import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react'
import { AlertCircle, GitCompareArrows, ListChecks, LoaderCircle, Play, RotateCw, Square } from 'lucide-react'
import type { V2TransformationNodeData } from '../v2Projection'
import { useV2Canvas } from '../v2Store'
import { useDrawerAction, useDrawerIntent } from './drawerIntent'
import { appendedSources, sourceEditBlock, sourceListError } from './transformationSources'

type TransformationNodeType = Node<V2TransformationNodeData, 'transformation'>

function stateCopy(data: V2TransformationNodeData) {
  if (data.candidateRunId) return '待比较'
  if (data.status === 'queued' || data.status === 'running') return '生成中'
  if (data.status === 'failed') return '未完成'
  if (data.stale) return '来源已变化'
  if (data.status === 'succeeded') return '已完成'
  return '尚未生成'
}

export function TransformationCardView({
  data,
  onRun,
  onStop,
  runningToHere = false,
  executionLocked = false,
  onPreview,
}: {
  data: V2TransformationNodeData
  onRun: () => void
  onStop?: () => void
  runningToHere?: boolean
  executionLocked?: boolean
  onPreview?: () => void
}) {
  const running = data.status === 'queued' || data.status === 'running'
  const disabled = !data.candidateRunId && (running ? !onStop : executionLocked)
  const runLabel = data.candidateRunId
    ? '比较待处理结果'
    : running
      ? '停止生成'
      : runningToHere
      ? '正在运行到这里'
      : executionLocked
        ? '正在运行其他位置'
        : '运行到这里'
  const workflowPosition = data.workflowStepIndex && data.workflowStepTotal
    ? `${data.workflowStepIndex}/${data.workflowStepTotal}`
    : null

  return <article className={`v2-transformation-node is-${data.status}${data.stale ? ' is-stale' : ''}${data.candidateRunId ? ' has-candidate' : ''}`}>
    <header>
      <span>步骤 · {data.sourceCount} 个来源</span>
      {workflowPosition && <small>{workflowPosition}</small>}
    </header>
    <strong title={data.label}>{data.label}</strong>
    <footer>
      <span className="v2-transformation-state">
        {data.candidateRunId
          ? <GitCompareArrows size={12} />
          : running
            ? <LoaderCircle className="is-spinning" size={12} />
            : data.status === 'failed'
              ? <AlertCircle size={12} />
              : data.stale
                ? <RotateCw size={12} />
                : null}
        {stateCopy(data)}
      </span>
      {onPreview && <button className="nodrag" type="button" aria-label="查看运行范围" title="查看运行范围" onClick={(event) => { event.stopPropagation(); onPreview() }}><ListChecks size={14} /></button>}
      <button
        className="nodrag"
        type="button"
        disabled={disabled}
        aria-label={runLabel}
        title={runLabel}
        onClick={(event) => {
          event.stopPropagation()
          if (running && onStop) onStop()
          else onRun()
        }}
      >
        {running
          ? <Square size={14} />
          : runningToHere
            ? <LoaderCircle className="is-spinning" size={14} />
          : data.candidateRunId
            ? <GitCompareArrows size={14} />
            : data.status === 'idle'
              ? <Play size={14} />
              : <RotateCw size={14} />}
      </button>
    </footer>
  </article>
}

export default function TransformationNode({ data }: NodeProps<TransformationNodeType>) {
  const connection = useConnection()
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const step = board?.transformations.find(item => item.id === data.transformationId)
  const connectingCardId = connection.inProgress && connection.fromNode?.type === 'contentCard' ? connection.fromNode.id : null
  const sourceError = board && step && connectingCardId
    ? sourceEditBlock(board, step, runs) || sourceListError(board, step, appendedSources(step, [connectingCardId]))
    : null
  const runTo = useV2Canvas((state) => state.runToTransformation)
  const interrupt = useV2Canvas((state) => state.interruptRun)
  const runningToTransformationId = useV2Canvas((state) => state.runningToTransformationId)
  const storeOpenDrawer = useV2Canvas((state) => state.openDrawer)
  const openDrawer = useDrawerIntent(storeOpenDrawer)
  const runDrawerAction = useDrawerAction()
  const running = data.status === 'queued' || data.status === 'running'
  return <>
    <Handle className={`v2-transformation-handle v2-source-input${connectingCardId ? sourceError ? ' is-source-rejected' : ' is-source-ready' : ''}`}
      type="target" position={Position.Left} isConnectableStart={false}
      title={sourceError || '添加来源'} aria-label={sourceError || '添加来源'}
      isValidConnection={() => !sourceError} />
    {connectingCardId && <span className={`v2-source-connection-feedback${sourceError ? ' is-rejected' : ''}`}>{sourceError || '添加来源'}</span>}
    <TransformationCardView
      data={data}
      onPreview={() => openDrawer({ tab: 'relation', transformationId: data.transformationId, preview: true })}
      runningToHere={runningToTransformationId === data.transformationId}
      executionLocked={Boolean(runningToTransformationId)}
      onStop={data.runId ? () => { void interrupt(data.runId!) } : undefined}
      onRun={() => {
        if (data.candidateRunId) {
          openDrawer({ tab: 'run', runId: data.candidateRunId })
          return
        }
        if (!running && !runningToTransformationId) {
          runDrawerAction(() => runTo(data.transformationId))
        }
      }}
    />
    <Handle className="v2-transformation-handle" type="source" position={Position.Right} isConnectable={false} />
  </>
}
