import { sha256Text } from './digests.js'

export const toolPhases = { before: '生成前', model: '模型按需', after: '生成后' }
export const toolError = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => { throw toolError('TOOL_POLICY_INVALID', message) }
export const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length
export const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (v, n) => typeof v === 'string' && !!v.trim() && v.length <= n
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
    || !Array.isArray(value.phases) || !value.phases.length || value.phases.some(p => !toolPhases[p])
    || !isObject(value.inputSchema) || value.inputSchema.type !== 'object' || jsonBytes(value.inputSchema) > 16384
    || (value.requiresBinding !== undefined && value.requiresBinding !== true)
    || (value.source !== 'builtin' && !text(value.bindingId, 160))
    || value.version !== toolDefinition(value).version) invalid('工具定义不完整或版本摘要不匹配。')
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
  return { allowTemporaryPython: false, tools: policy.tools.map(item => ({ id: item.id, tool: { ...structuredClone(item.tool), requiresBinding: true }, phase: item.phase, arguments: {} })) }
}
export function validateToolEvidence(run) {
  validateToolPolicy(run.toolPolicySnapshot)
  if (run.toolExecutions !== undefined) {
    if (!Array.isArray(run.toolExecutions) || run.toolExecutions.length > 8 || jsonBytes(run.toolExecutions.map(({ files, ...item }) => item)) > 524288) invalid('工具运行证据超过上限。')
    for (const item of run.toolExecutions) {
      if (!keys(item, ['id', 'configId', 'title', 'version', 'phase', 'status', 'arguments', 'startedAt', 'finishedAt', 'text', 'error', 'files', 'filesOmitted'])
        || !text(item.id, 160) || !text(item.configId, 160) || !text(item.title, 120) || !text(item.version, 100)
        || !toolPhases[item.phase] || !['started', 'succeeded', 'failed'].includes(item.status)
        || !isObject(item.arguments) || jsonBytes(item.arguments) > 32768 || !text(item.startedAt, 64)
        || (item.text !== undefined && (typeof item.text !== 'string' || jsonBytes(item.text) > 65536))
        || (item.error !== undefined && !text(item.error, 1000))) invalid('工具运行证据无效。')
      if (item.files !== undefined && (!Array.isArray(item.files) || item.files.length > 4 || item.files.some(file => !keys(file, ['name', 'mimeType', 'data']) || !text(file.name, 160) || !['image/png', 'text/csv', 'text/plain'].includes(file.mimeType) || typeof file.data !== 'string' || file.data.length > 1398104 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)))) invalid('工具附件无效。')
    }
  }
  if (run.toolReview !== undefined) {
    const r = run.toolReview
    if (!keys(r, ['requestId', 'digest', 'configId', 'title', 'version', 'arguments', 'code', 'environment', 'expiresAt']) || !text(r.requestId, 160) || !text(r.digest, 100) || !text(r.configId, 160) || !text(r.title, 120) || !text(r.version, 100) || !isObject(r.arguments) || jsonBytes(r.arguments) > 32768 || !text(r.expiresAt, 64) || (r.code !== undefined && !text(r.code, 20000)) || (r.environment !== undefined && !text(r.environment, 1000))) invalid('工具审阅请求无效。')
  }
}
export function portableToolEvidence(run) {
  const result = structuredClone(run)
  delete result.toolReview
  if (result.toolExecutions) result.toolExecutions = result.toolExecutions.map(({ files, ...item }) => ({ ...item, ...(files?.length ? { filesOmitted: true } : {}) }))
  return result
}
