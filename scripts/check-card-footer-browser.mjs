import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const base = process.env.MIRA_UI_BASE_URL
if (!base?.startsWith('http://127.0.0.1:')) throw new Error('Set an explicit localhost MIRA_UI_BASE_URL')
const require = createRequire(process.env.MIRA_PLAYWRIGHT_REQUIRE || import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 900 } })
  await page.goto(`${base}/graphmind/`)
  await page.locator('.v2-card-footer').first().waitFor()
  // CSS-only stress case: preserve actual footer markup and add allowed simultaneous states.
  const result = await page.evaluate(() => {
    const source = document.querySelector('.v2-card-footer')
    const results = []
    for (const [index, width] of [312, 280].entries()) {
      const card = document.createElement('article')
      card.className = 'v2-card is-selected is-running'
      card.style.cssText = `position:fixed;left:8px;top:${100 + index * 160}px;width:${width}px;height:120px;z-index:999999`
      const spacer = document.createElement('div')
      spacer.style.flex = '1'
      spacer.textContent = `CSS fixture ${width}px, coarse pointer`
      card.append(spacer)
      const footer = source.cloneNode(true)
      for (const [label, className] of [
        ['\u6765\u6e90\u5df2\u53d8\u5316', 'v2-status warning nodrag'],
        ['\u67e5\u770b\u8fd0\u884c\u8fdb\u5ea6', 'v2-icon-button nodrag'],
        ['\u505c\u6b62\u751f\u6210', 'v2-icon-button nodrag'],
      ]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = className
        button.setAttribute('aria-label', label)
        button.append(source.querySelector('svg').cloneNode(true))
        if (className.includes('v2-status')) button.append(document.createTextNode(label))
        footer.append(button)
      }
      card.append(footer)
      document.querySelector('.v2-app').append(card)
      const bounds = card.getBoundingClientRect()
      const footerBounds = footer.getBoundingClientRect()
      const usableRight = footerBounds.right - parseFloat(getComputedStyle(footer).paddingRight)
      results.push({
        width,
        cardRight: bounds.right,
        usableRight,
        hintDisplay: getComputedStyle(footer.querySelector('.v2-overflow-hint')).display,
        buttons: [...footer.querySelectorAll('button')]
          .filter((button) => getComputedStyle(button).display !== 'none')
          .map((button) => {
            const rect = button.getBoundingClientRect()
            return {
              label: button.getAttribute('aria-label'),
              left: rect.left, right: rect.right, width: rect.width, height: rect.height,
              scrollWidth: button.scrollWidth, clientWidth: button.clientWidth,
              encroachment: Math.max(0, rect.right - usableRight),
            }
          }),
      })
    }
    return { coarse: matchMedia('(pointer: coarse)').matches, results }
  })
  console.log(JSON.stringify(result, null, 2))
  await page.screenshot({ path: process.env.MIRA_FOOTER_SCREENSHOT || '/tmp/mira-card-footer-coarse-review-after.png' })
  assert(result.coarse)
  for (const fixture of result.results) {
    assert.equal(fixture.hintDisplay, 'none', `${fixture.width}px redundant overflow hint must release its space`)
    for (const button of fixture.buttons) {
      assert(button.width >= 44 && button.height >= 44, `${fixture.width}px touch target: ${button.label}`)
      assert(button.encroachment <= 0.5, `${fixture.width}px resize zone collision: ${button.label}`)
      assert(button.scrollWidth <= button.clientWidth + 1, `${fixture.width}px text overflow: ${button.label}`)
    }
  }
} finally {
  await browser.close()
}
