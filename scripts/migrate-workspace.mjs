import { migrateProjectWorkspace } from '../bridge/project-migration.js'

const args = process.argv.slice(2).filter(arg => arg !== '--')
try {
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--target') throw new Error('用法：pnpm migrate:workspace -- --source <旧目录> --target <全新目录>')
  const result = await migrateProjectWorkspace({ sourceRoot: args[1], targetRoot: args[3] })
  console.log(`项目工作区已创建：${result.workspaceRoot}。原工作区未改写；未收纳的旧文件引用仍需显式导入。`)
} catch (error) { console.error(`[mira] ${error.code || 'WORKSPACE_MIGRATION_FAILED'}: ${error.message}`); process.exitCode = 1 }
