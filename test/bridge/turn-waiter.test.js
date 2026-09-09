import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTurnWaiter } from '../../bridge/turn-waiter.js'

afterEach(() => vi.useRealTimers())

describe('turn waiter', () => {
  it('resolves when turn/end arrives after waiting starts', async () => {
    const waiter = createTurnWaiter()
    const waiting = waiter.wait('child')
    waiter.handleEvent('child', { type: 'assistant/message' })
    waiter.handleEvent('child', { type: 'turn/end', data: { reason: { kind: 'stop' } } })

    await expect(waiting).resolves.toMatchObject({ type: 'turn/end' })
  })

  it('resolves from a cached turn/end that arrived first', async () => {
    const waiter = createTurnWaiter()
    waiter.handleEvent('child', { type: 'turn/end', data: { reason: { kind: 'stop' } } })

    await expect(waiter.wait('child')).resolves.toMatchObject({ type: 'turn/end' })
  })

  it('does not mix terminal events between sessions', async () => {
    const waiter = createTurnWaiter()
    waiter.handleEvent('other', { type: 'turn/end' })
    const waiting = waiter.wait('child')
    waiter.handleEvent('child', { type: 'turn/end', data: { turn: 1 } })

    await expect(waiting).resolves.toMatchObject({ data: { turn: 1 } })
  })

  it('streams non-terminal events only to subscribers of that session', () => {
    const waiter = createTurnWaiter()
    const received = []
    const unsubscribe = waiter.subscribe('child', (event) => received.push(event.type))

    waiter.handleEvent('other', { type: 'assistant/message' })
    waiter.handleEvent('child', { type: 'turn/start' })
    waiter.handleEvent('child', { type: 'assistant/message' })
    unsubscribe()
    waiter.handleEvent('child', { type: 'turn/end' })

    expect(received).toEqual(['turn/start', 'assistant/message'])
  })

  it('rejects and removes a waiter when no terminal event arrives in time', async () => {
    vi.useFakeTimers()
    const waiter = createTurnWaiter()
    const waiting = waiter.wait('child-timeout', { timeoutMs: 50 })
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(50)

    await rejected
  })

  it('expires an unclaimed terminal event instead of caching it forever', async () => {
    vi.useFakeTimers()
    const waiter = createTurnWaiter({ cacheTtlMs: 40 })
    waiter.handleEvent('child-early', { type: 'turn/end', data: { turn: 1 } })
    await vi.advanceTimersByTimeAsync(41)

    const waiting = waiter.wait('child-early', { timeoutMs: 20 })
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)

    await rejected
  })
})
