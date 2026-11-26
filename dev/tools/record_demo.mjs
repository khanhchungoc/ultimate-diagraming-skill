#!/usr/bin/env node
/**
 * Record README demo clips as compact animated WebP + JPEG posters.
 *
 * Scenarios:
 *   hero       -> docs/img/demo.webp            (Drag/Rename, Subprocess, Copy/Import Mermaid, Save, Present mode)
 *   flowchart  -> docs/img/demo-flowchart.webp  (Drop step onto arrow, reorder swimlane, split long arrow with connector, vertical layout)
 *   sequence   -> docs/img/demo-sequence.webp   (Collapse/expand frame, scroll down for floating pills, add message & reply)
 *   erd        -> docs/img/demo-erd.webp        (Zoom out to overview + detail card, drag-drop new table, zoom in, connect tables, highlight)
 *   usecase    -> docs/img/demo-usecase.webp    (Drag-drop Actor & Use Case, search ref FR-4, collapse/expand subject)
 *   c4         -> docs/img/demo-c4.webp         (Collapse/expand boundary, change icon & colour, drag-drop new item)
 *   examples   -> all 5 diagram clips above
 *   all        -> hero + all 5 diagram clips
 *
 * Reuses dev/tests/e2e/cdp.mjs (Chrome DevTools Protocol) and dev/tools/encode_demo_webp.py (Pillow).
 *
 * Usage:
 *   node dev/tools/record_demo.mjs [--scenario hero|flowchart|sequence|erd|usecase|c4|examples|all]
 *                                  [--out path.webp] [--width 800] [--height 450] [--quality 72] [--keep-frames]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, launch, sleep } from '../tests/e2e/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const VIEW_W = 1280;
const VIEW_H = 720;
const DPR = 1.5; // 1920x1080 capture keeps text crisp even at 1.6x camera zoom

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const MERMAID_SAMPLE = [
  'flowchart LR',
  '  subgraph Customer',
  '    A([Submit Order]) --> B[Pay Invoice]',
  '  end',
  '  subgraph Fulfillment',
  '    B --> C{In Stock?}',
  '    C -->|Yes| D[Ship Order]',
  '    C -->|No| E[Backorder]',
  '  end',
].join('\n');

const CURSOR_INSTALL_JS = `(() => {
  if (document.getElementById('__demo-cursor')) return;
  const style = document.createElement('style');
  style.id = '__demo-cursor-style';
  style.textContent = \`
    #__demo-cursor {
      position: fixed;
      top: 0;
      left: 0;
      width: 28px;
      height: 28px;
      z-index: 2147483647;
      pointer-events: none;
      transform: translate(-100px, -100px);
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
      will-change: transform;
    }
    #__demo-cursor.pressing svg {
      transform: scale(0.88);
    }
    #__demo-cursor svg {
      transition: transform 80ms ease-out;
      transform-origin: 4px 2px;
    }
    .__demo-ripple {
      position: fixed;
      width: 34px;
      height: 34px;
      margin-left: -17px;
      margin-top: -17px;
      border-radius: 50%;
      border: 2.5px solid rgba(59, 130, 246, 0.85);
      background: rgba(59, 130, 246, 0.14);
      pointer-events: none;
      z-index: 2147483646;
      animation: __demo-ripple-anim 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    @keyframes __demo-ripple-anim {
      from { transform: scale(0.25); opacity: 0.95; }
      to   { transform: scale(1.65); opacity: 0; }
    }
  \`;
  document.head.appendChild(style);

  const cur = document.createElement('div');
  cur.id = '__demo-cursor';
  cur.innerHTML = \`<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.5 2.5L23.5 13.8L15.1 15.6L11.4 23.8L5.5 2.5Z"
          fill="#111827" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
  </svg>\`;
  document.body.appendChild(cur);

  window.__demoCursor = {
    move(x, y, pressing = false) {
      cur.style.transform = \`translate(\${(x - 5).toFixed(1)}px, \${(y - 2).toFixed(1)}px)\`;
      cur.classList.toggle('pressing', !!pressing);
    },
    ripple(x, y) {
      const el = document.createElement('div');
      el.className = '__demo-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 460);
    },
  };
})()`;

/** Stub clipboard and in-place file save so headless Chrome demos Copy as Mermaid and Save cleanly. */
const DEMO_STUBS_JS = `
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });
  window.showSaveFilePicker = async () => ({
    name: 'loan-approval.html',
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
  });
`;

