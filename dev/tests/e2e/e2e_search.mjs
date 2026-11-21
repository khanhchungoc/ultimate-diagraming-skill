// Interaction test for text search (plan: dev/plans/search.md). Written against the spec and the plugin contract
// (searchItems() -> [{id,text,el}], debug hook window.__searchItems()), so it works on any diagram type.
//
//   node dev/e2e_search.mjs --browser <chrome> --page <laid-out.html> --type <flowchart|sequence|erd|usecase> [-v|--verbose]
//
// --page: page produced by `layout_engine.py --layout` for a fixture of that type.
// The query is picked from the page itself: the first word (3+ letters) found in two or more items, else the first item's.
// Covers spec cases 1-8 and 10 for every type, case 9 only with --type erd and an item id starting "colsof:".
// Case 8 (Save): headless Chrome has no file picker, so the test removes showSaveFilePicker and captures the blob of the
// download fallback; that blob is the HTML the save path writes.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { existsSync } from 'node:fs';
import { argOf, isVerbose, launch, sleep } from './cdp.mjs';

const verbose = isVerbose();

const browser = argOf('browser'), page = argOf('page'), type = argOf('type');
if (!browser || !page || !['flowchart', 'sequence', 'erd', 'usecase'].includes(type)) {
  console.error('usage: node dev/e2e_search.mjs --browser <chrome> --page <html> --type <flowchart|sequence|erd|usecase>');
  process.exit(1);
}
if (!existsSync(page)) { console.error(`[ERROR] page not found: ${page}`); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const J = JSON.stringify;
// Page-side helpers, installed after every load.
const HELPERS = `window.__T = {
  norm: (s) => String(s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(),
  vis: (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  setQuery(q) { const i = document.getElementById('search-input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); },
  keyOn(el, key, extra) { const e = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {})); const notPrevented = el.dispatchEvent(e); return !notPrevented; },
  matches(q) { const n = this.norm(q); const els = []; for (const it of window.__searchItems()) if (this.norm(it.text).includes(n) && !els.includes(it.el)) els.push(it.el); return els; },
  counter() { const m = /(\\d+)\\s*\\/\\s*(\\d+)/.exec(document.getElementById('search-count').textContent); return m ? { k: +m[1], n: +m[2] } : null; },
  state(q) {
    const all = [...new Set(window.__searchItems().map((i) => i.el))], hit = this.matches(q), c = this.counter();
    const cur = [...document.querySelectorAll('.search-current')];
    return { c, hits: hit.length,
      dimOk: all.every((el) => hit.includes(el) !== el.classList.contains('search-dim')),
      curOk: !!c && cur.length === 1 && cur[0] === hit[c.k - 1],
      dimCount: document.querySelectorAll('.search-dim').length, curCount: cur.length };
  },
  centre() {
    const el = document.querySelector('.search-current'); if (!el) return null;
    const r = el.getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect();
    return { dx: Math.abs(r.left + r.width / 2 - (v.left + v.width / 2)) / v.width, dy: Math.abs(r.top + r.height / 2 - (v.top + v.height / 2)) / v.height };
  },
  pickQuery() {
    const items = window.__searchItems(); if (!items.length) return null;
    const words = []; for (const it of items) for (const w of String(it.text).split(/[^\\p{L}\\p{N}]+/u)) if (w.length >= 3) words.push(w);
    for (const w of words) { const n = this.matches(w).length; if (n >= 2 && n < new Set(items.map((i) => i.el)).size) return w; }
    return words[0] || String(items[0].text).trim();
  },
};
window.__blobs = []; const __cou = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { if (b instanceof Blob) b.text().then((s) => window.__blobs.push({ type: b.type, text: s })); return __cou(b); };
true`;
const T = (expr) => t.ev(`window.__T.${expr}`);
const visible = (id) => T(`vis(document.getElementById(${J(id)}))`);
const press = (id, key, extra) => T(`keyOn(document.getElementById(${J(id)}), ${J(key)}, ${J(extra || {})})`);
const settle = () => sleep(450);
const classLeak = /class="[^"]*\bsearch-(dim|current)\b/;

