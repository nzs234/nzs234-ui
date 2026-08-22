import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9222;
const SCREENSHOT_DIR = 'C:\\Users\\56376\\AppData\\Local\\Temp\\opencode\\ui-remediation-final';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank'
  ]);
  await sleep(1500);

  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const pages = await res.json();
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const curId = id++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '320', width: 320, height: 720 },
  ];
  const pagesList = ['train', 'generate', 'monitor', 'queue', 'resources'];

  console.log('=== VERIFYING VIEWPORTS & OVERFLOWS ===');
  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.width < 600 });
    for (const p of pagesList) {
      await send('Page.navigate', { url: `http://127.0.0.1:5173/#/${p}` });
      await sleep(400);

      const evalRes = await send('Runtime.evaluate', {
        expression: `({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth
        })`,
        returnByValue: true
      });

      const { sw, cw } = evalRes.result.value;
      const ok = sw <= cw + 1;
      console.log(`[${vp.name}] /${p} -> scrollWidth: ${sw}, clientWidth: ${cw}, overflow-free: ${ok}`);

      // Take screenshot
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${vp.name}-${p}.png`), Buffer.from(shot.data, 'base64'));
    }
  }

  // Verify @320 generate region canvas specifically
  console.log('\n=== VERIFYING GENERATE @320 REGION ROW SECONDARY ===');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/generate` });
  await sleep(400);

  const regCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const rows = Array.from(document.querySelectorAll('.lx-region-row'));
      const sec = Array.from(document.querySelectorAll('.lx-region-row__secondary'));
      const boxes = Array.from(document.querySelectorAll('.lx-region-row__box'));
      return {
        rows: rows.map(r => ({ sw: r.scrollWidth, cw: r.clientWidth, right: Math.round(r.getBoundingClientRect().right) })),
        sec: sec.map(s => ({ sw: s.scrollWidth, cw: s.clientWidth, right: Math.round(s.getBoundingClientRect().right) })),
        boxes: boxes.map(b => ({ sw: b.scrollWidth, cw: b.clientWidth, right: Math.round(b.getBoundingClientRect().right) }))
      };
    })()`,
    returnByValue: true
  });
  console.log('Generate @320 Region rows check:', JSON.stringify(regCheck.result.value, null, 2));

  // Contrast check
  console.log('\n=== VERIFYING CONTRAST RATIO ACROSS THEMES ===');
  const themes = ['editorial', 'acid', 'glass'];

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of themes) {
    for (const p of pagesList) {
      await send('Page.navigate', { url: `http://127.0.0.1:5173/#/${p}` });
      await sleep(200);
      await send('Runtime.evaluate', {
        expression: `document.documentElement.setAttribute('data-theme', '${theme}');`
      });
      await sleep(200);

      const contrastRes = await send('Runtime.evaluate', {
        expression: `(() => {
          function parseRgb(str) {
            const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
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
        })()`,
        returnByValue: true
      });
      console.log(`[Theme: ${theme}] /${p} Contrast Non-large Fails: ${contrastRes.result.value}`);
    }
  }

  ws.close();
  chromeProcess.kill();
}

main().catch(console.error);
