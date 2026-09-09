import type { CardVersion } from '../../domain'

export function versionText(version: CardVersion | undefined) {
  if (!version) return ''
  return version.content.kind === 'markdown' ? version.content.markdown : version.content.path
}

export function when(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

export function dateTime(value: string) {
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

export function elapsed(start: string, end: number): string | null {
  const startAt = Date.parse(start)
  if (!Number.isFinite(startAt) || !Number.isFinite(end)) return null
  if (end < startAt) return null
  const seconds = Math.floor((end - startAt) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}
