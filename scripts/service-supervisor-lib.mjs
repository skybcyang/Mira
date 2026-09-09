export function createRestartingSupervisor({
  startChild,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  logger = console,
  onStopped = () => {},
}) {
  if (typeof startChild !== 'function') {
    throw new TypeError('startChild must be a function')
  }

  let child
  let restartTimer
  let stopping = false

  function start() {
    if (stopping || child) return
    child = startChild()
    child.once('error', (error) => {
      logger.error(`[mira] service child error: ${error?.message || error}`)
    })
    child.once('exit', (code, signal) => {
      child = undefined
      if (stopping) {
        onStopped()
        return
      }
      logger.error(
        `[mira] service child exited (${signal || (code ?? 'unknown')}); restarting`,
      )
      restartTimer = schedule(() => {
        restartTimer = undefined
        start()
      }, 1_000)
    })
  }

  function stop() {
    if (stopping) return
    stopping = true
    if (restartTimer !== undefined) {
      cancelSchedule(restartTimer)
      restartTimer = undefined
    }
    if (child) child.kill('SIGTERM')
    else onStopped()
  }

  return { start, stop }
}
