import type { DrawerState } from './storeTypes'

export interface InspectorDraft {
  dirty: boolean
  blocked?: boolean
  save: () => Promise<boolean>
}

export function followCardSelection(drawer: DrawerState, cardIds: string[], explicit: boolean): DrawerState {
  if (!explicit || !drawer || !['content', 'versions', 'relation'].includes(drawer.tab) || cardIds.length !== 1) return null
  if ('cardId' in drawer && drawer.cardId === cardIds[0]) return null
  return { tab: 'content', cardId: cardIds[0], mode: 'read' }
}

export async function saveInspectorDrafts(drafts: ReadonlyMap<string, InspectorDraft>, isCurrent: () => boolean): Promise<boolean> {
  const pending = [...drafts.values()].filter(draft => draft.dirty)
  if (pending.some(draft => draft.blocked)) return false
  try {
    for (const draft of pending) {
      if (!isCurrent() || !await draft.save()) return false
    }
    return isCurrent()
  } catch { return false }
}
