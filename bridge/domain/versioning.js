import { digestContent, normalizeContent } from './content.js'
import { typed } from './errors.js'

export function appendVersion(card, input) {
  if (card.headVersionId !== input.baseVersionId) {
    throw typed(
      'CARD_VERSION_CONFLICT',
      `Card ${card.id} changed after version ${input.baseVersionId ?? 'empty'}`,
    )
  }
  if (card.versions.some((version) => version.id === input.versionId)) {
    throw typed('VERSION_ID_CONFLICT', `Version ${input.versionId} already exists`)
  }
  if (input.origin === 'ai' && !input.sourceRunId) {
    throw typed('VERSION_SOURCE_RUN_REQUIRED', 'AI versions require a source run')
  }
  if (input.origin === 'restore' && !input.restoredFromVersionId) {
    throw typed(
      'VERSION_RESTORE_SOURCE_REQUIRED',
      'Restored versions require a source version',
    )
  }

  const content = normalizeContent(input.content)
  if (content.kind !== card.contentKind) {
    throw typed(
      'CARD_CONTENT_KIND_MISMATCH',
      `Card ${card.id} content kind cannot change from ${card.contentKind} to ${content.kind}`,
    )
  }
  const sequence = card.versions.reduce(
    (maximum, version) => Math.max(maximum, version.sequence),
    0,
  ) + 1
  const version = {
    id: input.versionId,
    cardId: card.id,
    sequence,
    content,
    digest: digestContent(content),
    origin: input.origin,
    createdAt: input.createdAt,
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.restoredFromVersionId
      ? { restoredFromVersionId: input.restoredFromVersionId }
      : {}),
  }

  return {
    ...card,
    contentKind: content.kind,
    headVersionId: version.id,
    versions: [...card.versions, version],
    updatedAt: input.createdAt,
  }
}

export function restoreVersion(card, sourceVersionId, input) {
  const source = card.versions.find((version) => version.id === sourceVersionId)
  if (!source) {
    throw typed('VERSION_NOT_FOUND', `Version ${sourceVersionId} does not exist`)
  }

  return appendVersion(card, {
    ...input,
    content: source.content,
    origin: 'restore',
    restoredFromVersionId: sourceVersionId,
  })
}
