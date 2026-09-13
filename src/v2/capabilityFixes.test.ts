import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { capabilitiesApi, type CapabilityCatalog, type PythonScript } from './capabilitiesApi'
import { PythonCapabilityEditor, pythonScriptChanged } from './PythonCapabilityEditor'
import { CapabilityManager } from './CapabilityManager'
import { toolDefinition, listBuiltinTools } from '../domain/toolPolicy.js'

const a = `sha256:${'a'.repeat(64)}`, b = `sha256:${'b'.repeat(64)}`
const script: PythonScript = { id: 'script', title: 'Script', code: 'print(1)', digest: 'digest', version: 1, imageId: a, inputSchema: { type: 'object', properties: {} } }
const tool = toolDefinition({ ...listBuiltinTools()[0], id: 'script', source: 'python', bindingId: 'script' })
const catalog: CapabilityCatalog = { settings: { schemaVersion: 1, revision: 2, connections: [], tools: [tool], enabled: [], scripts: [script], pythonImageId: b }, builtins: [], runtime: { mcp: true, python: true } }
const callbacks = { onDirtyChange: vi.fn(), onRequestLeave: (action: () => void) => action(), onSaved: vi.fn(), onReload: vi.fn() }
let root: Root, document: Document
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="app"></div></body></html>')
  document = dom.document as unknown as Document
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', dom.HTMLElement); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(document.getElementById('app')!)
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)! }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

it('probes the selected script image and ignores a late probe for the previous selection', async () => {
  const old = deferred<{ available: boolean; imageId: string; reason?: string }>()
  const status = vi.spyOn(capabilitiesApi, 'pythonStatus').mockImplementation(image => image === a ? old.promise : Promise.resolve({ available: true, imageId: b }))
  await act(async () => root.render(createElement(PythonCapabilityEditor, { ...callbacks, settings: catalog.settings, available: true, mode: 'script', script })))
  expect(status).toHaveBeenCalledWith(a)
  const select = document.querySelector('select')!
  await act(async () => {
    Object.defineProperty(select, 'value', { value: b, configurable: true })
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  expect(status).toHaveBeenLastCalledWith(b)
  await act(async () => old.resolve({ available: false, imageId: a, reason: 'Old image unavailable' }))
  expect(document.body.textContent).not.toContain('Old image unavailable')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('所选环境已就绪')
})

it('only persistent script fields can enable a new version, not temporary test arguments', () => {
  const current = { title: script.title, code: script.code, schema: JSON.stringify(script.inputSchema, null, 2), environmentId: a, argumentsText: '{"x":2}' }
  expect(pythonScriptChanged(script, b, current)).toBe(false)
  expect(pythonScriptChanged(script, b, { ...current, code: 'print(2)' })).toBe(true)
})

it('locks form and repeated reload while reading back an uncertain capability update', async () => {
  const refresh = deferred<CapabilityCatalog>()
  const get = vi.spyOn(capabilitiesApi, 'get').mockResolvedValueOnce(catalog).mockImplementation(() => refresh.promise)
  vi.spyOn(capabilitiesApi, 'pythonStatus').mockResolvedValue({ available: true, imageId: b })
  vi.spyOn(capabilitiesApi, 'update').mockRejectedValue(new Error('unknown result'))
  await act(async () => root.render(createElement(CapabilityManager, { ...callbacks, mode: 'python' })))
  await act(async () => button('在项目启用').click())
  await act(async () => button('重新读取并核对').click())
  expect(document.querySelector('fieldset[disabled]')).not.toBeNull()
  expect(document.querySelector('select')?.disabled).toBe(true)
  expect(button('重新读取并核对').disabled).toBe(true)
  await act(async () => refresh.resolve({ ...catalog, settings: { ...catalog.settings, revision: 3 } }))
  expect(document.querySelector('fieldset[disabled]')).toBeNull()
  expect(get).toHaveBeenCalledTimes(2)
})

it('uses the explicit-image POST status port and keeps default GET compatibility', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ available: true, imageId: a })))
  vi.stubGlobal('fetch', fetcher)
  await capabilitiesApi.pythonStatus(a)
  expect(fetcher.mock.calls[0]).toEqual(['/graphmind/api/v2/capabilities/python/status', expect.objectContaining({ method: 'POST', body: JSON.stringify({ image: a }) })])
  await capabilitiesApi.pythonStatus()
  expect(fetcher.mock.calls[1][0]).toBe('/graphmind/api/v2/capabilities/python')
})
