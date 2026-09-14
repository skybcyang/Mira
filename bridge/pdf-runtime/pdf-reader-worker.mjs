import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { getDocument, AnnotationMode, version } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfAssetBasePath } from './pdf-asset-path.mjs'

// This isolated runtime receives bytes, never a URL. Assets are shipped locally; PDF actions
// and attachments are never requested or interpreted by this reader.
globalThis.fetch = async () => { throw new Error('PDF network access is disabled') }
const require = createRequire(import.meta.url)
const root = dirname(require.resolve('pdfjs-dist/package.json'))
let document
const error = (message, code = 'MATERIAL_READ_FAILED') => ({ message, code })
try {
  document = await getDocument({ data: new Uint8Array(workerData.bytes), isEvalSupported: false, useSystemFonts: false,
    disableFontFace: true, verbosity: 0, stopAtErrors: true, useWasm: false,
    cMapUrl: pdfAssetBasePath(root, 'cmaps'), cMapPacked: true,
    standardFontDataUrl: pdfAssetBasePath(root, 'standard_fonts'),
  }).promise
  if (document.numPages > 500) throw error('PDF 超过 500 页上限。', 'MATERIAL_LIMIT')
  const pages = [], warnings = [{ code: 'PDF_LAYOUT', message: '物理页码从 1 开始。表格、多栏和公式可能存在阅读顺序偏差，请对照原页；不支持 OCR。' }]
  let text = ''
  for (let index = 1; index <= document.numPages; index++) {
    const start = text.length
    let pageText = '', status = 'unreadable'
    try {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
      if (/[\ufffd\u0000]/u.test(pageText)) pageText = ''
      status = pageText ? 'text' : (await page.getOperatorList()).fnArray.length === 0 ? 'empty' : 'unreadable'
      page.cleanup()
    } catch { status = 'unreadable' }
    if (status === 'unreadable') warnings.push({ code: 'PDF_UNREADABLE', page: index, message: `第 ${index} 页无法可靠提取文字，可能需要 OCR 或原文件检查。` })
    text += pageText
    pages.push({ page: index, start, end: text.length, status })
    if (index < document.numPages) text += '\n\n'
    if (text.length > 1000000) throw error('PDF 正文超过 1,000,000 字符上限。', 'MATERIAL_LIMIT')
  }
  parentPort.postMessage({ ready: { text, pages, warnings, reader: { id: 'mira-pdfjs', version } } })
} catch (cause) {
  parentPort.postMessage({ error: error(cause?.name === 'PasswordException' ? '首版不支持密码保护的 PDF。' : cause?.code === 'MATERIAL_LIMIT' ? cause.message : 'PDF 无法解析，请检查文件是否完整。', cause?.code === 'MATERIAL_LIMIT' ? cause.code : undefined) })
}
let rendering = false
parentPort.on('message', async ({ id, page: pageNumber }) => {
  if (rendering || !document || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
    parentPort.postMessage({ id, error: error('页面正在读取或不可用。') }); return
  }
  rendering = true
  let canvas
  try {
    const page = await document.getPage(pageNumber)
    const original = page.getViewport({ scale: 1 })
    const scale = Math.min(1.5, 1200 / original.width, 1600 / original.height)
    const viewport = page.getViewport({ scale })
    if (!Number.isFinite(scale) || scale <= 0) throw error('页面尺寸无效。')
    canvas = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvasContext: canvas.context, viewport, annotationMode: AnnotationMode.DISABLE }).promise
    const bytes = canvas.canvas.toBuffer('image/png')
    if (bytes.length > 8 * 1024 * 1024) throw error('页面图像超过预览上限。', 'MATERIAL_LIMIT')
    parentPort.postMessage({ id, image: `data:image/png;base64,${bytes.toString('base64')}` })
    page.cleanup()
  } catch { parentPort.postMessage({ id, error: error('原页无法渲染，请在原文件中核对。') }) }
  finally { if (canvas) document.canvasFactory.destroy(canvas); rendering = false }
})
