import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createDraftSnapshot, reconcileDraftSnapshot } from './drawerSafety'
import { transitionDetailSurface } from './storePolicy'
import type { DrawerState } from './storeTypes'

describe('card reading and editing boundaries', () => {
  it('uses a cancellable resize session rather than an unguarded end callback', () => {
    const source = readFileSync(new URL('./ContentCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('CardResizeHandle')
  })
  it('restores cancelled dimensions after the vendor end event with a session guard', () => {
    const source = readFileSync(new URL('./CardResizeHandle.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/queueMicrotask\(\(\) => \{ if \(session\.current === current\) restore\(\)/)
  })
  it('keeps a dirty card draft anchored to its original version', () => {
    const draft = { ...createDraftSnapshot('card', 'v1', 'original'), value: 'my edit' }
    const next = reconcileDraftSnapshot(draft,
      { scopeId: 'card', revision: 'v2', value: 'external edit' },
      (left, right) => left === right, true)
    expect(next).toEqual({ ...draft, upstreamChanged: true })
  })

  it('allows an unchanged draft to follow the latest version', () => {
    const draft = createDraftSnapshot('card', 'v1', 'original')
    const next = reconcileDraftSnapshot(draft,
      { scopeId: 'card', revision: 'v2', value: 'external edit' },
      (left, right) => left === right, true)
    expect(next.revision).toBe('v2')
    expect(next.value).toBe('external edit')
  })

  it('honors an explicit read/edit intent for the same card', () => {
    const current = { detailSurfaceRevision: 0, panel: null,
      drawer: { tab: 'content', cardId: 'card', mode: 'read' } as DrawerState }
    const next = transitionDetailSurface(current,
      { tab: 'content', cardId: 'card', mode: 'edit' } as DrawerState, null)
    expect(next).not.toBe(current)
    expect(next.drawer).toMatchObject({ mode: 'edit' })
  })

  it('makes the title a drag handle and the body a native reader', () => {
    const source = readFileSync(new URL('./ContentCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('v2-card-heading')
    expect(source).toContain('data-card-reader')
    expect(source).toContain('nodrag nowheel')
    expect(source).toContain('继续阅读完整内容')
  })
  it('delivers repeated content commands without changing the async surface revision', () => {
    const current = { detailSurfaceRevision: 4, panel: null,
      drawer: { tab: 'content', cardId: 'card', mode: 'rename' } as DrawerState }
    const request = { tab: 'content', cardId: 'card', mode: 'rename' } as DrawerState
    const next = transitionDetailSurface(current, request, null)
    expect(next.drawer).toBe(request)
    expect(next.detailSurfaceRevision).toBe(4)
  })
  it('keeps low-frequency selection actions in a single contextual menu', () => {
    const source = readFileSync(new URL('./CanvasSelectionToolbar.tsx', import.meta.url), 'utf8')
    expect(source).toContain('data-context-menu')
    expect(source).toContain('更多卡片操作')
  })
})
