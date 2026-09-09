import type { KeyboardEvent } from 'react'

export function readerKeyDown(event: KeyboardEvent<HTMLElement>) {
  event.stopPropagation()
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    const range = document.createRange()
    range.selectNodeContents(event.currentTarget)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    event.currentTarget.blur()
    event.currentTarget.closest<HTMLElement>('.react-flow__node')?.focus({ preventScroll: true })
  }
}