/** Create a frame-capturing choreography helper bound to a CDP session. */
function createDirector(t, framesDir) {
  const frames = [];
  let cursorX = VIEW_W * 0.56;
  let cursorY = VIEW_H * 0.62;
  let pressing = false;
  let cam = { zoom: 1.0, cx: 0.5, cy: 0.5, smooth: 0.28 };

  async function setCursor(x, y, isPressing = pressing) {
    cursorX = x;
    cursorY = y;
    pressing = isPressing;
    await t.ev(`window.__demoCursor?.move(${x.toFixed(2)}, ${y.toFixed(2)}, ${Boolean(isPressing)})`);
  }

  async function ripple(x = cursorX, y = cursorY) {
    await t.ev(`window.__demoCursor?.ripple(${x.toFixed(2)}, ${y.toFixed(2)})`);
  }

  function camera(zoom, xPx = VIEW_W / 2, yPx = VIEW_H / 2, smooth = 0.28) {
    cam = { zoom, cx: xPx / VIEW_W, cy: yPx / VIEW_H, smooth };
  }

  async function snap(durationMs = 65) {
    const idx = frames.length;
    const file = `frame_${String(idx).padStart(4, '0')}.png`;
    const res = await t.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(framesDir, file), Buffer.from(res.data, 'base64'));
    frames.push({ file, durationMs, zoom: cam.zoom, cx: cam.cx, cy: cam.cy, smooth: cam.smooth });
  }

  /** Capture live page animations; identical frames are merged during WebP encoding. */
  async function hold(ms, stepMs = 70) {
    const steps = Math.max(1, Math.round(ms / stepMs));
    for (let i = 0; i < steps; i++) {
      await snap(stepMs);
      await sleep(Math.max(15, stepMs - 20));
    }
  }

  /** Single static frame with long duration for compact pauses. */
  async function pause(ms) {
    await snap(ms);
    await sleep(Math.min(ms, 80));
  }

  /** Smoothly glide the cursor to (x, y) while sending real mouseMoved events. */
  async function glideTo(x, y, { frames: n = 8, stepMs = 62, followCamera = false, zoom = cam.zoom } = {}) {
    const sx = cursorX;
    const sy = cursorY;
    for (let i = 1; i <= n; i++) {
      const k = easeInOutCubic(i / n);
      const nx = sx + (x - sx) * k;
      const ny = sy + (y - sy) * k;
      await t.mouse('mouseMoved', nx, ny, pressing ? { button: 'left', buttons: 1 } : {});
      await setCursor(nx, ny, pressing);
      if (followCamera) camera(zoom, nx, ny, 0.28);
      await snap(stepMs);
      await sleep(16);
    }
  }

  /** Click at current cursor position with ripple and real mouse events. */
  async function clickHere({ count = 1, modifiers = 0 } = {}) {
    await ripple(cursorX, cursorY);
    for (let c = 1; c <= count; c++) {
      await setCursor(cursorX, cursorY, true);
      await t.mouse('mousePressed', cursorX, cursorY, { button: 'left', buttons: 1, clickCount: c, modifiers });
      await snap(55);
      await sleep(25);
      await t.mouse('mouseReleased', cursorX, cursorY, { button: 'left', buttons: 0, clickCount: c, modifiers });
      await setCursor(cursorX, cursorY, false);
      await snap(55);
      if (c < count) await sleep(35);
    }
  }

  /** Grab at current cursor position, smoothly drag to (x, y), and release. */
  async function dragTo(x, y, { frames: n = 10, stepMs = 62, followCamera = false, zoom = cam.zoom } = {}) {
    await ripple(cursorX, cursorY);
    await setCursor(cursorX, cursorY, true);
    await t.mouse('mousePressed', cursorX, cursorY, { button: 'left', buttons: 1, clickCount: 1 });
    await snap(60);
    await sleep(20);
    await glideTo(x, y, { frames: n, stepMs, followCamera, zoom });
    await t.mouse('mouseReleased', cursorX, cursorY, { button: 'left', buttons: 0, clickCount: 1 });
    await setCursor(cursorX, cursorY, false);
    await snap(60);
  }

  /** Smoothly scroll the mouse wheel at (x, y) over `steps` frames. */
  async function wheel(deltaY, { steps = 8, stepMs = 65 } = {}) {
    const per = deltaY / steps;
    for (let i = 0; i < steps; i++) {
      await t.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: cursorX,
        y: cursorY,
        deltaX: 0,
        deltaY: per,
      });
      await sleep(24);
      await snap(stepMs);
    }
  }

  /** Type text in small chunks while capturing frames. */
  async function typeText(text, { chunkSize = 4, stepMs = 65 } = {}) {
    for (let i = 0; i < text.length; i += chunkSize) {
      await t.send('Input.insertText', { text: text.slice(i, i + chunkSize) });
      await sleep(22);
      await snap(stepMs);
    }
  }

  async function pressKey(key, opts = {}) {
    await t.press(key, opts);
    await snap(65);
  }

  return { frames, setCursor, camera, snap, hold, pause, glideTo, clickHere, dragTo, wheel, typeText, pressKey };
}

