import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function invokeAsPromise(operation) {
  try {
    return Promise.resolve(operation())
  } catch (error) {
    return Promise.reject(error)
  }
}

export function handleAllWindowsClosed(platform, quit) {
  if (platform !== 'darwin') quit()
}

// Windows GUI processes cannot reliably exchange stdio with their parent.
export async function completeDesktopSmoke({ environment, userDataRoot, quit }) {
  if (environment.MIRA_DESKTOP_SMOKE !== '1' || environment.MIRA_DESKTOP_SMOKE_EXIT_ON_READY !== '1') return
  await writeFile(join(userDataRoot, 'smoke-ready'), 'ready', { flag: 'wx' })
  await quit()
}

export async function closeDesktopResources({
  flushState,
  closeHost,
  onStateError = () => {},
}) {
  const stateFlush = invokeAsPromise(flushState)
  const hostClose = invokeAsPromise(closeHost)
  const [stateResult, hostResult] = await Promise.allSettled([stateFlush, hostClose])

  if (stateResult.status === 'rejected') onStateError(stateResult.reason)
  if (hostResult.status === 'rejected') throw hostResult.reason
}

export function createShutdownController({
  closeHost,
  quit,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
  timeoutMs = 2_000,
}) {
  let shutdownPromise
  let hasQuit = false

  function quitOnce() {
    if (hasQuit) return
    hasQuit = true
    quit()
  }

  return {
    request() {
      if (shutdownPromise) return shutdownPromise

      let hostClosePromise
      try {
        hostClosePromise = Promise.resolve(closeHost()).catch(() => undefined)
      } catch {
        hostClosePromise = Promise.resolve()
      }

      let timeoutHandle
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = scheduleTimeout(resolve, timeoutMs)
      })

      shutdownPromise = Promise.race([hostClosePromise, timeoutPromise])
        .then(() => undefined)
        .finally(() => {
          cancelTimeout(timeoutHandle)
          quitOnce()
        })

      return shutdownPromise
    },
  }
}

export function focusExistingWindow(window) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
