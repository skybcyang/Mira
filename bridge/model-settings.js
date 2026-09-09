import { createOpenAICompatibleAdapter } from './openai-compatible-adapter.js'

function normalize(value) {
  return String(value || '').trim()
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'MODEL_SETTINGS_INVALID' })
}

function unavailable() {
  return Object.assign(new Error('内容生成服务当前未配置'), {
    code: 'MODEL_UNAVAILABLE',
  })
}

function normalizeBaseUrl(value) {
  const normalized = normalize(value).replace(/\/+$/, '')
  if (!normalized) throw invalid('服务地址不能为空')
  let url
  try {
    url = new URL(normalized)
  } catch {
    throw invalid('服务地址必须是有效 URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw invalid('服务地址只支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) throw invalid('服务地址不能包含凭据')
  return normalized
}

function configured(input, current, { requireValues = true } = {}) {
  const baseUrl = normalize(input.baseUrl) || current.baseUrl
  const model = normalize(input.model) || current.model
  if (requireValues && !model) throw invalid('模型 ID 不能为空')
  return {
    baseUrl: requireValues || baseUrl ? normalizeBaseUrl(baseUrl) : '',
    model,
    apiKey: input.clearApiKey
      ? ''
      : normalize(input.apiKey) || current.apiKey,
  }
}

export function createModelSettingsService({
  initial = {},
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
} = {}) {
  let current = {
    baseUrl: normalize(initial.baseUrl).replace(/\/+$/, ''),
    model: normalize(initial.model),
    apiKey: normalize(initial.apiKey),
  }

  function get() {
    return {
      provider: 'openai-compatible',
      baseUrl: current.baseUrl,
      model: current.model,
      configured: Boolean(current.baseUrl && current.model),
      hasApiKey: Boolean(current.apiKey),
      scope: 'process',
    }
  }

  function update(input = {}) {
    current = configured(input, current)
    return get()
  }

  function adapter(settings = current) {
    if (!settings.baseUrl || !settings.model) throw unavailable()
    return createOpenAICompatibleAdapter({ ...settings, fetchImpl })
  }

  function resolveModel(input = {}) {
    const model = normalize(input.modelId) || current.model
    if (!current.baseUrl || !model) throw unavailable()
    return { provider: 'openai-compatible', model }
  }

  async function test(input = {}) {
    const draft = configured(input, current)
    const startedAt = clock()
    await adapter(draft).executeSuggestion({ prompt: 'Reply exactly MIRA_OK.' })
    return { ok: true, latencyMs: Math.max(0, clock() - startedAt) }
  }

  return {
    get,
    update,
    test,
    resolveModel,
    executeModel: async (input) => {
      const modelSnapshot = resolveModel({
        modelId: input?.modelSnapshot?.model || input?.modelId,
      })
      const result = await adapter({ ...current, model: modelSnapshot.model }).executeModel(input)
      return { ...result, modelSnapshot }
    },
    executeSuggestion: async (input) => adapter().executeSuggestion(input),
  }
}
