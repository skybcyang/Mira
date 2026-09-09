import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_STORAGE_KEYS,
  appearanceFromStorage,
  persistAppearance,
  reactFlowColorMode,
  type Appearance,
} from './appearance'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, value) },
    removeItem(key: string) { values.delete(key) },
    value(key: string) { return values.get(key) },
  }
}

describe('appearance', () => {
  it.each([
    ['studio', 'light'],
    ['studio', 'dark'],
    ['editorial', 'light'],
    ['editorial', 'dark'],
    ['blueprint', 'light'],
    ['blueprint', 'dark'],
  ] as const)('restores %s %s without collapsing the two dimensions', (direction, scheme) => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEYS.direction]: direction,
      [APPEARANCE_STORAGE_KEYS.scheme]: scheme,
    })
    expect(appearanceFromStorage(storage, false)).toEqual({ direction, scheme })
  })

  it('migrates the legacy light/dark preference into Studio', () => {
    expect(appearanceFromStorage(memoryStorage({ 'mira.theme': 'dark' }), false))
      .toEqual({ direction: 'studio', scheme: 'dark' })
    expect(appearanceFromStorage(memoryStorage({ 'mira.theme': 'light' }), true))
      .toEqual({ direction: 'studio', scheme: 'light' })
  })

  it('falls back from invalid values and follows the initial system scheme', () => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEYS.direction]: 'neon',
      [APPEARANCE_STORAGE_KEYS.scheme]: 'sepia',
    })
    expect(appearanceFromStorage(storage, true)).toEqual({ direction: 'studio', scheme: 'dark' })
  })

  it('persists both dimensions and removes the legacy key', () => {
    const storage = memoryStorage({ 'mira.theme': 'light' })
    persistAppearance(storage, { direction: 'blueprint', scheme: 'dark' })
    expect(storage.value(APPEARANCE_STORAGE_KEYS.direction)).toBe('blueprint')
    expect(storage.value(APPEARANCE_STORAGE_KEYS.scheme)).toBe('dark')
    expect(storage.value('mira.theme')).toBeUndefined()
  })

  it('only passes the resolved color scheme to React Flow', () => {
    const appearance: Appearance = { direction: 'editorial', scheme: 'dark' }
    expect(reactFlowColorMode(appearance)).toBe('dark')
  })
})
