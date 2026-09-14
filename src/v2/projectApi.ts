import { request } from '../v2Api'

export interface ProjectIdentity { id: string; name: string; path: string }
export interface ProjectNavigation { opened: string[]; pinned: string[]; lastBoardId: string | null }
export interface ProjectContext {
  project: ProjectIdentity
  navigation: ProjectNavigation | null
  recentProjects: ProjectIdentity[]
  canSwitch: boolean
}
export interface OpenProjectInput { kind: 'open' | 'new' | 'recent' | 'restore'; projectId?: string }

export const projectApi = {
  async read(): Promise<ProjectContext | null> {
    try { return await request<ProjectContext>('GET', '/project') }
    catch (error) { if ((error as { status?: number }).status === 404) return null; throw error }
  },
  saveNavigation: (navigation: ProjectNavigation) => request<{ navigation: ProjectNavigation }>('PATCH', '/project/navigation', navigation),
  open: (input: OpenProjectInput) => request<{ cancelled: boolean }>('POST', '/project/open', input),
}
