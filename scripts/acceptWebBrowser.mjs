// Real Chromium acceptance, no production connections or credentials.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.resolve(root, 'dist');
const source = await readFile(path.resolve(root, 'src/services/webFinancialStorageBackend.ts'), 'utf8');
const probe = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const server = createServer(async (req, res) => {
  try {
    const uri = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (uri === '/') { res.writeHead(302, { Location: '/mali-app/' }); res.end(); return; }
    if (uri === '/mali-app/__storage_probe.mjs') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end(probe); return;
    }
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
const profile = await mkdtemp(path.join(tmpdir(), 'mali-chrome-'));
let child;
let websocket;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function chromeExecutable() {
  for (const name of [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (!name) continue;
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch {
      if (path.isAbsolute(name)) return name;
    }
  }
  throw Error('Real Chrome browser required for browser acceptance');
}
function protocol(ws) {
  let nextId = 0;
  const jobs = new Map();
  ws.addEventListener('message', event => {
    const p = JSON.parse(event.data);
    const item = jobs.get(p.id);
    if (!item) return;
    jobs.delete(p.id);
    p.error ? item.reject(Error(p.error.message)) : item.resolve(p.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    jobs.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(call, expression) {
  const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) throw Error('Browser eval error: ' + (
    reply.exceptionDetails.exception?.description || reply.exceptionDetails.text));
  return reply.result?.value;
}
async function until(fn, description, timeout = 35000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await fn();
    if (result) return result;
    await wait(250);
  }
  throw Error('Timed out waiting for ' + description);
}
async function storageProbe() {
  const {createWebFinancialStorageBackend} = await import('/mali-app/__storage_probe.mjs');
  const legacy = {
    getItem: async key => localStorage.getItem(key),
    setItem: async (key, value) => localStorage.setItem(key, value),
    removeItem: async key => localStorage.removeItem(key),
    getAllKeys: async () => Object.keys(localStorage),
  };
  const key = '@mali_app_state_v2_browser_acceptance';
  localStorage.setItem(key, 'legacy-value');
  const db = createWebFinancialStorageBackend({ dbName: 'mali_chrome_acceptance_v1', legacyStorage: legacy });
  const migrated = await db.getItem(key);
  if (migrated !== 'legacy-value' || localStorage.getItem(key) !== null) throw Error('Legacy migration failed');
  const sizes = [];
  for (const count of [1000, 10000, 50000]) {
    const json = JSON.stringify({
      ownerId: 'isolated-browser-acceptance',
      transactions: Array.from({length: count}, (_, i) => ({
        id: 'tx-' + i, type: i % 2 ? 'expense' : 'income',
        amount: 25.5, currency: 'LYD', title: 'حركة مالية ' + i,
        accountId: 'cash', category: 'تشغيل', date: '2026-10-13',
      })),
    });
    await db.setItem(key, json);
    const saved = await db.getItem(key);
    if (saved !== json || JSON.parse(saved).transactions.length !== count) throw Error('Large vault corruption: ' + count);
    sizes.push({ count, bytes: new TextEncoder().encode(json).length });
  }
  let rejected = false;
  try { await db.setItem(key, undefined); } catch { rejected = true; }
  if (!rejected || JSON.parse(await db.getItem(key)).transactions.length !== 50000)
    throw Error('Rejected write destroyed last successful version');
  return { sizes };
}
async function reloadProbe() {
  const {createWebFinancialStorageBackend} = await import('/mali-app/__storage_probe.mjs');
  const db = createWebFinancialStorageBackend({
    dbName: 'mali_chrome_acceptance_v1',
    legacyStorage: {
      getItem: async key => localStorage.getItem(key),
      removeItem: async key => localStorage.removeItem(key),
      getAllKeys: async () => Object.keys(localStorage),
    },
  });
  const json = await db.getItem('@mali_app_state_v2_browser_acceptance');
  return { count: JSON.parse(json).transactions.length,
    legacyPresent: localStorage.getItem('@mali_app_state_v2_browser_acceptance') !== null };
}
try {
  child = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });
  const port = await until(async () => {
    try { return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { if (child.exitCode !== null) throw Error('Chrome exited before DevTools started'); return null; }
  }, 'DevTools listening port');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome must expose a real page');
  websocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    websocket.addEventListener('open', resolve, { once: true });
    websocket.addEventListener('error', reject, { once: true });
  });
  const call = protocol(websocket);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url: address });
  await until(() => evaluate(call,
    "document.readyState === 'complete' && document.body && document.body.innerText.trim().length > 10"),
  'Mali actual web UI mount');
  console.log('PASS real Chromium renders Mali web app', await evaluate(call, 'document.title'));
  const result = await evaluate(call, '(' + storageProbe.toString() + ')()');
  assert.deepEqual(result.sizes.map(x => x.count), [1000, 10000, 50000]);
  console.log('PASS real Chrome IndexedDB migrated legacy and persisted 1k/10k/50k entries', result.sizes);
  await call('Page.reload', { ignoreCache: true });
  await until(() => evaluate(call, "document.readyState === 'complete'"), 'browser full reload');
  assert.deepEqual(await evaluate(call, '(' + reloadProbe.toString() + ')()'),
    { count: 50000, legacyPresent: false });
  console.log('PASS all 50000 financial records survive browser reload');
} finally {
  try { websocket?.close(); } catch {}
  try { child?.kill('SIGTERM'); } catch {}
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 4 });
}
