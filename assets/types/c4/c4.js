      // --- C4 DIAGRAM PLUGIN ---
      // Renders chartData (diagramType "c4") from the model engine.js lays out (Engine contract: dev/plans/plan-c4.md):
      // elements (people, systems, containers, databases, queues, externals) as tiles, groups as frames (a collapsed one is a
      // single system tile), the arrows in data._edges with their label pills, and the colour key. It selects, highlights the
      // arrows in and out of what is hovered, collapses and expands groups (also in one go through the Level control) and
      // searches. Editing (add, connect, label, icon picker) is a later step.
      //
      // x/y of elements and groups are the only saved positions (the "layout" map, toDisk); sizes, _edges, _hidden, _depth,
      // _collapsed, points, path, labelBox and canvas are derived by routeDiagram on every render and never saved.
      // Everything on screen is absolute within #c4-canvas. The plugin sits in its own function so its names cannot clash with the engine's.
      (function () {
      'use strict';

      const NS = 'http://www.w3.org/2000/svg';
      const canvas = document.getElementById('c4-canvas');
      const svg = document.getElementById('c4-svg');
      const edgesG = document.getElementById('c4-edges');
      const html = document.getElementById('c4-html');
      const levelBtns = [...document.querySelectorAll('.toolbar-center [data-level]')];

      // The generic glyph per kind (an element's own `icon` wins; a `logo:` name has no renderer yet and falls back to it) and the
      // palette slot per kind (an element's own `color` wins; an external system stays neutral)
      const KIND_ICON = { person: 'user', system: 'server', container: 'container', component: 'cpu', database: 'database', queue: 'queue', external: 'cloud' };
      const KIND_SLOT = { person: '1', system: '2', container: '3', component: '3', database: '4', queue: '4' };
      const KIND_NAME = { person: 'Person', system: 'Software system', container: 'Container', component: 'Component', database: 'Database', queue: 'Queue', external: 'External system' };
      const GROUP_SLOT = '2';   // a collapsed system group is drawn as a system tile

      // --- STATE ---
      let sel = null;          // { kind: 'element' | 'group' | 'edge', id }
      let hoverId = null;      // the element or collapsed group under the pointer
      let hoverEdgeId = null;
      const els = { nodes: new Map(), groups: new Map(), edges: new Map() };   // id -> element; edges: id -> { g, label }
      let byId = new Map();    // group id -> group (rebuilt each render)

      // --- MODEL ACCESS ---
      const groups = () => chartData.groups || [];
      const elements = () => chartData.elements || [];
      const edges = () => chartData._edges || [];
      const groupOf = (id) => byId.get(id) || groups().find((g) => g.id === id);
      const elementOf = (id) => elements().find((e) => e.id === id);
      const presenting = () => document.body.classList.contains('presentation');
      const placed = (o) => typeof o.x === 'number' && typeof o.y === 'number';
      const nameOf = (o) => (o && o.name != null ? String(o.name) : '');
      const showTech = () => chartData.showTech !== false;
      const px = (v) => `${v}px`;

      function svgEl(tag, attrs) {
        const el = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
        return el;
      }
      function htmlEl(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
      }
      // The arrowhead variants: the base marker is in stage.html, the others take the in / out / primary colour (--mk)
      const MARKERS = { '': null, in: '--edge-in', out: '--edge-out', sel: '--primary' };
      Object.keys(MARKERS).forEach((k) => {
        const base = document.getElementById('c4-mk');
        if (!k || !base) return;
        const copy = base.cloneNode(true);
        copy.id = `c4-mk-${k}`;
        copy.style.setProperty('--mk', `var(${MARKERS[k]})`);
        base.parentNode.appendChild(copy);
      });

      // --- GROUP TREE ---
      const parentGroup = (g) => (g.parent ? groupOf(g.parent) : null);
      function ancestors(g) {   // outermost last; a cycle is refused by the codec, the guard keeps a bad file from looping
        const out = [], seen = new Set([g.id]);
        for (let p = parentGroup(g); p && !seen.has(p.id); p = parentGroup(p)) { seen.add(p.id); out.push(p); }
        return out;
      }
      const depthOf = (g) => ancestors(g).length + 1;
      // The system levels a group sits in: boundaries are ownership frames and do not count, every other kind is one level
      const levelOf = (g) => [g].concat(ancestors(g)).filter((x) => x.kind !== 'boundary').length;
      const hiddenGroup = (g) => ancestors(g).some((a) => a.collapsed === true);
      const isTile = (g) => g.collapsed === true && !hiddenGroup(g);
      function descendants(g) {   // ids of the groups and elements inside g, at any depth
        const ids = [], kids = [g.id];
        for (let i = 0; i < kids.length; i++) {
          groups().forEach((x) => { if (x.parent === kids[i]) { ids.push(x.id); kids.push(x.id); } });
          elements().forEach((e) => { if (e.group === kids[i]) ids.push(e.id); });
        }
        return ids;
      }

      // --- RENDERING ---
      const FLIP_SPECS = [
        { selector: '.c4-node[data-node-id]', key: 'nodeId' },
        { selector: '.c4-group[data-group-id]', key: 'groupId' },
        { selector: '.edge-label[data-edge-id]', key: 'edgeId' }
      ];
      function captureEdges() {
        const m = new Map();
        edgesG.querySelectorAll('.c4-edge[data-edge-id]').forEach((g) => { const l = g.querySelector('.edge-line'); if (l) m.set(g.dataset.edgeId, l.getAttribute('d')); });
        return m;
      }
      // A new or re-routed arrow draws itself in; one that did not change stays as it is
      function playEdges(prev) {
        if (!prev || !motion.enabled()) return;
        edgesG.querySelectorAll('.c4-edge[data-edge-id]').forEach((g) => {
          const l = g.querySelector('.edge-line');
          if (l && prev.get(g.dataset.edgeId) !== l.getAttribute('d')) motion.drawPath(l, { duration: 160, easing: 'curve-out' });
        });
      }

      function render(opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        const useMotion = opts !== false && motion.enabled() && html.childElementCount > 0;
        const snap = o.snap || (useMotion ? motion.capture(canvas, FLIP_SPECS) : null);
        const prevEdges = useMotion ? (o.prevEdges || captureEdges()) : null;
        byId = new Map(groups().map((g) => [g.id, g]));
        routeDiagram(chartData);   // lays out afresh by itself when something visible has no x/y
        const C = chartData.canvas || { width: 800, height: 400 };
        canvas.style.width = px(C.width);
        canvas.style.height = px(C.height);
        svg.setAttribute('width', C.width);
        svg.setAttribute('height', C.height);
        const hadFocus = document.activeElement && html.contains(document.activeElement) && (document.activeElement.dataset.nodeId || document.activeElement.dataset.groupId);
        edgesG.textContent = '';
        html.textContent = '';
        els.nodes = new Map(); els.groups = new Map(); els.edges = new Map();
        if (sel && !selectionExists(sel)) sel = null;
        if (hoverId && !els.nodes.has(hoverId) && !elementOf(hoverId) && !groupOf(hoverId)) hoverId = null;

        groups().filter((g) => placed(g) && g.w > 0 && !hiddenGroup(g)).sort((a, b) => depthOf(a) - depthOf(b)).forEach((g) => {
          const el = buildGroup(g);
          els.groups.set(g.id, el);
          html.appendChild(el);
        });
        renderEdges();
        elements().forEach((e) => {
          if (e._hidden || !placed(e) || !(e.w > 0)) return;
          const el = buildNode(e);
          els.nodes.set(e.id, el);
          html.appendChild(el);
        });
        renderLabels();
        renderLegend();
        updateLevelButtons();
        applyState();
        const back = hadFocus && (els.nodes.get(hadFocus) || els.groups.get(hadFocus));
        if (back) back.focus({ preventScroll: true });
        if (snap) {
          motion.play(snap, canvas, FLIP_SPECS, { duration: o.duration, fromKey: o.fromKey, toKey: o.toKey });
          playEdges(prevEdges);
          if (o.afterPlay) o.afterPlay();
        }
      }
      const selectionExists = (s) => (s.kind === 'edge' ? edges().some((e) => e.id === s.id) : s.kind === 'group' ? !!groupOf(s.id) && !hiddenGroup(groupOf(s.id)) : !!elementOf(s.id) && !elementOf(s.id)._hidden);

      // The icon of an element: its own `icon`, else the generic one of its kind (`logo:` names are drawn by a later step)
      function iconOf(e) {
        const name = e.icon && ICONS[e.icon] !== undefined ? e.icon : KIND_ICON[e.kind] || 'box';
        return ICONS[name] !== undefined ? name : 'cloud';
      }
      const swatchOf = (o) => {
        const c = o && o.color ? colorSlot(o.color) : null;
        return c && (swatchSlot(c) || /^#[0-9a-f]{3,8}$/i.test(c)) ? c : null;
      };
      function paint(el, color, slot) {   // the swatch roles of the element's colour, else of the default slot of its kind; external: none
        if (color || slot) setSwatch(el, color || slot);
      }
      function ariaOf(e) { return [nameOf(e), KIND_NAME[e.kind] || e.kind, e.tech].filter(Boolean).join(', '); }

      function buildNode(e) {
        const el = htmlEl('div', 'c4-node');
        el.dataset.nodeId = e.id;
        el.dataset.kind = e.kind;
        el.tabIndex = -1;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', ariaOf(e));
        Object.assign(el.style, { left: px(e.x), top: px(e.y), width: px(e.w), height: px(e.h) });
        paint(el, e.color, KIND_SLOT[e.kind] || '9');   // external: the neutral slot
        const chip = htmlEl('span', 'c4-disc');
        chip.innerHTML = ui.icon(iconOf(e), { size: 'tile', fine: true });
        const text = htmlEl('span', 'c4-text');
        text.appendChild(htmlEl('span', 'c4-name t-title', nameOf(e)));
        if (e.tech && showTech()) text.appendChild(htmlEl('span', 'c4-tech t-detail', `[${e.tech}]`));
        if (e.description) text.appendChild(htmlEl('span', 'c4-desc t-detail', String(e.description)));
        el.append(chip, text);
        el.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); select({ kind: 'element', id: e.id }); } });
        hoverable(el, e.id);
        return el;
      }

      function chevron(g, collapsed) {
        const b = htmlEl('button', 'frame-chev');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.title = collapsed ? `Expand ${nameOf(g)}` : `Collapse ${nameOf(g)} to one box`;
        b.setAttribute('aria-label', b.title);
        b.setAttribute('aria-expanded', String(!collapsed));
        b.innerHTML = ui.icon('chevron-down', { size: 'sm', bold: true });
        b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleGroup(g.id); });
        return b;
      }
      function buildGroup(g) {
        const tile = isTile(g);
        const el = htmlEl('div', `c4-group ${tile ? 'is-tile' : 'is-frame'}`);
        el.dataset.groupId = g.id;
        el.dataset.kind = g.kind;
        Object.assign(el.style, { left: px(g.x), top: px(g.y), width: px(g.w), height: px(g.h) });
        if (tile) {
          // One system box: the tile of a system, dashed because it opens (the dashed summary of a collapsed frame)
          paint(el, g.color, g.kind === 'boundary' ? null : GROUP_SLOT);
          el.tabIndex = -1;
          el.setAttribute('role', 'group');
          el.setAttribute('aria-label', `${nameOf(g)}, ${g.kind === 'boundary' ? 'boundary' : 'software system'}, ${descendants(g).filter((id) => elementOf(id)).length} inside, collapsed`);
          const text = htmlEl('span', 'c4-text');
          text.appendChild(htmlEl('span', 'c4-name t-title', nameOf(g)));
          const n = descendants(g).filter((id) => elementOf(id)).length;
          text.appendChild(htmlEl('span', 'c4-desc t-detail', `${n} ${n === 1 ? 'element' : 'elements'} inside`));
          const chip = htmlEl('span', 'c4-disc');
          chip.innerHTML = ui.icon(KIND_ICON.system, { size: 'tile', fine: true });
          el.append(chip, text, chevron(g, true));
          el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); toggleGroup(g.id); });
          hoverable(el, g.id);
        } else {
          const tag = htmlEl('div', 'frame-tag c4-tag');
          const tint = swatchOf(g);   // a group's colour: a slot or custom hex, as a sequence frame's
          if (tint) { paint(el, tint); paint(tag, tint); }
          tag.tabIndex = -1;
          tag.setAttribute('role', 'group');
          tag.setAttribute('aria-label', `${nameOf(g)}, ${g.kind === 'boundary' ? 'boundary' : 'software system'}`);
          const hasKids = descendants(g).length > 0;
          if (hasKids) tag.appendChild(chevron(g, false));
          tag.appendChild(htmlEl('span', 'c4-tag-name', nameOf(g)));
          el.appendChild(tag);
        }
        el.addEventListener('pointerdown', (ev) => { if (ev.button === 0 && (tile || ev.target.closest('.frame-tag'))) { ev.stopPropagation(); select({ kind: 'group', id: g.id }); } });
        return el;
      }

      // --- ARROWS ---
      const edgeTitle = (e) => `${nameOf(elementOf(e.from) || groupOf(e.from))} → ${nameOf(elementOf(e.to) || groupOf(e.to))}: ${e.label || ''}${e.tech ? ` [${e.tech}]` : ''}${e.count > 1 ? ` (${e.count} relations)` : ''}`;
      function setMarkers(line) {
        line.style.setProperty('--mk-e', 'url(#c4-mk)');
        line.style.setProperty('--mk-e-in', 'url(#c4-mk-in)');
        line.style.setProperty('--mk-e-out', 'url(#c4-mk-out)');
        line.style.setProperty('--mk-e-sel', 'url(#c4-mk-sel)');
      }
      function renderEdges() {
        edges().forEach((e) => {
          if (!e.path) return;
          const g = svgEl('g', { class: `c4-edge${e.async ? ' is-async' : ''}`, 'data-edge-id': e.id, 'data-from': e.from, 'data-to': e.to });
          const tip = svgEl('title', { 'data-export-skip': '' });
          tip.textContent = edgeTitle(e);
          const line = svgEl('path', { class: 'edge-line', d: e.path });
          setMarkers(line);
          g.append(tip, svgEl('path', { class: 'edge-hit', d: e.path }), line);
          g.addEventListener('pointerenter', () => { hoverEdgeId = e.id; applyState(); });
          g.addEventListener('pointerleave', () => { if (hoverEdgeId === e.id) { hoverEdgeId = null; applyState(); } });
          g.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); select({ kind: 'edge', id: e.id }); } });
          edgesG.appendChild(g);
          els.edges.set(e.id, { g, label: null });
        });
      }
      function renderLabels() {
        edges().forEach((e) => {
          const b = e.labelBox, rec = els.edges.get(e.id);
          if (!b || !rec) return;
          const el = htmlEl('div', 'edge-label c4-label');
          el.dataset.edgeId = e.id;
          el.tabIndex = -1;
          Object.assign(el.style, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
          el.title = edgeTitle(e);
          el.appendChild(htmlEl('span', 'c4-label-text', `${e.label || ''}${e.count > 1 ? ` ×${e.count}` : ''}`));
          if (e.tech && showTech()) el.appendChild(htmlEl('span', 'c4-label-tech', `[${e.tech}]`));
          el.addEventListener('pointerenter', () => { hoverEdgeId = e.id; applyState(); });
          el.addEventListener('pointerleave', () => { if (hoverEdgeId === e.id) { hoverEdgeId = null; applyState(); } });
          el.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); select({ kind: 'edge', id: e.id }); } });
          html.appendChild(el);
          rec.label = el;
        });
      }

      // The colour key: the palette slots groups and elements use and what each means (colorKey); a slot with no label is left out
      let legendEl = null;
      function renderLegend() {
        const used = [];
        groups().concat(elements()).forEach((o) => { const c = swatchOf(o); if (c && swatchSlot(c) && !used.includes(c)) used.push(c); });
        legendEl = ui.colorKey(used, chartData.colorKey, { cls: 'c4-key' });
        if (!legendEl) return;
        html.appendChild(legendEl);
      }

      // --- SELECTION AND HOVER ---
      function select(s) {
        sel = s;
        applyState();
      }
      function hoverable(el, id) {
        el.addEventListener('pointerenter', (ev) => { if (ev.pointerType !== 'touch') { hoverId = id; applyState(); } });
        el.addEventListener('pointerleave', () => { if (hoverId === id) { hoverId = null; applyState(); } });
      }
      // What is lit: the arrows in (amber) and out (blue) of the hovered element, as the flowchart does; a lone selected element
      // lights its arrows too. A hover also greys out the arrows and elements that are not connected to it.
      function applyState() {
        const focusId = hoverId || (sel && sel.kind !== 'edge' ? sel.id : null);
        const near = new Set(focusId ? [focusId] : []);
        els.edges.forEach((rec, id) => {
          const e = edges().find((x) => x.id === id) || {};
          const out = !!focusId && e.from === focusId, inn = !!focusId && !out && e.to === focusId;
          if (out || inn) { near.add(e.from); near.add(e.to); }
          const isSel = !!sel && sel.kind === 'edge' && sel.id === id, hov = hoverEdgeId === id && !isSel;
          const line = rec.g.querySelector('.edge-line');
          [line, rec.label].forEach((x) => {
            if (!x) return;
            x.classList.toggle('hl-in', inn);
            x.classList.toggle('hl-out', out);
          });
          rec.g.classList.toggle('selected', isSel);
          rec.g.classList.toggle('hover', hov);
          if (rec.label) { rec.label.classList.toggle('selected', isSel); rec.label.classList.toggle('linked', hov); }
          const dim = !!hoverId && !out && !inn && !isSel;
          rec.g.classList.toggle('is-dim', dim);
          if (rec.label) rec.label.classList.toggle('is-dim', dim);
        });
        const items = [...els.nodes, ...[...els.groups].filter(([id]) => isTile(groupOf(id)))];
        items.forEach(([id, el]) => {
          el.classList.toggle('selected', !!sel && sel.kind !== 'edge' && sel.id === id);
          el.classList.toggle('is-dim', !!hoverId && !near.has(id));
          el.tabIndex = sel && sel.id === id ? 0 : -1;
        });
        if (!sel) { const first = items.length ? items[0][1] : null; if (first) first.tabIndex = 0; }
        els.groups.forEach((el, id) => { const t = el.querySelector('.frame-tag'); if (t) t.classList.toggle('selected', !!sel && sel.kind === 'group' && sel.id === id); });
      }

      // --- COLLAPSE, EXPAND AND LEVELS ---
      // One path for a chevron and for the Level control: set `collapsed` on some groups, route, and morph. A group that opens
      // morphs from its box into the frame (morphRect) and its contents grow out of that box (fromKey); a group that closes
      // morphs the other way and its contents shrink into the new box (toKey). Reduced motion jumps to the end state.
      function setCollapsed(changes) {
        changes = new Map([...changes].filter(([id, v]) => groupOf(id) && (groupOf(id).collapsed === true) !== v));
        if (!changes.size) return;
        const useMotion = motion.enabled() && html.childElementCount > 0;
        motion.cancelAll();
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null;
        const prevEdges = useMotion ? captureEdges() : null;
        const fromKey = {}, toKey = {};
        [...changes].sort((a, b) => depthOf(groupOf(a[0])) - depthOf(groupOf(b[0]))).forEach(([id, v]) => {   // the outermost group claims what is inside it
          descendants(groupOf(id)).forEach((d) => { const m = v ? toKey : fromKey; if (!(d in m) && !(d in fromKey) && !(d in toKey)) m[d] = id; });
        });
        const prev = new Map();
        if (snap) changes.forEach((v, id) => { const r = snap._raw.get(id); if (r) prev.set(id, r.vr); });
        changes.forEach((v, id) => { groupOf(id).collapsed = v; });
        render({
          snap, prevEdges, fromKey, toKey, duration: 220,
          afterPlay: () => prev.forEach((rect, id) => { const el = els.groups.get(id); if (el) motion.morphRect(rect, el, { duration: 220, easing: 'curve-spring-settle' }); })
        });
        updateStatus(true);
      }
      function toggleGroup(id) { const g = groupOf(id); if (g) setCollapsed(new Map([[id, g.collapsed !== true]])); }

      // LEVEL: "show to depth N". Level N opens the groups down to N - 1 system levels (Level 1 shows every system as one box;
      // boundaries are never touched, they hold no inside of their own) and closes the groups below that. The saved model keeps `collapsed` per group, never a level number.
      const levelsWanted = (n) => new Map(groups().filter((g) => g.kind !== 'boundary').map((g) => [g.id, levelOf(g) >= n]));
      const currentLevel = () => {
        const levels = levelBtns.map((b) => +b.dataset.level);
        return levels.find((n) => [...levelsWanted(n)].every(([id, v]) => (groupOf(id).collapsed === true) === v)) || null;
      };
      function updateLevelButtons() {
        const n = currentLevel();
        levelBtns.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.level === n)));
      }
      levelBtns.forEach((b) => b.addEventListener('click', () => setCollapsed(levelsWanted(+b.dataset.level))));

      // --- KEYBOARD ---
      // Enter or Space on a focused group tile opens it; the arrows move to the nearest element in that direction
      html.addEventListener('keydown', (ev) => {
        const item = ev.target.closest('.c4-node, .c4-group');
        if (!item || ev.target.closest('button')) return;
        const id = item.dataset.nodeId || item.dataset.groupId;
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (item.classList.contains('is-tile')) toggleGroup(id); else select({ kind: 'element', id });
        } else if (ev.key.startsWith('Arrow')) {
          const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
          const here = item.getBoundingClientRect(), hc = { x: here.left + here.width / 2, y: here.top + here.height / 2 };
          let best = null, bestScore = Infinity;
          [...els.nodes.values(), ...[...els.groups.values()].filter((g) => g.classList.contains('is-tile'))].forEach((el) => {
            if (el === item) return;
            const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - hc.x, dy = r.top + r.height / 2 - hc.y;
            const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
            if (along <= 0) return;
            const score = along + 2 * across;
            if (score < bestScore) { bestScore = score; best = el; }
          });
          if (best) { ev.preventDefault(); select({ kind: best.dataset.nodeId ? 'element' : 'group', id: best.dataset.nodeId || best.dataset.groupId }); best.focus(); }
        }
      });

      // --- DISK FORMAT ---
      // The same bytes as c4_to_disk / c4_from_disk in scripts/disk_format.py (contract: the codec spec above C4_KEYS there). A
      // page-made id (e_<ms>) is renamed to its name slug by the editing step, which is also what makes them.
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'arrange', 'showTech', 'showNotes', 'colorKey', 'groups', 'elements', 'relations', 'notes', 'layout'];
      const DISK_DERIVED = [['groups', ['w', 'h']], ['elements', ['w', 'h']], ['relations', ['points', 'labelBox']]];
      const DISK_OBJECTS = ['groups', 'elements', 'relations', 'notes'];
      const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        Object.keys(d).forEach((k) => { if (k === 'layout' || k === 'canvas' || (k[0] === '_' && k !== '_readme')) delete d[k]; });
        d.schemaVersion = 1;
        slotColors(d, 'elements', 'groups');
        DISK_OBJECTS.forEach((name) => (d[name] || []).forEach((o) => Object.keys(o).forEach((k) => { if (k[0] === '_') delete o[k]; })));
        DISK_DERIVED.forEach(([list, keys]) => (d[list] || []).forEach((o) => keys.forEach((k) => { delete o[k]; })));
        const layout = {};
        ['elements', 'groups'].forEach((list) => (d[list] || []).forEach((o) => {
          if (isNum(o.x) && isNum(o.y)) { layout[o.id] = { x: o.x, y: o.y }; delete o.x; delete o.y; }
        }));
        if (Object.keys(layout).length) d.layout = layout;
        const out = {};
        DISK_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }
      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        const layout = d.layout || {};
        delete d.layout;
        if (d.schemaVersion === undefined || d.schemaVersion === 1) {
          ['elements', 'groups'].forEach((list) => (d[list] || []).forEach((o) => Object.assign(o, layout[o.id] || {})));
        }
        slotColors(d, 'elements', 'groups');
        return d;
      }

      // --- REGISTER WITH THE SHELL ---
      const clearSelectionNow = () => { if (sel || hoverEdgeId) { sel = null; hoverEdgeId = null; applyState(); } };
      registerDiagramPlugin({
        id: 'c4',
        defaultTitle: 'Interactive C4 Diagram',
        toDisk,
        fromDisk,
        contentEl: canvas,
        report: { node: '.c4-node, .c4-group.is-tile', label: '.c4-label', labelText: '.c4-label-text', nodeText: '.c4-name' },
        render,
        isBackground: (el) => el === canvas || el === svg || el === html || el === legendEl,
        contentOverflow: () => (legendEl ? { top: 40 } : null),   // the colour key sits above the diagram
        clearSelection: clearSelectionNow,
        cancelInteraction: () => false,
        hasSelection: () => false,   // nothing can be deleted until the editing step
        deleteSelection() {},
        // Search: the live DOM, top to bottom then left to right: elements (name, technology, description), groups, arrow labels
        searchItems() {
          const out = [], clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const add = (id, el, text) => { text = clean(text); if (text && el) out.push({ id, text, el, y: parseFloat(el.style.top) || 0, x: parseFloat(el.style.left) || 0 }); };
          els.nodes.forEach((el, id) => add(`element:${id}`, el, el.textContent));
          els.groups.forEach((el, id) => add(`group:${id}`, el, nameOf(groupOf(id))));
          els.edges.forEach((rec, id) => add(`rel:${id}`, rec.label, rec.label && rec.label.textContent));
          return out.sort((a, b) => a.y - b.y || a.x - b.x).map(({ id, text, el }) => ({ id, text, el }));
        }
      });
      })();
