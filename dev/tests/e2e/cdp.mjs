// Minimal Chrome DevTools Protocol driver shared by the dev/e2e_*.mjs tests.
// Zero dependencies: needs Node >= 22 (built-in WebSocket/fetch) and Chrome/Chromium (Edge cannot be driven the same way).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function findBrowser(explicit) {
  const chosen = explicit || process.env.CHROME || process.env.E2E_BROWSER;
  if (chosen) return chosen;
  const candidates = process.platform === 'win32'
    ? [
        join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else {
      const r = spawnSync('which', [c], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export const isVerbose = () => process.argv.includes('-v') || process.argv.includes('--verbose');

export const isNoAnim = () => process.argv.includes('--noanim') || process.env.E2E_NOANIM === '1';

const normUrl = (u) => u.replace(/^file:\/\/\/([a-z]):/i, (_, d) => `file:///${d.toUpperCase()}:`);

function parseShard() {
  const raw = argOf('shard');
  if (!raw) return null;
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error(`invalid --shard ${raw} (expected k/n, 1-based)`);
  const index = Number(m[1]), total = Number(m[2]);
  if (index < 1 || index > total) throw new Error(`invalid --shard ${raw}`);
  return { index, total };
}

function parseSections(flag = 'section') {
  const raw = argOf(flag);
  return raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) : null;
}

export const CHROME_FLAGS = [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-extensions', '--disable-sync', '--disable-component-update',
  '--window-size=1920,1080',
];

/** Start headless Chrome (or attach an isolated context to E2E_BROWSER_WS) and return the test driver API. */
export async function launch(browser) {
  const sharedWs = process.env.E2E_BROWSER_WS;
  let chrome = null, profile = null, wsUrl = sharedWs;
  if (!wsUrl) {
    profile = mkdtempSync(join(tmpdir(), 'e2e_'));
    chrome = spawn(browser, [...CHROME_FLAGS, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      // Chrome refuses to start as root (containers, CI) without this
      ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });

    const portFile = join(profile, 'DevToolsActivePort');
    let port = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !wsUrl) {
      if (!port && existsSync(portFile)) {
        try {
          const line = readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
          if (/^\d+$/.test(line)) port = Number(line);
        } catch { /* file still being written */ }
      }
      if (port) {
        try {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
        } catch { /* browser still starting */ }
      }
      if (!wsUrl) await sleep(30);
    }
    if (!wsUrl) { chrome.kill(); throw new Error('Chrome DevTools endpoint did not come up'); }
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const state = { errors: [], onLoad: null };
  const pending = new Map();
  let nextId = 1;
  let browserContextId = null, targetId = null, sessionId = null;
  const listeners = {};
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (!sessionId || msg.sessionId === sessionId) {
      if (msg.method === 'Page.loadEventFired' && state.onLoad) { state.onLoad(); state.onLoad = null; }
      else if (msg.method && listeners[msg.method]) listeners[msg.method].forEach((f) => f(msg.params));
      if (msg.method === 'Runtime.exceptionThrown') state.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') state.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const rawSend = (method, params = {}, sid = null) => {
    const id = nextId++;
    ws.send(JSON.stringify(sid ? { id, sessionId: sid, method, params } : { id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  let autoReduced = false;
  if (sharedWs) {
    browserContextId = (await rawSend('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
    targetId = (await rawSend('Target.createTarget', { url: 'about:blank', width: 1920, height: 1080, newWindow: true, browserContextId })).targetId;
    sessionId = (await rawSend('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  }
  const send = (method, params = {}) => {
    if (method === 'Emulation.setEmulatedMedia') autoReduced = false;
    if (sharedWs && (method === 'Browser.setDownloadBehavior' || method === 'Browser.grantPermissions')) {
      return rawSend(method, { browserContextId, ...params });
    }
    return rawSend(method, params, sessionId);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  if (sharedWs) await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Headless Chrome cannot show the Save dialog, so a page's Save takes the download path, which the tests capture.
  // Without the picker the shell also skips the "Save over the file you opened" bubble; a test that covers the bubble
  // puts a stub window.showSaveFilePicker back after open(), or opens the page with "keep-picker" in its query.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!/[?&]keep-picker/.test(location.search)) delete window.showSaveFilePicker;` });

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const servers = new Map();
  async function serveDir(dir) {
    let entry = servers.get(dir);
    if (!entry) {
      const prefix = dir.endsWith(sep) ? dir : dir + sep;
      const server = createServer((req, res) => {
        let rel;
        try { rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html'; }
        catch { res.writeHead(400); res.end('Bad request'); return; }
        const target = resolve(dir, rel);
        if (target !== dir && !target.startsWith(prefix)) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(readFileSync(target));
      });
      await new Promise((res, rej) => {
        server.once('error', rej);
        server.listen(0, '127.0.0.1', res);
      });
      entry = { server, port: server.address().port };
      servers.set(dir, entry);
    }
    return entry.port;
  }

  const results = [];
  const verbose = isVerbose();
  const noAnim = isNoAnim();
  const shard = parseShard();
  const onlySections = parseSections('section')
    || (process.env.E2E_SECTIONS ? new Set(process.env.E2E_SECTIONS.split(',').map((s) => s.trim()).filter(Boolean)) : null);
  const excludeSections = parseSections('exclude-section');
  let sectionIndex = 0;
  const api = { send,   // send: the raw DevTools call (e.g. Emulation.setDeviceMetricsOverride)
    get errors() { return state.errors; },
    /** Raw CDP command (e.g. Input.dispatchMouseEvent) and event subscription, for real input such as native drags. */
    send,
    on(method, fn) { (listeners[method] = listeners[method] || []).push(fn); },
    async open(target, query = '', { motion = false } = {}) {
      state.errors = [];
      if (noAnim && !motion && !autoReduced) {
        await rawSend('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
        autoReduced = true;
      } else if (motion && autoReduced) {
        await rawSend('Emulation.setEmulatedMedia', { features: [] }, sessionId);
        autoReduced = false;
      }
      const q = query || '';
      const loaded = new Promise((r) => { state.onLoad = r; });
      const isHttp = /^https?:\/\//i.test(target);
      let isSplit = false;
      let url;
      if (isHttp) {
        url = target + q;
      } else {
        const abs = resolve(target);
        const dir = dirname(abs);
        const html = readFileSync(abs, 'utf8');
        isSplit = !html.includes('id="diagram-data"')
          && (/<script\b[^>]*\bsrc="app\.js"/.test(html) || existsSync(join(dir, 'diagram.json')));
        url = isSplit
          ? `http://127.0.0.1:${await serveDir(dir)}/${encodeURIComponent(basename(abs))}${q}`
          : pathToFileURL(abs).href + q;
      }
      const expectUrl = normUrl(url);
      await send('Page.navigate', { url });
      await loaded;
      // The first load event can belong to the previous page (about:blank): wait for the real one.
      const readyDeadline = Date.now() + 10000;
      while (Date.now() < readyDeadline) {
        const r = await send('Runtime.evaluate', {
          expression: `JSON.stringify([location.href, document.readyState, document.documentElement.dataset.diagramReady || '', document.documentElement.dataset.diagramSettled || ''])`,
          returnByValue: true,
        });
        const [href, ready, diagramReady, settled] = JSON.parse(r.result.value);
        // settled: the web font is in and the shell animates (until then motion is off, so the font-swap render does not FLIP)
        if (normUrl(href) === expectUrl && ready === 'complete' && (!(isSplit || isHttp) || diagramReady === '1') && (!diagramReady || settled === '1')) break;
        await sleep(20);
      }
      await api.ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`).catch(() => {});
      if (/[?&]report(?:=|&|$)/.test(q)) await sleep(250);
      await api.settle();
    },
    /** Waits (cap ~800ms) until the shell reports no motion in flight (<html data-motion-busy>, set by the motion kernel). */
    async settle(cap = 800) {
      await api.ev(`new Promise((resolve) => {
        const end = performance.now() + ${cap};
        const tick = () => {
          if (document.documentElement.dataset.motionBusy !== '1' || performance.now() >= end) resolve();
          else setTimeout(tick, 16);
        };
        tick();
      })`).catch(() => {});
    },
    /** Polls `expression` inside the page until truthy (or `timeout` ms) in one roundtrip, returning its value. */
    async waitFor(expression, { timeout = 2000, interval = 20 } = {}) {
      return api.ev(`new Promise((resolve) => {
        const end = performance.now() + ${timeout};
        const tick = () => {
          let v;
          try { v = (${expression}); } catch { v = null; }
          if (v || performance.now() >= end) resolve(v ?? null);
          else setTimeout(tick, ${interval});
        };
        tick();
      })`);
    },
    /** Trigger Ctrl+S and return the saved #diagram-data block once the page writes it (much faster than a fixed sleep). */
    async saved({ raw = false, timeout = 1500 } = {}) {
      const armed = api.ev(`new Promise((resolve) => {
        const el = document.getElementById('diagram-data');
        if (!el) { resolve(null); return; }
        const modal = document.getElementById('save-modal');
        let skipModal = !modal || !!document.querySelector('meta[name="diagram-save-prompt"][content="off"]');
        try { if (localStorage.getItem('ultimate-diagram-skip-save-modal') === '1') skipModal = true; } catch (_) {}
        let done = false, dataDone = false, modalDone = skipModal, modalTm = null;
        const finish = () => {
          if (done) return;
          done = true;
          obs.disconnect();
          if (modalObs) modalObs.disconnect();
          clearTimeout(tm);
          if (modalTm) clearTimeout(modalTm);
          if (modal && modal.open) modal.close('cancel');
          resolve(el.textContent);
        };
        const closeModalIfOpen = () => {
          if (!modal || !modal.open) return false;
          modal.close('cancel');
          modalDone = true;
          if (modalObs) modalObs.disconnect();
          return true;
        };
        const modalObs = modal && !skipModal ? new MutationObserver(() => {
          if (closeModalIfOpen() && dataDone) finish();
        }) : null;
        if (modalObs) modalObs.observe(modal, { attributes: true, attributeFilter: ['open'] });
        const obs = new MutationObserver(() => {
          dataDone = true;
          obs.disconnect();
          closeModalIfOpen();
          if (modalDone) finish();
          else modalTm = setTimeout(finish, Math.min(400, ${timeout}));
        });
        obs.observe(el, { childList: true, characterData: true, subtree: true });
        const tm = setTimeout(finish, ${timeout});
      })`);
      await api.press('s', { modifiers: 2 });
      const text = await armed;
      return raw ? text : JSON.parse(text);
    },
    /** Run a named independent test section, honouring --shard k/n, --section / E2E_SECTIONS, and --exclude-section. */
    async section(name, fn, onAfter) {
      if (excludeSections && excludeSections.has(name)) return false;
      const idx = sectionIndex++;
      if (onlySections && !onlySections.has(name)) return false;
      if (shard && (idx % shard.total) !== (shard.index - 1)) return false;
      try { await fn(); } catch (err) {
        api.check(`${name}: ran to the end`, false, (err.stack || err.message).split('\n').slice(0, 3).join(' / '));
      }
      if (onAfter) onAfter();
      return true;
    },
    async ev(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    check(name, ok, detail = '') {
      results.push({ name, ok });
      if (!ok || verbose) console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${ok ? '' : ' - ' + detail}`);
    },
    key: (k, extra = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, bubbles: true }, ${JSON.stringify(extra)})))`,
    /** pointer sequence on the first element matching `selector`; moves by (dx, dy) screen px between down and up. */
    drag: (selector, dx = 0, dy = 0) => `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
      el.dispatchEvent(new PointerEvent('pointerdown', o(x, y)));
      window.dispatchEvent(new PointerEvent('pointermove', o(x + ${dx} / 2, y + ${dy} / 2)));
      window.dispatchEvent(new PointerEvent('pointermove', o(x + ${dx}, y + ${dy})));
      window.dispatchEvent(new PointerEvent('pointerup', o(x + ${dx}, y + ${dy})));
    })()`,
    // --- Real input (Input.dispatchMouseEvent / dispatchKeyEvent): the browser hit-tests and synthesises
    // click, dblclick and pointer events itself, exactly as for a person. Coordinates are viewport px.
    /** Centre of the first element matching `selector` (or null); `fx`/`fy` pick another point of its box (0..1). */
    async at(selector, fx = 0.5, fy = 0.5) {
      // A camera glide (Fit, zoom buttons, pan-into-view) or a FLIP (undo, collapse) moves things for ~250ms: aim at where they settle
      return api.ev(`new Promise((resolve) => {
        const end = performance.now() + 800;
        const moving = () => !!document.querySelector('#viewport.gesturing')
          || document.documentElement.dataset.motionBusy === '1'
          || document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity);
        const tick = () => {
          if (moving() && performance.now() < end) { setTimeout(tick, 16); return; }
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) { resolve(null); return; }
          const r = el.getBoundingClientRect();
          resolve({ x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} });
        };
        tick();
      })`);
    },
    mouse(type, x, y, extra = {}) {
      return send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, modifiers: 0, pointerType: 'mouse', ...extra });
    },
    /** A real click at (x, y); `count: 2` is a double-click. modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8. */
    async click(x, y, { count = 1, modifiers = 0 } = {}) {
      const ops = [api.mouse('mouseMoved', x, y, { modifiers })];
      for (let c = 1; c <= count; c++) {
        ops.push(api.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: c, modifiers }));
        ops.push(api.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: c, modifiers }));
      }
      await Promise.all(ops);
      await sleep(noAnim ? 16 : 60);
    },
    async clickOn(selector, opts = {}) {
      const p = await api.at(selector);
      if (!p) throw new Error(`clickOn: nothing matches ${selector}`);
      await api.click(p.x, p.y, opts);
    },
    /** A real drag from (x1, y1) to (x2, y2) in `steps` moves. */
    async dragTo(x1, y1, x2, y2, { steps = 6, modifiers = 0 } = {}) {
      if (noAnim) {
        await Promise.all([
          api.mouse('mouseMoved', x1, y1, { modifiers }),
          api.mouse('mousePressed', x1, y1, { button: 'left', buttons: 1, clickCount: 1, modifiers }),
        ]);
        await sleep(16);
        const moves = [];
        for (let i = 1; i <= steps; i++) {
          moves.push(api.mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, { button: 'left', buttons: 1, modifiers }));
        }
        await Promise.all(moves);
        await sleep(16);
        await api.mouse('mouseReleased', x2, y2, { button: 'left', buttons: 0, clickCount: 1, modifiers });
        await sleep(20);
        return;
      }
      await api.mouse('mouseMoved', x1, y1, { modifiers });
      await api.mouse('mousePressed', x1, y1, { button: 'left', buttons: 1, clickCount: 1, modifiers });
      for (let i = 1; i <= steps; i++) {
        await api.mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, { button: 'left', buttons: 1, modifiers });
        await sleep(15);
      }
      await api.mouse('mouseReleased', x2, y2, { button: 'left', buttons: 0, clickCount: 1, modifiers });
      await sleep(80);
    },
    /** A real key press (keydown + keyup) on the focused element. */
    async press(key, { modifiers = 0 } = {}) {
      const codes = { Enter: 13, Escape: 27, Delete: 46, Backspace: 8, Tab: 9, F2: 113, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
      const vk = codes[key] || key.toUpperCase().charCodeAt(0);
      const base = { key, code: codes[key] ? key : `Key${key.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      await Promise.all([
        send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }),
        send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }),
      ]);
      await sleep(noAnim ? 16 : 40);
    },
    /** Type text into the focused element (replaces the selection), as the keyboard would. */
    async type(text) {
      await send('Input.insertText', { text });
      await sleep(noAnim ? 8 : 40);
    },
    async close() {
      if (sharedWs) {
        try { if (targetId) await rawSend('Target.closeTarget', { targetId }); } catch { /* ignore */ }
        try { if (browserContextId) await rawSend('Target.disposeBrowserContext', { browserContextId }); } catch { /* ignore */ }
      }
      try { ws.close(); } catch { /* ignore */ }
      for (const { server } of servers.values()) {
        try { server.closeAllConnections?.(); server.close(); } catch { /* ignore */ }
      }
      servers.clear();
      if (chrome) {
        const exited = chrome.exitCode !== null
          ? Promise.resolve()
          : new Promise((r) => { chrome.once('exit', r); setTimeout(r, 300); });
        chrome.kill();
        await exited;
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile may still be locked */ }
      }
    },
    /** Print the summary and return the process exit code (0 ok, 2 failures). */
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`${results.length - failed}/${results.length} checks passed`);
      return failed ? 2 : 0;
    },
  };
  if (process.env.E2E_PROFILE === '1') {
    const prof = {};
    for (const k of ['open', 'at', 'click', 'clickOn', 'dragTo', 'press', 'type', 'saved', 'waitFor', 'settle', 'ev']) {
      const orig = api[k];
      api[k] = async (...a) => {
        const s = Date.now();
        try { return await orig(...a); } finally {
          const e = prof[k] || (prof[k] = { n: 0, ms: 0, max: 0 });
          const d = Date.now() - s;
          e.n++; e.ms += d; if (d > e.max) e.max = d;
        }
      };
    }
    const origClose = api.close;
    api.close = async () => {
      console.error('[PROFILE]', Object.entries(prof).sort((a, b) => b[1].ms - a[1].ms)
        .map(([k, v]) => `${k}:${v.n}x/${v.ms}ms(max:${v.max}ms)`).join('  '));
      return origClose();
    };
  }
  return api;
}
