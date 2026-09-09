import { describe, expect, it } from 'vitest'
import {
  detailSurfaceSnapshot,
  transitionDetailSurface,
  resolveAsyncDetailSurface,
  isPermanentCanvasHistoryError,
  isMissingRunError,
  isTransientRunLoadError,
  missingRunMessage,
  userFacingStoreError,
} from './storePolicy'

describe('canvas history error policy', () => {
  it('only discards receipts that the bridge proves can never be restored', () => {
    expect(isPermanentCanvasHistoryError({ code: 'CARD_RESTORE_CONFLICT', status: 409 })).toBe(true)
    expect(isPermanentCanvasHistoryError({ code: 'BOARD_V2_WRITE_FAILED', status: 500 })).toBe(false)
    expect(isPermanentCanvasHistoryError(new TypeError('network failed'))).toBe(false)
  })
})

describe('v2 store policy', () => {
  it('treats Content and Versions as distinct views of the same card', () => {
    const content = detailSurfaceSnapshot(2, { tab: 'content', cardId: 'card-1' }, null)

    expect(transitionDetailSurface(
      content,
      { tab: 'versions', cardId: 'card-1' },
      null,
    )).toEqual({
      detailSurfaceRevision: 3,
      drawer: { tab: 'versions', cardId: 'card-1' },
      panel: null,
    })
  })

  it('only lets an unchanged idle surface auto-open an async result', () => {
    const requested = { tab: 'relation' as const, transformationId: 'new-step' }
    const current = { tab: 'content' as const, cardId: 'draft' }
    const idle = detailSurfaceSnapshot(4, null, null)

    expect(resolveAsyncDetailSurface(idle, idle, requested)).toEqual({
      detailSurfaceRevision: 5,
      drawer: requested,
      panel: null,
    })

    expect(resolveAsyncDetailSurface(
      idle,
      detailSurfaceSnapshot(5, current, null),
      requested,
    )).toEqual({
      detailSurfaceRevision: 5,
      drawer: current,
      panel: null,
    })

    expect(resolveAsyncDetailSurface(
      idle,
      detailSurfaceSnapshot(6, null, null),
      requested,
    )).toEqual({
      detailSurfaceRevision: 6,
      drawer: null,
      panel: null,
    })

    const panel = detailSurfaceSnapshot(7, null, 'model')
    expect(resolveAsyncDetailSurface(panel, panel, requested)).toEqual(panel)
  })

  it('replaces an unchanged Candidate origin but preserves later navigation', () => {
    const origin = detailSurfaceSnapshot(9, { tab: 'run', runId: 'candidate' }, null)
    const requested = { tab: 'versions' as const, cardId: 'target' }

    expect(resolveAsyncDetailSurface(origin, origin, requested, 'replace-origin')).toEqual({
      detailSurfaceRevision: 10,
      drawer: requested,
      panel: null,
    })
    expect(resolveAsyncDetailSurface(
      origin,
      detailSurfaceSnapshot(10, { tab: 'content', cardId: 'other' }, null),
      requested,
      'replace-origin',
    )).toEqual({
      detailSurfaceRevision: 10,
      drawer: { tab: 'content', cardId: 'other' },
      panel: null,
    })
  })

  it('keeps transport classification outside the Zustand orchestrator', () => {
    expect(isMissingRunError({ status: 404 })).toBe(true)
    expect(isTransientRunLoadError({ status: 503 })).toBe(true)
    expect(isTransientRunLoadError({ status: 409 })).toBe(false)
  })

  it('maps domain failures to stable user-facing copy', () => {
    expect(userFacingStoreError({ code: 'TRANSFORMATION_SOURCE_INVALID' })).toContain('依赖环')
    expect(userFacingStoreError({ code: 'CARD_IN_USE' })).toContain('已有转化')
    expect(userFacingStoreError({ code: 'WORKFLOW_BINDING_INVALID' })).toContain('必填输入')
    expect(userFacingStoreError({ code: 'WORKFLOW_PLAN_INCOMPLETE' })).toContain('整个计划')
    expect(userFacingStoreError(new Error('network down'))).toBe('network down')
    expect(missingRunMessage(['run-a', 'run-b'])).toContain('run-a、run-b')
  })
})
