import { readBoardNavigation } from './boardNavigation'
import type { ProjectNavigation } from './projectApi'

const key = (id: string) => `mira.project.v1.${encodeURIComponent(id)}.boards`
export const PROJECT_NAVIGATION_LIMIT = 1000
export const validNavigationId = (id: string) => Boolean(id.trim()) && id.length <= 200

export function reconcileProjectNavigation(value: ProjectNavigation | null, activeIds: string[]): ProjectNavigation {
  const active = new Set(activeIds)
  const filter = (ids: string[] = []) => [...new Set(ids)].filter(id => validNavigationId(id) && active.has(id)).slice(0, PROJECT_NAVIGATION_LIMIT)
  const opened = filter(value?.opened)
  return { opened, pinned: filter(value?.pinned), lastBoardId: value?.lastBoardId == null ? null
    : opened.includes(value.lastBoardId) ? value.lastBoardId : opened[0] || null }
}

export function readProjectNavigation(projectId: string, activeIds: string[]): ProjectNavigation | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (raw) {
      const value = JSON.parse(raw)
      if (!value || !Array.isArray(value.opened) || !Array.isArray(value.pinned)
        || ![...value.opened, ...value.pinned].every(id => typeof id === 'string')
        || !(value.lastBoardId === null || typeof value.lastBoardId === 'string')) return null
      return reconcileProjectNavigation(value, activeIds)
    }
    const legacy = readBoardNavigation()
    const references = [...(legacy?.opened || []), ...(legacy?.pinned || [])]
    if (!legacy || !references.length || !references.every(id => activeIds.includes(id))) return null
    return reconcileProjectNavigation({ ...legacy, lastBoardId: localStorage.getItem('mira.v2.lastBoardId') || null }, activeIds)
  } catch { return null }
}

export function writeProjectNavigation(projectId: string, value: ProjectNavigation) {
  localStorage.setItem(key(projectId), JSON.stringify(value))
}
