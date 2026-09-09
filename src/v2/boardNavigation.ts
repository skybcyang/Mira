export interface BoardNavigation { opened: string[]; pinned: string[] }
const KEY = 'mira.workbench.v1.boards'

export function readBoardNavigation(storage?: Pick<Storage, 'getItem'>): BoardNavigation | null {
  try {
    const value = JSON.parse((storage || localStorage).getItem(KEY) || 'null')
    if (!value || !Array.isArray(value.opened) || !Array.isArray(value.pinned)) return null
    const ids = (items: unknown[]) => [...new Set(items.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
    return { opened: ids(value.opened), pinned: ids(value.pinned) }
  } catch { return null }
}

export function writeBoardNavigation(value: BoardNavigation) {
  try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* Optional local navigation preference. */ }
}

export function rememberOpenedBoard(opened: string[], id: string) {
  return [id, ...opened.filter(item => item !== id)]
}

export function boardMenuFocusIndex(current: number, count: number, key: string) {
  if (current < 0) return key === 'ArrowDown' ? 0 : count - 1
  return (current + (key === 'ArrowDown' ? 1 : -1) + count) % count
}

export function boardMenuGroups<T extends {id: string; title: string}>(boards: T[], opened: string[], pinned: string[], query: string) {
  const term = query.trim().toLocaleLowerCase()
  if (term) return [{ title:'搜索结果', boards:boards.filter(board => board.title.toLocaleLowerCase().includes(term)) }]
  const byId = new Map(boards.map(board => [board.id, board]))
  const resolve = (ids: string[]) => [...new Set(ids)].flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  return [{ title:'常用', boards:resolve(pinned) }, { title:'已打开', boards:resolve(opened.filter(id => !pinned.includes(id))) }]
}
