import { chromium } from 'playwright'

async function run() {
  const browser = await chromium.launch({ headless: true })
  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '320', width: 320, height: 720 },
  ]
  const pages = ['train', 'generate', 'monitor', 'queue', 'resources']

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await context.newPage()

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    for (const p of pages) {
      await page.goto('http://127.0.0.1:5173/#/' + p, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      const ok = scrollWidth <= clientWidth
      console.log(`[${vp.name}x${vp.height}] #/${p} -> scrollWidth: ${scrollWidth}, clientWidth: ${clientWidth}, overflow-free: ${ok}`)

      if (p === 'train' && vp.name === '1440') {
        await page.screenshot({ path: 'C:/Users/56376/AppData/Local/Temp/opencode/playwright-mcp/desktop-train.png', fullPage: false })
      }
      if (p === 'train' && vp.name === '390') {
        await page.screenshot({ path: 'C:/Users/56376/AppData/Local/Temp/opencode/playwright-mcp/mobile-train.png', fullPage: false })
      }
      if (p === 'generate' && vp.name === '1440') {
        await page.screenshot({ path: 'C:/Users/56376/AppData/Local/Temp/opencode/playwright-mcp/desktop-generate.png', fullPage: false })
      }
      if (p === 'monitor' && vp.name === '1440') {
        await page.screenshot({ path: 'C:/Users/56376/AppData/Local/Temp/opencode/playwright-mcp/desktop-monitor.png', fullPage: false })
      }
    }
    if (errors.length) {
      console.error('JS Errors found:', errors)
    } else {
      console.log(`[${vp.name}] No JavaScript runtime errors.`)
    }
    await context.close()
  }
  await browser.close()
}

void run()
