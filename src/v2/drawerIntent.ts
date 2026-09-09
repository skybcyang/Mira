import { createContext, useContext } from 'react'
import type { DrawerState } from './storeTypes'

export interface DrawerIntentController {
  open: (drawer: DrawerState) => void
  run: (action: () => void | Promise<void>) => void
  select?: (cardIds: string[], explicit?: boolean) => void
}

export const DrawerIntentContext = createContext<DrawerIntentController | null>(null)

export function useCardSelection(fallback: (cardIds: string[]) => void) {
  return useContext(DrawerIntentContext)?.select || ((cardIds: string[], _explicit = true) => fallback(cardIds))
}

export function useDrawerIntent(fallback: (drawer: DrawerState) => void) {
  return useContext(DrawerIntentContext)?.open || fallback
}

export function useDrawerAction() {
  const controller = useContext(DrawerIntentContext)
  return controller?.run || ((action: () => void | Promise<void>) => { void action() })
}

export function restoreDrawerEditingFocus(
  root: Document = document,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  const target = root.querySelector<HTMLElement>('[data-drawer-dirty="true"]')
  if (!target) return false
  schedule(() => { if (target.isConnected) target.focus() })
  return true
}

interface FocusReturnTarget {
  isConnected?: boolean
  disabled?: boolean
  matches?: (selector: string) => boolean
  getClientRects?: () => ArrayLike<unknown>
  focus: (options?: FocusOptions) => void
}

interface FocusReturnRoot {
  querySelector: (selector: string) => FocusReturnTarget | null
}

export function restoreFocusAfterRender(
  preferred: FocusReturnTarget | null,
  fallbackSelectors: readonly string[],
  root: FocusReturnRoot = document as unknown as FocusReturnRoot,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  if (!preferred && fallbackSelectors.length === 0) return false
  const available = (target: FocusReturnTarget | null) => Boolean(
    target
    && target.isConnected !== false
    && target.disabled !== true
    && !target.matches?.(':disabled, [inert], [inert] *')
    && !target.matches?.('body, html')
    && (!target.getClientRects || target.getClientRects().length > 0),
  )
  schedule(() => {
    const fallbacks = fallbackSelectors.map((selector) => root.querySelector(selector))
    const target = [preferred, ...fallbacks].find(available)
    target?.focus({ preventScroll: true })
  })
  return true
}
