import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { validateProjectNavigation, projectHostError } from '../bridge/project-host.js'

function validateProject(project) {
  if (!project || !['id', 'name', 'path'].every(key => typeof project[key] === 'string' && project[key].length > 0)
    || !isAbsolute(project.path)) throw projectHostError('PROJECT_NAVIGATION_INVALID', '本机项目记录无效。')
  return { id: project.id, name: project.name, path: project.path }
}
function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.recentProjects) || value.recentProjects.length > 10
    || !(value.currentProjectId === null || typeof value.currentProjectId === 'string')
    || !value.navigation || typeof value.navigation !== 'object' || Array.isArray(value.navigation)) {
    throw projectHostError('PROJECT_NAVIGATION_INVALID', '本机项目记录无效。')
  }
  const recentProjects = value.recentProjects.map(validateProject)
  if (new Set(recentProjects.map(project => project.id)).size !== recentProjects.length
    || (value.currentProjectId && !recentProjects.some(project => project.id === value.currentProjectId))) {
    throw projectHostError('PROJECT_NAVIGATION_INVALID', '本机项目记录无效。')
  }
  return { version: 1, currentProjectId: value.currentProjectId, recentProjects,
    navigation: Object.fromEntries(Object.entries(value.navigation).map(([id, navigation]) => [id, validateProjectNavigation(navigation)])),
  }
}

export async function createProjectStateStore(userDataRoot, { onReadError } = {}) {
  const statePath = join(userDataRoot, 'project-state.json')
  let state = { version: 1, currentProjectId: null, recentProjects: [], navigation: {} }
  try { state = validateState(JSON.parse(await readFile(statePath, 'utf8'))) } catch (error) {
    if (error.code !== 'ENOENT') {
      const failure = projectHostError('PROJECT_NAVIGATION_INVALID', '无法读取本机项目打开记录，将从项目总览继续。')
      if (!onReadError) throw failure
      await onReadError(failure)
    }
  }
  let tail = Promise.resolve()
  function update(change) {
    const operation = tail.then(async () => {
      const next = validateState(change(structuredClone(state)))
      const temporaryPath = join(userDataRoot, `.project-state-${randomUUID()}.tmp`)
      await mkdir(userDataRoot, { recursive: true })
      try {
        await writeFile(temporaryPath, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
        validateState(JSON.parse(await readFile(temporaryPath, 'utf8')))
        await rename(temporaryPath, statePath)
        state = next
      } finally { await unlink(temporaryPath).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    })
    // Callers receive write failures; the queue itself only tracks completion.
    tail = operation.catch(() => undefined)
    return operation
  }
  return {
    currentProject: () => structuredClone(state.recentProjects.find(project => project.id === state.currentProjectId) || null),
    getRecentProjects: () => structuredClone(state.recentProjects),
    getNavigation: project => structuredClone(Object.hasOwn(state.navigation, project.id) ? state.navigation[project.id] : null),
    async saveNavigation(project, value) {
      const navigation = validateProjectNavigation(value)
      await update(current => ({ ...current, navigation: { ...current.navigation, [project.id]: navigation } }))
      return navigation
    },
    commitOpen(project, navigation) {
      const entry = validateProject(project)
      return update(current => ({ ...current, currentProjectId: entry.id,
        ...(navigation ? { navigation: { ...current.navigation, [entry.id]: validateProjectNavigation(navigation) } } : {}),
        recentProjects: [entry, ...current.recentProjects.filter(item => item.id !== entry.id)].slice(0, 10),
      }))
    },
    flush: () => tail,
  }
}
