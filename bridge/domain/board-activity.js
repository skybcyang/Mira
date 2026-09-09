export function summarizeBoardActivity(runs) {
  const activity = Object.create(null)
  for (const run of runs) {
    const active = run.status === 'queued' || run.status === 'running'
    const candidate = run.status === 'succeeded' && run.result?.disposition === 'candidate'
    if (!active && !candidate) continue
    const counts = activity[run.boardId] ||= { activeRuns: 0, pendingCandidates: 0 }
    counts.activeRuns += Number(active)
    counts.pendingCandidates += Number(candidate)
  }
  return activity
}
