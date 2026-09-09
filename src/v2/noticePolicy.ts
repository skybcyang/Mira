export type NoticeKind = 'progress' | 'info' | 'success' | 'error' | 'attention'

export interface Notice {
  id: string
  kind: NoticeKind
  message: string
  operationId?: string
  boardId?: string
}

export type NoticeCollection = readonly Notice[]

export const NOTICE_AUTO_DISMISS_MS = {
  success: 4_000,
  info: 6_000,
} as const

export function autoDismissAfterMs(kind: NoticeKind): number | null {
  return kind === 'success' || kind === 'info'
    ? NOTICE_AUTO_DISMISS_MS[kind]
    : null
}

function sameNotice(left: Notice, right: Notice): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.message === right.message
    && left.operationId === right.operationId
    && left.boardId === right.boardId
}

function isMatchingOperation(current: Notice, next: Notice): boolean {
  return next.operationId !== undefined
    && current.operationId === next.operationId
    && current.boardId === next.boardId
    && (current.kind === 'progress' || next.kind === 'progress')
}

export function publishNotice(notices: NoticeCollection, next: Notice): NoticeCollection {
  const existing = notices.find((notice) => notice.id === next.id)
  if (existing) {
    if (sameNotice(existing, next)) return notices
    throw new Error('NOTICE_ID_CONFLICT')
  }

  const replacementIndex = notices.findIndex((notice) => isMatchingOperation(notice, next))
  if (replacementIndex < 0) return [...notices, next]

  return notices.flatMap((notice, index) => {
    if (!isMatchingOperation(notice, next)) return [notice]
    return index === replacementIndex ? [next] : []
  })
}

export function dismissNotice(notices: NoticeCollection, noticeId: string): NoticeCollection {
  if (!notices.some((notice) => notice.id === noticeId)) return notices
  return notices.filter((notice) => notice.id !== noticeId)
}

export function expireNotice(
  notices: NoticeCollection,
  noticeId: string,
  expectedNotice?: Notice,
): NoticeCollection {
  const expiring = notices.find((notice) => notice.id === noticeId)
  if (
    !expiring
    || (expectedNotice !== undefined && expiring !== expectedNotice)
    || autoDismissAfterMs(expiring.kind) === null
  ) return notices
  return dismissNotice(notices, noticeId)
}
