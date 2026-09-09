import { describe, expect, it, vi } from 'vitest'
import { createModelSettingsService } from '../../bridge/model-settings.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('model settings service', () => {
  it('redacts the key and applies an updated OpenAI-compatible configuration', async () => {
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: '# 新成果' } }],
    }))
    const service = createModelSettingsService({
      initial: {
        baseUrl: 'https://old.example/v1',
        model: 'old-model',
        apiKey: 'old-secret',
      },
      fetchImpl,
    })

    expect(service.get()).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://old.example/v1',
      model: 'old-model',
      configured: true,
      hasApiKey: true,
      scope: 'process',
    })
    expect(JSON.stringify(service.get())).not.toContain('old-secret')

    expect(service.update({
      baseUrl: 'https://new.example/v1/',
      model: 'new-model',
      apiKey: 'new-secret',
    })).toMatchObject({
      baseUrl: 'https://new.example/v1',
      model: 'new-model',
      hasApiKey: true,
    })

    await expect(service.executeModel({ prompt: '生成正文' }))
      .resolves.toEqual({
        outputText: '# 新成果',
        modelSnapshot: { provider: 'openai-compatible', model: 'new-model' },
      })
    await expect(service.executeSuggestion({ prompt: '生成建议' }))
      .resolves.toBe('# 新成果')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://new.example/v1/chat/completions',
      expect.objectContaining({
        headers: {
          authorization: 'Bearer new-secret',
          'content-type': 'application/json',
        },
      }),
    )
  })

  it('tests draft settings without saving them and never exposes the key', async () => {
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: 'MIRA_OK' } }],
    }))
    const service = createModelSettingsService({
      initial: {
        baseUrl: 'https://saved.example/v1',
        model: 'saved-model',
        apiKey: 'saved-secret',
      },
      fetchImpl,
      clock: () => 120,
    })

    await expect(service.test({
      baseUrl: 'https://draft.example/v1',
      model: 'draft-model',
      apiKey: 'draft-secret',
    })).resolves.toEqual({ ok: true, latencyMs: 0 })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://draft.example/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer draft-secret' }),
      }),
    )
    expect(service.get()).toMatchObject({
      baseUrl: 'https://saved.example/v1',
      model: 'saved-model',
      hasApiKey: true,
    })
    expect(JSON.stringify(await service.test({}))).not.toContain('saved-secret')
  })

  it('validates remote URLs and supports explicitly clearing the current key', () => {
    const service = createModelSettingsService({
      initial: {
        baseUrl: 'https://llm.example/v1',
        model: 'model',
        apiKey: 'secret',
      },
    })

    expect(() => service.update({
      baseUrl: 'file:///tmp/model',
      model: 'model',
    })).toThrowError(expect.objectContaining({ code: 'MODEL_SETTINGS_INVALID' }))

    expect(service.update({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      clearApiKey: true,
    })).toMatchObject({ hasApiKey: false })
  })

  it('preserves the explicit unavailable error before any model is configured', async () => {
    const service = createModelSettingsService()

    expect(service.get()).toMatchObject({ configured: false, hasApiKey: false })
    await expect(service.executeModel({ prompt: '生成正文' })).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    })
  })

  it('executes with a per-transformation model override and reports the actual model', async () => {
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: '# 深度结果' } }],
    }))
    const service = createModelSettingsService({
      initial: {
        baseUrl: 'https://models.example/v1',
        model: 'default-model',
        apiKey: 'secret',
      },
      fetchImpl,
    })

    await expect(service.executeModel({ prompt: '深入推理', modelId: 'reasoning-model' }))
      .resolves.toEqual({
        outputText: '# 深度结果',
        modelSnapshot: { provider: 'openai-compatible', model: 'reasoning-model' },
      })
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.model).toBe('reasoning-model')
    expect(service.get().model).toBe('default-model')
  })
})
