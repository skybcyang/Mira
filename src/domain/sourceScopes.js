import { fromMarkdown } from 'mdast-util-from-markdown'
import { sha256Text } from './digests.js'

const hashPattern = /^sha256:[a-f0-9]{64}$/
const identifier = value => typeof value === 'string' && !!value.trim() && value.length <= 256
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = message => Object.assign(new Error(message), { code: 'SOURCE_SCOPE_INVALID' })

export async function contentDigest(text) {
  return sha256Text(text)
}

export function validateSpans(spans) {
  if (!Array.isArray(spans) || !spans.length || spans.length > 100) throw invalid('请选择 1 到 100 个片段。')
  const result = spans.map(span => {
    if (!record(span) || Object.keys(span).some(key => !['start', 'end'].includes(key))
      || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
      || span.start < 0 || span.start >= span.end || span.end > 1000000) throw invalid('片段范围无效。')
    return { start: span.start, end: span.end }
  })
  const sorted = [...result].sort((a, b) => a.start - b.start)
  if (sorted.some((span, index) => index > 0 && span.start < sorted[index - 1].end)) throw invalid('片段重复或重叠，请调整选择。')
  return result
}

export function validateSourceScopes(scopes, sourceCardIds) {
  if (scopes === undefined) return []
  if (!Array.isArray(scopes) || scopes.length > sourceCardIds.length) throw invalid('来源范围无效。')
  const byId = new Map()
  for (const scope of scopes) {
    if (!record(scope) || !identifier(scope.cardId) || !sourceCardIds.includes(scope.cardId) || byId.has(scope.cardId)) throw invalid('来源范围重复或不属于当前步骤。')
    const fields = scope.mode === 'required' ? ['cardId', 'mode'] : ['cardId', 'mode', 'versionId', 'contentDigest', 'spans']
    if (Object.keys(scope).some(key => !fields.includes(key))) throw invalid('来源范围含有无效字段。')
    if (scope.mode === 'required') byId.set(scope.cardId, { cardId: scope.cardId, mode: 'required' })
    else if (scope.mode === 'ranges' && identifier(scope.versionId) && hashPattern.test(scope.contentDigest)) {
      byId.set(scope.cardId, { cardId: scope.cardId, mode: 'ranges', versionId: scope.versionId, contentDigest: scope.contentDigest, spans: validateSpans(scope.spans) })
    } else throw invalid('来源范围需要有效版本与正文指纹。')
  }
  return sourceCardIds.flatMap(id => byId.has(id) ? [byId.get(id)] : [])
}

export function sameScope(left, right) {
  if (!left || !right) return !left && !right
  return left.mode === right.mode && left.versionId === right.versionId && left.contentDigest === right.contentDigest
    && JSON.stringify(left.spans) === JSON.stringify(right.spans)
}

export function assembleScopedText(text, spans) {
  if (typeof text !== 'string' || text.length > 1000000 || /[\u0000\uFFFD]/.test(text)) throw invalid('原文需要是可读取的文本，长度不超过 100 万字符。')
  const splitsSurrogate = offset => offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
  const lineAt = offset => 1 + (text.slice(0, offset).match(/\r\n|\r|\n/g) || []).length
    - (text[offset - 1] === '\r' && text[offset] === '\n' ? 1 : 0)
  const parts = validateSpans(spans).map(({ start, end }) => {
    if (end > text.length || splitsSurrogate(start) || splitsSurrogate(end) || !text.slice(start, end).trim()) throw invalid('片段为空、超出原文或切开了字符，请重新选择。')
    return { start, end, startLine: lineAt(start), endLine: lineAt(end - 1), text: text.slice(start, end) }
  })
  return {
    resolvedContent: parts.map((part, index) => `【片段 ${index + 1} · 原文第 ${part.startLine}–${part.endLine} 行】\n${part.text}`).join('\n\n'),
    lines: parts.map(({ startLine, endLine }) => ({ startLine, endLine })),
  }
}

export async function resolveSourceScope(text, scope, versionId, path) {
  if (scope.mode === 'required') throw Object.assign(new Error('请先选择输入范围，或明确改用全文。'), { code: 'SOURCE_SCOPE_REQUIRED' })
  if (scope.versionId !== versionId) throw Object.assign(new Error('原文版本已变化，请重新核对范围。'), { code: 'SOURCE_VERSION_CHANGED' })
  if (path !== undefined && !/\.(md|markdown|txt|csv|tsv|json|jsonl|yaml|yml|xml|html|htm|log|srt|vtt)$/i.test(path)) throw invalid('该文件格式尚不支持文本范围。')
  const result = assembleScopedText(text, scope.spans)
  if (await contentDigest(text) !== scope.contentDigest) throw Object.assign(new Error('原文已变化，请重新核对范围。'), { code: 'SOURCE_SCOPE_CHANGED' })
  return result
}

export function textChapters(text) {
  const label = node => node.value ?? node.children?.map(label).join('') ?? ''
  const chapters = fromMarkdown(text).children.filter(node => node.type === 'heading').map(node => ({
    title: label(node), level: node.depth, start: node.position.start.offset, end: text.length,
  }))
  return chapters.map((chapter, index) => ({ ...chapter,
    end: chapters.slice(index + 1).find(next => next.level <= chapter.level)?.start ?? text.length,
  }))
}

export function nativeSelectionSpan(text, start, end) {
  const offsets = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\r' && text[index + 1] === '\n') index++
    offsets.push(index + 1)
  }
  const span = { start: offsets[start], end: offsets[end] }
  assembleScopedText(text, [span])
  return span
}
