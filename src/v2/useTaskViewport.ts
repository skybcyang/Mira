import { useEffect } from 'react'

// The visual viewport also shrinks for keyboards that leave the layout viewport unchanged.
export default function useTaskViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
    const sync = () => {
      const height = viewport?.height ?? window.innerHeight
      root.style.setProperty('--mira-task-height', `${height}px`)
      root.style.setProperty('--mira-task-top', `${viewport?.offsetTop ?? 0}px`)
      root.dataset.compactHeight = String(height < 540)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (window.innerWidth < 720 && height < 540 && document.activeElement?.matches('.v2-content-editor textarea')) {
          document.activeElement.scrollIntoView({ block: 'center' })
        }
      })
    }
    sync()
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', sync)
      viewport?.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      root.style.removeProperty('--mira-task-height')
      root.style.removeProperty('--mira-task-top')
      delete root.dataset.compactHeight
    }
  }, [])
}
