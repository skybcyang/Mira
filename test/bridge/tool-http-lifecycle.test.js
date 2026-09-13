import { expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createMiraApiHandler } from '../../bridge/mira-http.js'
it('passes browser disconnect cancellation to capabilities without binding ordinary Run lifetime to HTTP', async () => {
  for (const path of ['/capabilities/connections', '/capabilities/python/test', '/capabilities/python/prepare', '/boards/b/transformations/t/runs']) {
    let entered, release, signal
    const started = new Promise(resolve => { entered = resolve }), finish = new Promise(resolve => { release = resolve })
    const request = Readable.from(['{}']); request.method = 'POST'; request.url = '/graphmind/api/v2' + path
    const response = new EventEmitter(); response.writeHead = () => {}; response.end = () => { response.writableEnded = true }
    const handler = createMiraApiHandler({ dispatch: async (_method, _segments, _body, options) => { signal = options?.signal; entered(); await finish; return { status: 200, body: {} } } })
    const pending = handler(request, response)
    await started; response.emit('close')
    if (path.startsWith('/capabilities')) expect(signal?.aborted).toBe(true)
    else expect(signal).toBeUndefined()
    release(); await pending
  }
})
