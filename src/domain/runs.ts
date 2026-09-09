import type { ContentKind } from './cards'

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted'

export type RunDisposition = 'applied' | 'candidate' | 'discarded'

export interface SourceSnapshot {
  cardId: string
  versionId: string
  contentKind: ContentKind
  resolvedContent: string
  digest: string
}

export interface RunProgress {
  phase: string
  label: string
  detail?: string
  updatedAt: string
}

export interface RunProgressEvent {
  sequence: number
  phase: string
  label: string
  detail?: string
  occurredAt: string
}

export interface TransformationRun {
  id: string
  boardId: string
  transformationId: string
  status: RunStatus
  sourceSnapshot: SourceSnapshot[]
  targetCardId: string
  targetBaseVersionId: string | null
  intent: 'create' | 'update'
  modelSnapshot?: {
    provider: string
    model: string
  }
  result?: {
    output: string
    digest: string
    disposition: RunDisposition
    appliedVersionId?: string
  }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  progress?: RunProgress
  progressEvents?: RunProgressEvent[]
  createdAt: string
  startedAt?: string
  finishedAt?: string
}
