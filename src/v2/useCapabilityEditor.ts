import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uncertainCapabilitySave } from './capabilityForms'
export function useCapabilityEditor(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null)
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); dirtyCallback.current(false) } }, [])
  useLayoutEffect(() => { onDirtyChange(dirty || busy) }, [dirty, busy, onDirtyChange])
  async function perform<T>(action: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, mutation = true) {
    if (lock.current || uncertain) return false
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController()
    try { const result = await action(controller.current.signal); if (alive.current) success(result); return true }
    catch (cause) { if (alive.current) { setError(cause instanceof Error && cause.name === 'AbortError' ? '操作已停止。请重新核对当前状态。' : cause instanceof Error ? cause.message : '操作未完成，请核对后再试。'); if (mutation && uncertainCapabilitySave(cause)) setUncertain(true) }; return false }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return { busy, error, uncertain, setError, perform, cancel: () => controller.current?.abort() }
}
