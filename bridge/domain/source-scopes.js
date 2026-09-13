import { validateSourceScopes, sameScope } from '../../src/domain/sourceScopes.js'
import { createSourceSnapshots } from './snapshots.js'
import { typed } from './errors.js'

export async function confirmSourceScopes(board, scopes, sourceCardIds, readFileContent) {
  const normalized = validateSourceScopes(scopes, sourceCardIds)
  const refs = normalized.filter(scope => scope.mode === 'ranges').map(({ cardId, ...scope }) => ({ cardId, versionId: scope.versionId, scope }))
  if (refs.length) await createSourceSnapshots(board.cards, refs, { resolveFileContent: readFileContent })
  return normalized
}

export function scopesFromRefs(refs) {
  return refs.filter(ref => ref.scope !== undefined).map(ref => {
    if (!ref.scope || typeof ref.scope !== 'object' || Array.isArray(ref.scope) || 'cardId' in ref.scope || ref.scope.mode !== 'ranges') {
      throw typed('SOURCE_SCOPE_INVALID', '来源需要已确认的片段范围。')
    }
    return { ...ref.scope, cardId: ref.cardId }
  })
}

export async function updateSourceScopes(board, current, body, sourceCardIds, readFileContent) {
  const hasScopes = Object.prototype.hasOwnProperty.call(body, 'sourceScopes')
  if (hasScopes && !Array.isArray(body.sourceScopes)) throw typed('SOURCE_SCOPE_INVALID', '来源范围需要是数组。')
  const scopes = hasScopes
    ? await confirmSourceScopes(board, body.sourceScopes, sourceCardIds, readFileContent)
    : validateSourceScopes((current.sourceScopes || []).filter(scope => sourceCardIds.includes(scope.cardId)), sourceCardIds)
  for (const supplied of scopesFromRefs(body.sourceRefs || [])) {
    if (!sameScope(supplied, scopes.find(scope => scope.cardId === supplied.cardId))) throw typed('SOURCE_SCOPE_CHANGED', '来源引用与范围设置不一致，请单独核对输入范围。')
  }
  return scopes
}
