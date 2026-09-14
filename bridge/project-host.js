import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { httpStatusForCode } from './mira-http.js'

const statuses = { PROJECT_NAVIGATION_INVALID: 422, PROJECT_HOST_UNAVAILABLE: 503, PROJECT_BUSY: 409, PROJECT_SWITCHING: 409, WORKSPACE_FORMAT_INVALID: 422 }
export function projectHostError(code, message) { return Object.assign(new Error(message), { code }) }
export function validateProjectNavigation(value) {
  const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['opened', 'pinned', 'lastBoardId'].includes(key))
    || !['opened', 'pinned'].every(key => Array.isArray(value[key]) && value[key].length <= 1000 && value[key].every(id))
    || !(value.lastBoardId === null || id(value.lastBoardId))) {
    throw projectHostError('PROJECT_NAVIGATION_INVALID', '画板打开记录无效，请重新核对。')
  }
  return { opened: [...new Set(value.opened)], pinned: [...new Set(value.pinned)], lastBoardId: value.lastBoardId }
}
export function describeProject(workspaceRoot, workspace) {
  return {
    id: workspace?.id || `legacy-${createHash('sha256').update(realpathSync(workspaceRoot)).digest('hex')}`,
    name: workspace?.name || basename(workspaceRoot), path: workspaceRoot,
  }
}
export function createProjectHostRoutes({ project, adapter, application, drainMutations }) {
  let switching = false
  const switchingResponse = () => ({ status: 409, body: { code: 'PROJECT_SWITCHING', message: '正在切换项目，请稍候。' } })
  return {
    get switching() { return switching },
    switchingResponse,
    async dispatch(method, segments, body) {
      if (segments[0] !== 'v2' || segments[1] !== 'project') return null
      try {
        if (method === 'GET' && segments.length === 2) return { status: 200, body: {
          project, navigation: adapter ? await adapter.getNavigation(project) : null,
          recentProjects: adapter ? await adapter.getRecentProjects() : [], canSwitch: Boolean(adapter),
        } }
        if (!adapter) throw projectHostError('PROJECT_HOST_UNAVAILABLE', '当前宿主不支持切换项目。')
        if (method === 'PATCH' && segments.length === 3 && segments[2] === 'navigation') {
          const navigation = validateProjectNavigation(body)
          return { status: 200, body: { navigation: await adapter.saveNavigation(project, navigation) } }
        }
        if (method !== 'POST' || segments.length !== 3 || segments[2] !== 'open') return null
        if (switching || adapter.isStaging?.()) return switchingResponse()
        if (!body || !['open', 'new', 'recent', 'restore'].includes(body.kind)
          || Object.keys(body).some(key => !['kind', 'projectId'].includes(key))
          || (body.kind === 'recent' ? typeof body.projectId !== 'string' || !body.projectId : body.projectId !== undefined)) {
          throw projectHostError('BAD_REQUEST', '请选择有效的项目打开方式。')
        }
        switching = true
        try {
          await drainMutations()
          const response = await application.dispatch('GET', ['v2', 'boards', 'activity'])
          if (response.status !== 200 || !response.body?.activity) throw projectHostError('PROJECT_BUSY', '无法核对项目的运行状态，请重试。')
          if (Object.values(response.body.activity).some(value => value.activeRuns > 0 || value.pendingCandidates > 0)) {
            throw projectHostError('PROJECT_BUSY', '请先停止运行并处理待比较结果，再切换项目。')
          }
          const result = await adapter.open(body, project)
          if (result.cancelled) switching = false
          return { status: 200, body: { cancelled: Boolean(result.cancelled) } }
        } catch (error) { switching = false; throw error }
      } catch (error) {
        return { status: statuses[error.code] || httpStatusForCode(error.code), body: { code: error.code || 'INTERNAL', message: error.message, details: error.details } }
      }
    },
  }
}
