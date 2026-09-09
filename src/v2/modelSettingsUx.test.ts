import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelSettingsView } from './ModelSettings'

describe('model settings UX', () => {
  it('presents the current Kimi configuration without exposing its API key', () => {
    const html = renderToStaticMarkup(createElement(ModelSettingsView, {
      settings: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.kimi.com/coding/v1',
        model: 'k3',
        configured: true,
        hasApiKey: true,
        scope: 'process',
      },
      state: 'ready',
      onClose: () => undefined,
      onSave: async () => undefined,
      onTest: async () => ({ ok: true as const, latencyMs: 80 }),
    }))

    expect(html).toContain('aria-label="模型设置"')
    expect(html).toContain('模型连接')
    expect(html).toContain('已配置')
    expect(html).toContain('Kimi K3')
    expect(html).toContain('value="https://api.kimi.com/coding/v1"')
    expect(html).toContain('value="k3"')
    expect(html).toContain('type="password"')
    expect(html).toContain('已设置，留空则保持不变')
    expect(html).toContain('仅当前服务会话')
    expect(html).toContain('测试连接')
    expect(html).toContain('保存设置')
    expect(html).not.toContain('initial-secret')
  })

  it('shows a recoverable unavailable state when the host has no settings API', () => {
    const html = renderToStaticMarkup(createElement(ModelSettingsView, {
      settings: null,
      state: 'error',
      errorMessage: '当前部署不支持网页模型设置',
      onClose: () => undefined,
      onSave: async () => undefined,
      onTest: async () => ({ ok: true as const, latencyMs: 0 }),
    }))

    expect(html).toContain('当前部署不支持网页模型设置')
    expect(html).toContain('重新加载')
  })

})
