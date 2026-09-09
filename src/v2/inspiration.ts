import type { BoardV2, CardContent, ContentCard, InspirationPool } from '../domain'
import type { CreateCardInput, PositionedCreateCardInput, PoolSnapshotCreateCardInput } from '../v2Api'

const CANDIDATE_KEY_SEPARATOR = '\u0000'
const LAYOUT_COLUMNS = 2
const LAYOUT_GAP = 32

export interface InspirationCandidate {
  key: string
  poolId?: string
  entryId?: string
  boardId?: string
  boardTitle?: string
  cardId?: string
  versionId: string
  content: CardContent
  tags: string[]
  width?: number
  height?: number
  updatedAt: string
}

export interface InspirationFilters {
  query: string
  tags: string[]
}

export interface InspirationCapture {
  markdown: string
  tags: string[]
}

export type InspirationSelectionPlanItem =
  | { kind: 'existing'; cardId: string }
  | { kind: 'create'; createIndex: number }

export interface InspirationSnapshotPlan {
  createInputs: PositionedCreateCardInput[]
  selection: InspirationSelectionPlanItem[]
}

function candidateKey(poolId: string, entryId: string, versionId: string): string {
  return [poolId, entryId, versionId].join(CANDIDATE_KEY_SEPARATOR)
}

function cloneContent(content: CardContent): CardContent {
  return content.kind === 'markdown'
    ? { kind: 'markdown', markdown: content.markdown }
    : { kind: 'file-reference', path: content.path, readonly: content.readonly }
}

function usableHead(card: ContentCard): CardContent | undefined {
  if (!card.headVersionId) return undefined
  const head = card.versions.find((version) => version.id === card.headVersionId)
  if (!head || head.cardId !== card.id || head.content.kind !== card.contentKind) {
    return undefined
  }

  if (head.content.kind === 'markdown') {
    return head.content.markdown.trim() ? cloneContent(head.content) : undefined
  }
  if (typeof head.content.readonly !== 'boolean' || !head.content.path.trim()) {
    return undefined
  }
  return cloneContent(head.content)
}

function searchableText(content: CardContent): string {
  return content.kind === 'markdown' ? content.markdown : content.path
}

export function mapInspirationCaptureToCardInput(
  _sourceBoard: BoardV2,
  capture: InspirationCapture,
): CreateCardInput {
  const markdown = capture.markdown.trim()
  if (!markdown) throw new Error('灵感内容不能为空')

  return {
    contentKind: 'markdown',
    markdown,
    tags: [...capture.tags],
    placement: 'board-bottom',
  }
}

export function filterInspirationPool(
  pool: InspirationPool,
  filters: InspirationFilters,
): InspirationCandidate[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const requiredTags = filters.tags.map((tag) => tag.trim()).filter(Boolean)

  return pool.entries.flatMap((entry) => {
    if (!entry.headVersionId) return []
    const version = entry.versions.find((item) => item.id === entry.headVersionId)
    if (!version || version.entryId !== entry.id || version.content.kind !== 'markdown') return []
    if (!version.content.markdown.trim()) return []
    const tags = [...(entry.tags ?? [])]
    if (query && !version.content.markdown.toLocaleLowerCase().includes(query)) return []
    if (!requiredTags.every((tag) => tags.includes(tag))) return []
    return [{
      key: candidateKey(pool.id, entry.id, version.id),
      poolId: pool.id,
      entryId: entry.id,
      versionId: version.id,
      content: cloneContent(version.content),
      tags,
      updatedAt: entry.updatedAt,
    }]
  })
}

export function appendInspirationCaptureTag(tags: string[], rawTag: string): string[] {
  const tag = rawTag.trim()
  if (!tag) return [...tags]
  if ([...tag].length > 32) throw new Error('标签不能超过 32 个字符。')
  if (tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
    return [...tags]
  }
  if (tags.length >= 20) throw new Error('每条灵感最多 20 个标签。')
  return [...tags, tag]
}

export function inspirationCaptureErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (code === 'INSPIRATION_NOT_FOUND') return '灵感池条目已不存在，请重新加载。'
  if (code === 'INSPIRATION_CONFLICT') return '这条灵感已被修改，草稿已保留。请复制需要保留的文字，再载入最新内容。'
  if (code === 'BOARD_NOT_FOUND') return '来源画板已不存在，请重新选择。'
  if (code === 'BAD_REQUEST') return '灵感内容或标签不符合要求，请检查后重试。'
  return '灵感没有保存，请重试。'
}

