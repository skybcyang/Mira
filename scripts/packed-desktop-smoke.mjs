import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDesktopTarget } from './run-desktop-forge.mjs'

const DATA_DIRECTORIES = ['boards-v2', 'runs-v2', 'workflows-v2']
const PACKED_RESTORE_TIMESTAMP = '2026-09-02T08:00:00.000Z'
import { boardCheckpointFilename } from '../bridge/board-checkpoint-store.js'

export const PACKED_RESTORE_BOARD_ID = 'board-packed-restore'
export const PACKED_RESTORE_CHECKPOINT_ID = 'checkpoint-packed-restore'
export const PACKED_READY_TIMEOUT_MS = 60_000
export const PACKED_SHUTDOWN_TIMEOUT_MS = 20_000

export function createPackedSmokeCommand({
  platform = process.platform,
  appPath,
  workspaceRoot,
  userDataRoot,
  backupPath,
  inheritedEnv = process.env,
}) {
  const env = { ...inheritedEnv }
  for (const name of [
    'MIRA_DESKTOP_SMOKE',
    'MIRA_DESKTOP_SMOKE_USER_DATA',
    'MIRA_DESKTOP_SMOKE_WORKSPACE',
    'MIRA_DESKTOP_SMOKE_MODE',
    'MIRA_DESKTOP_SMOKE_BACKUP',
    'MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE',
    'MIRA_DESKTOP_SMOKE_EXIT_ON_READY',
  ]) {
    delete env[name]
  }
  Object.assign(env, {
    MIRA_DESKTOP_SMOKE: '1',
    MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1',
    MIRA_DESKTOP_SMOKE_USER_DATA: userDataRoot,
    ...(backupPath
      ? {
          MIRA_DESKTOP_SMOKE_MODE: 'restore',
          MIRA_DESKTOP_SMOKE_BACKUP: backupPath,
          MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE: workspaceRoot,
        }
      : { MIRA_DESKTOP_SMOKE_WORKSPACE: workspaceRoot }),
  })
  return {
    executable: platform === 'win32'
      ? join(appPath, 'Mira.exe')
      : join(appPath, 'Contents', 'MacOS', 'Mira'),
    args: [],
    env,
  }
}

export function createPackedRestoreBackup() {
  const board = {
    schemaVersion: 2,
    id: PACKED_RESTORE_BOARD_ID,
    title: 'Packed restore smoke',
    revision: 3,
    lifecycle: {
      state: 'archived',
      archivedAt: PACKED_RESTORE_TIMESTAMP,
    },
    cards: [],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: PACKED_RESTORE_TIMESTAMP,
    updatedAt: PACKED_RESTORE_TIMESTAMP,
  }
  return {
    format: 'mira-backup',
    formatVersion: 2,
    exportedAt: PACKED_RESTORE_TIMESTAMP,
    boards: [board],
    runs: [],
    workflows: [],
    checkpoints: [{
      schemaVersion: 1,
      id: PACKED_RESTORE_CHECKPOINT_ID,
      boardId: PACKED_RESTORE_BOARD_ID,
      title: 'Packed restore checkpoint',
      baseBoardRevision: board.revision,
      artifact: {
        format: 'mira-board',
        formatVersion: 1,
        exportedAt: PACKED_RESTORE_TIMESTAMP,
        board,
        runs: [],
        workflowProvenance: [],
        fileDependencies: [],
        externalReferences: [],
      },
      createdAt: PACKED_RESTORE_TIMESTAMP,
      metadataUpdatedAt: PACKED_RESTORE_TIMESTAMP,
    }],
  }
}

