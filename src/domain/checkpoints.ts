import type { BoardV2 } from './board'
import type { TransformationRun } from './runs'
import type { WorkflowInputSlot, WorkflowStepTemplate } from './workflows'

export interface WorkflowProvenanceSnapshot {
  workflowId: string
  title: string
  description: string
  inputs?: WorkflowInputSlot[]
  steps: WorkflowStepTemplate[]
}

export interface BoardArtifactV1 {
  format: 'mira-board'
  formatVersion: 1
  exportedAt: string
  board: BoardV2
  runs: TransformationRun[]
  workflowProvenance: WorkflowProvenanceSnapshot[]
  fileDependencies: Array<{ path: string; occurrenceCount: number }>
  externalReferences: Array<
    | { kind: 'inspiration'; poolId?: string; entryId?: string; boardId?: string; cardId?: string; versionId: string }
    | { kind: 'workflow'; workflowId: string; stepId?: string }
    | { kind: 'historical'; objectKind: 'card' | 'version' | 'transformation' | 'run'; objectId: string }
  >
}

export interface BoardCheckpointV1 {
  schemaVersion: 1
  id: string
  boardId: string
  title: string
  note?: string
  baseBoardRevision: number
  artifact: BoardArtifactV1
  createdAt: string
  metadataUpdatedAt: string
}

export interface BoardCheckpointSummary {
  id: string
  boardId: string
  title: string
  note?: string
  baseBoardRevision: number
  counts: { cards: number; transformations: number; runs: number }
  createdAt: string
  metadataUpdatedAt: string
}
