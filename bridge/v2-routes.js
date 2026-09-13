import { listGuidance } from '../src/domain/guidance.js'

function notFound(method, segments) {
  return {
    status: 404,
    body: { code: 'NOT_FOUND', message: `${method} /${segments.join('/')}` },
  }
}

export async function dispatchV2Route(method, segments, body, dependencies) {
  if (segments[0] !== 'v2') return null
  const seg = segments.slice(1)
  if (method === 'GET' && seg.length === 1 && seg[0] === 'application-info') return { status: 200, body: { desktop: false } }
  if (method === 'GET' && seg.length === 1 && seg[0] === 'guidance') return { status: 200, body: { guidance: listGuidance() } }
  const {
    store,
    handlers,
    workflowService,
    inspirationPoolHandlers,
    boardPortabilityService,
    checkpointService,
    backupService,
    fileLibrary,
    materialService,
    managedMaterials,
    cardPortabilityService,
  } = dependencies
  if (method === 'POST' && seg.length === 4 && seg[0] === 'boards' && seg[2] === 'cards' && seg[3] === 'export') return { status: 200, body: await cardPortabilityService.exportCards(seg[1], body) }
  if (method === 'POST' && seg.length === 4 && seg[0] === 'boards' && seg[2] === 'cards' && seg[3] === 'import') return { status: 201, body: await cardPortabilityService.importCards(seg[1], body) }
  if (method === 'GET' && seg.length === 1 && seg[0] === 'materials') return { status: 200, body: { assets: managedMaterials ? await managedMaterials.list() : [] } }
  if (seg[0] === 'materials' && seg[1] === 'previews') {
    if (method === 'POST' && seg.length === 4 && seg[3] === 'original') return { status: 201, body: await materialService.saveOriginal(seg[2]) }
    if (method === 'POST' && seg.length === 2) return { status: 200, body: await materialService.preview(body, { signal: dependencies.signal }) }
    if (method === 'DELETE' && seg.length === 3) return { status: 200, body: materialService.release(seg[2]) }
    if (method === 'GET' && seg.length === 5 && seg[3] === 'pages') return { status: 200, body: await materialService.page(seg[2], Number(seg[4])) }
  }
  if (method === 'GET' && seg.length === 3 && seg[0] === 'materials' && seg[2] === 'content' && managedMaterials) {
    const assets = await managedMaterials.list(), asset = assets.find(item => item.id === seg[1])
    if (!asset) throw Object.assign(new Error('材料不存在。'), { code: 'MATERIAL_INVALID' })
    if (!asset.path.endsWith('.txt') || asset.byteLength > 1000000) throw Object.assign(new Error('此材料暂不支持文字预览，可添加到画布保留引用。'), { code: 'MATERIAL_LIMIT' })
    return { status: 200, body: { text: await managedMaterials.readText(asset.path) } }
  }
  if (method === 'POST' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'materials') return { status: 201, body: await materialService.saveCard(seg[1], body) }
  if (method === 'POST' && seg.length === 2 && seg[0] === 'inspiration-pool' && seg[1] === 'captures') return { status: 201, body: await materialService.saveCapture(body) }

  if (method === 'POST' && seg.length === 5 && seg[0] === 'boards' && seg[2] === 'cards' && seg[4] === 'extraction-revisions') {
    return { status: 200, body: await handlers.reviseExtractionCard(seg[1], seg[3], body || {}) }
  }
  if (method === 'POST' && seg.length === 5 && seg[0] === 'boards' && seg[2] === 'cards' && seg[4] === 'extractions') {
    return { status: 201, body: await handlers.extractCards(seg[1], seg[3], body || {}) }
  }

  if (method === 'GET' && seg.length === 1 && seg[0] === 'inspiration-pool') {
    return { status: 200, body: await inspirationPoolHandlers.getPool() }
  }
  if (method === 'POST' && seg.length === 2 && seg[0] === 'inspiration-pool' && seg[1] === 'entries') {
    return { status: 201, body: await inspirationPoolHandlers.createEntry(body || {}) }
  }
  if (method === 'PATCH' && seg.length === 3 && seg[0] === 'inspiration-pool' && seg[1] === 'entries') {
    return { status: 200, body: await inspirationPoolHandlers.updateEntry(seg[2], body || {}) }
  }

  if (method === 'POST' && seg.length === 2 && seg[0] === 'files' && ['browse', 'import'].includes(seg[1])) {
    if (!fileLibrary) {
      throw Object.assign(
        new Error('File browsing and import are unavailable in this host'),
        { code: 'FILES_UNAVAILABLE' },
      )
    }
    if (seg[1] === 'browse') {
      return { status: 200, body: await fileLibrary.browse(body || {}) }
    }
    return { status: 201, body: await fileLibrary.import(body || {}) }
  }

  if (method === 'GET' && seg.length === 1 && seg[0] === 'backup') {
    return { status: 200, body: await backupService.exportBackup() }
  }

  if (method === 'GET' && seg.length === 1 && seg[0] === 'workflows') {
    return { status: 200, body: { workflows: await workflowService.list() } }
  }
  if (method === 'POST' && seg.length === 1 && seg[0] === 'workflows') {
    return { status: 201, body: { workflow: await workflowService.create(body || {}) } }
  }
  if (method === 'GET' && seg.length === 2 && seg[0] === 'workflows') {
    return { status: 200, body: { workflow: await workflowService.get(seg[1]) } }
  }
  if (method === 'DELETE' && seg.length === 2 && seg[0] === 'workflows') {
    return { status: 200, body: await workflowService.delete(seg[1]) }
  }
  if (method === 'GET' && seg.length === 1 && seg[0] === 'boards') {
    return { status: 200, body: { boards: await store.listSummaries() } }
  }
  if (method === 'GET' && seg.length === 2 && seg[0] === 'boards' && seg[1] === 'catalog') {
    return { status: 200, body: { boards: await store.listCatalogSummaries() } }
  }
  if (method === 'GET' && seg.length === 2 && seg[0] === 'boards' && seg[1] === 'activity') {
    return { status: 200, body: await handlers.getBoardActivity() }
  }
  if (method === 'POST' && seg.length === 1 && seg[0] === 'boards') {
    const created = await store.create(String(body?.title || '').trim() || '未命名画板')
    return { status: 201, body: { boardId: created.id, board: created.board } }
  }
  if (method === 'POST' && seg.length === 2 && seg[0] === 'boards' && seg[1] === 'imports') {
    return { status: 201, body: await boardPortabilityService.importBoard(body || {}) }
  }
  if (seg.length >= 3 && seg[0] === 'boards' && seg[2] === 'checkpoints') {
    const boardId = seg[1]
    if (seg.length === 3 && method === 'GET') {
      return { status: 200, body: await checkpointService.list(boardId) }
    }
    if (seg.length === 3 && method === 'POST') {
      return { status: 201, body: await checkpointService.create(boardId, body || {}) }
    }
    const checkpointId = seg[3]
    if (seg.length === 4 && method === 'GET') {
      return { status: 200, body: await checkpointService.get(boardId, checkpointId) }
    }
    if (seg.length === 4 && method === 'PATCH') {
      return { status: 200, body: await checkpointService.update(boardId, checkpointId, body || {}) }
    }
    if (seg.length === 4 && method === 'DELETE') {
      return { status: 200, body: await checkpointService.remove(boardId, checkpointId, body || {}) }
    }
    if (seg.length === 5 && seg[4] === 'forks' && method === 'POST') {
      return { status: 201, body: await checkpointService.fork(boardId, checkpointId, body || {}) }
    }
    if (seg.length === 5 && seg[4] === 'export' && method === 'GET') {
      return { status: 200, body: await checkpointService.exportArtifact(boardId, checkpointId) }
    }
  }
  if (method === 'GET' && seg.length === 2 && seg[0] === 'boards') {
    return { status: 200, body: { board: await store.load(seg[1]) } }
  }
  if (method === 'GET' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'export') {
    return { status: 200, body: await boardPortabilityService.exportBoard(seg[1]) }
  }
  if (method === 'PATCH' && seg.length === 2 && seg[0] === 'boards') {
    return { status: 200, body: await handlers.renameBoard(seg[1], body || {}) }
  }
  if (method === 'PATCH' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'organization') {
    return { status: 200, body: await handlers.updateOrganization(seg[1], body || {}) }
  }
  if (
    method === 'POST'
    && seg.length === 3
    && seg[0] === 'boards'
    && ['archive', 'trash', 'restore', 'purge'].includes(seg[2])
  ) {
    const lifecycleHandler = {
      archive: handlers.archiveBoard,
      trash: handlers.trashBoard,
      restore: handlers.restoreBoard,
      purge: handlers.purgeBoard,
    }[seg[2]]
    return { status: 200, body: await lifecycleHandler(seg[1], body || {}) }
  }
  if (method === 'POST' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'cards') {
    return { status: 201, body: await handlers.createCard(seg[1], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 4 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[3] === 'batch'
  ) {
    return { status: 201, body: await handlers.createCards(seg[1], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 4 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[3] === 'restore'
  ) {
    return { status: 201, body: await handlers.restoreCards(seg[1], body || {}) }
  }
  if (
    method === 'GET' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'content'
  ) {
    return { status: 200, body: await handlers.readCardContent(seg[1], seg[3]) }
  }
  if (method === 'DELETE' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'cards') {
    return { status: 200, body: await handlers.deleteCards(seg[1], body || {}) }
  }
  if (method === 'PATCH' && seg.length === 3 && seg[0] === 'boards' && seg[2] === 'cards') {
    return { status: 200, body: await handlers.updateCards(seg[1], body || {}) }
  }
  if (method === 'DELETE' && seg.length === 4 && seg[0] === 'boards' && seg[2] === 'cards') {
    return { status: 200, body: await handlers.deleteCard(seg[1], seg[3]) }
  }
  if (method === 'PATCH' && seg.length === 4 && seg[0] === 'boards' && seg[2] === 'cards') {
    return { status: 200, body: await handlers.updateCard(seg[1], seg[3], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'versions'
  ) {
    return {
      status: 201,
      body: await handlers.commitCardVersion(seg[1], seg[3], body || {}),
    }
  }
  if (
    method === 'POST' &&
    seg.length === 7 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'versions' &&
    seg[6] === 'restore'
  ) {
    return {
      status: 201,
      body: await handlers.restoreCardVersion(seg[1], seg[3], seg[5], body || {}),
    }
  }
  if (
    method === 'GET' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'file-binding'
  ) {
    return { status: 200, body: await handlers.getCardFileBinding(seg[1], seg[3]) }
  }
  if (
    method === 'PUT' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'file-binding'
  ) {
    return { status: 200, body: await handlers.bindCardFile(seg[1], seg[3], body || {}) }
  }
  if (
    method === 'DELETE' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'file-binding'
  ) {
    return { status: 200, body: await handlers.unbindCardFile(seg[1], seg[3]) }
  }
  if (
    method === 'POST' &&
    seg.length === 6 &&
    seg[0] === 'boards' &&
    seg[2] === 'cards' &&
    seg[4] === 'file-binding' &&
    seg[5] === 'sync'
  ) {
    return { status: 200, body: await handlers.syncCardFile(seg[1], seg[3], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 4 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations' &&
    seg[3] === 'batch'
  ) {
    return { status: 201, body: await handlers.createTransformations(seg[1], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 3 &&
    seg[0] === 'boards' &&
    seg[2] === 'plans'
  ) {
    return { status: 201, body: await workflowService.createPlan(seg[1], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 3 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations'
  ) {
    return { status: 201, body: await handlers.createTransformation(seg[1], body || {}) }
  }
  if (
    method === 'PATCH' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations' &&
    seg[4] === 'position'
  ) {
    return {
      status: 200,
      body: await handlers.updateTransformationPosition(seg[1], seg[3], body || {}),
    }
  }
  if (
    method === 'PATCH' &&
    seg.length === 4 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations'
  ) {
    return {
      status: 200,
      body: await handlers.updateTransformation(seg[1], seg[3], body || {}),
    }
  }
  if (
    method === 'DELETE' &&
    seg.length === 4 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations'
  ) {
    return {
      status: 200,
      body: await handlers.deleteTransformation(seg[1], seg[3]),
    }
  }
  if (
    method === 'POST' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'workflows' &&
    seg[4] === 'applications'
  ) {
    return {
      status: 201,
      body: await workflowService.apply(seg[1], seg[3], body || {}),
    }
  }
  if (
    method === 'POST' &&
    seg.length === 5 &&
    seg[0] === 'boards' &&
    seg[2] === 'transformations' &&
    seg[4] === 'runs'
  ) {
    return { status: 202, body: await handlers.startRun(seg[1], seg[3], body || {}) }
  }
  if (method === 'GET' && seg.length === 2 && seg[0] === 'runs') {
    return { status: 200, body: await handlers.getRun(seg[1]) }
  }
  if (method === 'POST' && seg.length === 3 && seg[0] === 'runs' && seg[2] === 'interrupt') {
    return { status: 200, body: await handlers.interruptRun(seg[1]) }
  }
  if (
    method === 'POST' &&
    seg.length === 4 &&
    seg[0] === 'runs' &&
    seg[2] === 'candidate' &&
    seg[3] === 'adopt'
  ) {
    return { status: 200, body: await handlers.adoptCandidate(seg[1], body || {}) }
  }
  if (
    method === 'POST' &&
    seg.length === 4 &&
    seg[0] === 'runs' &&
    seg[2] === 'candidate' &&
    seg[3] === 'discard'
  ) {
    return { status: 200, body: await handlers.discardCandidate(seg[1]) }
  }
  return notFound(method, segments)
}
