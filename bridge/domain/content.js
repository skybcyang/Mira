import { typed } from './errors.js'

export function isUsableContent(content) {
  return (
    (content?.kind === 'markdown' &&
      typeof content.markdown === 'string' &&
      content.markdown.trim().length > 0) ||
    (content?.kind === 'file-reference' &&
      typeof content.path === 'string' &&
      content.path.trim().length > 0 &&
      typeof content.readonly === 'boolean')
  )
}

export function normalizeContent(content) {
  if (content?.kind === 'markdown' && typeof content.markdown === 'string') {
    return { kind: 'markdown', markdown: content.markdown }
  }

  if (
    content?.kind === 'file-reference' &&
    typeof content.path === 'string' &&
    content.path.length > 0 &&
    typeof content.readonly === 'boolean'
  ) {
    return {
      kind: 'file-reference',
      path: content.path,
      readonly: content.readonly,
    }
  }

  throw typed('VERSION_CONTENT_INVALID', 'Card version content is invalid')
}

export function digestText(value) {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(value)

  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function digestContent(content) {
  const normalized = normalizeContent(content)
  if (normalized.kind === 'markdown') {
    return digestText(`markdown\0${normalized.markdown}`)
  }

  return digestText(
    `file-reference\0${normalized.path}\0${normalized.readonly ? '1' : '0'}`,
  )
}
