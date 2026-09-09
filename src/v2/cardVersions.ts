import type { CardVersion, ContentCard, VersionOrigin } from '../domain'
import { diffLines, headVersion, versionTimeline, type DiffLine } from '../v2View'

const ORIGIN_LABELS: Record<VersionOrigin, string> = {
  human: '人工编辑',
  ai: '生成结果',
  restore: '恢复',
  import: '导入',
}

export interface CardVersionRow {
  id: string
  label: string
  originLabel: string
  createdAt: string
  isCurrent: boolean
  version: CardVersion
}

export function cardVersionRows(card: ContentCard): CardVersionRow[] {
  return versionTimeline(card).map((version) => ({
    id: version.id,
    label: `v${version.sequence}`,
    originLabel: ORIGIN_LABELS[version.origin],
    createdAt: version.createdAt,
    isCurrent: version.id === card.headVersionId,
    version,
  }))
}

function comparisonText(version: CardVersion): string {
  if (version.content.kind === 'markdown') return version.content.markdown
  return `路径：${version.content.path}\n状态：${version.content.readonly ? '只读' : '可写'}`
}

export function cardVersionComparison(
  selected: CardVersion,
  current: CardVersion,
): { lines: DiffLine[]; hasChanges: boolean; tooLarge?: boolean; emptyMessage?: string } {
  const { lines, hasChanges, tooLarge } = compareVersionText(comparisonText(selected), comparisonText(current))
  return {
    lines,
    hasChanges,
    tooLarge,
    ...(!hasChanges
      ? { emptyMessage: selected.content.kind === 'markdown' && current.content.kind === 'markdown'
          ? '所选版本与当前版本的正文没有变化。'
          : '所选版本与当前版本的引用没有变化。' }
      : {}),
  }
}

export function compareVersionText(before: string, after: string) {
  const hasChanges = before !== after
  // ponytail: bound the existing quadratic diff; full reading remains available beyond this ceiling.
  const tooLarge = before.length + after.length > 200_000
    || (before.split('\n').length + 1) * (after.split('\n').length + 1) > 1_000_000
  return { hasChanges, tooLarge, lines: hasChanges && !tooLarge ? diffLines(before, after) : [] }
}

export function selectedCardVersion(
  card: ContentCard,
  selectedId: string | null | undefined,
): CardVersion | undefined {
  return card.versions.find((version) => version.id === selectedId) || headVersion(card)
}

export function restoreVersionMessage(card: ContentCard): string {
  const nextSequence = (headVersion(card)?.sequence || 0) + 1
  return `将创建 v${nextSequence}，旧版本保持不变。`
}

export function cardVersionPreview(version: CardVersion): string {
  return comparisonText(version)
}
