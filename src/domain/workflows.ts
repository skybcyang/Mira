import type { ContentCard } from './cards'
import type { Transformation } from './transformations'

export type WorkflowInputCardinality = 'one' | 'many'

export interface WorkflowInputSlot {
  id: string
  name: string
  description: string
  required: boolean
  cardinality: WorkflowInputCardinality
}

export type WorkflowStepSource =
  | { kind: 'input'; inputId: string }
  | { kind: 'previous-output' }

export interface WorkflowStepTemplate {
  id: string
  label: string
  instruction: string
  acceptance: string
  modelId?: string
  sources?: WorkflowStepSource[]
}

export interface WorkflowTemplate {
  id: string
  title: string
  description: string
  inputs?: WorkflowInputSlot[]
  steps: WorkflowStepTemplate[]
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowInputSlot extends Omit<WorkflowInputSlot, 'id'> {
  sourceCardId: string
}

export interface SourceRef {
  cardId: string
  versionId: string
}

export interface WorkflowInputBinding {
  inputId: string
  sourceRefs: SourceRef[]
}

export interface WorkflowApplicationResult {
  applicationId: string
  workflow: WorkflowTemplate
  transformations: Transformation[]
  targetCards: ContentCard[]
}

export interface PlanStepInput {
  label: string
  instruction: string
  acceptance: string
  modelId?: string
}

export interface CreatePlanRequest {
  title: string
  sourceRefs: SourceRef[]
  steps: PlanStepInput[]
  targetPosition: { x: number; y: number }
}

export interface PlanApplicationResult {
  planId: string
  title: string
  transformations: Transformation[]
  targetCards: ContentCard[]
}
