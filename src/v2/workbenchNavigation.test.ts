import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchNavigation } from './WorkbenchNavigation'
import { readWorkbenchPreference } from './workbenchPreferences'
import AppBar from './AppBar'
import { ReactFlowProvider } from '@xyflow/react'

describe('workbench navigation', () => {
  it('exposes every work tool directly with no more menu or duplicate search', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchNavigation, {
      active: 'inspiration', collapsed: true, unavailable: false,
      onCanvas: vi.fn(), onInspiration: vi.fn(), onWorkflow: vi.fn(), onFile: vi.fn(), onPlan: vi.fn(), onHistory: vi.fn(), onToggle: vi.fn(), onCreate: vi.fn(), onMultiSelect: vi.fn(), multiSelectMode: false,
    }))
    for (const label of ['新建卡片', '多选卡片', '画布', '灵感池', '方法与计划', '文件', '画布版本', '展开导航']) expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toContain('aria-label="搭计划"')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).not.toContain('更多')
    expect(html).not.toContain('搜索')
    expect(html).not.toContain('管理画板')
  })

  it('keeps history and settings in the header and creation in the work tools', () => {
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(AppBar)))
    const actions = html.match(/<div class="v2-app-actions">([\s\S]*?)<\/div>/)?.[1] || ''
    for (const label of ['撤销', '重做', '系统设置']) expect(actions).toContain(`aria-label="${label}"`)
    expect(actions).not.toContain('新建')
    expect(html).toContain('aria-label="新建卡片"')
    const location = html.match(/<div class="v2-app-location">([\s\S]*?)<\/div>/)?.[1] || ''
    expect(location).toContain('aria-label="切换画板"')
    expect(location).not.toContain('<select')
    expect(html.match(/<span>搜索卡片或命令<\/span>/g)).toHaveLength(1)
  })

  it('uses defaults when local preferences are malformed or storage is unavailable', () => {
    expect(readWorkbenchPreference('navigation', ['expanded', 'collapsed'], 'expanded', { getItem: () => 'random' })).toBe('expanded')
    expect(readWorkbenchPreference('navigation', ['expanded', 'collapsed'], 'expanded', { getItem: () => { throw new Error('denied') } })).toBe('expanded')
    expect(readWorkbenchPreference('navigation', ['expanded', 'collapsed'], 'expanded', { getItem: () => 'collapsed' })).toBe('collapsed')
  })
})
