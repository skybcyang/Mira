import { appendVersion, restoreVersion } from './domain/versioning.js'
import { normalizeCardName } from './domain/card-name.js'
import { summarizeBoardActivity } from './domain/board-activity.js'
import { poolSnapshotInput } from './inspiration-pool-http.js'
import { digestText } from './domain/content.js'
import { createFileBindingService } from './domain/file-binding.js'
import { createSourceSnapshots, createTransformationRun } from './domain/snapshots.js'
import { validateBoardV2 } from './domain/validation.js'
import { assertSourcesDoNotCloseCycle } from './domain/transformation-sources.js'
import { applyOrganization, normalizeNewGroup, removeGroupMembers, requireCardColor, restoreGroupMembers, validateGroups } from './domain/organization.js'
import {
  adoptCandidate as applyCandidate,
  discardCandidate as discardRunCandidate,
} from './domain/runApplication.js'
import {
  assertBaseRevision,
  assertBoardPurgeable,
  assertBoardHasNoBlockingRuns,
  normalizeBoardTitle,
  renameBoard as renameBoardRecord,
  requireBaseRevision,
  transitionBoardLifecycle,
} from './domain/board-lifecycle.js'
import {
  ACTIVE_RUN_STATUSES,
  FALLBACK_MULTI,
  FALLBACK_SINGLE,
  appendRunProgress,
  appendTerminalRunProgress,
  buildModelPrompt,
  cardById,
  cardIsRelated,
  nextUpdatedAt,
  normalizeCardPlacement,
  normalizeInspirationRef,
  normalizeTags,
  parseSuggestions,
  requireNonEmptyBatch,
  requireUniqueIds,
  resolveCreateCardPlacement,
  transformationById,
  typed,
  validateSourceRefs,
} from './v2-http-policy.js'

