import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react'
import type {
  BoardV2,
  ContentCard,
  InspirationEntry,
  TransformationRun,
  WorkflowTemplate,
  CreateWorkflowInputSlot,
} from '../domain'
import type { CanvasClipboard } from '../canvasOperations'
import type { CanvasAlignmentGuide } from '../canvasAlignment'
import type { BoardSummary, FileBindingStatus, V2Suggestion } from '../v2Api'
import type { InspirationCandidate, InspirationCapture } from './inspiration'
import type { AdHocPlanInput, WorkflowDraft } from './workflowDraft'
import type { Notice } from './noticePolicy'
import type { CheckpointActions } from './checkpointSlice'
import type { OrganizationActions } from './organizationSlice'
import type { OrganizationRequest } from './canvasOrganization'
import type { SourcePicker } from './sourceSlice'

export type DrawerState =
  | { tab: 'content'; cardId: string; mode?: 'read' | 'edit' | 'rename' }
  | { tab: 'versions'; cardId: string }
  | { tab: 'relation'; transformationId: string; edit?: boolean; preview?: boolean }
  | { tab: 'run'; runId: string }
  | null

export type PanelState = 'workflow' | 'plan' | 'model' | null

export type SaveAndCreateNextResult =
  | { status: 'created'; card: ContentCard }
  | { status: 'save-failed' | 'creation-failed' | 'creation-uncertain' | 'cancelled' | 'busy' }

export interface BranchDraft {
  sourceCardIds: string[]
  targetPosition: { x: number; y: number }
}

export interface CardGeometry {
  cardId: string
  x: number
  y: number
}

export type CanvasHistoryEntry =
  | { kind: 'organization'; boardId: string; request: OrganizationRequest }
  | { kind: 'move'; boardId: string; before: CardGeometry[]; after: CardGeometry[] }
  | { kind: 'content'; boardId: string; cardId: string; before: string; after: string }
  | { kind: 'create'; boardId: string; cardIds: string[]; restoreReceiptId?: string }
  | { kind: 'delete'; boardId: string; cardIds: string[]; restoreReceiptId: string }

