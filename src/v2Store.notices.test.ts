import { beforeEach, describe, expect, it } from 'vitest'
import type { Notice } from './v2/noticePolicy'
import { useV2Canvas } from './v2Store'

beforeEach(() => {
  useV2Canvas.setState({ notices: [], message: null })
})

describe('notice store contract', () => {
  it('dismisses only the exact notice id', () => {
    const first: Notice = { id: 'first', kind: 'error', message: '第一条' }
    const second: Notice = { id: 'second', kind: 'attention', message: '第二条' }
    useV2Canvas.setState({ notices: [first, second], message: second.message })

    useV2Canvas.getState().dismissNotice(first.id)

    expect(useV2Canvas.getState().notices).toEqual([second])
  })

  it('requires the same notice instance when an auto-dismiss timer expires', () => {
    const expired: Notice = { id: 'reused', kind: 'info', message: '旧通知' }
    const current: Notice = { id: 'reused', kind: 'info', message: '新通知' }
    useV2Canvas.setState({ notices: [current], message: current.message })

    useV2Canvas.getState().expireNotice(current.id, expired)
    expect(useV2Canvas.getState().notices).toEqual([current])

    useV2Canvas.getState().expireNotice(current.id, current)
    expect(useV2Canvas.getState().notices).toEqual([])
  })
})
