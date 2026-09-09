import type {
  BoardV2,
  ContentCard,
  CanvasGroup,
  InspirationEntry,
  InspirationPool,
  Transformation,
  TransformationRun,
  CreatePlanRequest,
  PlanApplicationResult,
  WorkflowApplicationResult,
  WorkflowTemplate,
  CreateWorkflowInputSlot,
  WorkflowInputBinding,
  BoardArtifactV1,
  BoardCheckpointSummary,
  BoardCheckpointV1,
} from './domain'
import type { OrganizationRequest, OrganizationResult } from './v2/canvasOrganization'

const API = '/graphmind/api/v2'
export interface V2Suggestion {
  id: string
  label: string
  instruction: string
  acceptance: string
}

export type BoardLifecycleState = 'active' | 'archived' | 'trashed'
export interface BoardActivity { activeRuns: number; pendingCandidates: number }

export interface BoardSummary {
  id: string
  title: string
  state: BoardLifecycleState
  revision: number
  updatedAt: string
}

export type BoardCheckpointSaveStatus =
  | { allowed: true }
  | {
    allowed: false
    reason: 'read-only' | 'active-run' | 'pending-candidate' | 'limit'
    runId?: string
  }

export interface BoardCheckpointListResult {
  checkpoints: BoardCheckpointSummary[]
  saveStatus: BoardCheckpointSaveStatus
}

export interface BoardImportResult {
  boardId: string
  board: BoardV2
  imported: {
    runCount: number
    externalReferenceCount: number
  }
}

type PositionedCardContentInput = {
  name?: string
  color?: ContentCard['color']
  width?: number
  height?: number
  markdown?: string
  filePath?: string
  readonly?: boolean
  contentKind?: ContentCard['contentKind']
  tags?: string[]
  inspirationRef?: ContentCard['inspirationRef']
}

export type PositionedCreateCardInput = PositionedCardContentInput & {
  x: number
  y: number
  placement?: never
}

export type BoardBottomCreateCardInput = {
  placement: 'board-bottom'
  contentKind?: 'markdown'
  markdown: string
  tags?: string[]
  x?: never
  y?: never
  width?: never
  height?: never
  filePath?: never
  readonly?: never
  inspirationRef?: never
}

export type CreateCardInput = PositionedCreateCardInput | BoardBottomCreateCardInput

export interface PoolSnapshotCreateCardInput {
  poolSource: { poolId: string; entryId: string; versionId: string }
  tags?: string[]
}

export interface CardContentResponse {
  cardId: string
  versionId: string
  contentKind: ContentCard['contentKind']
  path?: string
  content: string
}

export type FileSyncStatus = 'unbound' | 'synced' | 'unsynced' | 'conflict' | 'missing' | 'error'

export interface FileBindingStatus {
  cardId: string
  status: FileSyncStatus
  path?: string
  fileDigest?: string
  message?: string
}

export interface FileSyncResult {
  status: FileSyncStatus
  path?: string
  message?: string
}

export interface FileBrowseEntry {
  name: string
  kind: 'directory' | 'file'
  path: string
  workspaceRelative: string | null
}

export interface FileBrowseResult {
  path: string
  parent: string | null
  workspaceRelative: string | null
  entries: FileBrowseEntry[]
}

export interface FileImportResult {
  path: string
  copied: boolean
}

export interface ModelSettings {
  provider: 'openai-compatible'
  baseUrl: string
  model: string
  configured: boolean
  hasApiKey: boolean
  scope: 'process'
}

export interface ModelSettingsInput {
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface ModelConnectionResult {
  ok: true
  latencyMs: number
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data.message || '请求未完成'), {
      code: data.code,
      status: response.status,
      details: data.details,
    })
  }
  return data as T
}

