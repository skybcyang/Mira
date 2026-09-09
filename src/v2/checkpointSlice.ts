import type {
  BoardArtifactV1,
  BoardCheckpointSummary,
  BoardCheckpointV1,
  BoardV2,
  TransformationRun,
} from '../domain'
import {
  v2Api,
  type BoardCheckpointListResult,
  type BoardImportResult,
} from '../v2Api'
import { mergeCheckpointPreviewRuns } from './checkpointPreviewRuns'

export interface CheckpointActions {
  listBoardCheckpoints(boardId: string): Promise<BoardCheckpointListResult>
  loadBoardCheckpoint(
    boardId: string,
    checkpointId: string,
    current?: { board: BoardV2; runs: Record<string, TransformationRun> },
  ): Promise<{
    checkpoint: BoardCheckpointV1
    board: BoardV2
    runs: Record<string, TransformationRun>
  }>
  createBoardCheckpoint(
    boardId: string,
    body: { title: string; note?: string; baseRevision: number },
  ): Promise<BoardCheckpointV1>
  updateBoardCheckpoint(
    boardId: string,
    checkpointId: string,
    body: { title?: string; note?: string | null; baseMetadataUpdatedAt: string },
  ): Promise<BoardCheckpointV1>
  deleteBoardCheckpoint(boardId: string, checkpointId: string): Promise<void>
  forkBoardCheckpoint(
    boardId: string,
    checkpointId: string,
    title?: string,
    canNavigate?: () => boolean,
  ): Promise<string>
  exportBoardCheckpoint(
    boardId: string,
    checkpointId: string,
    fileTitle: string,
  ): Promise<void>
}

interface CheckpointSliceDependencies {
  integrateFork(
    result: BoardImportResult,
    checkpointTitle: string,
    canNavigate?: () => boolean,
  ): Promise<void>
  captureForkIntegration?(): CheckpointSliceDependencies['integrateFork']
  downloadArtifact(artifact: BoardArtifactV1, fileTitle: string): void
  notify?(message: string, boardId: string): void
}

export function createCheckpointSlice({
  integrateFork,
  captureForkIntegration,
  downloadArtifact,
  notify = () => undefined,
}: CheckpointSliceDependencies): CheckpointActions {
  return {
    async listBoardCheckpoints(boardId) {
      return v2Api.listCheckpoints(boardId)
    },

    async loadBoardCheckpoint(boardId, checkpointId, current) {
      const { checkpoint, current: remote } = await v2Api.getCheckpoint(boardId, checkpointId)
      const local = current?.board.id === boardId ? current : undefined
      return {
        checkpoint,
        board: local?.board ?? remote.board,
        runs: mergeCheckpointPreviewRuns(
          boardId,
          Object.fromEntries(remote.runs.map((run) => [run.id, run])),
          local?.runs,
        ),
      }
    },

    async createBoardCheckpoint(boardId, body) {
      const checkpoint = (await v2Api.createCheckpoint(boardId, body)).checkpoint
      notify(`已保存画布版本“${checkpoint.title}”。`, boardId)
      return checkpoint
    },

    async updateBoardCheckpoint(boardId, checkpointId, body) {
      const checkpoint = (await v2Api.updateCheckpoint(boardId, checkpointId, body)).checkpoint
      notify(`已更新画布版本“${checkpoint.title}”。`, boardId)
      return checkpoint
    },

    async deleteBoardCheckpoint(boardId, checkpointId) {
      await v2Api.deleteCheckpoint(boardId, checkpointId)
      notify('已删除画布版本。', boardId)
    },

    async forkBoardCheckpoint(boardId, checkpointId, title, canNavigate) {
      const integrate = captureForkIntegration?.() ?? integrateFork
      const checkpointTitle = (await v2Api.getCheckpoint(boardId, checkpointId)).checkpoint.title
      const result = await v2Api.forkCheckpoint(
        boardId,
        checkpointId,
        title ? { title } : {},
      )
      try {
        await integrate(result, checkpointTitle, canNavigate)
      } catch {
        // The fork is durable once POST resolves; reconciliation errors are reported by the Store.
      }
      return result.boardId
    },

    async exportBoardCheckpoint(boardId, checkpointId, fileTitle) {
      downloadArtifact(await v2Api.exportCheckpoint(boardId, checkpointId), fileTitle)
    },
  }
}
