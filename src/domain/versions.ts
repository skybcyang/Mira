export type CardContent =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'file-reference'; path: string; readonly: boolean }

export type VersionOrigin = 'human' | 'ai' | 'restore' | 'import'

export interface CardVersion {
  id: string
  cardId: string
  sequence: number
  content: CardContent
  digest: string
  origin: VersionOrigin
  createdAt: string
  sourceRunId?: string
  restoredFromVersionId?: string
}
