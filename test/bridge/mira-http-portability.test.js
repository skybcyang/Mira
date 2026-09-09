import { createServer, request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createMiraApiHandler, readJsonBody } from '../../bridge/mira-http.js'

function responseRecorder() {
  return {
    status: undefined,
    headers: undefined,
    raw: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(value = '') {
      this.raw += value
    },
    json() {
      return JSON.parse(this.raw)
    },
  }
}

function request({ method = 'POST', url, chunks }) {
  return Object.assign(Readable.from(chunks), { method, url })
}

describe('portable HTTP request limits', () => {
  it('measures capped request bodies by actual streamed UTF-8 bytes', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ text: '你' }))
    const req = request({
      url: '/graphmind/api/v2/boards/imports',
      chunks: [encoded.slice(0, 10), encoded.slice(10)],
    })

    await expect(readJsonBody(req, { maxBytes: encoded.byteLength })).resolves.toEqual({ text: '你' })
  })

  it('stops pulling and never parses once a streamed body crosses the hard cap', async () => {
    let pulled = 0
    async function* chunks() {
      pulled += 1
      yield new TextEncoder().encode('{"a":')
      pulled += 1
      yield new TextEncoder().encode('"too long"')
      pulled += 1
      yield new TextEncoder().encode('}')
    }

    await expect(readJsonBody(chunks(), { maxBytes: 8 })).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { category: 'bytes', limit: 8 },
    })
    expect(pulled).toBe(2)
  })

  it('applies the hard cap only to the Board import route', async () => {
    const application = { dispatch: vi.fn(async (_method, _segments, body) => ({
      status: 201,
      body: { received: body },
    })) }
    const handler = createMiraApiHandler(application, { maxImportBodyBytes: 8 })
    const oversizedImport = request({
      url: '/graphmind/api/v2/boards/imports',
      chunks: [new TextEncoder().encode('{"artifact":{}}')],
    })
    const importResponse = responseRecorder()

    await handler(oversizedImport, importResponse)

    expect(importResponse.status).toBe(413)
    expect(importResponse.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(application.dispatch).not.toHaveBeenCalled()

    const normalRequest = request({
      url: '/graphmind/api/v2/boards',
      chunks: [new TextEncoder().encode('{"title":"a title larger than eight bytes"}')],
    })
    const normalResponse = responseRecorder()
    await handler(normalRequest, normalResponse)

    expect(normalResponse.status).toBe(201)
    expect(application.dispatch).toHaveBeenCalledWith(
      'POST', ['v2', 'boards'], { title: 'a title larger than eight bytes' },
    )
  })

  it('returns a stable JSON 413 to a real chunked Node HTTP client', async () => {
    const application = { dispatch: vi.fn() }
    const server = createServer(createMiraApiHandler(application, { maxImportBodyBytes: 8 }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()

    try {
      const response = await new Promise((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1',
          port,
          path: '/graphmind/api/v2/boards/imports',
          method: 'POST',
          headers: { 'transfer-encoding': 'chunked' },
        }, (res) => {
          let raw = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }))
        })
        req.on('error', reject)
        req.write('{"art')
        req.write('ifact":{}}')
        req.end()
      })

      expect(response).toEqual({
        status: 413,
        body: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the Board import byte limit',
          details: { category: 'bytes', actual: 15, limit: 8 },
        },
      })
      expect(application.dispatch).not.toHaveBeenCalled()
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
