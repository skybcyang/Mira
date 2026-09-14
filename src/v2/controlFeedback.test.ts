import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppearanceSwitcher from './AppearanceSwitcher'
import { TransformationCardView } from './TransformationNode'
import { RunPanelView } from './detail/RunPanel'
import type { TransformationRun } from '../domain'

describe('control feedback', () => {
  it.each(['light', 'dark'] as const)('exposes the current %s scheme as a named native settings switch', (scheme) => {
    const html = renderToStaticMarkup(createElement(AppearanceSwitcher, {
      appearance: { direction: 'studio', scheme }, embedded: true, onChange() {},
    }))
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*role="switch"[^>]*aria-label="深色外观"/)
    expect(html).toContain(scheme === 'dark' ? '已开启' : '已关闭')
    expect(html.includes('checked=""')).toBe(scheme === 'dark')
  })

  it.each(['queued', 'running', 'succeeded', 'failed', 'interrupted'] as const)('shows honest %s feedback in both step and run detail', (status) => {
    const run: TransformationRun = {
      id: 'run-feedback', boardId: 'board-feedback', transformationId: 'step-feedback',
      targetCardId: 'target-feedback', targetBaseVersionId: null, intent: 'create',
      sourceSnapshot: [], status, createdAt: '2026-09-14T00:00:00Z',
    }
    const step = renderToStaticMarkup(createElement(TransformationCardView, {
      data: { transformationId: run.transformationId, label: '整理材料', sourceCount: 1, status, stale: false, collapsedSources: false },
      onRun() {}, onStop() {},
    }))
    const detail = renderToStaticMarkup(createElement(RunPanelView, { run, onStop() {} }))
    for (const html of [step, detail]) {
      expect(html.includes('v2-run-indicator is-running')).toBe(status === 'running')
      expect(html.includes('v2-run-indicator is-queued')).toBe(status === 'queued')
      if (status === 'queued') expect(html).toContain('排队中')
      if (status === 'interrupted') expect(html).toContain('已停止')
      if (status === 'queued' || status === 'running') expect(html).toContain('停止生成')
    }
  })
})
