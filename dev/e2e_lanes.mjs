// Flowchart lane action bar: the colour row, rename, move earlier / later and delete over a selected lane's pill (the manual-parity
// plan, part A: everything the AI can set in a lane's `color` a person can set in the editor; the icon stays AI-only).
//   node dev/e2e_lanes.mjs --browser <chrome> --page <default.html> [--tb <default-tb.html>]
// --page: assets/types/flowchart/default.json (two lanes) laid out with `layout_engine.py --layout`.
// --tb (optional): the same with "direction": "TB", lanes as columns.
// Driven with real mouse and keyboard input (see cdp.mjs). Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), tb = argOf('tb');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html> [--tb <html>]'); process.exit(1); }
const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  const count = (sel) => t.ev(`document.querySelectorAll(${J(sel)}).length`);
  const text = (sel) => t.ev(`(document.querySelector(${J(sel)}) || {}).textContent ?? null`);
  const names = () => t.ev(`[...document.querySelectorAll('.lane-title')].map((e) => e.textContent)`);
  // The saved file's data block: flowchart lanes keep `color` in the trailing `layout` map; the lane order is `lanes`
  const saved = async () => {
    await t.press('s', { modifiers: 2 });
    await sleep(250);
    return JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
  };
  const colorOf = (d, name) => { const l = d.lanes.find((x) => x.name === name); return l && d.layout && d.layout[l.id] ? d.layout[l.id].color : undefined; };
  const sw = (i) => t.ev(`document.querySelectorAll('.swimlane')[${i}].dataset.sw`);
  const selectLane = (i) => t.clickOn(`.swimlane:nth-child(${i}) .lane-title`);
  const bar = (sel = '') => `.swimlane.lane-selected .lane-bar${sel}`;
  const undo = () => t.press('z', { modifiers: 2 });

  await t.open(page);
  const [a, b] = await names();
  // 1. Select the second lane: the bar shows (over its pill), the old tools do not
  await selectLane(2);
  t.check('selecting a lane shows its action bar and no .lane-tools', (await count(bar())) === 1 && (await count('.lane-tools')) === 0
    && await t.ev(`getComputedStyle(document.querySelector(${J(bar())})).display === 'flex'`));
  t.check('only the selected lane has a visible bar', await t.ev(`[...document.querySelectorAll('.lane-bar')].filter((e) => getComputedStyle(e).display !== 'none').length === 1`));
  t.check('the bar sits over the pill (or under it near the top of the window) and follows it', await t.ev(`(() => {
    const bar = document.querySelector(${J(bar())}), p = bar.parentElement.getBoundingClientRect(), r = bar.getBoundingClientRect();
    return bar.classList.contains('is-below') ? r.top >= p.bottom - 1 : r.bottom <= p.top + 1; })()`));
  t.check('the first lane has no earlier button and the last no later button',
    await t.ev(`(() => { const L = document.querySelectorAll('.swimlane'); return !L[0].querySelector('[data-act="earlier"]') && !!L[0].querySelector('[data-act="later"]')
      && !L[L.length - 1].querySelector('[data-act="later"]') && !!L[L.length - 1].querySelector('[data-act="earlier"]'); })()`));
  const auto = await sw(1);

  // 2. Colour: swatch 3 sets lane.color, none deletes it and the colour for its position returns
  await t.clickOn(bar(' .swatch-btn[data-value="3"]'));
  t.check('swatch 3 colours the lane', (await sw(1)) === '3' && (await count(bar())) === 1, await sw(1));
  t.check('the colour is saved as the lane\'s `color`', colorOf(await saved(), b) === '3');
  await t.clickOn(bar(' .swatch-btn[data-value=""]'));
  t.check('none gives the lane its colour by position again', (await sw(1)) === auto, `${await sw(1)} vs ${auto}`);
  t.check('and drops `color` from the saved file', colorOf(await saved(), b) === undefined);
  await undo();
  t.check('Ctrl+Z brings the colour back, one step per change', (await sw(1)) === '3');
  await undo();
  t.check('and Ctrl+Z again undoes the colouring', (await sw(1)) === auto);
  await selectLane(2);   // (undo clears the selection)
  await t.clickOn(bar(' .swatch-btn[data-value="3"]'));

  // 3. Rename from the bar: the name is editable, Enter commits, one undo step
  await t.clickOn(bar(' [data-act="rename"]'));
  t.check('Rename puts the name in edit and hides the bar', await t.ev(`document.activeElement.classList.contains('lane-title') && document.activeElement.isContentEditable`)
    && (await t.ev(`getComputedStyle(document.querySelector('.swimlane.lane-selected .lane-bar')).display`)) === 'none');
  await t.type('Billing');
  await t.press('Enter');
  t.check('Enter commits the new name', (await names())[1] === 'Billing', J(await names()));
  await undo();
  t.check('Ctrl+Z restores the old name', (await names())[1] === b);

  // 4. A third lane: move later / earlier, delete
  await t.clickOn('#btn-add-lane');
  await sleep(300);
  t.check('adding a lane makes three', (await count('.swimlane')) === 3);
  await selectLane(1);
  await t.clickOn(bar(' [data-act="later"]'));
  const afterLater = await names();
  t.check('Move later swaps the lane with the next one', afterLater[1] === a && afterLater[0] === b, J(afterLater));
  t.check('the moved lane stays selected with its bar', (await count(bar())) === 1 && await t.ev(`document.querySelector(${J(bar())}).closest('.swimlane').querySelector('.lane-title').textContent`) === a);
  await t.clickOn(bar(' [data-act="earlier"]'));
  t.check('Move earlier puts it back', J(await names()) === J([a, b, afterLater[2]]), J(await names()));
  await undo();
  t.check('Ctrl+Z undoes a move', (await names())[1] === a);
  await undo();
  t.check('and the next Ctrl+Z undoes the first move', (await names())[0] === a && (await names())[1] === b);
  const d = await saved();
  t.check('Save keeps the lane order and colour', d.lanes.map((l) => l.name)[0] === a && colorOf(d, b) === '3', J(d.lanes.map((l) => l.name)));

  // 5. Delete asks first; the last lane has none
  await selectLane(3);
  await t.clickOn(bar(' [data-act="delete"]'));
  t.check('Delete asks for confirmation', (await count('.confirm')) === 1 && (await count('.swimlane')) === 3);
  await t.ev(`document.querySelector('.confirm-ok').click()`);
  t.check('confirming deletes the lane', (await count('.swimlane')) === 2);
  await undo();
  t.check('Ctrl+Z restores it', (await count('.swimlane')) === 3);
  await selectLane(1);
  await t.clickOn(bar(' [data-act="delete"]'));
  await t.ev(`document.querySelector('.confirm-ok').click()`);
  await selectLane(1);
  await t.clickOn(bar(' [data-act="delete"]'));
  await t.ev(`document.querySelector('.confirm-ok').click()`);
  await selectLane(1);
  t.check('the only lane left has no delete button (nor move buttons)', (await count('.swimlane')) === 1 && (await count(bar())) === 1
    && (await count(bar(' [data-act="delete"], .lane-bar [data-act="later"], .lane-bar [data-act="earlier"]'))) === 0);
  for (let i = 0; i < 2; i++) await undo();

  // 6. Never in an export, never in ?present
  await selectLane(2);
  await t.ev(`window.__svg = ''; URL.createObjectURL = (blob) => { blob.text().then((x) => { window.__svg = x; }); return 'blob:test'; }; HTMLAnchorElement.prototype.click = function () {};`);
  await t.ev(`document.getElementById('btn-export').click()`);
  await t.ev(`document.querySelector('[data-export="svg"]').click()`);
  await sleep(600);
  const svg = await t.ev(`window.__svg`);
  t.check('an SVG export has the lane names but no action bar', svg.includes('<svg') && svg.includes(a) && !/Rename the lane|Move one place|Delete swimlane/.test(svg), svg.slice(0, 120));
  await t.open(page, '?present');
  await t.clickOn('.swimlane:nth-child(2) .lane-title');
  t.check('?present has no bar, even for a clicked lane', (await count('.lane-bar')) === 0 && (await count('.actionbar')) === 0);

  // 7. Top to bottom: lanes are columns; the bar still shows and moves them sideways
  if (tb) {
    await t.open(tb);
    await selectLane(1);
    t.check('top to bottom: the bar shows and its arrows turn sideways', await t.ev(`(() => {
      const m = document.querySelector('.swimlane.lane-selected .lane-bar [data-act="later"]'); return !!m && getComputedStyle(m.querySelector('svg')).rotate !== 'none' && /right/.test(m.title); })()`));
    const first = (await names())[0];
    await t.clickOn(bar(' [data-act="later"]'));
    t.check('top to bottom: Move later moves the column right', (await names())[1] === first, J(await names()));
  }

  // 8. Touch: a tap on a pill selects the lane and a tap on a swatch colours it (the pointer events a finger produces)
  await t.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: true });
  await t.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await t.open(page);
  const tap = async (sel) => {
    const p = await t.at(sel);
    await t.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
    await t.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  await tap('.swimlane:nth-child(2) .lane-title');
  const before = await sw(1);
  await tap(bar(' .swatch-btn[data-value="5"]'));
  t.check('touch: tapping the pill shows the bar and tapping a swatch colours the lane', (await sw(1)) === '5' && before !== '5', `${before} -> ${await sw(1)}`);
  await t.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false });

  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
  code = t.finish();
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
