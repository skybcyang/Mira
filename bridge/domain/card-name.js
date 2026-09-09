import { typed } from './errors.js'

export function normalizeCardName(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 120 || /[\r\n\u0000-\u001f\u007f]/u.test(value)) {
    throw typed('BAD_REQUEST', '卡片名称需要 1–120 个字符，且不能换行。')
  }
  return value.trim()
}
