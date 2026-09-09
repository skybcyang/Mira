import { createStorageCoordinator } from './storage-coordinator.js'
import { typed } from './domain/errors.js'

export function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') return ['workflow must be an object']
  const errors = []
  if (typeof workflow.id !== 'string' || !workflow.id.trim()) {
    errors.push('workflow missing id')
  }
  if (typeof workflow.title !== 'string' || !workflow.title.trim()) {
    errors.push('workflow missing title')
  }
  if (typeof workflow.description !== 'string') {
    errors.push('workflow has invalid description')
  }
  const hasInputs = Object.prototype.hasOwnProperty.call(workflow, 'inputs')
  const inputIds = new Set()
  if (hasInputs) {
    if (!Array.isArray(workflow.inputs) || workflow.inputs.length === 0) {
      errors.push('workflow requires at least one input')
    } else {
      for (const input of workflow.inputs) {
        if (!input || typeof input.id !== 'string' || !input.id.trim()) {
          errors.push('workflow input missing id')
          continue
        }
        if (inputIds.has(input.id)) errors.push(`duplicate workflow input id: ${input.id}`)
        inputIds.add(input.id)
        if (typeof input.name !== 'string' || !input.name.trim()) {
          errors.push(`workflow input ${input.id} missing name`)
        }
        if (typeof input.description !== 'string') {
          errors.push(`workflow input ${input.id} has invalid description`)
        }
        if (typeof input.required !== 'boolean') {
          errors.push(`workflow input ${input.id} has invalid required flag`)
        }
        if (input.cardinality !== 'one' && input.cardinality !== 'many') {
          errors.push(`workflow input ${input.id} has invalid cardinality`)
        }
      }
    }
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('workflow requires at least one step')
  } else {
    const stepIds = new Set()
    for (const step of workflow.steps) {
      if (!step || typeof step.id !== 'string' || !step.id.trim()) {
        errors.push('workflow step missing id')
        continue
      }
      if (stepIds.has(step.id)) errors.push(`duplicate workflow step id: ${step.id}`)
      stepIds.add(step.id)
      if (typeof step.label !== 'string' || !step.label.trim()) {
        errors.push(`workflow step ${step.id} missing label`)
      }
      if (typeof step.instruction !== 'string' || !step.instruction.trim()) {
        errors.push(`workflow step ${step.id} missing instruction`)
      }
      if (typeof step.acceptance !== 'string') {
        errors.push(`workflow step ${step.id} has invalid acceptance`)
      }
      if (
        Object.prototype.hasOwnProperty.call(step, 'modelId')
        && (typeof step.modelId !== 'string' || !step.modelId.trim())
      ) {
        errors.push(`workflow step ${step.id} has invalid modelId`)
      }
      const hasSources = Object.prototype.hasOwnProperty.call(step, 'sources')
      if (hasInputs !== hasSources) {
        errors.push(`workflow step ${step.id} has incomplete source contract`)
      } else if (hasSources) {
        if (!Array.isArray(step.sources) || step.sources.length === 0) {
          errors.push(`workflow step ${step.id} requires at least one source`)
        } else {
          let previousOutputCount = 0
          for (const source of step.sources) {
            if (source?.kind === 'previous-output') {
              previousOutputCount += 1
            } else if (source?.kind === 'input' && typeof source.inputId === 'string') {
              if (!inputIds.has(source.inputId)) {
                errors.push(`workflow step ${step.id} references unknown input: ${source.inputId}`)
              }
            } else {
              errors.push(`workflow step ${step.id} has invalid source`)
            }
          }
          const stepIndex = workflow.steps.indexOf(step)
          if ((stepIndex === 0 && previousOutputCount !== 0)
            || (stepIndex > 0 && previousOutputCount !== 1)) {
            errors.push(`workflow step ${step.id} has invalid previous output source`)
          }
        }
      }
    }
  }
  if (typeof workflow.createdAt !== 'string' || !workflow.createdAt) {
    errors.push('workflow missing createdAt')
  }
  if (typeof workflow.updatedAt !== 'string' || !workflow.updatedAt) {
    errors.push('workflow missing updatedAt')
  }
  return errors
}

export class WorkflowStore {
  constructor(fs, dir = 'workflows-v2', options = {}) {
    this.fs = fs
    this.dir = dir
    this.coordinator = options.coordinator || createStorageCoordinator()
  }

