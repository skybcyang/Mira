import type { CardContent, CardVersion } from './versions'

export type ContentKind = CardContent['kind']
export type CardColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet'

export interface CanvasGroup {
  id: string
  title: string
  color?: CardColor
  cardIds: string[]
}

export interface InspirationRef {
  boardId?: string
  cardId?: string
  poolId?: string
  entryId?: string
  versionId: string
}

export interface CardFileBinding {
  path: string
  lastSyncedVersionId: string
  lastSyncedFileDigest: string
  lastSyncedAt: string
}

export interface ContentCard {
  id: string
  name?: string
  color?: CardColor
  contentKind: ContentKind
  tags?: string[]
  inspirationRef?: InspirationRef
  fileBinding?: CardFileBinding
  x: number
  y: number
  width: number
  height: number
  headVersionId: string | null
  versions: CardVersion[]
  createdAt: string
  updatedAt: string
}
