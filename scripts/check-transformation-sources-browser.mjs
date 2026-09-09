import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { startNodeRuntime } from '../bridge/node-runtime.js'
import { createModelSettingsService } from '../bridge/model-settings.js'

const require = createRequire(process.env.MIRA_PLAYWRIGHT_REQUIRE || import.meta.url)
const { chromium } = require('playwright')
const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-source-ui-'))
const screenshots = join(workspaceRoot, 'screenshots')
await mkdir(screenshots)
const settings = createModelSettingsService()
const runtime = await startNodeRuntime({
  workspaceRoot, staticRoot: new URL('../dist/', import.meta.url).pathname,
  hostOptions: { modelSettings: { ...settings,
    executeModel: async () => ({ outputText: '# Combined result\n\nBrowser smoke output.' }),
    resolveModel: async () => ({ provider: 'test', model: 'source-smoke' }),
  } },
})
const base = runtime.address.url
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + '/graphmind/api/v2' + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: base },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  assert(response.ok, path + ': ' + JSON.stringify(data))
  return data
}
const { board } = await request('/boards', { title: 'Multi-source verification' })
const cards = []
for (const [index, label] of ['Material A', 'Material B', 'Material C'].entries()) {
  cards.push((await request('/boards/' + board.id + '/cards', {
    markdown: '# ' + label + '\n\nSource content ' + label, x: 0, y: index * 230, width: 280, height: 180,
  })).card)
}
const { transformation: step } = await request('/boards/' + board.id + '/transformations', {
  label: 'Combined result', instruction: 'Combine every source in order.', acceptance: '',
  sourceRefs: [{ cardId: cards[0].id, versionId: cards[0].headVersionId }], targetPosition: { x: 680, y: 0 },
})
await request('/boards/' + board.id + '/transformations/' + step.id + '/position', { x: 360, y: 0 }, 'PATCH')
const browser = await chromium.launch({ channel: process.env.MIRA_BROWSER_CHANNEL || 'chrome', headless: process.env.MIRA_HEADLESS !== '0' })
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (!['error', 'warning'].includes(message.type())) return
  const entry = message.text() + ' [' + message.location().url + ']'
  errors.push(entry)
})
const node = id => page.locator('.react-flow__node[data-id="' + id + '"]')
const stepNode = () => node('transformation-node:' + step.id)
const getBoard = async () => (await request('/boards/' + board.id)).board
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await check()) return
    await page.waitForTimeout(100)
  }
  throw new Error('Timed out: ' + label)
}
async function expectSources(ids) {
  await waitFor(async () => JSON.stringify((await getBoard()).transformations[0].sourceCardIds) === JSON.stringify(ids), 'sources ' + ids.join(','))
}
async function connect(id) {
  await node(id).hover()
  const from = await node(id).locator('.v2-handle-out').boundingBox()
  const to = await stepNode().locator('.v2-source-input').boundingBox()
  assert(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.screenshot({ path: join(screenshots, 'desktop-connection.png') })
  await page.mouse.up()
}
async function assertControlsReachable(selector) {
  const problems = await page.locator(selector).evaluate(root => [...root.querySelectorAll('button, select')].filter(el => !el.disabled).flatMap(el => {
    const rect = el.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return rect.width < 1 || rect.height < 1 || !el.contains(hit) || rect.right > innerWidth || el.scrollWidth > el.clientWidth + 1
      ? [el.getAttribute('aria-label') || el.textContent] : []
  }))
  assert.deepEqual(problems, [])
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow')
}
try {
  await page.goto(base + '/graphmind/')
  await page.locator('.v2-board-select').selectOption(board.id)
  await stepNode().waitFor()
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(300)
  await connect(cards[1].id)
  await expectSources([cards[0].id, cards[1].id])
  const revision = (await getBoard()).revision
  await connect(cards[1].id)
  assert.equal((await getBoard()).revision, revision, 'duplicate drop is a no-op')
  await connect(step.targetCardId)
  await page.getByText('目标卡不能作为自身来源。', { exact: true }).waitFor()
  assert.equal((await getBoard()).revision, revision, 'self-reference drop is rejected without writing')
  await stepNode().locator('article > strong').click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await waitFor(() => page.getByRole('combobox', { name: '选择来源卡片', exact: true }).evaluate(el => document.activeElement === el), 'picker receives focus')
  const beforeCancel = await getBoard()
  await node(cards[2].id).click({ position: { x: 30, y: 25 } })
  await page.getByText('已选 1 张', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await waitFor(() => page.locator('.v2-detail-drawer').evaluate(el => el.contains(document.activeElement)), 'cancel returns detail focus')
  assert.deepEqual(await getBoard(), beforeCancel, 'cancel must not write')
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await node(cards[2].id).click({ position: { x: 30, y: 25 } })
  await assertControlsReachable('.v2-source-picker')
  await page.screenshot({ path: join(screenshots, 'desktop-picker.png') })
  await page.getByRole('button', { name: '确认添加（1）', exact: true }).click()
  await expectSources(cards.map(card => card.id))
  await page.getByRole('button', { name: '上移来源：Material C', exact: true }).click()
  await expectSources([cards[0].id, cards[2].id, cards[1].id])
  await page.getByRole('button', { name: '移除来源：Material B', exact: true }).click()
  await expectSources([cards[0].id, cards[2].id])
  await assertControlsReachable('.v2-source-manager')
  await page.screenshot({ path: join(screenshots, 'desktop-sources.png') })
  assert.equal((await getBoard()).cards.length, 4, 'source editing must not create cards')
  assert(!(await getBoard()).transformations[0].lastRunId, 'source editing must not auto-run')
  await page.getByRole('button', { name: '运行到这里', exact: true }).last().click()
  await waitFor(async () => Boolean((await getBoard()).transformations[0].lastAppliedRunId), 'run applied')
  const runId = (await getBoard()).transformations[0].lastAppliedRunId
  const { run } = await request('/runs/' + runId)
  assert.deepEqual(run.sourceSnapshot.map(source => source.cardId), [cards[0].id, cards[2].id])
  await stepNode().locator('article > strong').click()
  const beforePreview = await getBoard()
  await page.locator('.v2-source-state-summary > summary').click()
  await page.locator('.v2-source-comparison button').first().click()
  await page.getByRole('region', { name: '来源预览', exact: true }).waitFor()
  assert((await page.locator('.v2-source-preview').innerText()).includes('Source content Material A'), 'historical input preview survives source management')
  await page.getByRole('button', { name: '当前', exact: true }).click()
  await page.getByRole('button', { name: '返回原任务', exact: true }).click()
  await page.getByRole('button', { name: '添加来源', exact: true }).waitFor()
  assert.deepEqual(await getBoard(), beforePreview, 'source preview must not write')
  const closeDetail = page.getByRole('button', { name: '关闭详情', exact: true })
  if (await closeDetail.isVisible()) await closeDetail.click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(300)
  await stepNode().locator('article > strong').click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page.getByRole('combobox', { name: '选择来源卡片', exact: true }).selectOption(cards[1].id)
  await assertControlsReachable('.v2-source-picker')
  await page.screenshot({ path: join(screenshots, 'mobile-picker.png') })
  await page.getByRole('button', { name: '确认添加（1）', exact: true }).click()
  await expectSources([cards[0].id, cards[2].id, cards[1].id])
  await page.locator('.v2-source-manager').scrollIntoViewIfNeeded()
  await assertControlsReachable('.v2-source-manager')
  await page.screenshot({ path: join(screenshots, 'mobile-sources.png') })
  assert.equal((await getBoard()).transformations[0].lastRunId, runId, 'appending to an applied result must not run')
  assert((await page.locator('.v2-source-manager').innerText()).includes('来源或顺序已变化'))
  await page.reload()
  await page.locator('.v2-board-select').selectOption(board.id)
  await expectSources([cards[0].id, cards[2].id, cards[1].id])
  await page.evaluate(() => localStorage.setItem('mira.appearance.scheme', 'dark'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.locator('.v2-board-select').selectOption(board.id)
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(300)
  await stepNode().locator('article > strong').click()
  await page.locator('.v2-source-manager').scrollIntoViewIfNeeded()
  await assertControlsReachable('.v2-source-manager')
  await page.screenshot({ path: join(screenshots, 'mobile-dark-sources.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ workspaceRoot, screenshots, browserChecks: 'passed', consoleErrors: errors, sourceOrder: [cards[0].id, cards[2].id, cards[1].id] }, null, 2))
} catch (error) {
  await page.screenshot({ path: join(screenshots, 'failure.png') })
  console.error('Browser evidence:', screenshots)
  throw error
} finally {
  await browser.close()
  await runtime.close()
}
