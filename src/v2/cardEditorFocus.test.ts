import { describe, expect, it, vi } from 'vitest'
import { settleCardEditorFocus } from './cardEditorFocus'

function frameHarness() {
  const callbacks = new Map<number, () => void>()
  let nextId = 1

  return {
    callbacks,
    cancel: vi.fn((id: number) => callbacks.delete(id)),
    run(id: number) {
      const callback = callbacks.get(id)
      callbacks.delete(id)
      callback?.()
    },
    schedule: vi.fn((callback: () => void) => {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    }),
  }
}

describe('card editor focus settling', () => {
  it('focuses immediately without scrolling and retries once after bounded layout settling', () => {
    const frame = frameHarness()
    const editor = { focus: vi.fn() }

    settleCardEditorFocus(editor, {
      isCurrent: () => true,
      scheduleFrame: frame.schedule,
      cancelFrame: frame.cancel,
    })

    expect(editor.focus).toHaveBeenCalledTimes(1)
    expect(editor.focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(frame.schedule).toHaveBeenCalledTimes(1)

    frame.run(1)

    expect(editor.focus).toHaveBeenCalledTimes(1)
    expect(frame.schedule).toHaveBeenCalledTimes(2)

    frame.run(2)

    expect(editor.focus).toHaveBeenCalledTimes(2)
    expect(editor.focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(frame.schedule).toHaveBeenCalledTimes(2)
    expect(frame.callbacks).toHaveLength(0)
  })

  it('cancels the pending retry on cleanup', () => {
    const frame = frameHarness()
    const editor = { focus: vi.fn() }
    const cleanup = settleCardEditorFocus(editor, {
      isCurrent: () => true,
      scheduleFrame: frame.schedule,
      cancelFrame: frame.cancel,
    })

    frame.run(1)
    cleanup()

    expect(frame.cancel).toHaveBeenCalledWith(2)
    expect(frame.callbacks).toHaveLength(0)
    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('does not retry after editing or the active card identity changes', () => {
    const frame = frameHarness()
    const editor = { focus: vi.fn() }
    let current = true
    settleCardEditorFocus(editor, {
      isCurrent: () => current,
      scheduleFrame: frame.schedule,
      cancelFrame: frame.cancel,
    })

    frame.run(1)
    current = false
    frame.run(2)

    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('does nothing when editing is already inactive', () => {
    const frame = frameHarness()
    const editor = { focus: vi.fn() }

    settleCardEditorFocus(editor, {
      isCurrent: () => false,
      scheduleFrame: frame.schedule,
      cancelFrame: frame.cancel,
    })()

    expect(editor.focus).not.toHaveBeenCalled()
    expect(frame.schedule).not.toHaveBeenCalled()
    expect(frame.cancel).not.toHaveBeenCalled()
  })
})
