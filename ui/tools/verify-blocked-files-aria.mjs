import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9230;

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
  await sleep(400);

  // Click Step 04 "模型文件" on the rail
  await send('Runtime.evaluate', {
    expression: `(() => {
      const stepBtns = Array.from(document.querySelectorAll('.lx-w-stepcard button'));
      const filesStep = stepBtns.find(b => b.innerText.includes('模型文件'));
      if (filesStep) filesStep.click();
    })()`
  });
  await sleep(200);

  // Click Next button to trigger validation
  await send('Runtime.evaluate', {
    expression: `(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('下一步'));
      if (nextBtn) nextBtn.click();
    })()`
  });
  await sleep(200);

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const invalidEls = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
      const requiredEls = Array.from(document.querySelectorAll('[aria-required="true"]'));
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('下一步'));
      const alertEl = document.getElementById('lx-w-step-error-alert');
      const results = invalidEls.map(el => {
        const errId = el.getAttribute('aria-errormessage');
        const targetNode = errId ? document.getElementById(errId) : null;
        return {
          tagName: el.tagName,
          id: el.id,
          ariaInvalid: el.getAttribute('aria-invalid'),
          ariaRequired: el.getAttribute('aria-required'),
          ariaErrorMessage: errId,
          targetNodeExists: Boolean(targetNode),
          targetNodeText: targetNode ? targetNode.innerText.slice(0, 100) : null
        };
      });
      return {
        invalidCount: invalidEls.length,
        requiredCount: requiredEls.length,
        nextAriaDescribedBy: nextBtn ? nextBtn.getAttribute('aria-describedby') : null,
        stepAlertExists: Boolean(alertEl),
        stepAlertText: alertEl ? alertEl.innerText.slice(0, 100) : null,
        items: results
      };
    })()`,
    returnByValue: true
  });

  console.log('Blocked Files Step ARIA status:\n', JSON.stringify(evalRes.result.value, null, 2));

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
