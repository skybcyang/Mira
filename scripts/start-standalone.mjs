import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createModelSettingsService } from '../bridge/model-settings.js'
import { startNodeRuntime } from '../bridge/node-runtime.js'

function parsePort(value) {
  const port = Number(value ?? 56300)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`MIRA_PORT must be an integer from 0 to 65535, received: ${value}`)
  }
  return port
}

function moduleSpecifier(value, workspaceRoot) {
  if (value.startsWith('file:')) return value
  if (value.startsWith('.') || value.startsWith('/')) {
    return pathToFileURL(resolve(workspaceRoot, value)).href
  }
  return value
}

async function loadModelAdapter(value, workspaceRoot) {
  if (!value) return {}
  const loaded = await import(moduleSpecifier(value, workspaceRoot))
  const adapter = loaded.default || loaded
  const executeModel =
    typeof adapter === 'function' ? adapter : adapter.executeModel || loaded.executeModel
  const executeSuggestion = adapter.executeSuggestion || loaded.executeSuggestion
  if (typeof executeModel !== 'function') {
    throw new Error(
      'MIRA_MODEL_ADAPTER must export executeModel(input) or a default function',
    )
  }
  if (executeSuggestion !== undefined && typeof executeSuggestion !== 'function') {
    throw new Error('MIRA_MODEL_ADAPTER executeSuggestion must be a function')
  }
  return { executeModel, executeSuggestion }
}

const workspaceRoot = resolve(process.env.MIRA_WORKSPACE_ROOT || process.cwd())
const staticRoot = process.env.MIRA_STATIC_ROOT
  ? resolve(process.env.MIRA_STATIC_ROOT)
  : resolve(workspaceRoot, 'dist')
const hostName = process.env.MIRA_HOST || '127.0.0.1'
const port = parsePort(process.env.MIRA_PORT)
const adapterSpecifier = process.env.MIRA_MODEL_ADAPTER
const builtInAdapter = pathToFileURL(
  resolve(workspaceRoot, 'bridge/openai-compatible-adapter.js'),
).href
const webSettingsEnabled =
  !adapterSpecifier || moduleSpecifier(adapterSpecifier, workspaceRoot) === builtInAdapter
const modelSettings = webSettingsEnabled
  ? createModelSettingsService({
      initial: {
        baseUrl: process.env.MIRA_LLM_BASE_URL,
        model: process.env.MIRA_LLM_MODEL,
        apiKey: process.env.MIRA_LLM_API_KEY,
      },
    })
  : undefined
const model = modelSettings
  ? {}
  : await loadModelAdapter(adapterSpecifier, workspaceRoot)
const runtime = await startNodeRuntime({
  workspaceRoot,
  staticRoot,
  host: hostName,
  port,
  hostOptions: {
    ...model,
    modelSettings,
  },
})
const { address } = runtime

console.log(`[mira] standalone server = ${address.url}/graphmind/`)
console.log(`[mira] workspace = ${workspaceRoot}`)
console.log(
  `[mira] model adapter = ${process.env.MIRA_MODEL_ADAPTER || 'none (generation disabled)'}`,
)

let closing
function shutdown(signal) {
  if (closing) return closing
  closing = runtime.close().then(() => {
    console.log(`[mira] stopped (${signal})`)
  })
  return closing
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
