import { describe, expect, it, vi } from 'vitest'
import {
  createDraftSnapshot,
  hasUnsavedTagDraft,
  nextDrawerTabIndex,
  reconcileDraftSnapshot,
  reconcileRevisionNotice,
  runExclusiveAction,
} from './drawerSafety'
import { restoreFocusAfterRender } from './drawerIntent'

const sameText = (left: string, right: string) => left === right

describe('detail drawer draft safety', () => {
  it('treats a pending custom tag as unsaved even before it is added', () => {
    expect(hasUnsavedTagDraft(false, '待整理')).toBe(true)
    expect(hasUnsavedTagDraft(false, '   ')).toBe(false)
    expect(hasUnsavedTagDraft(true, '')).toBe(true)
  })

  it('tracks a clean draft with the latest upstream revision', () => {
    const current = createDraftSnapshot('card-a', 'head-1', '# old')

    expect(reconcileDraftSnapshot(
      current,
      { scopeId: 'card-a', revision: 'head-2', value: '# new' },
      sameText,
    )).toEqual(createDraftSnapshot('card-a', 'head-2', '# new'))
  })

  it('preserves a dirty draft and marks a concurrent upstream change', () => {
    const current = {
      ...createDraftSnapshot('card-a', 'head-1', '# old'),
      value: '# local draft',
    }

    expect(reconcileDraftSnapshot(
      current,
      { scopeId: 'card-a', revision: 'head-2', value: '# remote edit' },
      sameText,
    )).toEqual({
      scopeId: 'card-a',
      revision: 'head-2',
      baseline: '# remote edit',
      value: '# local draft',
      upstreamChanged: true,
    })
  })

  it('recognizes a saved draft returned as the new upstream revision', () => {
    const current = {
      ...createDraftSnapshot('card-a', 'head-1', '# old'),
      value: '# saved edit',
    }

    expect(reconcileDraftSnapshot(
      current,
      { scopeId: 'card-a', revision: 'head-2', value: '# saved edit' },
      sameText,
    )).toEqual(createDraftSnapshot('card-a', 'head-2', '# saved edit'))
  })

  it('resets a draft when the drawer moves to another card', () => {
    const current = {
      ...createDraftSnapshot('card-a', 'head-1', '# old'),
      value: '# local draft',
    }

    expect(reconcileDraftSnapshot(
      current,
      { scopeId: 'card-b', revision: 'head-1', value: '# other' },
      sameText,
    )).toEqual(createDraftSnapshot('card-b', 'head-1', '# other'))
  })
})

describe('detail drawer async action safety', () => {
  it('admits only one action until the current promise settles', async () => {
    const lock = { current: false }
    let finish: (() => void) | undefined
    const current = new Promise<void>((resolve) => { finish = resolve })
    let calls = 0

    const first = runExclusiveAction(lock, () => { calls += 1; return current })
    const second = runExclusiveAction(lock, async () => { calls += 1 })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(calls).toBe(1)

    finish?.()
    await first

    expect(lock.current).toBe(false)
    expect(runExclusiveAction(lock, async () => { calls += 1 })).not.toBeNull()
    expect(calls).toBe(2)
  })
})

describe('focus return after a lazy surface closes', () => {
  it('ignores the document body and inert openers when returning from a modal', () => {
    for (const selector of ['body, html', ':disabled, [inert], [inert] *']) {
      const focus = vi.fn()
      const fallback = { focus }
      restoreFocusAfterRender({ focus: vi.fn(), matches: value => value === selector }, ['.task'],
        { querySelector: () => fallback }, callback => { callback(0); return 1 })
      expect(focus).toHaveBeenCalledOnce()
    }
  })
  it('resolves fallbacks after render when the original control was replaced', () => {
    const preferred = {
      isConnected: true,
      disabled: false,
      getClientRects: () => [1],
      focus: () => undefined,
    }
    const fallbackFocus = vi.fn()
    const fallback = {
      isConnected: true,
      disabled: false,
      getClientRects: () => [1],
      focus: fallbackFocus,
    }
    let scheduled: FrameRequestCallback = () => undefined

    expect(restoreFocusAfterRender(
      preferred,
      ['.replacement'],
      { querySelector: () => fallback },
      (callback) => { scheduled = callback; return 1 },
    )).toBe(true)

    preferred.isConnected = false
    scheduled(0)
    expect(fallbackFocus).toHaveBeenCalledOnce()
  })
})

describe('detail drawer upstream revision notice', () => {
  it('marks a Head change while a related field is dirty and clears after the draft is clean', () => {
    const changed = reconcileRevisionNotice(
      { scopeId: 'card-a', revision: 'head-1', changed: false },
      { scopeId: 'card-a', revision: 'head-2' },
      true,
    )

    expect(changed).toEqual({ scopeId: 'card-a', revision: 'head-2', changed: true })
    expect(reconcileRevisionNotice(
      changed,
      { scopeId: 'card-a', revision: 'head-2' },
      false,
    )).toEqual({ scopeId: 'card-a', revision: 'head-2', changed: false })
  })

  it('does not carry a Head-change notice into another card', () => {
    expect(reconcileRevisionNotice(
      { scopeId: 'card-a', revision: 'head-2', changed: true },
      { scopeId: 'card-b', revision: 'head-3' },
      true,
    )).toEqual({ scopeId: 'card-b', revision: 'head-3', changed: false })
  })
})

describe('detail drawer tab keyboard navigation', () => {
  const enabled = [true, false, true, true]

  it('wraps left and right while skipping unavailable tabs', () => {
    expect(nextDrawerTabIndex(enabled, 0, 'ArrowRight')).toBe(2)
    expect(nextDrawerTabIndex(enabled, 0, 'ArrowLeft')).toBe(3)
    expect(nextDrawerTabIndex(enabled, 3, 'ArrowRight')).toBe(0)
  })

  it('moves to the first or last available tab for Home and End', () => {
    expect(nextDrawerTabIndex(enabled, 2, 'Home')).toBe(0)
    expect(nextDrawerTabIndex(enabled, 0, 'End')).toBe(3)
    expect(nextDrawerTabIndex(enabled, 2, 'Enter')).toBe(2)
  })
})
