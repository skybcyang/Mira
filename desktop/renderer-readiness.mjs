export const RENDERER_READINESS_SCRIPT = `(() => new Promise((resolve) => {
  const deadline = Date.now() + 10000
  const inspect = async () => {
    const root = document.getElementById('root')
    const mounted = Boolean(root && root.childElementCount > 0 && root.textContent.trim())
    const styled = document.styleSheets.length > 0
    const projectState = document.querySelector('main[data-project-ready]')?.getAttribute('data-project-ready')
    const projectReady = projectState === 'true'
    if (projectState === 'error') { resolve({ apiReady: false, mounted, styled, projectReady: false, projectFailed: true }); return }
    let apiReady = false
    if (mounted && styled && projectReady) {
      try {
        const response = await fetch('/graphmind/api/v2/boards', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        const body = response.ok ? await response.json() : null
        apiReady = Boolean(body && Array.isArray(body.boards))
      } catch {}
    }
    const state = { apiReady, mounted, styled, projectReady }
    if ((apiReady && mounted && styled && projectReady) || Date.now() >= deadline) {
      resolve(state)
      return
    }
    setTimeout(inspect, 50)
  }
  void inspect()
}))()`

export async function verifyRendererReady(webContents) {
  const result = await webContents.executeJavaScript(RENDERER_READINESS_SCRIPT, true)
  if (result?.projectFailed) throw new Error('Mira project did not become ready')
  if (result?.apiReady && result?.mounted && result?.styled && result?.projectReady) return
  throw new Error('Mira renderer did not become ready')
}
