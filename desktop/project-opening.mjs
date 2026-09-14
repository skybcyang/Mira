import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function openDesktopProject({ path, currentPath, prepareWorkspaceRoot = async path => path, startRuntime, createWindow, commitProject, activate }) {
  if (!path) return { cancelled: true }
  const selected = await prepareWorkspaceRoot(path)
  if (!selected) return { cancelled: true }
  if (currentPath && (resolve(selected) === resolve(currentPath)
    || await realpath(selected).catch(() => selected) === await realpath(currentPath).catch(() => currentPath))) return { cancelled: true }
  let runtime, window
  try {
    runtime = await startRuntime(selected)
    const response = await runtime.host.application.dispatch('GET', ['v2', 'project'])
    if (response.status !== 200) throw Object.assign(new Error(response.body.message), { code: response.body.code })
    const project = response.body.project
    window = await createWindow(runtime)
    window.show()
    await commitProject(project, runtime)
    activate({ runtime, window, project })
    return { cancelled: false }
  } catch (error) {
    window?.destroy()
    await runtime?.close()
    throw error
  }
}

export async function dispatchProjectMenuAction(window, action) {
  if (!window || window.isDestroyed()) return
  await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('mira:open-project', {detail:${JSON.stringify(action)}}))`, true)
}
