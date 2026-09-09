import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

function parseArgs(argv) {
  let workspace
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--workspace') {
      workspace = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (!workspace) throw new Error('Usage: node scripts/migrate-remove-relations.mjs --workspace PATH [--dry-run]')
  return { workspace: resolve(workspace), dryRun }
}

async function findLegacyBoards(workspace) {
  const boardDir = join(workspace, 'boards-v2')
  let names
  try {
    names = await readdir(boardDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const affected = []
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const path = join(boardDir, name)
    const raw = await readFile(path, 'utf8')
    let board
    try {
      board = JSON.parse(raw)
    } catch {
      throw new Error(`Invalid Board JSON: ${name}`)
    }
    if (
      board
      && typeof board === 'object'
      && !Array.isArray(board)
      && Object.prototype.hasOwnProperty.call(board, 'relations')
    ) {
      affected.push({ name, path, raw, board })
    }
  }
  return affected
}

async function migrate({ workspace, dryRun }) {
  const affected = await findLegacyBoards(workspace)
  if (affected.length === 0) {
    process.stdout.write('No boards contain legacy relations.\n')
    return
  }
  if (dryRun) {
    process.stdout.write(`Would remove relations from ${affected.length} board(s).\n`)
    return
  }

  const backupRoot = join(
    workspace,
    'migration-backups',
    `remove-relations-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  )
  await mkdir(join(backupRoot, 'boards-v2'), { recursive: true })
  for (const item of affected) {
    await writeFile(join(backupRoot, 'boards-v2', item.name), item.raw, 'utf8')
  }

  const migrated = []
  try {
    for (const item of affected) {
      const nextBoard = { ...item.board }
      delete nextBoard.relations
      const temporaryPath = `${item.path}.migrate-${process.pid}-${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(nextBoard, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, item.path)
      migrated.push(item)
    }
  } catch (error) {
    await Promise.all(migrated.map((item) => copyFile(
      join(backupRoot, 'boards-v2', item.name),
      item.path,
    )))
    throw error
  }
  process.stdout.write(`Removed relations from ${affected.length} board(s). Backup: ${backupRoot}\n`)
}

try {
  await migrate(parseArgs(process.argv.slice(2)))
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 1
}
