import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.resolve(root, 'dist');
const mode = process.argv[2] === 'after' ? 'after' : 'before';
const outDir = path.resolve(root, 'reports/screenshots', mode);

const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const server = createServer(async (req, res) => {
  try {
    const uri = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (uri === '/') { res.writeHead(302, { Location: '/mali-app/' }); res.end(); return; }
    if (!uri.startsWith('/mali-app/')) { res.writeHead(404); res.end(); return; }
    let relative = uri.slice('/mali-app/'.length);
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(filename)).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream' });
    res.end(await readFile(filename));
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(); }
});

await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const address = 'http://127.0.0.1:' + server.address().port + '/mali-app/';
const profile = await mkdtemp(path.join(tmpdir(), 'mali-visual-audit-'));

function getChromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'google-chrome',
    'chromium',
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error('Chrome or Edge executable not found');
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function protocol(ws) {
  let nextId = 0;
  const jobs = new Map();
  ws.addEventListener('message', event => {
    const p = JSON.parse(event.data);
    const item = jobs.get(p.id);
    if (!item) return;
    jobs.delete(p.id);
    if (p.error) item.reject(new Error(p.error.message));
    else item.resolve(p.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    jobs.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function until(fn, description, timeout = 35000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
    await wait(250);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function evaluate(call, expression) {
  const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) {
    throw new Error('Eval error: ' + (reply.exceptionDetails.exception?.description || reply.exceptionDetails.text));
  }
  return reply.result?.value;
}

const DEVICES = [
  { name: 'small-phone-720x1600', width: 360, height: 800, dpr: 2.0 },
  { name: 'medium-phone-1080x2400', width: 412, height: 914, dpr: 2.625 },
  { name: 'large-phone-1440x3200', width: 432, height: 960, dpr: 3.33 },
  { name: 'tablet-1600x2560', width: 800, height: 1280, dpr: 2.0 },
];

let child;
let ws;

try {
  const chromePath = getChromePath();
  child = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  const port = await until(async () => {
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    } catch {
      if (child.exitCode !== null) throw new Error('Chrome exited early');
      return null;
    }
  }, 'DevTools port');

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Valid page debugger URL required');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const call = protocol(ws);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('DOM.enable');

  console.log(`Starting visual audit capture (${mode.toUpperCase()}) across 4 Android device categories...`);

  for (const dev of DEVICES) {
    console.log(`\n=== Testing Device: ${dev.name} (${dev.width}x${dev.height} @ ${dev.dpr}x) ===`);
    await call('Emulation.setDeviceMetricsOverride', {
      width: dev.width,
      height: dev.height,
      deviceScaleFactor: dev.dpr,
      mobile: true,
      fitWindow: false,
    });

    // 1. Capture Auth Screen
    await call('Page.navigate', { url: address });
    await until(() => evaluate(call, "document.readyState === 'complete' && document.body && document.body.innerText.trim().length > 10"), 'Auth Screen mount');
    await wait(800);

    let screenshot = await call('Page.captureScreenshot', { format: 'png' });
    let filename = `${dev.name}_01_auth_login.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Click Register tab
    await evaluate(call, `(() => {
      const tabs = [...document.querySelectorAll('div,span,button')].filter(el => (el.textContent||'').trim() === 'إنشاء حساب جديد');
      if (tabs.length) (tabs[0].closest('button,[role=button]') || tabs[0]).click();
    })()`);
    await wait(400);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_01b_auth_register.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Enter guest session into vault
    await evaluate(call, `(() => {
      const entry = [...document.querySelectorAll('div,span,button,a')].find(el => !el.children.length && (el.textContent || '').trim().includes('الدخول السريع'));
      if (entry) (entry.closest('button,[role=button],[tabindex]') || entry.parentElement).click();
    })()`);

    await until(() => evaluate(call, "!document.body.innerText.includes('الدخول السريع') && document.body.innerText.includes('مالي')"), 'Vault Dashboard mount');
    await wait(800);

    // 2. Capture Dashboard
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_02_dashboard.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // 3. Navigate to Expenses & Accounts
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],a,div')].find(el => (el.textContent||'').trim() === 'المصاريف والحسابات');
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_03_expenses.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Click Subnav: 'خزائني وحساباتي'
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],div,span')].find(el => (el.textContent||'').trim().includes('خزائني وحساباتي'));
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_04_accounts.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // 4. Navigate to USD Deals
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],a,div')].find(el => (el.textContent||'').trim() === 'تداول الدولار');
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_05_usd_deals.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // 5. Navigate to Contacts & Relations
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],a,div')].find(el => (el.textContent||'').trim() === 'المتعاملون والديون');
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_06_contacts.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Click Subnav: 'الديون والإجراءات'
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],div,span')].find(el => (el.textContent||'').trim().includes('الديون والإجراءات'));
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_07_debts_procedures.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Open Unified Financial Profile Modal from Contacts
    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button],div,span')].find(el => (el.textContent||'').trim().includes('دليل المتعاملين'));
      if (btn) (btn.closest('button,[role=button]') || btn).click();
    })()`);
    await wait(400);

    await evaluate(call, `(() => {
      const btn = [...document.querySelectorAll('button,[role=button]')].find(el => (el.textContent||'').trim().includes('الملف المالي'));
      if (btn) btn.click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_08_unified_contact_profile_modal.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);

    // Close Profile Modal
    await evaluate(call, `(() => {
      const closeBtn = document.querySelector('[aria-label="إغلاق الملف المالي"]');
      if (closeBtn) closeBtn.click();
    })()`);
    await wait(400);

    // Open Cloud & Export Modal
    await evaluate(call, `(() => {
      const cloudBtn = document.querySelector('[aria-label="السحابة والتصدير"]');
      if (cloudBtn) cloudBtn.click();
    })()`);
    await wait(600);
    screenshot = await call('Page.captureScreenshot', { format: 'png' });
    filename = `${dev.name}_09_cloud_export_modal.png`;
    await writeFile(path.join(outDir, filename), Buffer.from(screenshot.data, 'base64'));
    console.log(`  Saved: ${filename}`);
  }

  console.log(`\nVisual audit capture for ${mode.toUpperCase()} completed successfully! All screenshots saved in ${outDir}.`);
} finally {
  try { ws?.close(); } catch {}
  try { child?.kill('SIGTERM'); } catch {}
  await new Promise(r => server.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 4 });
}
