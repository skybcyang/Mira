import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRestartingSupervisor } from './service-supervisor-lib.mjs'

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const serviceScript = resolve(workspaceRoot, 'scripts', 'start-standalone.mjs')

const supervisor = createRestartingSupervisor({
  startChild() {
    return spawn(process.execPath, [serviceScript], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    })
  },
  onStopped() {
    process.exit(0)
  },
})

supervisor.start()

process.once('SIGINT', () => supervisor.stop())
process.once('SIGTERM', () => supervisor.stop())
