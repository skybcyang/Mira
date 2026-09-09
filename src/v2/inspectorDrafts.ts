import { createContext, useContext, useLayoutEffect } from 'react'
import type { InspectorDraft } from './inspectorBehavior'

export const InspectorDraftContext = createContext<Map<string, InspectorDraft> | null>(null)

export function useInspectorDraft(key: string, dirty: boolean, save: () => Promise<boolean>, blocked = false) {
  const registry = useContext(InspectorDraftContext)
  useLayoutEffect(() => {
    registry?.set(key, { dirty, save, blocked })
    return () => { registry?.delete(key) }
  }, [registry, key, dirty, save, blocked])
}
