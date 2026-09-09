import { typed } from './errors.js'

const COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'violet'])
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const strictKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key))
const invalid = (message) => { throw typed('ORGANIZATION_INVALID', message) }
const conflict = () => { throw typed('ORGANIZATION_CONFLICT', 'Board organization changed; reload before retrying') }

export const isCardColor = (color) => COLORS.has(color)

export function requireCardColor(color) {
  if (!isCardColor(color)) invalid('Color must be a preset color')
  return color
}

export function validateGroups(groups, cardIds) {
  const errors = []
  if (!Array.isArray(groups) || groups.length > 100) return ['groups must contain at most 100 groups']
  const groupIds = new Set()
  const members = new Set()
  for (const group of groups) {
    if (!strictKeys(group, ['id', 'title', 'color', 'cardIds']) || !nonempty(group.id)
      || typeof group.title !== 'string' || group.title !== group.title.trim()
      || [...group.title].length < 1 || [...group.title].length > 80
      || (owns(group, 'color') && !isCardColor(group.color))
      || !Array.isArray(group.cardIds) || group.cardIds.length < 1 || group.cardIds.length > 100) {
      errors.push('group shape is invalid')
      continue
    }
    if (groupIds.has(group.id)) errors.push('duplicate group id')
    groupIds.add(group.id)
    for (const id of group.cardIds) {
      if (!nonempty(id) || members.has(id) || (cardIds && !cardIds.has(id))) errors.push('group member is missing or duplicated')
      members.add(id)
    }
  }
  return errors
}

// Only schema fields participate; object key insertion order is not a CAS value.
export function groupsEqual(left, right) {
  const snapshot = (groups) => JSON.stringify(groups.map(({ id, title, color, cardIds }) => [id, title, color ?? null, cardIds]))
  return snapshot(left) === snapshot(right)
}

export function normalizeNewGroup(input) {
  if (!strictKeys(input, ['title', 'color']) || typeof input.title !== 'string') invalid('Group requires a title')
  const group = { title: input.title.trim(), ...(owns(input, 'color') ? { color: input.color } : {}) }
  if (validateGroups([{ ...group, id: 'new', cardIds: ['new'] }]).length) invalid('Group is invalid')
  return group
}

