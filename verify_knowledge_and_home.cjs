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

  // 1. Test Knowledge Category & Article Detail
  console.log('--- 1. Testing Knowledge Category & Article Detail ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/knowledge-center/ky-thuat-canh-tac' });
  await sleep(2000);
  await screenshot('screenshot_knowledge_category_loaded.png');
  const articlesCount = await evaluate('document.querySelectorAll(".space-y-3 > div").length');
  console.log('Articles rendered in ky-thuat-canh-tac:', articlesCount);

  // Click first article
  await evaluate('document.querySelector(".space-y-3 > div")?.click()');
  await sleep(2500);
  await screenshot('screenshot_knowledge_article_loaded.png');
  const articleTitle = await evaluate('document.querySelector("h2, .font-headline")?.innerText');
  const hasIframe = await evaluate('document.querySelectorAll("iframe").length > 0');
  console.log('Loaded Article Title:', articleTitle, 'Has YouTube iframe:', hasIframe);

  // 2. Test Home Desktop Dashboard with Widgets & Drag Drop
  console.log('--- 2. Testing Home Desktop Dashboard ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173' });
  // Wait until loading skeletons disappear
  for (let i = 0; i < 10; i++) {
    const hasSkeletons = await evaluate('document.querySelectorAll(".animate-pulse").length > 4');
    if (!hasSkeletons) break;
    await sleep(1000);
  }
  await sleep(2000);
  await screenshot('screenshot_desktop_dashboard_loaded.png');

  const draggableWidgets = await evaluate(`
    Array.from(document.querySelectorAll("[draggable='true']")).map(el => el.innerText.split('\\n')[0])
  `);
  console.log('Draggable Widgets on Dashboard:', draggableWidgets);

  // Test Drag and Drop: simulate dragging widget 0 onto widget 2
  const dndResult = await evaluate(`
    (() => {
      const items = document.querySelectorAll("[draggable='true']");
      if (items.length >= 2) {
        const source = items[0];
        const target = items[2];
        const dt = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
        return localStorage.getItem('desktop_widget_order');
      }
      return null;
    })()
  `);
  console.log('Reordered widgets in localStorage:', dndResult);
  await sleep(1000);
  await screenshot('screenshot_desktop_reordered.png');

  // 3. Test OS Mode & Expert Manager App
  console.log('--- 3. Testing LVadminOS Mode & Expert Manager ---');
  await evaluate(`
    (() => {
      localStorage.setItem('lv_ui_mode', 'windows');
      localStorage.setItem('lv_pinned_desktop', JSON.stringify(['notepad', 'weather', 'expertManager']));
      window.location.reload();
    })()
  `);
  await sleep(4000);
  await screenshot('screenshot_os_mode.png');

  // Double click Expert Manager icon on desktop
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const expBtn = btns.find(b => b.innerText.includes('Quản lý Chuyên gia'));
      if (expBtn) {
        expBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      }
    })()
  `);
  await sleep(3000);
  await screenshot('screenshot_expert_manager_window.png');

  const expWinTitle = await evaluate(`
    document.querySelector('.window-titlebar')?.innerText
  `);
  console.log('Opened Window Title:', expWinTitle);

  ws.close();
  chromeProc.kill();
  console.log('ALL PHASE 2 VERIFICATIONS FINISHED!');
}

run().catch((e) => {
  console.error(e);
  chromeProc.kill();
});
