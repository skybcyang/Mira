import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

export function createStagedProjectHost({ projectState, open }) {
  let staging = true, commitPromise, pendingNavigation
  return {
    isStaging: () => staging,
    getNavigation: project => pendingNavigation || projectState.getNavigation(project),
    getRecentProjects: projectState.getRecentProjects,
    async saveNavigation(project, navigation) {
      if (commitPromise) {
        await commitPromise
        return projectState.saveNavigation(project, navigation)
      }
      if (!staging) return projectState.saveNavigation(project, navigation)
      pendingNavigation = navigation
      return navigation
    },
    async commit(project) {
      const operation = projectState.commitOpen(project, pendingNavigation)
      commitPromise = operation
      try { await operation; staging = false; pendingNavigation = undefined }
      finally { if (commitPromise === operation) commitPromise = undefined }
    },
    open,
  }
}

export async function openDesktopProject({ path, currentPath, allowCreate = false, prepareWorkspaceRoot = async path => path, startRuntime, createWindow, commitProject, activate }) {
  if (!path) return { cancelled: true }
  const selected = await prepareWorkspaceRoot(path, { mustExist: !allowCreate })
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
    await commitProject(project, runtime)
    const afterResponse = activate({ runtime, window, project })
    return { cancelled: false, ...(afterResponse ? { afterResponse } : {}) }
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
