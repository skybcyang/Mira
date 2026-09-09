import { useEffect, useState } from 'react'

export function readWorkbenchPreference<T extends string>(key: string, allowed: readonly T[], fallback: T, storage?: Pick<Storage, 'getItem'>): T {
  try {
    const value = (storage || (typeof window !== 'undefined' ? window.localStorage : null))?.getItem(`mira.workbench.v1.${key}`)
    return allowed.includes(value as T) ? value as T : fallback
  } catch { return fallback }
}

export function useWorkbenchPreference<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState(() => readWorkbenchPreference(key, allowed, fallback))
  useEffect(() => {
    try { window.localStorage.setItem(`mira.workbench.v1.${key}`, value) } catch { /* UI preferences are optional. */ }
  }, [key, value])
  return [value, setValue] as const
}