export function applyOrganization(board, body) {
  if (!strictKeys(body, ['baseGroups', 'groups', 'colors', 'positions', 'sizes'])
    || !['groups', 'colors', 'positions', 'sizes'].some((key) => owns(body, key))) invalid('Organization requires a command')
  if (owns(body, 'groups') !== owns(body, 'baseGroups')) invalid('groups requires baseGroups')
  if (owns(body, 'groups')) {
    if (validateGroups(body.baseGroups).length || validateGroups(body.groups).length) invalid('Groups are invalid')
    if (!groupsEqual(board.groups || [], body.baseGroups)) conflict()
    if (validateGroups(body.groups, new Set(board.cards.map(({ id }) => id))).length) {
      throw typed('ORGANIZATION_CONFLICT', 'A group member no longer exists on this board')
    }
  }
  const colors = body.colors ?? []
  const positions = body.positions ?? []
  const sizes = body.sizes ?? []
  if (owns(body, 'colors') && (!Array.isArray(body.colors) || !colors.length || colors.length > 100)) invalid('colors requires 1..100 items')
  if (owns(body, 'positions') && (!Array.isArray(body.positions) || !positions.length || positions.length > 10_000)) invalid('positions requires 1..10000 items')
  if (owns(body, 'sizes') && (!Array.isArray(body.sizes) || !sizes.length || sizes.length > 100)) invalid('sizes requires 1..100 items')
  const colorIds = new Set()
  const positionIds = new Set()
  const sizeIds = new Set()
  for (const item of sizes) {
    if (!strictKeys(item, ['cardId', 'width', 'height', 'baseWidth', 'baseHeight']) || !nonempty(item.cardId)
      || ![item.width, item.height, item.baseWidth, item.baseHeight].every((value) => Number.isFinite(value) && value > 0)
      || sizeIds.has(item.cardId)) invalid('Size update is invalid')
    sizeIds.add(item.cardId)
  }
  for (const item of colors) {
    if (!strictKeys(item, ['cardId', 'color', 'baseColor']) || !nonempty(item.cardId)
      || ![item.color, item.baseColor].every((value) => value === null || isCardColor(value))
      || colorIds.has(item.cardId)) invalid('Color update is invalid')
    colorIds.add(item.cardId)
  }
  for (const item of positions) {
    if (!strictKeys(item, ['kind', 'id', 'x', 'y', 'baseX', 'baseY']) || !['card', 'transformation'].includes(item.kind)
      || !nonempty(item.id) || positionIds.has(`${item.kind}:${item.id}`)) invalid('Position update is invalid')
    for (const [x, y] of [[item.x, item.y], [item.baseX, item.baseY]]) {
      if (!(Number.isFinite(x) && Number.isFinite(y)) && !(item.kind === 'transformation' && x === null && y === null)) invalid('Position coordinates are invalid')
    }
    positionIds.add(`${item.kind}:${item.id}`)
  }
  const cardsById = new Map(board.cards.map((card) => [card.id, card]))
  const transformationsById = new Map(board.transformations.map((item) => [item.id, item]))
  for (const item of colors) {
    const card = cardsById.get(item.cardId)
    if (!card || (card.color ?? null) !== item.baseColor) conflict()
  }
  for (const item of positions) {
    const record = (item.kind === 'card' ? cardsById : transformationsById).get(item.id)
    if (!record || (record.x ?? null) !== item.baseX || (record.y ?? null) !== item.baseY) conflict()
  }
  for (const item of sizes) {
    const card = cardsById.get(item.cardId)
    if (!card || card.width !== item.baseWidth || card.height !== item.baseHeight) conflict()
  }
  const changedCards = new Set([...colorIds, ...sizeIds])
  const changedTransformations = new Set()
  for (const item of sizes) {
    const card = cardsById.get(item.cardId)
    card.width = item.width
    card.height = item.height
  }
  for (const item of colors) {
    const card = cardsById.get(item.cardId)
    if (item.color === null) delete card.color
    else card.color = item.color
  }
  for (const item of positions) {
    const record = (item.kind === 'card' ? cardsById : transformationsById).get(item.id)
    if (item.x === null) { delete record.x; delete record.y }
    else { record.x = item.x; record.y = item.y }
    const changed = item.kind === 'card' ? changedCards : changedTransformations
    changed.add(item.id)
  }
  if (owns(body, 'groups')) board.groups = structuredClone(body.groups)
  return {
    groups: structuredClone(board.groups || []),
    cards: board.cards.filter(({ id }) => changedCards.has(id)),
    transformations: board.transformations.filter(({ id }) => changedTransformations.has(id)),
  }
}

export function removeGroupMembers(board, deletedIds) {
  const affected = (board.groups || []).flatMap((group, index) => {
    if (!group.cardIds.some((id) => deletedIds.has(id))) return []
    const cardIds = group.cardIds.filter((id) => !deletedIds.has(id))
    return [{ index, before: structuredClone(group), after: cardIds.length ? { ...group, cardIds } : null }]
  })
  if (affected.length) {
    const changes = new Map(affected.map((item) => [item.before.id, item.after]))
    board.groups = board.groups.flatMap((group) => changes.has(group.id) ? (changes.get(group.id) ? [changes.get(group.id)] : []) : [group])
  }
  return affected
}

export function restoreGroupMembers(board, affected, restoredCards) {
  const groups = structuredClone(board.groups || [])
  for (const item of affected) {
    const current = groups.find((group) => group.id === item.before.id)
    if (!groupsEqual(current ? [current] : [], item.after ? [item.after] : [])) {
      throw typed('CARD_RESTORE_CONFLICT', 'An affected group changed after deletion')
    }
  }
  for (const item of affected) {
    const index = groups.findIndex((group) => group.id === item.before.id)
    if (index >= 0) groups[index] = structuredClone(item.before)
    else groups.splice(Math.min(item.index, groups.length), 0, structuredClone(item.before))
  }
  if (validateGroups(groups, new Set([...board.cards, ...restoredCards].map(({ id }) => id))).length) {
    throw typed('CARD_RESTORE_CONFLICT', 'Restored group membership conflicts with current organization')
  }
  return groups
}
