import type { TransformationRun } from '../domain'

export function mergeCheckpointPreviewRuns(
  boardId: string,
  complete: Record<string, TransformationRun>,
  live: Record<string, TransformationRun> = {},
): Record<string, TransformationRun> {
  const runs = new Map<string, TransformationRun>()
  for (const run of [...Object.values(complete), ...Object.values(live)]) {
    if (run.boardId !== boardId) continue
    const previous = runs.get(run.id)
    const resolvedCandidate = previous?.status === 'succeeded'
      && previous.result?.disposition === 'candidate'
      && run.status === 'succeeded'
      && (run.result?.disposition === 'applied' || run.result?.disposition === 'discarded')
    if (!previous || lifecycleStage(run) > lifecycleStage(previous) || resolvedCandidate) {
      runs.set(run.id, run)
    }
  }
  return Object.fromEntries(runs)
}

// Run history is complete on the server; the Canvas cache can only advance its lifecycle.
function lifecycleStage(run: TransformationRun): number {
  if (run.status === 'queued') return 0
  if (run.status === 'running') return 1
  return 2
}
