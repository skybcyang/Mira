import {
  lstat,
  mkdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const DATA_DIRECTORIES = ['boards-v2', 'runs-v2', 'workflows-v2']
const STATE_FILE_NAME = 'desktop-state.json'

function isMissingFile(error) {
  return error?.code === 'ENOENT'
}

async function existingPathType(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

async function verifyReadableAndWritable(directory) {
  const probePath = join(directory, `.mira-desktop-probe-${randomUUID()}`)
  const probeContents = randomUUID()
  let created = false

  try {
    await writeFile(probePath, probeContents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    created = true
    const persistedContents = await readFile(probePath, 'utf8')
    if (persistedContents !== probeContents) {
      throw new Error(`Workspace read/write verification failed for ${directory}`)
    }
  } finally {
    if (created) await unlink(probePath)
  }
}

export async function prepareWorkspaceRoot(selection) {
  if (selection === undefined || selection === null) return null
  if (typeof selection !== 'string' || selection.trim() === '') {
    throw new TypeError('Workspace selection must be a non-empty path')
  }

  const rootStats = await stat(selection)
  if (!rootStats.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${selection}`)
  }

  const dataPaths = DATA_DIRECTORIES.map((name) => join(selection, name))
  const dataPathStats = await Promise.all(dataPaths.map(existingPathType))
  for (let index = 0; index < dataPaths.length; index += 1) {
    const pathStats = dataPathStats[index]
    if (pathStats && !pathStats.isDirectory()) {
      throw new Error(`Workspace data path is not a directory: ${dataPaths[index]}`)
    }
  }

  await verifyReadableAndWritable(selection)

  const createdDirectories = []
  try {
    for (let index = 0; index < dataPaths.length; index += 1) {
      if (dataPathStats[index]) continue
      await mkdir(dataPaths[index])
      createdDirectories.push(dataPaths[index])
    }

    for (const dataPath of dataPaths) {
      await verifyReadableAndWritable(dataPath)
    }
  } catch (error) {
    await Promise.allSettled(createdDirectories.reverse().map((path) => rmdir(path)))
    throw error
  }

  return selection
}

function validWindowBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const { x, y, width, height } = value
  if (![x, y, width, height].every(Number.isInteger)) return null
  if (width <= 0 || height <= 0) return null

  return { x, y, width, height }
}

function sanitizeDesktopState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const state = {}
  if (typeof value.workspaceRoot === 'string' && value.workspaceRoot.trim() !== '') {
    state.workspaceRoot = value.workspaceRoot
  }

  const windowBounds = validWindowBounds(value.windowBounds)
  if (windowBounds) state.windowBounds = windowBounds

  return state
}

export async function readDesktopState(userDataRoot) {
  let contents
  try {
    contents = await readFile(join(userDataRoot, STATE_FILE_NAME), 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  }

  try {
    return sanitizeDesktopState(JSON.parse(contents))
  } catch {
    return {}
  }
}

export async function writeDesktopState(userDataRoot, value) {
  const statePath = join(userDataRoot, STATE_FILE_NAME)
  const temporaryPath = join(userDataRoot, `.${STATE_FILE_NAME}.${randomUUID()}.tmp`)
  const contents = `${JSON.stringify(sanitizeDesktopState(value), null, 2)}\n`

  await mkdir(userDataRoot, { recursive: true })
  let temporaryFileExists = false
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    temporaryFileExists = true
    await rename(temporaryPath, statePath)
    temporaryFileExists = false
  } finally {
    if (temporaryFileExists) {
      try {
        await unlink(temporaryPath)
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
    }
  }
}
