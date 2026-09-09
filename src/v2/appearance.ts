export type ThemeDirection = 'studio' | 'editorial' | 'blueprint'
export type ColorScheme = 'light' | 'dark'

export interface Appearance {
  direction: ThemeDirection
  scheme: ColorScheme
}

export interface AppearanceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const APPEARANCE_STORAGE_KEYS = {
  direction: 'mira.appearance.direction',
  scheme: 'mira.appearance.scheme',
  legacy: 'mira.theme',
} as const

export const THEME_DIRECTIONS: ReadonlyArray<{
  id: ThemeDirection
  label: string
  shortLabel: string
}> = [
  { id: 'studio', label: '原生工作室', shortLabel: '原生' },
  { id: 'editorial', label: '编辑部', shortLabel: '编辑' },
  { id: 'blueprint', label: '蓝图台', shortLabel: '蓝图' },
]

function isDirection(value: string | null): value is ThemeDirection {
  return value === 'studio' || value === 'editorial' || value === 'blueprint'
}

function isScheme(value: string | null): value is ColorScheme {
  return value === 'light' || value === 'dark'
}

export function appearanceFromStorage(
  storage: AppearanceStorage,
  prefersDark: boolean,
): Appearance {
  const savedDirection = storage.getItem(APPEARANCE_STORAGE_KEYS.direction)
  const savedScheme = storage.getItem(APPEARANCE_STORAGE_KEYS.scheme)
  const legacyScheme = storage.getItem(APPEARANCE_STORAGE_KEYS.legacy)
  return {
    direction: isDirection(savedDirection) ? savedDirection : 'studio',
    scheme: isScheme(savedScheme)
      ? savedScheme
      : isScheme(legacyScheme)
        ? legacyScheme
        : prefersDark ? 'dark' : 'light',
  }
}

export function browserAppearance(): Appearance {
  try {
    return appearanceFromStorage(
      localStorage,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    )
  } catch {
    return { direction: 'studio', scheme: 'light' }
  }
}

export function persistAppearance(storage: AppearanceStorage, appearance: Appearance) {
  storage.setItem(APPEARANCE_STORAGE_KEYS.direction, appearance.direction)
  storage.setItem(APPEARANCE_STORAGE_KEYS.scheme, appearance.scheme)
  storage.removeItem?.(APPEARANCE_STORAGE_KEYS.legacy)
}

export function applyAppearance(
  root: Pick<HTMLElement, 'dataset'>,
  appearance: Appearance,
) {
  root.dataset.theme = appearance.direction
  root.dataset.colorScheme = appearance.scheme
}

export function reactFlowColorMode(appearance: Appearance): ColorScheme {
  return appearance.scheme
}
