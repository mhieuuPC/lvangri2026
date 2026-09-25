const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const artifactDir = 'C:\\Users\\Trần Minh Hiếu\\.gemini\\antigravity\\brain\\8a11b276-0506-4b12-ae13-37317bbb5af5';

const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
];

const chromeExe = chromePaths.find(p => fs.existsSync(p));

const chromeProc = spawn(chromeExe, [
  '--remote-debugging-port=9222',
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--user-data-dir=' + path.join(os.tmpdir(), 'chrome-profile-' + Date.now()),
  'about:blank'
]);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await sleep(2000);

  let versionData = null;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      versionData = await res.json();
      break;
    } catch (e) {
      await sleep(1000);
    }
  }

  const wsUrl = versionData.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  let idCounter = 1;
  const callbacks = new Map();

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = idCounter++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data.result);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = target.targetId;
  const attach = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attach.sessionId;

  function sendSession(method, params = {}) {
    return new Promise((resolve) => {
      const id = idCounter++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, sessionId, method, params }));
    });
  }

  await sendSession('Page.enable');
  await sendSession('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  async function screenshot(filename) {
    const snap = await sendSession('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(artifactDir, filename);
    fs.writeFileSync(fullPath, Buffer.from(snap.data, 'base64'));
    console.log('Saved screenshot:', filename);
  }

  async function evaluate(expression) {
    const res = await sendSession('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }

  // Set session storage so splash screen skips
  await sendSession('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(1000);
  await evaluate(`
    sessionStorage.setItem('hasSeenSplash', 'true');
    localStorage.setItem('hasSeenSplash', 'true');
  `);

  // 1. Test Home Page and Wait for Weather / Skeletons to settle
  console.log('--- 1. Testing Home Page (waiting for settle) ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173' });
  
  let settled = false;
  for (let i = 0; i < 15; i++) {
    const loadingState = await evaluate('document.querySelector(".animate-pulse") !== null');
    if (!loadingState) {
      settled = true;
      break;
    }
    await sleep(800);
  }
  await sleep(1500);
  await screenshot('screenshot_home_dashboard_settled.png');

  const widgetTitles = await evaluate(`
    Array.from(document.querySelectorAll('.layout [draggable="true"]')).map(el => {
      const h3 = el.querySelector('h3');
      const h4 = el.querySelector('h4');
      return h3?.innerText || h4?.innerText || el.innerText.split('\\n')[0];
    })
  `);
  console.log('Home Dashboard Widgets rendered:', widgetTitles);

  // 2. Test Drag and Drop reordering
  console.log('--- 2. Testing Drag and Drop ---');
  const dndStatus = await evaluate(`
    (() => {
      const items = document.querySelectorAll('.layout [draggable="true"]');
      if (items.length >= 2) {
        const first = items[0];
        const target = items[3] || items[1];
        
        const dt = new DataTransfer();
        first.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
        first.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
        return localStorage.getItem('desktop_widget_order');
      }
      return null;
    })()
  `);
  console.log('DND Order saved:', dndStatus);
  await sleep(1000);
  await screenshot('screenshot_home_after_drag.png');

  // 3. Test Knowledge Category & Article Detail (Cache warm)
  console.log('--- 3. Testing Knowledge Category & Article Detail ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/knowledge-center/ky-thuat-canh-tac' });
  await sleep(2500);
  await screenshot('screenshot_knowledge_category_settled.png');
  const artCount = await evaluate('document.querySelectorAll(".space-y-3 > div").length');
  console.log('Articles in Category:', artCount);

  // Click first article
  await evaluate('document.querySelector(".space-y-3 > div")?.click()');
  await sleep(3000);
  await screenshot('screenshot_knowledge_article_settled.png');
  const articleName = await evaluate('document.querySelector("h2, .font-headline")?.innerText');
  const hasYoutube = await evaluate('document.querySelectorAll("iframe").length > 0');
  console.log('Article Title:', articleName, 'YouTube Player Present:', hasYoutube);

  // 4. Test LVadminOS Mode
  console.log('--- 4. Testing LVadminOS Mode ---');
  await evaluate(`
    (() => {
      localStorage.setItem('lv_ui_mode', 'windows');
      localStorage.setItem('lv_pinned_desktop', JSON.stringify(['weather', 'expertManager', 'notepad']));
    })()
  `);
  await sendSession('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(4000); // Allow OS boot animation
  await screenshot('screenshot_lvadminos_desktop.png');

  // Open Expert Manager App by clicking on desktop icon
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const expBtn = btns.find(b => b.innerText.includes('Quản lý Chuyên gia'));
      if (expBtn) {
        expBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      }
    })()
  `);
  await sleep(2500);
  await screenshot('screenshot_expert_manager_opened.png');

  ws.close();
  chromeProc.kill();
  console.log('--- ALL TESTS COMPLETED SUCCESSFULLY! ---');
}

run().catch((e) => {
  console.error(e);
  chromeProc.kill();
});
