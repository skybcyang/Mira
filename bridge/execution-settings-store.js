import { emptyExecutionSettings, updateExecutionSettings, validateExecutionSettings } from '../src/domain/executionSettings.js'
import { typed } from './domain/errors.js'

export const EXECUTION_SETTINGS_PATH = 'execution-settings-v1.json'
export class ExecutionSettingsStore {
  constructor(fs, { coordinator, path = EXECUTION_SETTINGS_PATH, newId } = {}) {
    this.fs = fs; this.path = path; this.coordinator = coordinator; this.newId = newId
    this.queue = Promise.resolve()
  }
  async load() {
    let text
    try { text = await this.fs.readText(this.path) } catch (error) {
      if (error.code === 'ENOENT') return emptyExecutionSettings()
      throw typed('EXECUTION_SETTINGS_READ_FAILED', '无法读取项目执行设置。')
    }
    try { const value = JSON.parse(text); validateExecutionSettings(value); return value }
    catch { throw typed('EXECUTION_SETTINGS_INVALID', '项目执行设置损坏，请核对文件或从可信备份恢复。') }
  }
  update(input) {
    const operation = this.queue.then(() => this.coordinator.withMutation(async () => {
      const current = await this.load()
      const next = updateExecutionSettings(current, input, this.newId)
      if (next === current) return current
      try {
        const temp = `${this.path}.tmp`
        await this.fs.writeText(temp, JSON.stringify(next, null, 2))
        const verified = JSON.parse(await this.fs.readText(temp))
        validateExecutionSettings(verified)
        if (JSON.stringify(verified) !== JSON.stringify(next)) throw new Error('Temporary settings changed')
        await this.fs.replace(temp, this.path)
        return next
      } catch { throw typed('EXECUTION_SETTINGS_WRITE_FAILED', '项目设置未确认保存，请保留草稿并重新核对。') }
    }))
    this.queue = operation.catch(() => {})
    return operation
  }
}
