import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9228;

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `http://127.0.0.1:5173/#/train` });
  await sleep(400);

  // 1. Select LoRA category card
  await send('Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('.lx-w-choice-card'));
      if (cards.length > 0) cards[0].click();
    })()`
  });
  await sleep(200);

  // 2. Select Model type card
  await send('Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('.lx-w-choice-card'));
      if (cards.length > 0) cards[0].click();
    })()`
  });
  await sleep(200);

  // 3. Adapter step -> Next
  await send('Runtime.evaluate', {
    expression: `(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('下一步') || b.textContent.includes('Next'));
      if (nextBtn) nextBtn.click();
    })()`
  });
  await sleep(200);

  // 4. Now at Files step (pretrained_model_name_or_path is empty) -> click Next to trigger validation error
  await send('Runtime.evaluate', {
    expression: `(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('下一步') || b.textContent.includes('Next'));
      if (nextBtn) nextBtn.click();
    })()`
  });
  await sleep(200);

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const invalidEls = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
      const requiredEls = Array.from(document.querySelectorAll('[aria-required="true"]'));
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('下一步') || b.textContent.includes('Next'));
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
