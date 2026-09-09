import { BOARD_ARTIFACT_LIMITS } from './domain/portable-format.js'

export const API_PREFIX = '/graphmind/api'
export const STATIC_PREFIX = '/graphmind'

const MIME_BY_EXTENSION = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const STATUS_BY_CODE = {
  BAD_PATH: 403,
  BAD_REQUEST: 400,
  BACKUP_INVALID: 422,
  BACKUP_TOO_LARGE: 413,
  BOARD_EXPORT_INVALID: 422,
  BOARD_IMPORT_COLLISION: 409,
  BOARD_IMPORT_INVALID: 422,
  BOARD_IMPORT_JOURNAL_INVALID: 503,
  BOARD_IMPORT_READ_FAILED: 500,
  BOARD_IMPORT_RECOVERY_FAILED: 503,
  BOARD_IMPORT_ROLLBACK_FAILED: 503,
  BOARD_IMPORT_WRITE_FAILED: 500,
  BOARD_NOT_FOUND: 404,
  BOARD_PURGE_FAILED: 500,
  BOARD_PURGE_INVALID: 409,
  BOARD_PURGE_ROLLBACK_FAILED: 500,
  BOARD_ID_REUSED: 409,
  BOARD_CONFLICT: 409,
  BOARD_READ_ONLY: 409,
  BOARD_V2_INVALID: 400,
  BOARD_V2_READ_FAILED: 500,
  BOARD_V2_WRITE_FAILED: 500,
  CARD_CONTENT_KIND_MISMATCH: 400,
  CARD_IN_USE: 409,
  CARD_NOT_FOUND: 404,
  CARD_ALREADY_EXISTS: 409,
  CARD_RESTORE_CONFLICT: 409,
  ORGANIZATION_CONFLICT: 409,
  ORGANIZATION_INVALID: 422,
  CARD_VERSION_CONFLICT: 409,
  CARD_NAME_CONFLICT: 409,
  INSPIRATION_CONFLICT: 409,
  INSPIRATION_NOT_FOUND: 404,
  INSPIRATION_INVALID: 422,
  CANDIDATE_PENDING: 409,
  CHECKPOINT_CONFLICT: 409,
  CHECKPOINT_INVALID: 422,
  CHECKPOINT_LIMIT: 409,
  CHECKPOINT_NOT_FOUND: 404,
  CHECKPOINT_READ_FAILED: 500,
  CHECKPOINT_TOO_LARGE: 413,
  CHECKPOINT_WRITE_FAILED: 500,
  EMPTY_OUTPUT: 502,
  EXPORT_BUSY: 409,
  FILE_ENTRY_NOT_FOUND: 404,
  FILE_IMPORT_FAILED: 500,
  FILES_UNAVAILABLE: 503,
  FILE_BINDING_INVALID: 422,
  FILE_BINDING_CONFLICT: 409,
  FILE_SYNC_CONFLICT: 409,
  FILE_SYNC_FAILED: 500,
  IMPORT_ID_RESERVED: 409,
  IMPORT_RESERVATION_INVALID: 500,
  MODEL_AUTH_FAILED: 401,
  MODEL_PROVIDER_UNAVAILABLE: 503,
  MODEL_REQUEST_FAILED: 502,
  MODEL_SETTINGS_INVALID: 400,
  MODEL_UNAVAILABLE: 503,
  PLAN_INVALID: 400,
  PAYLOAD_TOO_LARGE: 413,
  PORTABLE_DATA_INVALID: 422,
  PORTABLE_FORMAT_INVALID: 422,
  PORTABLE_PATH_INVALID: 422,
  PORTABLE_SERIALIZATION_INVALID: 422,
  RATE_LIMIT: 429,
  ROOT_AGENT_UNAVAILABLE: 503,
  RUN_CANDIDATE_REQUIRED: 409,
  RUN_CORRUPT: 500,
  RUN_INVALID: 400,
  RUN_NOT_FOUND: 404,
  RUN_NOT_RUNNING: 409,
  RUN_READ_FAILED: 500,
  RUN_RECOVERY_FAILED: 503,
  RUN_SOURCE_MISMATCH: 400,
  RUN_TARGET_MISMATCH: 400,
  RUN_WRITE_FAILED: 500,
  SOURCE_READ_FAILED: 400,
  SOURCE_REQUIRED: 400,
  SOURCE_VERSION_CHANGED: 409,
  STORAGE_LEASE_INVALID: 500,
  TARGET_BUSY: 409,
  TRANSFORMATION_CONFLICT: 409,
  TRANSFORMATION_INVALID: 400,
  TRANSFORMATION_NOT_FOUND: 404,
  TRANSFORMATION_SOURCE_INVALID: 400,
  VERSION_CONTENT_INVALID: 400,
  VERSION_ID_CONFLICT: 409,
  VERSION_NOT_FOUND: 404,
  VERSION_RESTORE_SOURCE_REQUIRED: 400,
  VERSION_SOURCE_RUN_REQUIRED: 400,
  WORKFLOW_DELETE_FAILED: 500,
  WORKFLOW_BINDING_INVALID: 400,
  WORKFLOW_INPUT_INVALID: 400,
  WORKFLOW_INVALID: 400,
  WORKFLOW_NOT_FOUND: 404,
  WORKFLOW_NOT_LINEAR: 400,
  WORKFLOW_PLAN_INCOMPLETE: 409,
  WORKFLOW_READ_FAILED: 500,
  WORKFLOW_STEP_UNVERIFIED: 409,
  WORKFLOW_WRITE_FAILED: 500,
  WORKSPACE_LOCKED: 409,
}

