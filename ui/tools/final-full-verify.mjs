import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9226;
const SCREENSHOT_DIR = 'C:\\Users\\56376\\AppData\\Local\\Temp\\opencode\\ui-final-fixes';

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
    '--disable-extensions',
    'about:blank'
  ]);
  await sleep(1000);

  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const pages = await res.json();
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const curId = id++;
    const timer = setTimeout(() => reject(new Error('timeout method ' + method)), 5000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        clearTimeout(timer);
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

  const themes = ['editorial', 'acid', 'glass'];
  const pagesList = ['train', 'generate', 'monitor', 'queue', 'resources'];

  console.log('=== 1. CONTRAST VERIFICATION ACROSS THEMES ===');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of themes) {
    for (const p of pagesList) {
      await send('Page.navigate', { url: `http://127.0.0.1:5173/#/${p}` });
      await sleep(100);
      await send('Runtime.evaluate', {
        expression: `document.documentElement.setAttribute('data-theme', '${theme}');`
      });
      await sleep(50);

      const contrastCheck = await send('Runtime.evaluate', {
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

          let minRatio = 999;
          let fails = 0;
          const elements = Array.from(document.querySelectorAll('*'));
          for (const el of elements) {
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'SVG' || el.tagName === 'PATH') continue;
            const directText = Array.from(el.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .join(' ');
            if (!directText) continue;

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            const color = parseRgb(style.color);
            if (!color) continue;

            let bgEl = el;
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
            if (ratio < minRatio) minRatio = ratio;
            const fontSize = parseFloat(style.fontSize);
            const isLarge = fontSize >= 18 || (fontSize >= 14 && (style.fontWeight >= '700' || style.fontWeight === 'bold'));
            const threshold = isLarge ? 3.0 : 4.5;
            if (ratio < threshold) {
              fails++;
            }
          }
          return { fails, minRatio: Number(minRatio.toFixed(2)) };
        })()`,
        returnByValue: true
      });
      console.log(`[Theme: ${theme}] /${p} -> Failures: ${contrastCheck.result.value.fails}, MinRatio: ${contrastCheck.result.value.minRatio}`);
    }
  }

  console.log('\n=== 2. WIZARD STEP ARIA VERIFICATION ===');
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/train` });
  await sleep(200);
  const ariaRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const required = document.querySelectorAll('[aria-required="true"]').length;
      const invalid = document.querySelectorAll('[aria-invalid="true"]').length;
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('下一步') || b.textContent.includes('Next'));
      const describedBy = nextBtn ? nextBtn.getAttribute('aria-describedby') : null;
      return { required, invalid, nextDescribedBy: describedBy };
    })()`,
    returnByValue: true
  });
  console.log('Train Wizard ARIA info:', JSON.stringify(ariaRes.result.value, null, 2));

  console.log('\n=== 3. EN CJK CHECK ACROSS 5 PAGES ===');
  for (const p of pagesList) {
    await send('Page.navigate', { url: `http://127.0.0.1:5173/#/${p}` });
    await sleep(100);
    await send('Runtime.evaluate', {
      expression: `localStorage.setItem('lulynx_lang', 'en'); window.location.reload();`
    });
    await sleep(200);

    const cjkCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        // CJK character regex
        const matches = text.match(/[\\u4e00-\\u9fa5]/g) || [];
        return { cjkCount: matches.length, sample: matches.slice(0, 10).join('') };
      })()`,
      returnByValue: true
    });
    console.log(`[EN] /${p} -> CJK Count: ${cjkCheck.result.value.cjkCount}, Samples: "${cjkCheck.result.value.sample}"`);
  }

  console.log('\n=== 4. QUEUE @320 OVERFLOW CHECK ===');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/queue` });
  await sleep(150);

  const queue320 = await send('Runtime.evaluate', {
    expression: `(() => {
      const filters = document.querySelector('.lx-queue-filters') || document.querySelector('.lx-panel-head');
      const sw = filters ? filters.scrollWidth : 0;
      const cw = filters ? filters.clientWidth : 0;
      const docSw = document.documentElement.scrollWidth;
      const docCw = document.documentElement.clientWidth;
      return { filtersSw: sw, filtersCw: cw, docSw, docCw, overflowFree: docSw <= docCw };
    })()`,
    returnByValue: true
  });
  console.log('Queue @320:', JSON.stringify(queue320.result.value, null, 2));

  console.log('\n=== 5. LX-SPIN KEYFRAMES CHECK ===');
  const spinCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const div = document.createElement('div');
      div.className = 'lx-spin';
      document.body.appendChild(div);
      const computed = window.getComputedStyle(div);
      const animName = computed.animationName;
      document.body.removeChild(div);
      return { animName };
    })()`,
    returnByValue: true
  });
  console.log('lx-spin animation:', spinCheck.result.value);

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
