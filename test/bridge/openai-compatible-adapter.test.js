import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const adapterUrl = new URL('../../bridge/openai-compatible-adapter.js', import.meta.url)

async function loadAdapter() {
  let exists = true
  try {
    await access(adapterUrl)
  } catch {
    exists = false
  }
  expect(exists).toBe(true)
  if (!exists) return null
  return import(adapterUrl.href)
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OpenAI-compatible text adapter', () => {
  it('sends one non-streaming chat request and returns Mira model output', async () => {
    const module = await loadAdapter()
    if (!module) return
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: '# 生成成果' } }],
    }))
    const onProgress = vi.fn(async () => {})
    const adapter = module.createOpenAICompatibleAdapter({
      baseUrl: 'https://llm.example.test/v1/',
      apiKey: 'secret',
      model: 'example-model',
      fetchImpl,
    })

    await expect(adapter.executeModel({
      prompt: '冻结后的完整提示',
      signal: new AbortController().signal,
      onProgress,
    })).resolves.toEqual({ outputText: '# 生成成果' })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://llm.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'example-model',
          messages: [{ role: 'user', content: '冻结后的完整提示' }],
          stream: false,
        }),
      }),
    )
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'generating',
      label: '正在请求模型',
    })
  })

  it('uses the same text boundary for suggestion output and local services without a key', async () => {
    const module = await loadAdapter()
    if (!module) return
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: '[{"label":"形成方案"}]' } }],
    }))
    const adapter = module.createOpenAICompatibleAdapter({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      fetchImpl,
    })

    await expect(adapter.executeSuggestion({ prompt: '只返回 JSON' }))
      .resolves.toBe('[{"label":"形成方案"}]')
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      'content-type': 'application/json',
    })
  })

  it('fails clearly for missing configuration, provider errors, and empty output', async () => {
    const module = await loadAdapter()
    if (!module) return
    expect(() => module.createOpenAICompatibleAdapter({ model: 'm' }))
      .toThrow(/MIRA_LLM_BASE_URL/)
    expect(() => module.createOpenAICompatibleAdapter({ baseUrl: 'https://llm.test/v1' }))
      .toThrow(/MIRA_LLM_MODEL/)

    const unauthorized = module.createOpenAICompatibleAdapter({
      baseUrl: 'https://llm.test/v1',
      model: 'm',
      fetchImpl: async () => response({ error: { message: 'bad key' } }, 401),
    })
    await expect(unauthorized.executeModel({ prompt: 'p' })).rejects.toMatchObject({
      code: 'MODEL_AUTH_FAILED',
    })

    const empty = module.createOpenAICompatibleAdapter({
      baseUrl: 'https://llm.test/v1',
      model: 'm',
      fetchImpl: async () => response({ choices: [{ message: { content: '' } }] }),
    })
    await expect(empty.executeModel({ prompt: 'p' })).rejects.toMatchObject({
      code: 'EMPTY_OUTPUT',
    })
  })

  it('creates the default module adapter from MIRA_LLM environment values', async () => {
    const module = await loadAdapter()
    if (!module) return
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: '环境配置成功' } }],
    }))
    const adapter = module.createOpenAICompatibleAdapterFromEnv({
      MIRA_LLM_BASE_URL: 'https://llm.test/v1',
      MIRA_LLM_API_KEY: 'key',
      MIRA_LLM_MODEL: 'model',
    }, { fetchImpl })

    await expect(adapter.executeModel({ prompt: 'p' }))
      .resolves.toEqual({ outputText: '环境配置成功' })
  })
})

const tools = [{ name: 'sum', description: 'Add numbers', inputSchema: { type: 'object' } }]
const call = (id = 'call-1', name = 'sum', args = '{"a":2}') => ({
  id, type: 'function', function: { name, arguments: args },
})
const completion = (tool_calls, content = null) => ({
  choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }],
})
async function toolAdapter(fetchImpl, options = {}) {
  const { createOpenAICompatibleAdapter } = await loadAdapter()
  return createOpenAICompatibleAdapter({ baseUrl: 'http://127.0.0.1/v1', model: 'm', fetchImpl, ...options })
}

