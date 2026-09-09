export const RUN_PROGRESS_EVENT_LIMIT = 20

const PHASE_LIMIT = 40
const LABEL_LIMIT = 160
const DETAIL_LIMIT = 200
const PROGRESS_FIELDS = new Set(['phase', 'label', 'detail', 'updatedAt'])
const EVENT_FIELDS = new Set(['sequence', 'phase', 'label', 'detail', 'occurredAt'])
const TERMINAL_PROGRESS = {
  succeeded: { phase: 'completed', label: '生成完成' },
  failed: { phase: 'failed', label: '生成未完成' },
  interrupted: { phase: 'interrupted', label: '已停止' },
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exceedsCharacterLimit(value, limit) {
  let count = 0
  for (const _character of value) {
    count += 1
    if (count > limit) return true
  }
  return false
}

function isBoundedString(value, limit, { allowEmpty = false } = {}) {
  return typeof value === 'string'
    && !exceedsCharacterLimit(value, limit)
    && (allowEmpty || Boolean(value.trim()))
}

function normalizedText(value, limit) {
  if (typeof value !== 'string') return ''
  let normalized = ''
  let count = 0
  for (const character of value.trim()) {
    if (count >= limit) break
    normalized += character
    count += 1
  }
  return normalized
}

export function safeRunProgress(summary, updatedAt) {
  if (!isObject(summary)) return null
  const phase = normalizedText(summary.phase, PHASE_LIMIT)
  const label = normalizedText(summary.label, LABEL_LIMIT)
  const time = typeof updatedAt === 'string' ? updatedAt.trim() : ''
  if (!phase || !label || !time) return null
  const progress = { phase, label, updatedAt: time }
  if (typeof summary.detail === 'string' && summary.detail.trim()) {
    progress.detail = normalizedText(summary.detail, DETAIL_LIMIT)
  }
  return progress
}

export function appendRunProgress(run, summary, updatedAt) {
  const progress = safeRunProgress(summary, updatedAt)
  if (!progress) return run
  const previous = Array.isArray(run.progressEvents) ? run.progressEvents : []
  const sequence = (previous.at(-1)?.sequence || 0) + 1
  const event = {
    sequence,
    phase: progress.phase,
    label: progress.label,
    ...(progress.detail ? { detail: progress.detail } : {}),
    occurredAt: progress.updatedAt,
  }
  return {
    ...run,
    progress,
    progressEvents: [...previous, event].slice(-RUN_PROGRESS_EVENT_LIMIT),
  }
}

export function appendTerminalRunProgress(run, status, occurredAt) {
  const summary = TERMINAL_PROGRESS[status]
  return summary ? appendRunProgress(run, summary, occurredAt) : run
}

export function runProgressErrors(run) {
  const errors = []
  if (run.progress !== undefined && (
    !isObject(run.progress)
    || Object.keys(run.progress).some((field) => !PROGRESS_FIELDS.has(field))
    || !isBoundedString(run.progress.phase, PHASE_LIMIT)
    || !isBoundedString(run.progress.label, LABEL_LIMIT)
    || (run.progress.detail !== undefined
      && !isBoundedString(run.progress.detail, DETAIL_LIMIT, { allowEmpty: true }))
    || typeof run.progress.updatedAt !== 'string'
    || !run.progress.updatedAt.trim()
  )) errors.push('Run progress is invalid')

  if (run.progressEvents === undefined) return errors
  if (!Array.isArray(run.progressEvents) || run.progressEvents.length > RUN_PROGRESS_EVENT_LIMIT) {
    return [...errors, 'Run progressEvents are invalid']
  }
  let previousSequence = 0
  for (const event of run.progressEvents) {
    if (
      !isObject(event)
      || Object.keys(event).some((field) => !EVENT_FIELDS.has(field))
      || !Number.isSafeInteger(event.sequence)
      || event.sequence <= previousSequence
      || !isBoundedString(event.phase, PHASE_LIMIT)
      || !isBoundedString(event.label, LABEL_LIMIT)
      || (event.detail !== undefined
        && !isBoundedString(event.detail, DETAIL_LIMIT, { allowEmpty: true }))
      || typeof event.occurredAt !== 'string'
      || !event.occurredAt.trim()
    ) {
      errors.push('Run progressEvents are invalid')
      return errors
    }
    previousSequence = event.sequence
  }
  const latest = run.progressEvents.at(-1)
  if (
    (latest && (
      !isObject(run.progress)
      || latest.phase !== run.progress.phase
      || latest.label !== run.progress.label
      || latest.detail !== run.progress.detail
      || latest.occurredAt !== run.progress.updatedAt
    ))
    || (!latest && run.progress !== undefined)
  ) errors.push('Run progress does not match its latest event')
  const terminal = TERMINAL_PROGRESS[run.status]
  if (terminal && (
    !latest
    || latest.phase !== terminal.phase
    || latest.label !== terminal.label
    || latest.detail !== undefined
  )) errors.push('Run terminal progress is invalid')
  return errors
}
