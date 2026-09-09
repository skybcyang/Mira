interface CardEditorFocusTarget {
  focus(options?: FocusOptions): void
}

interface CardEditorFocusScheduler {
  isCurrent(): boolean
  scheduleFrame(callback: () => void): number
  cancelFrame(frameId: number): void
}

export function settleCardEditorFocus(
  editor: CardEditorFocusTarget,
  scheduler: CardEditorFocusScheduler,
): () => void {
  if (!scheduler.isCurrent()) return () => {}

  const focus = () => {
    if (scheduler.isCurrent()) editor.focus({ preventScroll: true })
  }
  focus()
  // React Flow reveals a newly measured node after its first animation frame.
  let frameId: number | null = scheduler.scheduleFrame(() => {
    if (!scheduler.isCurrent()) {
      frameId = null
      return
    }
    frameId = scheduler.scheduleFrame(() => {
      frameId = null
      focus()
    })
  })

  return () => {
    if (frameId === null) return
    scheduler.cancelFrame(frameId)
    frameId = null
  }
}