describe('OpenAI-compatible bounded tool conversation', () => {
  it('accepts a final response with an empty tool list but rejects a tool-call finish without calls', async () => {
    const final = completion(undefined, 'Done')
    final.choices[0].message.tool_calls = []
    const adapter = await toolAdapter(async () => response(final))
    await expect(adapter.executeModel({})).resolves.toEqual({ outputText: 'Done' })
    final.choices[0].finish_reason = 'tool_calls'
    await expect(adapter.executeModel({})).rejects.toMatchObject({ code: 'MODEL_REQUEST_FAILED' })
  })

  it('returns the provider tool argument text unchanged in subsequent protocol messages', async () => {
    const args = '{ "a" : 2 }'
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(completion([call('1', 'sum', args)]))).mockResolvedValueOnce(response(completion(undefined, 'Done')))
    const adapter = await toolAdapter(fetchImpl)
    await adapter.executeModel({ tools, invokeTool: async () => ({ text: '4' }) })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].tool_calls[0].function.arguments).toBe(args)
  })

  it('round trips actual HTTP tool_call_id messages and keeps Kimi reasoning only in protocol memory', async () => {
    const requests = []
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      const body = requests.length === 1 ? completion([call()]) : completion(undefined, 'Result: 4')
      if (requests.length === 1) body.choices[0].message.reasoning_content = 'private reasoning'
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const adapter = await toolAdapter(globalThis.fetch, { baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
      const onProgress = vi.fn()
      const invokeTool = vi.fn(async () => ({ text: '4' }))
      expect(adapter.executeModel.supportsTools).toBe(true)
      await expect(adapter.executeModel({ prompt: 'Calculate', tools, invokeTool, onProgress })).resolves.toEqual({ outputText: 'Result: 4' })
      expect(invokeTool).toHaveBeenCalledExactlyOnceWith('sum', { a: 2 })
      expect(requests[0].tools).toEqual([{ type: 'function', function: { name: 'sum', description: 'Add numbers', parameters: { type: 'object' } } }])
      expect(requests[1].messages).toEqual([
        { role: 'user', content: 'Calculate' },
        { role: 'assistant', content: null, tool_calls: [call()], reasoning_content: 'private reasoning' },
        { role: 'tool', tool_call_id: 'call-1', content: '4' },
      ])
      expect(JSON.stringify(onProgress.mock.calls)).not.toContain('private reasoning')
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  })

  it.each([
    ['unknown tool', [call('1', 'not-selected')]],
    ['bad JSON', [call('1', 'sum', '{broken')]],
    ['non-object arguments', [call('1', 'sum', '[]')]],
    ['duplicate ids', [call('1'), call('1')]],
    ['invalid second call', [call('1'), call('2', 'not-selected')]],
    ['provider built-in', [{ id: '1', type: 'web_search', function: { name: 'sum', arguments: '{}' } }]],
  ])('rejects %s before invoking any tool', async (_label, calls) => {
    const adapter = await toolAdapter(async () => response(completion(calls, 'Do not treat this as final')))
    const invokeTool = vi.fn()
    await expect(adapter.executeModel({ prompt: 'p', tools, invokeTool })).rejects.toMatchObject({ code: 'MODEL_REQUEST_FAILED' })
    expect(invokeTool).not.toHaveBeenCalled()
  })

  it('does not accept unselected tool calls even when the response includes text', async () => {
    const adapter = await toolAdapter(async () => response(completion([call()], 'Some text')))
    await expect(adapter.executeModel({ prompt: 'p' })).rejects.toMatchObject({ code: 'MODEL_REQUEST_FAILED' })
  })

  it('rejects missing tool dispatcher before requesting the provider', async () => {
    const fetchImpl = vi.fn()
    const adapter = await toolAdapter(fetchImpl)
    await expect(adapter.executeModel({ tools })).rejects.toMatchObject({ code: 'MODEL_TOOLS_UNAVAILABLE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns deterministic tool failure to the model but propagates uncertain outcomes without retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(completion([call()]))).mockResolvedValueOnce(response(completion(undefined, 'Could not calculate')))
    const adapter = await toolAdapter(fetchImpl)
    await expect(adapter.executeModel({ tools, invokeTool: async () => ({ text: 'invalid input', isError: true }) })).resolves.toEqual({ outputText: 'Could not calculate' })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages.at(-1)).toMatchObject({ content: JSON.stringify({ isError: true, text: 'invalid input' }) })
    const uncertain = Object.assign(new Error('Unknown outcome'), { code: 'TOOL_OUTCOME_UNKNOWN' })
    const fetchUncertain = vi.fn(async () => response(completion([call()])))
    const next = await toolAdapter(fetchUncertain)
    await expect(next.executeModel({ tools, invokeTool: async () => { throw uncertain } })).rejects.toBe(uncertain)
    expect(fetchUncertain).toHaveBeenCalledTimes(1)
  })

  it('enforces call and round budgets before executing an excessive batch', async () => {
    let round = 0
    const invokeTool = vi.fn(async () => ({ text: 'ok' }))
    const adapter = await toolAdapter(async () => response(completion([call(String(++round))])))
    await expect(adapter.executeModel({ tools, invokeTool, maxToolRounds: 1 })).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
    expect(invokeTool).toHaveBeenCalledTimes(1)
    invokeTool.mockClear()
    const batch = await toolAdapter(async () => response(completion([call('1'), call('2')])))
    await expect(batch.executeModel({ tools, invokeTool, maxToolCalls: 1 })).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
    expect(invokeTool).not.toHaveBeenCalled()
  })

  it('rejects duplicate IDs across rounds and hard limit overrides', async () => {
    const invokeTool = vi.fn(async () => ({ text: 'ok' }))
    const adapter = await toolAdapter(async () => response(completion([call()])))
    await expect(adapter.executeModel({ tools, invokeTool })).rejects.toMatchObject({ code: 'MODEL_REQUEST_FAILED' })
    expect(invokeTool).toHaveBeenCalledTimes(1)
    for (const overrides of [{ maxToolCalls: 9 }, { maxToolRounds: 5 }, { maxToolCalls: -1 }]) {
      await expect(adapter.executeModel({ tools, invokeTool, ...overrides })).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
    }
  })

  it('fails explicitly on oversized provider, arguments, or tool output instead of truncating', async () => {
    const large = await toolAdapter(async () => response(completion(undefined, 'x'.repeat(1024 * 1024))))
    await expect(large.executeModel({})).rejects.toMatchObject({ code: 'MODEL_RESPONSE_LIMIT' })
    const args = await toolAdapter(async () => response(completion([call('1', 'sum', JSON.stringify({ x: 'x'.repeat(32768) }))])))
    const invokeTool = vi.fn(async () => ({ text: 'x'.repeat(65537) }))
    await expect(args.executeModel({ tools, invokeTool })).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
    expect(invokeTool).not.toHaveBeenCalled()
    const output = await toolAdapter(async () => response(completion([call()])))
    await expect(output.executeModel({ tools, invokeTool })).rejects.toMatchObject({ code: 'TOOL_LIMIT' })
  })

  it('stops before the next tool or request after cancellation, even if a dispatcher ignores the signal', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => response(completion([call('1'), call('2')])))
    const adapter = await toolAdapter(fetchImpl)
    const invokeTool = vi.fn(async () => { controller.abort(); return { text: 'late' } })
    await expect(adapter.executeModel({ tools, invokeTool, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeTool).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('times out a real stalled HTTP response and cancels the connection', async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const adapter = await toolAdapter(globalThis.fetch, { baseUrl: `http://127.0.0.1:${server.address().port}`, requestTimeoutMs: 40 })
      await expect(adapter.executeModel({})).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' })
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  })
})
