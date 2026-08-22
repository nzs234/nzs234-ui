import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'C:\\Users\\56376\\AppData\\Local\\Temp\\opencode\\ui-remediation-final';
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '320', width: 320, height: 720 },
  ];
  const pages = ['train', 'generate', 'monitor', 'queue', 'resources'];
  const themes = ['editorial', 'acid', 'glass'];

  console.log('=== VERIFYING VIEWPORTS & OVERFLOWS ===');
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    for (const p of pages) {
      await page.goto('http://127.0.0.1:5173/#/' + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const ok = scrollWidth <= clientWidth + 1;
      console.log(`[${vp.name}] /${p} -> scrollWidth: ${scrollWidth}, clientWidth: ${clientWidth}, overflow-free: ${ok}`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${vp.name}-${p}.png`), fullPage: false });
    }

    if (vp.name === '320') {
      await page.goto('http://127.0.0.1:5173/#/generate', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const regionStats = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.lx-region-row'));
        const sec = Array.from(document.querySelectorAll('.lx-region-row__secondary'));
        const boxes = Array.from(document.querySelectorAll('.lx-region-row__box'));
        return {
          rows: rows.map(r => ({ sw: r.scrollWidth, cw: r.clientWidth, right: Math.round(r.getBoundingClientRect().right) })),
          sec: sec.map(s => ({ sw: s.scrollWidth, cw: s.clientWidth, right: Math.round(s.getBoundingClientRect().right) })),
          boxes: boxes.map(b => ({ sw: b.scrollWidth, cw: b.clientWidth, right: Math.round(b.getBoundingClientRect().right) }))
        };
      });
      console.log('Generate @320 Region rows check:', regionStats);
    }
    await context.close();
  }

  console.log('\n=== VERIFYING CONTRAST RATIO ACROSS THEMES ===');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  for (const theme of themes) {
    for (const p of pages) {
      await page.goto('http://127.0.0.1:5173/#/' + p, { waitUntil: 'networkidle' });
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme);
      await page.waitForTimeout(200);

      const failCount = await page.evaluate(() => {
        function parseRgb(str) {
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
        }
        function getLuminance(r, g, b) {
          const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
        }
        function getRatio(c1, c2) {
          const l1 = getLuminance(...c1);
          const l2 = getLuminance(...c2);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        let fails = 0;
        while (node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;
          const text = node.textContent.trim();
          if (!text) continue;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const color = parseRgb(style.color);
          if (!color) continue;

          let bgEl = parent;
          let bgColor = null;
          while (bgEl) {
            const bgStyle = window.getComputedStyle(bgEl);
            const parsed = parseRgb(bgStyle.backgroundColor);
            if (parsed && (bgStyle.backgroundColor.indexOf('rgba') === -1 || bgStyle.backgroundColor.indexOf(', 0)') === -1)) {
              bgColor = parsed;
              break;
            }
            bgEl = bgEl.parentElement;
          }
          if (!bgColor) bgColor = document.documentElement.getAttribute('data-theme') === 'editorial' ? [245, 244, 240] : [13, 17, 23];

          const ratio = getRatio(color, bgColor);
          const fontSize = parseFloat(style.fontSize);
          const isLarge = fontSize >= 18 || (fontSize >= 14 && (style.fontWeight >= '700' || style.fontWeight === 'bold'));
          const threshold = isLarge ? 3.0 : 4.5;
          if (ratio < threshold) {
            fails++;
          }
        }
        return fails;
      });

      console.log(`[Theme: ${theme}] /${p} Contrast Non-large Fails: ${failCount}`);
    }
  }

  await context.close();
  await browser.close();
}

run().catch(console.error);
