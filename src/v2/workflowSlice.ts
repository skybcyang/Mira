import type { BoardV2 } from '../domain'
import { v2Api } from '../v2Api'
import { sourceRefsFor, targetPositionForSelection } from '../v2State'
import {
  cardHeadHasUsableContent,
  normalizeWorkflowContract,
  workflowExternalSources,
  workflowExtractionPreview,
  workflowExtractionReady,
} from '../workflows'
import {
  adHocPlanReady,
  collisionFreeWorkflowDraftOrigin,
  createAdHocWorkflowDraft,
  workflowDraftHasSourceConflict,
  workflowDraftReady,
  type AdHocPlanInput,
  type WorkflowDraft,
} from './workflowDraft'
import {
  resolveAsyncDetailSurface,
  transitionDetailSurface,
  userFacingStoreError as safeMessage,
} from './storePolicy'
import type { V2CanvasState } from './storeTypes'
import type { CanvasStoreContext } from './storeContext'

type WorkflowSliceDependencies = Pick<
  CanvasStoreContext,
  | 'set'
  | 'get'
  | 'contextFor'
  | 'contextIsCurrent'
  | 'setForBoard'
  | 'setNotice'
  | 'noticePatch'
  | 'project'
  | 'currentDetailSurface'
  | 'refreshBoard'
>

type WorkflowSliceActions = Pick<
  V2CanvasState,
  | 'refreshWorkflows'
  | 'createWorkflowFromTransformation'
  | 'deleteWorkflow'
  | 'beginWorkflowDraft'
  | 'beginAdHocPlanDraft'
  | 'cancelWorkflowDraft'
  | 'bindWorkflowInput'
  | 'unbindWorkflowInput'
  | 'bindSelectedCardsToWorkflowInput'
  | 'materializeWorkflowDraft'
>