export async function verifyPackedSmokeWorkspace(workspaceRoot, { restore = false } = {}) {
  await Promise.all(DATA_DIRECTORIES.map((name) => access(join(workspaceRoot, name))))
  if (!restore) return

  const boardPath = join(
    workspaceRoot,
    'boards-v2',
    `${PACKED_RESTORE_BOARD_ID}.json`,
  )
  let board
  try {
    board = JSON.parse(await readFile(boardPath, 'utf8'))
  } catch (error) {
    throw new Error(`Packed restore did not produce ${PACKED_RESTORE_BOARD_ID}: ${error.message}`)
  }
  if (board?.id !== PACKED_RESTORE_BOARD_ID || board?.title !== 'Packed restore smoke') {
    throw new Error(`Packed restore produced an invalid ${PACKED_RESTORE_BOARD_ID} entity`)
  }
  const checkpointPath = join(
    workspaceRoot,
    'board-checkpoints-v1',
    boardCheckpointFilename(PACKED_RESTORE_BOARD_ID, PACKED_RESTORE_CHECKPOINT_ID),
  )
  let checkpoint
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
  } catch (error) {
    throw new Error(`Packed restore did not produce ${PACKED_RESTORE_CHECKPOINT_ID}: ${error.message}`)
  }
  if (
    checkpoint?.id !== PACKED_RESTORE_CHECKPOINT_ID
    || checkpoint?.boardId !== PACKED_RESTORE_BOARD_ID
    || checkpoint?.title !== 'Packed restore checkpoint'
  ) {
    throw new Error(`Packed restore produced an invalid ${PACKED_RESTORE_CHECKPOINT_ID} entity`)
  }
}

export function waitForPackedExit(child, timeoutMs) {
  return new Promise((resolveReady, rejectReady) => {
    let output = ''
    const append = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-16_000)
    }
    const onExit = (code, signal) => {
      if (code === 0) {
        finish(resolveReady)
        return
      }
      finish(rejectReady, new Error(
        `Packed Mira exit failed (code=${code}, signal=${signal}).\n${output}`,
      ))
    }
    const onError = (error) => finish(rejectReady, error)
    const timer = setTimeout(() => {
      finish(rejectReady, new Error(`Packed Mira did not become ready and exit.\n${output}`))
    }, timeoutMs)

    function finish(callback, value) {
      clearTimeout(timer)
      child.stdout?.off('data', append)
      child.stderr?.off('data', append)
      child.off('exit', onExit)
      child.off('error', onError)
      callback(value)
    }

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

export async function runPackedDesktopSmoke({
  appPath,
  restore = false,
  timeoutMs = PACKED_READY_TIMEOUT_MS,
  shutdownTimeoutMs = PACKED_SHUTDOWN_TIMEOUT_MS,
} = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mira-packed-desktop-smoke-'))
  const workspaceRoot = join(temporaryRoot, 'workspace')
  const userDataRoot = join(temporaryRoot, 'user-data')
  const backupPath = restore ? join(temporaryRoot, 'input.mira-backup.json') : undefined
  await Promise.all([
    mkdir(workspaceRoot),
    mkdir(userDataRoot),
    ...(restore
      ? [writeFile(backupPath, JSON.stringify(createPackedRestoreBackup()), 'utf8')]
      : []),
  ])
  const command = createPackedSmokeCommand({
    appPath,
    workspaceRoot,
    userDataRoot,
    backupPath,
  })
  await access(command.executable, constants.X_OK)
  const child = spawn(command.executable, command.args, {
    env: command.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForPackedExit(child, timeoutMs + shutdownTimeoutMs)
    const ready = await readFile(join(userDataRoot, 'smoke-ready'), 'utf8').catch(() => '')
    if (ready !== 'ready') throw new Error('Packed Mira exited without reporting renderer readiness')
    await verifyPackedSmokeWorkspace(workspaceRoot, { restore })
    try {
      await access(join(workspaceRoot, '.mira-workspace.lock'))
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    throw new Error('Packed Mira did not release the workspace lock')
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function parseArchitecture(args) {
  const direct = args.find((argument) => argument.startsWith('--arch='))
  const directValue = direct?.slice('--arch='.length)
  const flagIndex = args.indexOf('--arch')
  const architecture = directValue || (flagIndex >= 0 ? args[flagIndex + 1] : process.arch)
  if (!['arm64', 'x64'].includes(architecture)) {
    throw new Error('Packed smoke requires --arch=arm64 or --arch=x64')
  }
  return architecture
}

export function parsePackedSmokeOptions(args) {
  return {
    architecture: parseArchitecture(args),
    restore: args.includes('--restore'),
  }
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const { architecture, restore } = parsePackedSmokeOptions(process.argv.slice(2))
  validateDesktopTarget(process.platform, architecture)
  const projectRoot = resolve(currentFile, '..', '..')
  const appPath = join(
    projectRoot,
    'out',
    'desktop',
    `Mira-${process.platform}-${architecture}`,
    ...(process.platform === 'darwin' ? ['Mira.app'] : []),
  )
  await runPackedDesktopSmoke({ appPath, restore })
  console.log(`Packed Mira ${architecture}${restore ? ' restore' : ''} smoke passed`)
}
