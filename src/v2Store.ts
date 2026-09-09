import { create } from 'zustand'
import type { BoardV2, InspirationEntry } from './domain'
import type { V2CanvasState } from './v2/storeTypes'
import type { InspirationCapture } from './v2/inspiration'
import { createCanvasStoreContext } from './v2/storeContext'
import { createRunSlice } from './v2/runSlice'
import { createInspirationSlice } from './v2/inspirationSlice'
import { createBoardSlice } from './v2/boardSlice'
import { createCardSlice } from './v2/cardSlice'
import { createCanvasSlice } from './v2/canvasSlice'
import { createWorkflowSlice } from './v2/workflowSlice'
import { createTransformationSlice } from './v2/transformationSlice'
import { createOrganizationSlice } from './v2/organizationSlice'

export const useV2Canvas = create<V2CanvasState>()((set, get) => {
  const context = createCanvasStoreContext(set, get)
  const runSlice = createRunSlice(context)
  const inspirationSlice = createInspirationSlice({ ...context })
  return {
    boardId: null,
    board: null,
    boards: [],
    openedBoardIds: [],
    pinnedBoardIds: [],
    closingBoardId: null,
    boardCatalog: [],
    boardCatalogState: 'idle',
    boardCatalogError: null,
    nodes: [],
    edges: [],
    runs: {},
    workflows: [],
    workflowState: 'idle',
    applyingWorkflowId: null,
    runningToTransformationId: null,
    workflowDraft: null,
    sourcePicker: null,
    selectedCardIds: [],
    selectedGroupId: null,
    organizationPending: false,
    clipboard: null,
    alignmentGuides: null,
    deleteConfirmationIds: null,
    multiSelectMode: false,
    suggestions: [],
    suggestionState: 'idle',
    message: null,
    notices: [],
    editingCardId: null,
    detailSurfaceRevision: 0,
    drawer: null,
    panel: null,
    branchDraft: null,
    loadState: 'idle',
    saveState: 'saved',
    historyPast: [],
    historyFuture: [],
    historyState: 'idle',
    ...context.actions,
    ...createBoardSlice(context, runSlice),
    ...createCardSlice(context),
    ...createCanvasSlice(context),
    ...createWorkflowSlice(context),
    ...createTransformationSlice(context),
    ...createOrganizationSlice(context),
    ...runSlice.actions,
    async addInspirationCards(selected, anchor) {
      return inspirationSlice.addInspirationCards(selected, anchor)
    },

    async recordInspiration(capture: InspirationCapture) {
      const legacyCapture = arguments[1] as InspirationCapture | undefined
      return (legacyCapture
        ? inspirationSlice.recordInspiration(capture as unknown as BoardV2, legacyCapture)
        : inspirationSlice.recordInspiration(capture)) as Promise<InspirationEntry>
    },
  }
})
