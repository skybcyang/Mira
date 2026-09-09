import { describe, expect, it, vi } from 'vitest'
import { createBoardHistoryRequestScope } from './boardHistoryRequests'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('BoardHistory request ownership', () => {
  it('captures a navigation predicate inside a request that expires after invalidation or a newer request', async () => {
    const scope = createBoardHistoryRequestScope()
    let canNavigate!: () => boolean
    await scope.run(async () => {
      canNavigate = scope.capture()
      return 'fork'
    }, vi.fn(), vi.fn())
    expect(canNavigate()).toBe(true)
    scope.invalidate()
    expect(canNavigate()).toBe(false)
    const previous = scope.capture()
    await scope.run(async () => 'new request', vi.fn(), vi.fn())
    expect(previous()).toBe(false)
  })

  it('does not close a replacement panel when an older fork commits, but closes the owned panel', async () => {
    const scope = createBoardHistoryRequestScope()
    const fork = deferred<string>()
    const close = vi.fn()
    const failure = vi.fn()
    const pending = scope.run(() => fork.promise, close, failure)
    scope.invalidate()
    fork.resolve('durable-copy')
    await pending
    expect(close).not.toHaveBeenCalled()
    await scope.run(async () => 'owned-copy', close, failure)
    expect(close.mock.calls).toEqual([['owned-copy']])
    expect(failure).not.toHaveBeenCalled()
  })

  it('keeps preview B when preview A finishes after returning to the list and selecting B', async () => {
    const scope = createBoardHistoryRequestScope()
    const first = deferred<string>()
    const selected: string[] = []
    const failure = vi.fn()
    const pending = scope.run(() => first.promise, (value) => selected.push(value), failure)
    scope.invalidate()
    await scope.run(async () => 'B', (value) => selected.push(value), failure)
    first.resolve('A')
    await pending
    expect(selected).toEqual(['B'])
    expect(failure).not.toHaveBeenCalled()
  })

  it.each(['back', 'close', 'unmount', 'target change'])('ignores success and failure after %s invalidates the scope', async () => {
    for (const failed of [false, true]) {
      const scope = createBoardHistoryRequestScope()
      const request = deferred<string>()
      const success = vi.fn()
      const failure = vi.fn()
      const pending = scope.run(() => request.promise, success, failure)
      scope.invalidate()
      if (failed) request.reject(new Error('old request'))
      else request.resolve('old preview')
      await pending
      expect(success).not.toHaveBeenCalled()
      expect(failure).not.toHaveBeenCalled()
    }
  })

  it('allows only the newest reload to publish state or errors', async () => {
    const scope = createBoardHistoryRequestScope()
    const first = deferred<string>()
    const success = vi.fn()
    const failure = vi.fn()
    const pending = scope.run(() => first.promise, success, failure)
    await scope.run(async () => 'latest list', success, failure)
    first.reject(new Error('stale list'))
    await pending
    expect(success.mock.calls).toEqual([['latest list']])
    expect(failure).not.toHaveBeenCalled()
    await scope.run(async () => { throw new Error('current failure') }, success, failure)
    expect(failure.mock.calls).toEqual([[new Error('current failure')]])
  })
})
