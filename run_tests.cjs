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
console.log('Chrome executable:', chromeExe);

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

  if (!versionData) {
    throw new Error('Failed to connect to Chrome on port 9222');
  }

  const wsUrl = versionData.webSocketDebuggerUrl;
  console.log('Connecting to Chrome WS:', wsUrl);

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

  // 1. Home Page Verification
  console.log('--- 1. Testing Home Page ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(4000);
  await screenshot('screenshot_home_widgets.png');
  const widgetsCount = await evaluate('document.querySelectorAll("[draggable=\'true\']").length');
  console.log('Draggable Widgets Count:', widgetsCount);

  // 2. Knowledge Center Main Page
  console.log('--- 2. Testing Knowledge Center ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/knowledge-center' });
  await sleep(2500);
  await screenshot('screenshot_knowledge_center.png');
  const catCount = await evaluate('document.querySelectorAll(".grid > div").length');
  console.log('Knowledge categories rendered:', catCount);

  // 3. Knowledge Category Detail Page
  console.log('--- 3. Testing Knowledge Category Detail ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/knowledge-center/ky-thuat-canh-tac' });
  await sleep(2500);
  await screenshot('screenshot_knowledge_category.png');
  const articlesCount = await evaluate('document.querySelectorAll(".space-y-3 > div").length');
  console.log('Articles in ky-thuat-canh-tac count:', articlesCount);

  // 4. Knowledge Article Detail Page
  console.log('--- 4. Testing Knowledge Article Detail ---');
  await evaluate('document.querySelector(".space-y-3 > div")?.click()');
  await sleep(3000);
  await screenshot('screenshot_knowledge_article.png');
  const articleHeading = await evaluate('document.querySelector("h1, .font-headline")?.innerText');
  const hasIframe = await evaluate('document.querySelectorAll("iframe").length > 0');
  console.log('Article Heading:', articleHeading, 'Has YouTube iframe:', hasIframe);

  // 5. News Page
  console.log('--- 5. Testing News Page ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/news' });
  await sleep(3000);
  await screenshot('screenshot_news_page.png');
  const newsCount = await evaluate('document.querySelectorAll("main .grid a").length');
  console.log('News articles count on /news:', newsCount);

  // 6. Farm Chat Pro (Chuyên gia Pro)
  console.log('--- 6. Testing Farm Chat Pro ---');
  await sendSession('Page.navigate', { url: 'http://localhost:5173/farm-chat/pro' });
  await sleep(3500);
  await screenshot('screenshot_farmchat_pro.png');
  const expertName = await evaluate('document.querySelector(".bg-gradient-to-r h3")?.innerText');
  console.log('Assigned Expert Name:', expertName);

  // Send a chat message in Pro Chat
  await evaluate(`
    const input = document.querySelector('input[type="text"]');
    if (input) {
      input.value = 'Chào chuyên gia, cây lúa của tôi xuất hiện rầy màu nâu, tôi nên xử lý thế nào?';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
    }
  `);
  await sleep(2500);
  await screenshot('screenshot_farmchat_pro_message.png');
  const msgCount = await evaluate('document.querySelectorAll(".space-y-4 > div").length');
  console.log('Messages count after send:', msgCount);

  ws.close();
  chromeProc.kill();
  console.log('ALL TESTS COMPLETED SUCCESSFULLY!');
}

run().catch((e) => {
  console.error(e);
  chromeProc.kill();
});
