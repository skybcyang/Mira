export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

export function assertUnique(items, getId, label, fail) {
  const ids = new Set()
  for (const item of items) {
    const id = getId(item)
    if (!nonEmptyString(id) || ids.has(id)) fail(`Duplicate or invalid ${label} ID: ${id}`)
    ids.add(id)
  }
  return ids
}
