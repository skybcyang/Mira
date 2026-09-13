import { sha256Text } from './digests.js'

export const toolPhases = { before: '生成前', model: '模型按需', after: '生成后' }
export const toolError = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => { throw toolError('TOOL_POLICY_INVALID', message) }
export function validateToolJson(value) {
  let nodes = 0
  const path = new Set()
  function visit(v, depth) {
    if (++nodes > 20000 || depth > 24) invalid('工具数据结构超过复杂度上限。')
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return
    if (!v || typeof v !== 'object' || path.has(v) || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) invalid('工具数据必须是有限的 JSON。')
    path.add(v)
    for (const item of Object.values(v)) visit(item, depth + 1)
    path.delete(v)
  }
  visit(value, 0)
}
export const jsonBytes = value => { validateToolJson(value); return new TextEncoder().encode(JSON.stringify(value)).length }
export function canonicalToolJson(value) {
  validateToolJson(value)
  const normalize = v => Array.isArray(v) ? v.map(normalize) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])])) : v
  return JSON.stringify(normalize(value))
}
export function validateToolArgumentData(value) {
  if (!isObject(value) || jsonBytes(value) > 32768) invalid('工具参数必须是有界的 JSON 对象。')
  const secretKeys = new Set(['token', 'accesstoken', 'refreshtoken', 'apikey', 'password', 'passwd', 'authorization', 'auth', 'credential', 'credentials', 'secret', 'clientsecret', 'env'])
  function visit(v) {
    if (!v || typeof v !== 'object') return
    for (const [key, nested] of Object.entries(v)) {
      if (secretKeys.has(key.replace(/[^A-Za-z0-9]/g, '').toLowerCase())) invalid('认证与环境凭据不能写入工具参数，请使用连接的会话凭据。')
      visit(nested)
    }
  }
  visit(value)
}
export function validateToolSchema(value) {
  if (!isObject(value) || value.type !== 'object' || jsonBytes(value) > 16384) invalid('工具参数结构无效。')
  let nodes = 0
  const allowed = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'title', 'description', 'default', 'examples', '$schema']
  function visit(s, depth) {
    if (++nodes > 256 || depth > 8 || !keys(s, allowed)) invalid('工具参数结构不受支持：不接受正则、引用或过深的结构。')
    if (s.properties !== undefined) {
      if (!isObject(s.properties) || Object.keys(s.properties).length > 100) invalid('工具属性过多。')
      for (const nested of Object.values(s.properties)) visit(nested, depth + 1)
    }
    const types = Array.isArray(s.type) ? s.type : [s.type]
    if (s.type !== undefined && (!types.length || types.length > 7 || new Set(types).size !== types.length || types.some(t => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t)))) invalid('工具参数类型无效。')
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.length > 100 || new Set(s.required).size !== s.required.length || s.required.some(k => !text(k, 128)))) invalid('工具必填参数无效。')
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean' && !isObject(s.additionalProperties)) invalid('工具附加参数规则无效。')
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) if (s[k] !== undefined && (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || (k === 'multipleOf' && s[k] <= 0))) invalid('工具数值范围无效。')
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) if (s[k] !== undefined && (!Number.isSafeInteger(s[k]) || s[k] < 0)) invalid('工具长度范围无效。')
    for (const k of ['title', 'description']) if (s[k] !== undefined && typeof s[k] !== 'string') invalid('工具参数说明无效。')
    if (s.examples !== undefined && (!Array.isArray(s.examples) || s.examples.length > 10)) invalid('工具示例过多。')
    if (s.items !== undefined) visit(s.items, depth + 1)
    if (isObject(s.additionalProperties)) visit(s.additionalProperties, depth + 1)
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) if (s[keyword] !== undefined) {
      if (!Array.isArray(s[keyword]) || !s[keyword].length || s[keyword].length > 8) invalid('工具参数分支过多。')
      for (const nested of s[keyword]) visit(nested, depth + 1)
    }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 100)) invalid('工具枚举过多。')
    if (s.$schema !== undefined && !['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft-07/schema'].includes(s.$schema)) invalid('仅支持 JSON Schema draft-07 的有界子集。')
  }
  visit(value, 0)
}
export const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (v, n) => typeof v === 'string' && !!v.trim() && v.length <= n && !/[\0\uFFFD]/.test(v)
const digest = v => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v)
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const keys = (v, allowed) => isObject(v) && Object.keys(v).every(key => allowed.includes(key))
const schema = properties => ({ type: 'object', properties, additionalProperties: false })
const string = { type: 'string' }
export function toolDefinition(input) {
  const { version, requiresBinding, ...definition } = input
  return { ...definition, version: sha256Text(JSON.stringify(definition)), ...(requiresBinding ? { requiresBinding: true } : {}) }
}
const builtins = [
  { id: 'mira-source-search', title: '材料检索', description: '在本次冻结的来源片段中逐行检索，不补读其他正文。', inputSchema: { ...schema({ query: string }), required: ['query'] }, phases: ['before', 'model'], effect: 'read' },
  { id: 'mira-calculator', title: '数字运算', description: '对明确提供的数字做加、减、乘、除、平均或百分比运算。', inputSchema: { ...schema({ operation: { enum: ['sum', 'subtract', 'multiply', 'divide', 'mean', 'percent'] }, values: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 1000 } }), required: ['operation', 'values'] }, phases: ['before', 'model'], effect: 'read' },
  { id: 'mira-csv-summary', title: 'CSV 摘要', description: '汇总指定来源中的 CSV 行列与数值列，无法解析时明确失败。', inputSchema: { ...schema({ sourceIndex: { type: 'integer', minimum: 0 } }), required: ['sourceIndex'] }, phases: ['before', 'model'], effect: 'read' },
  { id: 'mira-web-read', title: '网页读取', description: '仅读取本步明确允许的公开 URL。', inputSchema: { ...schema({ url: string }), required: ['url'] }, phases: ['before', 'model'], effect: 'read' },
  { id: 'mira-output-check', title: '正文检查', description: '核对实际输出的字符数及必需文字，检查结果不改写正文。', inputSchema: schema({ maxCharacters: { type: 'integer', minimum: 1, maximum: 1000000 }, contains: { type: 'array', items: string, maxItems: 20 } }), phases: ['after'], effect: 'check' },
].map(item => toolDefinition({ ...item, source: 'builtin', name: item.id.replaceAll('-', '_') }))
export function listBuiltinTools() { return structuredClone(builtins) }
export function validateTool(value) {
  if (!keys(value, ['id', 'title', 'description', 'source', 'version', 'name', 'inputSchema', 'phases', 'effect', 'bindingId', 'bindingVersion', 'requiresBinding'])
    || !text(value.id, 160) || !text(value.title, 120) || !text(value.description, 4000) || !text(value.name, 128)
    || !['builtin', 'mcp', 'python'].includes(value.source) || !['read', 'review', 'check'].includes(value.effect)
    || !Array.isArray(value.phases) || !value.phases.length || new Set(value.phases).size !== value.phases.length || value.phases.some(p => !Object.hasOwn(toolPhases, p))
    || !isObject(value.inputSchema) || value.inputSchema.type !== 'object' || jsonBytes(value.inputSchema) > 16384
    || (value.requiresBinding !== undefined && value.requiresBinding !== true)
    || (value.source !== 'builtin' && !text(value.bindingId, 160) && !(value.requiresBinding && value.bindingId === undefined))
    || (value.bindingVersion !== undefined && !digest(value.bindingVersion))
    || (value.source === 'builtin' && (value.bindingId !== undefined || value.bindingVersion !== undefined))
    || value.version !== toolDefinition(value).version) invalid('工具定义不完整或版本摘要不匹配。')
  validateToolSchema(value.inputSchema)
  if (value.source === 'builtin' && !builtins.some(item => item.id === value.id && item.version === value.version)) invalid('内置工具版本不可识别。')
}
export function validateToolPolicy(value) {
  if (value === undefined) return
  if (!keys(value, ['tools', 'allowTemporaryPython']) || typeof value.allowTemporaryPython !== 'boolean' || !Array.isArray(value.tools) || value.tools.length > 8) invalid('每步最多选择 8 项工具。')
  const ids = new Set()
  for (const item of value.tools) {
    if (!keys(item, ['id', 'tool', 'phase', 'arguments', 'urls']) || !text(item.id, 160) || ids.has(item.id)) invalid('工具实例标识无效或重复。')
    ids.add(item.id); validateTool(item.tool)
    if (!item.tool.phases.includes(item.phase) || !isObject(item.arguments) || jsonBytes(item.arguments) > 32768) invalid('工具阶段或参数无效。')
    validateToolArgumentData(item.arguments)
    if (item.urls !== undefined && (!Array.isArray(item.urls) || item.urls.length > 20 || item.urls.some(url => { try { const u = new URL(url); return !['http:', 'https:'].includes(u.protocol) || !!u.username || !!u.password || url.length > 2048 } catch { return true } }))) invalid('请填写明确的公开网页地址。')
    if (item.tool.id === 'mira-web-read' && !item.tool.requiresBinding && !item.urls?.length) invalid('网页读取需要明确的 URL 范围。')
  }
}
export function portableToolPolicy(policy) {
  if (!policy) return undefined
  validateToolPolicy(policy)
  return { ...policy, tools: policy.tools.map(item => ({ ...structuredClone(item), tool: { ...item.tool, ...(item.tool.source !== 'builtin' ? { requiresBinding: true } : {}) } })) }
}
export function methodToolPolicy(policy) {
  if (!policy) return undefined
  validateToolPolicy(policy)
  return { allowTemporaryPython: false, tools: policy.tools.map(item => {
    const { bindingId, bindingVersion, ...requirement } = structuredClone(item.tool)
    return { id: item.id, tool: toolDefinition({ ...requirement, requiresBinding: true }), phase: item.phase, arguments: {} }
  }) }
}
export function validateMethodToolPolicy(value) {
  if (value === undefined) return
  validateToolPolicy(value)
  if (value.allowTemporaryPython || value.tools.some(t => !t.tool.requiresBinding || Object.keys(t.arguments).length || t.urls !== undefined || t.tool.bindingId !== undefined || t.tool.bindingVersion !== undefined)) invalid('方法只保存待绑定的能力需求。')
}
export function validateToolEvidence(run) {
  validateToolPolicy(run.toolPolicySnapshot)
  const configuration = item => {
    const config = run.toolPolicySnapshot?.tools.find(c => c.id === item.configId)
    if (item.configId === 'temporary-python' && run.toolPolicySnapshot?.allowTemporaryPython && item.version === '1' && item.title === '临时 Python') return { temporary: true }
    if (!config || config.tool.title !== item.title || config.tool.version !== item.version || (item.phase !== undefined && config.phase !== item.phase)) invalid('工具记录不匹配冻结配置。')
    if (config.tool.source === 'mcp' && canonicalToolJson(item.arguments) !== canonicalToolJson(config.arguments)) invalid('MCP 记录扩大了固定参数。')
    return config
  }
  if (run.toolExecutions !== undefined) {
    if (!Array.isArray(run.toolExecutions) || run.toolExecutions.length > 8 || jsonBytes(run.toolExecutions.map(item => isObject(item) ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'files')) : item)) > 524288) invalid('工具运行证据超过上限。')
    const ids = new Set()
    for (const item of run.toolExecutions) {
      if (!keys(item, ['id', 'configId', 'title', 'version', 'phase', 'status', 'arguments', 'startedAt', 'finishedAt', 'text', 'error', 'files', 'filesOmitted'])
        || !text(item.id, 160) || !text(item.configId, 160) || !text(item.title, 120) || !text(item.version, 100)
        || !toolPhases[item.phase] || !['started', 'succeeded', 'failed'].includes(item.status)
        || ids.has(item.id) || !isObject(item.arguments) || jsonBytes(item.arguments) > 32768 || !date(item.startedAt)
        || (item.status !== 'started' && (!date(item.finishedAt) || (item.text === undefined && item.error === undefined)))
        || (item.status === 'started' && ['finishedAt', 'text', 'error', 'files', 'filesOmitted'].some(k => item[k] !== undefined))
        || (item.status === 'succeeded' && (item.error !== undefined || item.text === undefined))
        || (item.filesOmitted !== undefined && item.filesOmitted !== true) || (item.files !== undefined && item.filesOmitted !== undefined)
        || (item.text !== undefined && (typeof item.text !== 'string' || jsonBytes(item.text) > 65536))
        || (item.error !== undefined && !text(item.error, 1000))) invalid('工具运行证据无效。')
      ids.add(item.id); const config = configuration(item)
      validateToolArgumentData(item.arguments)
      if (config.temporary && item.phase !== 'model') invalid('临时 Python 阶段无效。')
      if (item.files !== undefined) validateToolFiles(item.files)
    }
  }
  if (run.toolReview !== undefined) {
    const r = run.toolReview
    if (!keys(r, ['requestId', 'digest', 'configId', 'title', 'version', 'arguments', 'code', 'environment', 'expiresAt']) || !text(r.requestId, 160) || !text(r.digest, 100) || !text(r.configId, 160) || !text(r.title, 120) || !text(r.version, 100) || !isObject(r.arguments) || jsonBytes(r.arguments) > 32768 || !text(r.expiresAt, 64) || (r.code !== undefined && !text(r.code, 20000)) || (r.environment !== undefined && !text(r.environment, 1000))) invalid('工具审阅请求无效。')
    const { digest: requestDigest, ...request } = r
    validateToolArgumentData(r.arguments)
    if (run.status !== 'running' || !date(r.expiresAt) || requestDigest !== sha256Text(JSON.stringify({ runId: run.id, ...request }))) invalid('工具审阅摘要或运行状态无效。')
    const config = configuration(r)
    if (config.temporary && (r.code !== r.arguments.code || !/^sha256:[a-f0-9]{64} · /.test(r.environment || ''))) invalid('临时代码审阅必须冻结完整代码与环境。')
    if (!config.temporary && (config.tool.effect !== 'review' || r.code !== undefined || r.environment !== undefined)) invalid('该工具不接受此审阅请求。')
  }
}
export function validateToolFiles(files) {
  if (!Array.isArray(files) || files.length > 4) invalid('工具附件超过上限。')
  const names = new Set()
  for (const file of files) {
    if (!keys(file, ['name', 'mimeType', 'data']) || !text(file.name, 160) || !/^[^./\\:\x00-\x1f][^/\\:\x00-\x1f]*\.(png|csv|txt)$/i.test(file.name) || names.has(file.name.toLowerCase())
      || typeof file.data !== 'string' || file.data.length > 1398104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) invalid('工具附件无效。')
    names.add(file.name.toLowerCase())
    const extension = file.name.split('.').at(-1).toLowerCase()
    if ({ png: 'image/png', csv: 'text/csv', txt: 'text/plain' }[extension] !== file.mimeType) invalid('工具附件类型不匹配。')
    let bytes
    try { const binary = atob(file.data); if (binary.length > 1048576 || btoa(binary) !== file.data) invalid('工具附件大小或编码无效。'); bytes = Uint8Array.from(binary, c => c.charCodeAt(0)) } catch { invalid('工具附件编码无效。') }
    if (extension === 'png') { if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) invalid('PNG 附件内容无效。') }
    else { try { if (new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0')) invalid('文本附件内容无效。') } catch { invalid('文本附件内容无效。') } }
  }
}
export function portableToolEvidence(run) {
  const result = structuredClone(run)
  delete result.toolReview
  if (result.toolExecutions) result.toolExecutions = result.toolExecutions.map(({ files, ...item }) => ({ ...item, ...(files?.length ? { filesOmitted: true } : {}) }))
  return result
}
