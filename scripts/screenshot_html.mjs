#!/usr/bin/env node
// 通用 HTML -> PNG 全页截图（Chrome DevTools Protocol，无第三方 npm 依赖）
// 用法: node screenshot_html.mjs <input.html> <output.png> [--width 1600] [--scale 2] [--timeout 30000]

import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { await access(p); return p; } catch {}
  }
  return null;
}

function parseArgs(argv) {
  const out = { width: 1600, scale: 2, timeout: 30000, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') out.width = Number(argv[++i]);
    else if (a === '--scale') out.scale = Number(argv[++i]);
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else out.positional.push(a);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.consoleLogs = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args ?? [])
            .map((a) => a.value ?? a.description ?? '')
            .join(' ');
          this.consoleLogs.push({ type: msg.params.type, text });
        } else if (msg.method === 'Log.entryAdded') {
          this.consoleLogs.push({ type: msg.params.entry.level, text: msg.params.entry.text });
        } else if (msg.method === 'Runtime.exceptionThrown') {
          this.consoleLogs.push({
            type: 'exception',
            text: msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? 'exception',
          });
        }
        const waiters = this.events.get(msg.method);
        if (waiters?.length) waiters.shift()(msg.params);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  waitEvent(method, timeoutMs) {
    return new Promise((resolve) => {
      const list = this.events.get(method) ?? [];
      list.push(resolve);
      this.events.set(method, list);
      setTimeout(() => {
        const cur = this.events.get(method) ?? [];
        const i = cur.indexOf(resolve);
        if (i >= 0) cur.splice(i, 1);
        resolve(null);
      }, timeoutMs).unref?.();
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [htmlArg, outArg] = args.positional;
  if (!htmlArg || !outArg) {
    console.error('用法: node screenshot_html.mjs <input.html> <output.png> [--width 1600] [--scale 2] [--timeout 30000]');
    process.exit(2);
  }

  const htmlPath = path.resolve(htmlArg);
  const outPath = path.resolve(outArg);
  const chromePath = await findChrome();
  if (!chromePath) {
    console.error('未找到 Chrome/Chromium/Edge 可执行文件，可设置 CHROME_PATH 环境变量后重试。');
    process.exit(4);
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), 'shenti-shot-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--allow-file-access-from-files',
    'about:blank',
  ], { stdio: 'ignore' });

  let browser;
  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let content = null;
    for (let i = 0; i < 150; i++) {
      try { content = await readFile(portFile, 'utf8'); break; } catch { await sleep(100); }
    }
    if (!content) throw new Error('Chrome 调试端口未就绪（启动失败？）');
    const port = content.split('\n')[0].trim();
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = new CDP(version.webSocketDebuggerUrl);
    await browser.open();

    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => browser.send(m, p, sessionId);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    const loaded = browser.waitEvent('Page.loadEventFired', 10000);
    await send('Emulation.setDeviceMetricsOverride', {
      width: args.width, height: 1200, deviceScaleFactor: args.scale, mobile: false,
    });
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    await loaded;

    const deadline = Date.now() + args.timeout;
    let status = 'mermaid-timeout';
    let detail = '';
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const mm = document.querySelector('.mermaid');
          const status = document.getElementById('render-status');
          const svg = mm && mm.querySelector('svg');
          const errIcon = document.querySelector('.error-icon');
          const bodyText = document.body ? (document.body.innerText || '') : '';
          return {
            hasMermaid: !!mm,
            hasSvg: !!svg,
            status: status ? (status.dataset.status || status.textContent || '') : '',
            errorIcon: !!errIcon,
            bodyHasError: /Syntax error|Parse error|mermaid-load-failed/i.test(bodyText),
            bodyText: bodyText.slice(0, 800),
          };
        })()`,
        returnByValue: true,
      });
      const v = r.result?.value ?? {};
      if (!v.hasMermaid) { status = 'no-mermaid'; break; }
      if (v.errorIcon || v.bodyHasError || v.status === 'error') {
        status = 'mermaid-error';
        detail = v.bodyText || 'Mermaid 渲染失败';
        break;
      }
      if (v.hasSvg && (v.status === 'ok' || v.status === '')) { status = 'ok'; break; }
      await sleep(200);
    }

    const metrics = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('[data-chart="true"]') || document.body;
        const svg = document.querySelector('.mermaid svg');
        const r = el.getBoundingClientRect();
        const s = svg ? svg.getBoundingClientRect() : { right: 0, bottom: 0 };
        return {
          x: 0, y: 0,
          width: Math.ceil(Math.max(r.right, s.right, document.body.scrollWidth) + 24),
          height: Math.ceil(Math.max(r.bottom, s.bottom, document.body.scrollHeight) + 24),
        };
      })()`,
      returnByValue: true,
    });
    const clip = metrics.result.value;

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { ...clip, scale: 1 },
    });
    await writeFile(outPath, Buffer.from(shot.data, 'base64'));

    const consoleErrors = browser.consoleLogs.filter((x) => ['error', 'exception'].includes(x.type));
    const ok = status === 'ok';
    const result = {
      ok,
      status,
      output: outPath,
      ...clip,
      detail: detail || undefined,
      consoleErrors: consoleErrors.slice(-8),
    };
    console.log(JSON.stringify(result));
    await browser.send('Browser.close').catch(() => {});
    process.exitCode = ok ? 0 : 3;
  } catch (err) {
    console.error(`截图失败: ${err.message}`);
    process.exitCode = 1;
  } finally {
    browser?.close();
    chrome.kill('SIGTERM');
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main();
