import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const base = process.env.MIRA_UI_BASE_URL
if (!base?.startsWith('http://127.0.0.1:') || !process.env.MIRA_TEST_WORKSPACE?.startsWith('/tmp/mira-card-ui-')) {
  throw new Error('Use an isolated /tmp/mira-card-ui-* workspace and explicit localhost URL')
}
const require = createRequire(process.env.MIRA_PLAYWRIGHT_REQUIRE || import.meta.url)
const { chromium } = require('playwright')
const output = resolve(process.env.MIRA_SCREENSHOTS || '/tmp/mira-card-ui-screenshots')
await mkdir(output, { recursive: true })
const api = `${base}/graphmind/api/v2`
async function request(path, body) {
  const response = await fetch(`${api}${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body),
  } : undefined)
  const data = await response.json()
  assert(response.ok, `${path}: ${JSON.stringify(data)}`)
  return data
}
const artifact = JSON.parse(await readFile(new URL('../examples/card-workflows/interview.mira-board.json', import.meta.url), 'utf8'))
const imported = await request('/boards/imports', { artifact })
const board = imported.board
const sourceId = board.cards[0].id
const targetId = board.cards[1].id
const browser = await chromium.launch({ headless: process.env.MIRA_HEADLESS !== '0', channel: process.env.MIRA_BROWSER_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const expectedResourceErrors = new Set()
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (expectedResourceErrors.has(message.location().url) && message.text().startsWith('Failed to load resource')) return
  if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.text()} [${message.location().url}]`)
})
const card = (id) => page.locator(`.react-flow__node[data-id="${id}"]`)
async function waitFor(check, label) {
  for (let index = 0; index < 50; index++) {
    if (await check()) return
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out: ${label}`)
}
async function selectBoard() {
  await page.goto(`${base}/graphmind/`)
  await page.locator('.v2-board-select').waitFor({ state: 'visible' })
  await page.locator('.v2-board-select').selectOption(board.id)
  await card(sourceId).waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(250)
}
try {
  await selectBoard()
  await page.screenshot({ path: `${output}/desktop-cards.png` })
  const source = card(sourceId)
  await source.locator('.v2-card-heading-title').click()
  const before = (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId)
  await source.locator('[data-card-reader]').focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(200)
  const after = (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId)
  assert.equal(after.x, before.x, 'reader arrow must not move the card')
  const targetReader = card(targetId).locator('[data-card-reader]')
  const textBox = await targetReader.locator('h1, h2, h3').first().boundingBox()
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(textBox.x + Math.min(100, textBox.width - 4), textBox.y + textBox.height / 2, { steps: 12 })
  await page.mouse.up()
  assert((await page.evaluate(() => getSelection()?.toString().length || 0)) > 0, 'native body drag selects text')
  assert.deepEqual(await page.locator('.react-flow__node.selected').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id'))), [sourceId], 'text drag must preserve card selection')
  await source.getByRole('button', { name: '编辑内容', exact: true }).click()
  await page.locator('.v2-content-metadata > summary').click()
  await page.getByLabel('输入标签', { exact: true }).fill('未保存标签')
  assert(await page.getByRole('button', { name: '保存并新建', exact: true }).isDisabled(), 'pending tags must block save-and-new')
  await page.getByLabel('输入标签', { exact: true }).fill('')
  const editor = page.getByLabel('编辑卡片内容', { exact: true })
  const original = await editor.inputValue()
  await editor.fill(`${original}\n\n草稿保留检查`)
  await page.getByRole('button', { name: '阅读', exact: true }).click()
  assert.equal(await editor.inputValue(), `${original}\n\n草稿保留检查`)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '展开详情', exact: true }).click()
  assert((await page.locator('.v2-detail-drawer').boundingBox()).width >= 680)
  await page.screenshot({ path: `${output}/desktop-editor.png` })
  await page.getByRole('button', { name: '取消修改', exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()

  await source.locator('.v2-card-heading-title').click()
  await page.getByLabel('整理卡片', { exact: true }).click()
  await page.locator('.v2-size-presets').first().getByRole('button', { name: '440', exact: true }).click()
  await waitFor(async () => (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId).width === 440, 'size save')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitFor(async () => (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId).width === before.width, 'size undo')
  const resize = await source.locator('.v2-card-resizer').boundingBox()
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2)
  await page.mouse.down()
  await page.mouse.move(resize.x + 65, resize.y + 35, { steps: 10 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(150)
  const cancelledSize = (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId)
  assert.equal(cancelledSize.width, before.width, 'Escape cancels resize without saving')
  const retryResize = await source.locator('.v2-card-resizer').boundingBox()
  const scale = (await source.boundingBox()).width / before.width
  await page.mouse.move(retryResize.x + retryResize.width / 2, retryResize.y + retryResize.height / 2)
  await page.mouse.down()
  await page.mouse.move(retryResize.x + retryResize.width / 2 + 10, retryResize.y + retryResize.height / 2 + 10, { steps: 5 })
  await page.mouse.up()
  await waitFor(async () => (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId).width !== before.width, 'resize following cancellation')
  const retriedSize = (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId)
  assert(Math.abs(retriedSize.width - before.width - 10 / scale) < 3, 'next resize must start from restored measurements')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitFor(async () => (await request(`/boards/${board.id}`)).board.cards.find((item) => item.id === sourceId).width === before.width, 'second resize undo')

  await card(targetId).getByRole('button', { name: '编辑内容', exact: true }).click()
  const targetEditor = page.getByLabel('编辑卡片内容', { exact: true })
  const targetText = await targetEditor.inputValue()
  await targetEditor.fill(`${targetText}\n\n核对来源时保留`)
  await page.getByRole('button', { name: '查看来源 1', exact: true }).click()
  await page.getByLabel('来源预览', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await targetEditor.inputValue(), `${targetText}\n\n核对来源时保留`)
  await page.screenshot({ path: `${output}/desktop-source.png` })
  await page.getByRole('button', { name: '返回原任务', exact: true }).click()
  await page.getByRole('button', { name: '取消修改', exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()

  await source.getByRole('button', { name: '编辑内容', exact: true }).click()
  const nextEditor = page.getByLabel('编辑卡片内容', { exact: true })
  await nextEditor.fill(`${original}\n连续记录检查`)
  await page.getByRole('button', { name: '保存并新建', exact: true }).click()
  await waitFor(async () => (await request(`/boards/${board.id}`)).board.cards.length === 5, 'save-and-new')
  await waitFor(async () => (await nextEditor.inputValue()) === '', 'new card editor')
  const continued = (await request(`/boards/${board.id}`)).board
  assert.equal(continued.cards.find((item) => item.id === sourceId).versions.length, before.versions.length + 1)
  const created = continued.cards.find((item) => !board.cards.some((previous) => previous.id === item.id))
  assert.equal(created.width, before.width)
  assert.equal(created.versions.length, 0)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '查看运行范围', exact: true }).first().click()
  await page.locator('.v2-run-range[open]').waitFor({ state: 'visible' })
  await page.screenshot({ path: `${output}/desktop-range.png` })
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()

  await source.getByRole('button', { name: '编辑内容', exact: true }).click()
  const pendingEditor = page.getByLabel('编辑卡片内容', { exact: true })
  const submitted = `${original}\n故障时保留的正文`
  await pendingEditor.fill(submitted)
  let releaseSave
  let saveStarted = false
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  const versionUrl = `${api}/boards/${board.id}/cards/${sourceId}/versions`
  const createUrl = `${api}/boards/${board.id}/cards`
  await page.route(versionUrl, async (route) => { saveStarted = true; await saveGate; await route.continue() })
  expectedResourceErrors.add(createUrl)
  await page.route(createUrl, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_ERROR', message: 'test failure' } }) }))
  await page.getByRole('button', { name: '保存并新建', exact: true }).click()
  await waitFor(() => saveStarted, 'held save request')
  await pendingEditor.focus()
  await page.keyboard.press('Escape')
  assert.equal(await pendingEditor.inputValue(), submitted, 'pending Escape must preserve submitted draft')
  assert(await page.getByLabel('输入标签', { exact: true }).isDisabled(), 'tag edits locked during continuous submission')
  releaseSave()
  await page.getByText('正文已保存，新卡状态待核对。请重新打开画板检查，不要重复创建。', { exact: true }).waitFor()
  assert(await page.getByRole('button', { name: '保存并新建', exact: true }).isDisabled(), 'uncertain creation must not blindly retry')
  assert.equal((await request(`/boards/${board.id}`)).board.cards.length, 5, 'failed create leaves saved board intact')
  await page.unroute(versionUrl)
  await page.unroute(createUrl)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()

  await writeFile(resolve(process.env.MIRA_TEST_WORKSPACE, 'late.txt'), 'Temporary source for delayed-read verification.\n', { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error })
  const fileCard = (await request(`/boards/${board.id}/cards`, { x: 400, y: 400, contentKind: 'file-reference', filePath: 'late.txt' })).card
  await selectBoard()
  let releaseFile
  let fileStarted = false
  const fileGate = new Promise((resolve) => { releaseFile = resolve })
  const fileUrl = `${api}/boards/${board.id}/cards/${fileCard.id}/content`
  await page.route(fileUrl, async (route) => {
    fileStarted = true
    await fileGate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: 'LATE FILE MUST NOT REPLACE SOURCE', versionId: fileCard.headVersionId, contentKind: 'file-reference', path: 'late.txt' }) })
  })
  await card(fileCard.id).locator('.v2-card-heading-title').click()
  await page.locator('.v2-source-preview-trigger').click()
  await waitFor(() => fileStarted, 'held file read')
  await page.getByRole('button', { name: '返回原任务', exact: true }).click()
  await source.locator('.v2-card-heading-title').click()
  await page.locator('.v2-source-preview-trigger').click()
  releaseFile()
  await page.waitForTimeout(200)
  assert(!(await page.locator('.v2-source-preview').innerText()).includes('LATE FILE'), 'late file must not replace a different source')
  await page.unroute(fileUrl)
  await page.getByRole('button', { name: '返回原任务', exact: true }).click()

  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await selectBoard()
    await card(sourceId).getByRole('button', { name: '阅读完整内容', exact: true }).click()
    await page.locator('.v2-detail-drawer').waitFor({ state: 'visible' })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px page overflow`)
    await page.screenshot({ path: `${output}/${width}-reader.png` })
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByLabel('编辑卡片内容', { exact: true }).fill(`${original}\n窄屏草稿`)
    await page.screenshot({ path: `${output}/${width}-editor.png` })
    await page.getByRole('button', { name: '取消修改', exact: true }).click()
    await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await selectBoard()
  for (const direction of ['原生工作室', '编辑部', '蓝图台']) {
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await page.getByRole('menuitem', { name: '外观', exact: true }).click()
    await page.getByRole('button', { name: direction, exact: true }).click()
    for (let index = 0; index < 2; index++) {
      const toggle = page.getByRole('button', { name: /切换为.*色外观/ })
      await toggle.click()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'theme page overflow')
      await page.screenshot({ path: `${output}/theme-${direction}-${index}.png` })
    }
    await page.keyboard.press('Escape')
  }

  await card(targetId).getByRole('button', { name: '编辑内容', exact: true }).click()
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.getByRole('button', { name: /保存为方法/ }).click()
  const methodTitle = `Browser example ${board.id}`
  await page.getByLabel('方法名称', { exact: true }).fill(methodTitle)
  await page.getByLabel('输入名称', { exact: true }).fill('新访谈材料')
  await page.locator('.v2-save-workflow-form').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: /保存为方法/ }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  const newBoard = (await request('/boards', { title: '临时方法复用验收' })).board
  const newSource = (await request(`/boards/${newBoard.id}/cards`, { x: 0, y: 0, markdown: '# 新访谈\n用户希望先看到待处理事项。' })).card
  await page.reload()
  await page.locator('.v2-board-select').selectOption(newBoard.id)
  await card(newSource.id).locator('.v2-card-heading-title').click()
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '方法', exact: true }).click()
  const method = page.locator('.v2-workflow-item').filter({ has: page.getByRole('heading', { name: methodTitle, exact: true }) })
  await method.locator('.v2-workflow-outcome').waitFor()
  await method.getByText('完整步骤', { exact: true }).click()
  assert.equal(await method.locator('.v2-workflow-step-list li').count(), 3)
  await page.screenshot({ path: `${output}/desktop-method.png` })
  await method.getByRole('button', { name: '使用', exact: true }).click()
  await page.getByRole('button', { name: '使用已选', exact: true }).click()
  await page.locator('.v2-draft-confirm').click()
  await waitFor(async () => (await request(`/boards/${newBoard.id}`)).board.transformations.length === 3, 'explicit method materialization')
  const reused = await request(`/boards/${newBoard.id}`)
  assert.equal(reused.board.cards.length, 4)
  assert.deepEqual(reused.board.transformations[0].sourceCardIds, [newSource.id])
  assert(reused.board.cards.filter((item) => item.id !== newSource.id).every((item) => item.versions.length === 0), 'method does not copy example content')
  assert.equal((await request(`/boards/${newBoard.id}/export`)).runs.length, 0, 'method application does not run')
  assert.deepEqual(errors, [], 'browser console must be clean')
  console.log(JSON.stringify({ passed: true, boardId: board.id, reuseBoardId: newBoard.id, output, screenshots: 15 }))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  throw error
} finally {
  await browser.close()
}
