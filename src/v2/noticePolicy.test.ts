import { describe, expect, it } from 'vitest'
import {
  NOTICE_AUTO_DISMISS_MS,
  autoDismissAfterMs,
  dismissNotice,
  expireNotice,
  publishNotice,
  type Notice,
} from './noticePolicy'

const notice = (
  id: string,
  kind: Notice['kind'],
  message: string,
  scope: Pick<Notice, 'operationId' | 'boardId'> = {},
): Notice => ({ id, kind, message, ...scope })

describe('notice policy', () => {
  it('auto-dismisses only success and info with explicit durations', () => {
    expect(NOTICE_AUTO_DISMISS_MS).toEqual({ success: 4_000, info: 6_000 })
    expect(autoDismissAfterMs('success')).toBe(4_000)
    expect(autoDismissAfterMs('info')).toBe(6_000)
    expect(autoDismissAfterMs('progress')).toBeNull()
    expect(autoDismissAfterMs('error')).toBeNull()
    expect(autoDismissAfterMs('attention')).toBeNull()
  })

  it('keeps the declared kind instead of inferring it from message copy', () => {
    expect(publishNotice([], notice('error-1', 'error', '保存成功'))).toEqual([
      notice('error-1', 'error', '保存成功'),
    ])
  })

  it('expires and dismisses only the exact notice id', () => {
    const notices = [
      notice('old-info', 'info', '正在准备'),
      notice('new-progress', 'progress', '正在导出'),
    ]

    expect(expireNotice(notices, 'old-info')).toEqual([notices[1]])
    expect(expireNotice(notices, 'new-progress')).toBe(notices)
    expect(dismissNotice(notices, 'missing-id')).toBe(notices)
    expect(dismissNotice(notices, 'new-progress')).toEqual([notices[0]])
  })

  it('replaces every matching progress notice in place with one terminal notice', () => {
    const unrelated = notice('other', 'attention', '需要处理')
    const notices = [
      unrelated,
      notice('progress-1', 'progress', '正在导出 10%', { operationId: 'export-1', boardId: 'board-a' }),
      notice('progress-2', 'progress', '正在导出 50%', { operationId: 'export-1', boardId: 'board-a' }),
    ]
    const completed = notice('success-1', 'success', '导出完成', {
      operationId: 'export-1',
      boardId: 'board-a',
    })

    expect(publishNotice(notices, completed)).toEqual([unrelated, completed])
    expect(expireNotice(publishNotice(notices, completed), 'progress-1')).toEqual([unrelated, completed])
  })

  it('updates one operation progress in place instead of stacking intermediate states', () => {
    const started = notice('progress-1', 'progress', '正在准备', {
      operationId: 'run-to:target', boardId: 'board-a',
    })
    const checking = notice('progress-2', 'progress', '正在检查', {
      operationId: 'run-to:target', boardId: 'board-a',
    })

    expect(publishNotice([started], checking)).toEqual([checking])
  })

  it('does not replace progress from another operation', () => {
    const first = notice('progress-1', 'progress', '正在导出', {
      operationId: 'export-1',
      boardId: 'board-a',
    })
    const second = notice('progress-2', 'progress', '正在备份', {
      operationId: 'backup-1',
      boardId: 'board-a',
    })
    const completed = notice('success-1', 'success', '导出完成', {
      operationId: 'export-1',
      boardId: 'board-a',
    })

    expect(publishNotice([first, second], completed)).toEqual([completed, second])
  })

  it('keeps the same operation isolated by Board scope', () => {
    const boardA = notice('progress-a', 'progress', 'A 正在导入', {
      operationId: 'import-1',
      boardId: 'board-a',
    })
    const boardB = notice('progress-b', 'progress', 'B 正在导入', {
      operationId: 'import-1',
      boardId: 'board-b',
    })
    const boardBFailure = notice('error-b', 'error', 'B 导入失败', {
      operationId: 'import-1',
      boardId: 'board-b',
    })

    expect(publishNotice([boardA, boardB], boardBFailure)).toEqual([boardA, boardBFailure])
  })

  it('rejects reusing a stable notice id for different content', () => {
    const existing = notice('stable-id', 'info', '第一条')
    expect(() => publishNotice([existing], notice('stable-id', 'success', '第二条')))
      .toThrowError('NOTICE_ID_CONFLICT')
  })

  it('does not let an old timer expire a newer notice instance with the same id', () => {
    const oldNotice = notice('reused-id', 'info', '第一轮')
    const newerNotice = notice('reused-id', 'info', '第二轮')

    expect(expireNotice([newerNotice], newerNotice.id, oldNotice)).toEqual([newerNotice])
    expect(expireNotice([newerNotice], newerNotice.id, newerNotice)).toEqual([])
  })
})
