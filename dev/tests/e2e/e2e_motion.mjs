// Motion system (FLIP kernel `motion` in assets/shell/shell.js, plan: dev/plans/plan-animations.md section 7.2) through all four
// diagram types. `motion` is a closure const, so the test probes it from outside: document.getAnimations() (WAAPI only),
// [data-motion-ghost] nodes, the stage transform and element rects. Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_motion.mjs --browser <chrome> --flowchart <html> --sequence <html> --erd <html> --usecase <html> [--tabs <html>]
//
// Pages come from `layout_engine.py --layout`: loan-application.json, checkout-with-fragments.json, example-erd.json,
// example-usecase.json (or any page of that type with a fragment / subject to toggle). --tabs is optional: a flowchart with
// subprocess tabs (laptop-purchase.mmd) for the tab-switch checks.
// Checks: (a) zero leak into SVG export and ?capture, (b) prefers-reduced-motion creates no animation, (c) bursts of 5 actions
// 30ms apart settle on exactly the layout of a motion-off run, with no orphan ghost, (d) pan stays 1:1 and takes over a glide.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
const pages = { flowchart: argOf('flowchart'), sequence: argOf('sequence'), erd: argOf('erd'), usecase: argOf('usecase') };
const tabsPage = argOf('tabs');
if (!browser || Object.values(pages).some((p) => !p)) {
  console.error('usage: --browser <chrome> --flowchart <html> --sequence <html> --erd <html> --usecase <html> [--tabs <html>]');
  process.exit(1);
}

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const J = JSON.stringify;
const ZOOM_IN = `document.getElementById('btn-zoom-in').click()`;
// WAAPI animations only: CSS transitions (hover and the like) are not the kernel's.
const WAAPI = `document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length`;
const GHOSTS = `document.querySelectorAll('[data-motion-ghost]').length`;
const STAGE = `document.getElementById('stage').style.transform`;
const HOOK = `window.__blobs = []; const __cou = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { if (b instanceof Blob) b.text().then((s) => window.__blobs.push({ type: b.type, text: s })); return __cou(b); }; true`;

// One structural action per type (each pushes an undo step and animates in normal mode). `i` alternates where an action toggles.
const TYPES = {
  flowchart: {
    rects: '.flow-node[data-node-id], .swimlane, .edge-label[data-edge-id]',
    // delete three steps first so Ctrl+Z / Ctrl+Y have something to flip
    prep: async () => { for (let i = 0; i < 3; i++) { await t.ev(t.drag('.flow-node')); await t.ev(t.key('Delete')); await sleep(500); } },
    act: (i) => t.key(i % 2 ? 'y' : 'z', { ctrlKey: true }),
  },
  sequence: {
    rects: '.seq-participant[data-node-id], .seq-msg-label[data-edge-id], .frame-tag[data-frag-id]',
    act: () => `document.querySelector('.seq-frag-focus').click()`,
  },
  erd: {
    rects: '.erd-entity[data-node-id], .edge-label[data-edge-id]',
    act: (i) => `document.querySelector('#columns-pop [data-detail="${['keys', 'names', 'all'][i % 3]}"]').click()`,
  },
  usecase: {
    rects: '.uc-actor[data-node-id], .uc-case[data-node-id], .uc-subject[data-subject-id]',
    act: () => `document.querySelector('.uc-subject .frame-chev').click()`,
  },
};
const undo = t.key('z', { ctrlKey: true });

async function setup(type, query = '') {
  await t.open(pages[type], query);
  await t.ev(HOOK);
  if (TYPES[type].prep) await TYPES[type].prep();
}
const snapshot = (type) => t.ev(`(() => ({
  rects: [...document.querySelectorAll(${J(TYPES[type].rects)})].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }),
  stage: ${STAGE}, waapi: ${WAAPI}, ghosts: ${GHOSTS} }))()`);
const nums = (s) => (String(s).match(/-?[\d.]+/g) || []).map(Number);
const maxDiff = (a, b) => (a.length !== b.length ? Infinity : Math.max(0, ...a.flat().map((v, i) => Math.abs(v - b.flat()[i]))));
const vpPoint = () => t.ev(`(() => { const vp = document.getElementById('viewport'), st = document.getElementById('stage'), r = vp.getBoundingClientRect();
  for (let y = r.top + 80; y < r.bottom - 120; y += 25) for (let x = r.left + 20; x < r.right - 20; x += 25) {
    const e = document.elementFromPoint(x, y); if (e === vp || e === st || e === st.firstElementChild) return { x, y }; } return null; })()`);