export function contentTypeForPath(path) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream'
}

export function httpStatusForCode(code) {
  return STATUS_BY_CODE[code] || 500
}

export function requestMethodHasJsonBody(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
}

function payloadTooLarge(actual, limit) {
  const error = new Error('Request body exceeds the Board import byte limit')
  error.code = 'PAYLOAD_TOO_LARGE'
  error.details = { category: 'bytes', actual, limit }
  return error
}

export async function readJsonBody(req, { maxBytes } = {}) {
  if (maxBytes !== undefined) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new TypeError('maxBytes must be a non-negative safe integer')
    }
    const contentLength = Number(req?.headers?.['content-length'])
    if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
      throw payloadTooLarge(contentLength, maxBytes)
    }
    const encoder = new TextEncoder()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let raw = ''
    let byteLength = 0
    for await (const chunk of req) {
      const bytes = typeof chunk === 'string'
        ? encoder.encode(chunk)
        : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      byteLength += bytes.byteLength
      if (byteLength > maxBytes) {
        req.pause?.()
        throw payloadTooLarge(byteLength, maxBytes)
      }
      try {
        raw += decoder.decode(bytes, { stream: true })
      } catch {
        throw Object.assign(new Error('invalid UTF-8 JSON body'), { code: 'BAD_REQUEST' })
      }
    }
    try {
      raw += decoder.decode()
    } catch {
      throw Object.assign(new Error('invalid UTF-8 JSON body'), { code: 'BAD_REQUEST' })
    }
    if (!raw) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      throw Object.assign(new Error('invalid JSON body'), { code: 'BAD_REQUEST' })
    }
  }

  if (req.setEncoding) req.setEncoding('utf8')
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { code: 'BAD_REQUEST' })
  }
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function createMiraApiHandler(application, {
  apiPrefix = API_PREFIX,
  maxImportBodyBytes = BOARD_ARTIFACT_LIMITS.maxBytes,
} = {}) {
  return async function handleApi(req, res) {
    try {
      const url = String(req.url || '')
      const path = url.split('?')[0].slice(apiPrefix.length)
      const segments = path.split('/').filter(Boolean)
      const method = req.method || 'GET'
      const isBoardImport = method === 'POST'
        && segments.length === 3
        && segments[0] === 'v2'
        && segments[1] === 'boards'
        && segments[2] === 'imports'
      const body = requestMethodHasJsonBody(method)
        ? await readJsonBody(req, isBoardImport ? { maxBytes: maxImportBodyBytes } : undefined)
        : undefined
      const response = await application.dispatch(method, segments, body)
      sendJson(res, response.status, response.body)
    } catch (error) {
      sendJson(res, httpStatusForCode(error?.code), {
        code: error?.code || 'INTERNAL',
        message: error?.message || String(error),
        details: error?.details,
      })
    }
  }
}
