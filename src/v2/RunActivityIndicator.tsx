import { Clock3, LoaderCircle } from 'lucide-react'
import type { TransformationRun } from '../domain'

/** Decorative companion to the adjacent, readable run status. */
export default function RunActivityIndicator({ status, size = 14 }: {
  status?: TransformationRun['status'] | 'idle'
  size?: number
}) {
  if (status === 'queued') return <Clock3 className="v2-run-indicator is-queued" size={size} aria-hidden="true" />
  if (status === 'running') return <LoaderCircle className="v2-run-indicator is-running" size={size} aria-hidden="true" />
  return null
}
