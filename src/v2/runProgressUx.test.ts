import { readStyles } from '../../test/helpers/read-styles.js'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TransformationRun } from '../domain'
import * as detailDrawer from './DetailDrawer'

type RunPanelViewProps = {
  run: TransformationRun
  now?: number
  step?: { index: number; total: number; label: string }
  onCompare?: () => void
  onStop?: () => void
}

const RunPanelView = (detailDrawer as unknown as {
  RunPanelView?: ComponentType<RunPanelViewProps>
}).RunPanelView

function runningRun(progressEvents: unknown[] = []): TransformationRun {
  return {
    id: 'run-1',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    status: 'running',
    sourceSnapshot: [],
    targetCardId: 'target-1',
    targetBaseVersionId: null,
    intent: 'create',
    progress: {
      phase: 'generating',
      label: '正在使用工具',
      detail: 'read_file',
      updatedAt: '2026-09-04T08:01:05+08:00',
    },
    progressEvents,
    createdAt: '2026-09-04T08:00:00+08:00',
    startedAt: '2026-09-04T08:00:00+08:00',
  } as TransformationRun
}

describe('Run progress detail', () => {
  it('shows timing, the current step, and the bounded public event timeline', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return

    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: runningRun([
        {
          sequence: 1,
          phase: 'preparing',
          label: '执行环境已准备',
          occurredAt: '2026-09-04T08:00:00+08:00',
        },
        {
          sequence: 2,
          phase: 'generating',
          label: '正在使用工具',
          detail: 'read_file',
          occurredAt: '2026-09-04T08:01:05+08:00',
        },
      ]),
      now: Date.parse('2026-09-04T08:01:05+08:00'),
      step: { index: 2, total: 3, label: '形成建议' },
      onStop() {},
    }))

    expect(html).toContain('正在生成')
    expect(html).toContain('正在使用工具')
    expect(html).toContain('read_file')
    expect(html).toContain('已用 1 分 5 秒')
    expect(html).toContain('最后更新')
    expect(html).toContain('第 2/3 步')
    expect(html).toContain('形成建议')
    expect(html).toContain('执行环境已准备')
    expect(html).toContain('class="v2-run-current" aria-live="polite" aria-atomic="true"')
    expect(html).toMatch(/v2-run-current[\s\S]*read_file[\s\S]*<\/div><div class="v2-run-meta">/)
    expect(html).toContain('停止生成')
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  it('does not invent history for a legacy Run', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return

    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: runningRun(),
      now: Date.parse('2026-09-04T08:01:05+08:00'),
    }))

    expect(html).toContain('尚无可显示的进度记录')
    expect(html).not.toContain('<ol')
  })

  it('does not keep increasing elapsed time for a terminal legacy Run without finishedAt', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return

    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(),
        status: 'failed',
        error: { code: 'MODEL_FAILED', message: '生成失败', retryable: true },
      },
      now: Date.parse('2026-09-05T08:00:00+08:00'),
    }))

    expect(html).not.toContain('已用 1 天')
    expect(html).not.toMatch(/已用 \d/)
    expect(html).toContain('最后更新')
  })

  it('does not present stale active progress as the final state of a legacy Run', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return

    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(),
        status: 'failed',
        finishedAt: '2026-09-04T08:02:00+08:00',
        error: { code: 'MODEL_FAILED', message: '模型服务暂时不可用', retryable: true },
      },
      now: Date.parse('2026-09-05T08:00:00+08:00'),
    }))

    expect(html).toContain('模型服务暂时不可用')
    expect(html).toContain('已用 2 分 0 秒')
    expect(html).toContain('最后更新 9/4 08:02')
    expect(html).not.toContain('正在使用工具')
    expect(html).not.toContain('read_file')
  })

  it('degrades malformed legacy timestamps without crashing the drawer', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return

    expect(() => renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun([{
          sequence: 1,
          phase: 'generating',
          label: '已有进展',
          occurredAt: 'not-a-time',
        }]),
        progress: {
          phase: 'generating',
          label: '已有进展',
          updatedAt: 'not-a-time',
        },
      },
    }))).not.toThrow()

    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(),
        progress: undefined,
        createdAt: 'not-a-time',
        startedAt: undefined,
      },
    }))
    expect(html).toContain('时间未知')
  })

  it('wraps a valid unbroken progress label inside a narrow drawer', async () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return
    const label = 'L'.repeat(160)
    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(),
        progress: {
          phase: 'generating',
          label,
          updatedAt: '2026-09-04T08:01:05+08:00',
        },
      },
    }))
    const styles = await readStyles(new URL('../styles.css', import.meta.url))

    expect(html).toContain(label)
    expect(styles).toMatch(/\.v2-run-current\s*>\s*span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s)
  })

  it('keeps a Candidate decision ahead of its audit timeline', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return
    const progressEvents = Array.from({ length: 20 }, (_, index) => ({
      sequence: index + 1,
      phase: index === 19 ? 'completed' : 'generating',
      label: index === 19 ? '生成完成' : `公开进度 ${index + 1}`,
      occurredAt: '2026-09-04T08:01:05+08:00',
    }))
    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(progressEvents),
        status: 'succeeded',
        progress: {
          phase: 'completed',
          label: '生成完成',
          updatedAt: '2026-09-04T08:01:05+08:00',
        },
        result: { output: '# 待比较结果', digest: 'candidate', disposition: 'candidate' },
        finishedAt: '2026-09-04T08:01:05+08:00',
      },
      onCompare() {},
    }))

    expect(html.indexOf('v2-candidate-head')).toBeGreaterThan(-1)
    expect(html).toContain('查看待比较结果')
    expect(html.indexOf('查看待比较结果')).toBeLessThan(html.indexOf('v2-run-progress'))
    expect(html).not.toContain('采用为最新版本')
  })

  it('shows a terminal failure reason once and before the audit timeline', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return
    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun([{
          sequence: 1,
          phase: 'failed',
          label: '生成未完成',
          occurredAt: '2026-09-04T08:02:00+08:00',
        }]),
        status: 'failed',
        progress: {
          phase: 'failed',
          label: '生成未完成',
          updatedAt: '2026-09-04T08:02:00+08:00',
        },
        finishedAt: '2026-09-04T08:02:00+08:00',
        error: { code: 'MODEL_UNAVAILABLE', message: '模型服务暂时不可用', retryable: true },
      },
    }))

    expect(html).toContain('模型服务暂时不可用')
    expect(html.match(/生成未完成/g)).toHaveLength(2)
    expect(html.indexOf('v2-diagnostic')).toBeLessThan(html.indexOf('v2-run-progress'))
  })

  it('announces a successful terminal state even when its duplicate summary is omitted', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return
    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun([{
          sequence: 1,
          phase: 'completed',
          label: '生成完成',
          occurredAt: '2026-09-04T08:02:00+08:00',
        }]),
        status: 'succeeded',
        progress: {
          phase: 'completed',
          label: '生成完成',
          updatedAt: '2026-09-04T08:02:00+08:00',
        },
        finishedAt: '2026-09-04T08:02:00+08:00',
        result: { output: '# 完成', digest: 'done', disposition: 'applied' },
      },
    }))

    expect(html).toContain('<strong aria-live="polite" aria-atomic="true">生成完成</strong>')
    expect(html.match(/生成完成/g)).toHaveLength(2)
  })

  it('omits an unreliable negative elapsed duration from imported Run data', () => {
    expect(RunPanelView).toBeTypeOf('function')
    if (!RunPanelView) return
    const html = renderToStaticMarkup(createElement(RunPanelView, {
      run: {
        ...runningRun(),
        status: 'interrupted',
        startedAt: '2026-09-04T08:02:00+08:00',
        finishedAt: '2026-09-04T08:01:00+08:00',
        progress: undefined,
      },
    }))

    expect(html).not.toContain('已用')
    expect(html).toContain('最后更新 9/4 08:01')
  })
})
