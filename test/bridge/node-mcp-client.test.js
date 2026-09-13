import { afterEach, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createMcpClient } from '../../bridge/node-mcp-client.js'

const cleanup = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const definition = name => ({ name, description: 'Fixture tool', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } })
async function fixture(handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { requests.push({ method: 'session/delete', sessionId: req.headers['mcp-session-id'] }); res.writeHead(200).end(); return }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let body = ''; for await (const chunk of req) body += chunk
    const message = JSON.parse(body); requests.push(message)
    const send = result => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    if (await handler?.({ req, res, message, send })) return
    if (message.method === 'initialize') send({ protocolVersion: '2025-06-18', serverInfo: { name: 'test', version: '1' }, capabilities: { tools: {} } })
    else if (message.method === 'notifications/initialized' || message.id === undefined) res.writeHead(202).end()
    else if (message.method === 'tools/list') send({ tools: [definition('echo')] })
    else if (message.method === 'tools/call') send({ content: [{ type: 'text', text: message.params.arguments.value ?? 'ok' }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { connection: { id: 'fixture', transport: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` }, requests }
}
function client(options) { const value = createMcpClient(options); cleanup.push(() => value.close()); return value }
const stdioConnection = { id: 'stdio', transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../helpers/mcp-stdio-server.mjs', import.meta.url))] }

it('handshakes and discovers paginated definitions without business calls, reflecting schema changes', async () => {
  let version = 'string'
  const { connection, requests } = await fixture(({ message, send }) => {
    if (message.method !== 'tools/list') return false
    const tool = definition(message.params?.cursor ? 'second' : 'first'); tool.inputSchema.properties.value.type = version
    send({ tools: [tool], ...(!message.params?.cursor ? { nextCursor: 'next' } : {}) }); return true
  })
  const mcp = client()
  expect((await mcp.discover(connection)).tools.map(tool => tool.name)).toEqual(['first', 'second'])
  expect(requests.some(item => item.method === 'tools/call')).toBe(false)
  version = 'number'
  expect((await mcp.discover(connection)).tools[0].inputSchema.properties.value.type).toBe('number')
  expect(await mcp.call(connection, 'echo', { value: 'actual text' })).toEqual({ text: 'actual text' })
})

it('fails authentication and redirects without echoing secrets or following the target', async () => {
  let redirects = 0
  const { connection } = await fixture(({ req, res }) => {
    if (req.url === '/target') redirects++
    if (req.headers.authorization) res.writeHead(302, { location: '/target' }).end()
    else res.writeHead(401).end('secret-server-error')
    return true
  })
  const mcp = client()
  await expect(mcp.discover(connection)).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' })
  await expect(mcp.discover({ ...connection, token: 'private-token' })).rejects.toMatchObject({ code: 'MCP_INCOMPATIBLE' })
  expect(redirects).toBe(0)
  await expect(mcp.discover({ ...connection, url: connection.url.replace('http://', 'http://user:secret@') })).rejects.toMatchObject({ code: 'MCP_INCOMPATIBLE' })
})

it('rejects excessive discovery pages, tool count, duplicate names and response bytes', async () => {
  let mode = 'pages'
  const { connection } = await fixture(({ message, send }) => {
    if (message.method !== 'tools/list') return false
    const index = Number(message.params?.cursor ?? 0)
    if (mode === 'pages') send({ tools: [definition(`tool-${index}`)], nextCursor: String(index + 1) })
    if (mode === 'count') send({ tools: Array.from({ length: 101 }, (_, i) => definition(`tool-${i}`)) })
    if (mode === 'duplicate') send({ tools: [definition('same'), definition('same')] })
    if (mode === 'bytes') send({ tools: [{ ...definition('large'), description: 'x'.repeat(1024 * 1024) }] })
    return true
  })
  const mcp = client()
  for (mode of ['pages', 'count', 'bytes']) await expect(mcp.discover(connection)).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
  mode = 'duplicate'; await expect(mcp.discover(connection)).rejects.toMatchObject({ code: 'MCP_INCOMPATIBLE' })
})

it('preserves structured tool failures, bounds text bytes and does not silently omit unsupported media', async () => {
  const { connection } = await fixture(({ message, send }) => {
    if (message.method !== 'tools/call') return false
    const content = message.params.name === 'media' ? [{ type: 'image', data: 'eA==', mimeType: 'image/png' }] : [{ type: 'text', text: message.params.name === 'large' ? '界'.repeat(23000) : 'failed' }]
    send({ content, isError: message.params.name === 'failure' }); return true
  })
  const mcp = client()
  expect(await mcp.call(connection, 'failure', {})).toEqual({ text: 'failed', isError: true })
  await expect(mcp.call(connection, 'large', {})).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
  await expect(mcp.call(connection, 'media', {})).rejects.toMatchObject({ code: 'MCP_INCOMPATIBLE' })
})

it('cancels an in-flight call and classifies its outcome as unknown without replay', async () => {
  let entered
  const waiting = new Promise(resolve => { entered = resolve })
  const { connection, requests } = await fixture(({ message }) => { if (message.method === 'tools/call') { entered(); return true } })
  const mcp = client(); const controller = new AbortController()
  const result = mcp.call(connection, 'wait', {}, { signal: controller.signal })
  const rejection = expect(result).rejects.toMatchObject({ code: 'TOOL_OUTCOME_UNKNOWN' })
  await waiting; controller.abort(); await rejection
  expect(requests.filter(item => item.method === 'tools/call')).toHaveLength(1)
})

it('times out discovery and closes all active operations', async () => {
  const { connection } = await fixture(({ message }) => message.method === 'tools/list')
  await expect(client({ timeoutMs: 80 }).discover(connection)).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
  const mcp = client(); const pending = mcp.discover(connection)
  const rejection = expect(pending).rejects.toMatchObject({ code: 'MCP_UNAVAILABLE' })
  await mcp.close(); await rejection
  await expect(mcp.discover(connection)).rejects.toMatchObject({ code: 'MCP_UNAVAILABLE' })
})

it('runs real stdio MCP with explicit environment only and reaps its child', async () => {
  process.env.MIRA_TEST_HOST_SECRET = 'must-not-leak'
  try {
    const mcp = client()
    const connection = { ...stdioConnection, env: { EXPLICIT_VALUE: 'allowed' } }
    expect((await mcp.discover(connection)).tools.map(tool => tool.name)).toEqual(['environment'])
    const result = JSON.parse((await mcp.call(connection, 'environment', {})).text)
    expect(result.explicit).toBe('allowed'); expect(result.secret).toBeUndefined(); expect(result.home).toBeUndefined()
    expect(() => process.kill(result.pid, 0)).toThrow()
  } finally { delete process.env.MIRA_TEST_HOST_SECRET }
})

it('marks a stdio disconnect after dispatch uncertain and bounds unterminated stdout', async () => {
  const mcp = client()
  await expect(mcp.call(stdioConnection, 'disconnect', {})).rejects.toMatchObject({ code: 'TOOL_OUTCOME_UNKNOWN' })
  await expect(mcp.call(stdioConnection, 'large', {})).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
})

it('accepts a real Streamable HTTP SSE result without polling or replay', async () => {
  const { connection, requests } = await fixture(({ message, res }) => {
    if (message.method !== 'tools/call') return false
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'streamed text' }] } })}\n\n`)
    return true
  })
  expect(await client().call(connection, 'echo', {})).toEqual({ text: 'streamed text' })
  expect(requests.filter(item => item.method === 'tools/call')).toHaveLength(1)
})

it('terminates an assigned HTTP session when the bounded operation finishes', async () => {
  const { connection, requests } = await fixture(({ message, res, send }) => {
    if (message.method !== 'initialize') return false
    res.setHeader('mcp-session-id', 'owned-session')
    send({ protocolVersion: '2025-06-18', serverInfo: { name: 'test', version: '1' }, capabilities: { tools: {} } })
    return true
  })
  await client().discover(connection)
  expect(requests.filter(item => item.method === 'session/delete')).toEqual([{ method: 'session/delete', sessionId: 'owned-session' }])
})
