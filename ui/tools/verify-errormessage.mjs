import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9227;

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
  await sleep(300);

  // Walk wizard to step 4 (files) or trigger Next
  console.log('=== VERIFYING BLOCKED WIZARD STEP ARIA ERRORMESSAGE ===');
  
  // Click next button to trigger validation failure
  await send('Runtime.evaluate', {
    expression: `(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('下一步') || b.textContent.includes('Next'));
      if (nextBtn) nextBtn.click();
    })()`
  });
  await sleep(200);

  // Navigate to files step
  await send('Runtime.evaluate', {
    expression: `(() => {
      const stepBtns = Array.from(document.querySelectorAll('.lx-w-stepcard button'));
      const filesStep = stepBtns.find(b => b.textContent.includes('模型文件') || b.textContent.includes('Model files') || b.textContent.includes('files'));
      if (filesStep) filesStep.click();
    })()`
  });
  await sleep(200);

  // Click Next on files step if there's error
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
          targetNodeText: targetNode ? targetNode.innerText.slice(0, 80) : null
        };
      });
      return {
        invalidCount: invalidEls.length,
        items: results
      };
    })()`,
    returnByValue: true
  });

  console.log('Verification result in blocked step:', JSON.stringify(evalRes.result.value, null, 2));

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
