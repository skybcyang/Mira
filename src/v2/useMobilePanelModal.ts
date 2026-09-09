import { useEffect, useRef } from 'react'

const PANEL_SELECTOR = '.v2-detail-drawer, .v2-workflow-library, .v2-model-settings, .v2-board-history'
const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export type MobilePanelIdentity = boolean | string | null | undefined

export function nextModalFocus<T>(
  focusables: readonly T[],
  active: T | null,
  reverse: boolean,
): T | null {
  if (focusables.length === 0) return null
  const activeIndex = active === null ? -1 : focusables.indexOf(active)
  if (activeIndex < 0) return reverse ? focusables[focusables.length - 1] : focusables[0]
  const step = reverse ? -1 : 1
  return focusables[(activeIndex + step + focusables.length) % focusables.length]
}

export function replacementPanelFocusTarget<T>(
  previous: T | null,
  current: T | null,
  force: boolean,
): T | null {
  if (!current || (!force && previous === current)) return null
  return current
}

export default function useMobilePanelModal(
  panelIdentity: MobilePanelIdentity,
  returnFocusTarget: HTMLElement | null = null,
) {
  const active = Boolean(panelIdentity)
  const reconnectRef = useRef<(forceFocus?: boolean) => void>(() => {})
  const returnFocusTargetRef = useRef(returnFocusTarget)
  returnFocusTargetRef.current = returnFocusTarget

  useEffect(() => {
    if (!active) {
      reconnectRef.current = () => {}
      return
    }

    const media = window.matchMedia('(max-width: 1099px)')
    const initialReturnFocus = returnFocusTargetRef.current || (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    )
    const outsideStates = new Map<HTMLElement, boolean>()
    let panel: HTMLElement | null = null
    let panelRole: string | null = null
    let panelAriaModal: string | null = null
    let panelTabIndex: string | null = null
    let scrim: HTMLElement | null = null
    let scrimTabIndex: string | null = null
    let focusFrame: number | null = null
    let observedPanel: HTMLElement | null = null

    const restoreAttribute = (element: HTMLElement, name: string, value: string | null) => {
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
    const restoreOutside = () => {
      outsideStates.forEach((wasInert, outside) => { outside.inert = wasInert })
      outsideStates.clear()
      if (scrim) restoreAttribute(scrim, 'tabindex', scrimTabIndex)
      scrim = null
      scrimTabIndex = null
    }
    const isolateOutside = (currentPanel: HTMLElement) => {
      restoreOutside()
      document.querySelectorAll<HTMLElement>('.v2-app > *').forEach((outside) => {
        if (outside === currentPanel
          || outside.contains(currentPanel)
          || outside.matches('.v2-drawer-scrim')
          || outside.matches('dialog[open]')) return
        outsideStates.set(outside, outside.inert)
        outside.inert = true
      })
      scrim = document.querySelector<HTMLElement>('.v2-drawer-scrim')
      if (scrim) {
        scrimTabIndex = scrim.getAttribute('tabindex')
        scrim.setAttribute('tabindex', '-1')
      }
    }
    const focusablesFor = (currentPanel: HTMLElement) =>
      Array.from(currentPanel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        const style = window.getComputedStyle(element)
        return !element.hidden
          && element.getClientRects().length > 0
          && !element.matches(':disabled')
          && element.tabIndex >= 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      })
    const visiblePanel = () => Array.from(document.querySelectorAll<HTMLElement>(PANEL_SELECTOR))
      .find((element) => element.getClientRects().length > 0) || null
    const focusables = () => panel ? focusablesFor(panel) : []
    const onPanelKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const next = nextModalFocus(focusables(), current, event.shiftKey)
      event.preventDefault()
      if (next) next.focus()
      else panel.focus()
    }
    const disconnectPanel = () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
      focusFrame = null
      if (!panel) return
      panel.removeEventListener('keydown', onPanelKeyDown)
      restoreAttribute(panel, 'role', panelRole)
      restoreAttribute(panel, 'aria-modal', panelAriaModal)
      restoreAttribute(panel, 'tabindex', panelTabIndex)
      panel = null
    }
    const schedulePanelFocus = (forceFocus = false) => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
      focusFrame = window.requestAnimationFrame(() => {
        if (
          !document.querySelector('dialog[open]')
          && panel
          && (forceFocus || !panel.contains(document.activeElement))
        ) {
          const focusTarget = focusables()[0] || panel
          focusTarget.focus()
        }
        focusFrame = null
      })
    }
    const scheduleCurrentPanelFocus = (forceFocus = false) => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
      const currentPanel = visiblePanel()
      const focusPanel = replacementPanelFocusTarget(observedPanel, currentPanel, forceFocus)
      observedPanel = currentPanel
      if (!focusPanel) {
        focusFrame = null
        return
      }
      focusFrame = window.requestAnimationFrame(() => {
        if (
          !document.querySelector('dialog[open]')
          && focusPanel.isConnected
          && (forceFocus || !focusPanel.contains(document.activeElement))
        ) {
          const focusTarget = focusablesFor(focusPanel)[0] || focusPanel
          focusTarget.focus()
        }
        focusFrame = null
      })
    }
    const connectPanel = (forceFocus = false) => {
      const nextPanel = visiblePanel()
      if (nextPanel === panel) {
        if (panel) {
          isolateOutside(panel)
          schedulePanelFocus(forceFocus)
        }
        return Boolean(panel)
      }
      disconnectPanel()
      restoreOutside()
      if (!nextPanel) return false
      panel = nextPanel
      panelRole = panel.getAttribute('role')
      panelAriaModal = panel.getAttribute('aria-modal')
      panelTabIndex = panel.getAttribute('tabindex')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('tabindex', '-1')
      panel.addEventListener('keydown', onPanelKeyDown)
      isolateOutside(panel)
      schedulePanelFocus(forceFocus)
      return true
    }
    const reconnect = (forceFocus = false) => {
      if (media.matches) connectPanel(forceFocus)
      else scheduleCurrentPanelFocus(forceFocus)
    }
    const syncMode = () => {
      if (!media.matches) {
        disconnectPanel()
        restoreOutside()
        scheduleCurrentPanelFocus()
        return
      }
      connectPanel()
    }
    const observer = new MutationObserver(() => reconnect())

    reconnectRef.current = reconnect
    observer.observe(document.querySelector('.v2-app') || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'hidden'],
    })
    syncMode()
    media.addEventListener('change', syncMode)
    return () => {
      reconnectRef.current = () => {}
      media.removeEventListener('change', syncMode)
      observer.disconnect()
      disconnectPanel()
      restoreOutside()
      const returnFocus = returnFocusTargetRef.current || initialReturnFocus
      window.requestAnimationFrame(() => {
        if (
          returnFocus?.isConnected
          && !returnFocus.matches(':disabled')
          && returnFocus.getClientRects().length > 0
        ) {
          returnFocus.focus()
          return
        }
        const fallback = Array.from(document.querySelectorAll<HTMLElement>(
          '.v2-command-trigger:not(:disabled), .v2-app-actions button:not(:disabled)',
        )).find((element) => element.getClientRects().length > 0)
        fallback?.focus()
      })
    }
  }, [active])

  useEffect(() => {
    if (active) reconnectRef.current()
  }, [active, panelIdentity])
}
