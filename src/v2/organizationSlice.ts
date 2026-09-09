import type { Node, NodeChange } from '@xyflow/react'
import type { BoardV2, CanvasGroup, CardColor } from '../domain'
import { copyCards } from '../canvasOperations'
import { v2Api } from '../v2Api'
import type { CanvasStoreContext, BoardRequestContext } from './storeContext'
import {
  applyOrganizationResult, groupBounds, groupMoveRequest, GROUP_NODE_PREFIX,
  projectGroupFrames, transferCards, type OrganizationRequest,
} from './canvasOrganization'
import { userFacingStoreError } from './storePolicy'

export interface OrganizationActions {
  submitOrganization(request: OrganizationRequest, replay?: boolean): Promise<boolean>
  setSelectedCardColor(color: CardColor | null): Promise<boolean>
  createSelectedGroup(title: string): Promise<boolean>
  transferSelectedCards(groupId: string | null): Promise<boolean>
  updateGroup(groupId: string, changes: { title?: string; color?: CardColor | null }): Promise<boolean>
  dissolveGroup(groupId: string): Promise<boolean>
  selectGroup(groupId: string): void
  selectGroupCards(groupId: string): void
  copyGroup(groupId: string): void
  handleGroupChanges(changes: NodeChange[]): boolean
}

