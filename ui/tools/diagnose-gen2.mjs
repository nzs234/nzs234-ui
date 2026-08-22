import http from 'http';
import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9222;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function diagnoseGenerate2() {
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

  // Step 1: #train 1440x900
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/train` });
  await sleep(800);

  // Step 2: #train 390x844
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/train` });
  await sleep(800);

  // Step 3: #train 320x720
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/train` });
  await sleep(800);

  // Step 4: #generate 1440x900
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/generate` });
  await sleep(800);

  // Step 5: #generate 390x844
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/generate` });
  await sleep(800);

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const doc = document.documentElement;
      const all = Array.from(document.querySelectorAll('*'));
      const overflowing = all
        .map(el => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            cls: (el.className || '').toString(),
            sw: el.scrollWidth,
            cw: el.clientWidth,
            rw: Math.round(r.width),
            rr: Math.round(r.right),
          };
        })
        .filter(x => x.sw > 390 || x.rr > 390);

      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        overflowing
      };
    })()`,
    returnByValue: true
  });

  console.log('Step 5 Result:', JSON.stringify(evalRes.result?.value, null, 2));

  ws.close();
  chromeProcess.kill();
}

diagnoseGenerate2();
