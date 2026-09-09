import { describe, expect, it, vi } from 'vitest'
import {
  closeDesktopResources,
  createShutdownController,
  focusExistingWindow,
} from '../../desktop/lifecycle.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('desktop shutdown lifecycle', () => {
  it('starts host cleanup immediately when the state flush later fails', async () => {
    const stateFlushed = deferred()
    const failure = new Error('state write failed')
    const closeHost = vi.fn().mockResolvedValue(undefined)
    const onStateError = vi.fn()

    const cleanup = closeDesktopResources({
      flushState: () => stateFlushed.promise,
      closeHost,
      onStateError,
    })

    expect(closeHost).toHaveBeenCalledOnce()
    stateFlushed.reject(failure)
    await expect(cleanup).resolves.toBeUndefined()
    expect(onStateError).toHaveBeenCalledWith(failure)
  })

  it('closes the host once and quits once when shutdown is requested repeatedly', async () => {
    const hostClosed = deferred()
    const closeHost = vi.fn(() => hostClosed.promise)
    const quit = vi.fn()
    const timeoutHandle = Symbol('shutdown-timeout')
    const setTimeout = vi.fn(() => timeoutHandle)
    const clearTimeout = vi.fn()
    const controller = createShutdownController({
      closeHost,
      quit,
      setTimeout,
      clearTimeout,
      timeoutMs: 2_000,
    })

    const firstRequest = controller.request()
    const secondRequest = controller.request()
    const thirdRequest = controller.request()

    expect(firstRequest).toBe(secondRequest)
    expect(secondRequest).toBe(thirdRequest)
    expect(closeHost).toHaveBeenCalledTimes(1)
    expect(setTimeout).toHaveBeenCalledOnce()
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2_000)
    expect(quit).not.toHaveBeenCalled()

    hostClosed.resolve()
    await firstRequest

    expect(clearTimeout).toHaveBeenCalledOnce()
    expect(clearTimeout).toHaveBeenCalledWith(timeoutHandle)
    expect(quit).toHaveBeenCalledOnce()
  })

  it('quits after the timeout even when closing the host never settles', async () => {
    const closeHost = vi.fn(() => new Promise(() => {}))
    const quit = vi.fn()
    let onTimeout
    const controller = createShutdownController({
      closeHost,
      quit,
      setTimeout(callback) {
        onTimeout = callback
        return 1
      },
      clearTimeout: vi.fn(),
      timeoutMs: 25,
    })

    const request = controller.request()
    expect(quit).not.toHaveBeenCalled()

    onTimeout()
    await request

    expect(closeHost).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('still quits when host cleanup rejects', async () => {
    const closeHost = vi.fn().mockRejectedValue(new Error('host close failed'))
    const quit = vi.fn()
    const controller = createShutdownController({
      closeHost,
      quit,
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      timeoutMs: 2_000,
    })

    await expect(controller.request()).resolves.toBeUndefined()
    expect(quit).toHaveBeenCalledOnce()
  })
})

describe('single-instance window focus', () => {
  it('restores, shows, and focuses a minimized existing window', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }

    focusExistingWindow(window)

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('shows and focuses a normal window without restoring it', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }

    focusExistingWindow(window)

    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('does nothing when no usable window exists', () => {
    expect(() => focusExistingWindow(null)).not.toThrow()

    const destroyedWindow = {
      isDestroyed: vi.fn(() => true),
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    focusExistingWindow(destroyedWindow)

    expect(destroyedWindow.isMinimized).not.toHaveBeenCalled()
    expect(destroyedWindow.restore).not.toHaveBeenCalled()
    expect(destroyedWindow.show).not.toHaveBeenCalled()
    expect(destroyedWindow.focus).not.toHaveBeenCalled()
  })
})
