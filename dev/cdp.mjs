// Minimal Chrome DevTools Protocol driver shared by the dev/e2e_*.mjs tests.
// Zero dependencies: needs Node >= 22 (built-in WebSocket/fetch) and Chrome/Chromium (Edge cannot be driven the same way).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Start headless Chrome and return { open, ev, errors, check, finish, close }. */
export async function launch(browser) {
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'e2e_'));
  const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) { chrome.kill(); throw new Error('Chrome DevTools endpoint did not come up'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  const state = { errors: [], onLoad: null };
  const pending = new Map();
  let nextId = 1;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method === 'Page.loadEventFired' && state.onLoad) { state.onLoad(); state.onLoad = null; }
    else if (msg.method && listeners[msg.method]) listeners[msg.method].forEach((f) => f(msg.params));
    if (msg.method === 'Runtime.exceptionThrown') state.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') state.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const listeners = {};
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const results = [];
  const api = {
    get errors() { return state.errors; },
    /** Raw CDP command (e.g. Input.dispatchMouseEvent) and event subscription, for real input such as native drags. */
    send,
    on(method, fn) { (listeners[method] = listeners[method] || []).push(fn); },
    async open(file, query = '') {
      state.errors = [];
      const loaded = new Promise((r) => { state.onLoad = r; });
      const url = pathToFileURL(file).href + query;
      await send('Page.navigate', { url });
      await loaded;
      // The first load event can belong to the previous page (about:blank): wait for the real one.
      for (let i = 0; i < 50; i++) {
        const r = await send('Runtime.evaluate', { expression: `location.href + '|' + document.readyState`, returnByValue: true });
        const [href, ready] = String(r.result.value).split('|');
        if (href === url && ready === 'complete') break;
        await sleep(100);
      }
      await sleep(700);
    },
    async ev(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    check(name, ok, detail = '') {
      results.push({ name, ok });
      console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${ok ? '' : ' - ' + detail}`);
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
      return api.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
        const r = el.getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
    },
    mouse(type, x, y, extra = {}) {
      return send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, modifiers: 0, pointerType: 'mouse', ...extra });
    },
    /** A real click at (x, y); `count: 2` is a double-click. modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8. */
    async click(x, y, { count = 1, modifiers = 0 } = {}) {
      await api.mouse('mouseMoved', x, y, { modifiers });
      for (let c = 1; c <= count; c++) {
        await api.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: c, modifiers });
        await api.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: c, modifiers });
      }
      await sleep(60);
    },
    async clickOn(selector, opts = {}) {
      const p = await api.at(selector);
      if (!p) throw new Error(`clickOn: nothing matches ${selector}`);
      await api.click(p.x, p.y, opts);
    },
    /** A real drag from (x1, y1) to (x2, y2) in `steps` moves. */
    async dragTo(x1, y1, x2, y2, { steps = 6, modifiers = 0 } = {}) {
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
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(40);
    },
    /** Type text into the focused element (replaces the selection), as the keyboard would. */
    async type(text) {
      await send('Input.insertText', { text });
      await sleep(40);
    },
    async close() {
      try { ws.close(); } catch { /* ignore */ }
      chrome.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile may still be locked */ }
    },
    /** Print the summary and return the process exit code (0 ok, 2 failures). */
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`${results.length - failed}/${results.length} checks passed`);
      return failed ? 2 : 0;
    },
  };
  return api;
}
