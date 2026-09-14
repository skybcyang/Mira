import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startNodeRuntime } from '../bridge/node-runtime.js'

const require = createRequire(process.env.MIRA_PLAYWRIGHT_REQUIRE || import.meta.url)
const { chromium, expect } = require('playwright/test')
const workspace = await mkdtemp(join(tmpdir(), 'mira-control-feedback-'))
const output = join(workspace, 'screenshots')
await mkdir(output)
console.log(`Browser evidence: ${output}`)
let finishModel
const runtime = await startNodeRuntime({
  workspaceRoot: workspace,
  staticRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
  hostOptions: {
    executeModel: ({ signal }) => new Promise((resolve, reject) => {
      finishModel = () => resolve({ outputText: '# 验证成果\n\n这是受控模型适配器返回的演示材料，用于验证运行状态。' })
      signal.addEventListener('abort', () => reject(new Error('Stopped by browser check')), { once: true })
    }),
  },
})
const base = runtime.address.url
let browser
async function request(path, body) {
  const response = await fetch(`${base}/graphmind/api/v2${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body),
  } : undefined)
  const value = await response.json()
  assert(response.ok, `${path}: ${JSON.stringify(value)}`)
  return value
}

try {
  const { board } = await request('/boards', { title: '交互反馈验证 · 演示材料' })
  const { card } = await request(`/boards/${board.id}/cards`, { markdown: '# 交互反馈\n\n按钮反馈应当短促，运行状态应当真实，设置开关应当清晰。', x: 240, y: 140 })
  const { transformation } = await request(`/boards/${board.id}/transformations`, {
    sourceRefs: [{ cardId: card.id, versionId: card.headVersionId }], label: '整理设计原则', instruction: '整理为简短的设计原则',
    targetPosition: { x: 900, y: 140 },
  })
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.MIRA_HEADLESS === '1' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
  await page.goto(`${base}/graphmind/`)
  await page.getByRole('button', { name: `打开画板：${board.title}`, exact: true }).click()
  const settings = page.getByRole('button', { name: '系统设置', exact: true })
  const dark = page.getByRole('switch', { name: '深色外观', exact: true })
  const grid = page.getByRole('switch', { name: /显示网格线/ })
  const directionLabels = { studio: '原生工作室', editorial: '编辑部', blueprint: '蓝图台' }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await settings.click()
    for (const [direction, label] of Object.entries(directionLabels)) {
      await page.getByRole('button', { name: label, exact: true }).click()
      for (const scheme of ['light', 'dark']) {
        const viewport = await page.locator('.react-flow__viewport').getAttribute('style')
        await dark.setChecked(scheme === 'dark')
        await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', direction)
        await dark.focus()
        await page.keyboard.press('Space')
        await expect(dark).toBeChecked({ checked: scheme !== 'dark' })
        await page.keyboard.press('Space')
        await expect(dark).toBeChecked({ checked: scheme === 'dark' })
        assert(await dark.evaluate(element => element === document.activeElement), 'scheme change retains focus')
        assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), viewport, 'appearance does not move the canvas')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        const row = await dark.locator('..').boundingBox()
        assert(row.height >= 44 && row.width >= 44, 'switch label has a touch-sized hit area')
        const menu = await page.getByRole('dialog', { name: '系统设置' }).boundingBox()
        assert(menu.x >= 0 && menu.x + menu.width <= width && menu.y + menu.height <= (width === 390 ? 844 : 1000))
        await page.screenshot({ path: join(output, `${width}-${direction}-${scheme}.png`), animations: 'disabled' })
      }
    }
    await grid.focus()
    const originalGrid = await grid.isChecked()
    await page.keyboard.press('Space')
    await expect(grid).toBeChecked({ checked: !originalGrid })
    await expect(page.locator('html')).toHaveAttribute('data-canvas-grid', originalGrid ? 'hidden' : 'visible')
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: '原生工作室', exact: true }).click()
    await dark.setChecked(false)
    await page.getByRole('button', { name: '关闭系统设置' }).click()
    await expect(settings).toBeFocused()
  }

  await page.reload()
  await settings.click()
  await expect(dark).not.toBeChecked()
  await expect(grid).toBeChecked()
  await page.getByRole('button', { name: '关闭系统设置' }).click()

  await page.setViewportSize({ width: 1440, height: 1000 })
  const buttonBox = await settings.boundingBox()
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2)
  await page.mouse.down()
  await expect.poll(() => settings.evaluate(element => getComputedStyle(element).transform)).not.toBe('none')
  await page.mouse.up()
  await page.getByRole('button', { name: '关闭系统设置' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2)
  await page.mouse.down()
  await expect.poll(() => settings.evaluate(element => getComputedStyle(element).transform)).toBe('none')
  await page.mouse.up()
  await page.getByRole('button', { name: '关闭系统设置' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const node = page.locator(`.react-flow__node[data-id="transformation-node:${transformation.id}"]`)
  const dimensions = await node.evaluate(element => [element.offsetWidth, element.offsetHeight])
  await page.locator('.react-flow__controls-fitview').click()
  await node.getByRole('button', { name: '运行到这里', exact: true }).click()
  await expect(node.locator('.v2-run-indicator.is-running')).toBeVisible()
  await expect(node.getByRole('button', { name: '停止生成', exact: true })).toBeEnabled()
  const target = page.locator(`.react-flow__node[data-id="${transformation.targetCardId}"]`)
  await target.getByRole('button', { name: '查看运行进度', exact: true }).click()
  await expect(page.locator('.v2-run-heading .v2-run-indicator.is-running')).toBeVisible()
  await expect.poll(() => page.locator('.v2-run-heading .v2-run-indicator').evaluate(element => getComputedStyle(element).animationName)).toBe('mira-spin')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await expect(page.locator('.v2-run-heading')).toContainText('正在生成')
    const stop = page.getByRole('button', { name: '停止生成', exact: true }).last()
    const box = await stop.boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= (width === 390 ? 844 : 1000))
    assert(await stop.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    }), 'stop button center is unobstructed')
    await page.screenshot({ path: join(output, `${width}-running.png`), animations: 'disabled' })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.v2-run-heading .v2-run-indicator').evaluate(element => getComputedStyle(element).animationName), 'none')
  finishModel()
  await expect(page.locator('.v2-run-heading')).toContainText('生成完成')
  await expect(page.locator('.v2-run-indicator')).toHaveCount(0)
  await expect(target).toContainText('验证成果')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Rerun via the real HTTP command, then exercise the existing stop command in the UI.
  await request(`/boards/${board.id}/transformations/${transformation.id}/runs`, {})
  await page.reload()
  await expect(node.getByRole('button', { name: '停止生成', exact: true })).toBeEnabled()
  await node.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(node).toContainText('已停止')
  await expect(node.locator('.v2-run-indicator')).toHaveCount(0)
  assert.deepEqual(await node.evaluate(element => [element.offsetWidth, element.offsetHeight]), dimensions, 'run states keep the step dimensions stable')
  assert.deepEqual(errors, [], 'browser warning/error log')
  console.log(JSON.stringify({ workspace, output, checked: 'six appearances, 1440/390px, keyboard, focus, press, reduced motion, real HTTP run completion and stop', errors }, null, 2))
} finally {
  finishModel?.()
  await browser?.close()
  await runtime.close()
}
