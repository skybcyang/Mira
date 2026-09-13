import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
import ipaddr from 'ipaddr.js'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import { typed } from './domain/errors.js'

const LIMIT = 5 * 1024 * 1024
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
const blocked = () => { throw typed('MATERIAL_SOURCE_BLOCKED', '只允许读取使用标准端口的公开网页地址。') }
export function checkedWebUrl(value) {
  let url
  try { url = new URL(value) } catch { return blocked() }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 8192) blocked()
  url.hash = ''; return url
}
function publicIp(address) {
  try { const ip = ipaddr.process(address); return ip.range() === 'unicast' } catch { return false }
}
export async function publicAddresses(url, resolve = host => lookup(host, { all: true, verbatim: true })) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(hostname)) {
    if (!publicIp(hostname)) blocked()
    return [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
  }
  let addresses
  try { addresses = await resolve(hostname) } catch { throw typed('MATERIAL_READ_FAILED', '网页地址无法解析。') }
  if (!addresses.length || addresses.some(item => !publicIp(item.address))) blocked()
  return addresses
}
export async function requestPinned(url, addresses, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, agent: false, headers: { accept: 'text/html, text/plain;q=0.9', 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'Mira-MaterialReader/1.0' },
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.alloc(0) }); return }
      if (Number(response.headers['content-length']) > LIMIT) { response.destroy(); reject(typed('MATERIAL_LIMIT', '网页超过 5 MiB 上限。')); return }
      const encoding = response.headers['content-encoding']?.toLowerCase()
      const decompress = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null
      if (encoding && encoding !== 'identity' && !decompress) { response.destroy(); reject(typed('MATERIAL_READ_FAILED', '不支持网页使用的压缩格式。')); return }
      const stream = decompress ? response.pipe(decompress) : response
      let size = 0, wireSize = 0
      const chunks = []
      const fail = error => { response.destroy(); decompress?.destroy(); reject(error) }
      response.on('error', fail)
      response.on('data', chunk => { wireSize += chunk.length; if (wireSize > LIMIT) fail(typed('MATERIAL_LIMIT', '网页超过 5 MiB 上限。')) })
      if (decompress) decompress.on('error', fail)
      stream.on('data', chunk => {
        size += chunk.length
        if (size > LIMIT) { fail(typed('MATERIAL_LIMIT', '网页解压后超过 5 MiB 上限。')); return }
        chunks.push(chunk)
      })
      stream.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }))
    })
    request.on('error', reject)
  })
}
function documentText(node, base) {
  if (node.nodeType === 3) return node.textContent
  if (node.nodeType !== 1) return ''
  const name = node.localName
  if (['script', 'style', 'iframe', 'img', 'svg', 'object', 'embed', 'form', 'nav', 'footer', 'noscript'].includes(name)) return ''
  const text = [...node.childNodes].map(child => documentText(child, base)).join('')
  if (name === 'a' && node.hasAttribute('href')) {
    try { const href = new URL(node.getAttribute('href'), base); if (['https:', 'http:'].includes(href.protocol) && !href.username && !href.password) return `${text} (${href.href})` } catch { /* Keep only visible text. */ }
  }
  if (/^h[1-6]$/.test(name)) return `\n\n${'#'.repeat(Number(name[1]))} ${text.trim()}\n\n`
  if (name === 'br') return '\n'
  return ['p', 'div', 'section', 'article', 'li', 'tr', 'blockquote', 'pre'].includes(name) ? `\n${text}\n` : text
}
export function parseWebDocument(bytes, contentType, url) {
  if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType || '')) throw typed('MATERIAL_READ_FAILED', '该地址没有返回可阅读的网页或文本。')
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] || 'utf-8'
  let decoded
  try { decoded = new TextDecoder(charset, { fatal: true }).decode(bytes) } catch { throw typed('MATERIAL_READ_FAILED', '网页文字编码无法可靠解析。') }
  let text = decoded, title = new URL(url).hostname
  if (!/^text\/plain/i.test(contentType)) {
    const { document } = parseHTML(decoded)
    if (document.querySelector('input[type=password], iframe[src*="captcha"], .g-recaptcha, #challenge-form')
      || /(?:sign in|log in|login|登录|登入).{0,40}(?:to (?:continue|read)|后.{0,10}(?:阅读|查看))|verify you are human|checking your browser/i.test(document.body?.textContent || '')) throw typed('MATERIAL_READ_FAILED', '网页存在登录、验证或访问限制，无法确认正文。')
    for (const element of document.querySelectorAll('script,style,iframe,object,embed,form,svg,img')) element.remove()
    const article = new Readability(document, { keepClasses: false }).parse()
    if (!article?.content || !article.textContent?.trim()) throw typed('MATERIAL_READ_FAILED', '无法识别可核对的网页正文。')
    title = article.title?.trim() || title
    text = documentText(parseHTML(`<html><body>${article.content}</body></html>`).document.body, url)
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text || /\ufffd|\u0000/.test(text)) throw typed('MATERIAL_READ_FAILED', '网页没有可靠可读的正文。')
  if (text.length > 1000000) throw typed('MATERIAL_LIMIT', '网页正文超过 1,000,000 字符上限。')
  return { text, title: title.slice(0, 500), warnings: [{ code: 'COMPLETENESS_UNVERIFIED', message: '请对照原网页核对正文完整性；此处不会加载动态内容或下一页。' }] }
}
export function createNodeWebReader({ resolve, request = requestPinned } = {}) {
  return async ({ url: value }, { signal, allowedUrls } = {}) => {
    const timeout = AbortSignal.timeout(20000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let url = checkedWebUrl(value)
    const requestedUrl = url.href
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        combined.throwIfAborted()
        if (allowedUrls && !allowedUrls.some(value => checkedWebUrl(value).href === url.href)) throw typed('TOOL_POLICY_INVALID', '网页跳转目标不在本步允许的 URL 范围内。')
        const addresses = await abortable(publicAddresses(url, resolve), combined)
        combined.throwIfAborted()
        const response = await request(url, addresses, { signal: combined })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects === 5 || !response.headers.location) throw typed('MATERIAL_READ_FAILED', '网页重定向过多或无效。')
          url = checkedWebUrl(new URL(response.headers.location, url).href); continue
        }
        if (response.status !== 200) throw typed('MATERIAL_READ_FAILED', '网页拒绝访问或没有返回可用正文。')
        const parsed = parseWebDocument(response.bytes, response.headers['content-type'], url.href)
        combined.throwIfAborted()
        return { ...parsed, url: url.href, ...(requestedUrl !== url.href ? { requestedUrl } : {}), byteLength: response.bytes.length, sourceDigest: createHash('sha256').update(response.bytes).digest('hex'), reader: { id: 'mira-web-readability', version: '1.0.0' } }
      }
    } catch (error) {
      if (typeof error?.code === 'string' && (error.code.startsWith('MATERIAL_') || error.code === 'TOOL_POLICY_INVALID')) throw error
      throw typed('MATERIAL_READ_FAILED', '网页读取失败或超时，请检查地址后重试。')
    }
  }
}