try {
  // ---------- (a) zero leak into exports and ?capture ----------
  await t.section('export-capture', async () => {
    for (const type of Object.keys(TYPES)) {
      await setup(type);
      const settled = await (async () => {
        await t.ev(`document.getElementById('btn-export').click()`);
        await t.ev(`document.querySelector('[data-export="svg"]').click()`); await sleep(800);
        return (await t.ev(`window.__blobs.splice(0)`)).find((b) => /svg/.test(b.type));
      })();
      // mid-flight: trigger the action and export in the same task, while WAAPI animations are running
      const flying = await t.ev(`(() => { ${TYPES[type].act(0)};
        const n = ${WAAPI};
        document.getElementById('btn-export').click(); document.querySelector('[data-export="svg"]').click(); return n; })()`);
      await sleep(800);
      const svg = (await t.ev(`window.__blobs.splice(0)`)).find((b) => /svg/.test(b.type));
      t.check(`${type}: the action animates before the export (control)`, flying > 0, `waapi=${flying}`);
      t.check(`${type}: a mid-animation SVG export has no ghost and no motion class`,
        !!svg && !/data-motion-ghost|motion-ghost-layer|motion-entering|motion-active/.test(svg.text), svg ? 'leak found' : 'no SVG blob');
      t.check(`${type}: a mid-animation export holds the settled layout (no inline transform from a FLIP)`,
        !!svg && !!settled && (svg.text.match(/transform:\s*translate\(/g) || []).length <= (settled.text.match(/transform:\s*translate\(/g) || []).length ,
        svg && settled ? `translate() styles mid=${(svg.text.match(/transform:\s*translate\(/g) || []).length} settled=${(settled.text.match(/transform:\s*translate\(/g) || []).length}` : '');
      await sleep(400);
      t.check(`${type}: no orphan ghost 400ms after`, (await t.ev(GHOSTS)) === 0, `${await t.ev(GHOSTS)}`);
    }
    // popover leaving (ghostExit) on the flowchart: lane delete confirm, Cancel
    await setup('flowchart');
    await t.ev(`document.querySelector('.swimlane:nth-child(2) .lane-pill').click()`);
    await t.ev(t.key('Delete'));
    const ghostSeen = await t.ev(`(() => { document.querySelector('.confirm-cancel').click(); return [!!document.querySelector('.confirm'), ${GHOSTS}]; })()`);
    t.check('flowchart: the confirm popover leaves the DOM at once; a ghost may play on', ghostSeen[0] === false, J(ghostSeen));
    await sleep(400);
    t.check('flowchart: the popover ghost is gone 400ms later', (await t.ev(GHOSTS)) === 0);

    for (const type of Object.keys(TYPES)) {
      await t.open(pages[type], '?capture');
      const s = await t.ev(`({ cap: document.body.classList.contains('capture'), settled: document.documentElement.dataset.diagramSettled, ghosts: ${GHOSTS}, waapi: ${WAAPI} })`);
      t.check(`${type}: ?capture is settled at load with no animation or ghost`, s.cap && s.settled === '1' && s.ghosts === 0 && s.waapi === 0, J(s));
      const after = await t.ev(`(() => { ${TYPES[type].act(0)}; ${ZOOM_IN}; return [${WAAPI}, ${GHOSTS}]; })()`);
      t.check(`${type}: in ?capture an action plays no animation`, after[0] === 0 && after[1] === 0, J(after));
    }
  });

  // ---------- (b) reduced motion ----------
  await t.section('reduced', async () => {
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      for (const type of Object.keys(TYPES)) {
        await setup(type);
        const probe = async (name, expr) => {
          const r = await t.ev(`(() => { ${expr}; return [${WAAPI}, ${GHOSTS}]; })()`);
          await sleep(60);
          r.push(await t.ev(WAAPI), await t.ev(GHOSTS));
          t.check(`reduced motion, ${type}: ${name} creates no animation and no ghost`, r.every((n) => n === 0), J(r));
        };
        await probe('the action', TYPES[type].act(0));
        await probe('Ctrl+Z', undo);
        await probe('Tidy', `document.getElementById('btn-auto-tidy')?.click()`);
        const z0 = await t.ev(`(${ZOOM_IN}, ${STAGE})`);
        await sleep(300);
        t.check(`reduced motion, ${type}: zoom-in jumps (no camera glide)`, (await t.ev(STAGE)) === z0, `${z0} -> ${await t.ev(STAGE)}`);
      }
      if (tabsPage) {
        await t.open(tabsPage);
        const n = await t.ev(`(() => { const b = [...document.querySelectorAll('.flow-tab[data-tab]')]; b[b.length - 1].click(); return [${WAAPI}, ${GHOSTS}, b.length]; })()`);
        t.check('reduced motion, flowchart: a tab switch creates no animation', n[0] === 0 && n[1] === 0 && n[2] > 1, J(n));
      }
    } finally {
      await t.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  // ---------- (c) interruption safety: bursts settle on the ?noanim layout ----------
  // Reference = the same burst with 700ms between steps (every animation finishes), so only the interruption differs.
  const bursts = {
    'five actions': (type) => async (gap) => { for (let i = 0; i < 5; i++) { await t.ev(TYPES[type].act(i)); await sleep(gap); } },
    'five Ctrl+Z': () => async (gap) => { for (let i = 0; i < 5; i++) { await t.ev(undo); await sleep(gap); } },
    'five zoom-in': () => async (gap) => { for (let i = 0; i < 5; i++) { await t.ev(ZOOM_IN); await sleep(gap); } },
  };
  const settle = async (type, burst, gap) => { await setup(type); await burst(gap); await sleep(900); return snapshot(type); };
  for (const type of Object.keys(TYPES)) {
    await t.section(`burst-${type}`, async () => {
      for (const [name, mk] of Object.entries(bursts)) {
        const got = await settle(type, mk(type), 30), ref = await settle(type, mk(type), 700);
        const d = maxDiff(got.rects, ref.rects);
        const sd = Math.max(0, ...nums(got.stage).map((v, i) => Math.abs(v - nums(ref.stage)[i])));
        t.check(`${type}, ${name} 30ms apart: rects settle within 1px of the slow run`, d < 1 && got.rects.length > 0, `maxDiff=${d} n=${got.rects.length}/${ref.rects.length}`);
        t.check(`${type}, ${name} 30ms apart: camera settles on the slow run's view`, sd < 1, `${got.stage} vs ${ref.stage}`);
        t.check(`${type}, ${name} 30ms apart: no orphan ghost or running animation after 900ms`, got.ghosts === 0 && got.waapi === 0, `ghosts=${got.ghosts} waapi=${got.waapi}`);
      }
    });
  }
  if (tabsPage) {
    await t.section('burst-tabs', async () => {
      TYPES.tabs = { rects: TYPES.flowchart.rects };
      const run = async (gap) => {
        await t.open(tabsPage);
        for (let i = 0; i < 5; i++) { await t.ev(`(() => { const b = [...document.querySelectorAll('.flow-tab[data-tab]')]; b[${i} % b.length].click(); })()`); await sleep(gap); }
        await sleep(900); return snapshot('tabs');
      };
      const got = await run(30), ref = await run(700);
      const d = maxDiff(got.rects, ref.rects);
      t.check('flowchart, five tab switches 30ms apart: rects settle within 1px of the slow run, no ghost', d < 1 && got.rects.length > 0 && got.ghosts === 0 && got.waapi === 0,
        `maxDiff=${d} n=${got.rects.length}/${ref.rects.length} ghosts=${got.ghosts} waapi=${got.waapi}`);
      t.check('flowchart, five tab switches 30ms apart: the fit camera equals the slow run\'s (scale within 0.002)', Math.abs(nums(got.stage)[2] - nums(ref.stage)[2]) < 0.002, `${got.stage} vs ${ref.stage}`);
      delete TYPES.tabs;
    });
  }

  // ---------- (c2) motion must not change what the page lays out + (d) direct manipulation ----------
  await t.section('layout-pan', async () => {
    const local = (type) => t.ev(`(() => { const st = document.getElementById('stage'), s = st.getBoundingClientRect(), k = s.width / st.offsetWidth;
      return [...document.querySelectorAll(${J(TYPES[type].rects)})].map((e) => { const r = e.getBoundingClientRect(); return [(r.left - s.left) / k, (r.top - s.top) / k, r.width / k, r.height / k]; }); })()`);
    for (const type of Object.keys(TYPES)) {
      await t.send('Emulation.setEmulatedMedia', { features: [] });
      await t.open(pages[type]); const on = await local(type);
      await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await t.open(pages[type]); const off = await local(type);
      await t.send('Emulation.setEmulatedMedia', { features: [] });
      t.check(`${type}: a page loads to the same layout with motion on and off`, maxDiff(on, off) < 1 && on.length > 0, `maxDiff=${maxDiff(on, off)} n=${on.length}/${off.length}`);
    }

    for (const type of Object.keys(TYPES)) {
      await setup(type);
      const p = await vpPoint();
      if (!p) { t.check(`${type}: found blank canvas to pan from`, false); continue; }
      const before = nums(await t.ev(STAGE));
      await t.dragTo(p.x, p.y, p.x + 60, p.y + 40, { steps: 6 });
      const raw = await t.ev(STAGE);
      const after = nums(raw);
      t.check(`${type}: a 60x40 drag pans exactly 60x40 at release (1:1, no lag)`, Math.abs(after[0] - before[0] - 60) < 2 && Math.abs(after[1] - before[1] - 40) < 2 && after[2] === before[2],
        `${before} -> ${after}`);
      t.check(`${type}: the stage transform keeps its translate(Xpx, Ypx) scale(S) form`, /^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)$/.test(raw), raw);
      // a pan takes over a running camera glide at once
      await t.ev(ZOOM_IN); await sleep(40);
      const q = await vpPoint();
      if (q) {
        await t.dragTo(q.x, q.y, q.x + 50, q.y, { steps: 4 });
        const atRelease = await t.ev(STAGE); await sleep(400);
        t.check(`${type}: a pan cancels the zoom glide (view frozen at release)`, (await t.ev(STAGE)) === atRelease && !(await t.ev(`document.getElementById('viewport').classList.contains('gesturing')`)),
          `${atRelease} -> ${await t.ev(STAGE)}`);
      }
    }
  });
  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
const r = t.finish();
process.exit(code || r);