export function createV2Handlers({
  store,
  runStore,
  newId,
  newRestoreReceiptId = () => {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
      throw new Error('Secure restore receipt generation is unavailable')
    }
    return `restore-receipt-${globalThis.crypto.randomUUID()}`
  },
  now = () => new Date().toISOString(),
  readFileContent = async () => {
    throw typed('SOURCE_READ_FAILED', 'File content reader is unavailable')
  },
  executeSuggestion,
  executeModel,
  resolveModel,
  fs,
  checkpointStore,
  inspirationPoolStore,
}) {
  const controllers = new Map()
  const deletedCardReceiptsByBoard = new Map()
  const fileBinding = fs ? createFileBindingService({ fs, newId, now }) : null

  async function syncBoundCard(card, options = {}) {
    if (!card.fileBinding) return { card, fileSync: { status: 'unbound' } }
    if (!fileBinding) {
      return { card, fileSync: { status: 'error', path: card.fileBinding.path, message: '文件同步不可用' } }
    }
    return fileBinding.sync(card, options)
  }

  function modelOverride(value, { allowNull = false } = {}) {
    if (allowNull && value === null) return null
    if (typeof value !== 'string' || !value.trim()) {
      throw typed('TRANSFORMATION_INVALID', '模型 ID 必须是非空字符串')
    }
    return value.trim()
  }

  function issueRestoreReceiptId(boardId) {
    const receipts = deletedCardReceiptsByBoard.get(boardId)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const receiptId = newRestoreReceiptId()
      if (typeof receiptId === 'string' && receiptId.trim() && !receipts?.has(receiptId.trim())) {
        return receiptId.trim()
      }
    }
    throw new Error('Could not issue a unique restore receipt')
  }

  function rememberDeletedCards(boardId, receiptId, cards, affectedGroups) {
    let receipts = deletedCardReceiptsByBoard.get(boardId)
    if (!receipts) {
      receipts = new Map()
      deletedCardReceiptsByBoard.set(boardId, receipts)
    }
    receipts.set(receiptId, structuredClone({ cards, affectedGroups }))
    while (receipts.size > 50) receipts.delete(receipts.keys().next().value)
  }

  async function withMutationLease(operation, lease) {
    if (typeof store.coordinator?.withMutation === 'function') {
      return store.coordinator.withMutation(operation, lease)
    }
    return operation(lease)
  }

  async function changeBoard(boardId, change, lease) {
    let result
    await withMutationLease(async (mutationLease) => {
      await store.update(boardId, async (board) => {
        result = await change(board, mutationLease)
        board.updatedAt = now()
        return board
      }, mutationLease)
    }, lease)
    return result
  }

  function normalizeCreateCardInput(body) {
    const name = Object.prototype.hasOwnProperty.call(body, 'name') ? { name: normalizeCardName(body.name) } : {}
    if (Object.prototype.hasOwnProperty.call(body, 'poolSource')) {
      throw typed('BAD_REQUEST', 'Pool snapshots use the verified card batch endpoint')
    }
    const color = Object.prototype.hasOwnProperty.call(body, 'color') ? { color: requireCardColor(body.color) } : {}
    if (Object.prototype.hasOwnProperty.call(body, 'placement')) {
      const placement = normalizeCardPlacement(body.placement)
      const forbidden = ['x', 'y', 'width', 'height', 'filePath', 'readonly', 'inspirationRef']
      if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
        throw typed('BAD_REQUEST', 'Board-bottom placement owns geometry and provenance')
      }
      if (
        (body.contentKind !== undefined && body.contentKind !== 'markdown')
        || typeof body.markdown !== 'string'
        || !body.markdown.trim()
      ) {
        throw typed('BAD_REQUEST', 'Board-bottom placement requires non-empty markdown')
      }
      return {
        ...color,
        ...name,
        contentKind: 'markdown',
        markdown: body.markdown.trim(),
        placement,
        ...(Object.prototype.hasOwnProperty.call(body, 'tags')
          ? { tags: normalizeTags(body.tags) }
          : {}),
      }
    }

    const input = { ...body, ...name }
    if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
      input.tags = normalizeTags(body.tags)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'inspirationRef')) {
      input.inspirationRef = normalizeInspirationRef(body.inspirationRef)
    }
    return input
  }

  function createCardRecord(body) {
    const cardId = newId('card')
    const timestamp = now()
    let card = {
      id: cardId,
      ...(body.name ? { name: body.name } : {}),
      contentKind: body.filePath ? 'file-reference' : 'markdown',
      x: Number.isFinite(body.x) ? body.x : 0,
      y: Number.isFinite(body.y) ? body.y : 0,
      width: Number.isFinite(body.width) ? body.width : 312,
      height: Number.isFinite(body.height) ? body.height : 208,
      ...(Object.prototype.hasOwnProperty.call(body, 'tags') ? { tags: [...body.tags] } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'color') ? { color: body.color } : {}),
      ...(body.inspirationRef ? { inspirationRef: { ...body.inspirationRef } } : {}),
      headVersionId: null,
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const content = body.filePath
      ? {
          kind: 'file-reference',
          path: body.filePath,
          readonly: body.readonly !== false,
        }
      : { kind: 'markdown', markdown: String(body.markdown || '') }
    if (content.kind === 'file-reference' || content.markdown.trim()) {
      card = appendVersion(card, {
        baseVersionId: null,
        versionId: newId('version'),
        content,
        origin: 'human',
        createdAt: timestamp,
      })
    }
    return card
  }

  async function validateCreateCardBatch(body) {
    const cards = requireNonEmptyBatch(body?.cards, 'cards')
    const usesPool = cards.some((card) => card && Object.prototype.hasOwnProperty.call(card, 'poolSource'))
    if (usesPool && !inspirationPoolStore) throw typed('INSPIRATION_UNAVAILABLE', '灵感池暂时不可用。')
    const pool = usesPool ? await inspirationPoolStore.load() : null
    const normalized = []
    for (const card of cards) {
      if (!card || typeof card !== 'object' || Array.isArray(card)) {
        throw typed('BAD_REQUEST', 'Every card must be an object')
      }
      if (Object.prototype.hasOwnProperty.call(card, 'poolSource')) {
        normalized.push(poolSnapshotInput(pool, card))
        continue
      }
      if (Object.prototype.hasOwnProperty.call(card, 'placement')) {
        throw typed('BAD_REQUEST', 'Automatic card placement is only available for single-card creation')
      }
      if (!Number.isFinite(card.x) || !Number.isFinite(card.y)) {
        throw typed('BAD_REQUEST', 'Every pasted card requires finite coordinates')
      }
      if (card.contentKind === 'file-reference' && !String(card.filePath || '').trim()) {
        throw typed('BAD_REQUEST', 'A file-reference card requires a file path')
      }
      if (card.contentKind && !['markdown', 'file-reference'].includes(card.contentKind)) {
        throw typed('BAD_REQUEST', 'Unsupported card content kind')
      }
      normalized.push(normalizeCreateCardInput(card))
    }
    return normalized
  }

  async function saveRunReliably(run, lease, attempts = 3) {
    let lastError
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await runStore.save(run, lease)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  async function assertTargetIdle(boardId, targetCardId) {
    const runs = await runStore.list()
    const busy = runs.some(
      (run) =>
        run.boardId === boardId &&
        run.targetCardId === targetCardId &&
        ACTIVE_RUN_STATUSES.has(run.status),
    )
    if (busy) throw typed('TARGET_BUSY', '这个成果正在生成中')
    const candidatePending = runs.some(
      (run) =>
        run.boardId === boardId &&
        run.targetCardId === targetCardId &&
        run.status === 'succeeded' &&
        run.result?.disposition === 'candidate',
    )
    if (candidatePending) {
      throw typed('CANDIDATE_PENDING', '请先采用或舍弃这个成果的候选结果')
    }
  }

  async function changeIdleTransformation(boardId, transformationId, change) {
    return changeBoard(boardId, async (board) => {
      const current = transformationById(board, transformationId)
      return runStore.withTargetLock(boardId, current.targetCardId, async () => {
        await assertTargetIdle(boardId, current.targetCardId)
        return change(board, current)
      })
    })
  }

  async function changeBoardLifecycle(boardId, body, command) {
    const baseRevision = requireBaseRevision(body)
    const board = await store.updateMetadata(boardId, async (current) => {
      assertBaseRevision(current, baseRevision)
      const timestamp = now()
      if (command === 'archive' || command === 'trash') {
        const candidate = structuredClone(current)
        transitionBoardLifecycle(candidate, command, timestamp)
        assertBoardHasNoBlockingRuns(await runStore.list(), boardId)
      }
      transitionBoardLifecycle(current, command, timestamp)
      return current
    })
    return { board }
  }

  function assertFrozenRunIsCurrent(board, transformationId, run, frozenTransformation) {
    const latest = transformationById(board, transformationId)
    const snapshotIds = run.sourceSnapshot.map((snapshot) => snapshot.cardId)
    if (
      latest.targetCardId !== run.targetCardId ||
      latest.sourceCardIds.length !== snapshotIds.length ||
      latest.sourceCardIds.some((cardId, index) => cardId !== snapshotIds[index]) ||
      latest.label !== frozenTransformation.label ||
      latest.instruction !== frozenTransformation.instruction ||
      latest.acceptance !== frozenTransformation.acceptance ||
      latest.modelId !== frozenTransformation.modelId
    ) {
      throw typed('RUN_SOURCE_MISMATCH', 'Transformation changed before the run started')
    }
    for (const snapshot of run.sourceSnapshot) {
      if (cardById(board, snapshot.cardId).headVersionId !== snapshot.versionId) {
        throw typed('SOURCE_VERSION_CHANGED', `Source ${snapshot.cardId} has changed`)
      }
    }
    if (cardById(board, run.targetCardId).headVersionId !== run.targetBaseVersionId) {
      throw typed('CARD_VERSION_CONFLICT', 'Target changed before the run started')
    }
  }

  async function executeRun(run, transformation) {
    let controller
    try {
      controller = new AbortController()
      controllers.set(run.id, controller)
      if (!executeModel) throw typed('MODEL_UNAVAILABLE', '内容生成服务当前不可用')
      const onProgress = async (summary) => {
        await runStore.withLockedRun(run.id, async (currentRun, runLease) => {
          if (currentRun.status !== 'running' || controller.signal.aborted) return
          const nextRun = appendRunProgress(currentRun, summary, now())
          if (nextRun === currentRun) return
          await saveRunReliably(nextRun, runLease)
        })
      }
      const result = await executeModel({
        boardId: run.boardId,
        transformation,
        sourceSnapshot: run.sourceSnapshot,
        prompt: buildModelPrompt(transformation, run.sourceSnapshot),
        signal: controller.signal,
        onProgress,
        ...(run.modelSnapshot ? { modelSnapshot: run.modelSnapshot } : {}),
      })
      if (controller.signal.aborted) return
      const output = String(result?.outputText || '').trim()
      if (!output) throw typed('EMPTY_OUTPUT', '模型没有返回可用内容')

      await runStore.withLockedRun(run.id, async (currentRun, runLease) => {
        if (currentRun.status !== 'running' || controller.signal.aborted) return
        const finishedAt = now()
        const candidateRun = appendTerminalRunProgress({
          ...currentRun,
          status: 'succeeded',
          result: {
            output,
            digest: digestText(output),
            disposition: 'candidate',
          },
          finishedAt,
        }, 'succeeded', finishedAt)
        await saveRunReliably(candidateRun, runLease)
        if (controller.signal.aborted) return

        let appliedVersionId
        await changeBoard(currentRun.boardId, async (board) => {
          if (controller.signal.aborted) return
          const target = cardById(board, currentRun.targetCardId)
          const existing = target.versions.find(
            (version) => version.sourceRunId === currentRun.id,
          )
          if (existing) {
            appliedVersionId = existing.id
          } else if (target.headVersionId === currentRun.targetBaseVersionId) {
            const applied = applyCandidate(target, candidateRun, {
              baseVersionId: currentRun.targetBaseVersionId,
              versionId: newId('version'),
              createdAt: finishedAt,
            })
            const synced = await syncBoundCard(applied.card)
            board.cards = board.cards.map((card) =>
              card.id === target.id ? synced.card : card,
            )
            appliedVersionId = applied.run.result.appliedVersionId
          }
          if (appliedVersionId) {
            board.transformations = board.transformations.map((item) =>
              item.id === currentRun.transformationId
                ? {
                    ...item,
                    lastAppliedRunId: currentRun.id,
                    updatedAt: nextUpdatedAt(item.updatedAt, finishedAt),
                  }
                : item,
            )
          }
        }, runLease)
        if (!appliedVersionId) return
        await saveRunReliably({
          ...candidateRun,
          result: {
            ...candidateRun.result,
            disposition: 'applied',
            appliedVersionId,
          },
        }, runLease)
      })
    } catch (error) {
      if (controller?.signal.aborted) return
      try {
        await runStore.withLockedRun(run.id, async (currentRun, runLease) => {
          if (currentRun.status !== 'running') {
            if (
              error?.code === 'RUN_WRITE_FAILED' &&
              currentRun.status === 'succeeded' &&
              currentRun.result?.disposition === 'candidate'
            ) {
              console.error(
                `[mira] Run ${run.id} remains a recoverable Candidate after final persistence failed:`,
                error,
              )
            }
            return
          }
          const status = error?.code === 'RUN_INTERRUPTED' ? 'interrupted' : 'failed'
          const finishedAt = now()
          const failed = appendTerminalRunProgress({
            ...currentRun,
            status,
            error: {
              code: error?.code || 'MODEL_EXECUTION_FAILED',
              message: error?.message || String(error),
              retryable: ['MODEL_TIMEOUT', 'RATE_LIMIT', 'MODEL_EXECUTION_FAILED'].includes(
                error?.code,
              ),
            },
            finishedAt,
          }, status, finishedAt)
          try {
            await saveRunReliably(failed, runLease)
          } catch (persistError) {
            console.error(`[mira] Run ${run.id} failure could not be persisted:`, persistError)
          }
        })
      } catch (persistError) {
        console.error(`[mira] Run ${run.id} failure could not be resolved:`, persistError)
      }
    } finally {
      controllers.delete(run.id)
    }
  }

  return {
    async getBoardActivity() {
      const runs = await (runStore.listStrict ? runStore.listStrict() : runStore.list())
      return { activity: summarizeBoardActivity(runs) }
    },
    async renameBoard(boardId, body) {
      const title = normalizeBoardTitle(body?.title)
      const baseRevision = requireBaseRevision(body)
      const board = await store.updateMetadata(boardId, async (current) => {
        assertBaseRevision(current, baseRevision)
        renameBoardRecord(current, title)
        return current
      })
      return { board }
    },

    archiveBoard(boardId, body) {
      return changeBoardLifecycle(boardId, body, 'archive')
    },

    trashBoard(boardId, body) {
      return changeBoardLifecycle(boardId, body, 'trash')
    },

    restoreBoard(boardId, body) {
      return changeBoardLifecycle(boardId, body, 'restore')
    },

    async purgeBoard(boardId, body) {
      const baseRevision = requireBaseRevision(body)
      const result = await store.purge(boardId, async (board) => {
        assertBaseRevision(board, baseRevision)
        assertBoardPurgeable(board, body?.confirmation)
        const runs = await (typeof runStore.listStrict === 'function'
          ? runStore.listStrict()
          : runStore.list())
        assertBoardHasNoBlockingRuns(runs, boardId)
        const boardRuns = runs.filter((run) => run?.boardId === boardId)
        const checkpointEntries = checkpointStore
          ? await checkpointStore.entriesForBoard(boardId)
          : []
        const checkpointPaths = checkpointEntries.map(({ path }) => path)
        const deletedCheckpointIds = checkpointEntries.map(({ id }) => id)
        return {
          paths: [
            ...boardRuns.map((run) => runStore.pathForRun(run.id)),
            ...checkpointPaths,
          ],
          result: {
            deletedBoardId: boardId,
            deletedRunIds: boardRuns.map((run) => run.id),
            ...(checkpointStore ? { deletedCheckpointIds } : {}),
          },
        }
      })
      return result
    },

    async createCard(boardId, body) {
      const input = normalizeCreateCardInput(body)
      let created
      await changeBoard(boardId, async (board) => {
        const card = createCardRecord(resolveCreateCardPlacement(board, input))
        board.cards.push(card)
        created = card
      })
      return { card: created }
    },

    async createCards(boardId, body) {
      const inputs = await validateCreateCardBatch(body)
      const group = Object.prototype.hasOwnProperty.call(body, 'group') ? normalizeNewGroup(body.group) : undefined
      let created = []
      let groups
      await changeBoard(boardId, async (board) => {
        created = inputs.map((input) => {
          const card = createCardRecord(resolveCreateCardPlacement(board, input))
          board.cards.push(card)
          return card
        })
        if (group) {
          groups = [...(board.groups || []), { ...group, id: newId('group'), cardIds: created.map(({ id }) => id) }]
          if (validateGroups(groups, new Set(board.cards.map(({ id }) => id))).length) {
            throw typed('ORGANIZATION_INVALID', 'The copied group exceeds organization limits')
          }
          board.groups = groups
        }
      })
      return { cards: created, ...(group ? { groups } : {}) }
    },

    async updateOrganization(boardId, body) {
      return changeBoard(boardId, (board) => applyOrganization(board, body))
    },

    async restoreCards(boardId, body) {
      const restoreReceiptId = typeof body?.restoreReceiptId === 'string'
        ? body.restoreReceiptId.trim()
        : ''
      const receipts = deletedCardReceiptsByBoard.get(boardId)
      const receipt = restoreReceiptId ? receipts?.get(restoreReceiptId) : undefined
      if (!receipt) {
        throw typed('CARD_RESTORE_CONFLICT', 'Card deletion receipt is no longer available')
      }
      const cards = structuredClone(receipt.cards)
      const cardIds = cards.map((card) => card.id)
      let groups
      await changeBoard(boardId, async (board) => {
        if (cardIds.some((cardId) => board.cards.some((card) => card.id === cardId))) {
          throw typed('CARD_RESTORE_CONFLICT', 'A restored card already exists on this board')
        }
        groups = restoreGroupMembers(board, receipt.affectedGroups, cards)
        const candidate = { ...board, groups, cards: [...board.cards, ...cards] }
        const errors = validateBoardV2(candidate)
        if (errors.length > 0) {
          throw typed('BAD_REQUEST', `Restored cards are invalid: ${errors.join('; ')}`)
        }
        board.cards.push(...cards)
        if (receipt.affectedGroups.length) board.groups = groups
      })
      receipts.delete(restoreReceiptId)
      if (receipts.size === 0) deletedCardReceiptsByBoard.delete(boardId)
      return { cards, groups }
    },

    async readCardContent(boardId, cardId) {
      const board = await store.load(boardId)
      const card = cardById(board, cardId)
      const version = card.versions.find((item) => item.id === card.headVersionId)
      if (!version) throw typed('SOURCE_READ_FAILED', 'Card has no current content')
      if (version.content.kind === 'markdown') {
        return {
          cardId,
          versionId: version.id,
          contentKind: card.contentKind,
          content: version.content.markdown,
        }
      }
      try {
        return {
          cardId,
          versionId: version.id,
          contentKind: card.contentKind,
          path: version.content.path,
          content: await readFileContent(version.content.path),
        }
      } catch (error) {
        if (error?.code === 'SOURCE_READ_FAILED') throw error
        throw typed('SOURCE_READ_FAILED', `File content could not be read: ${error?.message || error}`)
      }
    },

    async commitCardVersion(boardId, cardId, body) {
      let updated
      let fileSync
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        const content =
          card.contentKind === 'file-reference'
            ? {
                kind: 'file-reference',
                path: body.path,
                readonly: body.readonly !== false,
              }
            : { kind: 'markdown', markdown: String(body.markdown ?? '') }
        updated = appendVersion(card, {
          baseVersionId: body.baseVersionId ?? null,
          versionId: newId('version'),
          content,
          origin: 'human',
          createdAt: now(),
        })
        const synced = await syncBoundCard(updated)
        updated = synced.card
        fileSync = synced.fileSync
        board.cards = board.cards.map((item) => (item.id === cardId ? updated : item))
      })
      return { card: updated, fileSync }
    },

    async restoreCardVersion(boardId, cardId, versionId, body) {
      let updated
      let fileSync
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        updated = restoreVersion(card, versionId, {
          baseVersionId: body.baseVersionId ?? null,
          versionId: newId('version'),
          createdAt: now(),
        })
        const synced = await syncBoundCard(updated)
        updated = synced.card
        fileSync = synced.fileSync
        board.cards = board.cards.map((item) => (item.id === cardId ? updated : item))
      })
      return { card: updated, fileSync }
    },

    async getCardFileBinding(boardId, cardId) {
      if (!fileBinding) throw typed('FILES_UNAVAILABLE', '文件同步在当前宿主不可用')
      const board = await store.load(boardId)
      const card = cardById(board, cardId)
      return { cardId, ...(await fileBinding.inspect(card)) }
    },

    async bindCardFile(boardId, cardId, body) {
      if (!fileBinding) throw typed('FILES_UNAVAILABLE', '文件同步在当前宿主不可用')
      let result
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        const path = String(body?.path || '').trim()
        if (board.cards.some((item) => item.id !== cardId && item.fileBinding?.path === path)) {
          throw typed('FILE_BINDING_CONFLICT', '这个本地文件已经绑定到当前画板的另一张 Card', { path })
        }
        result = await fileBinding.bind(card, body || {})
        board.cards = board.cards.map((item) => (item.id === cardId ? result.card : item))
      })
      return result
    },

    async unbindCardFile(boardId, cardId) {
      let updated
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        updated = { ...card }
        delete updated.fileBinding
        updated.updatedAt = now()
        board.cards = board.cards.map((item) => (item.id === cardId ? updated : item))
      })
      return { card: updated, fileSync: { status: 'unbound' } }
    },

    async syncCardFile(boardId, cardId, body) {
      if (!fileBinding) throw typed('FILES_UNAVAILABLE', '文件同步在当前宿主不可用')
      let result
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        result = await fileBinding.sync(card, body || {})
        if (result.fileSync.status === 'import') {
          const imported = appendVersion(card, {
            baseVersionId: card.headVersionId,
            versionId: newId('version'),
            content: { kind: 'markdown', markdown: result.fileSync.content },
            origin: 'human',
            createdAt: now(),
          })
          result = {
            card: {
              ...imported,
              fileBinding: {
                path: card.fileBinding.path,
                lastSyncedVersionId: imported.headVersionId,
                lastSyncedFileDigest: result.fileSync.fileDigest,
                lastSyncedAt: now(),
              },
              updatedAt: now(),
            },
            fileSync: { status: 'synced', path: card.fileBinding.path },
          }
        }
        board.cards = board.cards.map((item) => (item.id === cardId ? result.card : item))
      })
      return result
    },

    async updateCard(boardId, cardId, body) {
      const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
      const name = hasName && body.name !== null ? normalizeCardName(body.name) : null
      if (hasName && body.baseName !== null) normalizeCardName(body.baseName)
      const hasTags = Object.prototype.hasOwnProperty.call(body, 'tags')
      const tags = hasTags ? normalizeTags(body.tags) : undefined
      let updated
      await changeBoard(boardId, async (board) => {
        const card = cardById(board, cardId)
        if (hasName && (card.name ?? null) !== body.baseName) {
          throw typed('CARD_NAME_CONFLICT', '卡片名称已变化，请核对后重试。')
        }
        updated = {
          ...card,
          ...(Number.isFinite(body.x) ? { x: body.x } : {}),
          ...(Number.isFinite(body.y) ? { y: body.y } : {}),
          ...(Number.isFinite(body.width) ? { width: body.width } : {}),
          ...(Number.isFinite(body.height) ? { height: body.height } : {}),
          ...(hasTags ? { tags } : {}),
          updatedAt: now(),
        }
        if (hasName) {
          if (name === null) delete updated.name
          else updated.name = name
        }
        board.cards = board.cards.map((item) => (item.id === cardId ? updated : item))
      })
      return { card: updated }
    },

    async updateCards(boardId, body) {
      const updates = requireNonEmptyBatch(body?.updates, 'updates')
      requireUniqueIds(updates, 'cardId')
      for (const update of updates) {
        if (![update.x, update.y, update.width, update.height].some(Number.isFinite)) {
          throw typed('BAD_REQUEST', 'Every card update requires a finite geometry value')
        }
      }
      let updated = []
      await changeBoard(boardId, async (board) => {
        for (const update of updates) cardById(board, update.cardId)
        const byId = new Map(updates.map((update) => [update.cardId, update]))
        const timestamp = now()
        board.cards = board.cards.map((card) => {
          const update = byId.get(card.id)
          if (!update) return card
          return {
            ...card,
            ...(Number.isFinite(update.x) ? { x: update.x } : {}),
            ...(Number.isFinite(update.y) ? { y: update.y } : {}),
            ...(Number.isFinite(update.width) ? { width: update.width } : {}),
            ...(Number.isFinite(update.height) ? { height: update.height } : {}),
            updatedAt: timestamp,
          }
        })
        updated = updates.map((update) => cardById(board, update.cardId))
      })
      return { cards: updated }
    },

    async deleteCard(boardId, cardId) {
      let restoreReceiptId
      let deleted
      let affectedGroups
      let groups
      await changeBoard(boardId, async (board) => {
        deleted = structuredClone(cardById(board, cardId))
        if (cardIsRelated(board, cardId)) {
          throw typed('CARD_IN_USE', '这张卡属于已有转化或成果历史，不能直接删除')
        }
        restoreReceiptId = issueRestoreReceiptId(boardId)
        board.cards = board.cards.filter((item) => item.id !== cardId)
        affectedGroups = removeGroupMembers(board, new Set([cardId]))
        groups = structuredClone(board.groups || [])
      })
      rememberDeletedCards(boardId, restoreReceiptId, [deleted], affectedGroups)
      return { deletedCardId: cardId, restoreReceiptId, groups }
    },

    async deleteCards(boardId, body) {
      const cardIds = requireNonEmptyBatch(body?.cardIds, 'cardIds')
      requireUniqueIds(cardIds.map((cardId) => ({ cardId })), 'cardId')
      let restoreReceiptId
      let deleted = []
      let affectedGroups
      let groups
      await changeBoard(boardId, async (board) => {
        for (const cardId of cardIds) cardById(board, cardId)
        if (cardIds.some((cardId) => cardIsRelated(board, cardId))) {
          throw typed('CARD_IN_USE', '所选卡片包含已有转化或成果历史，不能部分删除')
        }
        restoreReceiptId = issueRestoreReceiptId(boardId)
        const removed = new Set(cardIds)
        deleted = board.cards
          .filter((card) => removed.has(card.id))
          .map((card) => structuredClone(card))
        board.cards = board.cards.filter((card) => !removed.has(card.id))
        affectedGroups = removeGroupMembers(board, removed)
        groups = structuredClone(board.groups || [])
      })
      rememberDeletedCards(boardId, restoreReceiptId, deleted, affectedGroups)
      return { deletedCardIds: [...cardIds], restoreReceiptId, groups }
    },

    async suggest(boardId, body) {
      const board = await store.load(boardId)
      validateSourceRefs(board, body.sourceRefs)
      const snapshots = await createSourceSnapshots(board.cards, body.sourceRefs, {
        resolveFileContent: readFileContent,
      })
      const fallback = snapshots.length > 1 ? FALLBACK_MULTI : FALLBACK_SINGLE
      if (!executeSuggestion) return { suggestions: structuredClone(fallback) }
      try {
        const prompt = [
          '只返回 JSON 数组，最多三项。每项包含 label、instruction、acceptance。',
          '使用成果语言，不使用 Action、Agent、input、output 或 workflow。',
          ...snapshots.map(
            (snapshot, index) =>
              `# 来源 ${index + 1}\n${snapshot.resolvedContent}`,
          ),
        ].join('\n\n')
        const output = await executeSuggestion({ boardId, prompt, sourceSnapshot: snapshots })
        const suggestions = parseSuggestions(output)
        return { suggestions: suggestions.length > 0 ? suggestions : structuredClone(fallback) }
      } catch {
        return { suggestions: structuredClone(fallback) }
      }
    },

    async createTransformation(boardId, body) {
      let created
      await changeBoard(boardId, async (board) => {
        validateSourceRefs(board, body.sourceRefs)
        const modelId = Object.prototype.hasOwnProperty.call(body, 'modelId')
          ? modelOverride(body.modelId)
          : undefined
        const sourceCardIds = body.sourceRefs.map((sourceRef) => sourceRef.cardId)
        const timestamp = now()
        const targetCard = {
          id: newId('card'),
          contentKind: 'markdown',
          x: Number.isFinite(body.targetPosition?.x) ? body.targetPosition.x : 480,
          y: Number.isFinite(body.targetPosition?.y) ? body.targetPosition.y : 80,
          width: 360,
          height: 240,
          headVersionId: null,
          versions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const transformation = {
          id: newId('transformation'),
          sourceCardIds,
          targetCardId: targetCard.id,
          label: String(body.label || '').trim(),
          instruction: String(body.instruction || '').trim(),
          acceptance: String(body.acceptance || '').trim(),
          ...(modelId ? { modelId } : {}),
          permissions: { workspaceWrite: false },
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        if (!transformation.label || !transformation.instruction) {
          throw typed('TRANSFORMATION_INVALID', '成果名称和目标不能为空')
        }
        board.cards.push(targetCard)
        board.transformations.push(transformation)
        created = { transformation, targetCard }
      })
      return created
    },

    async createTransformations(boardId, body) {
      let created
      await changeBoard(boardId, async (board) => {
        const entries = requireNonEmptyBatch(body?.transformations, 'transformations')
        if (entries.length < 2 || entries.length > 16) {
          throw typed('BAD_REQUEST', '并行分支必须包含 2 到 16 个方向')
        }
        validateSourceRefs(board, body.sourceRefs)
        const sourceCardIds = body.sourceRefs.map((sourceRef) => sourceRef.cardId)
        const timestamp = now()
        const targetCards = []
        const transformations = []
        for (const entry of entries) {
          const label = String(entry?.label || '').trim()
          const instruction = String(entry?.instruction || '').trim()
          if (!label || !instruction) {
            throw typed('TRANSFORMATION_INVALID', '成果名称和目标不能为空')
          }
          const targetCard = {
            id: newId('card'),
            contentKind: 'markdown',
            x: Number.isFinite(entry?.targetPosition?.x) ? entry.targetPosition.x : 480,
            y: Number.isFinite(entry?.targetPosition?.y) ? entry.targetPosition.y : 80,
            width: 360,
            height: 240,
            headVersionId: null,
            versions: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          }
          const modelId = Object.prototype.hasOwnProperty.call(entry || {}, 'modelId')
            ? modelOverride(entry.modelId)
            : undefined
          const transformation = {
            id: newId('transformation'),
            sourceCardIds,
            targetCardId: targetCard.id,
            label,
            instruction,
            acceptance: String(entry?.acceptance || '').trim(),
            ...(modelId ? { modelId } : {}),
            permissions: { workspaceWrite: false },
            createdAt: timestamp,
            updatedAt: timestamp,
          }
          targetCards.push(targetCard)
          transformations.push(transformation)
        }
        board.cards.push(...targetCards)
        board.transformations.push(...transformations)
        created = { transformations, targetCards }
      })
      return created
    },

    async updateTransformation(boardId, transformationId, body) {
      return changeIdleTransformation(boardId, transformationId, async (board, current) => {
        if (
          typeof body.baseUpdatedAt !== 'string' ||
          body.baseUpdatedAt !== current.updatedAt
        ) {
          throw typed(
            'TRANSFORMATION_CONFLICT',
            'Transformation changed after this edit was opened',
          )
        }
        const has = (field) => Object.prototype.hasOwnProperty.call(body, field)
        const label = has('label') ? String(body.label ?? '').trim() : current.label
        const instruction = has('instruction')
          ? String(body.instruction ?? '').trim()
          : current.instruction
        const acceptance = has('acceptance')
          ? String(body.acceptance ?? '').trim()
          : current.acceptance
        const requestedModelId = has('modelId')
          ? modelOverride(body.modelId, { allowNull: true })
          : current.modelId
        const modelId = requestedModelId || undefined
        if (!label || !instruction) {
          throw typed('TRANSFORMATION_INVALID', '成果名称和目标不能为空')
        }

        let sourceCardIds = current.sourceCardIds
        if (has('sourceRefs')) {
          if (
            Array.isArray(body.sourceRefs) &&
            body.sourceRefs.some((sourceRef) => sourceRef?.cardId === current.targetCardId)
          ) {
            throw typed(
              'TRANSFORMATION_SOURCE_INVALID',
              'A transformation target cannot also be its source',
            )
          }
          validateSourceRefs(board, body.sourceRefs)
          sourceCardIds = body.sourceRefs.map((sourceRef) => sourceRef.cardId)
          assertSourcesDoNotCloseCycle(board, current, sourceCardIds)
        }

        const transformation = {
          ...current,
          sourceCardIds,
          label,
          instruction,
          acceptance,
          ...(modelId ? { modelId } : {}),
          updatedAt: nextUpdatedAt(current.updatedAt, now()),
        }
        const semanticsChanged =
          label !== current.label ||
          instruction !== current.instruction ||
          acceptance !== current.acceptance ||
          modelId !== current.modelId ||
          sourceCardIds.length !== current.sourceCardIds.length ||
          sourceCardIds.some((cardId, index) => cardId !== current.sourceCardIds[index])
        if (current.planRef && semanticsChanged) {
          transformation.planRef = { ...current.planRef, adjusted: true }
        }
        if (!modelId) delete transformation.modelId
        board.transformations = board.transformations.map((item) =>
          item.id === transformationId ? transformation : item,
        )
        return { transformation }
      })
    },

    async updateTransformationPosition(boardId, transformationId, body) {
      if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
        throw typed('BAD_REQUEST', 'Transformation position requires finite x and y')
      }
      return changeBoard(boardId, async (board) => {
        const current = transformationById(board, transformationId)
        const transformation = { ...current, x: body.x, y: body.y }
        board.transformations = board.transformations.map((item) =>
          item.id === transformationId ? transformation : item,
        )
        return { transformation }
      })
    },

    async deleteTransformation(boardId, transformationId) {
      return changeIdleTransformation(boardId, transformationId, async (board) => {
        board.transformations = board.transformations.filter(
          (item) => item.id !== transformationId,
        )
        return { deletedTransformationId: transformationId }
      })
    },

    async startRun(boardId, transformationId, body = {}) {
      let run
      let transformation
      let runStarted = false
      try {
        await changeBoard(boardId, async (board, boardLease) => {
          transformation = transformationById(board, transformationId)
          const sourceRefs =
            body.sourceRefs ||
            transformation.sourceCardIds.map((cardId) => ({
              cardId,
              versionId: cardById(board, cardId).headVersionId,
            }))
          if (sourceRefs.some((sourceRef) => !sourceRef.versionId)) {
            throw typed('SOURCE_READ_FAILED', '来源卡还没有可用版本')
          }
          const modelSnapshot = resolveModel
            ? await resolveModel({ modelId: transformation.modelId })
            : undefined
          run = await createTransformationRun(
            {
              id: newId('run'),
              boardId,
              transformation,
              cards: board.cards,
              sourceRefs,
              intent: cardById(board, transformation.targetCardId).headVersionId
                ? 'update'
                : 'create',
              createdAt: now(),
              modelSnapshot,
            },
            { resolveFileContent: readFileContent },
          )
          run = { ...run, status: 'running', startedAt: now() }
          await runStore.start(run, boardLease)
          runStarted = true
          assertFrozenRunIsCurrent(board, transformationId, run, transformation)
          board.transformations = board.transformations.map((item) =>
            item.id === transformationId
              ? {
                  ...item,
                  lastRunId: run.id,
                  updatedAt: nextUpdatedAt(item.updatedAt, now()),
                }
              : item,
          )
        })
      } catch (error) {
        if (runStarted) {
          try {
            await runStore.withLockedRun(run.id, async (currentRun, runLease) => {
              if (currentRun.status !== 'running') return
              const finishedAt = now()
              const failed = appendTerminalRunProgress({
                ...currentRun,
                status: 'failed',
                error: {
                  code: error?.code || 'RUN_START_FAILED',
                  message: error?.message || String(error),
                  retryable: true,
                },
                finishedAt,
              }, 'failed', finishedAt)
              await saveRunReliably(failed, runLease)
            })
          } catch {}
        }
        throw error
      }
      void executeRun(run, transformation)
      return { run }
    },

    async reconcileAppliedCandidates() {
      const reconciled = []
      const candidates = (await runStore.list()).filter(
        (run) =>
          run.status === 'succeeded' && run.result?.disposition === 'candidate',
      )
      for (const candidate of candidates) {
        await runStore.withLockedRun(candidate.id, async (run, runLease) => {
          if (run.status !== 'succeeded' || run.result?.disposition !== 'candidate') return
          const board = await store.load(run.boardId)
          const transformation = transformationById(board, run.transformationId)
          if (transformation.targetCardId !== run.targetCardId) {
            throw typed('RUN_TARGET_MISMATCH', `Run ${run.id} targets another card`)
          }
          const target = cardById(board, run.targetCardId)
          const existing = target.versions.find((version) => version.sourceRunId === run.id)
          if (!existing) return

          if (transformation.lastAppliedRunId !== run.id) {
            await changeBoard(run.boardId, async (latest) => {
              const current = transformationById(latest, run.transformationId)
              const currentTarget = cardById(latest, run.targetCardId)
              if (!currentTarget.versions.some((version) => version.id === existing.id)) {
                throw typed('VERSION_NOT_FOUND', `Version ${existing.id} was not found`)
              }
              const synced = await syncBoundCard(currentTarget)
              latest.cards = latest.cards.map((item) =>
                item.id === currentTarget.id ? synced.card : item,
              )
              latest.transformations = latest.transformations.map((item) =>
                item.id === current.id
                  ? {
                      ...item,
                      lastAppliedRunId: run.id,
                      updatedAt: nextUpdatedAt(item.updatedAt, now()),
                    }
                  : item,
              )
            }, runLease)
          }

          const applied = {
            ...run,
            result: {
              ...run.result,
              disposition: 'applied',
              appliedVersionId: existing.id,
            },
          }
          await saveRunReliably(applied, runLease)
          reconciled.push(applied)
        })
      }
      return reconciled
    },

    async getRun(runId) {
      return { run: await runStore.load(runId) }
    },

    async adoptCandidate(runId, body) {
      let adopted
      await runStore.withLockedRun(runId, async (run, runLease) => {
        await changeBoard(run.boardId, async (board) => {
          const transformation = transformationById(board, run.transformationId)
          if (transformation.targetCardId !== run.targetCardId) {
            throw typed('RUN_TARGET_MISMATCH', `Run ${run.id} targets another card`)
          }
          const card = cardById(board, run.targetCardId)
          const existing = card.versions.find((version) => version.sourceRunId === run.id)
          const adoptedAt = now()
          adopted = existing
            ? {
                card,
                run: {
                  ...run,
                  result: {
                    ...run.result,
                    disposition: 'applied',
                    appliedVersionId: existing.id,
                  },
                },
              }
            : applyCandidate(card, run, {
                baseVersionId: body.baseVersionId ?? null,
                versionId: newId('version'),
                createdAt: adoptedAt,
              })
          if (!existing) {
            const synced = await syncBoundCard(adopted.card)
            adopted = { ...adopted, card: synced.card, fileSync: synced.fileSync }
          }
          board.cards = board.cards.map((item) =>
            item.id === card.id ? adopted.card : item,
          )
          board.transformations = board.transformations.map((item) =>
            item.id === run.transformationId
              ? {
                  ...item,
                  lastAppliedRunId: run.id,
                  updatedAt: nextUpdatedAt(item.updatedAt, adoptedAt),
                }
              : item,
          )
        }, runLease)
        await saveRunReliably(adopted.run, runLease)
      })
      return adopted
    },

    async discardCandidate(runId) {
      let discarded
      await runStore.withLockedRun(runId, async (run, runLease) => {
        await changeBoard(run.boardId, async () => {
          discarded = discardRunCandidate(run)
        }, runLease)
        await saveRunReliably(discarded, runLease)
      })
      return { run: discarded }
    },

    async interruptRun(runId) {
      const activeController = controllers.get(runId)
      activeController?.abort()
      let result
      await runStore.withLockedRun(runId, async (run, runLease) => {
        let interruptible = ['queued', 'running'].includes(run.status)
        if (
          !interruptible &&
          activeController &&
          run.status === 'succeeded' &&
          run.result?.disposition === 'candidate'
        ) {
          const board = await store.load(run.boardId)
          const target = cardById(board, run.targetCardId)
          interruptible = !target.versions.some((version) => version.sourceRunId === run.id)
        }
        if (!interruptible) {
          result = run
          return
        }
        const finishedAt = now()
        result = appendTerminalRunProgress({
          ...run,
          status: 'interrupted',
          error: {
            code: 'RUN_INTERRUPTED',
            message: '生成已停止，已有内容保持不变',
            retryable: true,
          },
          finishedAt,
        }, 'interrupted', finishedAt)
        await saveRunReliably(result, runLease)
      })
      return { run: result }
    },
  }
}
