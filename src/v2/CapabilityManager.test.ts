import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpConnectionEditor } from './McpConnectionEditor'
import { PythonCapabilityEditor } from './PythonCapabilityEditor'
import { CapabilityToolList } from './CapabilityManager'
import { CapabilityResult } from './CapabilityResult'
import { listBuiltinTools, toolDefinition } from '../domain/toolPolicy.js'
import type { CapabilitySettings } from './capabilitiesApi'
const settings: CapabilitySettings = { schemaVersion: 1, revision: 0, connections: [], tools: [], scripts: [], enabled: [] }
const callbacks = { onDirtyChange: () => {}, onRequestLeave: (action: () => void) => action(), onSaved: () => {}, onReload: () => {} }
it('shows real MCP program scope and session credential state before the explicit connect action', () => {
  const html = renderToStaticMarkup(createElement(McpConnectionEditor, { ...callbacks, settings, available: true, connection: { id: 'mcp-test', title: 'Local test', transport: 'stdio', command: '/usr/bin/node', args: ['server.js'], envNames: ['TOKEN'], requiresCredential: true, hasCredential: false } }))
  expect(html).toContain('/usr/bin/node'); expect(html).toContain('server.js'); expect(html).toContain('TOKEN')
  expect(html).toContain('仅本次会话'); expect(html).toContain('重新填写'); expect(html).toContain('测试连接并保存')
  expect(html).toContain('type="password"'); expect(html).not.toContain('自动启用')
})
it('keeps Python environment preparation separate from registration and reveals unavailable isolation', () => {
  const html = renderToStaticMarkup(createElement(PythonCapabilityEditor, { ...callbacks, settings, available: false, mode: 'environment' }))
  expect(html).toContain('Docker'); expect(html).toContain('准备环境'); expect(html).toContain('disabled=""')
  expect(html).not.toContain('环境已就绪')
})
it('tool catalog exposes stable identity, schema and explicit project enablement independently of connection state', () => {
  const tool = toolDefinition({ ...listBuiltinTools()[0], id: 'mcp-test:read', name: 'read', source: 'mcp', bindingId: 'mcp-test', effect: 'review' })
  const html = renderToStaticMarkup(createElement(CapabilityToolList, { settings: { ...settings, tools: [tool] }, tools: [tool], disabled: false, onUpdate: async () => {} }))
  expect(html).toContain('mcp-test:read'); expect(html).toContain('在项目启用'); expect(html).toContain('逐次审阅')
  expect(html).toContain('我已核对为只读'); expect(html).toContain('参数结构')
})
it('does not silently omit excess attachments or offer downloads before preview', () => {
  const file = { name: 'output.txt', mimeType: 'text/plain', data: 'eA==' }
  expect(renderToStaticMarkup(createElement(CapabilityResult, { result: { text: 'result', files: [file] } }))).not.toContain('download=')
  expect(renderToStaticMarkup(createElement(CapabilityResult, { result: { text: 'result', files: Array(5).fill(file) } }))).toContain('附件数量超过上限')
})
