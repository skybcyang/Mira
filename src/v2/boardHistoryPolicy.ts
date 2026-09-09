import type { TransformationRun } from '../domain'
import type { BoardLifecycleState } from '../v2Api'
import type { BoardCheckpointSaveStatus } from '../v2Api'

const CHECKPOINT_TITLE_LIMIT = 80
const CHECKPOINT_NOTE_LIMIT = 240
const BOARD_TITLE_LIMIT = 120
const CHECKPOINT_LIMIT = 20
const FORK_SUFFIX = ' - 版本副本'

export interface CheckpointDraft {
  title: string
  note: string | undefined
  error?: string
}

export interface CheckpointSaveResolution {
  runId: string
  label: '查看运行' | '比较待处理结果'
}

export function checkpointSaveResolution(
  runs: TransformationRun[],
): CheckpointSaveResolution | null {
  const active = runs.find((run) => run.status === 'queued' || run.status === 'running')
  if (active) return { runId: active.id, label: '查看运行' }
  const candidate = runs.find((run) =>
    run.status === 'succeeded' && run.result?.disposition === 'candidate')
  return candidate ? { runId: candidate.id, label: '比较待处理结果' } : null
}

export function checkpointSaveBlockerFromStatus(status: BoardCheckpointSaveStatus): string | null {
  if (status.allowed) return null
  if (status.reason === 'read-only') return '只有工作中的画板可以保存新版本。'
  if (status.reason === 'active-run') return '生成结束或停止后才能保存稳定版本。'
  if (status.reason === 'pending-candidate') return '先采用或丢弃待比较结果。'
  return '每个画板最多保存 20 个版本，请先删除不再需要的版本。'
}

export function checkpointSaveResolutionFromStatus(
  status: BoardCheckpointSaveStatus,
): CheckpointSaveResolution | null {
  if (status.allowed || !status.runId) return null
  if (status.reason === 'active-run') return { runId: status.runId, label: '查看运行' }
  if (status.reason === 'pending-candidate') {
    return { runId: status.runId, label: '比较待处理结果' }
  }
  return null
}

export function normalizeCheckpointDraft(titleValue: string, noteValue: string): CheckpointDraft {
  const title = titleValue.trim()
  const note = noteValue.trim() || undefined
  if (!title) return { title, note, error: '请输入画布版本名称。' }
  if ([...title].length > CHECKPOINT_TITLE_LIMIT) {
    return { title, note, error: '名称不能超过 80 个字符。' }
  }
  if (note && [...note].length > CHECKPOINT_NOTE_LIMIT) {
    return { title, note, error: '备注不能超过 240 个字符。' }
  }
  return { title, note }
}

export function checkpointSaveBlocker(
  lifecycle: BoardLifecycleState,
  runs: TransformationRun[],
  checkpointCount: number,
): string | null {
  if (lifecycle !== 'active') return '只有工作中的画板可以保存新版本。'
  if (runs.some((run) => run.status === 'queued' || run.status === 'running')) {
    return '生成结束或停止后才能保存稳定版本。'
  }
  if (runs.some((run) =>
    run.status === 'succeeded' && run.result?.disposition === 'candidate')) {
    return '先采用或丢弃待比较结果。'
  }
  if (checkpointCount >= CHECKPOINT_LIMIT) {
    return '每个画板最多保存 20 个版本，请先删除不再需要的版本。'
  }
  return null
}

export function defaultCheckpointForkTitle(boardTitle: string): string {
  const available = BOARD_TITLE_LIMIT - [...FORK_SUFFIX].length
  return `${[...boardTitle.trim()].slice(0, available).join('')}${FORK_SUFFIX}`
}
