import { restoreWorkspaceBackup } from '../bridge/node-backup-restore.js'

const USAGE = 'Usage: pnpm restore:backup -- --input <path> --workspace <path>'

function parseArguments(args) {
  const values = args[0] === '--' ? args.slice(1) : args
  if (
    values.length !== 4
    || values[0] !== '--input'
    || !values[1]
    || values[2] !== '--workspace'
    || !values[3]
  ) {
    throw Object.assign(new Error(USAGE), { code: 'BACKUP_RESTORE_ARGUMENT_INVALID' })
  }
  return { inputPath: values[1], workspaceRoot: values[3] }
}

try {
  const options = parseArguments(process.argv.slice(2))
  const result = await restoreWorkspaceBackup(options)
  const { boardCount, runCount, workflowCount, checkpointCount } = result.restored
  console.log(
    `[mira] Restored ${boardCount} Board, ${runCount} Runs, ${workflowCount} WorkflowTemplates and ${checkpointCount} Checkpoints to ${result.workspaceRoot}`,
  )
} catch (error) {
  const code = error?.code || 'BACKUP_RESTORE_FAILED'
  console.error(`[mira] Restore failed [${code}]: ${error?.message || error}`)
  if (code === 'BACKUP_RESTORE_ARGUMENT_INVALID' && error?.message !== USAGE) {
    console.error(USAGE)
  }
  process.exitCode = 1
}
