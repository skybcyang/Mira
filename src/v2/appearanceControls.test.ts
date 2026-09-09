import { readStyles } from '../../test/helpers/read-styles.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import AppearanceSwitcher from './AppearanceSwitcher'
import CommandPalette, { filterCommandItems } from './CommandPalette'

describe('appearance and command controls', () => {
  it('exposes three complete directions and an independent scheme control', () => {
    const html = renderToStaticMarkup(createElement(AppearanceSwitcher, {
      appearance: { direction: 'editorial', scheme: 'light' },
      onChange: () => undefined,
    }))

    expect(html).toContain('aria-label="外观"')
    expect(html).toContain('aria-label="原生工作室"')
    expect(html).toContain('aria-label="编辑部"')
    expect(html).toContain('aria-label="蓝图台"')
    expect(html).toMatch(/aria-label="编辑部"[^>]*aria-pressed="true"/)
    expect(html).toContain('aria-label="切换为深色外观"')
  })

  it('filters the real command list by label and description', () => {
    const commands = [
      { id: 'content', label: '新建内容卡', description: '在当前视口创建', action: () => undefined },
      { id: 'inspiration', label: '打开灵感池', description: '选择 workspace 材料', action: () => undefined },
    ]
    expect(filterCommandItems(commands, '内容').map((item) => item.id)).toEqual(['content'])
    expect(filterCommandItems(commands, 'WORKSPACE').map((item) => item.id)).toEqual(['inspiration'])
    expect(filterCommandItems(commands, '  ').map((item) => item.id)).toEqual(['content', 'inspiration'])
  })

  it('wires Cmd/Ctrl K to a focus-managed command dialog', async () => {
    const [appBar, appBarModule, navigation] = await Promise.all([
      readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8'),
      import('./AppBar') as Promise<Record<string, unknown>>,
      readFile(new URL('./WorkbenchNavigation.tsx', import.meta.url), 'utf8'),
    ])
    const hasBlockingOverlay = appBarModule.hasBlockingOverlay as undefined | ((root: {
      querySelector: (selector: string) => unknown
    }) => boolean)
    const canOpenCommandPalette = appBarModule.canOpenCommandPalette as undefined | ((
      commandBlocked: boolean,
      root: { querySelector: (selector: string) => unknown },
    ) => boolean)

    expect(appBar).toMatch(/event\.metaKey \|\| event\.ctrlKey[\s\S]*event\.key\.toLowerCase\(\) !== 'k'/)
    expect(appBar).toContain('<CommandPalette')
    expect(appBar).toContain('aria-haspopup="dialog"')
    expect(hasBlockingOverlay).toBeTypeOf('function')
    if (!hasBlockingOverlay) return
    const querySelector = vi.fn(() => null)
    expect(hasBlockingOverlay({ querySelector })).toBe(false)
    expect(querySelector).toHaveBeenCalledWith(expect.stringContaining('dialog[open]'))
    expect(hasBlockingOverlay({ querySelector: () => ({}) })).toBe(true)
    expect(canOpenCommandPalette).toBeTypeOf('function')
    if (!canOpenCommandPalette) return
    expect(canOpenCommandPalette(false, { querySelector: () => null })).toBe(true)
    expect(canOpenCommandPalette(true, { querySelector: () => null })).toBe(false)
    expect(canOpenCommandPalette(false, { querySelector: () => ({}) })).toBe(false)
    expect(appBar).toContain('onSwitchBoard?: (boardId: string) => void | Promise<void>')
    expect(appBar).toContain('commandBlocked?: boolean')
    expect(appBar).toContain('const switchBoardAction = onSwitchBoard || switchBoard')
    expect(appBar).toContain('onSwitch={id => { void switchBoardAction(id) }}')
    expect(appBar).toMatch(/className="v2-command-trigger"[^>]*disabled=\{commandBlocked\}/)
    expect(appBar).not.toContain('v2-mobile-command-search')
    expect(appBar).toMatch(/className="v2-command-trigger"[^>]*aria-label="搜索或执行命令"/)
    expect(appBar).toContain('commandPaletteTriggerRef')
    expect(appBar).toMatch(/boardManagerTriggerRef\.current = commandPaletteTriggerRef\.current/)
    expect(appBar).toContain("const canvasUnavailable = loadState !== 'ready'")
    expect(appBar).toContain("const navigationPending = loadState === 'loading'")
    expect(navigation).toContain('disabled={unavailable} onClick={onCreate}')
    expect(appBar).toContain('<BoardMenu')
    expect(appBar).toMatch(/id: 'boards'[\s\S]{0,220}disabled: navigationPending/)
    expect(appBar).toMatch(/id: 'models'[\s\S]{0,220}disabled: navigationPending/)
  })

  it('keeps system settings dismissible with focus returned to its header trigger', async () => {
    const appBar = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')
    expect(appBar).toContain('id="mira-more-menu"')
    expect(appBar).toContain('role="dialog" aria-label="系统设置"')
    expect(appBar).toContain("document.addEventListener('pointerdown'")
    expect(appBar).toContain("document.addEventListener('keydown'")
    expect(appBar).toContain("event.key !== 'Escape'")
    expect(appBar).toContain('settingsButtonRef.current?.focus()')
    expect(appBar).toContain('<AppearanceSwitcher')
    expect(appBar).toContain('embedded')
  })

  it('announces the command selected by arrow-key navigation', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette, {
      open: true,
      commands: [{
        id: 'content',
        label: '新建内容卡',
        description: '在当前视口创建',
        action: () => undefined,
      }],
      onClose: () => undefined,
    }))

    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-controls="mira-command-results"')
    expect(html).toContain('aria-activedescendant="mira-command-option-content"')
    expect(html).toContain('id="mira-command-results"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('id="mira-command-option-content"')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
  })

  it('keeps command Escape from reaching canvas-level dismissal', async () => {
    const [app, palette] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./CommandPalette.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toContain("target?.closest?.('.v2-command-palette')")
    expect(palette).toMatch(/onCancel=\{\(event\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); onClose\(\) \}\}/)
  })

  it('closes the modal before a command replaces the current detail surface', async () => {
    const palette = await readFile(new URL('./CommandPalette.tsx', import.meta.url), 'utf8')
    expect(palette).toMatch(
      /const invoke[\s\S]*dialogRef\.current\?\.close\(\)[\s\S]*onClose\(\)[\s\S]*command\.action\(\)/,
    )
  })

  it('keeps the native dialog out of layout while it is closed', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))
    expect(styles).toMatch(/\.v2-command-palette:not\(\[open\]\)\s*\{[^}]*display:\s*none;/s)
  })

  it('keeps compact overlays apart and mobile commands at least 44px', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-app-bar\s*\{[^}]*height:\s*52px;/)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-appearance-switcher button\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;/)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-appearance-switcher\.is-embedded\s*\{[^}]*height:\s*auto;/)
    expect(styles).toMatch(/\.v2-canvas-shell:has\(\.v2-context-dock\) \.v2-appearance-switcher\s*\{[^}]*display:\s*none;/s)
    expect(styles).toMatch(/@media \(min-width: 1100px\)[\s\S]*\.v2-app\.has-drawer \.v2-canvas-shell\s*\{[^}]*right:\s*392px;/s)
    expect(styles).toMatch(/@media \(max-width: 1099px\)[\s\S]*\.v2-app\.has-drawer \.v2-canvas-shell\s*\{[^}]*right:\s*0;[\s\S]*\.v2-app\.has-drawer \.v2-minimap\s*\{[^}]*right:\s*408px\s*!important;[\s\S]*\.v2-app\.has-drawer \.react-flow__controls\s*\{[^}]*right:\s*408px\s*!important;/s)
    expect(styles).toMatch(/@media \(max-width: 1099px\)[\s\S]*\.v2-app\.has-drawer \.v2-selection-toolbar\s*\{[^}]*right:\s*408px;[^}]*left:\s*16px;[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-app\.has-drawer \.v2-selection-toolbar\s*\{[^}]*display:\s*none;/s)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-more-menu > button\s*\{[^}]*min-height:\s*44px;/s)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-drawer-tabs(?: button)?\s*\{[^}]*min-height:\s*44px;/s)
    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-selection-toolbar button\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;/s)
    expect(styles).toMatch(/\.v2-card:focus-within \.v2-card-footer[\s\S]*?opacity:\s*1;/)
  })

  it('cycles focus within mobile sheets', async () => {
    const hookModule = await import('./useMobilePanelModal') as Record<string, unknown>
    const nextModalFocus = hookModule.nextModalFocus as undefined | (<T>(
      focusables: readonly T[], active: T | null, reverse: boolean,
    ) => T | null)
    const replacementPanelFocusTarget = hookModule.replacementPanelFocusTarget as undefined | (<T>(
      previous: T | null, current: T | null, force: boolean,
    ) => T | null)
    const first = { id: 'first' }
    const last = { id: 'last' }

    expect(nextModalFocus).toBeTypeOf('function')
    if (!nextModalFocus) return
    expect(nextModalFocus([first, last], last, false)).toBe(first)
    expect(nextModalFocus([first, last], first, true)).toBe(last)
    expect(nextModalFocus([first, last], null, false)).toBe(first)
    expect(nextModalFocus([], null, false)).toBeNull()
    expect(replacementPanelFocusTarget).toBeTypeOf('function')
    if (!replacementPanelFocusTarget) return
    expect(replacementPanelFocusTarget(null, first, false)).toBe(first)
    expect(replacementPanelFocusTarget(first, first, false)).toBeNull()
    expect(replacementPanelFocusTarget(first, first, true)).toBe(first)
    expect(replacementPanelFocusTarget(first, null, false)).toBeNull()
  })

  it('reconnects mobile sheet identity and isolates every outside root', async () => {
    const [app, hook] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./useMobilePanelModal.ts', import.meta.url), 'utf8'),
    ])

    expect(app).toContain('useMobilePanelModal(sourcePicker ? null : mobilePanelIdentity, surfaceOpenerRef.current)')
    expect(app).toContain('surfaceOpenerRef')
    expect(hook).toContain("matchMedia('(max-width: 1099px)')")
    expect(hook).toContain('panelIdentity')
    expect(hook).toContain('returnFocusTarget')
    expect(hook).toContain("panel.setAttribute('aria-modal', 'true')")
    expect(hook).toContain("document.querySelectorAll<HTMLElement>('.v2-app > *')")
    expect(hook).toContain('outside.inert = true')
    expect(hook).toContain("element.matches(':disabled')")
    expect(hook).toContain("element.tabIndex >= 0")
    expect(hook).toContain('const connectPanel = (forceFocus = false)')
    expect(hook).toMatch(/nextPanel === panel[\s\S]{0,180}schedulePanelFocus\(forceFocus\)/)
    expect(hook).toContain('reconnectRef.current()')
    expect(hook).not.toContain('reconnectRef.current(true)')
    expect(hook).toContain("outside.matches('dialog[open]')")
    expect(hook).toContain('attributes: true')
    expect(hook).toContain("attributeFilter: ['open', 'hidden']")
    expect(hook).toContain('visiblePanel()')
    expect(hook).toContain("scrim.setAttribute('tabindex', '-1')")
    expect(hook).toContain("event.key !== 'Tab'")
    expect(hook).toContain('returnFocus.focus()')
    expect(hook).not.toContain('!wasModal')
  })

  it('focuses cold-loaded desktop panels without restoring focus during replacement', async () => {
    const hook = await readFile(new URL('./useMobilePanelModal.ts', import.meta.url), 'utf8')

    expect(hook).toContain('returnFocusTargetRef.current = returnFocusTarget')
    expect(hook).toContain('scheduleCurrentPanelFocus')
    expect(hook).toMatch(/const reconnect[\s\S]*media\.matches[\s\S]*connectPanel[\s\S]*scheduleCurrentPanelFocus/)
    expect(hook).toMatch(/\}, \[active\]\)/)
    expect(hook).not.toContain('}, [active, returnFocusTarget])')
  })
})
