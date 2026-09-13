import type { ExtractionItem } from '../domain/extraction.js'

export function exactItemCorrespondences(previous: ExtractionItem[] | null, current: ExtractionItem[]): Record<string, string> {
  const signature = (item: ExtractionItem) => JSON.stringify([item.title, item.markdown])
  const old = previous || []
  const result: Record<string, string> = {}
  for (const item of old) {
    const matches = current.filter(candidate => signature(candidate) === signature(item))
    if (matches.length === 1 && old.filter(candidate => signature(candidate) === signature(item)).length === 1) result[item.itemId] = matches[0].itemId
  }
  return result
}
