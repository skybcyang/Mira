import { describe, expect, it } from 'vitest'
import {
  createTransformationModelExecutor,
  httpStatusForCode,
  requestMethodHasJsonBody,
  recoverRunsAtBoot,
} from '../../bridge/main.js'

describe('bridge error status mapping', () => {
  it('parses JSON bodies for every mutating collection method, including DELETE', () => {
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(requestMethodHasJsonBody))
      .toEqual([true, true, true, true])
    expect(requestMethodHasJsonBody('GET')).toBe(false)
  })

  it('distinguishes missing data, conflicts, invalid run input, and unavailable startup', () => {
    expect(httpStatusForCode('BOARD_NOT_FOUND')).toBe(404)
    expect(httpStatusForCode('BOARD_CONFLICT')).toBe(409)
    expect(httpStatusForCode('BOARD_READ_ONLY')).toBe(409)
    expect(httpStatusForCode('BOARD_PURGE_INVALID')).toBe(409)
    expect(httpStatusForCode('BOARD_PURGE_FAILED')).toBe(500)
    expect(httpStatusForCode('BOARD_ID_REUSED')).toBe(409)
    expect(httpStatusForCode('BOARD_V2_READ_FAILED')).toBe(500)
    expect(httpStatusForCode('RUN_SOURCE_MISMATCH')).toBe(400)
    expect(httpStatusForCode('RUN_CORRUPT')).toBe(500)
    expect(httpStatusForCode('RUN_READ_FAILED')).toBe(500)
    expect(httpStatusForCode('RUN_WRITE_FAILED')).toBe(500)
    expect(httpStatusForCode('CARD_CONTENT_KIND_MISMATCH')).toBe(400)
    expect(httpStatusForCode('CARD_RESTORE_CONFLICT')).toBe(409)
    expect(httpStatusForCode('CANDIDATE_PENDING')).toBe(409)
    expect(httpStatusForCode('TRANSFORMATION_CONFLICT')).toBe(409)
    expect(httpStatusForCode('VERSION_RESTORE_SOURCE_REQUIRED')).toBe(400)
    expect(httpStatusForCode('RUN_RECOVERY_FAILED')).toBe(503)
    expect(httpStatusForCode('MODEL_UNAVAILABLE')).toBe(503)
    expect(httpStatusForCode('WORKFLOW_READ_FAILED')).toBe(500)
    expect(httpStatusForCode('WORKFLOW_PLAN_INCOMPLETE')).toBe(409)
    expect(httpStatusForCode('BOARD_EXPORT_INVALID')).toBe(422)
    expect(httpStatusForCode('BOARD_IMPORT_INVALID')).toBe(422)
    expect(httpStatusForCode('BACKUP_INVALID')).toBe(422)
    expect(httpStatusForCode('PAYLOAD_TOO_LARGE')).toBe(413)
    expect(httpStatusForCode('BACKUP_TOO_LARGE')).toBe(413)
    expect(httpStatusForCode('EXPORT_BUSY')).toBe(409)
    expect(httpStatusForCode('BOARD_IMPORT_COLLISION')).toBe(409)
    expect(httpStatusForCode('BOARD_IMPORT_WRITE_FAILED')).toBe(500)
    expect(httpStatusForCode('BOARD_IMPORT_ROLLBACK_FAILED')).toBe(503)
    expect(httpStatusForCode('BOARD_IMPORT_RECOVERY_FAILED')).toBe(503)
    expect(httpStatusForCode('BOARD_IMPORT_JOURNAL_INVALID')).toBe(503)
    expect(httpStatusForCode('IMPORT_ID_RESERVED')).toBe(409)
    expect(httpStatusForCode('IMPORT_RESERVATION_INVALID')).toBe(500)
    expect(httpStatusForCode('STORAGE_LEASE_INVALID')).toBe(500)
    expect(httpStatusForCode('WORKSPACE_LOCKED')).toBe(409)
    expect(httpStatusForCode('PORTABLE_DATA_INVALID')).toBe(422)
    expect(httpStatusForCode('PORTABLE_FORMAT_INVALID')).toBe(422)
    expect(httpStatusForCode('PORTABLE_PATH_INVALID')).toBe(422)
    expect(httpStatusForCode('PORTABLE_SERIALIZATION_INVALID')).toBe(422)
    expect(httpStatusForCode('UNCLASSIFIED_FAILURE')).toBe(500)
  })

  it('reconciles committed Candidates before interrupting active Runs at boot', async () => {
    const order = []
    const handlers = {
      reconcileAppliedCandidates: async () => {
        order.push('reconcile')
        return [{ id: 'run-candidate' }]
      },
    }
    const runStore = {
      markBootInterrupted: async () => {
        order.push('interrupt')
        return [{ id: 'run-running' }]
      },
    }

    await expect(recoverRunsAtBoot({ handlers, runStore })).resolves.toEqual({
      reconciled: [{ id: 'run-candidate' }],
      interrupted: [{ id: 'run-running' }],
    })
    expect(order).toEqual(['reconcile', 'interrupt'])
  })

  it('forwards Run progress from the production model adapter', async () => {
    const execute = async (input) => input
    const adapter = createTransformationModelExecutor(execute)
    const onProgress = async () => {}
    const signal = new AbortController().signal

    await expect(adapter({
      boardId: 'board-1',
      transformation: { id: 'transformation-1', instruction: '整理材料' },
      prompt: 'frozen prompt',
      signal,
      onProgress,
    })).resolves.toMatchObject({
      boardId: 'board-1',
      subject: { id: 'transformation-1', goal: '整理材料' },
      prompt: 'frozen prompt',
      signal,
      onProgress,
    })
  })
})
