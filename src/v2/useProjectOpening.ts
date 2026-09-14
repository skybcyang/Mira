import { useCallback, useEffect, useRef, useState } from 'react'
import { executeProjectSwitch } from './projectSwitch'
import type { OpenProjectInput } from './projectApi'
import { useV2Canvas } from '../v2Store'

export function notifyProjectOpening(message: string) {
  useV2Canvas.setState(state => ({ notices: [...state.notices, { id: crypto.randomUUID(), kind: 'error', message }] }))
}

export function useProjectOpening(requestLeave: (intent: () => void) => void, blockedReason: string | null) {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) document.querySelector<HTMLElement>('.v2-project-menu-trigger')?.focus()
    wasBusy.current = busy
  }, [busy])
  const requestOpen = useCallback((input: OpenProjectInput) => {
    if (pending.current || !useV2Canvas.getState().projectInfo?.canSwitch) return
    if (blockedReason) { notifyProjectOpening(blockedReason); return }
    requestLeave(() => {
      if (pending.current) return
      pending.current = true
      setBusy(true)
      void executeProjectSwitch(input).then(result => {
        if (result.cancelled) { pending.current = false; setBusy(false) }
      }, error => {
        pending.current = false
        setBusy(false)
        notifyProjectOpening(error instanceof Error ? error.message : '项目暂时无法打开，请重试。')
      })
    })
  }, [blockedReason, requestLeave])
  useEffect(() => {
    const open = (event: Event) => {
      const input = (event as CustomEvent<OpenProjectInput>).detail
      if (!input || !['open', 'new', 'recent', 'restore'].includes(input.kind)) return
      requestOpen(input)
    }
    window.addEventListener('mira:open-project', open)
    return () => window.removeEventListener('mira:open-project', open)
  }, [requestOpen])
  return { busy, requestOpen }
}