export function createOrganizationSlice(context: CanvasStoreContext): OrganizationActions {
  const { get, set, project, contextFor, setForBoard, contextIsCurrent, noticePatch, refreshBoard } = context
  let drag: { boardId: string; groupId: string; origin: { x: number; y: number }; nodes: Node[]; board: BoardV2; context: BoardRequestContext } | null = null

  async function submitOrganization(request: OrganizationRequest, replay = false): Promise<boolean> {
    const { boardId, board, organizationPending, historyState, saveState } = get()
    if (!boardId || !board || organizationPending || (!replay && (historyState === 'applying' || saveState === 'saving'))) return false
    const captured = contextFor(boardId)
    setForBoard(captured, { organizationPending: true, saveState: 'saving' })
    try {
      const result = await v2Api.updateOrganization(boardId, request)
      if (!contextIsCurrent(captured)) return false
      setForBoard(captured, (state) => {
        if (!state.board) return {}
        const next = applyOrganizationResult(state.board, request, result)
        return {
          board: next, ...project(next), saveState: 'saved',
          selectedGroupId: result.groups.some((group) => group.id === state.selectedGroupId) ? state.selectedGroupId : null,
          ...(!replay ? { historyPast: [...state.historyPast, { kind: 'organization' as const, boardId, request }].slice(-context.historyLimit), historyFuture: [] } : {}),
          ...noticePatch(state, 'success', '画布整理已保存。', { boardId }),
        }
      })
      return true
    } catch (error) {
      setForBoard(captured, (state) => ({
        ...(state.board ? project(state.board) : {}), saveState: 'error',
        ...noticePatch(state, 'error', userFacingStoreError(error), { boardId }),
      }))
      if ((error as { code?: string }).code === 'ORGANIZATION_CONFLICT') {
        await refreshBoard(captured).catch(() => {})
      }
      if (replay) throw error
      return false
    } finally {
      setForBoard(captured, { organizationPending: false })
    }
  }

  function replaceGroups(groups: CanvasGroup[]) {
    const baseGroups = get().board?.groups || []
    if (JSON.stringify(groups) === JSON.stringify(baseGroups)) return Promise.resolve(true)
    return submitOrganization({ groups, baseGroups })
  }

  return {
    submitOrganization,
    async setSelectedCardColor(color) {
      const { board, selectedCardIds } = get()
      if (!board || !selectedCardIds.length) return false
      const ids = new Set(selectedCardIds)
      const colors = board.cards.filter((card) => ids.has(card.id) && (card.color || null) !== color)
        .map((card) => ({ cardId: card.id, color, baseColor: card.color || null }))
      return colors.length ? submitOrganization({ colors }) : true
    },
    async createSelectedGroup(title) {
      const { selectedCardIds, board } = get()
      if (!board || !selectedCardIds.length || !title.trim()) return false
      const groups = transferCards(board.groups || [], selectedCardIds, null)
      return replaceGroups([...groups, { id: `group-${crypto.randomUUID()}`, title: title.trim(), cardIds: [...selectedCardIds] }])
    },
    async transferSelectedCards(groupId) {
      const { selectedCardIds, board } = get()
      if (!board || !selectedCardIds.length) return false
      if (groupId && !board.groups?.some((group) => group.id === groupId)) return false
      return replaceGroups(transferCards(board.groups || [], selectedCardIds, groupId))
    },
    async updateGroup(groupId, changes) {
      return replaceGroups((get().board?.groups || []).map((group) => {
        if (group.id !== groupId) return group
        const next = { ...group }
        if (changes.title !== undefined) next.title = changes.title.trim()
        if (changes.color === null) delete next.color
        else if (changes.color) next.color = changes.color
        return next
      }))
    },
    async dissolveGroup(groupId) {
      return replaceGroups((get().board?.groups || []).filter((group) => group.id !== groupId))
    },
    selectGroup(groupId) {
      const state = get()
      if (!state.board?.groups?.some((group) => group.id === groupId)) return
      state.clearSelection()
      set({ selectedGroupId: groupId })
      set({ ...project(state.board, state.runs, []) })
    },
    selectGroupCards(groupId) {
      const group = get().board?.groups?.find((group) => group.id === groupId)
      if (group) get().setSelectedCardIds(group.cardIds)
    },
    copyGroup(groupId) {
      const { board } = get()
      const group = board?.groups?.find((item) => item.id === groupId)
      if (!board || !group) return
      const clipboard = copyCards(board, group.cardIds)
      if (clipboard) set((state) => ({ clipboard: { ...clipboard, group: { title: group.title, ...(group.color ? { color: group.color } : {}) } },
        ...noticePatch(state, 'success', `已复制分组“${group.title}”。`) }))
    },
    handleGroupChanges(changes) {
      const moves = changes.filter((item): item is Extract<NodeChange, { type: 'position' }> =>
        item.type === 'position' && item.id.startsWith(GROUP_NODE_PREFIX) && Boolean(item.position))
      if (!moves.length) return false
      const { board, boardId, organizationPending, saveState, historyState } = get()
      if (!board || !boardId || organizationPending || saveState === 'saving' || historyState === 'applying') return true
      const move = moves[0]
      const groupId = move.id.slice(GROUP_NODE_PREFIX.length)
      const group = board.groups?.find((group) => group.id === groupId)
      if (!group || !move.position) { drag = null; return true }
      if (drag && !contextIsCurrent(drag.context)) { drag = null; return true }
      if (!drag || drag.boardId !== boardId || drag.groupId !== groupId) {
        const bounds = groupBounds(group, get().nodes)
        if (!bounds) return true
        drag = { boardId, groupId, origin: bounds, nodes: get().nodes, board: structuredClone(board), context: contextFor(boardId) }
      }
      const delta = { x: move.position.x - drag.origin.x, y: move.position.y - drag.origin.y }
      const request = groupMoveRequest(drag.board, drag.nodes, groupId, delta)
      const positions = new Map(request.positions!.map((item) => [item.kind === 'card' ? item.id : `transformation-node:${item.id}`, item]))
      const nodes = drag.nodes.filter((node) => node.type !== 'canvasGroup').map((node) => {
        const position = positions.get(node.id)
        return position ? { ...node, position: { x: position.x!, y: position.y! } } : node
      })
      set({ nodes: [...projectGroupFrames(board.groups || [], nodes, get().selectedGroupId), ...nodes] })
      if (move.dragging === false) {
        drag = null
        if (delta.x || delta.y) void submitOrganization(request)
      }
      return true
    },
  }
}
