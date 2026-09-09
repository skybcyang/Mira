import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { readStyles } from '../../test/helpers/read-styles.js'
import { describe, expect, it, vi } from 'vitest'
import { ContentEditorView } from './DetailDrawer'
import { restoreDrawerEditingFocus } from './drawerIntent'
import DrawerLeaveConfirmation from './DrawerLeaveConfirmation'

describe('detail drawer safety integration', () => {
  it('protects unsaved transformation settings before contextual card navigation', async () => {
    const [drawer, relation, form] = await Promise.all([
      readFile(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/RelationPanel.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/TransformationControls.tsx', import.meta.url), 'utf8'),
    ])
    expect(drawer).toMatch(/<RelationPanel[^>]*onDirtyChange=\{onDirtyChange\}/)
    expect(relation).toMatch(/<TransformationEditForm[\s\S]{0,220}onDirtyChange=\{onDirtyChange\}/)
    expect(form).toContain('onDirtyChange?.(dirty || saving)')
    expect(form).toContain('onDirtyChange?.(false)')
    expect(form).toContain('data-drawer-dirty=')
  })
  it('keeps the body intact without repeating the shell name or showing a second mode switch', () => {
    const html = renderToStaticMarkup(createElement(ContentEditorView, {
      title: '独立卡片名字', content: '# 正文标题\n\n完整内容', hideTitle: true,
      dirty: false, saving: false, mode: 'read', onModeChange: () => {},
      onChange: () => {}, onSave: () => {}, onCancel: () => {},
    }))
    expect(html).not.toContain('独立卡片名字')
    expect(html).toContain('<h1>正文标题</h1>')
    expect(html).toContain('完整内容')
    expect(html).toContain('>编辑</button>')
    expect(html).not.toContain('>预览</button>')
  })

  it('names all three outcomes when switching a dirty card', () => {
    const html = renderToStaticMarkup(createElement(DrawerLeaveConfirmation, {
      switching: true, onContinue: () => {}, onDiscard: () => {}, onSave: async () => false,
    }))
    expect(html).toContain('role="alertdialog"')
    for (const label of ['继续编辑', '放弃并切换', '保存并切换']) expect(html).toContain(label)
  })
  it('clears the App-local history surface before an explicit drawer command', async () => {
    const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    const command = source.slice(source.indexOf('const requestDrawerAction'), source.indexOf('const requestDrawerAction') + 1000)
    expect(command.includes('setBoardHistoryTarget(null)')).toBe(true)
    expect(command.indexOf('setBoardHistoryTarget(null)')).toBeLessThan(command.indexOf('Promise.resolve().then(action)'))
  })
  it('announces a concurrent Head change without replacing the editor surface', () => {
    const html = renderToStaticMarkup(createElement(ContentEditorView, {
      title: '方案',
      content: '# 本地草稿',
      dirty: true,
      saving: false,
      headChanged: true,
      onChange: () => undefined,
      onSave: () => undefined,
      onCancel: () => undefined,
    } as Parameters<typeof ContentEditorView>[0]))

    expect(html).toContain('当前 Head 已变化')
    expect(html).toContain('role="alert"')
    expect(html).toContain('# 本地草稿')
  })

  it('stops an editor Escape before the App-level drawer handler sees it', async () => {
    const source = await readFile(new URL('./detail/ContentViews.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/event\.key === 'Escape' && \(dirty \|\| saving\)/)
    expect(source).toContain('if (!saving) onCancel()')
    expect(source).toMatch(/event\.preventDefault\(\)[\s\S]{0,120}event\.stopPropagation\(\)[\s\S]{0,120}onCancel\(\)/)
  })

  it('includes an uncommitted custom tag in the drawer dirty contract', async () => {
    const source = await readFile(new URL('./detail/ContentViews.tsx', import.meta.url), 'utf8')

    expect(source).toContain('hasUnsavedTagDraft(tagsChanged, tagInput)')
    expect(source).toMatch(/onDirtyChange\?\.\(dirty\)/)
  })

  it('routes every drawer close or navigation entry through one guarded intent', async () => {
    const [app, drawer] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toContain('pendingDrawerIntent')
    expect(app).toContain('requestDrawerIntent')
    expect(app).toMatch(/else if \(drawer\) requestDrawerIntent\(\(\) => openDrawer\(null\)\)/)
    expect(app).toMatch(/className="v2-drawer-scrim"[\s\S]{0,180}requestDrawerIntent/)
    expect(app).toMatch(/<DetailDrawer[\s\S]{0,220}onDirtyChange=\{handleDrawerDirtyChange\}/)
    expect(app).not.toMatch(/window\.(?:confirm|alert)\(/)
    expect(drawer).toMatch(/onRequestDrawerChange/)
    expect(drawer).not.toMatch(/onClick=\{\(\) => close\(null\)\}/)
  })

  it('provides the guarded drawer intent to canvas node commands', async () => {
    const [app, card, transformation] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./TransformationNode.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toMatch(/<DrawerIntentContext\.Provider value=\{drawerIntentController\}>/)
    expect(card).toContain('useDrawerIntent')
    expect(transformation).toContain('useDrawerIntent')
    expect(card).not.toMatch(/const openDrawer = useV2Canvas/)
    expect(transformation).not.toMatch(/const openDrawer = useV2Canvas/)
  })

  it('guards every new-card command before the store can replace the drawer', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toMatch(/const createCanvasCard = useCallback\([\s\S]*requestDrawerAction\(\(\) => persistCanvasCard/)
    expect(app).toContain('createContentCard={createCanvasCard}')
    expect(app).not.toMatch(/void persistCanvasCard\(rf\.screenToFlowPosition/)
  })

  it('renders one labelled confirmation dialog with explicit safe and destructive choices', async () => {
    const app = await readFile(new URL('./DrawerLeaveConfirmation.tsx', import.meta.url), 'utf8')

    expect(app).toMatch(/<dialog[\s\S]*aria-labelledby="v2-discard-drawer-title"/)
    expect(app).toContain('.showModal()')
    expect(app).toContain('.close()')
    expect(app).toContain('继续编辑')
    expect(app).toContain('放弃修改')
  })

  it('returns focus to the dirty editor after continuing', async () => {
    const [app, drawer] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/ContentViews.tsx', import.meta.url), 'utf8'),
    ])
    const focus = vi.fn()
    const target = { focus, isConnected: true }
    const querySelector = vi.fn(() => target)
    const schedule = vi.fn((callback: FrameRequestCallback) => { callback(0); return 1 })

    expect(restoreDrawerEditingFocus({ querySelector } as unknown as Document, schedule)).toBe(true)
    expect(querySelector).toHaveBeenCalledWith('[data-drawer-dirty="true"]')
    expect(focus).toHaveBeenCalledOnce()
    expect(app).toContain('restoreDrawerEditingFocus(document)')
    expect(drawer).toContain("data-drawer-dirty={dirty ? 'true' : undefined}")
    expect(drawer).toContain("data-drawer-dirty={tagInput.trim() ? 'true' : undefined}")
    expect(drawer).toContain("data-drawer-dirty={tagsChanged ? 'true' : undefined}")
  })

  it('keeps dirty state authoritative until a discard intent actually unmounts it', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    const discard = app.slice(app.indexOf('onDiscard={() =>'), app.indexOf('    }}', app.indexOf('onDiscard={() =>')))

    expect(discard).not.toContain('drawerDirtyRef.current = false')
    expect(discard).not.toContain('setDrawerDirty(false)')
  })

  it('merges markdown, name and tag dirty state before reporting it to App', async () => {
    const source = await readFile(new URL('./detail/ContentPanel.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/onDirtyChange\?\.\(contentDirty \|\| tagsDirty \|\| nameDirty\)/)
    expect(source).toMatch(/reconcileDraftSnapshot/)
    expect(source).toMatch(/reconcileRevisionNotice\([\s\S]{0,260}tagsDirty/)
  })

  it('routes every async canvas action that may navigate through the drawer guard', async () => {
    const [app, context, dock, card, transformation, workflowDraft, drawer] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./drawerIntent.ts', import.meta.url), 'utf8'),
      readFile(new URL('./ContextDock.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./TransformationNode.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./WorkflowDraftNodes.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/RelationPanel.tsx', import.meta.url), 'utf8'),
    ])

    expect(context).toContain('run: (action: () => void | Promise<void>) => void')
    expect(context).toContain('useDrawerAction')
    expect(app).toContain('requestDrawerAction')
    expect(app).toMatch(/<DrawerIntentContext\.Provider value=\{drawerIntentController\}>/)
    expect(dock).toContain('useDrawerAction')
    expect(card).toContain('useDrawerAction')
    expect(transformation).toContain('useDrawerAction')
    expect(workflowDraft).toContain('useDrawerAction')
    expect(drawer).toContain('useDrawerAction')
  })

  it('closes only an existing drawer before a canvas action and preserves side-panel work', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toMatch(/requestDrawerIntent\(\(\) => \{[\s\S]{0,180}if \(drawer\) openDrawer\(null\)[\s\S]{0,420}Promise\.resolve\(\)\.then\(action\)/)
    expect(app).not.toMatch(/requestDrawerIntent\(\(\) => \{\s*openDrawer\(null\)\s*void action\(\)/)
  })

  it('locks old canvas and panel tasks while board navigation is unavailable', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toContain("const navigationPending = loadState === 'loading'")
    expect(app).toMatch(/canvasShellRef[\s\S]{0,180}element\.inert = navigationPending/)
    expect(app).toContain('ref={canvasShellRef} className="v2-canvas-shell"')
    expect(app).toContain("'.v2-detail-drawer, .v2-workflow-library, .v2-model-settings, .v2-board-history'")
    expect(app).toMatch(/if \(!navigationPending\) return[\s\S]{0,420}surface\.inert = true/)
    expect(app).toMatch(/const onKeyDown = \(event: KeyboardEvent\) => \{[\s\S]{0,300}if \(loadState === 'loading'\) return/)
    expect(app).toMatch(/if \(loadState !== 'ready'\) return/)
  })

  it('does not pan or fit the canvas when a detail surface opens', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).not.toContain('detailSurfaceCanvasNodeId')
    expect(app).not.toContain('canvasRevealOffset')
    expect(app).not.toMatch(/drawer[\s\S]{0,500}setViewport/)
  })

  it('connects appearance, board switching, command blocking, and panel identity in App', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')

    expect(app).toContain('appearance={appearance}')
    expect(app).toContain('onAppearanceChange={setAppearance}')
    expect(app).toContain('onSwitchBoard=')
    expect(app).toMatch(/switchBoard\(boardId\)\.catch\(\(\) => \{\}\)/)
    expect(app).toContain("commandBlocked={drawerDirty || planDirty || loadState === 'loading' || modalTaskOpen}")
    expect(app).toContain('useMobilePanelModal(sourcePicker ? null : mobilePanelIdentity, surfaceOpenerRef.current)')
    expect(app).not.toContain('<AppearanceSwitcher appearance={appearance}')
  })

  it('uses a synchronous dirty ref when deciding whether navigation may proceed', async () => {
    const [app, drawer] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/ContentPanel.tsx', import.meta.url), 'utf8'),
    ])

    expect(app).toContain('drawerDirtyRef.current')
    expect(app).toContain('handleDrawerDirtyChange')
    expect(app).toContain('onDirtyChange={handleDrawerDirtyChange}')
    expect(drawer).toContain('useLayoutEffect')
  })

  it('styles every new safety state as a first-class interaction surface', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))

    expect(styles).toMatch(/\.v2-drawer-leave-confirm\s*\{/)
    expect(styles).toMatch(/\.v2-drawer-leave-confirm::backdrop\s*\{/)
    expect(styles).toMatch(/\.v2-head-change-warning\s*\{/)
    expect(styles).toMatch(/\.v2-stop-run\s*\{/)
    expect(styles).toMatch(/\.v2-library-state\.is-error\s*\{/)
  })
})
