import type { CardContent } from './versions'

export interface InspirationVersion {
  id: string
  entryId: string
  sequence: number
  content: CardContent
  digest: string
  origin: 'human' | 'restore' | 'import'
  createdAt: string
}

export interface InspirationEntry {
  id: string
  tags?: string[]
  headVersionId: string | null
  versions: InspirationVersion[]
  createdAt: string
  updatedAt: string
}

export interface InspirationPool {
  schemaVersion: 1
  id: 'inspiration-pool'
  entries: InspirationEntry[]
  createdAt: string
  updatedAt: string
}
