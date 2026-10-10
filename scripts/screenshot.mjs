// Render a still of the running dev server with headless Chromium.
// usage: node scripts/screenshot.mjs "http://localhost:5173/?t=5" out.png [width] [height]
// Set CHROMIUM_PATH if Playwright's bundled browser isn't installed.
import { chromium } from 'playwright-core'

const [url, out, w = '430', h = '860'] = process.argv.slice(2)
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(url)
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 })
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
