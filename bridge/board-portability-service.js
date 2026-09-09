import {
  projectBoardArtifact,
  remapBoardArtifact,
  validateBoardArtifact,
} from './domain/board-artifact.js'
import {
  assertPortableByteLength,
  utf8JsonByteLength,
} from './domain/portable-format.js'
import { typed } from './domain/errors.js'

const ACTIVE_RUN_STATUSES = new Set(['queued', 'running'])

function toWorkflowProvenance(workflow) {
  return {
    workflowId: workflow.id,
    title: workflow.title,
    description: workflow.description,
    ...(Object.prototype.hasOwnProperty.call(workflow, 'inputs')
      ? { inputs: structuredClone(workflow.inputs) }
      : {}),
    steps: structuredClone(workflow.steps),
  }
}

export function createBoardPortabilityService({
  boardStore,
  runStore,
  workflowStore,
  committer,
  newId,
  now = () => new Date().toISOString(),
  measureJsonByteLength = utf8JsonByteLength,
} = {}) {
  if (
    !boardStore
    || !runStore
    || !workflowStore
    || !committer
    || typeof newId !== 'function'
    || typeof measureJsonByteLength !== 'function'
  ) {
    throw new TypeError('Board portability requires Board, Run, Workflow, import, and ID services')
  }

  async function exportBoard(boardId, lease) {
    return boardStore.withLockedBoard(boardId, async (board) => {
      const runs = (await runStore.listStrict()).filter((run) => run.boardId === board.id)
      if (runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
        throw typed('EXPORT_BUSY', `Board ${board.id} has an active Run`)
      }

      const workflowIds = [...new Set(board.transformations
        .map((transformation) => transformation.workflowRef?.workflowId)
        .filter(Boolean))]
      const workflowProvenance = []
      for (const workflowId of workflowIds) {
        try {
          workflowProvenance.push(toWorkflowProvenance(await workflowStore.load(workflowId)))
        } catch (error) {
          if (error?.code !== 'WORKFLOW_NOT_FOUND') throw error
        }
      }

      const artifact = projectBoardArtifact({
        board,
        runs,
        workflowProvenance,
        exportedAt: now(),
      })
      assertPortableByteLength('mira-board', measureJsonByteLength({ artifact }))
      return artifact
    }, ...(lease === undefined ? [] : [lease]))
  }

  async function importBoard(input = {}) {
    validateBoardArtifact(input.artifact)
    const remapped = remapBoardArtifact(input.artifact, {
      generateId: (kind) => newId(kind),
      now,
    })
    await committer.commit({ board: remapped.board, runs: remapped.runs })
    return {
      boardId: remapped.board.id,
      board: remapped.board,
      imported: {
        runCount: remapped.runs.length,
        externalReferenceCount: remapped.externalReferences.length,
      },
    }
  }

  return Object.freeze({ exportBoard, importBoard })
}
