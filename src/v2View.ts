import type { ContentCard, CardVersion } from './domain'
import type { V2Suggestion } from './v2Api'

export function headVersion(card: ContentCard): CardVersion | undefined {
  return card.versions.find((version) => version.id === card.headVersionId)
}

export function markdownFor(card: ContentCard): string {
  const content = headVersion(card)?.content
  return content?.kind === 'markdown' ? content.markdown : ''
}

export function cardSummary(card: ContentCard): { title: string; preview: string } {
  const markdown = markdownFor(card)
  const lines = markdown
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/[*_`>~-]/g, '').trim())
    .filter(Boolean)
  return {
    title: card.name || lines[0] || (card.contentKind === 'file-reference' ? '文件材料' : '未命名内容'),
    preview: lines.slice(1).join(' '),
  }
}

export interface CanvasCardTags {
  visible: string[]
  overflow: number
  accessibleLabel?: string
}

export function canvasCardTags(tags: string[] = [], limit = 2): CanvasCardTags {
  const visible = tags.slice(0, Math.max(0, limit))
  return {
    visible,
    overflow: Math.max(0, tags.length - visible.length),
    accessibleLabel: tags.length > 0 ? `标签：${tags.join('、')}` : undefined,
  }
}

export interface SourceCardPresentation {
  cardId: string
  label: string
  fullPath?: string
}

function normalizeDisplayPath(path: string): string {
  const slashPath = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!slashPath) return ''
  const absolute = slashPath.startsWith('/')
  const segments: string[] = []
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else if (!absolute) segments.push(segment)
      continue
    }
    segments.push(segment)
  }
  const normalized = segments.join('/')
  return absolute ? `/${normalized}` : normalized
}

function usableBasename(path: string): string | null {
  const segments = path.split('/').filter(Boolean)
  const basename = segments[segments.length - 1]
  return basename && basename !== '.' && basename !== '..' ? basename : null
}

export function sourceCardPresentations(cards: ContentCard[]): SourceCardPresentation[] {
  const presentations = cards.map((card) => {
    const content = headVersion(card)?.content
    if (content?.kind !== 'file-reference') {
      return { cardId: card.id, label: cardSummary(card).title }
    }
    const fullPath = normalizeDisplayPath(content.path)
    return {
      cardId: card.id,
      label: card.name || usableBasename(fullPath) || fullPath || '文件材料',
      ...(fullPath ? { fullPath } : {}),
    }
  })

  const duplicateGroups = new Map<string, number[]>()
  presentations.forEach((presentation, index) => {
    if (cards[index].name) return
    if (!presentation.fullPath || !usableBasename(presentation.fullPath)) return
    const indexes = duplicateGroups.get(presentation.label) || []
    indexes.push(index)
    duplicateGroups.set(presentation.label, indexes)
  })

  for (const indexes of duplicateGroups.values()) {
    if (indexes.length < 2) continue
    const depths = new Map(indexes.map((index) => [index, 1]))
    const suffix = (index: number) => {
      const segments = presentations[index].fullPath!.split('/').filter(Boolean)
      const depth = Math.min(depths.get(index)! + 1, segments.length)
      return segments.slice(-depth).join('/')
    }

    while (true) {
      const labelCounts = new Map<string, number>()
      indexes.forEach((index) => labelCounts.set(suffix(index), (labelCounts.get(suffix(index)) || 0) + 1))
      let expanded = false
      for (const index of indexes) {
        if (labelCounts.get(suffix(index)) === 1) continue
        const segmentCount = presentations[index].fullPath!.split('/').filter(Boolean).length
        if (depths.get(index)! + 1 >= segmentCount) continue
        depths.set(index, depths.get(index)! + 1)
        expanded = true
      }
      if (!expanded) break
    }
    indexes.forEach((index) => { presentations[index].label = suffix(index) })
  }

  return presentations
}

export interface CardSearchResult {
  cardId: string
  title: string
  preview: string
}

export function searchCards(cards: ContentCard[], query: string): CardSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const presentations = sourceCardPresentations(cards)
  return cards.flatMap((card, index) => {
    const title = presentations[index].label
    const text = (presentations[index].fullPath || markdownFor(card)).replace(/\s+/g, ' ').trim()
    const titleMatch = title.toLocaleLowerCase().includes(needle)
    const match = text.toLocaleLowerCase().indexOf(needle)
    if (!titleMatch && match < 0) return []
    const start = Math.max(0, match - 32)
    const excerpt = text.slice(start, start + 160)
    return [{
      cardId: card.id,
      title,
      preview: `${start > 0 ? '…' : ''}${excerpt}${start + 160 < text.length ? '…' : ''}`,
      rank: titleMatch ? 0 : 1,
    }]
  }).sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...result }) => result)
}

export function createCustomSuggestion(value: string): V2Suggestion | null {
  const instruction = value.trim()
  if (!instruction) return null
  return { id: 'custom', label: instruction, instruction, acceptance: '' }
}

export function versionTimeline(card: ContentCard): CardVersion[] {
  return [...card.versions].sort((a, b) => b.sequence - a.sequence)
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split('\n')
  const right = after.split('\n')
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  )
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (i < left.length && (j >= right.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      result.push({ kind: 'removed', text: left[i] })
      i += 1
    } else {
      result.push({ kind: 'added', text: right[j] })
      j += 1
    }
  }
  return result
}
