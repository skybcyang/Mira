import { digestText, isUsableContent } from './content.js'
import { typed } from './errors.js'

export async function createSourceSnapshots(cards, sourceRefs, options = {}) {
  if (sourceRefs.length === 0) {
    throw typed('SOURCE_REQUIRED', 'At least one source card is required')
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const resolvedRefs = sourceRefs.map((sourceRef) => {
    const card = cardsById.get(sourceRef.cardId)
    if (!card) {
      throw typed('SOURCE_READ_FAILED', `Source card ${sourceRef.cardId} is missing`)
    }
    if (card.headVersionId !== sourceRef.versionId) {
      throw typed(
        'SOURCE_VERSION_CHANGED',
        `Source card ${sourceRef.cardId} changed before the run started`,
      )
    }

    const version = Array.isArray(card.versions)
      ? card.versions.find((candidate) => candidate.id === sourceRef.versionId)
      : undefined
    if (!version || !isUsableContent(version.content)) {
      throw typed(
        'SOURCE_READ_FAILED',
        `Source version ${sourceRef.versionId} is missing or unusable`,
      )
    }
    return { card, version }
  })

  try {
    return await Promise.all(
      resolvedRefs.map(async ({ card, version }) => {
        const resolvedContent =
          version.content.kind === 'markdown'
            ? version.content.markdown
            : await options.resolveFileContent(version.content.path)

        if (typeof resolvedContent !== 'string') {
          throw new TypeError(`Source card ${card.id} did not resolve to text`)
        }

        return {
          cardId: card.id,
          versionId: version.id,
          contentKind: version.content.kind,
          resolvedContent,
          digest: digestText(resolvedContent),
        }
      }),
    )
  } catch (error) {
    if (error?.code) throw error
    throw typed('SOURCE_READ_FAILED', 'One or more source cards could not be read', undefined, error)
  }
}

export async function createTransformationRun(input, options = {}) {
  const sourceCardIds = input.transformation?.sourceCardIds
  const refCardIds = input.sourceRefs.map((sourceRef) => sourceRef.cardId)
  if (
    !Array.isArray(sourceCardIds) ||
    sourceCardIds.length !== refCardIds.length ||
    sourceCardIds.some((cardId, index) => cardId !== refCardIds[index])
  ) {
    throw typed(
      'RUN_SOURCE_MISMATCH',
      'Run source refs must match the transformation sources and order',
    )
  }

  const target = input.cards.find(
    (card) => card.id === input.transformation.targetCardId,
  )
  if (!target) {
    throw typed(
      'RUN_TARGET_MISMATCH',
      `Target card ${input.transformation.targetCardId} is missing`,
    )
  }

  const targetBaseVersionId = target.headVersionId
  const sourceSnapshot = await createSourceSnapshots(
    input.cards,
    input.sourceRefs,
    options,
  )

  return {
    id: input.id,
    boardId: input.boardId,
    transformationId: input.transformation.id,
    status: 'queued',
    sourceSnapshot,
    targetCardId: target.id,
    targetBaseVersionId,
    intent: input.intent,
    ...(input.modelSnapshot ? { modelSnapshot: input.modelSnapshot } : {}),
    createdAt: input.createdAt,
  }
}

export function isStale(
  cards,
  transformationOrRun,
  runOrFileDigests,
  currentFileDigests = {},
) {
  let currentTransformation = transformationOrRun
  let latestAppliedRun = runOrFileDigests
  if (
    transformationOrRun == null ||
    typeof transformationOrRun.status === 'string' ||
    Array.isArray(transformationOrRun.sourceSnapshot)
  ) {
    currentTransformation = undefined
    latestAppliedRun = transformationOrRun
    currentFileDigests = runOrFileDigests || {}
  }
  if (
    latestAppliedRun?.status !== 'succeeded' ||
    latestAppliedRun.result?.disposition !== 'applied'
  ) {
    return false
  }

  if (!Array.isArray(latestAppliedRun.sourceSnapshot)) return true
  if (currentTransformation) {
    const currentSourceIds = currentTransformation.sourceCardIds
    const appliedSourceIds = latestAppliedRun.sourceSnapshot.map(
      (snapshot) => snapshot.cardId,
    )
    if (
      !Array.isArray(currentSourceIds) ||
      currentSourceIds.length !== appliedSourceIds.length ||
      currentSourceIds.some((cardId, index) => cardId !== appliedSourceIds[index])
    ) {
      return true
    }
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return latestAppliedRun.sourceSnapshot.some((snapshot) => {
    const card = cardsById.get(snapshot.cardId)
    if (!card || card.headVersionId !== snapshot.versionId) return true
    if (snapshot.contentKind !== 'file-reference') return false

    const currentDigest = currentFileDigests[snapshot.cardId]
    return currentDigest !== undefined && currentDigest !== snapshot.digest
  })
}
