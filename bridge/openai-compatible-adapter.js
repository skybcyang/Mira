import { typed } from './domain/errors.js'

const byteLength = (text) => new TextEncoder().encode(text).byteLength
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalidResponse = () => typed('MODEL_REQUEST_FAILED', '模型返回的工具请求无效；未执行该批请求。')

async function abortable(promise, signal) {
  signal?.throwIfAborted()
  if (!signal) return promise
  let onAbort
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })])
  } finally { signal.removeEventListener('abort', onAbort) }
}

async function readResponse(response, signal) {
  const reader = response.body?.getReader()
  if (!reader) throw typed('MODEL_REQUEST_FAILED', '模型响应缺少正文。')
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > 1024 * 1024) throw typed('MODEL_RESPONSE_LIMIT', '模型响应超过 1 MiB 上限。')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    try { return JSON.parse(text) } catch { return {} }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function toolDefinitions(tools, invokeTool) {
  if (tools === undefined) return []
  if (!Array.isArray(tools) || tools.length > 8) throw typed('TOOL_POLICY_INVALID', '工具目录无效。')
  if (tools.length && typeof invokeTool !== 'function') throw typed('MODEL_TOOLS_UNAVAILABLE', '当前宿主未提供工具调用。')
  const names = new Set()
  return tools.map((tool) => {
    if (!object(tool) || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)
      || names.has(tool.name) || typeof tool.description !== 'string' || !object(tool.inputSchema)) {
      throw typed('TOOL_POLICY_INVALID', '工具目录定义无效或名称重复。')
    }
    names.add(tool.name)
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }
  })
}

function parseToolCalls(calls, definitions, seenIds) {
  if (!Array.isArray(calls) || !calls.length) throw invalidResponse()
  const names = new Set(definitions.map(tool => tool.function.name))
  const batchIds = new Set()
  return calls.map((call) => {
    if (!object(call) || call.type !== 'function' || typeof call.id !== 'string' || !call.id.trim()
      || call.id.length > 256 || seenIds.has(call.id) || batchIds.has(call.id)
      || !object(call.function) || !names.has(call.function.name) || typeof call.function.arguments !== 'string') throw invalidResponse()
    if (byteLength(call.function.arguments) > 32768) throw typed('TOOL_LIMIT', '工具参数超过 32 KiB 上限。')
    let args
    try { args = JSON.parse(call.function.arguments) } catch { throw invalidResponse() }
    if (!object(args)) throw invalidResponse()
    batchIds.add(call.id)
    return { id: call.id, name: call.function.name, args, argumentText: call.function.arguments }
  })
}

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
  requestTimeoutMs = 60000,
} = {}) {
  const endpoint = required(baseUrl, 'MIRA_LLM_BASE_URL').replace(/\/+$/, '')
  const modelId = required(model, 'MIRA_LLM_MODEL')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  const authorization = String(apiKey || '').trim()
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60000) throw new Error('Model request timeout must be 1..60000 ms')

  async function request(messages, definitions, signal) {
    signal?.throwIfAborted()
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(typed('MODEL_TIMEOUT', '模型请求超时。')), requestTimeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
    try {
      const response = await abortable(fetchImpl(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: modelId, messages, stream: false, ...(definitions.length ? { tools: definitions } : {}) }),
        signal: requestSignal,
      }), requestSignal)
      const data = await readResponse(response, requestSignal)
      if (!response.ok) throw providerError(response.status, data)
      return data
    } catch (error) {
      if (requestSignal.aborted) throw requestSignal.reason
      throw error
    } finally { clearTimeout(timer) }
  }

  async function executeText({ prompt, signal, onProgress, tools, invokeTool, maxToolCalls = 8, maxToolRounds = 4 } = {}) {
    const definitions = toolDefinitions(tools, invokeTool)
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 0 || maxToolCalls > 8
      || !Number.isInteger(maxToolRounds) || maxToolRounds < 0 || maxToolRounds > 4) throw typed('TOOL_LIMIT', '工具调用预算无效。')
    const messages = [{ role: 'user', content: String(prompt || '') }]
    const seenIds = new Set()
    let rounds = 0
    signal?.throwIfAborted()
    await onProgress?.({ phase: 'generating', label: '正在请求模型' })
    while (true) {
      const data = await request(messages, definitions, signal)
      const choice = data?.choices?.[0]
      const message = choice?.message
      const hasToolCalls = message?.tool_calls != null && !(Array.isArray(message.tool_calls) && message.tool_calls.length === 0)
      if (hasToolCalls || choice?.finish_reason === 'tool_calls' || message?.function_call != null) {
        const calls = parseToolCalls(message?.tool_calls, definitions, seenIds)
        if (++rounds > maxToolRounds || seenIds.size + calls.length > maxToolCalls) throw typed('TOOL_LIMIT', '本次运行已达到工具调用上限。')
        // Kimi requires reasoning_content on subsequent tool rounds. It stays in this request's memory only.
        messages.push({ role: 'assistant', content: message.content ?? null,
          tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentText } })),
          ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}),
        })
        for (const call of calls) {
          signal?.throwIfAborted()
          seenIds.add(call.id)
          const result = await abortable(Promise.resolve().then(() => invokeTool(call.name, call.args)), signal)
          signal?.throwIfAborted()
          if (!object(result) || typeof result.text !== 'string' || (result.isError !== undefined && typeof result.isError !== 'boolean')) throw typed('TOOL_FAILED', '工具没有返回有效文本结果。')
          if (byteLength(result.text) > 65536) throw typed('TOOL_LIMIT', '工具结果超过 64 KiB 上限。')
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.isError ? JSON.stringify({ isError: true, text: result.text }) : result.text })
        }
        continue
      }
      const text = outputText(data)
      if (!text) throw typed('EMPTY_OUTPUT', '模型返回了空内容。')
      signal?.throwIfAborted()
      await onProgress?.({ phase: 'reviewing', label: '模型响应完成' })
      return text
    }
  }

  const executeModel = async (input) => ({ outputText: await executeText(input) })
  executeModel.supportsTools = true
  return {
    executeModel,
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
executeModel.supportsTools = true

export async function executeSuggestion(input) {
  return createOpenAICompatibleAdapterFromEnv().executeSuggestion(input)
}

export default { executeModel, executeSuggestion }
