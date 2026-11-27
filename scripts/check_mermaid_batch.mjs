#!/usr/bin/env node
// 批量 Mermaid 语法解析：输入 [{id, source}] JSON，输出失败清单。
// 用法: node check_mermaid_batch.mjs <sources.json> [--json-out result.json]
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , input, ...rest] = process.argv;
if (!input) {
  console.error('用法: node check_mermaid_batch.mjs <sources.json> [--json-out result.json]');
  process.exit(2);
}
const jsonOutIdx = rest.indexOf('--json-out');
const jsonOut = jsonOutIdx >= 0 ? rest[jsonOutIdx + 1] : null;
const sources = JSON.parse(await readFile(input, 'utf8'));
const mermaidSrc = pathToFileURL(path.join(HERE, 'vendor', 'mermaid.min.js')).href;
const payload = JSON.stringify(sources).replace(/<\/script/gi, '<\\/script');
const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>batch</title>
<script src="${mermaidSrc}"></script></head><body>
<script>
mermaid.initialize({ startOnLoad: false, theme: 'default' });
(async () => {
  const srcs = ${payload};
  const results = [];
  for (const item of srcs) {
    try {
      await mermaid.parse(item.source);
      results.push({ id: item.id, ok: true });
    } catch (err) {
      results.push({ id: item.id, ok: false, error: String(err && err.message ? err.message : err).slice(0, 400) });
    }
  }
  window.__results = results;
  window.__done = true;
})();
</script></body></html>`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
async function findChrome() { for (const p of CHROME_CANDIDATES) { try { await access(p); return p; } catch {} } return null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); });
    this.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const p = { id, method, params }; if (sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p)); return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  close() { try { this.ws.close(); } catch {} }
}

const chromePath = await findChrome();
if (!chromePath) { console.error('未找到 Chrome/Chromium/Edge'); process.exit(4); }
const userDataDir = await mkdtemp(path.join(tmpdir(), 'shenti-mermaid-'));
const htmlPath = path.join(userDataDir, 'batch.html');
await writeFile(htmlPath, html);
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let browser;
try {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let content = null;
  for (let i = 0; i < 150; i++) { try { content = await readFile(portFile, 'utf8'); break; } catch { await sleep(100); } }
  if (!content) throw new Error('Chrome 调试端口未就绪');
  const port = content.split('\n')[0].trim();
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = new CDP(version.webSocketDebuggerUrl); await browser.open();
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  let result = null;
  for (let i = 0; i < 900; i++) {
    const r = await send('Runtime.evaluate', { expression: '({done: !!window.__done, results: window.__results || null})', returnByValue: true });
    if (r.result?.value?.done) { result = r.result.value.results; break; }
    await sleep(100);
  }
  if (!result) throw new Error('批量解析超时');
  const failures = result.filter((x) => !x.ok);
  const summary = { total: result.length, ok: result.length - failures.length, fail: failures.length, failures: failures.slice(0, 50) };
  console.log(JSON.stringify(summary, null, 2));
  if (jsonOut) await writeFile(jsonOut, JSON.stringify(summary, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} catch (err) {
  console.error('批量解析失败:', err.message); process.exitCode = 1;
} finally {
  browser?.close(); chrome.kill('SIGTERM'); await sleep(300); await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
