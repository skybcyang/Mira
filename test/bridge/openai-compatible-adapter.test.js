import { access } from 'node:fs/promises'
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
