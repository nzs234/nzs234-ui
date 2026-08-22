import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9225;

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
    const timer = setTimeout(() => reject(new Error('timeout method ' + method)), 4000);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const themes = ['editorial', 'acid', 'glass'];
  const pagesList = ['train', 'generate', 'monitor', 'queue', 'resources'];

  for (const theme of themes) {
    for (const p of pagesList) {
      await send('Page.navigate', { url: `http://127.0.0.1:5173/#/${p}` });
      await sleep(150);
      await send('Runtime.evaluate', {
        expression: `document.documentElement.setAttribute('data-theme', '${theme}');`
      });
      await sleep(60);

      const contrastDetail = await send('Runtime.evaluate', {
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

          const elements = Array.from(document.querySelectorAll('*'));
          const failures = [];
          for (const el of elements) {
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'SVG' || el.tagName === 'PATH') continue;
            // check direct text children or leaf text
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
            const fontSize = parseFloat(style.fontSize);
            const isLarge = fontSize >= 18 || (fontSize >= 14 && (style.fontWeight >= '700' || style.fontWeight === 'bold'));
            const threshold = isLarge ? 3.0 : 4.5;
            if (ratio < threshold) {
              failures.push({
                tag: el.tagName,
                cls: el.className,
                text: directText.slice(0, 30),
                color: style.color,
                bg: bgColor ? 'rgb(' + bgColor.join(',') + ')' : 'none',
                ratio: ratio.toFixed(2),
                threshold
              });
            }
          }
          return failures;
        })()`,
        returnByValue: true
      });
      const fails = contrastDetail.result.value;
      console.log(`[${theme}][/${p}] Fails count: ${fails.length}`);
      if (fails.length > 0) {
        console.log(`  Samples for [${theme}][/${p}]:`, JSON.stringify(fails.slice(0, 6), null, 2));
      }
    }
  }

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
