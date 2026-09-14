import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createProjectStateStore } from '../../desktop/project-state.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const path = await mkdtemp(join(tmpdir(), 'mira-project-state-')); roots.push(path); return path }
const project = id => ({ id, name: `Project ${id}`, path: `/tmp/${id}` })

it('persists ordered project navigation including all-closed and overview separately across restarts', async () => {
  const path = await root(), store = await createProjectStateStore(path)
  expect(store.getNavigation(project('a'))).toBeNull()
  await store.commitOpen(project('a'))
  await store.saveNavigation(project('a'), { opened: ['a1', 'a1'], pinned: ['a2'], lastBoardId: null })
  await store.commitOpen(project('b'))
  await store.saveNavigation(project('b'), { opened: [], pinned: [], lastBoardId: null })
  const next = await createProjectStateStore(path)
  expect(next.currentProject()).toEqual(project('b'))
  expect(next.getNavigation(project('a'))).toEqual({ opened: ['a1'], pinned: ['a2'], lastBoardId: null })
  expect(next.getNavigation(project('b'))).toEqual({ opened: [], pinned: [], lastBoardId: null })
})

it('serializes writes, retains only ten successful recents, and rejects invalid records without overwriting', async () => {
  const path = await root(), store = await createProjectStateStore(path)
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.commitOpen(project(String(index)))))
  await Promise.all([1, 2, 3].map(index => store.saveNavigation(project('11'), { opened: [`b${index}`], pinned: [], lastBoardId: `b${index}` })))
  expect(store.getRecentProjects().map(item => item.id)).toEqual(['11','10','9','8','7','6','5','4','3','2'])
  const before = await readFile(join(path, 'project-state.json'), 'utf8')
  await expect(store.saveNavigation(project('11'), { opened: Array(1001).fill('b'), pinned: [], lastBoardId: null })).rejects.toMatchObject({ code: 'PROJECT_NAVIGATION_INVALID' })
  expect(await readFile(join(path, 'project-state.json'), 'utf8')).toBe(before)
  expect((await createProjectStateStore(path)).getNavigation(project('11')).lastBoardId).toBe('b3')
})

it('reports corrupt local preferences without treating them as valid all-closed records', async () => {
  const path = await root()
  await writeFile(join(path, 'project-state.json'), '{bad')
  await expect(createProjectStateStore(path)).rejects.toMatchObject({ code: 'PROJECT_NAVIGATION_INVALID' })
  const errors = [], store = await createProjectStateStore(path, { onReadError: error => errors.push(error) })
  expect(errors).toHaveLength(1)
  expect(store.getNavigation(project('a'))).toBeNull()
  expect(await readFile(join(path, 'project-state.json'), 'utf8')).toBe('{bad')
})

it('commits buffered renderer navigation together with the successful recent project', async () => {
  const path = await root(), store = await createProjectStateStore(path)
  const navigation = { opened: ['board-a'], pinned: [], lastBoardId: null }
  await store.commitOpen(project('a'), navigation)
  const reopened = await createProjectStateStore(path)
  expect(reopened.currentProject()).toEqual(project('a'))
  expect(reopened.getNavigation(project('a'))).toEqual(navigation)
})
