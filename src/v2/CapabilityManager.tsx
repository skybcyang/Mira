import { useCallback, useEffect, useRef, useState } from 'react'
import { capabilitiesApi, type CapabilityCatalog, type CapabilitySettings, type CapabilityUpdate } from './capabilitiesApi'
import type { ToolDefinition } from '../domain/toolPolicy.js'
import { catalogChanges, uncertainCapabilitySave } from './capabilityForms'
import { McpConnectionEditor } from './McpConnectionEditor'
import { PythonCapabilityEditor } from './PythonCapabilityEditor'
export function CapabilityToolList({ settings, tools, disabled, onUpdate }: { settings: CapabilitySettings; tools: ToolDefinition[]; disabled: boolean; onUpdate: (input: CapabilityUpdate) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const visible = tools.filter(tool => `${tool.title} ${tool.description} ${tool.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="v2-capability-tools" aria-label="项目可用工具"><h3>项目可用工具</h3><p className="v2-detail-note">项目启用后，还需在具体步骤中选择。只读声明变化会使旧选择需要重新核对。</p>{!tools.length && <p>尚无工具。先发现 MCP 目录或登记脚本。</p>}
    {tools.length > 0 && <label>搜索工具<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>}{tools.length > 0 && visible.length === 0 && <p>没有匹配工具。清空搜索可查看全部。</p>}
    {visible.map(tool => { const enabled = settings.enabled.includes(tool.id); return <article className="v2-capability-tool" key={tool.id}>
      <header><h4>{tool.title}</h4><span>{enabled ? '项目已启用' : '项目未启用'} · {tool.effect === 'review' ? '逐次审阅' : '已核对只读'}</span></header><p>{tool.description}</p>
      <details><summary>能力身份与参数结构</summary><dl><dt>能力 ID</dt><dd><code>{tool.id}</code></dd><dt>定义版本</dt><dd><code>{tool.version}</code></dd>{tool.bindingId && <><dt>绑定来源</dt><dd><code>{tool.bindingId}</code></dd></>}</dl><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
      <div className="v2-capability-actions"><button type="button" disabled={disabled} onClick={() => void onUpdate({ baseRevision: settings.revision, tool: { id: tool.id, enabled: !enabled } })}>{enabled ? '在项目停用' : '在项目启用'}</button>
        {tool.source === 'mcp' && <button type="button" disabled={disabled} onClick={() => void onUpdate({ baseRevision: settings.revision, tool: { id: tool.id, enabled, readOnly: tool.effect !== 'read' } })}>{tool.effect === 'read' ? '恢复逐次审阅' : '我已核对为只读'}</button>}</div>
    </article> })}
  </section>
}
export function CapabilityManager({ mode, onDirtyChange, onRequestLeave }: { mode: 'mcp' | 'python'; onDirtyChange: (dirty: boolean) => void; onRequestLeave: (action: () => void) => void }) {
  const [data, setData] = useState<CapabilityCatalog | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selection, setSelection] = useState(mode === 'mcp' ? 'new' : 'environment'), [generation, setGeneration] = useState(0)
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false)
  const [changes, setChanges] = useState<ReturnType<typeof catalogChanges> | null>(null)
  const [definitions, setDefinitions] = useState<{ before: ToolDefinition; after: ToolDefinition }[]>([])
  const alive = useRef(true), lock = useRef(false)
  const handleDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange(value); if (value) setNotice('') }, [onDirtyChange])
  const reload = async () => {
    setError('')
    try { const value = await capabilitiesApi.get(); if (alive.current) { setData(value); setGeneration(value => value + 1); setUncertain(false); setChanges(null) } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '无法读取能力目录，请重试。') }
  }
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false } }, [])
  const saved = (settings: CapabilitySettings, nextSelection?: string) => {
    if (!data) return
    const difference = catalogChanges(data.settings.tools, settings.tools)
    setDefinitions(difference.changed.flatMap(id => { const before = data.settings.tools.find(tool => tool.id === id), after = settings.tools.find(tool => tool.id === id); return before && after ? [{ before, after }] : [] }))
    setChanges(difference); setData({ ...data, settings }); setGeneration(value => value + 1); setNotice('已保存。请在下方核对项目可用性；已有步骤不会自行更新。')
    if (nextSelection) setSelection(nextSelection)
  }
  const update = async (input: CapabilityUpdate) => {
    if (lock.current || dirty || uncertain) return
    lock.current = true; setBusy(true); setError('')
    try { const value = await capabilitiesApi.update(input); if (alive.current) saved(value.settings) }
    catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : '未确认保存成功。'); setUncertain(uncertainCapabilitySave(cause)) } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  if (!data) return <div className="v2-model-settings-state" role={error ? 'alert' : 'status'}>{error || '正在读取能力目录…'}{error && <button type="button" onClick={() => void reload()}>重新读取</button>}</div>
  const settings = data.settings, connection = settings.connections.find(item => item.id === selection), script = [...settings.scripts].reverse().find(item => item.id === selection)
  const tools = settings.tools.filter(tool => mode === 'mcp' ? connection ? tool.bindingId === connection.id : false : script ? tool.bindingId === script.id : tool.source === 'python')
  const props = { settings, available: data.runtime[mode], onDirtyChange: handleDirty, onRequestLeave, onSaved: saved, onReload: () => void reload() }
  return <div className="v2-model-settings-form v2-capability-manager">
    <label>{mode === 'mcp' ? 'MCP 连接' : 'Python 环境与脚本'}<select value={selection} disabled={busy} onChange={event => { const value = event.target.value; onRequestLeave(() => { setSelection(value); setNotice(''); setError(''); setChanges(null) }) }}>
      {mode === 'mcp' ? <><option value="new">新增 MCP 连接</option>{settings.connections.map(item => <option key={item.id} value={item.id}>{item.title} · {item.transport === 'http' ? '远程' : '本地'}{item.requiresCredential && !item.hasCredential ? ' · 需凭据' : ''}</option>)}</> : <><option value="environment">Python 隔离环境</option><option value="new">登记新脚本</option>{[...new Map(settings.scripts.map(item => [item.id, item])).values()].map(item => <option key={item.id} value={item.id}>{item.title} · 版本 {item.version}{settings.enabled.includes(item.id) ? ' · 已启用' : ' · 未启用'}</option>)}</>}
    </select></label>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {uncertain && <button type="button" onClick={() => onRequestLeave(() => void reload())}>重新读取并核对</button>}
    {changes && Object.values(changes).some(ids => ids.length) && <details><summary>工具目录变化：新增 {changes.added.length}，变化 {changes.changed.length}，移除 {changes.removed.length}</summary>{(['added', 'changed', 'removed'] as const).map(key => changes[key].length ? <p key={key}>{({ added: '新增', changed: '变化', removed: '移除' })[key]}：{changes[key].join('、')}</p> : null)}{definitions.map(pair => <details key={pair.after.id}><summary>核对 {pair.after.title} 的定义变化</summary><h4>变更前</h4><pre>{JSON.stringify(pair.before, null, 2)}</pre><h4>变更后</h4><pre>{JSON.stringify(pair.after, null, 2)}</pre></details>)}<p className="v2-detail-note">请展开对应能力，核对完整结构与定义版本。</p></details>}
    {mode === 'mcp' ? <McpConnectionEditor key={`${selection}:${generation}`} {...props} connection={connection} /> : <PythonCapabilityEditor key={`${selection}:${generation}`} {...props} mode={selection === 'environment' ? 'environment' : 'script'} script={script} />}
    <CapabilityToolList settings={settings} tools={tools} disabled={dirty || busy || uncertain} onUpdate={update} />
  </div>
}