try {
  await t.open(page);
  await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await t.ev(HELPERS);

  const missing = await t.ev(`['btn-search','search-bar','search-input','search-count','search-prev','search-next']
    .filter((id) => !document.getElementById(id)).concat(typeof window.__searchItems === 'function' ? [] : ['window.__searchItems'])`);
  t.check('search UI and debug hook exist', missing.length === 0, 'missing: ' + missing.join(', '));
  const nItems = missing.length ? 0 : await t.ev(`window.__searchItems().length`);
  if (!missing.length) t.check('searchItems() returns items with id, text, el', nItems > 0 && await t.ev(`window.__searchItems().every((i) => i.id && typeof i.text === 'string' && i.el instanceof Element)`), `items=${nItems}`);
  const q = missing.length || !nItems ? null : await T('pickQuery()');
  if (!q) {
    console.error('[ERROR] cannot continue: ' + (missing.length ? 'search UI missing (is this a page built with the search feature?)' : 'no search items on this page (does the plugin implement searchItems()?)'));
    code = 2;
  } else {
    if (verbose) console.log(`query: ${J(q)} (${await T(`matches(${J(q)}).length`)} matches of ${nItems} items)`);

    // 1. Ctrl+F opens and focuses; inside a text field it does not
    t.check('bar starts closed', !(await visible('search-bar')));
    const prevented = await T(`keyOn(document.body, 'f', { ctrlKey: true })`);
    t.check('Ctrl+F opens the bar, focuses the input and takes over the key',
      (await visible('search-bar')) && (await t.ev(`document.activeElement.id`)) === 'search-input' && prevented);
    await press('search-input', 'Escape');
    t.check('Esc closes the bar', !(await visible('search-bar')));
    await T(`keyOn(document.body, 'f', { ctrlKey: true })`);
    await t.ev(`document.getElementById('chart-title').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    t.check('a click elsewhere closes an empty search bar', !(await visible('search-bar')));
    await t.ev(`(() => { const h = document.getElementById('chart-title'); h.contentEditable = 'true'; h.focus(); })()`);
    const prevented2 = await T(`keyOn(document.activeElement, 'f', { ctrlKey: true })`);
    t.check('Ctrl+F inside the title field leaves the browser find alone', !(await visible('search-bar')) && !prevented2);
    await t.ev(`(() => { const h = document.getElementById('chart-title'); h.blur(); h.contentEditable = 'false'; })()`);

    // 10. zero matches
    await t.ev(`document.getElementById('btn-search').click()`);
    await T(`setQuery('zzqxjv-no-such-text')`); await settle();
    t.check('0 matches: counter says "No matches", Previous and Next disabled',
      /no matches/i.test(await t.ev(`document.getElementById('search-count').textContent`)) &&
      await t.ev(`document.getElementById('search-prev').disabled && document.getElementById('search-next').disabled`));

    // 2 + 5. count and classes
    await T(`setQuery(${J(q)})`); await settle();
    let s = await T(`state(${J(q)})`);
    t.check('counter shows the same count as window.__searchItems() matching', !!s.c && s.c.n === s.hits && s.hits > 0, J(s));
    t.check('non-matches carry search-dim, exactly the current match carries search-current', s.dimOk && s.curOk, J(s));
    const labelOk = await t.ev(`['search-prev','search-next'].every((id) => { const b = document.getElementById(id), r = b.getBoundingClientRect();
      return r.width >= 24 && r.height >= 24 && b.getAttribute('aria-label') === (id === 'search-next' ? 'Next match' : 'Previous match'); })`);
    t.check('Previous and Next have aria-labels and are at least 24 x 24 px', labelOk);
    if (!s.c) throw new Error('counter has no "k / n" text, cannot navigate');

    // 3. next / Enter centre the match
    const n = s.c.n, k0 = s.c.k;
    await press('search-input', 'Enter'); await settle();
    s = await T(`state(${J(q)})`);
    let ctr = await T('centre()');
    t.check('Enter goes to the next match', !!s.c && s.c.k === (k0 % n) + 1 && s.curOk, J(s.c));
    t.check('the current match is centred within 10% of the viewport centre', !!ctr && ctr.dx <= 0.1 && ctr.dy <= 0.1, J(ctr));
    const k1 = s.c.k;
    await t.ev(`document.getElementById('search-next').click()`); await settle();
    s = await T(`state(${J(q)})`); ctr = await T('centre()');
    t.check('Next button goes to the next match and centres it', s.c.k === (k1 % n) + 1 && !!ctr && ctr.dx <= 0.1 && ctr.dy <= 0.1, J({ c: s.c, ctr }));

    // 4. previous, wrap both ways
    const k2 = s.c.k;
    await t.ev(`document.getElementById('search-prev').click()`); await settle();
    s = await T(`state(${J(q)})`);
    t.check('Previous button goes back', s.c.k === ((k2 - 2 + n) % n) + 1, J(s.c));
    const k3 = s.c.k;
    await press('search-input', 'Enter', { shiftKey: true }); await settle();
    s = await T(`state(${J(q)})`);
    t.check('Shift+Enter goes back', s.c.k === ((k3 - 2 + n) % n) + 1, J(s.c));
    for (let i = 0; i < n && (await T('counter().k')) !== 1; i++) await press('search-input', 'Enter', { shiftKey: true });
    await press('search-input', 'Enter', { shiftKey: true }); await settle();
    t.check('Previous wraps from the first match to the last', (await T('counter().k')) === n);
    await press('search-input', 'Enter'); await settle();
    t.check('Next wraps from the last match to the first', (await T('counter().k')) === 1);

    // 6. a render keeps the highlight and the index (the theme toggle calls plugin.render(); toggled back after)
    if (n > 1) { await press('search-input', 'Enter'); await settle(); }
    const before = await T(`state(${J(q)})`);
    await t.ev(`document.getElementById('btn-theme').click()`); await settle();
    s = await T(`state(${J(q)})`);
    await t.ev(`document.getElementById('btn-theme').click()`); await settle();
    t.check('a re-render keeps the highlight and the current index',
      s.dimOk && s.curOk && s.c.k === before.c.k && s.c.n === before.c.n,
      J({ before: before.c, after: s.c, dimOk: s.dimOk, curOk: s.curOk }));

    // 8. export and Save carry no search classes (state is still active, so the check is not vacuous)
    const active = await T(`state(${J(q)})`);
    await t.ev(`document.getElementById('btn-export').click()`);
    await t.ev(`document.querySelector('[data-export="svg"]').click()`); await sleep(800);
    const blobs = await t.ev(`window.__blobs.splice(0)`);
    const svg = blobs.find((b) => /svg/.test(b.type));
    t.check('SVG export contains no search-dim / search-current class',
      active.dimCount + active.curCount > 0 && !!svg && svg.text.length > 200 && !classLeak.test(svg.text),
      svg ? `leak=${classLeak.test(svg.text)} len=${svg.text.length}` : 'no SVG blob captured');
    const original = await t.ev(`document.getElementById('diagram-data').textContent`);
    const sameData = (txt) => { try { return JSON.stringify(JSON.parse(txt)) === JSON.stringify(JSON.parse(original)); } catch { return false; } };
    await t.ev(`delete window.showSaveFilePicker; window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await sleep(1000);
    const saved = (await t.ev(`window.__blobs.splice(0)`)).find((b) => /html/.test(b.type));
    const data = saved ? (/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/.exec(saved.text) || [])[1] || '' : '';
    t.check('Save writes HTML with no search-dim / search-current class and no search state in the data',
      !!saved && saved.text.includes('id="diagram-data"') && !classLeak.test(saved.text) && sameData(data),
      saved ? `classLeak=${classLeak.test(saved.text)} sameData=${sameData(data)}` : 'no HTML blob captured (save path not reachable)');

    // 7. Esc closes and clears
    await t.ev(`document.getElementById('btn-search').click()`);
    await t.ev(`document.getElementById('search-input').focus()`);
    await press('search-input', 'Escape'); await settle();
    t.check('Esc closes the bar and leaves no search-dim / search-current in the DOM',
      !(await visible('search-bar')) && (await t.ev(`document.querySelectorAll('.search-dim, .search-current').length`)) === 0);

    // 9. ERD collapsed table
    if (type !== 'erd') console.log('[SKIP] case 9 (collapsed ERD table): --type is not erd');
    else {
      const col = await t.ev(`(() => { const it = window.__searchItems().find((i) => String(i.id).startsWith('colsof:')); if (!it) return null;
        const w = String(it.text).split(/[^\\p{L}\\p{N}]+/u).find((x) => x.length >= 3); return { id: it.id, w: w || it.text }; })()`);
      if (!col) console.log('[SKIP] case 9 (collapsed ERD table): no item id starts with "colsof:" on this page (collapse a table in the fixture)');
      else {
        await t.ev(`document.getElementById('btn-search').click()`);
        await T(`setQuery(${J(col.w)})`); await settle();
        const r = await t.ev(`(() => { const T = window.__T, hits = T.matches(${J(col.w)}), items = window.__searchItems(), el = items.find((i) => i.id === ${J(col.id)}).el;
          const c = T.counter(); let ringed = false;
          for (let i = 0; i < (c ? c.n : 0) && !ringed; i++) { ringed = el.classList.contains('search-current'); if (!ringed) document.getElementById('search-next').click(); }
          return { n: c && c.n, hits: hits.length, ringed }; })()`);
        t.check('a column match in a collapsed table counts once and rings that table\'s header', r.n === r.hits && r.ringed, J(r));
      }
    }
  }
  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
  code = Math.max(code, t.finish());
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
