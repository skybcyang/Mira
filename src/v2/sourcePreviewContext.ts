import { createContext, useContext } from 'react'
import type { SourceSnapshot } from '../domain'

export interface SourcePreviewRequest {
  boardId: string
  cardId: string
  snapshot?: SourceSnapshot
  runId?: string
}

export const SourcePreviewContext = createContext<((request: SourcePreviewRequest) => void) | null>(null)
export function useSourcePreview() {
  return useContext(SourcePreviewContext)
}
