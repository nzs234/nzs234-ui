import http from 'http';
import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9222;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findOverflow() {
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
  const wsUrl = pages[0].webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
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

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 390,
    screenHeight: 844
  });

  // Navigate to #/train first then #/generate
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/#/train' });
  await sleep(800);
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/#/generate' });
  await sleep(1200);

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const docW = document.documentElement.clientWidth;
      const elements = Array.from(document.querySelectorAll('*'));
      const overflowing = [];
      for (const el of elements) {
        if (el.scrollWidth > 390 || el.offsetWidth > 390 || el.getBoundingClientRect().right > 390 + 1) {
          overflowing.push({
            tag: el.tagName,
            id: el.id,
            className: typeof el.className === 'string' ? el.className : '',
            scrollW: el.scrollWidth,
            offsetW: el.offsetWidth,
            clientW: el.clientWidth,
            rectRight: Math.round(el.getBoundingClientRect().right),
            rectWidth: Math.round(el.getBoundingClientRect().width),
            outerHTMLSnippet: el.outerHTML.slice(0, 100)
          });
        }
      }
      return { docW, count: overflowing.length, overflowing };
    })()`,
    returnByValue: true
  });

  console.log('Overflowing nodes on generate 390x844:', JSON.stringify(evalRes.result?.value, null, 2));

  ws.close();
  chromeProcess.kill();
}

findOverflow();
