import { describe, expect, it, vi } from 'vitest'
import { WorkflowStore, validateWorkflow } from '../../bridge/workflow-store.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      if (!files.has(from)) throw new Error(`missing temp: ${from}`)
      files.set(to, files.get(from))
      files.delete(from)
    },
    async remove(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
      files.delete(path)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function workflow(overrides = {}) {
  return {
    id: 'workflow-1',
    title: '研究到决策',
    description: '把材料推进成决策',
    steps: [
      {
        id: 'workflow-step-1',
        label: '形成决策',
        instruction: '综合材料形成决策',
        acceptance: '保留关键约束',
      },
    ],
    createdAt: '2026-08-23T04:00:00.000Z',
    updatedAt: '2026-08-23T04:00:00.000Z',
    ...overrides,
  }
}

function contractedWorkflow(overrides = {}) {
  return workflow({
    inputs: [{
      id: 'workflow-input-1',
      name: '需求说明',
      description: '本次要解决的问题',
      required: true,
      cardinality: 'one',
    }],
    steps: [{
      id: 'workflow-step-1',
      label: '形成决策',
      instruction: '综合材料形成决策',
      acceptance: '保留关键约束',
      sources: [{ kind: 'input', inputId: 'workflow-input-1' }],
    }],
    ...overrides,
  })
}

describe('workflow store', () => {
  it('writes a verified temp file before atomically replacing a template', async () => {
    const fs = memoryFs()
    const replace = vi.spyOn(fs, 'replace')
    const store = new WorkflowStore(fs)
    const template = workflow()

    await store.save(template.id, template)

    expect(replace).toHaveBeenCalledWith(
      'workflows-v2/workflow-1.json.tmp',
      'workflows-v2/workflow-1.json',
    )
    expect(fs.files.has('workflows-v2/workflow-1.json.tmp')).toBe(false)
    await expect(store.load(template.id)).resolves.toEqual(template)
  })

  it('rejects an empty or structurally invalid workflow before writing', async () => {
    const fs = memoryFs()
    const store = new WorkflowStore(fs)

    expect(validateWorkflow(workflow({ steps: [] }))).toContain(
      'workflow requires at least one step',
    )
    await expect(
      store.save('workflow-1', workflow({ title: '', steps: [] })),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' })
    expect(fs.files.size).toBe(0)
  })

  it('validates named inputs and step source contracts while accepting legacy templates', () => {
    expect(validateWorkflow(contractedWorkflow())).toEqual([])
    expect(validateWorkflow(workflow())).toEqual([])
    expect(validateWorkflow(contractedWorkflow({
      steps: [{
        id: 'workflow-step-1',
        label: '形成决策',
        instruction: '综合材料形成决策',
        acceptance: '',
        sources: [{ kind: 'input', inputId: 'missing-input' }],
      }],
    }))).toContain('workflow step workflow-step-1 references unknown input: missing-input')
  })

  it('does not replace the previous template when temp verification fails', async () => {
    const fs = memoryFs()
    const store = new WorkflowStore(fs)
    await store.save('workflow-1', workflow())
    const normalRead = fs.readText.bind(fs)
    fs.readText = vi.fn(async (path) =>
      path.endsWith('.tmp') ? '{invalid json' : normalRead(path),
    )
    const replace = vi.spyOn(fs, 'replace')

    await expect(
      store.save('workflow-1', workflow({ title: '不应写入' })),
    ).rejects.toMatchObject({ code: 'WORKFLOW_WRITE_FAILED' })
    expect(replace).not.toHaveBeenCalled()
    expect(JSON.parse(fs.files.get('workflows-v2/workflow-1.json')).title).toBe('研究到决策')
  })

  it('lists valid templates newest first while isolating corrupt files', async () => {
    const fs = memoryFs()
    const store = new WorkflowStore(fs)
    await store.save(
      'workflow-old',
      workflow({
        id: 'workflow-old',
        title: '旧流程',
        updatedAt: '2026-08-23T03:00:00.000Z',
      }),
    )
    await store.save(
      'workflow-new',
      workflow({
        id: 'workflow-new',
        title: '新流程',
        updatedAt: '2026-08-23T05:00:00.000Z',
      }),
    )
    fs.files.set('workflows-v2/corrupt.json', '{bad')

    await expect(store.list()).resolves.toEqual([
      workflow({
        id: 'workflow-new',
        title: '新流程',
        updatedAt: '2026-08-23T05:00:00.000Z',
      }),
      workflow({
        id: 'workflow-old',
        title: '旧流程',
        updatedAt: '2026-08-23T03:00:00.000Z',
      }),
    ])
  })

  it('lists strict templates deterministically and fails closed on corrupt members', async () => {
    const fs = memoryFs()
    const store = new WorkflowStore(fs)
    await store.save('workflow-z', workflow({ id: 'workflow-z' }))
    await store.save('workflow-a', workflow({ id: 'workflow-a' }))

    await expect(store.listStrict()).resolves.toEqual([
      expect.objectContaining({ id: 'workflow-a' }),
      expect.objectContaining({ id: 'workflow-z' }),
    ])
    fs.files.set('workflows-v2/broken.json', '{bad')
    await expect(store.listStrict()).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' })
  })

  it('reuses an explicit Workflow/mutation lease while a snapshot is queued', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const store = new WorkflowStore(fs, 'workflows-v2', { coordinator })
    await store.save('workflow-1', workflow())
    let continueOperation
    const mayContinue = new Promise((resolve) => {
      continueOperation = resolve
    })
    let operationStarted
    const didStart = new Promise((resolve) => {
      operationStarted = resolve
    })
    const events = []

    const update = store.withLockedWorkflow('workflow-1', async (current, lease) => {
      events.push('workflow:start')
      operationStarted()
      await mayContinue
      await store.save(current.id, { ...current, title: '已更新' }, lease)
      events.push('workflow:end')
    })
    await didStart
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot')
    })
    continueOperation()

    await Promise.all([update, snapshot])
    expect(events).toEqual(['workflow:start', 'workflow:end', 'snapshot'])
  })

  it('does not disguise workflow storage failures as missing or empty data', async () => {
    const failure = Object.assign(new Error('disk offline'), { code: 'EIO' })
    const readFs = memoryFs()
    readFs.readText = async () => {
      throw failure
    }
    await expect(new WorkflowStore(readFs).load('workflow-1')).rejects.toMatchObject({
      code: 'WORKFLOW_READ_FAILED',
    })

    const listFs = memoryFs()
    listFs.listJson = async () => {
      throw failure
    }
    await expect(new WorkflowStore(listFs).list()).rejects.toMatchObject({
      code: 'WORKFLOW_READ_FAILED',
    })

    const memberFs = memoryFs()
    memberFs.files.set('workflows-v2/workflow-1.json', JSON.stringify(workflow()))
    memberFs.readText = async () => {
      throw failure
    }
    await expect(new WorkflowStore(memberFs).list()).rejects.toMatchObject({
      code: 'WORKFLOW_READ_FAILED',
    })
  })

  it('deletes only the requested template and maps missing templates explicitly', async () => {
    const fs = memoryFs()
    const store = new WorkflowStore(fs)
    await store.save('workflow-1', workflow())
    const remove = vi.spyOn(fs, 'remove')

    await expect(store.delete('workflow-1')).resolves.toEqual({
      deletedWorkflowId: 'workflow-1',
    })
    expect(remove).toHaveBeenCalledWith('workflows-v2/workflow-1.json')
    await expect(store.load('workflow-1')).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    })
    await expect(store.delete('../workflow-2')).rejects.toMatchObject({ code: 'BAD_PATH' })
  })
})
