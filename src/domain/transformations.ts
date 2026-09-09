export interface PlanRef {
  planId: string
  source: 'ad-hoc' | 'template'
  title: string
  stepIndex: number
  stepTotal: number
  adjusted?: boolean
}

export interface Transformation {
  id: string
  sourceCardIds: string[]
  targetCardId: string
  x?: number
  y?: number
  label: string
  instruction: string
  acceptance: string
  modelId?: string
  permissions: {
    workspaceWrite: boolean
  }
  planRef?: PlanRef
  workflowRef?: {
    workflowId: string
    stepId: string
    applicationId: string
  }
  lastRunId?: string
  lastAppliedRunId?: string
  createdAt: string
  updatedAt: string
}