  path(id) {
    if (typeof id !== 'string' || !id || id.includes('/') || id.includes('..')) {
      throw typed('BAD_PATH', `Invalid workflow id: ${id}`)
    }
    return `${this.dir}/${id}.json`
  }

  async load(id) {
    let text
    try {
      text = await this.fs.readText(this.path(id))
    } catch (error) {
      if (error?.code === 'BAD_PATH') throw error
      if (error?.code === 'ENOENT') {
        throw typed('WORKFLOW_NOT_FOUND', `Workflow ${id} was not found`)
      }
      throw typed('WORKFLOW_READ_FAILED', `Workflow ${id} could not be read`)
    }

    let workflow
    try {
      workflow = JSON.parse(text)
    } catch {
      throw typed('WORKFLOW_INVALID', `Workflow ${id} is not valid JSON`)
    }
    const errors = validateWorkflow(workflow)
    if (errors.length > 0) {
      throw typed('WORKFLOW_INVALID', errors.join('; '), errors)
    }
    if (workflow.id !== id) {
      throw typed('WORKFLOW_INVALID', `Workflow id ${workflow.id} does not match ${id}`)
    }
    return workflow
  }

  async save(id, workflow, lease) {
    if (workflow?.id !== id) {
      throw typed('WORKFLOW_INVALID', `Workflow id ${workflow?.id} does not match ${id}`)
    }
    const errors = validateWorkflow(workflow)
    if (errors.length > 0) {
      throw typed('WORKFLOW_INVALID', errors.join('; '), errors)
    }

    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withWorkflow(
        id,
        mutationLease,
        () => this.#save(id, workflow),
      ),
      lease,
    )
  }

  async #save(id, workflow) {
    const path = this.path(id)
    const tempPath = `${path}.tmp`
    try {
      await this.fs.writeText(tempPath, JSON.stringify(workflow, null, 2))
      const verified = JSON.parse(await this.fs.readText(tempPath))
      const verificationErrors = validateWorkflow(verified)
      if (verificationErrors.length > 0) throw new Error(verificationErrors.join('; '))
      if (JSON.stringify(verified) !== JSON.stringify(workflow)) {
        throw new Error('Temporary workflow content changed during verification')
      }
      await this.fs.replace(tempPath, path)
      return workflow
    } catch (error) {
      throw typed(
        'WORKFLOW_WRITE_FAILED',
        `Workflow ${id} could not be saved safely: ${error?.message || error}`,
      )
    }
  }

  async list() {
    let names
    try {
      names = await this.fs.listJson(this.dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('WORKFLOW_READ_FAILED', 'Workflow directory could not be read')
    }
    const workflows = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        workflows.push(await this.load(name.slice(0, -5)))
      } catch (error) {
        if (error?.code !== 'WORKFLOW_INVALID' && error?.code !== 'WORKFLOW_NOT_FOUND') {
          throw error
        }
        // A corrupt or concurrently deleted template does not hide healthy workflows.
      }
    }
    return workflows.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
  }

  async listStrict() {
    let names
    try {
      names = await this.fs.listJson(this.dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw typed('WORKFLOW_READ_FAILED', 'Workflow directory could not be read')
    }
    const workflows = []
    for (const name of names
      .filter((item) => item.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right))) {
      workflows.push(await this.load(name.slice(0, -5)))
    }
    return workflows
  }

  async withLockedWorkflow(id, operation, lease) {
    return this.coordinator.withMutation(
      (mutationLease) => this.coordinator.withWorkflow(
        id,
        mutationLease,
        async (workflowLease) => operation(await this.load(id), workflowLease),
      ),
      lease,
    )
  }

  async delete(id, lease) {
    return this.coordinator.withMutation((mutationLease) =>
      this.coordinator.withWorkflow(id, mutationLease, async () => {
        await this.load(id)
        try {
          await this.fs.remove(this.path(id))
        } catch (error) {
          if (error?.code === 'ENOENT') {
            throw typed('WORKFLOW_NOT_FOUND', `Workflow ${id} was not found`)
          }
          throw typed(
            'WORKFLOW_DELETE_FAILED',
            `Workflow ${id} could not be deleted: ${error?.message || error}`,
          )
        }
        return { deletedWorkflowId: id }
      }),
      lease,
    )
  }
}
