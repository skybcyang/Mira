export interface DraftSnapshot<T> {
  scopeId: string
  revision: string
  baseline: T
  value: T
  upstreamChanged: boolean
}

export interface RevisionNotice {
  scopeId: string
  revision: string
  changed: boolean
}

export function createDraftSnapshot<T>(
  scopeId: string,
  revision: string,
  value: T,
): DraftSnapshot<T> {
  return { scopeId, revision, baseline: value, value, upstreamChanged: false }
}

export function hasUnsavedTagDraft(tagsChanged: boolean, tagInput: string): boolean {
  return tagsChanged || Boolean(tagInput.trim())
}

export function reconcileDraftSnapshot<T>(
  current: DraftSnapshot<T>,
  incoming: { scopeId: string; revision: string; value: T },
  equal: (left: T, right: T) => boolean,
  preserveDirtyBaseline = false,
): DraftSnapshot<T> {
  if (current.scopeId !== incoming.scopeId) {
    return createDraftSnapshot(incoming.scopeId, incoming.revision, incoming.value)
  }
  if (current.revision === incoming.revision) return current
  if (equal(current.value, current.baseline) || equal(current.value, incoming.value)) {
    return createDraftSnapshot(incoming.scopeId, incoming.revision, incoming.value)
  }
  if (preserveDirtyBaseline) return { ...current, upstreamChanged: true }
  return {
    scopeId: incoming.scopeId,
    revision: incoming.revision,
    baseline: incoming.value,
    value: current.value,
    upstreamChanged: true,
  }
}

export function reconcileRevisionNotice(
  current: RevisionNotice,
  incoming: Pick<RevisionNotice, 'scopeId' | 'revision'>,
  dirty: boolean,
): RevisionNotice {
  if (current.scopeId !== incoming.scopeId) return { ...incoming, changed: false }
  const changed = dirty && (current.changed || current.revision !== incoming.revision)
  if (current.revision === incoming.revision && current.changed === changed) return current
  return { ...incoming, changed }
}

export function runExclusiveAction<T>(
  lock: { current: boolean },
  action: () => T | Promise<T>,
): Promise<T> | null {
  if (lock.current) return null
  lock.current = true
  try {
    return Promise.resolve(action()).finally(() => { lock.current = false })
  } catch (error) {
    lock.current = false
    return Promise.reject(error)
  }
}

export function nextDrawerTabIndex(
  enabled: boolean[],
  currentIndex: number,
  key: string,
): number {
  if (key === 'Home') {
    const first = enabled.findIndex(Boolean)
    return first < 0 ? currentIndex : first
  }
  if (key === 'End') {
    const last = enabled.lastIndexOf(true)
    return last < 0 ? currentIndex : last
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return currentIndex
  const direction = key === 'ArrowRight' ? 1 : -1
  for (let offset = 1; offset <= enabled.length; offset += 1) {
    const index = (currentIndex + direction * offset + enabled.length) % enabled.length
    if (enabled[index]) return index
  }
  return currentIndex
}
