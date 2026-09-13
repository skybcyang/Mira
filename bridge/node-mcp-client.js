import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'

const RESPONSE_BYTES = 1024 * 1024
const TEXT_BYTES = 64 * 1024
const messages = {
  MCP_AUTH_REQUIRED: 'MCP 需要有效凭据，请更新本次会话凭据后重新连接。',
  MCP_UNAVAILABLE: 'MCP 连接不可用或已取消。',
  MCP_INCOMPATIBLE: 'MCP 地址、协议或返回格式不受支持。',
  TOOL_LIMIT: 'MCP 返回内容或工具数量超过限制。',
  TOOL_TIMEOUT: 'MCP 操作超时。',
  TOOL_FAILED: 'MCP 工具返回协议错误。',
  TOOL_OUTCOME_UNKNOWN: 'MCP 请求已发出，但执行结果无法确认；请核对外部状态，不要直接重试。',
}
function failure(code) { return Object.assign(new Error(messages[code]), { code }) }
function classify(error) {
  if (Object.hasOwn(messages, error?.code)) return error
  if (error?.code === 401 || error?.code === 403) return failure('MCP_AUTH_REQUIRED')
  if (/maximum size|maximum.*buffer/i.test(error?.message ?? '')) return failure('TOOL_LIMIT')
  if (error?.code === -32700 || error?.code === -32600 || error?.name === 'ZodError' || /not supported|invalid initialize|content type/i.test(error?.message ?? '')) return failure('MCP_INCOMPATIBLE')
  return failure('MCP_UNAVAILABLE')
}
function checkedConnection(connection) {
  if (!connection || typeof connection.id !== 'string' || !connection.id.trim()) throw failure('MCP_INCOMPATIBLE')
  if (connection.transport === 'http') {
    let url
    try { url = new URL(connection.url) } catch { throw failure('MCP_INCOMPATIBLE') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw failure('MCP_INCOMPATIBLE')
    if (connection.token !== undefined && (typeof connection.token !== 'string' || /[\r\n\0]/.test(connection.token))) throw failure('MCP_INCOMPATIBLE')
    return url
  }
  if (connection.transport !== 'stdio' || typeof connection.command !== 'string' || !connection.command.trim() || connection.command.includes('\0') ||
    (connection.args !== undefined && (!Array.isArray(connection.args) || connection.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) ||
    (connection.cwd !== undefined && (typeof connection.cwd !== 'string' || !connection.cwd || connection.cwd.includes('\0'))) ||
    (connection.env !== undefined && (!connection.env || typeof connection.env !== 'object' || Array.isArray(connection.env) || Object.entries(connection.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0'))))) throw failure('MCP_INCOMPATIBLE')
}

// Each operation gets a fresh bounded session: discovery never calls business tools,
// and a failed call cannot be replayed by a reconnecting transport.
export function createMcpClient({ timeoutMs = 30_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw failure('MCP_INCOMPATIBLE')
  const active = new Set()
  let closed = false
  async function operation(connection, signal, action) {
    if (closed || signal?.aborted) throw failure('MCP_UNAVAILABLE')
    const url = checkedConnection(connection)
    const controller = new AbortController()
    const client = new Client({ name: 'mira', version: '1' }, { capabilities: {} })
    let dispatched = false
    let rejectAborted
    const aborted = new Promise((_, reject) => { rejectAborted = reject })
    const stop = error => { if (!controller.signal.aborted) controller.abort(classify(error)) }
    const onAbort = () => rejectAborted(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    const onCallerAbort = () => stop(failure('MCP_UNAVAILABLE'))
    signal?.addEventListener('abort', onCallerAbort, { once: true })
    const timer = setTimeout(() => stop(failure('TOOL_TIMEOUT')), timeoutMs)
    const options = { signal: controller.signal, timeout: timeoutMs }
    const entry = { stop, close: () => client.close() }
    active.add(entry)
    client.onerror = stop
    let transport
    let cleanupSignal
    try {
      if (url) {
        const boundedFetch = async (input, init = {}) => {
          const response = await fetch(input, { ...init, redirect: 'manual', signal: cleanupSignal ?? AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : [])]) })
          if ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400)) {
            await response.body?.cancel()
            throw failure([401, 403].includes(response.status) ? 'MCP_AUTH_REQUIRED' : 'MCP_INCOMPATIBLE')
          }
          if (Number(response.headers.get('content-length')) > RESPONSE_BYTES) { await response.body?.cancel(); throw failure('TOOL_LIMIT') }
          if (!response.body) return response
          let bytes = 0
          const body = response.body.pipeThrough(new TransformStream({ transform(chunk, stream) {
            bytes += chunk.byteLength
            if (bytes > RESPONSE_BYTES) { const error = failure('TOOL_LIMIT'); stop(error); throw error }
            stream.enqueue(chunk)
          } }))
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
        transport = new StreamableHTTPClientTransport(url, {
          fetch: boundedFetch,
          requestInit: connection.token ? { headers: { Authorization: `Bearer ${connection.token}` } } : {},
          reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
        })
      } else {
        // SDK merges defaults. Undefined explicitly removes HOME/profile/user metadata;
        // retain only executable lookup and Windows loader requirements, plus user input.
        const env = Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key => [key, undefined]))
        for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'SYSTEMDRIVE']) if (process.env[key]) env[key] = process.env[key]
        Object.assign(env, connection.env)
        transport = new StdioClientTransport({ command: connection.command, args: connection.args, cwd: connection.cwd, env, stderr: 'ignore', maxBufferSize: RESPONSE_BYTES })
      }
      return await Promise.race([aborted, (async () => {
        await client.connect(transport, options)
        if (!client.getServerCapabilities()?.tools) throw failure('MCP_INCOMPATIBLE')
        return action(client, options, () => { controller.signal.throwIfAborted(); dispatched = true })
      })()])
    } catch (error) {
      const mapped = classify(error)
      if (dispatched && ['MCP_UNAVAILABLE', 'TOOL_TIMEOUT'].includes(mapped.code)) throw failure('TOOL_OUTCOME_UNKNOWN')
      throw mapped
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
      controller.signal.removeEventListener('abort', onAbort)
      if (transport?.sessionId) {
        cleanupSignal = AbortSignal.timeout(1000)
        await transport.terminateSession().catch(() => {})
      }
      await client.close().catch(() => {})
      active.delete(entry)
    }
  }
  return {
    discover(connection, { signal } = {}) {
      return operation(connection, signal, async (client, options) => {
        const tools = [], names = new Set(), cursors = new Set()
        let cursor, bytes = 0
        for (let page = 0; page < 10; page++) {
          // Avoid SDK listTools' eager compilation of untrusted output schemas.
          const result = await client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, ListToolsResultSchema, options)
          bytes += Buffer.byteLength(JSON.stringify(result))
          if (bytes > RESPONSE_BYTES || tools.length + result.tools.length > 100) throw failure('TOOL_LIMIT')
          for (const tool of result.tools) {
            if (names.has(tool.name) || tool.execution?.taskSupport === 'required') throw failure('MCP_INCOMPATIBLE')
            names.add(tool.name)
            tools.push({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) })
          }
          if (result.nextCursor === undefined) return { tools }
          if (!result.nextCursor || cursors.has(result.nextCursor)) throw failure('MCP_INCOMPATIBLE')
          cursor = result.nextCursor; cursors.add(cursor)
        }
        throw failure('TOOL_LIMIT')
      })
    },
    call(connection, name, args, { signal } = {}) {
      return operation(connection, signal, async (client, options, dispatch) => {
        if (typeof name !== 'string' || !name.trim() || name.length > 128 || !args || typeof args !== 'object' || Array.isArray(args)) throw failure('MCP_INCOMPATIBLE')
        let argumentBytes
        try { argumentBytes = Buffer.byteLength(JSON.stringify(args)) } catch { throw failure('MCP_INCOMPATIBLE') }
        if (argumentBytes > 32 * 1024) throw failure('TOOL_LIMIT')
        dispatch()
        let result
        try { result = await client.callTool({ name, arguments: args }, undefined, options) }
        catch (error) { if ([-32600, -32601, -32602].includes(error?.code)) throw failure('TOOL_FAILED'); throw error }
        if (result.content.some(block => block.type !== 'text')) throw failure('MCP_INCOMPATIBLE')
        const text = result.content.map(block => block.text).join('\n') || (result.structuredContent ? JSON.stringify(result.structuredContent) : '')
        if (Buffer.byteLength(text) > TEXT_BYTES) throw failure('TOOL_LIMIT')
        return { text, ...(result.isError ? { isError: true } : {}) }
      })
    },
    async close() {
      closed = true
      const entries = [...active]
      for (const entry of entries) entry.stop(failure('MCP_UNAVAILABLE'))
      await Promise.allSettled(entries.map(entry => entry.close()))
    },
  }
}
