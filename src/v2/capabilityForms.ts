import type { ConnectionInput, McpConnection } from './capabilitiesApi'
import type { ToolFile } from '../domain/toolPolicy.js'
export interface ConnectionDraft { title: string; transport: 'http' | 'stdio'; url: string; command: string; args: string; cwd: string; token: string; env: { name: string; value: string }[] }
export function connectionInput(draft: ConnectionDraft, baseRevision: number, previous?: McpConnection): ConnectionInput {
  if (!draft.title.trim() || draft.title.trim().length > 120) throw Error('请填写连接名称，最多 120 字符。')
  const connection: ConnectionInput['connection'] = { ...(previous ? { id: previous.id, requiresCredential: previous.requiresCredential, envNames: previous.envNames } : {}), title: draft.title.trim(), transport: draft.transport }
  const env: Record<string, string> = {}
  for (const row of draft.env) {
    if (!row.name && !row.value) continue
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(row.name) || Object.prototype.hasOwnProperty.call(env, row.name) || row.value.includes('\0')) throw Error('环境变量名称不能重复，请使用字母、数字和下划线。')
    env[row.name] = row.value
  }
  if (draft.transport === 'http') {
    let url: URL
    try { url = new URL(draft.url) } catch { throw Error('请填写完整的 HTTP 或 HTTPS 地址。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('连接地址不能包含账号、密码或片段。凭据请单独填写。')
    connection.url = url.href
  } else {
    if (!draft.command.trim()) throw Error('请填写要启动的程序。')
    let args: unknown
    try { args = JSON.parse(draft.args) } catch { throw Error('参数请使用 JSON 字符串数组，例如 ["server.py"]。') }
    if (!Array.isArray(args) || args.length > 40 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw Error('参数请使用最多 40 项的字符串数组。')
    connection.command = draft.command.trim(); connection.args = args
    if (draft.cwd.trim()) connection.cwd = draft.cwd.trim()
  }
  const credential = { ...(draft.token && draft.transport === 'http' ? { token: draft.token } : {}), ...(Object.keys(env).length && draft.transport === 'stdio' ? { env } : {}) }
  return { baseRevision, connection, ...(Object.keys(credential).length ? { credential } : {}) }
}
export function objectInput(value: string, maxBytes = 32768): Record<string, unknown> {
  if (new TextEncoder().encode(value).length > maxBytes) throw Error('JSON 内容超过大小限制。')
  let result: unknown
  try { result = JSON.parse(value) } catch { throw Error('请填写有效 JSON。') }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('JSON 必须是对象，例如 {}。')
  return result as Record<string, unknown>
}
export function toolDependencyIds(value: string): string[] {
  const ids = value.split(/[,，\n]/).map(id => id.trim()).filter(Boolean)
  if (ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => id.length > 160 || /\s|\0/.test(id))) throw Error('每类最多 8 个不重复的能力 ID，用逗号或换行分隔。')
  return ids
}
export function dependencyPins(value: string): string[] {
  const entries = value.split('\n').map(line => line.trim()).filter(Boolean)
  if (entries.length > 20 || entries.some(line => !/^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9._+!-]*$/.test(line))) throw Error('依赖请逐行填写固定版本，例如 numpy==2.3.1。')
  return entries
}
export function attachmentPreview(file: ToolFile): { bytes: Uint8Array; text?: string; image?: string } {
  const suffix = { 'image/png': '.png', 'text/csv': '.csv', 'text/plain': '.txt' }[file.mimeType]
  if (!suffix || !file.name.toLowerCase().endsWith(suffix) || /[/\\\0]|^\./.test(file.name) || file.data.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw Error('附件格式不受支持。')
  const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0))
  if (bytes.length > 1024 * 1024) throw Error('附件超过 1 MiB。')
  if (file.mimeType === 'image/png') {
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) throw Error('图片内容不是有效的 PNG。')
    return { bytes, image: `data:image/png;base64,${file.data}` }
  }
  return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}
export function catalogChanges(before: { id: string; version: string }[], after: { id: string; version: string }[]) {
  return { added: after.filter(tool => !before.some(old => old.id === tool.id)).map(tool => tool.id), changed: after.filter(tool => before.some(old => old.id === tool.id && old.version !== tool.version)).map(tool => tool.id), removed: before.filter(tool => !after.some(next => next.id === tool.id)).map(tool => tool.id) }
}
export function uncertainCapabilitySave(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  return typeof code !== 'string' || ['CAPABILITY_CONFLICT', 'CAPABILITY_WRITE_FAILED'].includes(code)
}