export const v2Api = {
  getInspirationPool: () => request<{ pool: InspirationPool }>('GET', '/inspiration-pool'),
  createInspirationEntry: (body: { markdown: string; tags: string[] }) =>
    request<{ entry: InspirationEntry }>('POST', '/inspiration-pool/entries', body),
  updateInspirationEntry: (entryId: string, body: { markdown: string; tags: string[]; baseVersionId: string; baseUpdatedAt: string }) =>
    request<{ entry: InspirationEntry }>('PATCH', `/inspiration-pool/entries/${encodeURIComponent(entryId)}`, body),
  getModelSettings: () => request<ModelSettings>('GET', '/model-settings'),
  saveModelSettings: (body: ModelSettingsInput) =>
    request<ModelSettings>('PUT', '/model-settings', body),
  testModelSettings: (body: ModelSettingsInput) =>
    request<ModelConnectionResult>('POST', '/model-settings/test', body),
  listWorkflows: () => request<{ workflows: WorkflowTemplate[] }>('GET', '/workflows'),
  getWorkflow: (workflowId: string) =>
    request<{ workflow: WorkflowTemplate }>('GET', `/workflows/${workflowId}`),
  createWorkflow: (body: {
    title: string
    description?: string
    sourceBoardId: string
    transformationIds: string[]
    inputs?: CreateWorkflowInputSlot[]
  }) => request<{ workflow: WorkflowTemplate }>('POST', '/workflows', body),
  deleteWorkflow: (workflowId: string) =>
    request<{ deletedWorkflowId: string }>('DELETE', `/workflows/${workflowId}`),
  applyWorkflow: (
    boardId: string,
    workflowId: string,
    body: {
      inputBindings: WorkflowInputBinding[]
      targetPosition: { x: number; y: number }
    },
  ) => request<WorkflowApplicationResult>(
    'POST',
    `/boards/${boardId}/workflows/${workflowId}/applications`,
    body,
  ),
  createPlan: (boardId: string, body: CreatePlanRequest) =>
    request<PlanApplicationResult>('POST', `/boards/${boardId}/plans`, body),
  listBoards: () => request<{ boards: BoardSummary[] }>('GET', '/boards'),
  getBoardActivity: () => request<{ activity: Record<string, BoardActivity> }>('GET', '/boards/activity'),
  listBoardCatalog: () => request<{ boards: BoardSummary[] }>('GET', '/boards/catalog'),
  createBoard: (title: string) =>
    request<{ boardId: string; board: BoardV2 }>('POST', '/boards', { title }),
  getBoard: (boardId: string) => request<{ board: BoardV2 }>('GET', `/boards/${boardId}`),
  renameBoard: (boardId: string, title: string, baseRevision: number) =>
    request<{ board: BoardV2 }>('PATCH', `/boards/${boardId}`, { title, baseRevision }),
  archiveBoard: (boardId: string, baseRevision: number) =>
    request<{ board: BoardV2 }>('POST', `/boards/${boardId}/archive`, { baseRevision }),
  trashBoard: (boardId: string, baseRevision: number) =>
    request<{ board: BoardV2 }>('POST', `/boards/${boardId}/trash`, { baseRevision }),
  restoreBoard: (boardId: string, baseRevision: number) =>
    request<{ board: BoardV2 }>('POST', `/boards/${boardId}/restore`, { baseRevision }),
  purgeBoard: (boardId: string, baseRevision: number) =>
    request<{ deletedBoardId: string; deletedRunIds: string[]; deletedCheckpointIds?: string[] }>('POST', `/boards/${boardId}/purge`, {
      baseRevision,
      confirmation: 'permanently-delete',
    }),
  exportBoard: (boardId: string) => request<unknown>('GET', `/boards/${boardId}/export`),
  importBoard: (artifact: unknown) =>
    request<BoardImportResult>('POST', '/boards/imports', { artifact }),
  listCheckpoints: (boardId: string) =>
    request<BoardCheckpointListResult>('GET', `/boards/${boardId}/checkpoints`),
  createCheckpoint: (
    boardId: string,
    body: { title: string; note?: string; baseRevision: number },
  ) => request<{ checkpoint: BoardCheckpointV1 }>('POST', `/boards/${boardId}/checkpoints`, body),
  getCheckpoint: (boardId: string, checkpointId: string) =>
    request<{
      checkpoint: BoardCheckpointV1
      current: { board: BoardV2; runs: TransformationRun[] }
    }>('GET', `/boards/${boardId}/checkpoints/${checkpointId}`),
  updateCheckpoint: (
    boardId: string,
    checkpointId: string,
    body: { title?: string; note?: string | null; baseMetadataUpdatedAt: string },
  ) => request<{ checkpoint: BoardCheckpointV1 }>(
    'PATCH',
    `/boards/${boardId}/checkpoints/${checkpointId}`,
    body,
  ),
  deleteCheckpoint: (boardId: string, checkpointId: string) =>
    request<{ deletedCheckpointId: string }>(
      'DELETE',
      `/boards/${boardId}/checkpoints/${checkpointId}`,
      { confirmation: 'delete-checkpoint' },
    ),
  forkCheckpoint: (boardId: string, checkpointId: string, body: { title?: string } = {}) =>
    request<BoardImportResult>(
      'POST',
      `/boards/${boardId}/checkpoints/${checkpointId}/forks`,
      body,
    ),
  exportCheckpoint: (boardId: string, checkpointId: string) =>
    request<BoardArtifactV1>('GET', `/boards/${boardId}/checkpoints/${checkpointId}/export`),
  exportBackup: () => request<unknown>('GET', '/backup'),
  browseFiles: (path?: string) =>
    request<FileBrowseResult>('POST', '/files/browse', path ? { path } : {}),
  importFile: (path: string) =>
    request<FileImportResult>('POST', '/files/import', { path }),
  createCard: (
    boardId: string,
    body: CreateCardInput,
  ) => request<{ card: ContentCard }>('POST', `/boards/${boardId}/cards`, body),
  updateOrganization: (boardId: string, body: OrganizationRequest) =>
    request<OrganizationResult>('PATCH', `/boards/${boardId}/organization`, body),
  createCards: (boardId: string, body: { cards: (PositionedCreateCardInput | PoolSnapshotCreateCardInput)[]; group?: Pick<CanvasGroup, 'title' | 'color'> }) =>
    request<{ cards: ContentCard[]; groups?: CanvasGroup[] }>('POST', `/boards/${boardId}/cards/batch`, body),
  restoreCards: (boardId: string, body: { restoreReceiptId: string }) =>
    request<{ cards: ContentCard[]; groups?: CanvasGroup[] }>('POST', `/boards/${boardId}/cards/restore`, body),
  getCardContent: (boardId: string, cardId: string) =>
    request<CardContentResponse>('GET', `/boards/${boardId}/cards/${cardId}/content`),
  deleteCard: (boardId: string, cardId: string) =>
    request<{ deletedCardId: string; restoreReceiptId: string; groups?: CanvasGroup[] }>(
      'DELETE',
      `/boards/${boardId}/cards/${cardId}`,
    ),
  updateCard: (
    boardId: string,
    cardId: string,
    body: Partial<Pick<ContentCard, 'x' | 'y' | 'width' | 'height' | 'tags'>> & { name?: string | null; baseName?: string | null },
  ) => request<{ card: ContentCard }>('PATCH', `/boards/${boardId}/cards/${cardId}`, body),
  updateCards: (
    boardId: string,
    body: {
      updates: Array<{
        cardId: string
        x?: number
        y?: number
        width?: number
        height?: number
      }>
    },
  ) => request<{ cards: ContentCard[] }>('PATCH', `/boards/${boardId}/cards`, body),
  deleteCards: (boardId: string, body: { cardIds: string[] }) =>
    request<{ deletedCardIds: string[]; restoreReceiptId: string; groups?: CanvasGroup[] }>(
      'DELETE',
      `/boards/${boardId}/cards`,
      body,
    ),
  commitVersion: (
    boardId: string,
    cardId: string,
    body: { baseVersionId: string | null; markdown: string },
  ) => request<{ card: ContentCard; fileSync?: FileSyncResult }>('POST', `/boards/${boardId}/cards/${cardId}/versions`, body),
  restoreVersion: (
    boardId: string,
    cardId: string,
    versionId: string,
    baseVersionId: string | null,
  ) =>
    request<{ card: ContentCard; fileSync?: FileSyncResult }>(
      'POST',
      `/boards/${boardId}/cards/${cardId}/versions/${versionId}/restore`,
      { baseVersionId },
    ),
  getCardFileBinding: (boardId: string, cardId: string) =>
    request<FileBindingStatus>('GET', `/boards/${boardId}/cards/${cardId}/file-binding`),
  bindCardFile: (boardId: string, cardId: string, path: string, overwrite = false) =>
    request<{ card: ContentCard; fileSync: FileSyncResult }>(
      'PUT',
      `/boards/${boardId}/cards/${cardId}/file-binding`,
      { path, ...(overwrite ? { overwrite: true } : {}) },
    ),
  unbindCardFile: (boardId: string, cardId: string) =>
    request<{ card: ContentCard; fileSync: FileSyncResult }>(
      'DELETE',
      `/boards/${boardId}/cards/${cardId}/file-binding`,
    ),
  syncCardFile: (
    boardId: string,
    cardId: string,
    resolution?: 'overwrite' | 'import',
    expectedFileDigest?: string,
  ) => request<{ card: ContentCard; fileSync: FileSyncResult }>(
    'POST',
    `/boards/${boardId}/cards/${cardId}/file-binding/sync`,
    {
      ...(resolution ? { resolution } : {}),
      ...(expectedFileDigest ? { expectedFileDigest } : {}),
    },
  ),
  suggest: (
    boardId: string,
    sourceRefs: Array<{ cardId: string; versionId: string }>,
  ) => request<{ suggestions: V2Suggestion[] }>('POST', `/boards/${boardId}/suggestions`, { sourceRefs }),
  createTransformation: (
    boardId: string,
    body: {
      sourceRefs: Array<{ cardId: string; versionId: string }>
      label: string
      instruction: string
      acceptance: string
      modelId?: string
      targetPosition: { x: number; y: number }
    },
  ) =>
    request<{ transformation: Transformation; targetCard: ContentCard }>(
      'POST',
      `/boards/${boardId}/transformations`,
      body,
    ),
  createTransformations: (
    boardId: string,
    body: {
      sourceRefs: Array<{ cardId: string; versionId: string }>
      transformations: Array<{
        label: string
        instruction: string
        acceptance: string
        modelId?: string
        targetPosition: { x: number; y: number }
      }>
    },
  ) => request<{ transformations: Transformation[]; targetCards: ContentCard[] }>(
    'POST',
    `/boards/${boardId}/transformations/batch`,
    body,
  ),
  updateTransformation: (
    boardId: string,
    transformationId: string,
    body: {
      baseUpdatedAt: string
      label?: string
      instruction?: string
      acceptance?: string
      modelId?: string | null
      sourceRefs?: Array<{ cardId: string; versionId: string }>
    },
  ) => request<{ transformation: Transformation }>(
    'PATCH',
    `/boards/${boardId}/transformations/${transformationId}`,
    body,
  ),
  updateTransformationPosition: (
    boardId: string,
    transformationId: string,
    body: { x: number; y: number },
  ) => request<{ transformation: Transformation }>(
    'PATCH',
    `/boards/${boardId}/transformations/${transformationId}/position`,
    body,
  ),
  deleteTransformation: (boardId: string, transformationId: string) =>
    request<{ deletedTransformationId: string }>(
      'DELETE',
      `/boards/${boardId}/transformations/${transformationId}`,
    ),
  startRun: (boardId: string, transformationId: string) =>
    request<{ run: TransformationRun }>(
      'POST',
      `/boards/${boardId}/transformations/${transformationId}/runs`,
      {},
    ),
  getRun: (runId: string) => request<{ run: TransformationRun }>('GET', `/runs/${runId}`),
  interruptRun: (runId: string) =>
    request<{ run: TransformationRun }>('POST', `/runs/${runId}/interrupt`, {}),
  adoptCandidate: (runId: string, baseVersionId: string | null) =>
    request<{ card: ContentCard; run: TransformationRun }>(
      'POST',
      `/runs/${runId}/candidate/adopt`,
      { baseVersionId },
    ),
  discardCandidate: (runId: string) =>
    request<{ run: TransformationRun }>('POST', `/runs/${runId}/candidate/discard`, {}),
}