export function filterInspirationCards(
  board: BoardV2,
  filters: InspirationFilters,
): InspirationCandidate[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const requiredTags = filters.tags.map((tag) => tag.trim()).filter(Boolean)

  return board.cards.flatMap((card) => {
    const content = usableHead(card)
    if (!content) return []

    const tags = [...(card.tags ?? [])]
    if (query && !searchableText(content).toLocaleLowerCase().includes(query)) return []
    if (!requiredTags.every((tag) => tags.includes(tag))) return []

    return [{
      key: candidateKey(board.id, card.id, card.headVersionId as string),
      boardId: board.id,
      boardTitle: board.title,
      cardId: card.id,
      versionId: card.headVersionId as string,
      content,
      tags,
      width: card.width,
      height: card.height,
      updatedAt: card.updatedAt,
    }]
  })
}

function isSameCandidate(
  first: InspirationCandidate,
  second: InspirationCandidate,
): boolean {
  return first.key === second.key
    && first.versionId === second.versionId
}

export function toggleInspirationSelection(
  selected: InspirationCandidate[],
  candidate: InspirationCandidate,
): InspirationCandidate[] {
  const isSelected = selected.some((item) => isSameCandidate(item, candidate))
  return isSelected
    ? selected.filter((item) => !isSameCandidate(item, candidate))
    : [...selected, candidate]
}

function layoutExternalCandidates(
  candidates: InspirationCandidate[],
  anchor: { x: number; y: number },
): Array<{ x: number; y: number }> {
  if (candidates.length === 0) return []

  const columnWidth = Math.max(...candidates.map((candidate) => candidate.width || 312))
  const rowOffsets: number[] = []
  let nextRowY = anchor.y

  for (let index = 0; index < candidates.length; index += LAYOUT_COLUMNS) {
    rowOffsets.push(nextRowY)
    const row = candidates.slice(index, index + LAYOUT_COLUMNS)
    nextRowY += Math.max(...row.map((candidate) => candidate.height || 208)) + LAYOUT_GAP
  }

  return candidates.map((_, index) => ({
    x: anchor.x + (index % LAYOUT_COLUMNS) * (columnWidth + LAYOUT_GAP),
    y: rowOffsets[Math.floor(index / LAYOUT_COLUMNS)],
  }))
}

function snapshotInput(
  candidate: InspirationCandidate,
  position: { x: number; y: number },
): PositionedCreateCardInput {
  const common = {
    ...position,
    width: candidate.width || 312,
    height: candidate.height || 208,
    tags: [...candidate.tags],
    inspirationRef: candidate.poolId && candidate.entryId
      ? {
          poolId: candidate.poolId,
          entryId: candidate.entryId,
          versionId: candidate.versionId,
        }
      : {
          boardId: candidate.boardId || '',
          cardId: candidate.cardId || '',
          versionId: candidate.versionId,
        },
  }

  return candidate.content.kind === 'markdown'
    ? {
        ...common,
        contentKind: 'markdown',
        markdown: candidate.content.markdown,
      }
    : {
        ...common,
        contentKind: 'file-reference',
        filePath: candidate.content.path,
        readonly: candidate.content.readonly,
      }
}

export function mapInspirationSelectionToSnapshots(
  selected: InspirationCandidate[],
  currentBoardId: string,
  anchor: { x: number; y: number },
): InspirationSnapshotPlan {
  const externalCandidates = selected.filter((candidate) => candidate.boardId !== currentBoardId)
  const positions = layoutExternalCandidates(externalCandidates, anchor)
  const createInputs = externalCandidates.map((candidate, index) => (
    snapshotInput(candidate, positions[index])
  ))
  let createIndex = 0

  const selection = selected.map<InspirationSelectionPlanItem>((candidate) => {
    if (candidate.boardId === currentBoardId) {
      return { kind: 'existing', cardId: candidate.cardId as string }
    }
    return { kind: 'create', createIndex: createIndex++ }
  })

  return { createInputs, selection }
}

export function mapInspirationPoolSelectionToSnapshotInputs(
  selected: InspirationCandidate[],
  _anchor: { x: number; y: number },
): PoolSnapshotCreateCardInput[] {
  return selected.map((candidate) => ({
    poolSource: { poolId: candidate.poolId || '', entryId: candidate.entryId || '', versionId: candidate.versionId },
    tags: [...candidate.tags],
  }))
}
