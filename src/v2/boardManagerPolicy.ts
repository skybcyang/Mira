export type BoardLifecycleState = 'active' | 'archived' | 'trashed'
export type BoardManagerAction = 'open' | 'rename' | 'export' | 'archive' | 'trash' | 'restore' | 'purge'
export type BoardDangerAction = 'archive' | 'trash' | 'purge'

export interface BoardCatalogEntry {
  id: string
  title: string
  state: BoardLifecycleState
  revision: number
  updatedAt: string
}

export interface BoardArtifactPreview {
  formatVersion: 1
  title: string
  cardCount: number
  versionCount: number
  transformationCount: number
  runCount: number
  externalReferenceCount: number
  fileDependencyCount: number
  workflowProvenanceCount: number
}

export const BOARD_MANAGER_TABS: Array<{ id: BoardLifecycleState; label: string }> = [
  { id: 'active', label: '工作中' },
  { id: 'archived', label: '已归档' },
  { id: 'trashed', label: '废纸篓' },
]

export function boardActionsForState(
  state: BoardLifecycleState,
  current: boolean,
): BoardManagerAction[] {
  if (state === 'trashed') return ['restore', 'export', 'purge']
  if (state === 'archived') return ['restore', 'rename', 'export', 'trash']
  return current
    ? ['rename', 'export', 'archive', 'trash']
    : ['open', 'rename', 'export', 'archive', 'trash']
}

export function boardsForTab(
  entries: BoardCatalogEntry[],
  state: BoardLifecycleState,
): BoardCatalogEntry[] {
  return entries
    .filter((entry) => entry.state === state)
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
}

export function normalizeBoardTitle(value: string): { title: string; error: string | null } {
  const title = value.trim()
  if (!title) return { title, error: '请输入画板名称。' }
  if ([...title].length > 120) return { title, error: '画板名称不能超过 120 个字符。' }
  return { title, error: null }
}

export function boardDangerCopy(
  action: BoardDangerAction,
  title: string,
): { title: string; description: string; confirmLabel: string } {
  if (action === 'archive') return {
    title: `归档“${title}”？`,
    description: '归档后内容只读，可随时恢复。',
    confirmLabel: '确认归档',
  }
  if (action === 'purge') return {
    title: `永久删除“${title}”？`,
    description: '将永久删除画板及其运行记录，无法恢复。其他画板、方法和引用文件不受影响。',
    confirmLabel: '永久删除',
  }
  return {
    title: `将“${title}”移到废纸篓？`,
    description: '移入后只可恢复或导出，不会永久删除。',
    confirmLabel: '移到废纸篓',
  }
}

export function inspectBoardArtifact(value: unknown): BoardArtifactPreview {
  const envelope = record(value)
  if (!envelope || envelope.format !== 'mira-board') throw new Error('这不是 Mira 画板文件。')
  if (envelope.formatVersion !== 1) throw new Error('不支持这个画板文件版本。')

  const board = record(envelope.board)
  const cards = array(board?.cards)
  const transformations = array(board?.transformations)
  const runs = array(envelope.runs)
  const externalReferences = array(envelope.externalReferences)
  const fileDependencies = array(envelope.fileDependencies)
  const workflowProvenance = array(envelope.workflowProvenance)
  if (!board || typeof board.title !== 'string' || !cards || !transformations
    || !runs || !externalReferences || !fileDependencies || !workflowProvenance) {
    throw new Error('画板文件缺少必要信息。')
  }

  let versionCount = 0
  for (const cardValue of cards) {
    const card = record(cardValue)
    const versions = array(card?.versions)
    if (!versions) throw new Error('画板文件缺少必要信息。')
    versionCount += versions.length
  }

  return {
    formatVersion: 1,
    title: board.title,
    cardCount: cards.length,
    versionCount,
    transformationCount: transformations.length,
    runCount: runs.length,
    externalReferenceCount: externalReferences.length,
    fileDependencyCount: fileDependencies.length,
    workflowProvenanceCount: workflowProvenance.length,
  }
}

export function validateBoardArtifactFile(file: { name: string; size: number }): string | null {
  if (!file.name.toLocaleLowerCase().endsWith('.mira-board.json')) return '请选择 .mira-board.json 文件。'
  if (file.size > 64 * 1024 * 1024) return '画板文件超过 64 MiB，无法导入。'
  return null
}

export function boardManagerTabFromKey(
  current: BoardLifecycleState,
  key: string,
): BoardLifecycleState | null {
  if (key === 'Home') return BOARD_MANAGER_TABS[0].id
  if (key === 'End') return BOARD_MANAGER_TABS[BOARD_MANAGER_TABS.length - 1].id
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const currentIndex = BOARD_MANAGER_TABS.findIndex((tab) => tab.id === current)
  const offset = key === 'ArrowRight' ? 1 : -1
  const nextIndex = (currentIndex + offset + BOARD_MANAGER_TABS.length) % BOARD_MANAGER_TABS.length
  return BOARD_MANAGER_TABS[nextIndex].id
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}
