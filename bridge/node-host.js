import { readFile, stat } from 'node:fs/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { createMiraApplication } from './mira-application.js'
import {
  API_PREFIX,
  STATIC_PREFIX,
  contentTypeForPath,
  createMiraApiHandler,
} from './mira-http.js'
import { createNodeWorkspaceAdapter, resolveInside } from './node-workspace-adapter.js'
import { acquireNodeWorkspaceWriteLock } from './node-workspace-lock.js'
import { createFileLibrary } from './file-library.js'

const MAX_STATIC_BYTES = 8 * 1024 * 1024
const DESKTOP_TOKEN_HEADER = 'x-mira-desktop-token'
const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

function isPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  })
  res.end(text)
}

function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest()
}

function createTokenVerifier(accessToken) {
  if (accessToken === undefined) return null
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new TypeError('accessToken must be a non-empty string when configured')
  }
  const expected = digestToken(accessToken)
  return (provided) => {
    if (typeof provided !== 'string') return false
    return timingSafeEqual(expected, digestToken(provided))
  }
}

async function readStaticAsset(staticRoot, relativePath) {
  const target = resolveInside(staticRoot, relativePath)
  const info = await stat(target)
  if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })
  if (info.size > MAX_STATIC_BYTES) {
    throw Object.assign(new Error('static asset exceeds 8 MiB'), {
      code: 'STATIC_TOO_LARGE',
    })
  }
  return readFile(target)
}

function createStaticHandler(staticRoot) {
  return async function handleStatic(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }

    let relativePath
    try {
      relativePath = decodeURIComponent(pathname.slice(STATIC_PREFIX.length))
    } catch {
      sendText(res, 400, 'bad request')
      return
    }
    relativePath = relativePath.replace(/^\/+/, '') || 'index.html'

    let assetPath = relativePath
    let bytes
    try {
      bytes = await readStaticAsset(staticRoot, assetPath)
    } catch (error) {
      const mayUseSpaFallback =
        error?.code === 'ENOENT' && !extname(relativePath) && relativePath !== 'index.html'
      if (!mayUseSpaFallback) {
        sendText(res, error?.code === 'BAD_PATH' ? 403 : 404, 'not found')
        return
      }
      assetPath = 'index.html'
      try {
        bytes = await readStaticAsset(staticRoot, assetPath)
      } catch {
        sendText(res, 404, 'not found (run pnpm build first)')
        return
      }
    }

    const headers = {
      'content-type': contentTypeForPath(assetPath),
      'cache-control': assetPath === 'index.html'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
      ...(assetPath === 'index.html'
        ? { 'content-security-policy': HTML_CONTENT_SECURITY_POLICY }
        : {}),
    }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : bytes)
  }
}

function modelSettingsRoute(service, method, segments, body) {
  if (!service || segments[0] !== 'v2' || segments[1] !== 'model-settings') return null
  if (segments.length === 2 && method === 'GET') {
    return { status: 200, body: service.get() }
  }
  if (segments.length === 2 && method === 'PUT') {
    return { status: 200, body: service.update(body || {}) }
  }
  if (segments.length === 3 && segments[2] === 'test' && method === 'POST') {
    return service.test(body || {}).then((result) => ({ status: 200, body: result }))
  }
  return null
}

export function createStandaloneMiraHost({
  workspaceRoot = process.cwd(),
  staticRoot = join(workspaceRoot, 'dist'),
  newId,
  now,
  executeModel,
  executeSuggestion,
  modelSettings,
  accessToken,
  logger = console,
} = {}) {
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const resolvedStaticRoot = resolve(staticRoot)
  const workspaceLock = acquireNodeWorkspaceWriteLock(resolvedWorkspaceRoot)
  const fs = createNodeWorkspaceAdapter(resolvedWorkspaceRoot)
  let coreApplication
  try {
    coreApplication = createMiraApplication({
      fs,
      newId,
      now,
      readFileContent: (path) => fs.readText(path),
      executeModel: modelSettings?.executeModel || executeModel,
      executeSuggestion: modelSettings?.executeSuggestion || executeSuggestion,
      resolveModel: modelSettings?.resolveModel,
      fileLibrary: createFileLibrary({ workspaceRoot: resolvedWorkspaceRoot }),
      onRecovery({ reconciled, interrupted }) {
        if (reconciled.length > 0) {
          logger.log('[mira] reconciled applied runs:', reconciled.map((run) => run.id).join(', '))
        }
        if (interrupted.length > 0) {
          logger.log('[mira] recovered interrupted runs:', interrupted.map((run) => run.id).join(', '))
        }
      },
    })
  } catch (error) {
    workspaceLock.release()
    throw error
  }
  const application = {
    ...coreApplication,
    async dispatch(method, segments, body) {
      await coreApplication.ready
      return (
        (await modelSettingsRoute(modelSettings, method, segments, body)) ||
        coreApplication.dispatch(method, segments, body)
      )
    },
  }
  const handleApi = createMiraApiHandler(application)
  const handleStatic = createStaticHandler(resolvedStaticRoot)
  const verifyAccessToken = createTokenVerifier(accessToken)

  const server = createServer((req, res) => {
    // A request active at server.close() can become an idle keep-alive later.
    // Drain its response, then reap that connection before releasing the lock.
    res.once('finish', () => {
      if (closed) server.closeIdleConnections()
    })
    void (async () => {
      if (verifyAccessToken && !verifyAccessToken(req.headers[DESKTOP_TOKEN_HEADER])) {
        sendText(res, 401, 'unauthorized', { 'cache-control': 'no-store' })
        return
      }

      let pathname
      try {
        pathname = new URL(String(req.url || '/'), 'http://localhost').pathname
      } catch {
        sendText(res, 400, 'bad request')
        return
      }

      if (isPrefix(pathname, API_PREFIX)) {
        await handleApi(req, res)
        return
      }
      if (pathname === '/') {
        res.writeHead(302, { location: `${STATIC_PREFIX}/` })
        res.end()
        return
      }
      if (isPrefix(pathname, STATIC_PREFIX)) {
        await handleStatic(req, res, pathname)
        return
      }
      sendText(res, 404, 'not found')
    })().catch((error) => {
      logger.error('[mira] unhandled standalone request error:', error)
      if (!res.headersSent) sendText(res, 500, 'internal server error')
      else res.end()
    })
  })

  let closed = false

  return {
    application,
    server,
    workspaceRoot: resolvedWorkspaceRoot,
    async listen({ host = '127.0.0.1', port = 56300 } = {}) {
      await application.ready
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off('listening', onListening)
          rejectListen(error)
        }
        const onListening = () => {
          server.off('error', onError)
          resolveListen()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, host)
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Standalone server did not expose a TCP address')
      }
      const displayHost = address.address.includes(':')
        ? `[${address.address}]`
        : address.address
      return {
        host: address.address,
        port: address.port,
        url: `http://${displayHost}:${address.port}`,
      }
    },
    async close() {
      if (closed) return
      closed = true
      try {
        if (server.listening) {
          await new Promise((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()))
          })
        }
      } finally {
        workspaceLock.release()
      }
    },
  }
}
