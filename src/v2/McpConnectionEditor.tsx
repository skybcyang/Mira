import { useEffect, useRef, useState } from 'react'
import { capabilitiesApi, type CapabilitySettings, type McpConnection } from './capabilitiesApi'
import { connectionInput, type ConnectionDraft } from './capabilityForms'
import { useCapabilityEditor } from './useCapabilityEditor'
import { useInspectorDraft } from './inspectorDrafts'
export interface CapabilityEditorProps { settings: CapabilitySettings; available: boolean; onDirtyChange: (dirty: boolean) => void; onRequestLeave: (action: () => void) => void; onSaved: (settings: CapabilitySettings, selection?: string) => void; onReload: () => void }
export function McpConnectionEditor({ settings, available, connection, onDirtyChange, onRequestLeave, onSaved, onReload }: CapabilityEditorProps & { connection?: McpConnection }) {
  const [initial] = useState<ConnectionDraft>({ title: connection?.title || '', transport: connection?.transport || 'http', url: connection?.url || '', command: connection?.command || '', args: JSON.stringify(connection?.args || []), cwd: connection?.cwd || '', token: '', env: connection?.hasCredential ? [] : (connection?.envNames || []).map(name => ({ name, value: '' })) })
  const [draft, setDraft] = useState(initial), [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const editor = useCapabilityEditor(dirty, onDirtyChange)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const set = <K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => {
    try {
      const input = connectionInput(draft, settings.revision, connection)
      return editor.perform(signal => capabilitiesApi.connect(input, signal), result => onSaved(result.settings, connection?.id || result.settings.connections.find(item => !settings.connections.some(previous => previous.id === item.id))?.id))
    } catch (cause) { editor.setError(cause instanceof Error ? cause.message : '请核对连接。'); return false }
  }
  useInspectorDraft('mcp-connection', dirty, save, editor.busy || editor.uncertain || !available)
  const locked = editor.busy || editor.uncertain
  return <section className="v2-capability-editor" aria-label="MCP 连接编辑" aria-busy={editor.busy}>
    <h3>{connection ? connection.title : '新增 MCP 连接'}</h3>
    <p className="v2-detail-note">测试连接只发现工具目录。保存后，再逐项选择在项目启用。</p>
    {!available && <p role="status">此宿主未提供 MCP。请在支持 MCP 的桌面或 Node 宿主中连接。</p>}
    {connection && <p className="v2-detail-note">{connection.requiresCredential && !connection.hasCredential ? '需要重新填写本次会话凭据' : '已保存连接 · 运行前仍会核对能力'}<br /><code>{connection.id}</code></p>}
    <label>连接名称<input ref={inputRef} value={draft.title} maxLength={120} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => set('title', event.target.value)} /></label>
    <label>连接方式<select value={draft.transport} disabled={locked} onChange={event => set('transport', event.target.value as ConnectionDraft['transport'])}><option value="http">远程 · Streamable HTTP</option><option value="stdio">本地程序 · stdio</option></select></label>
    {draft.transport === 'http' ? <><label>服务地址<input type="url" value={draft.url} readOnly={editor.uncertain} disabled={editor.busy} placeholder="https://example.com/mcp" onChange={event => set('url', event.target.value)} /></label><label>访问令牌（可选）<input type="password" autoComplete="off" value={draft.token} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => set('token', event.target.value)} /></label></> : <>
      <label>程序<input value={draft.command} readOnly={editor.uncertain} disabled={editor.busy} placeholder="程序的完整路径" onChange={event => set('command', event.target.value)} /></label>
      <label>参数（JSON 字符串数组）<textarea className="v2-capability-small-code" value={draft.args} rows={3} readOnly={editor.uncertain} disabled={editor.busy} spellCheck={false} onChange={event => set('args', event.target.value)} /></label>
      <label>工作目录（可选）<input value={draft.cwd} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => set('cwd', event.target.value)} /></label>
      <p className="v2-detail-note">测试会启动上述本地程序。它以当前用户权限运行；MCP 连接不提供 Python 容器隔离。</p>
      <fieldset><legend>环境变量</legend>{connection?.envNames?.length ? <p className="v2-detail-note">已登记名称：{connection.envNames.join('、')}。{connection.hasCredential ? '本次会话已提供；不填写则沿用。' : '请重新填写变量值。'}</p> : null}
        {draft.env.map((row, index) => <div className="v2-capability-env" key={index}><label>变量名称 {index + 1}<input value={row.name} disabled={locked} onChange={event => set('env', draft.env.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} /></label><label>变量值 {index + 1}<input type="password" autoComplete="off" value={row.value} disabled={locked} onChange={event => set('env', draft.env.map((value, i) => i === index ? { ...value, value: event.target.value } : value))} /></label><button type="button" disabled={locked} onClick={() => set('env', draft.env.filter((_, i) => i !== index))}>移除变量 {index + 1}</button></div>)}
        <button type="button" disabled={locked || draft.env.length >= 40} onClick={() => set('env', [...draft.env, { name: '', value: '' }])}>添加环境变量</button>
      </fieldset>
    </>}
    <p className="v2-detail-note">凭据仅本次会话可用，重启需重填；不进入导出或备份。</p>
    {editor.error && <p role="alert">{editor.error}</p>}
    {editor.uncertain && <p>草稿已保留。请复制需要的内容，再<button type="button" onClick={() => onRequestLeave(onReload)}>重新读取并核对</button>；不会重发旧请求。</p>}
    <footer><button type="button" className="v2-primary-button" disabled={locked || !available} onClick={() => void save()}>{editor.busy ? '正在连接…' : '测试连接并保存'}</button>{editor.busy && <button type="button" onClick={editor.cancel}>取消连接</button>}{connection && <button type="button" disabled={locked || dirty} onClick={() => setConfirmDisconnect(true)}>断开连接</button>}</footer>
    {confirmDisconnect && <div role="group" aria-label="确认断开连接"><p>断开后相关工具不可运行，历史记录保留。</p><button type="button" disabled={locked} onClick={() => void editor.perform(() => capabilitiesApi.update({ baseRevision: settings.revision, removeConnection: connection!.id }), result => onSaved(result.settings, 'new'))}>确认断开</button><button type="button" onClick={() => setConfirmDisconnect(false)}>保留连接</button></div>}
  </section>
}
