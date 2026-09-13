import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { sha256Text } from './digests.js'
import { extractionRequirement } from './extraction.js'

const invalid = message => Object.assign(new Error(message), { code: 'OUTPUT_POLICY_INVALID' })
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max
export const outputFormats = Object.freeze({ auto: '跟随任务要求', paragraphs: '段落', list: '条目清单', table: '表格' })
const catalog = [
  { id: 'concise', title: '卡片简洁', text: '直接表达核心结论，使用短句和短段落，省略寒暄、重复总结和无必要的过程说明。保留事实、限定、不确定性和必要出处。用户明确要求的结构、长度与细节优先。' },
  { id: 'balanced', title: '均衡表达', text: '先给结论，再给足够的解释与依据。保留关键条件和不同观点，避免重复。用户明确要求的结构、长度与细节优先。' },
  { id: 'detailed', title: '详细展开', text: '围绕用户的问题充分展开，说明条件、依据、差异与不确定性。完整不等于重复，避免无关扩展。用户明确要求的结构、长度与细节优先。' },
].map(item => Object.freeze({ ...item, version: '1.0.0', digest: sha256Text(item.text), customized: false, format: 'auto' }))

export function listOutputPolicies() { return catalog.map(item => ({ ...item })) }

function validateConstraints(value) {
  if (!Object.hasOwn(outputFormats, value.format)
    || (value.maxCharacters !== undefined && (!Number.isSafeInteger(value.maxCharacters) || value.maxCharacters < 1 || value.maxCharacters > 100000))) {
    throw invalid('请选择正文结构，字符上限需为 1 到 100000 的整数。')
  }
}

export function validateOutputPolicy(value, instruction) {
  if (value === undefined) return
  if (!object(value) || Object.keys(value).some(key => !['id', 'version', 'title', 'text', 'digest', 'customized', 'format', 'maxCharacters'].includes(key))
    || !text(value.id, 128) || !text(value.version, 64) || !text(value.title, 120)
    || !text(value.text, 20000) || /[\u0000\uFFFD]/.test(value.text)
    || typeof value.customized !== 'boolean' || value.digest !== sha256Text(value.text)) {
    throw invalid('输出规则快照不完整或正文校验失败。')
  }
  validateConstraints(value)
  if (typeof instruction === 'string' && extractionRequirement(instruction) !== null && value.format !== 'auto') {
    throw invalid('提取步骤的正文结构由提取格式确定，请选择跟随任务要求。')
  }
}

export function resolveOutputPolicy(input) {
  if (input === null) return undefined
  if (input === undefined) return { ...catalog[0] }
  if (!object(input) || Object.keys(input).some(key => !['id', 'version', 'text', 'format', 'maxCharacters'].includes(key))
    || !text(input.id, 128) || !text(input.version, 64)) throw invalid('请选择输出规则及其版本。')
  const entry = catalog.find(item => item.id === input.id && item.version === input.version)
  if (!entry) throw Object.assign(new Error('所选输出规则版本不可用，请重新核对。'), { code: 'OUTPUT_POLICY_UNAVAILABLE' })
  const actualText = input.text === undefined ? entry.text : input.text
  if (!text(actualText, 20000)) throw invalid('输出规则需要 1 到 20000 个字符。')
  const policy = { ...entry, text: actualText, digest: sha256Text(actualText), customized: actualText !== entry.text,
    format: input.format === undefined ? 'auto' : input.format,
    ...(input.maxCharacters === undefined ? {} : { maxCharacters: input.maxCharacters }) }
  validateOutputPolicy(policy)
  return policy
}

export function outputPolicyPrompt(policy) {
  if (!policy) return []
  return [
    `# 输出表达：${policy.title}\n${policy.text}\n默认表达偏好不能覆盖用户的具体任务、显式约束或必要提取协议。`,
    ...(policy.maxCharacters === undefined ? [] : [`# 字符上限\n完整成果正文不得超过 ${policy.maxCharacters} 个 Unicode 码点，包含标题、标点、引文和空白。`]),
    ...(policy.format === 'auto' ? [] : [`# 正文结构\n使用${outputFormats[policy.format]}，可加必要标题，不附其他结构的开场或结尾。`]),
  ]
}

export function checkOutput(output, policy) {
  if (!policy) return undefined
  const characters = [...output].length
  const check = { version: '1', characters, format: policy.format,
    ...(policy.maxCharacters === undefined ? {} : { maxCharacters: policy.maxCharacters, lengthPassed: characters <= policy.maxCharacters }) }
  if (policy.format !== 'auto') {
    const tree = fromMarkdown(output, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] })
    const required = { paragraphs: 'paragraph', list: 'list', table: 'table' }[policy.format]
    check.formatPassed = tree.children.some(node => node.type === required)
      && tree.children.every(node => node.type === 'heading' || node.type === required)
      && tree.children.filter(node => node.type === required).every(node =>
        node.type === 'table' ? node.children.length > 1
          : node.type === 'list' ? node.children.some(item => item.children.length > 0)
            : node.children.length > 0)
  }
  return check
}

export function validateOutputCheck(value, output, policy) {
  if (value === undefined) return
  if (!object(value) || typeof output !== 'string' || !policy) throw invalid('输出检查缺少实际正文或冻结规则。')
  const expected = checkOutput(output, policy)
  if (Object.keys(value).length !== Object.keys(expected).length
    || Object.keys(value).some(key => !Object.hasOwn(expected, key) || value[key] !== expected[key])) throw invalid('输出检查与实际正文或规则不一致。')
}