/** Hero clip: Drag/Rename + Auto-Tidy, Subprocess tab, Copy/Import Mermaid, Save, Present mode. */
async function runHero(t, d) {
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: DEMO_STUBS_JS });
  await t.open(join(ROOT, 'dev/samples/example-flowchart.html'), '?keep-picker', { motion: true });
  await t.clickOn('#btn-save');
  await sleep(120);
  await t.ev(`[...document.querySelectorAll('button')].find(b => /choose file/i.test(b.textContent))?.click()`);
  await sleep(200);
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.56, VIEW_H * 0.64, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(550);

  // 1. Drag step across lanes (Auto-Tidy) & rename
  const nodeSel = '.flow-node[data-node-id="n_verify_income_employment"]';
  const nodePos = await t.at(nodeSel);
  if (!nodePos) throw new Error(`Missing node ${nodeSel}`);

  d.camera(1.5, nodePos.x + 40, nodePos.y + 45, 0.28);
  await d.glideTo(nodePos.x, nodePos.y, { frames: 8, stepMs: 62 });
  await d.dragTo(nodePos.x + 85, nodePos.y + 110, { frames: 10, stepMs: 62, followCamera: true, zoom: 1.5 });
  await d.hold(420, 70);

  const movedPos = await t.at(nodeSel);
  if (!movedPos) throw new Error(`Lost node ${nodeSel} after drag`);
  d.camera(1.6, movedPos.x, movedPos.y, 0.3);
  await d.glideTo(movedPos.x, movedPos.y, { frames: 6, stepMs: 60 });
  await d.clickHere({ count: 2 });
  await d.pause(100);
  await d.pressKey('a', { modifiers: 2 });
  await d.typeText('Auto KYC Check', { chunkSize: 4, stepMs: 65 });
  await d.pressKey('Enter');
  await d.hold(260, 70);

  // 2. Open the child subprocess tab ("Run Credit & Fraud Check") and return to Main flow
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
  const subBtn = await t.at('.flow-node.type-subprocess .sub-open');
  if (subBtn) {
    await d.glideTo(subBtn.x, subBtn.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(400, 70);
    await d.pause(700);
    const mainTab = await t.at('#flow-tabs > .flow-tab[data-tab=""]');
    if (mainTab) {
      await d.glideTo(mainTab.x, mainTab.y, { frames: 7, stepMs: 62 });
      await d.clickHere({ count: 1 });
      await d.hold(300, 70);
    }
  }

  // 3. Copy as Mermaid
  const exportBtn = await t.at('#btn-export');
  if (!exportBtn) throw new Error('Missing #btn-export');
  d.camera(1.42, exportBtn.x - 100, exportBtn.y + 110, 0.28);
  await d.glideTo(exportBtn.x, exportBtn.y, { frames: 8, stepMs: 62 });
  await d.clickHere({ count: 1 });
  await d.hold(180, 65);

  const copyMmd = await t.at('[data-copy="mermaid"]');
  if (!copyMmd) throw new Error('Missing [data-copy="mermaid"]');
  await d.glideTo(copyMmd.x, copyMmd.y, { frames: 6, stepMs: 60 });
  await d.clickHere({ count: 1 });
  await d.hold(280, 70);
  await d.pause(320);

  // 4. Import from Mermaid
  const importBtn = await t.at('#btn-import-mermaid');
  if (!importBtn) throw new Error('Missing #btn-import-mermaid');
  await d.glideTo(importBtn.x, importBtn.y, { frames: 6, stepMs: 60 });
  await d.clickHere({ count: 1 });
  await d.hold(200, 65);

  const fieldPos = await t.at('.confirm-field');
  if (!fieldPos) throw new Error('Missing .confirm-field');
  await d.glideTo(fieldPos.x, fieldPos.y, { frames: 5, stepMs: 60 });
  await d.clickHere({ count: 1 });
  await t.send('Input.insertText', { text: MERMAID_SAMPLE });
  await d.pause(380);

  const okBtn = await t.at('.confirm-ok');
  if (!okBtn) throw new Error('Missing .confirm-ok');
  await d.glideTo(okBtn.x, okBtn.y, { frames: 5, stepMs: 60 });
  await d.clickHere({ count: 1 });

  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
  await d.hold(460, 70);
  await d.pause(380);

  // 5. Save in place
  const saveBtn = await t.at('#btn-save');
  if (!saveBtn) throw new Error('Missing #btn-save');
  await d.glideTo(saveBtn.x, saveBtn.y, { frames: 7, stepMs: 62 });
  await d.clickHere({ count: 1 });
  await d.hold(320, 70);
  await d.pause(450);

  // 6. Present mode (clean full-screen stakeholder view)
  const presentBtn = await t.at('#btn-present');
  if (presentBtn) {
    await d.glideTo(presentBtn.x, presentBtn.y, { frames: 7, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(400, 70);
    await d.pause(950);
    await d.pressKey('Escape');
    await d.hold(320, 70);
  }
  await d.pause(550);

  return { posterFrame: 0 };
}

/**
 * Flowchart example:
 *  1. Drag & drop a new Step right onto an arrow (rewires A -> new -> B)
 *  2. Reorder a participant swimlane by dragging its lane title pill
 *  3. Split a long arrow with a connector pair
 *  4. Switch Horizontal -> Vertical layout
 */
async function runFlowchartExample(t, d) {
  await t.open(join(ROOT, 'dev/samples/example-flowchart.html'), '', { motion: true });
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.52, VIEW_H * 0.56, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(600);

  // 1. Find midpoint of a clean horizontal arrow between two steps to drop a new Step onto
  const arrowMid = await t.ev(`(() => {
    const hits = [...document.querySelectorAll('.edge-hit')];
    const best = hits.map(p => {
      const len = p.getTotalLength ? p.getTotalLength() : 0;
      const r = p.getBoundingClientRect();
      return { p, len, r };
    }).filter(x => x.len > 60 && x.r.x > 260 && x.r.x < 900 && x.r.y > 160 && x.r.y < 520)
      .sort((a, b) => a.r.x - b.r.x)[0];
    if (!best) return null;
    const pt = best.p.getPointAtLength(best.len * 0.5);
    const svg = best.p.ownerSVGElement;
    const ctm = best.p.getScreenCTM();
    if (ctm) {
      return { x: ctm.a * pt.x + ctm.e, y: ctm.d * pt.y + ctm.f };
    }
    return { x: best.r.x + best.r.width / 2, y: best.r.y + best.r.height / 2 };
  })()`);

  const shapesBtn = await t.at('#btn-add-shape');
  if (!shapesBtn) throw new Error('Missing #btn-add-shape');
  await d.glideTo(shapesBtn.x, shapesBtn.y, { frames: 8, stepMs: 62 });
  await d.clickHere({ count: 1 });
  await d.hold(220, 65);

  const stepBtn = await t.at('#btn-add-step');
  if (!stepBtn) throw new Error('Missing #btn-add-step');
  await d.glideTo(stepBtn.x, stepBtn.y, { frames: 6, stepMs: 60 });
  if (arrowMid) {
    await d.dragTo(arrowMid.x, arrowMid.y, { frames: 12, stepMs: 62 });
  } else {
    await d.clickHere({ count: 1 });
  }
  await d.hold(420, 70);

  // Name the newly inserted step if inline edit opened
  const isEditing = await t.ev(`!!(document.activeElement && document.activeElement.isContentEditable)`);
  if (isEditing) {
    await d.typeText('Compliance Check', { chunkSize: 4, stepMs: 65 });
    await d.pressKey('Enter');
    await d.hold(320, 70);
  }
  await d.pause(450);

  // 2. Move a participant swimlane by dragging its lane title pill down below the next lane
  const lane2 = await t.at('.swimlane:nth-child(2) .lane-title');
  const lane3 = await t.at('.swimlane:nth-child(3) .lane-title');
  if (lane2 && lane3) {
    await d.glideTo(lane2.x, lane2.y, { frames: 8, stepMs: 62 });
    await d.dragTo(lane3.x, lane3.y + 45, { frames: 12, stepMs: 62 });
    await d.hold(520, 70);
    await d.pause(500);
  }

  // 3. Click a long arrow and split it with a Connector pair
  const longArrow = await t.ev(`(() => {
    const hits = [...document.querySelectorAll('.edge-hit')];
    const best = hits.map(p => {
      const len = p.getTotalLength ? p.getTotalLength() : 0;
      const r = p.getBoundingClientRect();
      return { p, len, r };
    }).sort((a, b) => b.len - a.len)[0];
    if (!best || best.len < 80) return null;
    const pt = best.p.getPointAtLength(best.len * 0.5);
    const ctm = best.p.getScreenCTM();
    if (ctm) return { x: ctm.a * pt.x + ctm.e, y: ctm.d * pt.y + ctm.f };
    return { x: best.r.x + best.r.width / 2, y: best.r.y + best.r.height / 2 };
  })()`);
  if (longArrow) {
    d.camera(1.32, longArrow.x, longArrow.y, 0.28);
    await d.glideTo(longArrow.x, longArrow.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(240, 65);
    const splitBtn = await t.at('.edge-bar [data-act="split"]');
    if (splitBtn) {
      await d.glideTo(splitBtn.x, splitBtn.y, { frames: 6, stepMs: 60 });
      await d.clickHere({ count: 1 });
      d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
      await d.hold(500, 70);
      await d.pause(550);
    } else {
      d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
    }
  }

  // 4. Switch Horizontal -> Vertical layout
  const dirBtn = await t.at('#btn-direction');
  if (dirBtn) {
    await d.glideTo(dirBtn.x, dirBtn.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(550, 70);
    await d.pause(900);
  }

  return { posterFrame: 0 };
}

/**
 * Sequence example:
 *  1. Collapse & expand a frame (opt stock available)
 *  2. Scroll down to show floating participant pills pinned at top, then scroll back up
 *  3. Select a message, add a call message and its reply
 */
async function runSequenceExample(t, d) {
  await t.open(join(ROOT, 'dev/samples/example-sequence.html'), '', { motion: true });
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.54, VIEW_H * 0.45, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(550);

  // 1. Collapse the "opt stock available" frame, pause, then expand it back
  const frameChev = await t.ev(`(() => {
    const list = [...document.querySelectorAll('.chevron')].map(e => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).filter(p => p.y > 100 && p.y < 600).sort((a, b) => a.y - b.y);
    return list[0] || null;
  })()`);
  if (frameChev) {
    await d.glideTo(frameChev.x, frameChev.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(420, 70);
    await d.pause(650);
    await d.clickHere({ count: 1 });
    await d.hold(420, 70);
    await d.pause(450);
  }

  // 2. Scroll down smoothly so participant headers pin as floating pills at the top
  await d.glideTo(VIEW_W * 0.5, VIEW_H * 0.5, { frames: 6, stepMs: 60 });
  await d.wheel(340, { steps: 9, stepMs: 65 });
  await d.pause(750);
  await d.wheel(-340, { steps: 8, stepMs: 65 });
  await d.pause(400);

  // 3. Dismiss frame selection, select the first message, add a call message, then add its reply
  await d.pressKey('Escape');
  await d.hold(160, 65);
  const firstMsg = await t.at('.seq-msg-label');
  if (firstMsg) {
    await d.glideTo(firstMsg.x, firstMsg.y, { frames: 7, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(220, 65);

    const addMsgBtn = await t.at('#btn-add-message');
    if (addMsgBtn) {
      await d.glideTo(addMsgBtn.x, addMsgBtn.y, { frames: 8, stepMs: 62 });
      await d.clickHere({ count: 1 });
      await d.hold(260, 70);
      await d.pressKey('a', { modifiers: 2 });
      await d.typeText('Check balance', { chunkSize: 4, stepMs: 65 });
      await d.pressKey('Enter');
      await d.hold(320, 70);

      // Clicking Message again on an open call adds the matching Reply arrow
      await d.clickHere({ count: 1 });
      await d.hold(260, 70);
      await d.pressKey('a', { modifiers: 2 });
      await d.typeText('Balance OK', { chunkSize: 4, stepMs: 65 });
      await d.pressKey('Enter');
      await d.hold(420, 70);
    }
  }
  await d.pause(850);

  return { posterFrame: 0 };
}

/**
 * ERD example:
 *  1. Zoom out below 50% to enter table overview mode, click a table to pop open its detail card
 *  2. Zoom back in to see all table details
 *  3. Drag & drop to add a new table
 *  4. Drag from a table's connect port to add a relationship connection
 *  5. Click "order" to highlight it and its related tables
 */
async function runErdExample(t, d) {
  await t.open(join(ROOT, 'dev/samples/example-erd.html'), '', { motion: true });
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.45, VIEW_H * 0.55, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(550);

  // 1. Zoom out until overview mode (<50% zoom) activates
  const zoomOut = await t.at('#btn-zoom-out');
  if (zoomOut) {
    await d.glideTo(zoomOut.x, zoomOut.y, { frames: 8, stepMs: 62 });
    for (let i = 0; i < 3; i++) {
      await d.clickHere({ count: 1 });
      await d.hold(220, 65);
    }
    await d.pause(550);

    // Click "order" in overview mode to open its detail card
    const orderOv = await t.at('.erd-entity[data-node-id="order"]');
    if (orderOv) {
      await d.glideTo(orderOv.x, orderOv.y, { frames: 8, stepMs: 62 });
      await d.clickHere({ count: 1 });
      await d.hold(350, 70);
      await d.pause(750);
    }
  }

  // 2. Zoom back in to see all table details cleanly
  const zoomReset = await t.at('#btn-zoom-reset');
  if (zoomReset) {
    await d.glideTo(zoomReset.x, zoomReset.y, { frames: 7, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(360, 70);
  }
  const zoomIn = await t.at('#btn-zoom-in');
  if (zoomIn) {
    await d.glideTo(zoomIn.x, zoomIn.y, { frames: 5, stepMs: 60 });
    await d.clickHere({ count: 1 });
    await d.hold(360, 70);
    await d.pause(450);
  }

  // 3. Drag & drop to add a new table onto empty canvas space
  const addTable = await t.at('#btn-add-table');
  if (addTable) {
    await d.glideTo(addTable.x, addTable.y, { frames: 8, stepMs: 62 });
    await d.dragTo(190, 240, { frames: 12, stepMs: 62 });
    await d.hold(350, 70);
    const isEditing = await t.ev(`!!(document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT'))`);
    if (isEditing) {
      await d.pressKey('a', { modifiers: 2 });
      await d.typeText('shipment', { chunkSize: 4, stepMs: 65 });
      await d.pressKey('Enter');
      await d.hold(300, 70);
    }
  }

  // 4. Add a connection by dragging from the new table's header port to "order"
  const newTableHead = await t.ev(`(() => {
    const list = [...document.querySelectorAll('.erd-entity:not(.erd-card-table)')];
    const t = list[list.length - 1];
    if (!t) return null;
    const r = t.querySelector('.erd-head').getBoundingClientRect();
    return { id: t.dataset.nodeId, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (newTableHead) {
    await d.glideTo(newTableHead.x, newTableHead.y, { frames: 7, stepMs: 62 });
    await d.hold(180, 65);
    const port = await t.at(`.erd-entity[data-node-id="${newTableHead.id}"] .erd-head .port:not(.port-end)`);
    const orderHead = await t.at('.erd-entity[data-node-id="order"] .erd-head');
    if (port && orderHead) {
      await d.glideTo(port.x, port.y, { frames: 5, stepMs: 60 });
      await d.dragTo(orderHead.x, orderHead.y, { frames: 11, stepMs: 62 });
      await d.hold(420, 70);
    }
  }

  // 5. Fit back to screen and click "order" to highlight it and all its related tables
  if (zoomReset) {
    await d.glideTo(zoomReset.x, zoomReset.y, { frames: 7, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(360, 70);
  }
  const orderFinal = await t.at('.erd-entity[data-node-id="order"] .erd-head');
  if (orderFinal) {
    await d.glideTo(orderFinal.x, orderFinal.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(400, 70);
  }
  await d.pause(900);

  return { posterFrame: 0 };
}

/**
 * Use Case example:
 *  1. Drag & drop to add an Actor and a Use Case
 *  2. Search by requirement ref (FR-4)
 *  3. Collapse and expand the Library system subject frame
 */
async function runUsecaseExample(t, d) {
  await t.open(join(ROOT, 'dev/samples/example-usecase.html'), '', { motion: true });
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.52, VIEW_H * 0.56, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(550);

  // 1a. Drag & drop a new Actor onto the left side of the canvas
  const addBtn = await t.at('#btn-add');
  if (!addBtn) throw new Error('Missing #btn-add');
  await d.glideTo(addBtn.x, addBtn.y, { frames: 8, stepMs: 62 });
  await d.clickHere({ count: 1 });
  await d.hold(200, 65);

  const actorBtn = await t.at('#btn-add-actor');
  if (actorBtn) {
    await d.glideTo(actorBtn.x, actorBtn.y, { frames: 6, stepMs: 60 });
    await d.dragTo(190, 260, { frames: 11, stepMs: 62 });
    await d.hold(320, 70);
    const ed = await t.ev(`!!(document.activeElement && document.activeElement.isContentEditable)`);
    if (ed) {
      await d.typeText('Guest', { chunkSize: 3, stepMs: 65 });
      await d.pressKey('Enter');
      await d.hold(260, 70);
    }
  }

  // 1b. Drag & drop a new Use Case into the Library system subject
  await d.glideTo(addBtn.x, addBtn.y, { frames: 7, stepMs: 62 });
  await d.clickHere({ count: 1 });
  await d.hold(200, 65);

  const ucBtn = await t.at('#btn-add-usecase');
  if (ucBtn) {
    await d.glideTo(ucBtn.x, ucBtn.y, { frames: 6, stepMs: 60 });
    await d.dragTo(590, 240, { frames: 11, stepMs: 62 });
    await d.hold(320, 70);
    const ed = await t.ev(`!!(document.activeElement && document.activeElement.isContentEditable)`);
    if (ed) {
      await d.typeText('Reserve Book', { chunkSize: 4, stepMs: 65 });
      await d.pressKey('Enter');
      await d.hold(300, 70);
    }
  }

  // 2. Search by requirement ref "FR-4"
  const searchBtn = await t.at('#btn-search');
  if (searchBtn) {
    await d.glideTo(searchBtn.x, searchBtn.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(200, 65);
    await d.typeText('FR-4', { chunkSize: 2, stepMs: 75 });
    await d.hold(420, 70);
    await d.pause(700);
    await d.pressKey('Escape');
    await d.hold(260, 70);
  }

  // 3. Collapse and expand the Library system subject frame
  const chev = await t.at('.chevron');
  if (chev) {
    await d.glideTo(chev.x, chev.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(450, 70);
    await d.pause(650);
    const chev2 = await t.at('.chevron');
    if (chev2) {
      await d.glideTo(chev2.x, chev2.y, { frames: 6, stepMs: 60 });
      await d.clickHere({ count: 1 });
      await d.hold(450, 70);
    }
  }
  await d.pause(750);

  return { posterFrame: 0 };
}

/**
 * C4 example:
 *  1. Collapse & expand the "Order Platform" system boundary
 *  2. Select a container, change its icon via the icon picker, and change its colour
 *  3. Drag & drop a new Database container onto the canvas
 */
async function runC4Example(t, d) {
  await t.open(join(ROOT, 'dev/samples/example-c4.html'), '', { motion: true });
  await t.ev(CURSOR_INSTALL_JS);

  await d.setCursor(VIEW_W * 0.54, VIEW_H * 0.58, false);
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 1.0);
  await d.pause(600);

  // 1. Collapse "Order Platform" to one box, hold, then expand it back
  const chevSel = '.chevron[aria-label*="Order Platform"]';
  const chev1 = await t.at(chevSel);
  if (chev1) {
    d.camera(1.3, chev1.x + 70, chev1.y + 70, 0.28);
    await d.glideTo(chev1.x, chev1.y, { frames: 9, stepMs: 62 });
    await d.clickHere({ count: 1 });
    d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
    await d.hold(520, 70);
    await d.pause(750);

    const chev2 = await t.at(chevSel);
    if (chev2) {
      await d.glideTo(chev2.x, chev2.y, { frames: 8, stepMs: 62 });
      await d.clickHere({ count: 1 });
      await d.hold(520, 70);
      await d.pause(550);
    }
  }

  // 2. Select API Gateway, open icon picker and pick a new icon, then change its colour
  const apiNode = await t.at('.c4-node[data-node-id="api"]');
  if (apiNode) {
    d.camera(1.45, apiNode.x, apiNode.y, 0.28);
    await d.glideTo(apiNode.x, apiNode.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(240, 65);

    const iconAct = await t.at('.c4-actionbar [data-act="icon"]');
    if (iconAct) {
      await d.glideTo(iconAct.x, iconAct.y, { frames: 6, stepMs: 60 });
      await d.clickHere({ count: 1 });
      await d.hold(280, 65);

      const pickIcon = await t.at('#c4-icons button[data-icon]:not([data-icon=""])');
      if (pickIcon) {
        await d.glideTo(pickIcon.x, pickIcon.y, { frames: 6, stepMs: 60 });
        await d.clickHere({ count: 1 });
        await d.hold(320, 70);
      }
    }

    // Change colour swatch on the floating action bar
    const swatch = await t.ev(`(() => {
      const list = [...document.querySelectorAll('.c4-actionbar [data-act="color"], .c4-actionbar .ab-swatch, .c4-actionbar [data-swatch]')];
      const pick = list[Math.min(2, list.length - 1)];
      if (!pick) return null;
      const r = pick.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (swatch) {
      await d.glideTo(swatch.x, swatch.y, { frames: 6, stepMs: 60 });
      await d.clickHere({ count: 1 });
      await d.hold(360, 70);
      await d.pause(450);
    }
  }

  // 3. Pull back and drag & drop a new Database item onto the canvas
  d.camera(1.0, VIEW_W / 2, VIEW_H / 2, 0.28);
  const addBtn = await t.at('#btn-add');
  if (addBtn) {
    await d.glideTo(addBtn.x, addBtn.y, { frames: 8, stepMs: 62 });
    await d.clickHere({ count: 1 });
    await d.hold(220, 65);

    const sysBtn = await t.at('#btn-add-system');
    if (sysBtn) {
      await d.glideTo(sysBtn.x, sysBtn.y, { frames: 6, stepMs: 60 });
      await d.clickHere({ count: 1 });
      await d.hold(360, 70);
      const ed = await t.ev(`!!(document.activeElement && document.activeElement.isContentEditable)`);
      if (ed) {
        await d.typeText('Analytics Engine', { chunkSize: 4, stepMs: 65 });
        await d.pressKey('Enter');
        await d.hold(320, 70);
      }
      // Drag the newly added system box to a clean spot on the left
      const newPos = await t.ev(`(() => {
        const list = [...document.querySelectorAll('.c4-node')];
        const last = list[list.length - 1];
        if (!last) return null;
        const r = last.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (newPos) {
        await d.glideTo(newPos.x, newPos.y, { frames: 6, stepMs: 60 });
        await d.dragTo(310, 460, { frames: 10, stepMs: 62 });
        await d.hold(360, 70);
      }
    }
  }
  await d.pause(850);

  return { posterFrame: 0 };
}

const SCENARIOS = {
  hero: { defaultOut: 'docs/img/demo.webp', run: runHero },
  flowchart: { defaultOut: 'docs/img/demo-flowchart.webp', run: runFlowchartExample },
  sequence: { defaultOut: 'docs/img/demo-sequence.webp', run: runSequenceExample },
  erd: { defaultOut: 'docs/img/demo-erd.webp', run: runErdExample },
  usecase: { defaultOut: 'docs/img/demo-usecase.webp', run: runUsecaseExample },
  c4: { defaultOut: 'docs/img/demo-c4.webp', run: runC4Example },
};

async function recordOne(browser, name, { outWebp, width, height, quality, keepFrames }) {
  const scenario = SCENARIOS[name];
  const framesDir = mkdtempSync(join(tmpdir(), `demo_${name}_`));
  console.log(`Recording "${name}" (${VIEW_W}x${VIEW_H} @ ${DPR}x -> ${width}x${height})...`);

  const t = await launch(browser);
  let meta = { posterFrame: 0 };
  const d = createDirector(t, framesDir);
  try {
    await t.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W,
      height: VIEW_H,
      deviceScaleFactor: DPR,
      mobile: false,
    });
    meta = (await scenario.run(t, d)) || meta;
  } finally {
    await t.close();
  }

  writeFileSync(
    join(framesDir, 'manifest.json'),
    JSON.stringify({ scenario: name, posterFrame: meta.posterFrame, frames: d.frames }, null, 2),
    'utf8',
  );

  mkdirSync(dirname(outWebp), { recursive: true });
  const enc = spawnSync(
    'python3',
    [
      join(HERE, 'encode_demo_webp.py'),
      framesDir,
      outWebp,
      '--width', String(width),
      '--height', String(height),
      '--quality', String(quality),
    ],
    { stdio: 'inherit' },
  );

  if (!keepFrames) {
    rmSync(framesDir, { recursive: true, force: true });
  } else {
    console.log(`Kept raw frames in ${framesDir}`);
  }

  if (enc.status !== 0) process.exit(enc.status || 1);
}

async function main() {
  const scenarioArg = argOf('scenario') || 'hero';
  const names = scenarioArg === 'all'
    ? Object.keys(SCENARIOS)
    : scenarioArg === 'examples'
      ? ['flowchart', 'sequence', 'erd', 'usecase', 'c4']
      : [scenarioArg];

  for (const name of names) {
    if (!SCENARIOS[name]) {
      console.error(`Unknown scenario "${name}". Available: ${Object.keys(SCENARIOS).join(', ')}, examples, all`);
      process.exit(1);
    }
  }

  const explicitOut = argOf('out');
  if (explicitOut && names.length > 1) {
    console.error('--out can only be used with a single scenario');
    process.exit(1);
  }

  const width = Number(argOf('width') || 800);
  const height = Number(argOf('height') || 450);
  const quality = Number(argOf('quality') || 72);
  const keepFrames = process.argv.includes('--keep-frames');

  const browser = findBrowser();
  if (!browser) {
    console.error('Could not find Chrome/Chromium. Set CHROME=/path/to/chrome.');
    process.exit(1);
  }

  for (const name of names) {
    const outWebp = resolve(ROOT, explicitOut || SCENARIOS[name].defaultOut);
    await recordOne(browser, name, { outWebp, width, height, quality, keepFrames });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
