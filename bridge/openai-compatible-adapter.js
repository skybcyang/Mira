import { typed } from './domain/errors.js'

function required(value, name) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function outputText(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

function providerError(status, data) {
  const message = String(data?.error?.message || `Model provider returned HTTP ${status}`)
  if (status === 401 || status === 403) return typed('MODEL_AUTH_FAILED', message)
  if (status === 429) return typed('RATE_LIMIT', message)
  if (status >= 500) return typed('MODEL_PROVIDER_UNAVAILABLE', message)
  return typed('MODEL_REQUEST_FAILED', message)
}

export function createOpenAICompatibleAdapter({
  baseUrl,
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
} = {}) {
  const endpoint = required(baseUrl, 'MIRA_LLM_BASE_URL').replace(/\/+$/, '')
  const modelId = required(model, 'MIRA_LLM_MODEL')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  const authorization = String(apiKey || '').trim()

  async function executeText({ prompt, signal, onProgress } = {}) {
    await onProgress?.({ phase: 'generating', label: '正在请求模型' })
    const response = await fetchImpl(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: String(prompt || '') }],
        stream: false,
      }),
      signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw providerError(response.status, data)
    const text = outputText(data)
    if (!text) throw typed('EMPTY_OUTPUT', '模型返回了空内容。')
    await onProgress?.({ phase: 'reviewing', label: '模型响应完成' })
    return text
  }

  return {
    async executeModel(input) {
      return { outputText: await executeText(input) }
    },
    executeSuggestion: executeText,
  }
}

export function createOpenAICompatibleAdapterFromEnv(
  env = globalThis.process?.env || {},
  options = {},
) {
  return createOpenAICompatibleAdapter({
    baseUrl: env.MIRA_LLM_BASE_URL,
    apiKey: env.MIRA_LLM_API_KEY,
    model: env.MIRA_LLM_MODEL,
    ...options,
  })
}

export async function executeModel(input) {
  return createOpenAICompatibleAdapterFromEnv().executeModel(input)
}

export async function executeSuggestion(input) {
  return createOpenAICompatibleAdapterFromEnv().executeSuggestion(input)
}

export default { executeModel, executeSuggestion }