export interface V2CanvasState extends CheckpointActions, OrganizationActions {
  sourcePicker: SourcePicker | null
  appendTransformationSources(transformationId: string, cardIds: string[]): Promise<boolean>
  beginSourcePicker(transformationId: string): void
  toggleSourcePickerCard(cardId: string): void
  cancelSourcePicker(): void
  confirmSourcePicker(): Promise<void>
  selectedGroupId: string | null
  organizationPending: boolean
  boardId: string | null
  board: BoardV2 | null
  boards: Array<{ id: string; title: string }>
  openedBoardIds: string[]
  pinnedBoardIds: string[]
  closingBoardId: string | null
  boardCatalog: BoardSummary[]
  boardCatalogState: 'idle' | 'loading' | 'ready' | 'error'
  boardCatalogError: string | null
  nodes: Node[]
  edges: Edge[]
  runs: Record<string, TransformationRun>
  workflows: WorkflowTemplate[]
  workflowState: 'idle' | 'loading' | 'ready' | 'error'
  applyingWorkflowId: string | null
  runningToTransformationId: string | null
  workflowDraft: WorkflowDraft | null
  selectedCardIds: string[]
  clipboard: CanvasClipboard | null
  alignmentGuides: CanvasAlignmentGuide[] | null
  deleteConfirmationIds: string[] | null
  multiSelectMode: boolean
  suggestions: V2Suggestion[]
  suggestionState: 'idle' | 'loading' | 'ready' | 'error'
  message: string | null
  notices: Notice[]
  editingCardId: string | null
  detailSurfaceRevision: number
  drawer: DrawerState
  panel: PanelState
  branchDraft: BranchDraft | null
  loadState: 'idle' | 'loading' | 'ready' | 'error'
  saveState: 'saved' | 'saving' | 'error'
  historyPast: CanvasHistoryEntry[]
  historyFuture: CanvasHistoryEntry[]
  historyState: 'idle' | 'applying'
  refreshWorkflows(): Promise<void>
  createWorkflowFromTransformation(
    transformationId: string,
    title: string,
    description?: string,
    inputs?: CreateWorkflowInputSlot[],
  ): Promise<WorkflowTemplate | undefined>
  deleteWorkflow(workflowId: string): Promise<void>
  beginWorkflowDraft(workflowId: string, origin?: { x: number; y: number }): void
  beginAdHocPlanDraft(plan: AdHocPlanInput, origin?: { x: number; y: number }): void
  cancelWorkflowDraft(): void
  bindWorkflowInput(inputId: string, cardIds: string[]): void
  unbindWorkflowInput(inputId: string, cardId: string): void
  bindSelectedCardsToWorkflowInput(inputId: string): void
  materializeWorkflowDraft(): Promise<void>
  load(): Promise<void>
  switchBoard(boardId: string): Promise<void>
  closeBoard(boardId: string): Promise<boolean>
  togglePinnedBoard(boardId: string): void
  createBoard(title: string): Promise<void>
  refreshBoardCatalog(): Promise<void>
  renameBoard(boardId: string, title: string, revision: number): Promise<void>
  archiveBoard(boardId: string, revision: number): Promise<void>
  trashBoard(boardId: string, revision: number): Promise<void>
  restoreBoard(boardId: string, revision: number): Promise<void>
  purgeBoard(boardId: string, revision: number): Promise<void>
  exportBoardFile(boardId: string): Promise<void>
  importBoardFile(file: File): Promise<void>
  backupMira(): Promise<void>
  createCard(position: { x: number; y: number; width?: number; height?: number }): Promise<ContentCard | null>
  createFileCard(position: { x: number; y: number }, path: string): Promise<void>
  bindCardFile(cardId: string, path: string, overwrite?: boolean): Promise<boolean>
  unbindCardFile(cardId: string): Promise<boolean>
  syncCardFile(cardId: string, resolution?: 'overwrite' | 'import'): Promise<boolean>
  refreshCardFileBinding(cardId: string): Promise<FileBindingStatus | null>
  addInspirationCards(
    selected: InspirationCandidate[],
    anchor: { x: number; y: number },
  ): Promise<string[] | undefined>
  recordInspiration(capture: InspirationCapture): Promise<InspirationEntry>
  updateCardTags(cardId: string, tags: string[]): Promise<boolean>
  renameCard(cardId: string, name: string | null, baseName: string | null): Promise<boolean>
  commitCard(cardId: string, markdown: string, baseVersionId?: string | null): Promise<boolean>
  saveAndCreateNext(cardId: string, markdown: string, baseVersionId: string | null): Promise<SaveAndCreateNextResult>
  copySelectedCards(): void
  pasteCards(position: { x: number; y: number }): Promise<void>
  duplicateSelectedCards(): Promise<void>
  requestDeleteSelectedCards(): void
  cancelDeleteSelectedCards(): void
  confirmDeleteSelectedCards(): Promise<void>
  selectAllCards(): void
  clearSelection(): void
  clearClipboard(): void
  toggleMultiSelectMode(): void
  onNodesChange(changes: NodeChange[]): void
  onEdgesChange(changes: EdgeChange[]): void
  onConnect(connection: Connection): Promise<void>
  requestSuggestions(): Promise<void>
  generate(suggestion: V2Suggestion): Promise<void>
  generateBranches(suggestions: V2Suggestion[]): Promise<void>
  updateTransformation(
    transformationId: string,
    changes: {
      label?: string
      instruction?: string
      acceptance?: string
      modelId?: string | null
      sourceCardIds?: string[]
    },
    baseUpdatedAt?: string,
  ): Promise<boolean>
  deleteTransformation(transformationId: string): Promise<boolean>
  runToTransformation(transformationId: string): Promise<void>
  rerunTransformation(transformationId: string): Promise<void>
  interruptRun(runId: string): Promise<void>
  adoptCandidate(runId: string, baseVersionId: string | null): Promise<boolean>
  discardCandidate(runId: string): Promise<boolean>
  refreshCandidate(runId: string): Promise<boolean>
  restoreVersion(cardId: string, versionId: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  setEditingCardId(cardId: string | null): void
  openDrawer(drawer: DrawerState): void
  openPanel(panel: PanelState): void
  reorderSources(fromIndex: number, toIndex: number): void
  removeSource(cardId: string): void
  setSelectedCardIds(cardIds: string[]): void
  beginBranch(draft: BranchDraft): void
  cancelBranch(): void
  clearMessage(): void
  dismissNotice(noticeId: string): void
  expireNotice(noticeId: string, expectedNotice: Notice): void
}
