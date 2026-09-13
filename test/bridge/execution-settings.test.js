import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodeFs from 'node:fs/promises'
import { validateWorkspaceBackup } from '../../bridge/domain/workspace-backup.js'
import { createMiraApplication, createMiraStores } from '../../bridge/mira-application.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { restoreWorkspaceBackup } from '../../bridge/node-backup-restore.js'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mira-execution-settings-'))
  roots.push(root)
  const fs = createNodeWorkspaceAdapter(root)
  const stores = createMiraStores({ fs })
  return { root, fs, stores, store: stores.executionSettingsStore }
}

describe('project execution settings', () => {
  it('reads the default without creating a file and persists an explicitly selected rule', async () => {
    const { root, store } = await fixture()
    expect(store).toBeDefined()
    expect(await store.load()).toMatchObject({ revision: 0, defaultOutputPolicy: { id: 'concise' }, guidance: [] })
    await expect(readFile(join(root, 'execution-settings-v1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const saved = await store.update({ baseRevision: 0, defaultOutputPolicy: { id: 'balanced', version: '1.0.0', text: '保留限定，简明说明。' } })
    expect(saved).toMatchObject({ revision: 1, defaultOutputPolicy: { id: 'balanced', customized: true, text: '保留限定，简明说明。' } })
    expect(await store.load()).toEqual(saved)
  })

  it('appends immutable guidance versions and disables selection without removing history', async () => {
    const { store } = await fixture()
    expect(store).toBeDefined()
    const first = await store.update({ baseRevision: 0, guidance: { title: '写作检查', text: '保留范围。', origin: 'imported' } })
    const guide = first.guidance[0]
    expect(guide).toMatchObject({ version: '1', origin: 'imported', customized: false })
    const second = await store.update({ baseRevision: 1, guidance: { id: guide.id, title: '写作检查', text: '保留范围与不确定性。' } })
    expect(second.guidance[0]).toEqual(guide)
    expect(second.guidance[1]).toMatchObject({ id: guide.id, version: '2', origin: 'imported' })
    expect(await store.update({ baseRevision: 2, guidance: { id: guide.id, title: '写作检查', text: '保留范围与不确定性。' } })).toEqual(second)
    const stopped = await store.update({ baseRevision: 2, disabledGuidance: { id: guide.id, disabled: true } })
    expect(stopped.guidance).toEqual(second.guidance)
    expect(stopped.disabledGuidanceIds).toEqual([guide.id])
    expect((await store.update({ baseRevision: 3, disabledGuidance: { id: guide.id, disabled: false } })).disabledGuidanceIds).toEqual([])
  })

  it('rejects stale, malformed and failed writes without replacing the saved settings', async () => {
    const { root, fs, store } = await fixture()
    expect(store).toBeDefined()
    const results = await Promise.allSettled([
      store.update({ baseRevision: 0, defaultOutputPolicy: null }),
      store.update({ baseRevision: 0, defaultOutputPolicy: { id: 'balanced', version: '1.0.0' } }),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('EXECUTION_SETTINGS_CONFLICT')
    const saved = await store.load()
    for (const input of [
      { guidance: { id: 'mira-close-reading', title: '冒充', text: '正文' } },
      { defaultOutputPolicy: { id: 'concise', version: '1.0.0', format: 'table' } },
      { guidance: { title: '代码', text: '正文', execute: 'python' } },
      { defaultOutputPolicy: null, disabledGuidance: { id: 'unknown', disabled: true } },
    ]) await expect(store.update({ baseRevision: saved.revision, ...input })).rejects.toBeDefined()
    const replace = fs.replace
    fs.replace = async () => { throw new Error('disk unavailable') }
    await expect(store.update({ baseRevision: saved.revision, guidance: { title: '检查', text: '正文' } })).rejects.toMatchObject({ code: 'EXECUTION_SETTINGS_WRITE_FAILED' })
    fs.replace = replace
    expect(await store.load()).toEqual(saved)
    await writeFile(join(root, 'execution-settings-v1.json'), '{broken')
    await expect(store.load()).rejects.toMatchObject({ code: 'EXECUTION_SETTINGS_INVALID' })
  })

  it('freezes project defaults and exact local guidance in ordinary steps and plans, without running', async () => {
    const { stores } = await fixture()
    const app = createMiraApplication({ stores })
    const settingsResponse = await app.dispatch('GET', ['v2', 'execution-settings'])
    expect(settingsResponse.status).toBe(200)
    const board = await stores.boardStore.create('默认规则')
    const { card } = await app.handlers.createCard(board.id, { markdown: '有范围的材料。' })
    const input = { sourceRefs: [{ cardId: card.id, versionId: card.headVersionId }], label: '成果', instruction: '明确范围', acceptance: '', targetPosition: { x: 400, y: 0 } }
    const first = await app.handlers.createTransformation(board.id, input)
    await app.dispatch('PATCH', ['v2', 'execution-settings'], { baseRevision: 0, defaultOutputPolicy: { id: 'detailed', version: '1.0.0' } })
    const saved = await app.dispatch('PATCH', ['v2', 'execution-settings'], { baseRevision: 1, guidance: { title: '限定检查', text: '不扩大判断强度。' } })
    const guide = saved.body.settings.guidance[0]
    const second = await app.handlers.createTransformation(board.id, { ...input, guidance: { id: guide.id, version: guide.version } })
    expect(first.transformation.outputPolicy.id).toBe('concise')
    expect(second.transformation).toMatchObject({ outputPolicy: { id: 'detailed' }, guidance: guide })
    const plan = await app.workflowService.createPlan(board.id, { title: '计划', sourceRefs: input.sourceRefs, targetPosition: input.targetPosition, steps: [{ label: '一', instruction: '检查', acceptance: '', guidance: { id: guide.id, version: guide.version } }, { label: '二', instruction: '汇总', acceptance: '' }] })
    expect(plan.transformations.every(step => step.outputPolicy.id === 'detailed')).toBe(true)
    expect(plan.transformations[0].guidance).toEqual(guide)
    const batch = await app.handlers.createTransformations(board.id, { sourceRefs: input.sourceRefs, targetPosition: input.targetPosition,
      transformations: [{ label: '方向一', instruction: '检查范围', guidance: { id: guide.id, version: guide.version } }, { label: '方向二', instruction: '检查时间' }] })
    expect(batch.transformations.every(step => step.outputPolicy.id === 'detailed')).toBe(true)
    expect(batch.transformations[0].guidance).toEqual(guide)
    await app.dispatch('PATCH', ['v2', 'execution-settings'], { baseRevision: 2, disabledGuidance: { id: guide.id, disabled: true } })
    expect((await app.dispatch('GET', ['v2', 'guidance'])).body.guidance.some(item => item.id === guide.id)).toBe(false)
    await expect(app.handlers.createTransformation(board.id, { ...input, guidance: { id: guide.id, version: guide.version } })).rejects.toMatchObject({ code: 'GUIDANCE_UNAVAILABLE' })
    expect((await stores.boardStore.load(board.id)).transformations.find(step => step.id === second.transformation.id).guidance).toEqual(guide)
    expect(await stores.runStore.listStrict()).toEqual([])
  })

  it('exports V4 and restores settings and every guidance version to an independent project', async () => {
    const { root, stores, store } = await fixture()
    expect(store).toBeDefined()
    const first = await store.update({ baseRevision: 0, guidance: { title: '精读', text: '逐段核对。', origin: 'imported' } })
    const saved = await store.update({ baseRevision: 1, guidance: { id: first.guidance[0].id, title: '精读', text: '逐段核对并保留范围。' } })
    const app = createMiraApplication({ stores })
    const backup = await app.backupService.exportBackup()
    expect(backup.formatVersion).toBe(4)
    expect(backup.executionSettings).toEqual(saved)
    const inputPath = join(root, 'backup.json'), workspaceRoot = join(root, 'restored')
    await writeFile(inputPath, JSON.stringify(backup))
    await restoreWorkspaceBackup({ inputPath, workspaceRoot })
    expect(JSON.parse(await readFile(join(workspaceRoot, '.mira/execution-settings-v1.json'), 'utf8'))).toEqual(saved)
  })

  it('executes frozen guidance after the project directory changes and is disabled', async () => {
    const { stores, store } = await fixture()
    const executeModel = vi.fn(async () => ({ outputText: '核对完成。' }))
    const app = createMiraApplication({ stores, executeModel })
    await app.ready
    const saved = await store.update({ baseRevision: 0, guidance: { title: '检查', text: '本次只核对已选材料。' } })
    const guide = saved.guidance[0]
    const board = await stores.boardStore.create('冻结测试')
    const { card } = await app.handlers.createCard(board.id, { markdown: '已选材料' })
    const { transformation } = await app.handlers.createTransformation(board.id, {
      sourceRefs: [{ cardId: card.id, versionId: card.headVersionId }], label: '结果', instruction: '检查', guidance: { id: guide.id, version: guide.version },
    })
    await store.update({ baseRevision: 1, guidance: { id: guide.id, title: '检查', text: '新版规则不应进入旧步骤。' } })
    await store.update({ baseRevision: 2, disabledGuidance: { id: guide.id, disabled: true } })
    expect(await stores.runStore.listStrict()).toEqual([])
    await app.handlers.startRun(board.id, transformation.id)
    await vi.waitFor(async () => expect((await stores.runStore.listStrict())[0]?.status).toBe('succeeded'))
    expect(executeModel.mock.calls[0][0].prompt).toContain(guide.text)
    expect(executeModel.mock.calls[0][0].prompt).not.toContain('新版规则不应进入旧步骤。')
    const run = (await stores.runStore.listStrict())[0]
    expect(run.guidanceSnapshot).toEqual(guide)
    expect(run.outputPolicySnapshot).toEqual(transformation.outputPolicy)
  })

  it('rejects damaged settings before restore and rolls back a changed staging file', async () => {
    const { root, stores, store } = await fixture()
    await store.update({ baseRevision: 0, guidance: { title: '检查', text: '原规则' } })
    const backup = await createMiraApplication({ stores }).backupService.exportBackup()
    const invalid = structuredClone(backup)
    invalid.executionSettings.guidance[0].text = '损坏规则'
    expect(() => validateWorkspaceBackup(invalid)).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
    const inputPath = join(root, 'backup.json'), workspaceRoot = join(root, 'restore-fault')
    await writeFile(inputPath, JSON.stringify(backup))
    const readStaged = async (path, ...args) => {
      const text = await nodeFs.readFile(path, ...args)
      if (String(path).endsWith('/execution-settings-v1.json')) { const value = JSON.parse(text); value.revision += 1; return JSON.stringify(value) }
      return text
    }
    await expect(restoreWorkspaceBackup({ inputPath, workspaceRoot }, { fs: { ...nodeFs, readFile: readStaged } })).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' })
    await expect(nodeFs.stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await nodeFs.readdir(root)).some(name => name.includes('.mira-restore-'))).toBe(false)
    const legacy = { ...backup, formatVersion: 3 }
    delete legacy.executionSettings
    await writeFile(inputPath, JSON.stringify(legacy))
    await restoreWorkspaceBackup({ inputPath, workspaceRoot })
    await expect(readFile(join(workspaceRoot, '.mira/execution-settings-v1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
