      // --- USE CASE DIAGRAM PLUGIN ---
      // Renders chartData (diagramType "usecase") from the model engine.js lays out: actors (a stick figure, or an icon tile
      // for a system or a clock), use cases (ellipses; level = size and outline), subjects (the boundaries), the four line
      // styles (association, include, extend, generalization) and notes; and edits it: add, connect, rename, colour,
      // multi-select, move between subjects, delete. Every finished edit ends in one updateStatus(true) (one undo step).
      //
      // Model (see the Engine contract in dev/plans/plan-usecase.md): x/y of actors and use cases are the only positions
      // that are saved (the "layout" map, toDisk); sizes, _lines, subject boxes, points, labelBox, _parents and canvas are
      // derived on every render (routeDiagram) and never saved. Everything on screen is absolute within #uc-canvas.
      // The plugin sits in its own function so its names cannot clash with the engine's.
      (function () {
      'use strict';

      const NS = 'http://www.w3.org/2000/svg';
      const canvas = document.getElementById('uc-canvas');
      const svg = document.getElementById('uc-svg');
      const linksG = document.getElementById('uc-links');
      const leadersG = document.getElementById('uc-note-leaders');
      const html = document.getElementById('uc-html');
      const btnRefs = document.getElementById('btn-refs');
      const btnLevels = document.getElementById('btn-levels');
      const btnNotes = document.getElementById('btn-notes');
      const btnAutoLayout = document.getElementById('btn-auto-layout');
      const searchEl = document.getElementById('uc-search');
      const searchCount = document.getElementById('uc-search-count');
      const searchFit = document.getElementById('uc-search-fit');
      const searchClear = document.getElementById('uc-search-clear');

      const LINK_TYPES = ['association', 'include', 'extend'];
      const KIND_ICON = { human: 'user', system: 'server', time: 'clock' };   // drawn in a round avatar
      const KIND_CAPTION = { system: '«system»', time: '«time»' };
      const LEVELS = ['summary', 'user', 'subfunction'];
      const LEVEL_NAME = { summary: 'Summary', user: 'Goal', subfunction: 'Sub' };
      const SIZE = { actor: [104, 104], tile: [104, 120], useCase: [150, 60], subject: [280, 180] };   // a ghost's and a new item's first size

      // --- STATE ---
      let selIds = [];            // selected actors and use cases (primary last)
      let selOther = null;        // { kind: 'link' | 'subject' | 'note', id }
      let hoverLinkId = null;
      let hoverItemId = null;     // the actor or use case under the pointer: what it connects to directly stays lit, the rest dims
      let actorSw = new Map();    // actor id -> its colour slot (its own colour, else one picked for it; see actorSlots)
      let searchQ = '';
      let searchIds = [];
      let levelsOn = true;        // view only: off hides the subfunction use cases
      let autoTidy = true;        // an editing preference of this browser, not part of the file
      try { autoTidy = localStorage.getItem('usecase-auto-tidy') !== 'off'; } catch (e) {}
      let uidCounter = 0;
      const uid = (prefix) => `${prefix}_${Date.now()}_${uidCounter++}`;
      const els = { items: new Map(), links: new Map(), subjects: new Map(), parents: [] };

      // --- MODEL ACCESS ---
      const actors = () => chartData.actors || [];
      const cases = () => chartData.useCases || [];
      const linksOf = () => chartData.links || [];
      const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
      const actorOf = (id) => actors().find((a) => a.id === id);
      const caseOf = (id) => cases().find((u) => u.id === id);
      const itemOf = (id) => actorOf(id) || caseOf(id);
      const kindOf = (id) => (actorOf(id) ? 'actor' : caseOf(id) ? 'case' : null);
      const linkOf = (id) => linksOf().find((l) => l.id === id);
      const noteOf = (id) => notesList().find((n) => n.id === id);
      const realSubjects = () => (Array.isArray(chartData.subjects) ? chartData.subjects : []);
      const allSubjects = () => (realSubjects().length ? realSubjects() : (chartData._subjects || []));
      const subjectOf = (id) => allSubjects().find((s) => s.id === id);
      const caseSubjectId = (u) => (u.subject && subjectOf(u.subject) ? u.subject : (allSubjects()[0] || {}).id);
      const presenting = () => document.body.classList.contains('presentation');
      const placed = (o) => typeof o.x === 'number' && typeof o.y === 'number';
      const nameOf = (o) => (o && o.name != null && String(o.name) !== '' ? String(o.name) : '');
      const boxOf = (o) => ({ x: o.x, y: o.y, w: o.w || 0, h: o.h || 0 });
      const isHiddenCase = (u) => !!u._hidden || (!levelsOn && u.level === 'subfunction');
      const drawn = (id) => { const o = itemOf(id); return !!o && placed(o) && !(kindOf(id) === 'case' && isHiddenCase(o)); };
      const isTile = (a) => a.kind === 'system' || a.kind === 'time';

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
      const px = (v) => `${v}px`;
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

      // The red-hot marker variants (primary colour): the base markers are in stage.html
      (function makeMarkerVariants() {
        ['uc-mk-open', 'uc-mk-tri'].forEach((id) => {
          const base = document.getElementById(id);
          if (!base) return;
          const copy = base.cloneNode(true);
          copy.id = `${id}-sel`;
          copy.style.setProperty('--mk', 'var(--primary)');
          base.parentNode.appendChild(copy);
        });
      })();

      // Client point -> canvas coordinates
      function canvasPoint(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / scale - canvas.clientLeft, y: (e.clientY - r.top) / scale - canvas.clientTop };
      }
      const centreOf = (o) => ({ x: o.x + (o.w || 0) / 2, y: o.y + (o.h || 0) / 2 });
      const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
      const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

      // --- HINT (why something was refused, or a prompt that stays) ---
      let hintTimer = 0;
      function hint(text, sticky) {
        let el = document.querySelector('.hint');
        clearTimeout(hintTimer);
        if (text === null) { if (el) el.remove(); return; }
        if (!el) {
          el = htmlEl('div', 'hint');
          el.setAttribute('role', 'status');
          el.dataset.exportSkip = '';
          document.body.appendChild(el);
        }
        el.innerHTML = text;
        if (!sticky) hintTimer = setTimeout(() => el.remove(), 3600);
      }

      // --- RENDERING ---
      function ensureLayout() {
        routeDiagram(chartData);   // lays out afresh by itself when an actor or use case has no x/y
      }

      function render() {
        ensureLayout();
        const C = chartData.canvas || { width: 800, height: 400 };
        canvas.style.width = px(C.width);
        canvas.style.height = px(C.height);
        svg.setAttribute('width', C.width);
        svg.setAttribute('height', C.height);
        const hadFocus = document.activeElement && html.contains(document.activeElement) && document.activeElement.dataset.nodeId;
        linksG.textContent = '';
        leadersG.textContent = '';
        html.textContent = '';
        els.items = new Map(); els.links = new Map(); els.subjects = new Map(); els.parents = [];
        actorSw = actorSlots();
        selIds = selIds.filter((id) => itemOf(id));
        if (selOther && !otherExists(selOther)) selOther = null;
        if (hoverLinkId && !linkOf(hoverLinkId)) hoverLinkId = null;

        allSubjects().forEach((s) => html.appendChild(buildSubject(s)));
        renderLinks();
        actors().forEach((a) => { if (placed(a)) { const el = buildActor(a); els.items.set(a.id, el); html.appendChild(el); } });
        cases().forEach((u) => { if (placed(u) && !isHiddenCase(u)) { const el = buildCase(u); els.items.set(u.id, el); html.appendChild(el); } });
        renderLabels();
        renderLegend();
        renderNotes(true);
        updateButtons();
        applySelection();
        if (hadFocus && els.items.has(hadFocus)) els.items.get(hadFocus).focus({ preventScroll: true });
      }
      function otherExists(o) {
        if (o.kind === 'link') return !!linkOf(o.id);
        if (o.kind === 'subject') return !!subjectOf(o.id);
        if (o.kind === 'note') return !!noteOf(o.id);
        return false;
      }

      function buildSubject(s) {
        const real = realSubjects().includes(s);
        const el = htmlEl('div', 'uc-subject');
        el.dataset.subjectId = s.id;
        const box = typeof s.x === 'number' ? s : { x: 0, y: 0, w: 200, h: 100 };
        Object.assign(el.style, { left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h) });
        const titleH = s._titleH || 36;
        if (s.collapsed === true) el.classList.add('is-collapsed');
        const title = htmlEl('div', 'uc-subject-title');
        title.style.height = px(titleH);
        title.tabIndex = -1;
        if (real) {
          const chev = htmlEl('button', 'frame-chev');
          chev.type = 'button';
          chev.dataset.exportSkip = '';
          chev.title = s.collapsed === true ? 'Expand this subject' : 'Collapse this subject to its name';
          chev.setAttribute('aria-label', chev.title);
          chev.setAttribute('aria-expanded', String(s.collapsed !== true));
          chev.innerHTML = ui.icon('chevron-down', { size: 'sm', bold: true });
          chev.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          chev.addEventListener('click', (ev) => { ev.stopPropagation(); toggleCollapsed(s.id); });
          title.appendChild(chev);
        }
        title.appendChild(htmlEl('span', 'uc-subject-name t-title', nameOf(s) || (real ? '' : 'System')));
        el.appendChild(title);
        els.subjects.set(s.id, el);
        return el;
      }

      // Actors are colour coded so each can be told apart (lines stay neutral). An actor's own `color`
      // wins; the others take, in turn, the slots no feature area uses (colorKey), so an actor never wears a feature
      // area's colour (with more actors than free slots, actors far apart in the list share one). Picked colours are not saved.
      function actorSlots() {
        const all = ['1', '2', '3', '4', '5', '6', '7', '8'];
        const used = new Set(Object.keys(chartData.colorKey || {}));
        const free = all.filter((x) => !used.has(x)), seq = free.length ? free : all;
        const out = new Map();
        let i = 0;
        actors().forEach((a) => { out.set(a.id, a.color || seq[i++ % seq.length]); });
        return out;
      }

      // Every actor is a round avatar (person, server or clock), the name below and, for a system or time actor, its keyword
      function avatar(kind, size) {
        const fig = htmlEl('div', 'uc-figure');
        fig.innerHTML = ui.icon(KIND_ICON[kind] || KIND_ICON.human, { size: Math.round((size || 56) / 2) });
        if (size) { fig.style.width = px(size); fig.style.height = px(size); }
        return fig;
      }

      function buildActor(a) {
        const el = htmlEl('div', 'uc-actor');
        el.dataset.nodeId = a.id;
        el.dataset.kind = a.kind || 'human';
        el.tabIndex = -1;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `Actor ${nameOf(a)}${isTile(a) ? ` (${a.kind})` : ''}`);
        Object.assign(el.style, { left: px(a.x), top: px(a.y), width: px(a.w), height: px(a.h) });
        setSwatch(el, actorSw.get(a.id));
        el.appendChild(avatar(a.kind, a._figW));
        el.appendChild(htmlEl('span', `uc-actor-name t-label${a.abstract ? ' is-abstract' : ''}`, nameOf(a)));
        if (isTile(a)) el.appendChild(htmlEl('span', 'uc-kw t-caption', KIND_CAPTION[a.kind]));
        addItemChrome(el, a, a._side === 'right');
        return el;
      }

      function buildCase(u) {
        const el = htmlEl('div', 'uc-case');
        el.dataset.nodeId = u.id;
        el.dataset.level = LEVELS.includes(u.level) ? u.level : 'user';
        el.tabIndex = -1;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `Use case ${nameOf(u)}`);
        Object.assign(el.style, { left: px(u.x), top: px(u.y), width: px(u.w), height: px(u.h) });
        if (u.color) setSwatch(el, u.color);
        const shape = htmlEl('div', 'uc-shape');
        if (typeof u._r === 'number') shape.style.borderRadius = px(u._r);   // the engine's corner radius: a pill on one line
        const wrap = htmlEl('div', 'uc-name-wrap');
        const lines = Array.isArray(u._lines) && u._lines.length ? u._lines : [nameOf(u)];
        const name = htmlEl('span', `uc-name t-label${u.abstract ? ' is-abstract' : ''}`, lines.join('\n'));
        name.title = nameOf(u);
        wrap.appendChild(name);
        if (u._compH) wrap.style.flex = `0 0 ${u.h - u._compH}px`;
        shape.appendChild(wrap);
        const eps = Array.isArray(u.extensionPoints) ? u.extensionPoints : [];
        if (eps.length) {
          const box = htmlEl('div', 'uc-eps');
          if (u._compH) { box.style.flex = `0 0 ${u._compH}px`; box.style.boxSizing = 'border-box'; }
          box.title = 'Extension points';
          eps.forEach((p, i) => { const ep = htmlEl('span', 'uc-ep t-detail', String(p)); ep.dataset.index = String(i); box.appendChild(ep); });
          shape.appendChild(box);
        }
        el.appendChild(shape);
        if (chartData.showRefs === true && Array.isArray(u.refs) && u.refs.length) {
          const refs = htmlEl('div', 'uc-refs');
          u.refs.forEach((r) => refs.appendChild(htmlEl('span', 'uc-ref t-caption', String(r))));
          el.appendChild(refs);
        }
        addItemChrome(el, u, false);
        return el;
      }

      // Connect port, note badge or + chip
      function addItemChrome(el, o, leftPort) {
        if (!presenting()) {
          const port = htmlEl('span', `uc-port${leftPort ? ' is-left' : ''}`);
          port.dataset.exportSkip = '';
          port.dataset.touchDrag = '';
          port.title = 'Drag to another item to connect them (blank space inside a subject draws out a new use case)';
          if (o._figW && typeof o.w === 'number') {   // an actor: the port sits on the avatar's rim, level with its centre
            const off = px((o.w - o._figW) / 2);
            port.style.top = px(o._figH / 2);
            if (leftPort) port.style.left = `calc(${off} - 7px)`; else port.style.right = `calc(${off} - 7px)`;
          }
          el.appendChild(port);
        }
        const badge = buildNoteBadge(o);
        if (badge) el.appendChild(badge);
        el.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType === 'touch' || drag) return;
          if (notesOfItem(o.id).length) peekSoon(o.id, 100);
          hoverItemId = o.id; applyFocus();
        });
        el.addEventListener('pointerleave', () => {
          if (peekId === o.id) unpeekSoon(o.id);
          if (hoverItemId === o.id) { hoverItemId = null; applyFocus(); }
        });
      }

      // --- LINES ---
      const pathOf = (p) => (p.length === 4 ? `M ${p[0][0]} ${p[0][1]} C ${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]} ${p[3][0]} ${p[3][1]}`
        : p.length === 3 ? `M ${p[0][0]} ${p[0][1]} Q ${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]}` : `M ${p[0][0]} ${p[0][1]} L ${p[p.length - 1][0]} ${p[p.length - 1][1]}`);
      function midOf(p) {
        if (p.length === 4) return { x: (p[0][0] + 3 * p[1][0] + 3 * p[2][0] + p[3][0]) / 8, y: (p[0][1] + 3 * p[1][1] + 3 * p[2][1] + p[3][1]) / 8 };
        if (p.length === 3) return { x: (p[0][0] + 2 * p[1][0] + p[2][0]) / 4, y: (p[0][1] + 2 * p[1][1] + p[2][1]) / 4 };
        return { x: (p[0][0] + p[p.length - 1][0]) / 2, y: (p[0][1] + p[p.length - 1][1]) / 2 };
      }
      const linkVisible = (l) => !!l.points && l.points.length >= 2 && drawn(l.from) !== false && (kindOf(l.from) === 'actor' || !isHiddenByLevel(l.from)) && (kindOf(l.to) === 'actor' || !isHiddenByLevel(l.to));
      const isHiddenByLevel = (id) => { const u = caseOf(id); return !!u && !levelsOn && u.level === 'subfunction'; };
      function setMarkers(line, kind) {
        const m = kind ? `url(#uc-mk-${kind})` : 'none', ms = kind ? `url(#uc-mk-${kind}-sel)` : 'none';
        line.style.setProperty('--mk-e', m);
        line.style.setProperty('--mk-e-sel', ms);
      }
      function linkTitle(l) {
        const a = itemOf(l.from), b = itemOf(l.to);
        const word = l.type === 'association' ? 'association' : `«${l.type}»`;
        return `${nameOf(a)} ${l.type === 'association' ? '—' : '→'} ${nameOf(b)} (${word}${l.condition ? `, [${l.condition}]` : ''})`;
      }
      function renderLinks() {
        linksOf().forEach((l) => {
          if (!LINK_TYPES.includes(l.type) || !l.points || l.points.length < 2) return;
          if (isHiddenByLevel(l.from) || isHiddenByLevel(l.to)) return;
          const d = pathOf(l.points);
          const g = svgEl('g', { class: `uc-link${l.type !== 'association' ? ' is-dashed' : ''}`, 'data-edge-id': l.id, 'data-from': l.from, 'data-to': l.to, 'data-type': l.type });
          const tip = svgEl('title', { 'data-export-skip': '' });
          tip.textContent = linkTitle(l);
          const line = svgEl('path', { class: 'edge-line', d });
          setMarkers(line, l.type === 'association' ? (l.navigable === true ? 'open' : null) : 'open');
          g.append(tip, svgEl('path', { class: 'edge-hit', d }), line);
          g.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'touch' || drag) return; hoverLinkId = l.id; applyLinkState(); });
          g.addEventListener('pointerleave', () => { if (hoverLinkId === l.id) hoverLinkId = null; applyLinkState(); });
          g.addEventListener('pointerdown', (ev) => { if (ev.button === 0 && !presenting()) { ev.stopPropagation(); selectOther('link', l.id); } });
          g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editLinkCondition(l.id); });
          linksG.appendChild(g);
          els.links.set(l.id, { g, label: null });
        });
        (chartData._parents || []).forEach((p) => {
          if (!p.points || p.points.length < 2 || !drawn(p.from) || !drawn(p.to)) return;
          const g = svgEl('g', { class: 'uc-link uc-parent', 'data-from': p.from, 'data-to': p.to, 'data-parent': '1' });
          const tip = svgEl('title', { 'data-export-skip': '' });
          tip.textContent = `${nameOf(itemOf(p.from))} is a kind of ${nameOf(itemOf(p.to))}`;
          const line = svgEl('path', { class: 'edge-line', d: pathOf(p.points) });
          setMarkers(line, 'tri');
          g.append(tip, line);
          linksG.appendChild(g);
          els.parents.push(g);
        });
      }
      function renderLabels() {
        linksOf().forEach((l) => {
          const b = l.labelBox, rec = els.links.get(l.id);
          if (!b || !rec || (l.type !== 'include' && l.type !== 'extend')) return;
          const el = htmlEl('div', 'edge-label uc-label');
          el.dataset.edgeId = l.id;
          Object.assign(el.style, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
          el.title = linkTitle(l) + (l.extensionPoint ? ` at ${l.extensionPoint}` : '');
          el.appendChild(htmlEl('span', 'uc-label-text', `«${l.type}»`));
          if (l.type === 'extend' && l.condition) el.appendChild(htmlEl('span', 'uc-cond', `[${l.condition}]`));
          el.addEventListener('pointerenter', (ev) => { if (ev.pointerType !== 'touch' && !drag) { hoverLinkId = l.id; applyLinkState(); } });
          el.addEventListener('pointerleave', () => { if (hoverLinkId === l.id) hoverLinkId = null; applyLinkState(); });
          el.addEventListener('pointerdown', (ev) => { if (ev.button === 0 && !presenting()) { ev.stopPropagation(); selectOther('link', l.id); } });
          el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editLinkCondition(l.id); });
          html.appendChild(el);
          rec.label = el;
        });
      }
      function applyLinkState() {
        els.links.forEach((rec, id) => {
          const sel = !!selOther && selOther.kind === 'link' && selOther.id === id, hov = hoverLinkId === id;
          rec.g.classList.toggle('selected', sel);
          rec.g.classList.toggle('hover', hov && !sel);
          if (rec.label) { rec.label.classList.toggle('selected', sel); rec.label.classList.toggle('hover', hov && !sel); }
        });
      }

      // The colour key as a legend under the diagram
      let legendEl = null;
      function renderLegend() {
        legendEl = null;
        const key = chartData.colorKey && typeof chartData.colorKey === 'object' ? chartData.colorKey : {};
        const slots = Object.keys(key).filter((k) => key[k] && swatchSlot(k));
        if (!slots.length) return;
        const C = chartData.canvas || { height: 0 };
        legendEl = htmlEl('div', 'uc-legend');
        legendEl.setAttribute('role', 'list');
        legendEl.setAttribute('aria-label', 'Colour key');
        legendEl.style.top = px(C.height + 12);
        slots.forEach((k) => {
          const item = htmlEl('span', 'uc-legend-item t-detail');
          item.setAttribute('role', 'listitem');
          const dot = htmlEl('span', 'swatch-dot');
          setSwatch(dot, k);
          item.append(dot, document.createTextNode(String(key[k])));
          legendEl.appendChild(item);
        });
        html.appendChild(legendEl);
      }

      // --- SELECTION ---
      const primaryId = () => selIds[selIds.length - 1] || null;
      function setSel(ids, other) {
        selIds = ids.filter((id) => itemOf(id));
        selOther = other || null;
        applySelection();
      }
      const selectItem = (id) => setSel([id], null);
      const selectOther = (kind, id) => setSel([], { kind, id });
      function toggleItem(id) {
        const ids = selIds.filter((x) => x !== id);
        if (!selIds.includes(id)) ids.push(id);
        setSel(ids, null);
      }
      function applySelection() {
        const sset = new Set(selIds);
        els.items.forEach((el, id) => {
          el.classList.toggle('selected', sset.has(id));
          el.tabIndex = id === primaryId() ? 0 : -1;
        });
        if (!selIds.length) { const first = els.items.values().next().value; if (first) first.tabIndex = 0; }
        canvas.classList.toggle('uc-multi', selIds.length > 1);
        els.subjects.forEach((el, id) => el.classList.toggle('selected', !!selOther && selOther.kind === 'subject' && selOther.id === id));
        applyLinkState();
        applyNoteSelection();
        applyFocus();
        drawSelectionTools();
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }

      // --- EXPLORE: what is reachable from the selected actor or use case dims everything else; search lights its matches ---
      function actorFamily(id) {   // the actor and every ancestor (a specialised actor can do all its parents do)
        const out = [], seen = new Set();
        for (let a = actorOf(id); a && !seen.has(a.id); a = actorOf(a.parent)) { seen.add(a.id); out.push(a.id); }
        return out;
      }
      function reach(id) {
        const lit = new Set([id]), links = linksOf();
        if (kindOf(id) === 'actor') {
          const family = actorFamily(id);
          family.forEach((x) => lit.add(x));
          const queue = [];
          links.forEach((l) => {
            if (l.type !== 'association') return;
            if (family.includes(l.from) && caseOf(l.to)) queue.push(l.to);
            if (family.includes(l.to) && caseOf(l.from)) queue.push(l.from);
          });
          while (queue.length) {
            const c = queue.pop();
            if (lit.has(c)) continue;
            lit.add(c);
            links.forEach((l) => {
              if (l.type === 'include' && l.from === c) queue.push(l.to);
              if (l.type === 'extend' && l.to === c) queue.push(l.from);
            });
            cases().forEach((u) => { if (u.parent === c) queue.push(u.id); });
          }
        } else {
          links.forEach((l) => {
            if (l.from === id) lit.add(l.to);
            if (l.to === id) lit.add(l.from);
          });
          const c = caseOf(id);
          if (c && c.parent) lit.add(c.parent);
          cases().forEach((u) => { if (u.parent === id) lit.add(u.id); });
          // an actor lit through an association also lights the actors that specialise it
          actors().forEach((a) => { if (actorFamily(a.id).some((x) => lit.has(x) && actorOf(x))) lit.add(a.id); });
        }
        return lit;
      }
      // What an item connects to directly: the other end of each of its lines, its parent and its children
      function direct(id) {
        const lit = new Set([id]);
        linksOf().forEach((l) => { if (l.from === id) lit.add(l.to); if (l.to === id) lit.add(l.from); });
        const o = itemOf(id);
        if (o && o.parent) lit.add(o.parent);
        actors().concat(cases()).forEach((x) => { if (x.parent === id) lit.add(x.id); });
        return lit;
      }
      function applyFocus() {
        let lit = null, fromSearch = false, hover = null;
        if (hoverItemId && !itemOf(hoverItemId)) hoverItemId = null;
        if (searchQ) { lit = new Set(searchIds); fromSearch = true; }
        else if (hoverItemId && !drag && !(selIds.length === 1 && !selOther && selIds[0] === hoverItemId)) { hover = hoverItemId; lit = direct(hover); }   // the clicked item keeps its wider focus
        else if (selIds.length === 1 && !selOther) lit = reach(selIds[0]);
        els.items.forEach((el, id) => {
          el.classList.toggle('is-dim', !!lit && !lit.has(id));
          el.classList.toggle('is-match', fromSearch && lit.has(id));
          el.classList.toggle('hl', !fromSearch && !!lit && lit.has(id) && selIds.length === 1 && id !== selIds[0] && false);
        });
        // hovering lights only the item's own lines; a selection lights every line inside what it reaches
        const lineLit = (from, to) => !!lit && (hover ? from === hover || to === hover : lit.has(from) && lit.has(to));
        els.links.forEach((rec, id) => {
          const l = linkOf(id);
          if (!l) return;
          const on = lineLit(l.from, l.to);
          rec.g.classList.toggle('is-dim', !!lit && !on);
          rec.g.classList.toggle('hl', !fromSearch && on);
          if (rec.label) { rec.label.classList.toggle('is-dim', !!lit && !on); rec.label.classList.toggle('hl', !fromSearch && on); }
        });
        els.parents.forEach((g) => {
          const on = lineLit(g.dataset.from, g.dataset.to);
          g.classList.toggle('is-dim', !!lit && !on);
          g.classList.toggle('hl', !fromSearch && on);
        });
        els.subjects.forEach((el) => el.classList.remove('is-dim'));
        document.body.classList.toggle('uc-has-match', !!lit);
      }

      // --- SEARCH ---
      function setSearch(q) {
        searchQ = q.trim().toLowerCase();
        searchIds = [];
        if (searchQ) {
          actors().forEach((a) => { if (nameOf(a).toLowerCase().includes(searchQ)) searchIds.push(a.id); });
          cases().forEach((u) => {
            if (isHiddenByLevel(u.id)) return;
            if (nameOf(u).toLowerCase().includes(searchQ) || (u.refs || []).some((r) => String(r).toLowerCase().includes(searchQ))) searchIds.push(u.id);
          });
        }
        searchCount.textContent = !searchQ ? '' : searchIds.length ? `${searchIds.length} match${searchIds.length === 1 ? '' : 'es'}` : 'No match';
        searchFit.hidden = !searchIds.length;
        searchClear.hidden = !searchQ;
        applyFocus();
      }
      searchEl.addEventListener('input', () => setSearch(searchEl.value));
      searchEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); fitToMatches(); }
        else if (e.key === 'Escape') { e.preventDefault(); clearSearch(); searchEl.blur(); }
      });
      function clearSearch() { searchEl.value = ''; setSearch(''); }
      searchClear.addEventListener('click', () => { clearSearch(); searchEl.focus(); });
      searchFit.addEventListener('click', fitToMatches);
      function fitToMatches() {
        const boxes = searchIds.map((id) => itemOf(id)).filter((o) => o && placed(o) && o.w).map(boxOf);
        if (!boxes.length) return;
        const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
        const vp = viewport.getBoundingClientRect(), dock = document.querySelector('.dock-area');
        const band = dock && dock.offsetHeight ? Math.max(0, vp.bottom - dock.getBoundingClientRect().top) : 0;
        const pad = 120, w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        scale = Math.min(Math.max(Math.min((vp.width - pad) / w, (vp.height - band - pad) / h), 0.25), 1.25);
        panX = (vp.width - w * scale) / 2 - (canvas.offsetLeft + x0) * scale;
        panY = (vp.height - band - h * scale) / 2 - (canvas.offsetTop + y0) * scale;
        updateTransform();
      }

      // --- DOCK BUTTONS: Refs, Levels, Notes, Auto-Tidy ---
      function updateButtons() {
        btnRefs.setAttribute('aria-checked', String(chartData.showRefs === true));
        btnLevels.setAttribute('aria-checked', String(levelsOn));
        btnAutoLayout.setAttribute('aria-checked', String(autoTidy));
        btnAutoLayout.title = autoTidy
          ? 'Auto-Tidy is on: the diagram re-arranges itself after adding, deleting or connecting (click to place things by hand)'
          : 'Auto-Tidy is off: things stay where you drop them (click to re-arrange after every change)';
        updateNotesButton();
      }
      btnRefs.addEventListener('click', () => { if (chartData.showRefs === true) delete chartData.showRefs; else chartData.showRefs = true; render(); updateStatus(true); });
      btnLevels.addEventListener('click', () => { levelsOn = !levelsOn; if (!levelsOn) selIds = selIds.filter((id) => !isHiddenByLevel(id)); setSearch(searchEl.value); render(); });
      btnAutoLayout.addEventListener('click', () => {
        autoTidy = !autoTidy;
        try { localStorage.setItem('usecase-auto-tidy', autoTidy ? 'on' : 'off'); } catch (e) {}
        updateButtons();
        if (autoTidy && !presenting()) commit(true);
      });
      btnNotes.addEventListener('click', () => {
        if (chartData.showNotes) delete chartData.showNotes; else chartData.showNotes = true;
        peekId = null;
        applyNoteVisibility();
        updateNotesButton();
        updateStatus(true);
      });
      function updateNotesButton() {
        const count = notesList().filter((n) => noteText(n)).length, on = !!chartData.showNotes;
        btnNotes.setAttribute('aria-checked', String(on));
        btnNotes.disabled = !count && !on;
        const c = btnNotes.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        btnNotes.title = !count ? 'No notes yet: select an actor or use case and press N to add one' : on ? 'Hide the notes (hover a badge to peek at one)' : 'Show all notes';
      }

      // A finished edit: re-lay out first when Auto-Tidy is on and the edit was structural, then one undo step
      function commit(relayout) {
        if (relayout && autoTidy) layoutDiagram(chartData);
        render();
        updateStatus(true);
      }

      // --- NOTES ---
      // chartData.notes: { id, text, useCases: [ids], actors: [ids], _pos?: {x, y} }. The first linked item is the anchor. An
      // item with a note carries a badge; hovering it peeks the card, the Notes switch shows them all ("showNotes"). A card is
      // fitted into a clear gap near its item on every render unless it was dragged (_pos, relative to the anchor, which is
      // never saved: notes carry no positions on disk).
      const NOTE_GAP = 8, NOTE_MIN_GAP = 10, NOTE_IDEAL_GAP = 20, NOTE_REACH = 160, NOTE_STEP = 8;
      let noteOffsets = {}, noteSizes = {}, peekId = null, peekTimer = 0, notesLayer = null, editingNoteId = null;
      const noteText = (n) => (n && typeof n.text === 'string' ? n.text.trim() : '');
      const linkedItems = (n) => (n.useCases || []).concat(n.actors || []).filter((id) => itemOf(id) && drawn(id));
      const liveNotes = () => notesList().filter((n) => (noteText(n) || n.id === editingNoteId) && linkedItems(n).length);
      const notesOfItem = (id) => liveNotes().filter((n) => linkedItems(n).includes(id));
      const noteCard = (id) => notesLayer && [...notesLayer.children].find((el) => el.dataset.noteId === id);
      const selectedNoteId = () => (selOther && selOther.kind === 'note' ? selOther.id : null);

      function renderNotes(refit) {
        if (notesLayer && notesLayer.isConnected) notesLayer.remove();
        leadersG.textContent = '';
        notesLayer = htmlEl('div', 'note-layer');
        notesLayer.id = 'uc-notes';
        html.appendChild(notesLayer);
        const live = liveNotes();
        live.forEach((note) => {
          notesLayer.appendChild(buildNoteCard(note));
          linkedItems(note).forEach((id) => leadersG.appendChild(svgEl('line', { class: 'note-leader', 'data-note-id': note.id, 'data-item-id': id })));
        });
        notesLayer.classList.add('measuring');
        noteSizes = {};
        live.forEach((n) => { const c = noteCard(n.id); noteSizes[n.id] = { w: c.offsetWidth, h: c.offsetHeight }; });
        notesLayer.classList.remove('measuring');
        if (refit) noteOffsets = {};
        fitNotes(live);
        positionNotes();
      }
      function buildNoteCard(note) {
        const { card, text } = ui.noteCard(note, {
          onDelete: () => removeNote(note.id),
          onLink: (ev) => startNoteLink(ev, note.id, card),
          linkTitle: 'Link to another item: drag onto it (onto a linked item to unlink)',
          onCommit: (el) => commitNote(note, el),
          onInput: () => { noteSizes[note.id] = { w: card.offsetWidth, h: card.offsetHeight }; positionNotes(); }
        });
        card.addEventListener('pointerdown', (ev) => onNotePointerDown(ev, note.id, card));
        card.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editNote(note.id); });
        card.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (presenting()) { selOther = selectedNoteId() === note.id ? null : { kind: 'note', id: note.id }; applyNoteVisibility(); }
        });
        text.addEventListener('blur', () => commitNote(note, text));
        return card;
      }
      function fitNotes(live) {
        const todo = live.filter((n) => !n._pos && !noteOffsets[n.id]);
        if (!todo.length) return;
        const C = chartData.canvas || { width: 0, height: 0 };
        const itemBoxes = [...actors(), ...cases()].filter((o) => placed(o) && o.w).map(boxOf);
        const labelBoxes = linksOf().filter((l) => l.labelBox).map((l) => l.labelBox);
        const anchorBox = (n) => boxOf(itemOf(linkedItems(n)[0]));
        const placedBoxes = live.filter((n) => n._pos || noteOffsets[n.id]).map((n) => {
          const o = n._pos || noteOffsets[n.id], a = anchorBox(n);
          return { x: a.x + o.x, y: a.y + o.y, w: noteSizes[n.id].w, h: noteSizes[n.id].h };
        });
        todo.forEach((n) => {
          const a = anchorBox(n), s = noteSizes[n.id];
          let best = null;
          for (let y = Math.round(a.y - s.h - NOTE_REACH); y <= a.y + a.h + NOTE_REACH; y += NOTE_STEP) {
            for (let x = Math.round(a.x - s.w - NOTE_REACH); x <= a.x + a.w + NOTE_REACH; x += NOTE_STEP) {
              const b = { x, y, w: s.w, h: s.h };
              const gap = Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));
              if (gap < NOTE_MIN_GAP) continue;
              let cost = Math.abs(gap - NOTE_IDEAL_GAP) * 10;
              if (best && cost >= best.cost) continue;
              if (x < 0 || y < 0 || x + s.w > C.width || y + s.h > C.height) cost += 600;
              for (const o of itemBoxes) if (overlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of placedBoxes) if (overlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of labelBoxes) if (overlap(b, o, 4)) cost += 2e4;
              if (!best || cost < best.cost) best = { x, y, cost };
            }
          }
          if (!best) best = { x: a.x + a.w + NOTE_IDEAL_GAP, y: a.y - s.h, cost: 0 };
          noteOffsets[n.id] = { x: best.x - a.x, y: best.y - a.y };
          placedBoxes.push({ x: best.x, y: best.y, w: s.w, h: s.h });
        });
      }
      function positionNotes() {
        if (!notesLayer) return;
        [...notesLayer.children].forEach((card) => {
          const note = noteOf(card.dataset.noteId);
          if (!note) return;
          const ids = linkedItems(note), o = note._pos || noteOffsets[note.id];
          if (!ids.length || !o) return;
          const a = boxOf(itemOf(ids[0])), x = a.x + o.x, y = a.y + o.y, s = noteSizes[note.id] || { w: 0, h: 0 };
          card.style.left = px(x);
          card.style.top = px(y);
          drawLeaders(note.id, { x, y, w: s.w, h: s.h });
        });
        applyNoteVisibility();
      }
      function drawLeaders(noteId, b) {
        [...leadersG.children].forEach((line) => {
          if (line.dataset.noteId !== noteId) return;
          const o = itemOf(line.dataset.itemId);
          if (!o) return;
          const c = centreOf(o);
          line.setAttribute('x1', b.x + b.w / 2); line.setAttribute('y1', b.y + b.h / 2);
          line.setAttribute('x2', c.x); line.setAttribute('y2', c.y);
        });
      }
      function notePeeked(note) {
        const ids = linkedItems(note);
        return note.id === selectedNoteId() || ids.includes(peekId) || (selIds.length === 1 && ids.includes(selIds[0]));
      }
      function applyNoteVisibility() {
        if (!notesLayer) return;
        const all = !!chartData.showNotes;
        canvas.classList.toggle('notes-on', all);
        [...notesLayer.children, ...leadersG.children].forEach((el) => {
          const note = noteOf(el.dataset.noteId);
          if (!note) return;
          el.classList.toggle('show', all);
          el.classList.toggle('peek', !!notePeeked(note));
        });
        applyNoteSelection();
      }
      function applyNoteSelection() {
        if (!notesLayer) return;
        [...notesLayer.children].forEach((el) => el.classList.toggle('selected', el.dataset.noteId === selectedNoteId()));
      }
      function peekSoon(id, delay) { clearTimeout(peekTimer); peekTimer = setTimeout(() => { if (peekId !== id) { peekId = id; applyNoteVisibility(); } }, delay); }
      function unpeekSoon(id) { clearTimeout(peekTimer); peekTimer = setTimeout(() => { if (peekId === id) { peekId = null; applyNoteVisibility(); } }, 220); }
      function buildNoteBadge(o) {
        const notes = notesOfItem(o.id);
        if (!notes.length) {
          if (presenting()) return null;
          const add = htmlEl('button', 'note-add');
          add.type = 'button';
          add.dataset.exportSkip = '';
          add.title = 'Add a note (N)';
          add.setAttribute('aria-label', 'Add a note');
          add.innerHTML = ui.icon('plus', { size: 'sm', bold: true });
          add.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          add.addEventListener('click', (ev) => { ev.stopPropagation(); addNoteTo(o.id); });
          return add;
        }
        const b = htmlEl('button', 'note-badge');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.setAttribute('aria-label', notes.map((n) => `Note: ${noteText(n)}`).join(' · '));
        b.innerHTML = ui.icon('note-lines', { size: 'xs', bold: true });
        b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        b.addEventListener('mouseenter', () => peekSoon(o.id, 0));
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (presenting()) { selOther = selectedNoteId() === notes[0].id ? null : { kind: 'note', id: notes[0].id }; applyNoteVisibility(); } else editNote(notes[0].id);
        });
        return b;
      }
      function addNoteTo(id) {
        if (!itemOf(id) || presenting()) return;
        const existing = notesOfItem(id)[0];
        if (existing) { editNote(existing.id); return; }
        const note = { id: uid('n'), text: '' };
        note[kindOf(id) === 'actor' ? 'actors' : 'useCases'] = [id];
        chartData.notes = notesList();
        chartData.notes.push(note);
        editNote(note.id);
      }
      function editNote(id) {
        const note = noteOf(id);
        if (!note || presenting()) return;
        cancelDrag();
        editingNoteId = id;
        selectOther('note', id);
        if (!noteCard(id)) renderNotes(false);
        const card = noteCard(id);
        if (!card) return;
        applyNoteVisibility();
        const text = card.querySelector('.note-text');
        text.contentEditable = 'true';
        text.focus();
        const range = document.createRange();
        range.selectNodeContents(text);
        range.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        panIntoView(card);
      }
      function commitNote(note, text) {
        text.contentEditable = 'false';
        if (editingNoteId !== note.id) return;
        editingNoteId = null;
        const value = text.innerText.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (value) note.text = value;
        else {
          chartData.notes = notesList().filter((n) => n !== note);
          if (!chartData.notes.length) delete chartData.notes;
          if (selectedNoteId() === note.id) selOther = null;
        }
        updateStatus(true);
        render();
      }
      window.addEventListener('pointerdown', (e) => {
        if (!editingNoteId) return;
        const card = noteCard(editingNoteId);
        if (card && card.contains(e.target)) return;
        const text = card && card.querySelector('.note-text'), note = noteOf(editingNoteId);
        if (text) text.blur();
        if (text && note) commitNote(note, text);
      }, true);
      function removeNote(id) {
        if (!noteOf(id)) return;
        chartData.notes = notesList().filter((n) => n.id !== id);
        if (!chartData.notes.length) delete chartData.notes;
        if (editingNoteId === id) editingNoteId = null;
        if (selectedNoteId() === id) selOther = null;
        updateStatus(true);
        render();
      }
      function toggleNoteLink(noteId, itemId) {
        const note = noteOf(noteId), kind = kindOf(itemId);
        if (!note || !kind) return;
        const key = kind === 'actor' ? 'actors' : 'useCases', all = linkedItems(note);
        const list = note[key] || [];
        if (!all.includes(itemId)) note[key] = list.concat(itemId);
        else if (all.length > 1) { note[key] = list.filter((x) => x !== itemId); if (!note[key].length) delete note[key]; delete note._pos; }
        else { hint('A note keeps at least one item: delete the note instead'); return; }
        updateStatus(true);
        render();
      }
      function startNoteLink(ev, noteId, card) {
        if (ev.button !== 0 || presenting()) return;
        ev.stopPropagation();
        ev.preventDefault();
        selectOther('note', noteId);
        const line = svgEl('line', { class: 'note-leader linking', 'data-note-id': noteId });
        overlay.appendChild(line);
        const cx = (parseFloat(card.style.left) || 0) + card.offsetWidth / 2, cy = (parseFloat(card.style.top) || 0) + card.offsetHeight / 2;
        document.body.classList.add('note-linking');
        beginDrag(ev, {
          move(e, d) {
            const p = canvasPoint(e);
            line.setAttribute('x1', cx); line.setAttribute('y1', cy); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
            d.target = itemIdAt(e.clientX, e.clientY);
            canvas.querySelectorAll('.note-target').forEach((el) => el.classList.remove('note-target'));
            const el = d.target && els.items.get(d.target);
            if (el) el.classList.add('note-target');
          },
          drop(e, d) { if (d.target) toggleNoteLink(noteId, d.target); else applyNoteVisibility(); },
          cleanup() { line.remove(); document.body.classList.remove('note-linking'); canvas.querySelectorAll('.note-target').forEach((el) => el.classList.remove('note-target')); }
        });
      }
      function onNotePointerDown(ev, id, card) {
        if (ev.button !== 0 || ev.target.isContentEditable) return;
        ev.stopPropagation();
        if (presenting()) return;
        selectOther('note', id);
        const x0 = parseFloat(card.style.left) || 0, y0 = parseFloat(card.style.top) || 0;
        beginDrag(ev, {
          move(e, d) {
            card.classList.add('dragging');
            d.nx = Math.round((x0 + d.dx) / 4) * 4; d.ny = Math.round((y0 + d.dy) / 4) * 4;
            card.style.left = px(d.nx); card.style.top = px(d.ny);
            drawLeaders(id, { x: d.nx, y: d.ny, ...(noteSizes[id] || { w: 0, h: 0 }) });
          },
          drop(e, d) {
            card.classList.remove('dragging');
            const note = noteOf(id), anchor = note && linkedItems(note)[0];
            if (!anchor) { render(); return; }
            const a = itemOf(anchor);
            note._pos = { x: Math.round(d.nx - a.x), y: Math.round(d.ny - a.y) };
            updateStatus(true);
          },
          cleanup() { card.classList.remove('dragging'); }
        });
      }

      // =====================================================================================================
      // --- EDITING ---
      // Presses are handled in one place (onPointerDown); a drag starts after 4px, and a press without movement only
      // selects and never rebuilds the DOM, so a double-click lands on the element the first click did.
      // =====================================================================================================
      let drag = null;
      let notePicking = false;
      const overlay = svgEl('svg', { id: 'uc-overlay', width: 1, height: 1 });
      overlay.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:54';
      overlay.dataset.exportSkip = '';
      const rubber = svgEl('line', { id: 'uc-rubber', x1: 0, y1: 0, x2: 0, y2: 0 });
      overlay.appendChild(rubber);
      canvas.appendChild(overlay);

      function panIntoView(el) {
        if (!el) return;
        const r = el.getBoundingClientRect(), v = viewport.getBoundingClientRect(), pad = 60;
        const dock = document.querySelector('.dock-area .toolbar-center');
        const bottom = Math.min(v.bottom, dock && dock.offsetHeight ? dock.getBoundingClientRect().top : v.bottom);
        let dx = 0, dy = 0;
        if (r.left < v.left + pad) dx = v.left + pad - r.left; else if (r.right > v.right - pad) dx = v.right - pad - r.right;
        if (r.top < v.top + pad) dy = v.top + pad - r.top; else if (r.bottom > bottom - pad) dy = bottom - pad - r.bottom;
        if (!dx && !dy) return;
        panX += dx; panY += dy;
        updateTransform();
      }

      function beginDrag(e, d) {
        endDrag();
        drag = Object.assign({ startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false }, d);
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp);
        window.addEventListener('pointercancel', cancelDrag);
      }
      function onDragMove(e) {
        const d = drag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        if (!d.moved) { d.moved = true; document.body.classList.add('uc-dragging'); hoverLinkId = null; applyLinkState(); }
        d.dx = (e.clientX - d.startX) / scale;
        d.dy = (e.clientY - d.startY) / scale;
        if (d.move) d.move(e, d);
      }
      function endDrag() {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        window.removeEventListener('pointercancel', cancelDrag);
        document.body.classList.remove('uc-dragging');
        rubber.style.display = 'none';
        canvas.querySelectorAll('.uc-target, .drop-target').forEach((el) => el.classList.remove('uc-target', 'drop-target'));
        const d = drag;
        drag = null;
        if (d && d.cleanup) d.cleanup();
        return d;
      }
      function onDragUp(e) {
        const d = endDrag();
        if (!d) return;
        if (!d.moved) { if (d.click) d.click(e); return; }
        if (d.drop) d.drop(e, d); else render();
      }
      function cancelDrag() {
        const d = endDrag();
        if (!d) return false;
        if (d.moved) render();
        return true;
      }

      // What is under a client point (overlays ignore the pointer)
      function itemIdAt(x, y) {
        const el = document.elementFromPoint(x, y), it = el && el.closest('.uc-actor, .uc-case');
        return it && !it.classList.contains('uc-ghost') ? it.dataset.nodeId : null;
      }
      // The subject whose boundary holds a canvas point (the innermost drawn one)
      function subjectAt(pt) {
        return allSubjects().filter((s) => typeof s.x === 'number' && inBox(pt, s)).pop() || null;
      }

      // --- PRESSES ---
      function onPointerDown(e) {
        if (e.pointerType === 'touch') document.body.classList.add('uc-touch');
        if (e.button > 0) return;
        const t = e.target;
        if (!(t instanceof Element) || t.isContentEditable) return;
        const itemEl = t.closest('.uc-actor, .uc-case');
        if (presenting()) {   // read only: selecting an item (which focuses it) is all a press does
          if (itemEl && !t.closest('.note-badge')) selectItem(itemEl.dataset.nodeId);
          else { const st = t.closest('.uc-subject-title'); if (st && !t.closest('.frame-chev')) selectOther('subject', st.parentNode.dataset.subjectId); }
          return;
        }
        if (t.closest('.uc-actionbar, .confirm, .frame-chev, .note-badge, .note-add, .note-del, .note-link, .note')) return;
        closeMenu();
        const title = t.closest('.uc-subject-title');
        if (title) {
          const id = title.parentNode.dataset.subjectId;
          if (notePicking) return;
          if (realSubjects().some((s) => s.id === id)) selectOther('subject', id); else setSel([], null);
          return;
        }
        if (!itemEl) return;
        const id = itemEl.dataset.nodeId;
        if (notePicking) { e.preventDefault(); giveNoteTo(id); return; }
        if ((e.ctrlKey || e.metaKey) && !t.closest('.uc-port')) { e.preventDefault(); toggleItem(id); return; }
        if (t.closest('.uc-port')) { beginDrag(e, connectDrag(id)); return; }
        const group = selIds.length > 1 && selIds.includes(id) ? selIds.slice() : null;
        if (group) {
          if (primaryId() !== id) { selIds = selIds.filter((x) => x !== id).concat(id); applySelection(); }
          beginDrag(e, Object.assign(itemDrag(group), { click: () => selectItem(id) }));
          return;
        }
        const wasOnly = selIds.length === 1 && selIds[0] === id && !selOther;
        selectItem(id);
        beginDrag(e, Object.assign(itemDrag([id]), { click: () => { if (wasOnly && e.detail === 1 && !e.target.closest('.uc-name.is-editing')) { /* a second click keeps the selection: Esc clears */ } } }));
      }
      html.addEventListener('pointerdown', onPointerDown);

      // --- Move actors and use cases (one or the whole selection) ---
      function itemDrag(ids) {
        const targetSubjects = allSubjects();
        return {
          move(e, d) {
            ids.forEach((id) => { const el = els.items.get(id); if (el) { el.classList.add('is-dragging'); el.style.translate = `${d.dx}px ${d.dy}px`; } });
            canvas.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
            if (ids.some((id) => kindOf(id) === 'case') && realSubjects().length) {
              const s = subjectAt(canvasPoint(e)), el = s && els.subjects.get(s.id);
              if (el) el.classList.add('drop-target');
            }
          },
          drop(e, d) {
            const dx = Math.round(d.dx), dy = Math.round(d.dy);
            const s = realSubjects().length ? subjectAt(canvasPoint(e)) : null;
            let moved = false;
            ids.forEach((id) => {
              const o = itemOf(id);
              if (!o || !placed(o)) return;
              o.x += dx; o.y += dy;
              if (s && kindOf(id) === 'case' && caseSubjectId(o) !== s.id) { o.subject = s.id; moved = true; }
            });
            ids.forEach((id) => { const a = actorOf(id); if (a) keepOutside(a); });
            void targetSubjects;
            commit(moved);
          }
        };
      }
      // Actors stay outside every boundary
      function keepOutside(a) {
        allSubjects().forEach((s) => {
          if (typeof s.x !== 'number' || !overlap(boxOf(a), boxOf(s))) return;
          a.x = a._side === 'right' ? s.x + s.w + 16 : s.x - a.w - 16;
        });
      }

      // --- Connect: drag from a port ---
      function connectDrag(fromId) {
        const src = itemOf(fromId);
        return {
          click: () => selectItem(fromId),
          move(e, d) {
            const c = centreOf(src), pt = canvasPoint(e);
            rubber.setAttribute('x1', c.x); rubber.setAttribute('y1', c.y); rubber.setAttribute('x2', pt.x); rubber.setAttribute('y2', pt.y);
            rubber.style.display = 'block';
            canvas.querySelectorAll('.uc-target, .drop-target').forEach((el) => el.classList.remove('uc-target', 'drop-target'));
            d.target = itemIdAt(e.clientX, e.clientY);
            if (d.target && d.target !== fromId) els.items.get(d.target).classList.add('uc-target');
            else if (!d.target) {
              const s = subjectAt(pt), el = s && els.subjects.get(s.id);
              if (el) el.classList.add('drop-target');
            }
          },
          drop(e, d) {
            if (d.target) { connectItems(fromId, d.target); return; }
            const pt = canvasPoint(e), s = subjectAt(pt);
            if (s) drawOutCase(fromId, pt, s);
            else render();
          }
        };
      }
      function linkExists(type, from, to) {
        return linksOf().find((l) => l.type === type && ((l.from === from && l.to === to) || (type === 'association' && l.from === to && l.to === from)));
      }
      function wouldCycle(childId, parentId) {   // a parent chain that returns to the child
        const list = kindOf(childId) === 'actor' ? actors() : cases();
        for (let id = parentId, n = 0; id && n < 100; n++) {
          if (id === childId) return true;
          const o = list.find((x) => x.id === id);
          id = o && o.parent;
        }
        return false;
      }
      function addLink(type, from, to) {
        const l = { id: uid('l'), type, from, to };
        chartData.links = linksOf();
        chartData.links.push(l);
        return l;
      }
      function connectItems(fromId, toId) {
        const a = kindOf(fromId), b = kindOf(toId);
        if (fromId === toId) { hint('Drop it on another item'); render(); return false; }
        if (a === 'actor' && b === 'actor') {
          if (wouldCycle(fromId, toId)) { hint('That would make an actor a kind of itself'); render(); return false; }
          actorOf(fromId).parent = toId;
          hint(`${esc(nameOf(actorOf(fromId)))} is now a kind of ${esc(nameOf(actorOf(toId)))}`);
          selectItem(fromId);
          commit(true);
          return true;
        }
        const type = a === 'case' && b === 'case' ? 'include' : 'association';
        const dup = linkExists(type, fromId, toId);
        if (dup) { hint('Those two are already connected that way'); selectOther('link', dup.id); render(); return false; }
        if (type === 'include' && linksOf().some((l) => l.type === 'include' && l.from === toId && l.to === fromId)) { hint('The other use case already includes this one'); render(); return false; }
        const l = addLink(type, fromId, toId);
        setSel([], { kind: 'link', id: l.id });
        commit(true);
        return true;
      }
      // A port dragged onto blank space inside a subject draws out a new use case, already connected
      function drawOutCase(fromId, pt, s) {
        const u = newCase(s, pt);
        addLink(kindOf(fromId) === 'actor' ? 'association' : 'include', fromId, u.id);
        selectItem(u.id);
        commit(true);
        placeCentred(u, pt);
        editName(u.id);
      }

      // --- Adding things ---
      function viewCentre() {
        const v = viewport.getBoundingClientRect();
        return canvasPoint({ clientX: v.left + v.width / 2, clientY: v.top + v.height / 3 });
      }
      // Put the item's centre at pt once its size is known (a new item is routed first)
      function placeCentred(o, pt) {
        routeDiagram(chartData);
        if (autoTidy && !pt._keep) { /* the layout decides */ }
        o.x = Math.round(pt.x - (o.w || 0) / 2);
        o.y = Math.round(pt.y - (o.h || 0) / 2);
        render();
        updateStatus(true);
      }
      // The real subject list when the diagram has none yet: the implicit boundary becomes a subject of its own
      function materialiseSubjects() {
        if (realSubjects().length) return;
        const s = { id: uid('s'), name: chartData.title || 'System' };
        chartData.subjects = [s];
        cases().forEach((u) => { u.subject = s.id; });
      }
      function newCase(subject, pt) {
        const u = { id: uid('u'), name: 'New use case' };
        if (subject && realSubjects().some((s) => s.id === subject.id)) u.subject = subject.id;
        else if (realSubjects().length) u.subject = realSubjects()[0].id;
        u.x = Math.round(pt.x - SIZE.useCase[0] / 2);
        u.y = Math.round(pt.y - SIZE.useCase[1] / 2);
        chartData.useCases = cases();
        chartData.useCases.push(u);
        return u;
      }
      function freeSpot(pt, w, h) {
        const boxes = [...actors(), ...cases()].filter((o) => placed(o) && o.w).map(boxOf);
        let y = pt.y - h / 2;
        for (let k = 0; k < 60 && boxes.some((b) => overlap({ x: pt.x - w / 2, y, w, h }, b, 12)); k++) y += 48;
        return { x: pt.x, y: y + h / 2 };
      }
      function addActor(kind, pt) {
        const a = { id: uid('a'), name: kind === 'system' ? 'New system' : 'New actor' };
        if (kind === 'system') a.kind = 'system';
        const size = kind === 'system' ? SIZE.tile : SIZE.actor;
        const at = pt || freeSpot(viewCentre(), size[0], size[1]);
        a.x = Math.round(at.x - size[0] / 2); a.y = Math.round(at.y - size[1] / 2);
        chartData.actors = actors();
        chartData.actors.push(a);
        selectItem(a.id);
        commit(!pt);
        if (pt) { placeCentred(a, pt); }
        panIntoView(els.items.get(a.id));
        editName(a.id);
      }
      function addCase(pt) {
        const centre = pt || freeSpot(viewCentre(), SIZE.useCase[0], SIZE.useCase[1]);
        let s = subjectAt(centre);
        if (!s) { const p = primaryId(); const sel = p && caseOf(p); s = (sel && subjectOf(caseSubjectId(sel))) || subjectAt(viewCentre()) || null; }
        const u = newCase(s, centre);
        selectItem(u.id);
        commit(!pt);
        if (pt) placeCentred(u, pt);
        panIntoView(els.items.get(u.id));
        editName(u.id);
      }
      function addSubject(pt) {
        materialiseSubjects();
        const s = { id: uid('s'), name: 'New system' };
        const at = pt || viewCentre();
        s.x = Math.round(at.x - SIZE.subject[0] / 2); s.y = Math.round(at.y - SIZE.subject[1] / 2); s.w = SIZE.subject[0]; s.h = SIZE.subject[1];
        chartData.subjects.push(s);
        selectOther('subject', s.id);
        commit(!pt);
        panIntoView(els.subjects.get(s.id));
        editSubjectName(s.id);
      }

      // --- Delete ---
      function dropRefs(ids) {
        const gone = new Set(ids);
        chartData.links = linksOf().filter((l) => !gone.has(l.from) && !gone.has(l.to));
        [...actors(), ...cases()].forEach((o) => { if (o.parent && gone.has(o.parent)) delete o.parent; });
        notesList().forEach((n) => { ['useCases', 'actors'].forEach((k) => { if (n[k]) { n[k] = n[k].filter((x) => !gone.has(x)); if (!n[k].length) delete n[k]; } }); });
        chartData.notes = notesList().filter((n) => (n.useCases || []).length || (n.actors || []).length);
        if (!chartData.notes.length) delete chartData.notes;
      }
      function deleteItems(ids) {
        ids = ids.filter((id) => itemOf(id));
        if (!ids.length) return;
        const gone = new Set(ids);
        chartData.actors = actors().filter((a) => !gone.has(a.id));
        chartData.useCases = cases().filter((u) => !gone.has(u.id));
        dropRefs(ids);
        selIds = []; selOther = null;
        commit(true);
      }
      function deleteSubject(id) {
        const s = realSubjects().find((x) => x.id === id);
        if (!s) return;
        const mine = cases().filter((u) => caseSubjectId(u) === id).map((u) => u.id);
        chartData.subjects = realSubjects().filter((x) => x.id !== id);
        if (!chartData.subjects.length) delete chartData.subjects;
        chartData.useCases = cases().filter((u) => !mine.includes(u.id));
        dropRefs(mine);
        selIds = []; selOther = null;
        commit(true);
      }
      function deleteLink(id) {
        chartData.links = linksOf().filter((l) => l.id !== id);
        selIds = []; selOther = null;
        commit(true);
      }
      function confirmDelete(message, label, onOk, anchor) { ui.confirm(anchor, { message, label }, onOk); }
      function deleteSelection(anchorEl) {
        if (presenting()) return;
        const o = selOther;
        if (o && o.kind === 'note') { removeNote(o.id); return; }
        if (o && o.kind === 'link') { deleteLink(o.id); return; }
        if (o && o.kind === 'subject') {
          const n = cases().filter((u) => caseSubjectId(u) === o.id).length;
          const s = subjectOf(o.id);
          if (n) confirmDelete(`Delete ${nameOf(s)} and its ${n} use case${n === 1 ? '' : 's'}?`, 'Delete subject', () => deleteSubject(o.id), anchorEl || els.subjects.get(o.id));
          else deleteSubject(o.id);
          return;
        }
        if (!selIds.length) return;
        const ids = selIds.slice(), set = new Set(ids);
        const count = linksOf().filter((l) => set.has(l.from) || set.has(l.to)).length;
        const what = ids.length === 1 ? nameOf(itemOf(ids[0])) : `${ids.length} items`;
        if (count) confirmDelete(`Delete ${what} and ${count === 1 ? 'its line' : `its ${count} lines`}?`, 'Delete', () => deleteItems(ids), anchorEl || els.items.get(primaryId()));
        else deleteItems(ids);
      }

      // --- Property edits ---
      function setColor(slot) {
        const objs = selIds.map(itemOf).filter((o) => o && (o.color || '') !== slot);
        if (!objs.length) return;
        objs.forEach((o) => { if (slot) o.color = slot; else delete o.color; });
        render();
        updateStatus(true);
      }
      function toggleCollapsed(id) {
        const s = realSubjects().find((x) => x.id === id);
        if (!s) return;
        if (s.collapsed === true) delete s.collapsed; else s.collapsed = true;
        // the engine keeps a collapsed subject's use cases where they sit expanded, so expanding restores them;
        // with Auto-Tidy on the other subjects close up (collapse) or make room (expand)
        commit(true);
      }
      function moveToSubject(subjectId) {
        const s = subjectOf(subjectId), ids = selIds.filter((id) => caseOf(id));
        if (!s || !ids.length) return;
        const objs = ids.map(caseOf).filter(placed);
        if (typeof s.x === 'number' && objs.length) {
          const bx = Math.min(...objs.map((o) => o.x)), by = Math.min(...objs.map((o) => o.y));
          const bx2 = Math.max(...objs.map((o) => o.x + (o.w || 0))), by2 = Math.max(...objs.map((o) => o.y + (o.h || 0)));
          const dx = Math.round(s.x + s.w / 2 - (bx + bx2) / 2), dy = Math.round(s.y + (s._titleH || 36) + (s.h - (s._titleH || 36)) / 2 - (by + by2) / 2);
          objs.forEach((o) => { o.x += dx; o.y += dy; });
        }
        ids.forEach((id) => { caseOf(id).subject = subjectId; });
        commit(true);
      }
      function connectToCases() {
        const actor = selIds.find((id) => actorOf(id)), targets = selIds.filter((id) => caseOf(id));
        if (!actor || !targets.length) return;
        let made = 0;
        targets.forEach((id) => { if (!linkExists('association', actor, id)) { addLink('association', actor, id); made++; } });
        hint(made ? `${esc(nameOf(actorOf(actor)))} connected to ${made} use case${made === 1 ? '' : 's'}` : 'Already connected to all of them');
        if (made) commit(true);
      }
      function setParent(id, parentId) {
        const o = itemOf(id);
        if (!o) return;
        if (parentId) { if (wouldCycle(id, parentId)) { hint('That would make it a kind of itself'); return; } o.parent = parentId; } else delete o.parent;
        commit(true);
      }

      // --- Line edits ---
      const isCaseCase = (l) => !!caseOf(l.from) && !!caseOf(l.to);
      function setLinkType(l, type) {
        if (l.type === type) return;
        if (type === 'association' ? isCaseCase(l) : !isCaseCase(l)) { hint(type === 'association' ? 'An association joins an actor and a use case' : '«include» and «extend» join two use cases'); return; }
        const reversed = (l.type === 'include' && type === 'extend') || (l.type === 'extend' && type === 'include');
        if (reversed) { const f = l.from; l.from = l.to; l.to = f; }
        l.type = type;
        if (type !== 'extend') { delete l.condition; delete l.extensionPoint; }
        if (type !== 'association') delete l.navigable;
        if (reversed) hint(type === 'extend' ? '«extend» points from the extension to the base, so the line was reversed' : '«include» points from the base to the part it always needs, so the line was reversed');
        commit(false);
      }
      function reverseLink(l) {
        const f = l.from; l.from = l.to; l.to = f;
        if (l.type === 'extend') delete l.extensionPoint;
        commit(false);
      }
      function addPoint(u, name) {
        u.extensionPoints = Array.isArray(u.extensionPoints) ? u.extensionPoints : [];
        const n = name || `Point ${u.extensionPoints.length + 1}`;
        u.extensionPoints.push(n);
        return n;
      }

      // --- Menus (a small list under a button) ---
      let menuEl = null;
      function closeMenu() { if (!menuEl) return false; menuEl.remove(); menuEl = null; return true; }
      function openMenu(anchor, title, items, onPick) {
        closeMenu();
        const m = htmlEl('div', 'menu uc-menu');
        m.setAttribute('role', 'menu');
        m.dataset.exportSkip = '';
        if (title) m.appendChild(htmlEl('div', 'menu-label', title)).setAttribute('role', 'presentation');
        items.forEach((it) => {
          const b = htmlEl('button', '', it.label);
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          if (it.selected) b.setAttribute('aria-current', 'true');
          b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onPick(it.value); });
          m.appendChild(b);
        });
        document.body.appendChild(m);
        const r = anchor.getBoundingClientRect();
        m.style.left = px(Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)));
        const below = r.bottom + 6 + m.offsetHeight < innerHeight - 8;
        m.style.top = px(below ? r.bottom + 6 : Math.max(8, r.top - 6 - m.offsetHeight));
        menuEl = m;
        const first = m.querySelector('button');
        if (first) first.focus();
        m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } });
      }
      document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }, true);

      // --- ACTION BARS ---
      function abButton(act, content, title, pressed, value, extra) {
        const b = htmlEl('button', `uc-ab-btn${extra ? ' ' + extra : ''}`);
        b.type = 'button';
        b.dataset.act = act;
        if (value !== undefined) b.dataset.value = value;
        b.title = title;
        b.setAttribute('aria-label', title);
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
        b.innerHTML = content;
        return b;
      }
      const abSep = () => htmlEl('span', 'uc-ab-sep');
      const abBreak = () => htmlEl('span', 'uc-ab-break');
      const lineGlyph = (type, arrow) => `<svg width="30" height="14" viewBox="0 0 30 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7H${type === 'association' && !arrow ? 28 : 26}"${type === 'association' ? '' : ' stroke-dasharray="4 3"'}/>${type === 'association' && !arrow ? '' : '<path d="M21 2.5 28 7 21 11.5"/>'}</svg>`;
      const swatchOf = (ids) => { const cs = [...new Set(ids.map((id) => (itemOf(id) || {}).color || ''))]; return cs.length === 1 ? cs[0] : ''; };

      function drawSelectionTools() {
        html.querySelectorAll('.uc-actionbar').forEach((el) => el.remove());
        if (presenting()) return;
        const bar = htmlEl('div', 'uc-actionbar is-wrap');
        bar.dataset.exportSkip = '';
        bar.setAttribute('role', 'toolbar');
        let at = null;
        if (selOther && selOther.kind === 'link') at = linkBar(bar, linkOf(selOther.id));
        else if (selOther && selOther.kind === 'subject') at = subjectBar(bar, subjectOf(selOther.id));
        else if (selIds.length > 1) at = multiBar(bar);
        else if (selIds.length === 1) at = itemBar(bar, itemOf(selIds[0]));
        if (!at) return;
        html.appendChild(bar);
        const C = chartData.canvas || { width: 1e9, height: 1e9 }, w = bar.offsetWidth;
        const below = at.y < 110;
        bar.classList.toggle('is-below', below);
        Object.assign(bar.style, {
          left: px(Math.max(w / 2 - 30, Math.min(at.x, C.width - w / 2 + 30))),
          top: px(Math.max(2, below ? at.bottom + 10 : at.y - 10))
        });
      }
      const anchorOfBox = (b) => ({ x: b.x + b.w / 2, y: b.y, bottom: b.y + b.h });
      function itemBar(bar, o) {
        if (!o || !placed(o)) return null;
        const isActor = !!actorOf(o.id);
        bar.setAttribute('aria-label', isActor ? 'Actor' : 'Use case');
        if (isActor) {
          ['human', 'system', 'time'].forEach((k) => bar.appendChild(abButton('kind', ui.iconEl(KIND_ICON[k], { size: 'md' }).outerHTML, `Kind: ${k === 'human' ? 'person' : k}`, (o.kind || 'human') === k, k)));
        } else {
          LEVELS.forEach((lv) => bar.appendChild(abButton('level', `<span>${LEVEL_NAME[lv]}</span>`, `Level: ${lv === 'user' ? 'user goal' : lv}`, (o.level || 'user') === lv, lv)));
        }
        bar.appendChild(abSep());
        bar.appendChild(abButton('abstract', '<span><i>A</i></span>', 'Abstract: the name is shown in italics', o.abstract === true));
        if (!isActor) bar.appendChild(abButton('point', `${ui.icon('plus', { size: 'sm' })}<span>Point</span>`, 'Add an extension point'));
        const b = abButton('parent', `<span>Kind of</span>${ui.icon('chevron-down', { size: 'xs', bold: true })}`, 'Make this a specialisation of another (generalization)');
        b.dataset.menu = '';
        bar.appendChild(b);
        bar.appendChild(abButton('note', ui.icon('note'), 'Add a note (N)'));
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete (and its lines)', undefined, undefined, 'is-danger'));
        bar.appendChild(abBreak());
        bar.appendChild(swatchRow(o.color || '', setColor, { btnClass: 'uc-ab-swatch' }));
        return anchorOfBox(boxOf(o));
      }
      function multiBar(bar) {
        bar.setAttribute('aria-label', 'Selection');
        const objs = selIds.map(itemOf).filter((o) => o && placed(o));
        const nCases = selIds.filter((id) => caseOf(id)).length, nActors = selIds.length - nCases;
        bar.appendChild(htmlEl('span', 'uc-ab-tag', `${selIds.length} selected`));
        bar.appendChild(abSep());
        if (nCases && realSubjects().length) {
          const b = abButton('subject', `${ui.icon('subject', { size: 'sm' })}<span>Subject</span>${ui.icon('chevron-down', { size: 'xs', bold: true })}`, 'Move the selected use cases to another subject');
          b.dataset.menu = '';
          bar.appendChild(b);
        }
        if (nActors === 1 && nCases >= 1) bar.appendChild(abButton('connect', `${ui.icon('link', { size: 'sm' })}<span>Connect to ${nCases}</span>`, `Associate the actor with the ${nCases} selected use case${nCases === 1 ? '' : 's'}`));
        bar.appendChild(abButton('delete', `${ui.icon('trash')}<span>Delete ${selIds.length}</span>`, `Delete these ${selIds.length} items and their lines`, undefined, undefined, 'is-danger'));
        bar.appendChild(abBreak());
        bar.appendChild(swatchRow(swatchOf(selIds), setColor, { btnClass: 'uc-ab-swatch' }));
        const x0 = Math.min(...objs.map((o) => o.x)), y0 = Math.min(...objs.map((o) => o.y));
        const x1 = Math.max(...objs.map((o) => o.x + (o.w || 0))), y1 = Math.max(...objs.map((o) => o.y + (o.h || 0)));
        return anchorOfBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      function subjectBar(bar, s) {
        if (!s || typeof s.x !== 'number') return null;
        bar.setAttribute('aria-label', 'Subject');
        bar.appendChild(abButton('collapse', `${ui.icon('chevron-down', { size: 'sm' })}<span>${s.collapsed ? 'Expand' : 'Collapse'}</span>`, s.collapsed ? 'Show the use cases again' : 'Collapse the subject to its name', s.collapsed === true));
        bar.appendChild(abButton('rename', ui.icon('label'), 'Rename (F2)'));
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete the subject and its use cases', undefined, undefined, 'is-danger'));
        return anchorOfBox(boxOf(s));
      }
      function linkBar(bar, l) {
        if (!l || !l.points) return null;
        bar.setAttribute('aria-label', 'Line');
        const caseCase = isCaseCase(l);
        const typeBtn = (type, label, title) => {
          const b = abButton('type', `${lineGlyph(type, false)}<span>${label}</span>`, title, l.type === type, type);
          if (type === 'association' ? caseCase : !caseCase) b.setAttribute('aria-disabled', 'true');
          return b;
        };
        bar.appendChild(typeBtn('association', 'Association', 'Association: an actor takes part in a use case'));
        bar.appendChild(typeBtn('include', 'Include', '«include»: the base always needs the part'));
        bar.appendChild(typeBtn('extend', 'Extend', '«extend»: an optional addition to the base, only sometimes'));
        if (l.type === 'association') bar.appendChild(abButton('arrow', lineGlyph('association', true), 'Arrow: show who starts it (an open arrowhead toward the use case)', l.navigable === true, undefined, 'uc-ab-glyph'));
        bar.appendChild(abBreak());
        bar.appendChild(abButton('reverse', `${ui.icon('reverse', { size: 'sm' })}<span>Reverse</span>`, 'Reverse the direction of the line'));
        if (l.type === 'extend') {
          const input = htmlEl('input', 'uc-ab-input');
          input.type = 'text';
          input.placeholder = 'condition';
          input.maxLength = 80;
          input.value = l.condition || '';
          input.setAttribute('aria-label', 'Condition: when the extension applies');
          input.dataset.act = 'condition';
          bar.appendChild(input);
          const base = caseOf(l.to);
          const b = abButton('point-menu', `<span>${l.extensionPoint ? esc(l.extensionPoint) : 'Extension point'}</span>${ui.icon('chevron-down', { size: 'xs', bold: true })}`, 'The extension point of the base where this extension applies');
          b.dataset.menu = '';
          if (!base) b.setAttribute('aria-disabled', 'true');
          bar.appendChild(b);
        }
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete this line', undefined, undefined, 'is-danger'));
        const m = midOf(l.points);
        return { x: m.x, y: m.y, bottom: m.y };
      }
      html.addEventListener('click', (e) => {
        const b = e.target.closest('.uc-ab-btn');
        if (!b) return;
        e.stopPropagation();
        if (b.getAttribute('aria-disabled') === 'true' && b.dataset.act !== 'type') return;
        runAction(b.dataset.act, b.dataset.value, b);
      });
      html.addEventListener('keydown', (e) => {   // a key inside the condition field is the field's
        const input = e.target.closest && e.target.closest('.uc-ab-input');
        if (!input) return;
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = (linkOf(selOther && selOther.id) || {}).condition || ''; input.blur(); }
      });
      html.addEventListener('focusout', (e) => {
        const input = e.target.closest && e.target.closest('.uc-ab-input');
        if (!input || !selOther || selOther.kind !== 'link') return;
        const l = linkOf(selOther.id), v = input.value.trim().slice(0, 80);
        if (!l || (l.condition || '') === v) return;
        if (v) l.condition = v; else delete l.condition;
        commit(false);
      });

      function runAction(act, value, btn) {
        if (selOther && selOther.kind === 'link') {
          const l = linkOf(selOther.id);
          if (!l) return;
          if (act === 'type') setLinkType(l, value);
          else if (act === 'arrow') { if (l.navigable === true) delete l.navigable; else l.navigable = true; commit(false); }
          else if (act === 'reverse') reverseLink(l);
          else if (act === 'delete') deleteLink(l.id);
          else if (act === 'point-menu') {
            const base = caseOf(l.to);
            if (!base) return;
            const pts = (base.extensionPoints || []).map((p) => ({ label: String(p), value: String(p), selected: l.extensionPoint === p }));
            openMenu(btn, 'Extension point', [{ label: '(none)', value: '' }, ...pts, { label: '+ New point', value: '\u0000new' }], (v) => {
              if (v === '\u0000new') v = addPoint(base);
              if (v) l.extensionPoint = v; else delete l.extensionPoint;
              commit(false);
            });
          }
          return;
        }
        if (selOther && selOther.kind === 'subject') {
          if (act === 'collapse') toggleCollapsed(selOther.id);
          else if (act === 'rename') editSubjectName(selOther.id);
          else if (act === 'delete') deleteSelection(btn);
          return;
        }
        if (selIds.length > 1) {
          if (act === 'delete') deleteSelection(btn);
          else if (act === 'connect') connectToCases();
          else if (act === 'subject') openMenu(btn, 'Move to subject', realSubjects().map((s) => ({ label: nameOf(s), value: s.id })), moveToSubject);
          return;
        }
        const o = itemOf(primaryId());
        if (!o) return;
        if (act === 'kind') { if (value === 'human') delete o.kind; else o.kind = value; commit(false); }
        else if (act === 'level') { if (value === 'user') delete o.level; else o.level = value; commit(false); }
        else if (act === 'abstract') { if (o.abstract === true) delete o.abstract; else o.abstract = true; commit(false); }
        else if (act === 'point') { addPoint(o); commit(false); const eps = els.items.get(o.id).querySelectorAll('.uc-ep'); editPoint(o.id, eps.length - 1); }
        else if (act === 'note') addNoteTo(o.id);
        else if (act === 'delete') deleteSelection(btn);
        else if (act === 'parent') {
          const list = actorOf(o.id) ? actors() : cases();
          const pick = list.filter((x) => x.id !== o.id && !wouldCycle(x.id, o.id)).map((x) => ({ label: nameOf(x), value: x.id, selected: o.parent === x.id }));
          openMenu(btn, 'Is a kind of', [{ label: '(none)', value: '' }, ...pick], (v) => setParent(o.id, v));
        }
      }

      // --- INLINE TEXT EDITING (double-click, Enter / F2, or straight after creating something) ---
      function beginEdit(el, opts = {}) {
        if (!el || el.isContentEditable) return;
        if (opts.raw !== undefined) el.textContent = opts.raw;
        el.classList.add('is-editing');
        el.contentEditable = 'plaintext-only';
        el.spellcheck = false;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        const original = el.textContent;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el.removeEventListener('blur', finish);
          el.removeEventListener('keydown', onKey);
          el.contentEditable = 'false';
          el.classList.remove('is-editing');
          const value = el.textContent.replace(/\s*\n\s*/g, ' ').trim();
          const changed = value !== original ? !!opts.apply(value) : false;
          if (changed) commit(false); else el.textContent = opts.restore !== undefined ? opts.restore : original;
        };
        const onKey = (ke) => {
          if (ke.key === 'Enter' || ke.key === 'Tab' || ke.key === 'F2') ke.stopPropagation();
          if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); finish(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); el.textContent = original; el.blur(); finish(); }
        };
        el.addEventListener('blur', finish);
        el.addEventListener('keydown', onKey);
      }
      function editName(id) {
        const o = itemOf(id), el = els.items.get(id) && els.items.get(id).querySelector('.uc-name, .uc-actor-name');
        if (!o || !el) return;
        beginEdit(el, { raw: nameOf(o), restore: undefined, apply: (v) => { if (!v || v === nameOf(o)) return false; o.name = v; return true; } });
      }
      function editSubjectName(id) {
        const s = realSubjects().find((x) => x.id === id), el = els.subjects.get(id) && els.subjects.get(id).querySelector('.uc-subject-name');
        if (!s || !el) return;
        beginEdit(el, { apply: (v) => { if (!v || v === nameOf(s)) return false; s.name = v; return true; } });
      }
      function editPoint(id, idx) {
        const u = caseOf(id), el = els.items.get(id) && els.items.get(id).querySelectorAll('.uc-ep')[idx];
        if (!u || !el) return;
        beginEdit(el, {
          apply: (v) => {
            const old = u.extensionPoints[idx];
            if (!v) { u.extensionPoints.splice(idx, 1); if (!u.extensionPoints.length) delete u.extensionPoints; renamePoint(u, old, null); return true; }
            if (v === old) return false;
            u.extensionPoints[idx] = v;
            renamePoint(u, old, v);
            return true;
          }
        });
      }
      function renamePoint(u, from, to) {   // lines name the point of their base
        linksOf().forEach((l) => { if (l.type === 'extend' && l.to === u.id && l.extensionPoint === from) { if (to) l.extensionPoint = to; else delete l.extensionPoint; } });
      }
      function editLinkCondition(id) {
        const l = linkOf(id);
        if (!l || presenting()) return;
        if (!selOther || selOther.id !== id) selectOther('link', id);
        const input = html.querySelector('.uc-ab-input');
        if (l.type === 'extend' && input) { input.focus(); input.select(); }
      }
      function editSelection() {
        if (selOther && selOther.kind === 'note') { editNote(selOther.id); return; }
        if (selOther && selOther.kind === 'subject') { editSubjectName(selOther.id); return; }
        if (selOther && selOther.kind === 'link') { editLinkCondition(selOther.id); return; }
        if (selIds.length === 1) editName(selIds[0]);
      }
      html.addEventListener('dblclick', (e) => {
        if (presenting()) return;
        const t = e.target;
        if (t.closest('.uc-actionbar, .frame-chev, .note-badge, .note-add, .uc-port, .note') || t.isContentEditable) return;
        const ep = t.closest('.uc-ep');
        const item = t.closest('.uc-actor, .uc-case');
        if (item) { e.stopPropagation(); if (ep) editPoint(item.dataset.nodeId, Number(ep.dataset.index)); else editName(item.dataset.nodeId); return; }
        const title = t.closest('.uc-subject-title');
        if (title && realSubjects().some((s) => s.id === title.parentNode.dataset.subjectId)) { e.stopPropagation(); editSubjectName(title.parentNode.dataset.subjectId); }
      });

      // --- DOCK TOOLS: click adds at the centre of the view, a drag drops it under the pointer with a ghost ---
      function ghostFor(kind) {
        let g;
        if (kind === 'case') {
          g = htmlEl('div', 'uc-case uc-ghost');
          g.dataset.level = 'user';
          const shape = htmlEl('div', 'uc-shape');
          shape.appendChild(htmlEl('div', 'uc-name-wrap')).appendChild(htmlEl('span', 'uc-name t-label', 'New use case'));
          g.appendChild(shape);
          g.style.width = px(SIZE.useCase[0]); g.style.height = px(SIZE.useCase[1]);
        } else if (kind === 'subject') {
          g = htmlEl('div', 'uc-subject uc-ghost');
          g.appendChild(htmlEl('div', 'uc-subject-title')).style.height = '36px';
          g.firstChild.appendChild(htmlEl('span', 'uc-subject-name t-title', 'New system'));
          g.style.width = px(SIZE.subject[0]); g.style.height = px(SIZE.subject[1]);
        } else if (kind === 'note') {
          g = htmlEl('div', 'note note-ghost uc-ghost');
          g.appendChild(htmlEl('div', 'note-text', 'Note'));
        } else {
          const tile = kind === 'system';
          g = htmlEl('div', 'uc-actor uc-ghost');
          g.appendChild(avatar(tile ? 'system' : 'human', 56));
          g.appendChild(htmlEl('span', 'uc-actor-name t-label', tile ? 'New system' : 'New actor'));
          if (tile) g.appendChild(htmlEl('span', 'uc-kw t-caption', KIND_CAPTION.system));
          const sz = tile ? SIZE.tile : SIZE.actor;
          g.style.width = px(sz[0]); g.style.height = px(sz[1]);
        }
        return g;
      }
      function wireTool(btn, kind, onClick, onDrop) {
        if (!btn) return;
        let tool = null;
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          const d = tool;
          tool = null;
          if (d && d.ghost) { d.ghost.remove(); document.body.classList.remove('palette-dragging'); }
          canvas.querySelectorAll('.drop-target, .note-target').forEach((el) => el.classList.remove('drop-target', 'note-target'));
          return d;
        };
        const move = (e) => {
          const d = tool;
          if (!d) return;
          if (!d.ghost) {
            if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
            setNotePicking(false);
            d.ghost = ghostFor(kind);
            document.body.appendChild(d.ghost);
            document.body.classList.add('palette-dragging');
          }
          d.ghost.style.transform = `scale(${scale})`;
          d.ghost.style.left = px(e.clientX - d.ghost.offsetWidth * scale / 2);
          d.ghost.style.top = px(e.clientY - d.ghost.offsetHeight * scale / 2);
          const pt = canvasPoint(e), C = chartData.canvas || { width: 0, height: 0 };
          const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('#uc-canvas') && pt.x >= -40 && pt.y >= -40 && pt.x <= C.width + 40 && pt.y <= C.height + 40;
          d.pt = over ? pt : null;
          d.id = kind === 'note' ? itemIdAt(e.clientX, e.clientY) : null;
          d.ghost.classList.toggle('off-target', kind === 'note' ? !d.id : !over);
          canvas.querySelectorAll('.drop-target, .note-target').forEach((el) => el.classList.remove('drop-target', 'note-target'));
          if (kind === 'note' && d.id) els.items.get(d.id).classList.add('note-target');
          if (kind === 'case' && over) { const s = subjectAt(pt), el = s && els.subjects.get(s.id); if (el) el.classList.add('drop-target'); }
        };
        const up = () => {
          const d = end();
          if (!d || !d.ghost) return;
          btn.dataset.dragged = '1';
          if (kind === 'note' ? d.id : d.pt) onDrop(kind === 'note' ? d.id : d.pt);
        };
        const cancel = () => { end(); };
        btn.addEventListener('click', (e) => {
          if (btn.dataset.dragged) { delete btn.dataset.dragged; e.preventDefault(); return; }
          if (presenting()) return;
          setNotePicking(false);
          onClick();
        });
        btn.addEventListener('pointerdown', (e) => {
          delete btn.dataset.dragged;
          if (e.button !== 0 || presenting()) return;
          tool = { startX: e.clientX, startY: e.clientY, ghost: null, pt: null };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', cancel);
        });
        btn._cancelTool = () => { const d = end(); return !!(d && d.ghost); };
      }
      wireTool(document.getElementById('btn-add-actor'), 'actor', () => addActor('human'), (pt) => addActor('human', pt));
      wireTool(document.getElementById('btn-add-system'), 'system', () => addActor('system'), (pt) => addActor('system', pt));
      wireTool(document.getElementById('btn-add-usecase'), 'case', () => addCase(), (pt) => addCase(pt));
      wireTool(document.getElementById('btn-add-subject'), 'subject', () => addSubject(), (pt) => addSubject(pt));
      // Note: a click adds one to the selected item; with nothing selected it waits for a click on an item; a drag gives the item under the drop a note
      wireTool(document.getElementById('btn-add-note'), 'note', () => {
        const p = primaryId();
        if (p) addNoteTo(p); else if (selectedNoteId()) editNote(selectedNoteId()); else setNotePicking(!notePicking);
      }, (id) => giveNoteTo(id));
      function setNotePicking(on) {
        if (notePicking === on) return;
        notePicking = on;
        document.body.classList.toggle('note-picking', on);
        document.getElementById('btn-add-note').setAttribute('aria-pressed', String(on));
        if (on) hint('Click an actor or a use case to add a note · <kbd>Esc</kbd> to cancel', true); else hint(null);
      }
      function giveNoteTo(id) { setNotePicking(false); selectItem(id); addNoteTo(id); }

      // --- KEYBOARD ---
      function cancelInteraction() {
        let did = false;
        if (ui.closeConfirm()) did = true;
        if (closeMenu()) did = true;
        if (cancelDrag()) did = true;
        ['btn-add-actor', 'btn-add-system', 'btn-add-usecase', 'btn-add-subject', 'btn-add-note'].forEach((id) => { const b = document.getElementById(id); if (b && b._cancelTool && b._cancelTool()) did = true; });
        if (notePicking) { setNotePicking(false); did = true; }
        return did;
      }
      function clearSelectionNow() {
        selIds = []; selOther = null; peekId = null;
        applySelection();
        applyNoteVisibility();
      }
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const a = document.activeElement;
        if (a && a.isContentEditable) return;
        if (a && a.tagName === 'INPUT') return;
        if (cancelInteraction()) return;
        if (selIds.length || selOther) { clearSelectionNow(); return; }
        if (searchQ) clearSearch();
      }, true);
      window.addEventListener('keydown', (e) => {
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingInField()) { e.preventDefault(); searchEl.focus(); searchEl.select(); return; }
        if (presenting() ? !(e.key.startsWith('Arrow')) : false) return;
        if (drag || e.ctrlKey || e.metaKey) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a.tagName === 'BUTTON' && e.key === 'Enter'))) return;
        if (ui.isConfirmOpen() || menuEl) return;
        if ((e.key === 'Enter' || e.key === 'F2') && !presenting() && (selIds.length === 1 || selOther)) { e.preventDefault(); editSelection(); return; }
        if ((e.key === 'n' || e.key === 'N') && !e.altKey && !presenting()) {
          const p = primaryId();
          if (p && selIds.length === 1) { e.preventDefault(); addNoteTo(p); } else if (selectedNoteId()) { e.preventDefault(); editNote(selectedNoteId()); }
          return;
        }
        if (e.key.startsWith('Arrow') && !e.altKey) { e.preventDefault(); walk(e.key); }
      });
      const typingInField = () => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
      // Arrow keys: the nearest drawn item in that direction
      function walk(key) {
        const all = [...actors(), ...cases()].filter((o) => drawn(o.id) && o.w);
        if (!all.length) return;
        const cur = itemOf(primaryId());
        if (!cur) { selectItem(all[0].id); focusItem(all[0].id); return; }
        const c = centreOf(cur), dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
        let best = null;
        all.forEach((o) => {
          if (o === cur) return;
          const p = centreOf(o), dx = p.x - c.x, dy = p.y - c.y, along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1] - dy * dir[0]);
          if (along <= 0 || across > along * 2.5) return;
          const score = along + 2 * across;
          if (!best || score < best.score) best = { o, score };
        });
        if (best) { selectItem(best.o.id); focusItem(best.o.id); }
      }
      function focusItem(id) {
        const el = els.items.get(id);
        if (!el) return;
        el.focus({ preventScroll: true });
        panIntoView(el);
      }

      // --- DISK FORMAT (the page's data block) ---
      // Written for a reader: fixed key order, schemaVersion 1, every actor's and use case's x/y in one trailing "layout" map
      // {id: {x, y}} (actors first, then use cases), derived geometry dropped, editor-generated ids renamed (actors, use
      // cases and subjects after their name; links l<N>; notes n<N>). scripts/disk_format.py (usecase_to_disk) is the
      // Python twin: keep the two byte-identical. Notes carry no positions on disk (a dragged note's _pos is dropped).
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'showRefs', 'showNotes', 'colorKey', 'subjects', 'actors', 'useCases', 'links', 'notes', 'layout'];
      const DISK_DERIVED = [['subjects', ['x', 'y', 'w', 'h']], ['actors', ['w', 'h']], ['useCases', ['w', 'h']], ['links', ['points', 'labelBox']]];
      const DISK_OBJECTS = ['subjects', 'actors', 'useCases', 'links', 'notes'];
      const GENERATED_ID = /^(a|u|s|l|n)_\d{12,}(_\d+)?$/;
      const SLUG_MAX = 30;
      function slug(text) {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/_+$/, '');
        return s;
      }
      function renameGeneratedIds(d) {
        const ss = d.subjects || [], acs = d.actors || [], ucs = d.useCases || [], ls = d.links || [], ns = d.notes || [];
        const used = new Set([...ss, ...acs, ...ucs, ...ls, ...ns].map((o) => o.id));
        const rename = new Map();
        const take = (base) => { let id = base, k = 2; while (used.has(id)) id = `${base}_${k++}`; used.add(id); return id; };
        const generated = (o) => GENERATED_ID.test(String(o.id == null ? '' : o.id));
        [[acs, 'actor'], [ucs, 'use_case'], [ss, 'subject']].forEach(([items, fallback]) => items.forEach((o) => { if (generated(o)) rename.set(o.id, take(slug(o.name) || fallback)); }));
        [[ls, 'l'], [ns, 'n']].forEach(([items, prefix]) => {
          let count = 1;
          items.forEach((o) => {
            if (!generated(o)) return;
            while (used.has(`${prefix}${count}`)) count++;
            rename.set(o.id, take(`${prefix}${count}`));
          });
        });
        if (!rename.size) return;
        const r = (id) => (rename.has(id) ? rename.get(id) : id);
        [...ss, ...acs, ...ucs, ...ls, ...ns].forEach((o) => { o.id = r(o.id); });
        ls.forEach((l) => ['from', 'to'].forEach((k) => { if (k in l) l[k] = r(l[k]); }));
        [...acs, ...ucs].forEach((o) => { if ('parent' in o) o.parent = r(o.parent); });
        ucs.forEach((u) => { if ('subject' in u) u.subject = r(u.subject); });
        ns.forEach((n) => ['useCases', 'actors'].forEach((k) => { if (Array.isArray(n[k])) n[k] = n[k].map(r); }));
      }
      const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        Object.keys(d).forEach((k) => { if (k === 'layout' || k === 'canvas' || (k[0] === '_' && k !== '_readme')) delete d[k]; });
        d.schemaVersion = 1;
        slotColors(d, 'actors', 'useCases');
        DISK_OBJECTS.forEach((name) => (d[name] || []).forEach((o) => Object.keys(o).forEach((k) => { if (k[0] === '_') delete o[k]; })));
        DISK_DERIVED.forEach(([list, keys]) => (d[list] || []).forEach((o) => keys.forEach((k) => { delete o[k]; })));
        renameGeneratedIds(d);
        const layout = {};
        ['actors', 'useCases'].forEach((list) => (d[list] || []).forEach((o) => {
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
        delete d.direction;
        if (d.schemaVersion === undefined || d.schemaVersion === 1) {
          ['actors', 'useCases'].forEach((list) => (d[list] || []).forEach((o) => Object.assign(o, layout[o.id] || {})));
        }
        slotColors(d, 'actors', 'useCases');
        return d;
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'usecase',
        defaultTitle: 'Interactive Use Case Diagram',
        toDisk,
        fromDisk,
        contentEl: canvas,
        report: { node: '.uc-actor, .uc-case', label: '.uc-label', labelText: '.uc-label-text', nodeText: '.uc-name, .uc-actor-name' },
        render,
        isBackground: (el) => el === canvas || el === svg || el === overlay || el === html || el.id === 'uc-notes',
        clearSelection: clearSelectionNow,
        cancelInteraction,
        hasSelection: () => !!selIds.length || !!selOther,
        selectInRect(r, mode, start) {
          if (presenting()) return;
          if (start) selectInRect.base = selOther ? [] : selIds.slice();
          const hit = [...els.items.entries()].filter(([, el]) => {
            const b = el.getBoundingClientRect();
            return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
          }).map(([id]) => id);
          const base = selectInRect.base || [];
          const next = mode === 'toggle' ? base.filter((id) => !hit.includes(id)).concat(hit.filter((id) => !base.includes(id))) : hit;
          if (next.length === selIds.length && next.every((id) => selIds.includes(id)) && !selOther) return;
          setSel(next, null);
        },
        selectAll() { if (!presenting()) setSel([...actors(), ...cases()].filter((o) => drawn(o.id)).map((o) => o.id), null); },
        deleteSelection,
        contentOverflow() {
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          const H = canvas.offsetHeight, W = canvas.offsetWidth;
          if (legendEl) o.bottom = Math.max(o.bottom, 12 + legendEl.offsetHeight + 12);
          if (notesLayer && chartData.showNotes) {
            [...notesLayer.children].forEach((card) => {
              const x = parseFloat(card.style.left) || 0, y = parseFloat(card.style.top) || 0, w = card.offsetWidth, h = card.offsetHeight;
              if (!w) return;
              o.left = Math.max(o.left, 12 - x); o.top = Math.max(o.top, 12 - y);
              o.right = Math.max(o.right, x + w + 12 - W); o.bottom = Math.max(o.bottom, y + h + 12 - H);
            });
          }
          return o;
        }
      });
      function selectInRect() {}   // holds the box's starting selection (selectInRect.base)
      })();