export function createWorkflowSlice(
  context: WorkflowSliceDependencies,
): WorkflowSliceActions {
  const {
    set,
    get,
    contextFor,
    contextIsCurrent,
    setForBoard,
    setNotice,
    noticePatch,
    project,
    currentDetailSurface,
    refreshBoard,
  } = context

  function frozenWorkflowSourceRefs(
    board: BoardV2,
    draft: WorkflowDraft,
    inputId: string,
  ) {
    const frozenByCardId = new Map(
      (draft.bindingSourceRefs?.[inputId] || []).map((sourceRef) => [sourceRef.cardId, sourceRef]),
    )
    return (draft.bindings[inputId] || []).flatMap((cardId) => {
      const frozen = frozenByCardId.get(cardId)
      return frozen ? [frozen] : sourceRefsFor(board, [cardId])
    })
  }

  return {
    async refreshWorkflows() {
      set({ workflowState: 'loading' })
      try {
        const { workflows } = await v2Api.listWorkflows()
        set({ workflows, workflowState: 'ready' })
      } catch {
        set({ workflowState: 'error' })
      }
    },

    async createWorkflowFromTransformation(transformationId, title, description = '', inputs) {
      const { boardId, board } = get()
      const normalizedTitle = title.trim()
      if (!boardId || !board || !normalizedTitle) return undefined
      const context = contextFor(boardId)
      const preview = workflowExtractionPreview(board, transformationId)
      if (!workflowExtractionReady(board, transformationId, preview)) {
        const exists = board.transformations.some((item) => item.id === transformationId)
        const planned = board.transformations.some((item) =>
          item.id === transformationId && Boolean(item.planRef),
        )
        const message = !exists
          ? '这条成果关系已不在当前画板中。'
          : planned
            ? '请先完成整个计划，再保存为方法。'
            : preview.stopReason === 'cycle'
              ? '检测到循环关系，无法保存为方法。'
              : '请先完成这一步成果，再保存为方法。'
        setNotice(!exists || preview.stopReason === 'cycle' ? 'error' : 'attention', message, {
          boardId,
        })
        return undefined
      }
      setForBoard(context, { workflowState: 'loading' })
      try {
        const workflowInputs = inputs || workflowExternalSources(board, preview.chain).map((source) => ({
          sourceCardId: source.cardId,
          name: source.title,
          description: '',
          required: true,
          cardinality: 'one' as const,
        }))
        const { workflow } = await v2Api.createWorkflow({
          title: normalizedTitle,
          description: description.trim(),
          sourceBoardId: boardId,
          transformationIds: preview.chain.map((item) => item.id),
          inputs: workflowInputs,
        })
        if (!contextIsCurrent(context)) return undefined
        setForBoard(context, (state) => ({
          workflows: [...state.workflows.filter((item) => item.id !== workflow.id), workflow],
          workflowState: 'ready',
          ...noticePatch(
            state,
            'success',
            `已保存方法“${workflow.title}”（${workflow.steps.length} 步）。`,
            { boardId },
          ),
        }))
        return workflow
      } catch (error) {
        setForBoard(context, (state) => ({
          workflowState: 'error',
          ...noticePatch(state, 'error', safeMessage(error), { boardId }),
        }))
        return undefined
      }
    },

    async deleteWorkflow(workflowId) {
      try {
        await v2Api.deleteWorkflow(workflowId)
        set((state) => ({
          workflows: state.workflows.filter((item) => item.id !== workflowId),
          ...noticePatch(state, 'success', '方法已删除，已经添加的步骤不受影响。'),
        }))
      } catch (error) {
        setNotice('error', safeMessage(error))
      }
    },

    beginWorkflowDraft(workflowId, origin) {
      const { board, workflows, runs, selectedCardIds, applyingWorkflowId } = get()
      const workflow = workflows.find((item) => item.id === workflowId)
      if (!board || !workflow || applyingWorkflowId) return
      const selectedTarget = selectedCardIds.length > 0
        ? targetPositionForSelection(board, selectedCardIds)
        : undefined
      const requestedOrigin = selectedTarget
        ? { x: selectedTarget.x - 200, y: selectedTarget.y }
        : origin || { x: 120, y: 120 }
      const workflowDraft: WorkflowDraft = {
        workflowId,
        source: { kind: 'template', workflowId },
        definition: workflow,
        origin: collisionFreeWorkflowDraftOrigin(board, workflow, requestedOrigin),
        bindings: {},
        bindingSourceRefs: {},
      }
      set((state) => ({
        workflowDraft,
        ...project(board, runs, get().selectedCardIds, workflowDraft),
        ...transitionDetailSurface(currentDetailSurface(state), null, state.panel),
        branchDraft: null,
        ...noticePatch(
          state, 'info', `正在使用“${workflow.title}”，请连接需要的内容。`,
          { boardId: board.id },
        ),
      }))
    },

    beginAdHocPlanDraft(plan: AdHocPlanInput, origin) {
      const { board, runs, selectedCardIds, applyingWorkflowId } = get()
      if (!board || applyingWorkflowId || !adHocPlanReady(plan)) return
      const selectedTarget = selectedCardIds.length > 0
        ? targetPositionForSelection(board, selectedCardIds)
        : undefined
      const requestedOrigin = selectedTarget
        ? { x: selectedTarget.x - 200, y: selectedTarget.y }
        : origin || { x: 120, y: 120 }
      const draft = createAdHocWorkflowDraft(plan, requestedOrigin)
      const workflowDraft: WorkflowDraft = {
        ...draft,
        origin: collisionFreeWorkflowDraftOrigin(board, draft.definition, requestedOrigin),
      }
      set((state) => ({
        workflowDraft,
        ...project(board, runs, selectedCardIds, workflowDraft),
        ...transitionDetailSurface(currentDetailSurface(state), null, state.panel),
        branchDraft: null,
        ...noticePatch(
          state, 'info', `正在搭“${draft.definition.title}”，请连接起始内容。`,
          { boardId: board.id },
        ),
      }))
    },

    cancelWorkflowDraft() {
      const { board, runs, selectedCardIds, workflowDraft, applyingWorkflowId } = get()
      if (applyingWorkflowId) return
      set((state) => ({
        workflowDraft: null,
        ...(board ? project(board, runs, selectedCardIds, null) : {}),
        applyingWorkflowId: null,
        ...noticePatch(
          state,
          'info',
          workflowDraft?.source?.kind === 'ad-hoc'
            ? '已取消搭计划。'
            : '已取消使用方法。',
          board ? { boardId: board.id } : {},
        ),
      }))
    },

    bindWorkflowInput(inputId, cardIds) {
      set((state) => {
        if (state.applyingWorkflowId) return {}
        const workflowDraft = state.workflowDraft
        const workflow = workflowDraft?.definition || (workflowDraft
          ? state.workflows.find((item) => item.id === workflowDraft.workflowId)
          : undefined)
        if (!state.board || !workflowDraft || !workflow || cardIds.length === 0) return {}
        const input = normalizeWorkflowContract(workflow).inputs.find((item) => item.id === inputId)
        const usable = cardIds.filter((cardId) => cardHeadHasUsableContent(state.board!, cardId))
        if (!input || usable.length === 0) return {}
        const current = workflowDraft.bindings[inputId] || []
        const bound = input.cardinality === 'one'
          ? [usable[0]]
          : [...current, ...usable.filter((cardId) => !current.includes(cardId))]
        const explicitlyConfirmed = new Set(usable)
        const previousRefs = new Map(
          (workflowDraft.bindingSourceRefs?.[inputId] || []).map((sourceRef) =>
            [sourceRef.cardId, sourceRef]),
        )
        const bindingSourceRefs = bound.flatMap((cardId) => {
          if (!explicitlyConfirmed.has(cardId) && previousRefs.has(cardId)) {
            return [previousRefs.get(cardId)!]
          }
          return sourceRefsFor(state.board!, [cardId])
        })
        const nextDraft = {
          ...workflowDraft,
          bindings: { ...workflowDraft.bindings, [inputId]: bound },
          bindingSourceRefs: {
            ...workflowDraft.bindingSourceRefs,
            [inputId]: bindingSourceRefs,
          },
        }
        if (workflowDraftHasSourceConflict(workflow, nextDraft)) {
          return noticePatch(
            state,
            'attention',
            '同一张内容不能重复绑定到同一步，请换一张内容或移除已有绑定。',
            { boardId: state.board.id },
          )
        }
        return {
          workflowDraft: nextDraft,
          ...project(state.board, state.runs, state.selectedCardIds, nextDraft),
          ...noticePatch(state, 'info', `已绑定“${input.name}”。`, {
            boardId: state.board.id,
          }),
        }
      })
    },

    unbindWorkflowInput(inputId, cardId) {
      set((state) => {
        if (state.applyingWorkflowId || !state.board || !state.workflowDraft) return {}
        const nextDraft = {
          ...state.workflowDraft,
          bindings: {
            ...state.workflowDraft.bindings,
            [inputId]: (state.workflowDraft.bindings[inputId] || []).filter((id) => id !== cardId),
          },
          bindingSourceRefs: {
            ...state.workflowDraft.bindingSourceRefs,
            [inputId]: (state.workflowDraft.bindingSourceRefs?.[inputId] || [])
              .filter((sourceRef) => sourceRef.cardId !== cardId),
          },
        }
        return {
          workflowDraft: nextDraft,
          ...project(state.board, state.runs, state.selectedCardIds, nextDraft),
        }
      })
    },

    bindSelectedCardsToWorkflowInput(inputId) {
      get().bindWorkflowInput(inputId, get().selectedCardIds)
    },

    async materializeWorkflowDraft() {
      const { boardId, board, workflowDraft, workflows, applyingWorkflowId } = get()
      const workflow = workflowDraft?.definition || (workflowDraft
        ? workflows.find((item) => item.id === workflowDraft.workflowId)
        : undefined)
      if (applyingWorkflowId || !boardId || !board || !workflowDraft || !workflow
        || !workflowDraftReady(workflow, workflowDraft)) return
      const context = contextFor(boardId)
      const startedDetailSurface = currentDetailSurface()
      const contract = normalizeWorkflowContract(workflow)
      const noticeOperation = {
        operationId: `workflow-materialize:${workflow.id}`,
        boardId,
      }
      setForBoard(context, (state) => ({
        applyingWorkflowId: workflow.id,
        ...noticePatch(state, 'progress', `正在添加“${workflow.title}”的步骤…`, noticeOperation),
      }))
      try {
        const targetPosition = { x: workflowDraft.origin.x + 200, y: workflowDraft.origin.y }
        const result = workflowDraft.source?.kind === 'ad-hoc'
          ? await v2Api.createPlan(boardId, {
            title: workflow.title,
            sourceRefs: frozenWorkflowSourceRefs(
              board, workflowDraft, contract.inputs[0]?.id || '',
            ),
            steps: workflow.steps.map((step) => ({
              label: step.label,
              instruction: step.instruction,
              acceptance: step.acceptance,
              ...(step.modelId ? { modelId: step.modelId } : {}),
            })),
            targetPosition,
          })
          : await v2Api.applyWorkflow(boardId, workflow.id, {
            inputBindings: contract.inputs.map((input) => ({
              inputId: input.id,
              sourceRefs: frozenWorkflowSourceRefs(board, workflowDraft, input.id),
            })),
            targetPosition,
          })
        setForBoard(context, (state) => {
          if (!state.board) return { applyingWorkflowId: null }
          const cardIds = new Set(result.targetCards.map((item) => item.id))
          const transformationIds = new Set(result.transformations.map((item) => item.id))
          const nextBoard = {
            ...state.board,
            cards: [
              ...state.board.cards.filter((item) => !cardIds.has(item.id)),
              ...result.targetCards,
            ],
            transformations: [
              ...state.board.transformations.filter((item) => !transformationIds.has(item.id)),
              ...result.transformations,
            ],
          }
          const firstTransformation = result.transformations[0]
          const message = `已添加“${'workflow' in result ? result.workflow.title : result.title}”的 ${result.transformations.length} 个步骤，尚未生成。`
          return {
            board: nextBoard,
            ...project(nextBoard, state.runs, [], null),
            workflows: 'workflow' in result
              ? [
                ...state.workflows.filter((item) => item.id !== result.workflow.id),
                result.workflow,
              ]
              : state.workflows,
            selectedCardIds: [],
            deleteConfirmationIds: null,
            multiSelectMode: false,
            suggestions: [],
            suggestionState: 'idle' as const,
            branchDraft: null,
            applyingWorkflowId: null,
            workflowDraft: null,
            ...resolveAsyncDetailSurface(
              startedDetailSurface,
              currentDetailSurface(state),
              firstTransformation
                ? { tab: 'relation' as const, transformationId: firstTransformation.id }
                : null,
            ),
            ...noticePatch(state, 'success', message, noticeOperation),
          }
        })
      } catch (error) {
        if ((error as { code?: string })?.code === 'SOURCE_VERSION_CHANGED') {
          try {
            await refreshBoard(context)
          } catch {}
        }
        setForBoard(context, (state) => ({
          applyingWorkflowId: null,
          ...noticePatch(state, 'error', safeMessage(error), noticeOperation),
        }))
      }
    },
  }
}
