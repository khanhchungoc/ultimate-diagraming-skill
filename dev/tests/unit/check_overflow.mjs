// Text overflow check for generated pages: opens each page and lists every element whose text sticks out of its
// box, is cut by overflow (ellipsis), or runs past its line clamp. Used to prove a wide theme font (Phase 6) leaves
// no label overflowing. Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/check_overflow.mjs --browser <chrome> <page.html> [<page.html> ...]
//
// Exit codes: 0 no overflow, 1 setup error, 2 overflow found.
import { argOf, launch } from '../e2e/cdp.mjs';

const browser = argOf('browser');
const pages = process.argv.slice(2).filter((a, i, all) => a.endsWith('.html') && all[i - 1] !== '--browser');
if (!browser || !pages.length) { console.error('usage: --browser <chrome> <page.html> ...'); process.exit(1); }

const SCAN = `(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim() || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(el.tagName)) continue;
    seen.add(el);
    const cs = getComputedStyle(el), box = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || !box.width || !box.height || el.closest('[hidden], .modal, #help-dialog')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const t = r.getBoundingClientRect();
    const clipped = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
    const clamped = cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2;
    const sticks = t.width > 0 && (t.right > box.right + 1 || t.left < box.left - 1);
    if (clipped || clamped || sticks) out.push((el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : el.tagName) + ' "' + n.textContent.trim().slice(0, 30) + '" ' + (clipped ? 'clipped ' : '') + (clamped ? 'clamped ' : '') + (sticks ? 'sticks-out' : ''));
  }
  return out;
})()`;

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let bad = 0;
try {
  for (const p of pages) {
    await t.open(p);
    const found = await t.ev(SCAN);
    bad += found.length;
    console.log(`${found.length ? '[FAIL]' : '[PASS]'} ${p.split('/').pop()}: ${found.length} overflowing text${found.length === 1 ? '' : 's'}`);
    found.slice(0, 8).forEach((f) => console.log('   ' + f));
  }
} finally { await t.close(); }
process.exit(bad ? 2 : 0);
