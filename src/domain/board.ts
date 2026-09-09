import type { CanvasGroup, ContentCard } from './cards'
import type { Transformation } from './transformations'

export interface BoardV2 {
  schemaVersion: 2
  id: string
  title: string
  revision?: number
  lifecycle?: {
    state: 'active' | 'archived' | 'trashed'
    archivedAt?: string
    trashedAt?: string
  }
  cards: ContentCard[]
  groups?: CanvasGroup[]
  transformations: Transformation[]
  viewport: {
    x: number
    y: number
    zoom: number
  }
  runtime?: {
    rootSessionId?: string
  }
  createdAt: string
  updatedAt: string
}
