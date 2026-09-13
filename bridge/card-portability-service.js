import { projectBoardArtifact, remapBoardArtifact, validateBoardArtifact } from './domain/board-artifact.js'
import { collectManagedPaths } from './domain/managed-assets.js'
import { assertBoardWritable } from './domain/board-lifecycle.js'
import { assertPortableByteLength, utf8JsonByteLength } from './domain/portable-format.js'
import { emptyBoardV2 } from './v2-board-store.js'
import { typed } from './domain/errors.js'

// One import is one ordinary create-history command; its undo uses the 100-card batch API.
const MAX_CARDS = 100
export function createCardPortabilityService({ boardStore, managedMaterials, committer, workspace, newId, now }) {
  const coordinator = boardStore.coordinator
  async function exportCards(boardId, { cardIds } = {}) {
    if (!Array.isArray(cardIds) || !cardIds.length || cardIds.length > MAX_CARDS || new Set(cardIds).size !== cardIds.length) throw typed('BOARD_EXPORT_INVALID', '请选择 1–100 张卡片。')
    return boardStore.withLockedBoard(boardId, async board => {
      const cards = cardIds.map(id => { const card = board.cards.find(item => item.id === id); if (!card) throw typed('CARD_NOT_FOUND', '所选卡片已不存在。'); return card })
      const left = Math.min(...cards.map(card => card.x)), top = Math.min(...cards.map(card => card.y))
      const selected = emptyBoardV2(board.id, board.title, now())
      selected.cards = cards.map(card => {
        const head = card.versions.find(version => version.id === card.headVersionId)
        return {
          id: card.id, ...(card.name ? { name: card.name } : {}), ...(card.color ? { color: card.color } : {}),
          ...(card.tags ? { tags: [...card.tags] } : {}), contentKind: card.contentKind,
          x: card.x - left, y: card.y - top, width: card.width, height: card.height,
          createdAt: now(), updatedAt: now(), headVersionId: head?.id || null,
          copiedFrom: { workspace: workspace?.id || 'legacy-workspace', board: board.id, card: card.id, version: head?.id || '' },
          versions: head ? [{ id: head.id, cardId: card.id, sequence: 1, content: structuredClone(head.content), digest: head.digest, origin: 'import', createdAt: now(), ...(head.materialOrigin ? { materialOrigin: structuredClone(head.materialOrigin) } : {}) }] : [],
        }
      })
      const artifact = projectBoardArtifact({ board: selected, runs: [], workflowProvenance: [], exportedAt: now() })
      artifact.formatVersion = 2; artifact.selection = true
      artifact.assets = managedMaterials ? await managedMaterials.export([...collectManagedPaths(artifact)]) : []
      validateBoardArtifact(artifact)
      assertPortableByteLength('mira-board', utf8JsonByteLength({ artifact }))
      return artifact
    })
  }
  async function importCards(boardId, { artifact, baseRevision, position } = {}) {
    assertPortableByteLength('mira-board', utf8JsonByteLength({ artifact }))
    validateBoardArtifact(artifact)
    if (artifact.selection !== true || artifact.formatVersion !== 2 || artifact.runs.length || artifact.board.transformations.length
      || artifact.board.groups?.length || artifact.workflowProvenance.length || artifact.board.cards.length < 1 || artifact.board.cards.length > MAX_CARDS
      || artifact.board.cards.some(card => card.versions.length > 1 || card.fileBinding || card.inspirationRef || card.extractionRef || !card.copiedFrom)
      || !Number.isSafeInteger(baseRevision) || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw typed('BOARD_IMPORT_INVALID', '所选卡片包或导入位置无效。')
    const remapped = remapBoardArtifact(artifact, { generateId: newId, now })
    return coordinator.withImport(lease => boardStore.withLockedBoard(boardId, async (current, boardLease) => {
      assertBoardWritable(current)
      if ((current.revision || 0) !== baseRevision) throw typed('BOARD_CONFLICT', '目标画板已变化，请重新核对。')
      const cards = remapped.board.cards.map(card => ({ ...card, x: card.x + position.x, y: card.y + position.y }))
      const next = { ...current, cards: [...current.cards, ...cards], revision: baseRevision + 1, updatedAt: now() }
      await committer.commit({ board: next, runs: [], assets: artifact.assets, previousBoard: current }, boardLease)
      return { board: next, cards }
    }, lease))
  }
  return { exportCards, importCards }
}
