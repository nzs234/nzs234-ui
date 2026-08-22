import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9229;

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
  const targetPage = pages.find(p => p.type === 'page') || pages[0];
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `http://127.0.0.1:5173/` });
  await sleep(1000);

  const stateRes = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        url: window.location.href,
        h1: document.querySelector('h1')?.innerText,
        cards: Array.from(document.querySelectorAll('.lx-w-choice-card, .lx-btn, button')).map(b => b.innerText.trim()).filter(Boolean)
      };
    })()`,
    returnByValue: true
  });
  console.log('Initial state:', JSON.stringify(stateRes.result.value, null, 2));

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
