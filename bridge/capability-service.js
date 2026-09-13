import Ajv from 'ajv'
import { sha256Text } from '../src/domain/digests.js'
import { canonicalToolJson, isObject, jsonBytes, listBuiltinTools, toolDefinition, toolError, validateTool, validateToolArgumentData, validateToolFiles, validateToolSchema } from '../src/domain/toolPolicy.js'

const fail = (code, message) => { throw toolError(code, message) }
const imageId = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const string = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max && !v.includes('\0')
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false, ownProperties: true })
export function assertToolArguments(tool, args) {
  validateToolSchema(tool.inputSchema)
  validateToolArgumentData(args)
  let valid
  try { valid = ajv.compile(tool.inputSchema)(args) } catch { fail('TOOL_POLICY_INVALID', '工具参数结构不受支持，请重新发现或修改定义。') }
  finally { ajv.removeSchema(tool.inputSchema) }
  if (!valid) fail('TOOL_POLICY_INVALID', '工具参数不符合已选能力的结构。')
}
function validateSettings(s) {
  if (!isObject(s) || s.schemaVersion !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || Object.keys(s).some(k => !['schemaVersion', 'revision', 'connections', 'tools', 'scripts', 'enabled', 'pythonImageId'].includes(k))
    || !['connections', 'tools', 'scripts', 'enabled'].every(k => Array.isArray(s[k]) && s[k].length <= 200) || jsonBytes(s) > 4 * 1024 * 1024
    || (s.pythonImageId !== undefined && !imageId(s.pythonImageId))) fail('CAPABILITY_INVALID', '能力配置损坏或超过容量上限。')
  for (const t of s.tools) validateTool(t)
  for (const c of s.connections) validateConnection(c)
  const versions = new Map()
  for (const p of s.scripts) {
    if (!isObject(p) || Object.keys(p).some(k => !['id', 'title', 'code', 'digest', 'imageId', 'inputSchema', 'version'].includes(k)) || !string(p.id, 160) || !string(p.title, 120) || !string(p.code, 20000) || p.digest !== sha256Text(p.code) || !imageId(p.imageId) || !Number.isSafeInteger(p.version) || p.version !== (versions.get(p.id) || 0) + 1) fail('CAPABILITY_INVALID', '已登记脚本校验失败。')
    validateToolSchema(p.inputSchema); versions.set(p.id, p.version)
  }
  if (new Set(s.connections.map(c => c.id)).size !== s.connections.length || new Set(s.tools.map(t => t.id)).size !== s.tools.length || new Set(s.enabled).size !== s.enabled.length) fail('CAPABILITY_INVALID', '能力身份重复。')
  for (const t of s.tools) {
    if (t.requiresBinding || t.source === 'builtin') fail('CAPABILITY_INVALID', '目录工具必须有实际宿主绑定。')
    const binding = t.source === 'mcp' ? s.connections.find(c => c.id === t.bindingId) : [...s.scripts].reverse().find(p => p.id === t.bindingId)
    if (!binding || t.bindingVersion !== sha256Text(JSON.stringify(binding))) fail('CAPABILITY_INVALID', '工具绑定与目录不一致。')
  }
  if (s.enabled.some(id => !s.tools.some(t => t.id === id))) fail('CAPABILITY_INVALID', '已启用的工具不存在。')
}
function validateConnection(c) {
  if (!isObject(c) || Object.keys(c).some(k => !['id', 'title', 'transport', 'url', 'command', 'args', 'cwd', 'envNames', 'requiresCredential'].includes(k)) || !string(c.id, 160) || !string(c.title, 120)) fail('CAPABILITY_INVALID', '请填写连接名称。')
  if (c.requiresCredential !== undefined && typeof c.requiresCredential !== 'boolean') fail('CAPABILITY_INVALID', '凭据状态无效。')
  if (c.transport === 'http') {
    let url; try { url = new URL(c.url) } catch { fail('CAPABILITY_INVALID', 'MCP 地址无效。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) fail('CAPABILITY_INVALID', 'MCP 地址不应包含凭据。')
    if ([...url.searchParams.keys()].some(k => /token|secret|password|authorization|credential|api.?key/i.test(k)) || ['command', 'args', 'cwd'].some(k => c[k] !== undefined) || c.envNames?.length) fail('CAPABILITY_INVALID', '远程连接凭据请使用本次会话字段，不放入地址或本地程序设置。')
  } else if (c.transport === 'stdio') {
    if (!string(c.command, 4096) || !Array.isArray(c.args) || c.args.length > 40 || c.args.some(v => typeof v !== 'string' || v.length > 4096 || v.includes('\0')) || (c.cwd !== undefined && !string(c.cwd, 4096))) fail('CAPABILITY_INVALID', '请核对本地程序、参数及目录。')
    if (c.url !== undefined) fail('CAPABILITY_INVALID', '本地程序连接不接受远程地址。')
  } else fail('CAPABILITY_INVALID', '请选择 HTTP 或本地程序连接。')
  if (c.envNames !== undefined && (!Array.isArray(c.envNames) || c.envNames.length > 40 || new Set(c.envNames).size !== c.envNames.length || c.envNames.some(v => typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(v)))) fail('CAPABILITY_INVALID', '环境变量名称无效。')
}
export function createCapabilityService({ fs, coordinator, path = 'capability-settings-v1.json', newId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`, mcp, python } = {}) {
  const credentials = new Map()
  const credentialFor = c => { const entry = c && credentials.get(c.id); return entry?.bindingVersion === sha256Text(JSON.stringify(c)) ? entry.secret : undefined }
  let queue = Promise.resolve()
  function assertSafeEvidence(value, extraSecret) {
    if (value === undefined) return
    const serialized = canonicalToolJson(value)
    for (const secret of [...credentials.values()].map(entry => entry.secret).concat(extraSecret ? [extraSecret] : [])) {
      for (const text of [secret.token, ...Object.values(secret.env || {})].filter(v => typeof v === 'string' && v.length)) {
        const encoded = JSON.stringify(text).slice(1, -1)
        if (serialized.includes(encoded)) fail('TOOL_POLICY_INVALID', '工具数据含有会话凭据，已停止且不会保存。')
      }
    }
  }
  async function safeOperation(operation, secret) {
    try { const result = await operation(); assertSafeEvidence(result, secret); if (result?.files !== undefined) validateToolFiles(result.files); return result }
    catch (error) { assertSafeEvidence({ message: String(error.message || '') }, secret); throw error }
  }
  async function load() {
    let value
    try { value = await fs.readText(path) } catch (e) { if (e.code === 'ENOENT') return { schemaVersion: 1, revision: 0, connections: [], tools: [], scripts: [], enabled: [] }; throw toolError('CAPABILITY_READ_FAILED', '无法读取能力配置。') }
    try { const state = JSON.parse(value); validateSettings(state); return state } catch { fail('CAPABILITY_INVALID', '能力配置损坏，请从可信副本恢复。') }
  }
  const publicSettings = s => ({ ...s, connections: s.connections.map(c => ({ ...c, hasCredential: !!credentialFor(c) })) })
  async function get() { return { settings: publicSettings(await load()), builtins: listBuiltinTools(), runtime: { mcp: !!mcp, python: !!python } } }
  function mutate(baseRevision, operation) {
    const task = queue.then(() => coordinator.withMutation(async () => {
      const current = await load()
      if (baseRevision !== current.revision) fail('CAPABILITY_CONFLICT', '能力配置已变化，请保留草稿并重新载入。')
      const next = await operation(structuredClone(current)); next.revision++
      validateSettings(next)
      assertSafeEvidence(next)
      try {
        await fs.writeText(`${path}.tmp`, JSON.stringify(next, null, 2))
        const verified = JSON.parse(await fs.readText(`${path}.tmp`)); validateSettings(verified)
        if (JSON.stringify(verified) !== JSON.stringify(next)) throw Error('changed')
        await fs.replace(`${path}.tmp`, path)
      } catch { fail('CAPABILITY_WRITE_FAILED', '能力配置未确认保存，请保留草稿。') }
      return { settings: publicSettings(next) }
    }))
    queue = task.catch(() => {}); return task
  }
  async function connect(input, { signal } = {}) {
    if (!mcp) fail('MCP_UNAVAILABLE', '此宿主未提供 MCP。')
    if (!isObject(input) || Object.keys(input).some(k => !['baseRevision', 'connection', 'credential'].includes(k))) fail('CAPABILITY_INVALID', '连接设置无效。')
    const source = input.connection || {}, credential = input.credential || {}
    if (!isObject(credential) || Object.keys(credential).some(k => !['token', 'env'].includes(k)) || jsonBytes(credential) > 32768 || (credential.token !== undefined && !string(credential.token, 8192)) || (credential.env !== undefined && (!isObject(credential.env) || Object.values(credential.env).some(v => typeof v !== 'string' || v.includes('\0'))))) fail('CAPABILITY_INVALID', '会话凭据无效。')
    const current = await load()
    if (current.revision !== input.baseRevision) fail('CAPABILITY_CONFLICT', '连接草稿已过期，请重新核对。')
    const previous = current.connections.find(c => c.id === source.id)
    const destination = c => canonicalToolJson(Object.fromEntries(['transport', 'url', 'command', 'args', 'cwd'].filter(k => c[k] !== undefined).map(k => [k, c[k]])))
    const unchanged = previous && destination(previous) === destination(source)
    if (previous?.requiresCredential && !unchanged && !Object.hasOwn(input, 'credential')) fail('MCP_AUTH_REQUIRED', '连接目标已变化，请重新填写或明确清空会话凭据。')
    const secret = Object.hasOwn(input, 'credential') ? structuredClone(credential) : unchanged ? credentialFor(previous) || {} : {}
    const connection = { ...source, id: source.id || newId('mcp'), requiresCredential: !!(secret.token || Object.keys(secret.env || {}).length || (!Object.hasOwn(input, 'credential') && source.requiresCredential)), envNames: Object.hasOwn(input, 'credential') ? Object.keys(secret.env || {}) : unchanged ? previous.envNames || [] : source.envNames || [] }
    delete connection.hasCredential
    validateConnection(connection)
    assertSafeEvidence(connection, secret)
    const found = await safeOperation(() => mcp.discover({ ...connection, ...secret }, { signal }), secret)
    if (!Array.isArray(found.tools) || found.tools.length > 100) fail('MCP_INCOMPATIBLE', '工具目录超过支持范围。')
    const result = await mutate(input.baseRevision, s => {
      s.connections = [...s.connections.filter(c => c.id !== connection.id), connection]
      s.tools = s.tools.filter(t => t.bindingId !== connection.id)
      for (const t of found.tools) s.tools.push(toolDefinition({ id: `${connection.id}:${t.name}`, name: t.name, title: t.name.slice(0, 120), description: t.description || t.name, source: 'mcp', inputSchema: t.inputSchema, phases: ['before', 'model', 'after'], effect: 'review', bindingId: connection.id, bindingVersion: sha256Text(JSON.stringify(connection)) }))
      s.enabled = s.enabled.filter(id => s.tools.some(t => t.id === id && t.bindingId !== connection.id))
      return s
    })
    credentials.delete(connection.id)
    if (secret.token || Object.keys(secret.env || {}).length) credentials.set(connection.id, { secret, bindingVersion: sha256Text(JSON.stringify(connection)) })
    return { ...result, settings: publicSettings(await load()) }
  }
  async function update(input) {
    const result = await mutate(input.baseRevision, s => {
      if (Object.keys(input).some(k => !['baseRevision', 'tool', 'script', 'removeConnection', 'pythonImageId'].includes(k))) fail('CAPABILITY_INVALID', '未知能力设置。')
      if (input.removeConnection) {
        s.connections = s.connections.filter(c => c.id !== input.removeConnection)
        s.tools = s.tools.filter(t => t.bindingId !== input.removeConnection)
        s.enabled = s.enabled.filter(id => s.tools.some(t => t.id === id))
      }
      if (input.tool) {
        const { id, enabled, readOnly } = input.tool
        if (!isObject(input.tool) || Object.keys(input.tool).some(k => !['id', 'enabled', 'readOnly'].includes(k)) || (readOnly !== undefined && typeof readOnly !== 'boolean')) fail('CAPABILITY_INVALID', '工具设置无效。')
        const t = s.tools.find(t => t.id === id)
        if (!t || typeof enabled !== 'boolean') fail('TOOL_UNAVAILABLE', '所选能力已不存在。')
        if (readOnly !== undefined && t.source === 'mcp') s.tools = s.tools.map(x => x.id === id ? toolDefinition({ ...x, effect: readOnly ? 'read' : 'review' }) : x)
        s.enabled = [...s.enabled.filter(x => x !== id), ...(enabled ? [id] : [])]
      }
      if (input.pythonImageId !== undefined) { if (!imageId(input.pythonImageId)) fail('CAPABILITY_INVALID', 'Python 环境必须使用完整镜像 ID。'); s.pythonImageId = input.pythonImageId }
      if (input.script) {
        const p = input.script, previous = [...s.scripts].reverse().find(x => x.id === p.id)
        if (p.id && !previous) fail('CAPABILITY_INVALID', '脚本标识不存在。')
        if (!string(p.title, 120) || !string(p.code, 20000) || !imageId(p.imageId) || !isObject(p.inputSchema) || p.inputSchema.type !== 'object' || jsonBytes(p.inputSchema) > 16384) fail('CAPABILITY_INVALID', '请核对脚本全文、参数结构与隔离环境。')
        validateToolSchema(p.inputSchema)
        try { ajv.compile(p.inputSchema) } catch { fail('CAPABILITY_INVALID', '脚本参数结构无效。') } finally { ajv.removeSchema(p.inputSchema) }
        const script = { id: previous?.id || newId('python'), title: p.title, code: p.code, digest: sha256Text(p.code), imageId: p.imageId, inputSchema: p.inputSchema, version: (previous?.version || 0) + 1 }
        s.scripts.push(script)
        s.tools = [...s.tools.filter(t => t.bindingId !== script.id), toolDefinition({ id: script.id, title: script.title, description: '已审阅的隔离 Python 脚本；仅接收本次冻结输入。', source: 'python', name: script.id.replaceAll('-', '_'), inputSchema: script.inputSchema, phases: ['before', 'model', 'after'], effect: 'read', bindingId: script.id, bindingVersion: sha256Text(JSON.stringify(script)) })]
        s.enabled = s.enabled.filter(id => id !== script.id)
      }
      return s
    })
    if (input.removeConnection) credentials.delete(input.removeConnection)
    return result
  }
  async function resolve(tool) {
    validateTool(tool)
    if (tool.requiresBinding) fail('TOOL_UNAVAILABLE', '此步骤需重新选择并绑定工具。')
    if (tool.source === 'builtin') return { tool }
    const s = await load(), current = s.tools.find(t => t.id === tool.id)
    if (!current || !s.enabled.includes(tool.id)) fail('TOOL_UNAVAILABLE', '工具尚未在项目中启用或已断开。')
    if (current.version !== tool.version) fail('TOOL_CHANGED', '工具定义已变化，请核对后重新选择。')
    if (tool.source === 'mcp') {
      if (!mcp) fail('MCP_UNAVAILABLE', '此宿主未提供 MCP。')
      const c = s.connections.find(c => c.id === tool.bindingId), secret = credentialFor(c)
      if (!c) fail('TOOL_UNAVAILABLE', '连接不存在。')
      if (c.requiresCredential && !secret) fail('MCP_AUTH_REQUIRED', '请在能力管理重新填写本次会话凭据。')
      return { tool: current, connection: { ...c, ...secret } }
    }
    const script = [...s.scripts].reverse().find(p => p.id === tool.bindingId)
    if (!python || !script) fail('PYTHON_UNAVAILABLE', 'Python 环境或脚本不可用。')
    const state = await python.status({ image: script.imageId })
    if (!state.available || state.imageId !== script.imageId) fail('PYTHON_UNAVAILABLE', state.reason || '隔离环境不可用。')
    return { tool: current, script }
  }
  async function call(tool, args, input, { signal } = {}) {
    assertSafeEvidence(args)
    const binding = await resolve(tool)
    assertToolArguments(tool, args)
    if (tool.source === 'mcp') {
      // A fresh handshake checks schema drift before any business request.
      const found = await safeOperation(() => mcp.discover(binding.connection, { signal }), binding.connection)
      const definition = found.tools.find(t => t.name === tool.name)
      if (!definition || canonicalToolJson(definition.inputSchema) !== canonicalToolJson(tool.inputSchema) || (definition.description || definition.name) !== tool.description) fail('TOOL_CHANGED', 'MCP 工具结构已变化，请重新发现并绑定。')
      return safeOperation(() => mcp.call(binding.connection, tool.name, args, { signal }), binding.connection)
    }
    return safeOperation(() => python.execute({ code: binding.script.code, imageId: binding.script.imageId, input: { ...input, arguments: args } }, { signal }))
  }
  async function pythonStatus({ image } = {}) {
    if (image !== undefined && !imageId(image)) fail('CAPABILITY_INVALID', '请选择完整的 Python 镜像 ID。')
    const s = await load(), selected = image || s.pythonImageId
    if (!python || !selected) return { available: false, reason: !python ? '此宿主未提供隔离 Python。' : '请先准备并选择隔离 Python 环境。' }
    const state = await python.status({ image: selected })
    return state.available && state.imageId !== selected ? { available: false, reason: '实际 Python 环境与所选镜像不匹配。' } : state
  }
  async function preparePython(input, options) {
    if (!python) fail('PYTHON_UNAVAILABLE', '此宿主未提供隔离 Python。')
    if ((await load()).revision !== input.baseRevision) fail('CAPABILITY_CONFLICT', '能力设置已变化，请重新核对。')
    const result = await python.prepare({ image: input.image, dependencies: input.dependencies }, options)
    if (!result.available || !imageId(result.imageId)) fail('PYTHON_UNAVAILABLE', result.reason || '隔离 Python 准备未通过。')
    await update({ baseRevision: input.baseRevision, pythonImageId: result.imageId })
    return { ...await get(), python: result }
  }
  async function testPython(input, options) {
    if (!python) fail('PYTHON_UNAVAILABLE', '此宿主未提供隔离 Python。')
    if (!string(input.code, 20000) || !imageId(input.imageId) || !isObject(input.arguments || {})) fail('CAPABILITY_INVALID', '请核对待测试脚本。')
    assertSafeEvidence(input)
    return safeOperation(() => python.execute({ code: input.code, imageId: input.imageId, input: { sources: [], arguments: input.arguments || {} } }, options))
  }
  async function temporaryPython(code, input, options) {
    const s = await load(); if (!python || !s.pythonImageId) fail('PYTHON_UNAVAILABLE', '请先准备隔离 Python 环境。')
    if (!imageId(options?.imageId) || s.pythonImageId !== options.imageId) fail('TOOL_CHANGED', 'Python 环境已变化，原审阅已失效。')
    assertSafeEvidence({ code, input })
    return safeOperation(() => python.execute({ code, input, imageId: options.imageId }, options))
  }
  return { get, connect, update, resolve, call, pythonStatus, preparePython, testPython, temporaryPython, assertSafeEvidence, close: () => { credentials.clear(); return mcp?.close() } }
}
