import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { startNodeRuntime } from '../bridge/node-runtime.js'

const require = createRequire(process.env.MIRA_PLAYWRIGHT_REQUIRE || import.meta.url)
const { chromium } = require('playwright')
const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-markdown-check-'))
const runtime = await startNodeRuntime({ workspaceRoot, staticRoot: resolve('dist'), host: '127.0.0.1', port: 0 })
const base = runtime.address.url
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
const markdown = [
  '# Markdown preview',
  '| Material | Result | Status | Owner | Date | Note |',
  '| :--- | ---: | :---: | --- | --- | --- |',
  '| **Interview** | 12 | Ready | Mira | 2026-09-07 | Read the source |',
  '', '- [x] Read source', '- [ ] Compare results', '', '~~Old draft~~ https://example.com',
  '', '> A quoted source.', '', '1. First\n2. Second', '',
  '```js', `const longLine = "${'wide-code-'.repeat(24)}"`, '```',
  '', 'Text[^note]', '', '[^note]: Source note', '', `![Mira](${base}/graphmind/favicon.svg)`,
].join('\n')
async function api(path, body) {
  const response = await fetch(`${base}/graphmind/api/v2${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body),
  } : undefined)
  assert(response.ok, `${path}: ${response.status}`)
  return response.json()
}
try {
  const board = (await api('/boards', { title: 'Temporary Markdown check' })).board
  const card = (await api(`/boards/${board.id}/cards`, { x: 0, y: 0, width: 560, height: 480, markdown })).card
  const saved = await api(`/boards/${board.id}`)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`${base}/graphmind/`)
    await page.locator('.v2-board-select').selectOption(board.id)
    const node = page.locator(`.react-flow__node[data-id="${card.id}"]`)
    await node.locator('table').waitFor()
    assert.equal(await node.locator('input[type="checkbox"]:disabled').count(), 2)
    await node.getByRole('button', { name: '阅读完整内容', exact: true }).click()
    const reader = page.locator('.v2-detail-drawer .v2-content-reader-prose:visible')
    await reader.locator('table').waitFor()
    assert.equal(await reader.locator('del').innerText(), 'Old draft')
    assert.equal(await reader.locator('pre').evaluate((node) => getComputedStyle(node).whiteSpace), 'pre')
    const region = reader.getByRole('region', { name: '表格' })
    if (width === 390) {
      assert(await region.evaluate((node) => node.scrollWidth > node.clientWidth), 'wide table scrolls locally')
      await region.evaluate((node) => { node.scrollLeft = 100 })
      assert(await region.evaluate((node) => node.scrollLeft > 0))
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not overflow')
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(workspaceRoot, `${width}-reader.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await node.locator('.v2-card-heading-title').click()
    await page.locator('.v2-source-preview-trigger').click()
    await page.locator('.v2-source-preview table').waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'source preview must not overflow')
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(workspaceRoot, `${width}-source.png`), animations: 'disabled' })
  }
  assert.deepEqual(await api(`/boards/${board.id}`), saved, 'preview does not change persisted content')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, workspaceRoot, screenshots: 4 }))
} finally {
  await browser.close()
  await runtime.close()
}
