import { listGuidance, validateGuidance } from './guidance.js'
import { resolveOutputPolicy, validateOutputPolicy } from './outputPolicy.js'
import { sha256Text } from './digests.js'

const fail = message => { throw Object.assign(new Error(message), { code: 'EXECUTION_SETTINGS_INVALID' }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
export function emptyExecutionSettings() {
  return { schemaVersion: 1, revision: 0, defaultOutputPolicy: resolveOutputPolicy(undefined), guidance: [], disabledGuidanceIds: [] }
}
export function importGuidanceText(filename, text) {
  if (typeof filename !== 'string' || !/\.(md|txt)$/i.test(filename)
    || typeof text !== 'string' || !text.trim() || text.length > 20000 || /[\u0000\uFFFD]/.test(text)) fail('请选择非空的 UTF-8 Markdown 或文本文件，正文最多 20000 个字符。')
  return { title: filename.replace(/\.(md|txt)$/i, '').slice(0, 120).trim() || '导入指导', text, origin: 'imported' }
}
export function validateExecutionSettings(value) {
  if (!exact(value, ['schemaVersion', 'revision', 'defaultOutputPolicy', 'guidance', 'disabledGuidanceIds'])
    || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Object.hasOwn(value, 'defaultOutputPolicy') || !Array.isArray(value.guidance) || value.guidance.length > 200
    || !Array.isArray(value.disabledGuidanceIds)) fail('项目执行设置不完整或超过 200 个指导版本。')
  if (value.defaultOutputPolicy !== null) {
    validateOutputPolicy(value.defaultOutputPolicy)
    if (!value.defaultOutputPolicy || value.defaultOutputPolicy.format !== 'auto' || value.defaultOutputPolicy.maxCharacters !== undefined) fail('项目默认只设置表达风格，具体约束请在步骤中设置。')
  }
  const versions = new Map(), origins = new Map()
  for (const guide of value.guidance) {
    validateGuidance(guide)
    if (!guide || !/^guidance-[a-zA-Z0-9_-]+$/.test(guide.id) || !['custom', 'imported'].includes(guide.origin)
      || guide.customized || guide.version !== String((versions.get(guide.id) || 0) + 1)
      || (origins.has(guide.id) && origins.get(guide.id) !== guide.origin)) fail('指导目录身份、版本或来源无效。')
    versions.set(guide.id, Number(guide.version)); origins.set(guide.id, guide.origin)
  }
  if (new Set(value.disabledGuidanceIds).size !== value.disabledGuidanceIds.length
    || value.disabledGuidanceIds.some(id => !versions.has(id))) fail('停用指导列表无效。')
}
export function projectGuidance(settings, latestOnly = true) {
  const active = settings?.guidance.filter(item => !settings.disabledGuidanceIds.includes(item.id)) || []
  return latestOnly ? [...new Map(active.map(item => [item.id, item])).values()] : active
}
export function guidanceCatalog(settings) { return [...listGuidance(), ...projectGuidance(settings)] }
export function resolveStepOutput(input, settings) {
  return input === undefined && settings ? structuredClone(settings.defaultOutputPolicy) || undefined : resolveOutputPolicy(input)
}
export function updateExecutionSettings(current, input, newId) {
  validateExecutionSettings(current)
  if (!exact(input, ['baseRevision', 'defaultOutputPolicy', 'guidance', 'disabledGuidance'])
    || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0
    || ['defaultOutputPolicy', 'guidance', 'disabledGuidance'].filter(key => Object.hasOwn(input, key)).length !== 1) fail('请一次保存一种设置，并携带原始版本。')
  if (input.baseRevision !== current.revision) throw Object.assign(new Error('项目设置已在别处修改，请重新读取并核对草稿。'), { code: 'EXECUTION_SETTINGS_CONFLICT' })
  const next = structuredClone(current)
  if (Object.hasOwn(input, 'defaultOutputPolicy')) {
    if (input.defaultOutputPolicy === undefined) fail('请选择默认风格。')
    next.defaultOutputPolicy = resolveOutputPolicy(input.defaultOutputPolicy) || null
  } else if (input.guidance !== undefined) {
    const change = input.guidance
    if (!exact(change, ['id', 'title', 'text', 'origin']) || typeof change.title !== 'string' || typeof change.text !== 'string') fail('请填写指导名称与完整正文。')
    const previous = [...next.guidance].reverse().find(item => item.id === change.id)
    if (change.id !== undefined && !previous) fail('这个项目指导已不可用。')
    if (change.origin !== undefined && (!['custom', 'imported'].includes(change.origin) || (previous && change.origin !== previous.origin))) fail('指导来源不能被改写。')
    const guide = { id: previous?.id || newId('guidance'), version: String(Number(previous?.version || 0) + 1),
      title: change.title.trim(), text: change.text, digest: sha256Text(change.text), customized: false,
      origin: previous?.origin || change.origin || 'custom' }
    validateGuidance(guide)
    if (!previous || previous.title !== guide.title || previous.text !== guide.text) next.guidance.push(guide)
  } else {
    const change = input.disabledGuidance
    if (!exact(change, ['id', 'disabled']) || typeof change.disabled !== 'boolean' || !next.guidance.some(item => item.id === change.id)) fail('请选择项目指导及其可用状态。')
    next.disabledGuidanceIds = change.disabled ? [...new Set([...next.disabledGuidanceIds, change.id])] : next.disabledGuidanceIds.filter(id => id !== change.id)
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return current
  next.revision += 1
  validateExecutionSettings(next)
  return next
}
