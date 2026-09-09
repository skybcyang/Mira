import { createModelExecutor } from './model-executor.js'
import {
  createMiraApplication,
  createMiraStores,
  createTransformationModelExecutor,
} from './mira-application.js'
import {
  API_PREFIX,
  STATIC_PREFIX,
  contentTypeForPath,
  createMiraApiHandler,
} from './mira-http.js'
import { createRootAgentRegistry } from './root-agent-registry.js'
import {
  readTextWithNotFound,
  removeFile,
  replaceAtomically,
} from './runtime-fs-adapter.js'
import { createTurnWaiter } from './turn-waiter.js'

export { httpStatusForCode, requestMethodHasJsonBody } from './mira-http.js'

function newId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
}

function newSessionId() {
  return `sess-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function makeSignal() {
  if (typeof AbortController === 'function') return new AbortController().signal
  return {
    aborted: false,
    reason: undefined,
    throwIfAborted() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

async function findWorkspaceRoot(fsService, baseRoot) {
  const candidates = [baseRoot, `${baseRoot}/Documents/DSHWorkspace/Mira`]
  for (const candidate of candidates) {
    try {
      const info = await fsService.stat(
        await fsService.resolve('dist/index.html', { cwd: candidate }),
      )
      if (info) return candidate
    } catch {}
    try {
      const info = await fsService.stat(
        await fsService.resolve('boards-v2', { cwd: candidate }),
      )
      if (info && info.type === 'directory') return candidate
    } catch {}
  }
  return baseRoot
}

export function createDshWorkspaceFsAdapter({ fsService, workspaceRoot }) {
  return {
    async readText(path) {
      const target = await fsService.resolve(path, { cwd: await workspaceRoot })
      return readTextWithNotFound(fsService, target)
    },
    async writeText(path, content) {
      const target = await fsService.resolve(path, { cwd: await workspaceRoot })
      await fsService.writeText(target, content)
    },
    async replace(from, to) {
      const source = await fsService.resolve(from, { cwd: await workspaceRoot })
      const target = await fsService.resolve(to, { cwd: await workspaceRoot })
      await replaceAtomically(fsService, source, target)
    },
    async remove(path) {
      const target = await fsService.resolve(path, { cwd: await workspaceRoot })
      await removeFile(fsService, target)
    },
    async listJson(dir) {
      const target = await fsService.resolve(dir, { cwd: await workspaceRoot })
      const entries = await fsService.listDir(target)
      return entries
        .filter(
          (entry) =>
            entry && entry.type !== 'directory' && String(entry.name).endsWith('.json'),
        )
        .map((entry) => entry.name)
    },
  }
}

export function createDshExecutionAdapter({
  agents,
  subagents,
  sessionQuery,
  agentDefaultModel,
  boardStore,
  workspaceRoot,
}) {
  const turnWaiter = createTurnWaiter()
  const available = Boolean(agents && subagents && sessionQuery)
  if (!available) {
    return {
      execute: null,
      resolveModel: null,
      handleSessionEvent() {},
      async dispose() {},
    }
  }

  function currentAgentOptions() {
    const selection = agentDefaultModel && agentDefaultModel.currentSelection()
    return selection && selection.model
      ? { provider: selection.provider, model: selection.model }
      : {}
  }

  const rootRegistry = createRootAgentRegistry({
    agents,
    store: boardStore,
    workspaceRoot,
    agentOptions: currentAgentOptions,
    newSessionId,
  })
  const execute = createModelExecutor({
    store: boardStore,
    rootRegistry,
    subagents,
    sessionQuery,
    turnWaiter,
    provider: (subagents.list && subagents.list()[0]) || 'fork',
    makeSignal,
  })

  function resolveModel({ modelId } = {}) {
    const current = currentAgentOptions()
    if (!current.provider || !current.model) {
      throw Object.assign(new Error('宿主当前没有可用模型'), { code: 'MODEL_UNAVAILABLE' })
    }
    const requested = String(modelId || '').trim()
    if (requested && requested !== current.model) {
      throw Object.assign(
        new Error('当前宿主不支持为单个转化切换模型，请改为继承宿主模型'),
        { code: 'MODEL_OVERRIDE_UNSUPPORTED' },
      )
    }
    return { provider: current.provider, model: current.model }
  }

  return {
    execute,
    resolveModel,
    handleSessionEvent(session, event) {
      if (session?.id && event) turnWaiter.handleEvent(session.id, event)
    },
    async dispose() {
      await rootRegistry.dispose()
    },
  }
}

export function createDshCordisPlugin({ logger = console } = {}) {
  return {
    name: 'mira-bridge',
    inject: ['webServer', 'agents'],
    apply(ctx) {
      const fsService = ctx.get('fs')
      const sandboxPolicy = ctx.get('sandboxPolicy')
      const agents = ctx.agents || ctx.get('agents')
      const subagents = ctx.get('subagents')
      const sessionQuery = ctx.get('sessionQuery')
      const agentDefaultModel = ctx.get('agentDefaultModel')
      const baseRoot = (sandboxPolicy && sandboxPolicy.workspaceRoot) || '.'
      const workspaceRoot = findWorkspaceRoot(fsService, baseRoot)
      const fs = createDshWorkspaceFsAdapter({ fsService, workspaceRoot })
      const stores = createMiraStores({ fs, newId })
      const execution = createDshExecutionAdapter({
        agents,
        subagents,
        sessionQuery,
        agentDefaultModel,
        boardStore: stores.boardStore,
        workspaceRoot,
      })

      async function readFileContent(relativePath) {
        if (
          typeof relativePath !== 'string' ||
          !relativePath ||
          relativePath.startsWith('/') ||
          relativePath.includes('..')
        ) {
          throw Object.assign(new Error(`invalid path: ${relativePath}`), {
            code: 'BAD_PATH',
          })
        }
        return fs.readText(relativePath)
      }

      const application = createMiraApplication({
        stores,
        newId,
        readFileContent,
        executeSuggestion: execution.execute
          ? ({ boardId, prompt }) =>
              execution.execute({
                boardId,
                subject: { id: 'suggest-next-step', goal: '推荐下一份有用成果' },
                prompt,
                toolFilter: { allow: [] },
                signal: makeSignal(),
              }).then((result) => result.outputText)
          : null,
        executeModel: createTransformationModelExecutor(execution.execute),
        resolveModel: execution.resolveModel,
        onRecovery({ reconciled, interrupted }) {
          if (reconciled.length > 0) {
            logger.log(
              '[mira] reconciled applied runs:',
              reconciled.map((run) => run.id).join(', '),
            )
          }
          if (interrupted.length > 0) {
            logger.log(
              '[mira] recovered interrupted runs:',
              interrupted.map((run) => run.id).join(', '),
            )
          }
        },
      })

      const handleApi = createMiraApiHandler(application)

      async function handleStatic(req, res) {
        try {
          let path =
            String(req.url || '').split('?')[0].slice(STATIC_PREFIX.length) || '/'
          if (path === '/' || path === '') path = '/index.html'
          if (path.includes('..')) {
            res.writeHead(403)
            res.end('forbidden')
            return
          }
          const target = await fsService.resolve(`dist${path}`, {
            cwd: await workspaceRoot,
          })
          const bytes = await fsService.readBytes(target, undefined, 8 * 1024 * 1024)
          res.writeHead(200, {
            'content-type': contentTypeForPath(path),
          })
          res.end(bytes)
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found（前端未构建？运行 pnpm build）')
        }
      }

      ctx.effect(() => {
        const disposeApi = ctx.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: handleApi,
        })
        const disposeStatic = ctx.webServer.register({
          kind: 'prefix',
          path: STATIC_PREFIX,
          handler: handleStatic,
        })
        return () => {
          disposeApi()
          disposeStatic()
        }
      })
      ctx.on('session/event', (session, event) => {
        execution.handleSessionEvent(session, event)
      })
      ctx.effect(() => () => {
        void execution.dispose()
      })

      workspaceRoot.then((root) => {
        logger.log('[mira] bridge loaded, workspace =', root)
      })
    },
  }
}

const plugin = createDshCordisPlugin()

export default plugin
