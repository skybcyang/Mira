import { expect, it } from 'vitest'
import { checkedWebUrl, publicAddresses, parseWebDocument, createNodeWebReader, requestPinned } from '../../bridge/node-web-reader.js'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

it('uses the supplied socket address and bounds actual decompression before parsing', async () => {
  const compressed = gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1, 'x'))
  const server = createServer((request, response) => {
    if (request.url === '/large') { response.writeHead(200, { 'content-encoding': 'gzip' }); response.end(compressed) }
    else response.end('Selected public text')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    // Exercise the low-level pinned transport on an isolated local fixture. The public
    // URL policy above is separately tested to reject this address in production.
    const origin = `http://unresolvable-reader.invalid:${server.address().port}`
    const address = [{ address: '127.0.0.1', family: 4 }]
    expect((await requestPinned(new URL(origin), address)).bytes.toString()).toBe('Selected public text')
    await expect(requestPinned(new URL(origin + '/large'), address)).rejects.toMatchObject({ code: 'MATERIAL_LIMIT' })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

it('cancels even while the DNS resolver remains pending', async () => {
  const controller = new AbortController()
  const read = createNodeWebReader({ resolve: () => new Promise(() => {}) })
  const pending = read({ url: 'https://example.com' }, { signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'MATERIAL_READ_FAILED' })
}, 300)

it('blocks all non-public destinations including mapped and numeric aliases', async () => {
  for (const value of ['http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://169.254.169.254', 'http://10.0.0.1', 'http://192.168.1.1', 'http://100.64.1.1', 'https://user:password@example.com', 'http://example.com:8080', 'file:///tmp/file']) {
    await expect(Promise.resolve().then(() => publicAddresses(checkedWebUrl(value), async () => []))).rejects.toMatchObject({ code: 'MATERIAL_SOURCE_BLOCKED' })
  }
  await expect(publicAddresses(checkedWebUrl('https://example.com'), async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toMatchObject({ code: 'MATERIAL_SOURCE_BLOCKED' })
})
it('extracts static article paragraphs and safe relative links, excluding active resources', () => {
  const result = parseWebDocument(Buffer.from('<html><head><title>真实文章</title></head><body><article><h1>标题</h1><p>这里是明确的文章正文。'.repeat(1) + '内容。'.repeat(100) + '</p><p><a href="/source">出处</a></p><script>偷取正文</script><iframe src="https://evil.test"></iframe></article></body></html>'), 'text/html; charset=utf-8', 'https://example.com/article')
  expect(result.text).toContain('这里是明确的文章正文')
  expect(result.text).toContain('https://example.com/source')
  expect(result.text).not.toContain('偷取正文')
  expect(result.text).not.toContain('evil.test')
  expect(() => parseWebDocument(Buffer.from('<html><body>Please sign in to continue</body></html>'), 'text/html', 'https://example.com')).toThrow()
})
it('pins the resolved address for every redirect and never connects to private redirects', async () => {
  const calls = []
  const read = createNodeWebReader({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (url, addresses) => {
    calls.push({ url: url.href, addresses })
    return { status: 302, headers: { location: 'http://127.0.0.1/private' }, bytes: Buffer.alloc(0) }
  } })
  await expect(read({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'MATERIAL_SOURCE_BLOCKED' })
  expect(calls).toHaveLength(1)
  expect(calls[0].addresses[0].address).toBe('93.184.216.34')
})
it('enforces a tool URL allowlist before resolving redirected destinations', async () => {
  const calls = []
  const read = createNodeWebReader({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async url => {
    calls.push(url.href)
    return { status: 302, headers: { location: 'https://other.example/secret' }, bytes: Buffer.alloc(0) }
  } })
  await expect(read({ url: 'https://example.com' }, { allowedUrls: ['https://example.com'] })).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' })
  expect(calls).toEqual(['https://example.com/'])
})
