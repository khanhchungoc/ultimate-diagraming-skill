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

      const LINK_TYPES = ['association', 'include', 'extend'];
      const KIND_ICON = { human: 'user', system: 'server', time: 'clock' };   // drawn in a round avatar
      const KIND_CAPTION = { system: '«system»', time: '«time»' };
      const LEVELS = ['user', 'subfunction'];   // a file may still carry level: summary (drawn large, bold); the bar no longer offers it
      const LEVEL_NAME = { summary: 'Summary', user: 'Goal', subfunction: 'Sub' };
      const SIZE = { actor: [104, 104], tile: [104, 120], useCase: [150, 60], subject: [280, 180] };   // a ghost's and a new item's first size

      // --- STATE ---
      let selIds = [];            // selected actors and use cases (primary last)
      let selOther = null;        // { kind: 'link' | 'subject' | 'note' | 'key', id }
      let hoverLinkId = null;
      let linkBarAvoid = null;    // { id, x, y }: pointer position of the press that selected a link, so the bar flips away from it
      let hoverItemId = null;     // the actor or use case under the pointer: what it connects to directly stays lit, the rest dims
      let hoverSubjectId = null;  // the subject frame under the pointer (tracked in JS so the frame keeps pointer-events: none)
      let actorSw = new Map();    // actor id -> its colour slot (its own colour, else one picked for it; see actorSlots)
      let levelsOn = true;        // view only: off hides the subfunction use cases
      let autoTidy = true;        // always on for now (the Auto-Tidy button is hidden), so a saved 'off' is not read
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

      // Marker variants: the base markers are in stage.html; in / out / sel take the directional or primary colour (--mk)
      (function makeMarkerVariants() {
        const VARIANTS = { in: '--edge-in', out: '--edge-out', sel: '--primary' };
        ['uc-mk-open', 'uc-mk-tri'].forEach((id) => {
          const base = document.getElementById(id);
          if (!base) return;
          Object.entries(VARIANTS).forEach(([k, tok]) => {
            const copy = base.cloneNode(true);
            copy.id = `${id}-${k}`;
            copy.style.setProperty('--mk', `var(${tok})`);
            base.parentNode.appendChild(copy);
          });
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
        if (text === null) { if (el) motion.hideHint(el); return; }
        if (!el) {
          el = htmlEl('div', 'hint');
          el.setAttribute('role', 'status');
          el.dataset.exportSkip = '';
          document.body.appendChild(el);
        }
        el.innerHTML = text;
        if (!sticky) hintTimer = setTimeout(() => motion.hideHint(el), 3600);
      }

      // --- MOTION HELPERS ---
      const FLIP_SPECS = [
        { selector: '.uc-actor[data-node-id]', key: 'nodeId' },
        { selector: '.uc-case[data-node-id]', key: 'nodeId', mode: 'size' },
        { selector: '.uc-subject[data-subject-id]', key: 'subjectId', mode: 'clip' },
        { selector: '.uc-label[data-edge-id]', key: 'edgeId' },
        { selector: '.note[data-note-id]', key: 'noteId' }
      ];
      let ucGhosts = [];
      function cancelUcGhosts() {
        for (let i = 0; i < ucGhosts.length; i++) { try { ucGhosts[i].cancel(); } catch (_) {} }
        ucGhosts = [];
      }
      function parsePathCoords(d) {
        if (!d) return null;
        const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (d.includes(' C ') && nums.length === 8) return { kind: 'bezier', pts: nums, d };
        if (d.includes(' Q ') && !d.includes(' L ') && nums.length === 6) {
          const [x0, y0, cx, cy, x2, y2] = nums;
          return { kind: 'bezier', pts: [x0, y0, (x0 + 2 * cx) / 3, (y0 + 2 * cy) / 3, (x2 + 2 * cx) / 3, (y2 + 2 * cy) / 3, x2, y2], d };
        }
        if (!d.includes(' C ') && !d.includes(' Q ') && nums.length === 4) return { kind: 'line', pts: nums, d };
        return { kind: 'raw', pts: null, d };
      }
      const toBezier = (c) => (c.kind === 'bezier' ? c.pts : [
        c.pts[0], c.pts[1],
        c.pts[0] + (c.pts[2] - c.pts[0]) / 3, c.pts[1] + (c.pts[3] - c.pts[1]) / 3,
        c.pts[0] + 2 * (c.pts[2] - c.pts[0]) / 3, c.pts[1] + 2 * (c.pts[3] - c.pts[1]) / 3,
        c.pts[2], c.pts[3]
      ]);
      function captureSvg() {
        if (!motion.enabled()) return null;
        const links = new Map(), parents = new Map(), leaders = new Map();
        els.links.forEach((rec, id) => {
          const line = rec.g.querySelector('.edge-line');
          if (line) links.set(id, parsePathCoords(line.getAttribute('d')));
        });
        els.parents.forEach((g) => {
          const line = g.querySelector('.edge-line');
          if (line) parents.set(`${g.dataset.from}->${g.dataset.to}`, parsePathCoords(line.getAttribute('d')));
        });
        leadersG.querySelectorAll('.note-leader[data-note-id][data-item-id]').forEach((l) => {
          leaders.set(`${l.dataset.noteId}:${l.dataset.itemId}`, [
            +l.getAttribute('x1') || 0, +l.getAttribute('y1') || 0,
            +l.getAttribute('x2') || 0, +l.getAttribute('y2') || 0
          ]);
        });
        return { links, parents, leaders };
      }
      function playSvg(svgSnap, opts) {
        if (!svgSnap || !motion.enabled()) return;
        const o = opts || {}, tracks = [], drawEls = [];
        const addDiff = (el, prev, cur) => {
          if (!prev || !cur || prev.d === cur.d) return;
          if (prev.pts && cur.pts) {
            const bz = prev.kind === 'bezier' || cur.kind === 'bezier';
            const from = bz ? toBezier(prev) : prev.pts, to = bz ? toBezier(cur) : cur.pts;
            let diff = false;
            for (let i = 0; i < from.length; i++) if (Math.abs(from[i] - to[i]) > 0.3) { diff = true; break; }
            if (diff) tracks.push({ type: bz ? 'bezier' : 'line', el, from, to });
          } else {
            drawEls.push(el);
          }
        };
        els.links.forEach((rec, id) => {
          const line = rec.g.querySelector('.edge-line');
          if (!line) return;
          if (o.drawLinkIds && o.drawLinkIds.has(id)) { drawEls.push(line); return; }
          const prev = svgSnap.links.get(id);
          if (prev) addDiff(line, prev, parsePathCoords(line.getAttribute('d')));
          else drawEls.push(line);
        });
        els.parents.forEach((g) => {
          const line = g.querySelector('.edge-line');
          if (!line) return;
          const prev = svgSnap.parents.get(`${g.dataset.from}->${g.dataset.to}`);
          if (prev) addDiff(line, prev, parsePathCoords(line.getAttribute('d')));
          else drawEls.push(line);
        });
        leadersG.querySelectorAll('.note-leader[data-note-id][data-item-id]').forEach((l) => {
          const key = `${l.dataset.noteId}:${l.dataset.itemId}`;
          const prev = svgSnap.leaders.get(key);
          const cur = [+l.getAttribute('x1') || 0, +l.getAttribute('y1') || 0, +l.getAttribute('x2') || 0, +l.getAttribute('y2') || 0];
          if (prev) {
            if (prev.some((v, i) => Math.abs(v - cur[i]) > 0.3)) tracks.push({ type: 'line', el: l, from: prev, to: cur });
          } else if (o.drawNewLeaders && (l.classList.contains('show') || l.classList.contains('peek'))) {
            drawEls.push(l);
          }
        });
        if (tracks.length) motion.tweenSvg(tracks, { duration: o.duration, easing: o.easing });
        for (let i = 0; i < drawEls.length; i++) motion.drawPath(drawEls[i], { duration: 140, easing: 'curve-out' });
      }

      // --- RENDERING ---
      function ensureLayout() {
        routeDiagram(chartData);   // lays out afresh by itself when an actor or use case has no x/y
      }

      // What the last render built into an element: sig (everything the builder reads except the position, which is set in
      // place) and cls (its base classes, put back before the state classes are applied again).
      const elState = new WeakMap();
      const sigOf = (o, extra) => JSON.stringify(o, (k, v) => (k === 'x' || k === 'y' ? undefined : v)) + extra;
      const itemSig = (o, extra) => `${presenting()}|${sigOf(o, extra)}`;
      const subjectSig = (s) => `${realSubjects().includes(s)}|${JSON.stringify(s, (k, v) => (k === 'x' || k === 'y' || k === 'w' || k === 'h' ? undefined : v))}`;
      const noteSig = (notes) => notes.map((n) => `${n.id}\u0001${noteText(n)}`).join('\u0002');
      // The element kept under `id`, brought back to a clean state; updated in place when its signature changed so morphs keep identity
      function keyed(map, id, sig, build) {
        let el = map.get(id), st = el && elState.get(el);
        if (!el) {
          el = build();
          elState.set(el, { sig, cls: el.getAttribute('class') || '' });
          map.set(id, el);
        } else if (!st || st.sig !== sig) {
          const fresh = build();
          const keep = new Set();
          for (const a of fresh.attributes) {
            keep.add(a.name);
            if (a.name !== 'style' && el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value);
          }
          for (const a of [...el.attributes]) {
            if (a.name !== 'style' && !keep.has(a.name)) el.removeAttribute(a.name);
          }
          el.style.translate = '';
          el.style.transformOrigin = '';
          el.replaceChildren(...fresh.childNodes);
          elState.set(el, { sig, cls: fresh.getAttribute('class') || '' });
        } else {
          el.setAttribute('class', st.cls);
          el.style.translate = '';
          el.style.transformOrigin = '';   // left by an entrance morph; a new element has none
        }
        return el;
      }
      // A text edit changes the element behind the model's back: build it again on the next render
      const staleEl = (el) => { const st = el && elState.get(el); if (st) st.sig = null; };
      function pruneKeyed(map, seen) {
        map.forEach((el, id) => { if (!seen.has(id)) { el.remove(); map.delete(id); } });
      }
      // Children of `layer` in the order they are put: an element already in its place is left alone (focus, scroll, hover)
      function layerCursor(layer) {
        let last = null;
        const place = (el) => {
          const want = last ? last.nextSibling : layer.firstChild;
          if (want !== el) layer.insertBefore(el, want);
          last = el;
        };
        place.sweep = () => { while (last ? last.nextSibling : layer.firstChild) (last ? last.nextSibling : layer.firstChild).remove(); };
        return place;
      }
      function setBox(el, b) {
        const st = el.style, l = px(b.x), t = px(b.y), w = px(b.w), h = px(b.h);
        if (st.left !== l) st.left = l;
        if (st.top !== t) st.top = t;
        if (st.width !== w) st.width = w;
        if (st.height !== h) st.height = h;
      }
      // item id -> its live notes, from one pass over the notes
      function notesByItem() {
        const by = new Map();
        liveNotes().forEach((n) => linkedItems(n).forEach((id) => { if (!by.has(id)) by.set(id, []); by.get(id).push(n); }));
        return by;
      }

      function render(motionOpts) {
        const useMotion = motionOpts !== false && motion.enabled();
        const mOpts = typeof motionOpts === 'object' && motionOpts ? motionOpts : {};
        let snap = mOpts.snap || null, svgSnap = mOpts.svgSnap || null;
        if (useMotion && !snap) {
          cancelUcGhosts();
          snap = motion.capture(canvas, FLIP_SPECS, mOpts.captureOpts);
          svgSnap = captureSvg();
        }
        html.querySelectorAll('.uc-actionbar').forEach((el) => motion.hideBar(el));
        motion.tweenSvg([]);   // a line tween still running would write its old end points onto the lines kept below
        ensureLayout();
        const C = chartData.canvas || { width: 800, height: 400 };
        canvas.style.width = px(C.width);
        canvas.style.height = px(C.height);
        svg.setAttribute('width', C.width);
        svg.setAttribute('height', C.height);
        const hadFocus = document.activeElement && html.contains(document.activeElement) && document.activeElement.dataset.nodeId;
        leadersG.textContent = '';
        actorSw = actorSlots();
        selIds = selIds.filter((id) => itemOf(id));
        if (selOther && !otherExists(selOther)) selOther = null;
        if (hoverLinkId && !linkOf(hoverLinkId)) hoverLinkId = null;
        if (hoverSubjectId && !subjectOf(hoverSubjectId)) hoverSubjectId = null;

        // Items, subjects, lines and labels are kept from one render to the next and updated in place (element identity is
        // what the motion morphs follow); only what changed is built again. Everything else in #uc-html (legend, notes,
        // the action bar) is dropped and drawn anew.
        const notesBy = notesByItem(), place = layerCursor(html), seenItems = new Set(), seenSubjects = new Set();
        allSubjects().forEach((s) => {
          const el = keyed(els.subjects, s.id, subjectSig(s), () => buildSubject(s));
          setBox(el, typeof s.x === 'number' ? s : { x: 0, y: 0, w: 200, h: 100 });
          el.classList.toggle('is-hover', s.id === hoverSubjectId);
          place(el); seenSubjects.add(s.id);
        });
        renderLinks();
        actors().forEach((a) => {
          if (!placed(a)) return;
          const notes = notesBy.get(a.id) || [];
          const el = keyed(els.items, a.id, itemSig(a, `${actorSw.get(a.id)}|${noteSig(notes)}`), () => buildActor(a, notes));
          setBox(el, a);
          place(el); seenItems.add(a.id);
        });
        cases().forEach((u) => {
          if (!placed(u) || isHiddenCase(u)) return;
          const notes = notesBy.get(u.id) || [];
          const el = keyed(els.items, u.id, itemSig(u, `${chartData.showRefs === true}|${noteSig(notes)}`), () => buildCase(u, notes));
          setBox(el, u);
          place(el); seenItems.add(u.id);
        });
        renderLabels(place);
        place.sweep();
        pruneKeyed(els.items, seenItems);
        pruneKeyed(els.subjects, seenSubjects);
        renderLegend();
        renderNotes(true);
        updateButtons();
        applySelection();
        if (hadFocus && els.items.has(hadFocus)) els.items.get(hadFocus).focus({ preventScroll: true });
        if (useMotion && snap) {
          const freeIds = new Set(notesList().filter(isFreeNote).map((n) => n.id));
          const skipKeys = mOpts.skipKeys ? new Set([...freeIds, ...mOpts.skipKeys]) : freeIds;
          motion.play(snap, canvas, FLIP_SPECS, Object.assign({}, mOpts, { skipKeys }));
          playSvg(svgSnap, mOpts);
          if (mOpts.afterPlay) mOpts.afterPlay();
        }
      }
      function otherExists(o) {
        if (o.kind === 'link') return !!linkOf(o.id);
        if (o.kind === 'subject') return !!subjectOf(o.id);
        if (o.kind === 'note') return !!noteOf(o.id);
        if (o.kind === 'key') return ucKeyColors().includes(o.id);
        return false;
      }

      function buildSubject(s) {
        const real = realSubjects().includes(s);
        const el = htmlEl('div', 'uc-subject');
        el.dataset.item = '';
        el.dataset.subjectId = s.id;
        const titleH = s._titleH || 36;
        if (s.collapsed === true) el.classList.add('is-collapsed');
        const title = htmlEl('div', 'uc-subject-title');
        title.style.height = px(titleH);
        title.tabIndex = -1;
        if (real) {
          const chev = ui.chevron({ expanded: s.collapsed !== true, label: s.collapsed === true ? 'Expand this subject' : 'Collapse this subject to its name' });
          chev.dataset.exportSkip = '';
          title.appendChild(chev);
        }
        title.appendChild(htmlEl('span', 'uc-subject-name t-title', nameOf(s) || (real ? '' : 'System')));
        el.appendChild(title);
        if (real && s.collapsed !== true) {
          // Tabs on the right and bottom edges: drag one to grow or shrink the frame in that direction
          [['x', 'Drag to change the width'], ['y', 'Drag to change the height']].forEach(([axis, title]) => {
            const tab = htmlEl('div', `uc-subject-tab is-${axis}`);
            tab.dataset.exportSkip = '';
            tab.dataset.axis = axis;
            tab.title = title;
            el.appendChild(tab);
          });
        }
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

      function buildActor(a, notes) {
        const el = htmlEl('div', 'uc-actor');
        el.dataset.nodeId = a.id;
        el.dataset.kind = a.kind || 'human';
        el.tabIndex = -1;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `Actor ${nameOf(a)}${isTile(a) ? ` (${a.kind})` : ''}`);
        setSwatch(el, actorSw.get(a.id));
        el.appendChild(avatar(a.kind, a._figW));
        el.appendChild(htmlEl('span', `uc-actor-name t-label${a.abstract ? ' is-abstract' : ''}`, nameOf(a)));
        if (isTile(a)) el.appendChild(htmlEl('span', 'uc-kw t-caption', KIND_CAPTION[a.kind]));
        addItemChrome(el, a, notes);
        return el;
      }

      function buildCase(u, notes) {
        const el = htmlEl('div', 'uc-case');
        el.dataset.nodeId = u.id;
        el.dataset.level = LEVELS.includes(u.level) ? u.level : 'user';
        el.tabIndex = -1;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `Use case ${nameOf(u)}`);
        if (u.color) setSwatch(el, u.color);
        const shape = htmlEl('div', 'uc-shape');
        if (typeof u._r === 'number') shape.style.borderRadius = px(u._r);   // the engine's corner radius: a pill on one line
        const wrap = htmlEl('div', 'uc-name-wrap');
        const lines = Array.isArray(u._lines) && u._lines.length ? u._lines : [nameOf(u)];
        const name = htmlEl('span', `uc-name t-label${u.abstract ? ' is-abstract' : ''}`, lines.join('\n'));
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
        addItemChrome(el, u, notes);
        return el;
      }

      // Connect port, note badge or + chip
      function addItemChrome(el, o, notes) {
        if (!presenting()) {
          [false, true].forEach((leftPort) => {   // an anchor on each side
            const port = ui.port(leftPort ? 'left' : 'right');
            port.dataset.touchDrag = '';
            port.title = 'Drag to another item to connect them (blank space inside a subject draws out a new use case)';
            if (o._figW && typeof o.w === 'number') {   // an actor: the port sits on the avatar's rim, level with its centre
              const off = px((o.w - o._figW) / 2);
              port.style.top = px(o._figH / 2);
              port.style.left = leftPort ? `calc(${off} - 1px)` : `calc(100% - ${off} + 1px)`;
            }
            el.appendChild(port);
          });
        }
        const badge = buildNoteBadge(o, notes);
        if (badge) el.appendChild(badge);
      }

      // --- LINES ---
      const pathOf = (p) => (p.length === 4 ? `M ${p[0][0]} ${p[0][1]} C ${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]} ${p[3][0]} ${p[3][1]}`
        : p.length === 3 ? `M ${p[0][0]} ${p[0][1]} Q ${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]}` : `M ${p[0][0]} ${p[0][1]} L ${p[p.length - 1][0]} ${p[p.length - 1][1]}`);
      // An orthogonal path (a generalization tree's spine) with its corners rounded to radius r
      function roundedPath(p, r) {
        let d = `M ${p[0][0]} ${p[0][1]}`;
        for (let i = 1; i < p.length - 1; i++) {
          const [ax, ay] = p[i - 1], [bx, by] = p[i], [cx, cy] = p[i + 1];
          const l1 = Math.hypot(bx - ax, by - ay) || 1, l2 = Math.hypot(cx - bx, cy - by) || 1, k = Math.min(r, l1 / 2, l2 / 2);
          d += ` L ${bx - ((bx - ax) / l1) * k} ${by - ((by - ay) / l1) * k} Q ${bx} ${by} ${bx + ((cx - bx) / l2) * k} ${by + ((cy - by) / l2) * k}`;
        }
        return d + ` L ${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
      }
      function midOf(p) {
        if (p.length === 4) return { x: (p[0][0] + 3 * p[1][0] + 3 * p[2][0] + p[3][0]) / 8, y: (p[0][1] + 3 * p[1][1] + 3 * p[2][1] + p[3][1]) / 8 };
        if (p.length === 3) return { x: (p[0][0] + 2 * p[1][0] + p[2][0]) / 4, y: (p[0][1] + 2 * p[1][1] + p[2][1]) / 4 };
        return { x: (p[0][0] + p[p.length - 1][0]) / 2, y: (p[0][1] + p[p.length - 1][1]) / 2 };
      }
      const linkVisible = (l) => !!l.points && l.points.length >= 2 && drawn(l.from) !== false && (kindOf(l.from) === 'actor' || !isHiddenByLevel(l.from)) && (kindOf(l.to) === 'actor' || !isHiddenByLevel(l.to));
      const isHiddenByLevel = (id) => { const u = caseOf(id); return !!u && !levelsOn && u.level === 'subfunction'; };
      function setMarkers(line, kind) {
        line.style.setProperty('--mk-e', kind ? `url(#uc-mk-${kind})` : 'none');
        line.style.setProperty('--mk-e-in', kind ? `url(#uc-mk-${kind}-in)` : 'none');
        line.style.setProperty('--mk-e-out', kind ? `url(#uc-mk-${kind}-out)` : 'none');
        line.style.setProperty('--mk-e-sel', kind ? `url(#uc-mk-${kind}-sel)` : 'none');
      }
      // Lines (SVG) and their «include» / «extend» labels are kept by link id like the items; a line whose type, direction or
      // arrow changed is built again, a moved one only gets new path data. Events are on the layers (LINE EVENTS).
      function renderLinks() {
        const place = layerCursor(linksG), seen = new Set(), seenParents = new Set(), parents = [];
        linksOf().forEach((l) => {
          if (!LINK_TYPES.includes(l.type) || !l.points || l.points.length < 2) return;
          if (isHiddenByLevel(l.from) || isHiddenByLevel(l.to)) return;
          const d = pathOf(l.points), sig = `${l.type}|${l.navigable === true}|${l.from}|${l.to}`;
          let rec = els.links.get(l.id), st = rec && elState.get(rec.g);
          const label = rec ? rec.label : null;   // renderLabels judges it
          if (rec && st.sig !== sig) { rec.g.remove(); rec = null; }
          if (!rec) {
            const g = svgEl('g', { class: `uc-link${l.type !== 'association' ? ' is-dashed' : ''}`, 'data-edge-id': l.id, 'data-from': l.from, 'data-to': l.to, 'data-type': l.type });
            const line = svgEl('path', { class: 'edge-line', d });
            setMarkers(line, l.type === 'association' ? (l.navigable === true ? 'open' : null) : 'open');
            g.append(svgEl('path', { class: 'edge-hit', d }), line);
            elState.set(g, { sig, cls: g.getAttribute('class') });
            rec = { g, label };
            els.links.set(l.id, rec);
          } else {
            rec.g.setAttribute('class', st.cls);   // drops the hover, selected and dimmed state classes: applyFocus draws them again
            const [hit, line] = rec.g.children;
            if (hit.getAttribute('d') !== d) hit.setAttribute('d', d);
            if (line.getAttribute('d') !== d) line.setAttribute('d', d);   // read apart: a running tween only moves the visible line
          }
          place(rec.g); seen.add(l.id);
        });
        (chartData._parents || []).forEach((p) => {
          if (!p.points || p.points.length < 2 || !drawn(p.from) || !drawn(p.to)) return;
          const key = `${p.from}->${p.to}`, d = p.ortho ? roundedPath(p.points, 10) : pathOf(p.points);
          let g = parentEls.get(key);
          if (!g) {
            g = svgEl('g', { class: 'uc-link uc-parent', 'data-from': p.from, 'data-to': p.to, 'data-parent': '1' });
            const line = svgEl('path', { class: 'edge-line', d });
            setMarkers(line, 'tri');
            g.append(line);
            elState.set(g, { sig: key, cls: g.getAttribute('class') });
            parentEls.set(key, g);
          } else {
            g.setAttribute('class', elState.get(g).cls);
            const line = g.firstChild;
            if (line.getAttribute('d') !== d) line.setAttribute('d', d);
          }
          place(g); parents.push(g); seenParents.add(key);
        });
        place.sweep();
        els.links.forEach((rec, id) => {
          if (seen.has(id)) return;
          rec.g.remove();
          if (rec.label) rec.label.remove();
          els.links.delete(id);
        });
        pruneKeyed(parentEls, seenParents);
        els.parents = parents;
      }
      const parentEls = new Map();   // "from->to" -> the generalization line kept for that pair (els.parents is this render's list)
      function renderLabels(place) {
        linksOf().forEach((l) => {
          const b = l.labelBox, rec = els.links.get(l.id);
          if (!rec) return;
          if (!b || (l.type !== 'include' && l.type !== 'extend')) {
            if (rec.label) { rec.label.remove(); rec.label = null; }
            return;
          }
          let el = rec.label, st = el && elState.get(el);
          const sig = `${l.type}|${l.condition || ''}`;
          if (el && st.sig !== sig) { el.remove(); el = null; }
          if (!el) {
            el = htmlEl('div', 'edge-label uc-label');
            el.dataset.edgeId = l.id;
            el.appendChild(htmlEl('span', 'uc-label-text', `«${l.type}»`));
            if (l.condition) el.appendChild(htmlEl('span', 'uc-cond', `[${l.condition}]`));
            elState.set(el, { sig, cls: el.getAttribute('class') });
            rec.label = el;
          } else {
            el.setAttribute('class', st.cls);
            el.style.translate = '';
            el.style.transformOrigin = '';
          }
          setBox(el, b);
          place(el);
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

      // The colour key as a legend under the diagram: auto-populated from explicit colours in use
      let legendEl = null;
      function ucKeyColors() {
        const used = [];
        const add = (c) => { if (c && swatchSlot(c) && !used.includes(c)) used.push(c); };
        cases().forEach((u) => add(u.color));
        actors().forEach((a) => add(a.color));
        return used;
      }
      function renderLegend() {
        html.querySelectorAll('.uc-key').forEach((el) => el.remove());
        legendEl = null;
        const el = ui.colorKey(ucKeyColors(), chartData.colorKey || {}, { prompts: true, cls: 'uc-key' });
        if (!el) return;
        const C = chartData.canvas || { height: 0 };
        el.style.top = px(C.height + 12);
        legendEl = el;
        html.appendChild(legendEl);
      }
      function setKeyLabel(color, value) {
        const v = String(value == null ? '' : value).trim();
        const was = (chartData.colorKey && chartData.colorKey[color]) || '';
        if (v === was) return false;
        if (v) (chartData.colorKey = chartData.colorKey || {})[color] = v;
        else if (chartData.colorKey) {
          delete chartData.colorKey[color];
          if (!Object.keys(chartData.colorKey).length) delete chartData.colorKey;
        }
        return true;
      }
      function editKey(el) {
        if (!el || presenting()) return;
        const color = el.dataset.color, was = (chartData.colorKey && chartData.colorKey[color]) || '';
        el.classList.remove('is-empty');
        beginEdit(el, {
          raw: was,
          restore: was,
          apply: (value) => setKeyLabel(color, value),
          onCancel: () => { if (!was) el.classList.add('is-empty'); }
        });
      }

      // --- SELECTION ---
      const primaryId = () => selIds[selIds.length - 1] || null;
      function setSel(ids, other) {
        if (!other || other.kind !== 'link' || (linkBarAvoid && linkBarAvoid.id !== other.id)) linkBarAvoid = null;
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
        canvas.classList.toggle('is-multi', selIds.length > 1);
        els.subjects.forEach((el, id) => el.classList.toggle('selected', !!selOther && selOther.kind === 'subject' && selOther.id === id));
        html.querySelectorAll('.color-key-label').forEach((l) => l.classList.toggle('is-selected', !!selOther && selOther.kind === 'key' && selOther.id === l.dataset.color));
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
      function applyFocus() {
        if (hoverItemId && !itemOf(hoverItemId)) hoverItemId = null;
        const hover = hoverItemId && !drag ? hoverItemId : null;
        const selId = selIds.length === 1 && !selOther ? selIds[0] : null;
        const lit = selId ? reach(selId) : null;   // only a click dims the rest; hover highlights without dimming
        const focusId = hover || selId;
        const dirOf = (from, to) => !focusId ? null : from === focusId ? 'out' : to === focusId ? 'in' : null;
        const peerDir = new Map();
        const notePeer = (from, to, dir) => {
          if (!dir) return;
          const peer = dir === 'out' ? to : from;
          if (peer !== focusId && (!peerDir.has(peer) || dir === 'out')) peerDir.set(peer, dir);
        };
        const lineLit = (from, to) => !!lit && lit.has(from) && lit.has(to);
        const linkById = new Map(linksOf().map((x) => [x.id, x]));
        els.links.forEach((rec, id) => {
          const l = linkById.get(id);
          if (!l) return;
          const on = lineLit(l.from, l.to);
          const dir = dirOf(l.from, l.to);
          notePeer(l.from, l.to, dir);
          rec.g.classList.toggle('is-dim', !!lit && !on && !dir);
          rec.g.classList.toggle('hl', on);
          rec.g.classList.toggle('hl-in', dir === 'in');
          rec.g.classList.toggle('hl-out', dir === 'out');
          if (rec.label) {
            rec.label.classList.toggle('is-dim', !!lit && !on && !dir);
            rec.label.classList.toggle('hl', on);
            rec.label.classList.toggle('hl-in', dir === 'in');
            rec.label.classList.toggle('hl-out', dir === 'out');
          }
        });
        els.parents.forEach((g) => {
          const from = g.dataset.from, to = g.dataset.to;
          const on = lineLit(from, to);
          const dir = dirOf(from, to);
          notePeer(from, to, dir);
          g.classList.toggle('is-dim', !!lit && !on && !dir);
          g.classList.toggle('hl', on);
          g.classList.toggle('hl-in', dir === 'in');
          g.classList.toggle('hl-out', dir === 'out');
        });
        els.items.forEach((el, id) => {
          const dir = peerDir.get(id) || null;
          el.classList.toggle('is-dim', !!lit && !lit.has(id) && !dir && id !== hover);
          el.classList.toggle('hl-in', dir === 'in');
          el.classList.toggle('hl-out', dir === 'out');
        });
        els.subjects.forEach((el) => el.classList.remove('is-dim'));
        document.body.classList.toggle('uc-has-match', !!lit);
      }

      // --- DOCK BUTTONS: Refs, Levels, Notes, Auto-Tidy ---
      function updateButtons() {
        btnRefs.setAttribute('aria-checked', String(chartData.showRefs === true));
        const hasSub = cases().some((u) => u.level === 'subfunction');
        if (!hasSub) levelsOn = true;
        btnLevels.disabled = !hasSub;
        btnLevels.setAttribute('aria-checked', String(hasSub && levelsOn));
        btnLevels.title = !hasSub
          ? 'No subfunctions yet: select a use case and set its level to Sub'
          : levelsOn
            ? 'Levels: showing every use case (click to hide subfunctions)'
            : 'Levels: hiding subfunctions (click to show every use case)';
        btnAutoLayout.setAttribute('aria-checked', String(autoTidy));
        btnAutoLayout.title = autoTidy
          ? 'Auto-Tidy is on: the diagram re-arranges itself after adding, deleting or connecting (click to place things by hand)'
          : 'Auto-Tidy is off: things stay where you drop them (click to re-arrange after every change)';
        updateNotesButton();
      }
      btnRefs.addEventListener('click', () => {
        if (chartData.showRefs === true) delete chartData.showRefs; else chartData.showRefs = true;
        render({
          duration: 190,
          afterPlay: () => {
            if (chartData.showRefs !== true) return;
            html.querySelectorAll('.uc-refs').forEach((r) => motion.anim(r, [
              { transform: 'translate(-50%, -4px) scale(0.88)', clipPath: 'inset(0 0 100% 0)' },
              { transform: 'translate(-50%, 2px) scale(1)', clipPath: 'inset(0 0 0 0)' }
            ], { duration: 190, easing: motion.curve('curve-spring-tactile') }));
          }
        });
        updateStatus(true);
      });
      btnLevels.addEventListener('click', () => {
        if (btnLevels.disabled || !cases().some((u) => u.level === 'subfunction')) return;
        const snap = motion.capture(canvas, FLIP_SPECS, { ghosts: true }), svgSnap = captureSvg();
        levelsOn = !levelsOn;
        let toKey = null;
        if (!levelsOn) {
          selIds = selIds.filter((id) => !isHiddenByLevel(id));
          toKey = {};
          cases().forEach((u) => {
            if (!isHiddenByLevel(u.id)) return;
            const inc = linksOf().find((l) => l.type === 'include' && l.to === u.id && !isHiddenByLevel(l.from));
            const ext = !inc && linksOf().find((l) => l.type === 'extend' && l.from === u.id && !isHiddenByLevel(l.to));
            if (inc) toKey[u.id] = inc.from;
            else if (ext) toKey[u.id] = ext.to;
          });
        }
        render({ snap, svgSnap, toKey, ghostExit: !levelsOn, duration: 220 });
      });
      btnAutoLayout.addEventListener('click', () => {
        autoTidy = !autoTidy;
        updateButtons();
        if (autoTidy && !presenting()) commit(true);
      });
      btnNotes.addEventListener('click', () => {
        if (chartData.showNotes) delete chartData.showNotes; else chartData.showNotes = true;
        peekId = null;
        applyNoteVisibility(true);
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
      function commit(relayout, motionOpts) {
        const useMotion = motionOpts !== false && motion.enabled();
        const mOpts = typeof motionOpts === 'object' && motionOpts ? Object.assign({}, motionOpts) : {};
        if (useMotion && !mOpts.snap) {
          cancelUcGhosts();
          mOpts.snap = motion.capture(canvas, FLIP_SPECS, mOpts.captureOpts);
          mOpts.svgSnap = captureSvg();
        }
        if (relayout && autoTidy) layoutDiagram(chartData);
        render(motionOpts === false ? false : mOpts);
        updateStatus(true);
      }

      // --- NOTES ---
      // chartData.notes: { id, text, useCases: [ids], actors: [ids], _pos?: {x, y} }. The first linked item is the anchor. An
      // item with a note carries a badge; hovering it peeks the card, the Notes switch shows them all ("showNotes"). A card is
      // fitted into a clear gap near its item on every render unless it was dragged (_pos, relative to the anchor, which is
      // never saved: an anchored note carries no position on disk).
      // A free note has no links (`useCases` and `actors` empty or absent) and an absolute `pos` in canvas coordinates, which
      // is saved: no leader, no badge, always on show, never moved by Tidy; the other notes are fitted around it.
      const NOTE_GAP = 8, NOTE_MIN_GAP = 10, NOTE_IDEAL_GAP = 20, NOTE_REACH = 160, NOTE_STEP = 8;
      let noteOffsets = {}, noteSizes = {}, peekId = null, peekTimer = 0, notesLayer = null;
      const noteCtl = createNotes({
        data: () => chartData,
        cardOf: (id) => noteCard(id),
        anchorEl: (note) => (isFreeNote(note) ? null : noteBadgeEl(note)),
        canEdit: () => !presenting(),
        openCard: (note) => {
          cancelDrag();
          selectOther('note', note.id);
          const existed = !!noteCard(note.id);
          if (!existed) renderNotes(false, false);
          const card = noteCard(note.id);
          if (!card) return null;
          applyNoteVisibility(existed);
          if (!existed && motion.enabled()) {
            const leaders = [...leadersG.children].filter((l) => l.dataset.noteId === note.id);
            motion.unfoldNote(card, isFreeNote(note) ? null : noteBadgeEl(note), leaders[0], { duration: 170 });
          }
          return card;
        },
        afterFocus: (card) => panIntoView(card),
        clearSelection: (id) => { if (selectedNoteId() === id) selOther = null; },
        render: () => render(),
        onChange: () => updateStatus(true),
      });
      const noteText = (n) => (n && typeof n.text === 'string' ? n.text.trim() : '');
      const linkedItems = (n) => (n.useCases || []).concat(n.actors || []).filter((id) => itemOf(id) && drawn(id));
      const linkCount = (n) => (n.useCases || []).length + (n.actors || []).length;
      const isFreeNote = (n) => !linkCount(n);
      const liveNotes = () => notesList().filter((n) => (noteText(n) || n.id === noteCtl.editingId()) && (isFreeNote(n) || linkedItems(n).length));
      const notesOfItem = (id) => liveNotes().filter((n) => linkedItems(n).includes(id));
      const noteCard = (id) => notesLayer && [...notesLayer.children].find((el) => el.dataset.noteId === id);
      const selectedNoteId = () => (selOther && selOther.kind === 'note' ? selOther.id : null);

      function renderNotes(refit, animate = false) {
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
        positionNotes(animate);
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
        const todo = live.filter((n) => !n._pos && !n.pos && !noteOffsets[n.id]);
        if (!todo.length) return;
        const C = chartData.canvas || { width: 0, height: 0 };
        const itemBoxes = [...actors(), ...cases()].filter((o) => placed(o) && o.w).map(boxOf);
        const labelBoxes = linksOf().filter((l) => l.labelBox).map((l) => l.labelBox);
        const anchorBox = (n) => boxOf(itemOf(linkedItems(n)[0]));
        const placedBoxes = live.filter((n) => n._pos || n.pos || noteOffsets[n.id]).map((n) => {   // free notes are obstacles like any placed note
          const o = n._pos || n.pos || noteOffsets[n.id], a = isFreeNote(n) ? { x: 0, y: 0 } : anchorBox(n);
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
      function positionNotes(animate = false) {
        if (!notesLayer) return;
        [...notesLayer.children].forEach((card) => {
          const note = noteOf(card.dataset.noteId);
          if (!note) return;
          const ids = linkedItems(note), o = note._pos || note.pos || noteOffsets[note.id];
          if ((!ids.length && !isFreeNote(note)) || !o) return;
          const a = ids.length ? boxOf(itemOf(ids[0])) : { x: 0, y: 0 }, x = a.x + o.x, y = a.y + o.y, s = noteSizes[note.id] || { w: 0, h: 0 };
          card.style.left = px(x);
          card.style.top = px(y);
          drawLeaders(note.id, { x, y, w: s.w, h: s.h });
        });
        applyNoteVisibility(animate);
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
      function noteBadgeEl(note) {
        const anchorId = note && linkedItems(note)[0];
        const host = anchorId && els.items.get(anchorId);
        return host ? host.querySelector('.note-badge') : null;
      }
      function applyNoteVisibility(animate = false) {
        if (!notesLayer) return;
        const all = !!chartData.showNotes;
        const anim = animate && motion.enabled();
        const wasVis = new Map();
        if (anim) {
          [...notesLayer.children].forEach((card) => {
            const note = noteOf(card.dataset.noteId);
            if (!note) return;
            const prev = card.classList.contains('show') || card.classList.contains('peek');
            const next = all || isFreeNote(note) || !!notePeeked(note);
            wasVis.set(note.id, prev);
            if (prev && !next) motion.foldNote(card, isFreeNote(note) ? null : noteBadgeEl(note));
          });
        }
        canvas.classList.toggle('notes-on', all);
        [...notesLayer.children, ...leadersG.children].forEach((el) => {
          const note = noteOf(el.dataset.noteId);
          if (!note) return;
          el.classList.toggle('show', all || isFreeNote(note));   // a free note has nothing to hover: it is always on show
          el.classList.toggle('peek', !!notePeeked(note));
        });
        if (anim) {
          [...notesLayer.children].forEach((card) => {
            const note = noteOf(card.dataset.noteId);
            if (!note) return;
            const now = card.classList.contains('show') || card.classList.contains('peek');
            if (!wasVis.get(note.id) && now) {
              const leaders = [...leadersG.children].filter((l) => l.dataset.noteId === note.id);
              motion.unfoldNote(card, isFreeNote(note) ? null : noteBadgeEl(note), leaders[0], { duration: 170 });
              leaders.slice(1).forEach((l) => motion.drawPath(l, { duration: 150, easing: 'curve-out' }));
            }
          });
        }
        applyNoteSelection();
      }
      function applyNoteSelection() {
        if (!notesLayer) return;
        [...notesLayer.children].forEach((el) => el.classList.toggle('selected', el.dataset.noteId === selectedNoteId()));
      }
      function peekSoon(id, delay) { clearTimeout(peekTimer); peekTimer = setTimeout(() => { if (peekId !== id) { peekId = id; applyNoteVisibility(true); } }, delay); }
      function unpeekSoon(id) { clearTimeout(peekTimer); peekTimer = setTimeout(() => { if (peekId === id) { peekId = null; applyNoteVisibility(true); } }, 220); }
      function buildNoteBadge(o, notes) {
        if (!notes.length) {
          return null;   // no hover (+): the action bar's note button adds one
        }
        const b = htmlEl('button', 'note-badge');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.setAttribute('aria-label', notes.map((n) => `Note: ${noteText(n)}`).join(' · '));
        b.innerHTML = ui.icon('note', { size: 'xs' });
        return b;   // its pointer, hover and click are handled by the layer listeners (ITEM EVENTS)

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
      // A free note with its top-left at a canvas point (default: the middle of the view); dropped again if left empty
      function addFreeNote(pt) {
        if (presenting()) return;
        const c = pt || (() => { const v = viewCentre(); return { x: v.x - 80, y: v.y - 20 }; })();
        const note = { id: uid('n'), text: '', useCases: [], pos: { x: Math.round(c.x / 4) * 4, y: Math.round(c.y / 4) * 4 } };
        chartData.notes = notesList();
        chartData.notes.push(note);
        editNote(note.id);
      }
      function editNote(id) { noteCtl.edit(id); }
      function commitNote(note, text) { noteCtl.commit(note, text); }
      function removeNote(id) { noteCtl.remove(id); }
      function toggleNoteLink(noteId, itemId) {
        const note = noteOf(noteId), kind = kindOf(itemId);
        if (!note || !kind) return;
        const key = kind === 'actor' ? 'actors' : 'useCases', all = linkedItems(note);
        const list = note[key] || [];
        const wasFree = isFreeNote(note);
        if (wasFree) {   // a free note becomes anchored: its absolute pos turns into a relative _pos, which is not saved
          const a = itemOf(itemId);
          if (note.pos && a) note._pos = { x: Math.round(note.pos.x - a.x), y: Math.round(note.pos.y - a.y) };
          delete note.pos;
          note[key] = [itemId];
        } else if (!all.includes(itemId)) note[key] = list.concat(itemId);
        else if (all.length > 1) { note[key] = list.filter((x) => x !== itemId); if (!note[key].length) delete note[key]; delete note._pos; }
        else { hint('A note keeps at least one item: delete the note instead'); return; }
        updateStatus(true);
        render({
          drawNewLeaders: true,
          afterPlay: () => {
            if (!wasFree) return;
            const b = els.items.get(itemId)?.querySelector('.note-badge');
            if (b) motion.anim(b, [{ transform: 'scale(0.4)' }, { transform: 'none' }], { duration: 160, easing: motion.curve('curve-spring-tactile') });
          }
        });
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
            card.style.translate = `${d.nx - x0}px ${d.ny - y0}px`;
            drawLeaders(id, { x: d.nx, y: d.ny, ...(noteSizes[id] || { w: 0, h: 0 }) });
          },
          drop(e, d) {
            card.classList.remove('dragging');
            card.style.translate = '';
            card.style.left = px(d.nx); card.style.top = px(d.ny);
            const note = noteOf(id), anchor = note && linkedItems(note)[0];
            if (note && isFreeNote(note)) { note.pos = { x: Math.round(d.nx), y: Math.round(d.ny) }; updateStatus(true); return; }
            if (!anchor) { render(); return; }
            const a = itemOf(anchor);
            note._pos = { x: Math.round(d.nx - a.x), y: Math.round(d.ny - a.y) };
            updateStatus(true);
          },
          cleanup() { card.classList.remove('dragging'); card.style.translate = ''; }
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
        animateViewport(panX + dx, panY + dy, scale, { duration: motion.dur('dur-base', 180), easing: 'curve-out' });
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
        if (!d.moved) { d.moved = true; document.body.classList.add('uc-dragging', 'is-dragging'); hoverLinkId = null; applyLinkState(); setHoverSubject(null); }
        d.dx = (e.clientX - d.startX) / scale;
        d.dy = (e.clientY - d.startY) / scale;
        if (d.move) d.move(e, d);
      }
      function endDrag() {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        window.removeEventListener('pointercancel', cancelDrag);
        document.body.classList.remove('uc-dragging', 'is-dragging');
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

      // The drop / connect highlights of a drag frame: the ones set by the last frame come off, not a page-wide query
      function setMarks(d, list) {
        (d.marks || []).forEach(([el, cls]) => el.classList.remove(cls));
        d.marks = list.filter(([el]) => el);
        d.marks.forEach(([el, cls]) => el.classList.add(cls));
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
      // Subject frame hover: .uc-subject keeps pointer-events: none so background pan/marquee/port-drag work inside it
      function setHoverSubject(id) {
        const nextId = id || null;
        if (nextId === hoverSubjectId) return;
        const prev = hoverSubjectId && els.subjects.get(hoverSubjectId);
        if (prev) prev.classList.remove('is-hover');
        hoverSubjectId = nextId;
        const next = hoverSubjectId && els.subjects.get(hoverSubjectId);
        if (next) next.classList.add('is-hover');
      }
      function subjectIdAtClient(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        const x = (clientX - r.left) / scale - canvas.clientLeft;
        const y = (clientY - r.top) / scale - canvas.clientTop;
        const list = allSubjects();
        for (let i = list.length - 1; i >= 0; i--) {
          const s = list[i];
          if (typeof s.x === 'number' && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s.id;
        }
        return null;
      }
      canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || e.buttons || drag || document.body.classList.contains('palette-dragging')) { setHoverSubject(null); return; }
        const t = e.target;
        if (!(t instanceof Element) || t.closest('.confirm, .uc-menu')) { setHoverSubject(null); return; }
        const subEl = t.closest('.uc-subject');
        setHoverSubject(subEl ? subEl.dataset.subjectId : subjectIdAtClient(e.clientX, e.clientY));
      });
      canvas.addEventListener('pointerleave', () => setHoverSubject(null));

      const PRESS_OWN = '.uc-subject-title > .chevron, .uc-actor > .note-badge, .uc-case > .note-badge';

      // --- LAYER EVENTS ---
      // The elements are kept from one render to the next, so one listener per layer dispatches by data-* id instead of
      // listeners on every element. pointerenter, pointerleave and mouseenter do not bubble: they are caught in capture,
      // where the target is the element entered or left itself. Presses, clicks and double-clicks of items, subjects,
      // chevrons, badges and labels are in onPointerDown, the click listener and the dblclick listener below.
      const itemElAt = (t) => (t instanceof Element && (t.classList.contains('uc-actor') || t.classList.contains('uc-case')) ? t : null);
      function linkEnter(id, ev) {
        if (ev.pointerType === 'touch' || drag) return;
        hoverLinkId = id;
        applyLinkState();
      }
      function linkLeave(id, ev, other) {   // moving between a line and its label keeps it lit
        if (hoverLinkId !== id) return;
        if (other && ev.relatedTarget && other.contains(ev.relatedTarget)) return;
        hoverLinkId = null;
        applyLinkState();
      }
      html.addEventListener('pointerenter', (ev) => {
        const t = ev.target, item = itemElAt(t);
        if (item) {
          if (ev.pointerType === 'touch' || drag) return;
          const id = item.dataset.nodeId;
          hoverItemId = id;
          applyFocus();
          if (notesOfItem(id).length) peekSoon(id, 100);
        } else if (t instanceof Element && t.classList.contains('uc-label')) linkEnter(t.dataset.edgeId, ev);
      }, true);
      html.addEventListener('pointerleave', (ev) => {
        const t = ev.target, item = itemElAt(t);
        if (item) {
          const id = item.dataset.nodeId;
          if (peekId === id) unpeekSoon(id);
          if (hoverItemId === id) { hoverItemId = null; applyFocus(); }
        } else if (t instanceof Element && t.classList.contains('uc-label')) {
          const rec = els.links.get(t.dataset.edgeId);
          linkLeave(t.dataset.edgeId, ev, rec && rec.g);
        }
      }, true);
      html.addEventListener('mouseenter', (ev) => {
        const t = ev.target;
        if (t instanceof Element && t.matches('.uc-actor > .note-badge, .uc-case > .note-badge')) peekSoon(t.parentNode.dataset.nodeId, 0);
      }, true);
      linksG.addEventListener('pointerenter', (ev) => {
        const g = ev.target;
        if (g instanceof Element && g.dataset.edgeId) linkEnter(g.dataset.edgeId, ev);
      }, true);
      linksG.addEventListener('pointerleave', (ev) => {
        const g = ev.target;
        if (!(g instanceof Element) || !g.dataset.edgeId) return;
        const rec = els.links.get(g.dataset.edgeId);
        linkLeave(g.dataset.edgeId, ev, rec && rec.label);
      }, true);
      linksG.addEventListener('pointerdown', (ev) => {
        const g = ev.target instanceof Element && ev.target.closest('.uc-link[data-edge-id]');
        if (!g || ev.button !== 0 || presenting()) return;
        ev.stopPropagation();
        linkBarAvoid = { id: g.dataset.edgeId, x: ev.clientX, y: ev.clientY };
        selectOther('link', g.dataset.edgeId);
      });
      linksG.addEventListener('dblclick', (ev) => {
        const g = ev.target instanceof Element && ev.target.closest('.uc-link[data-edge-id]');
        if (!g) return;
        ev.preventDefault();
        ev.stopPropagation();
        editLinkCondition(g.dataset.edgeId);
      });

      // --- PRESSES ---
      function onPointerDown(e) {
        const t0 = e.target;
        if (t0 instanceof Element) {   // a label selects its line; a chevron and a note badge keep the press to themselves
          const lab = t0.closest('.uc-label');
          if (lab && e.button === 0 && !presenting()) { e.stopPropagation(); if (!t0.isContentEditable) selectOther('link', lab.dataset.edgeId); return; }
          if (t0.closest(PRESS_OWN)) { e.stopPropagation(); return; }
        }
        if (e.pointerType === 'touch') document.body.classList.add('uc-touch', 'is-touch');
        if (e.button > 0) return;
        const t = e.target;
        if (!(t instanceof Element) || t.isContentEditable) return;
        const itemEl = t.closest('.uc-actor, .uc-case');
        if (presenting()) {   // read only: selecting an item (which focuses it) is all a press does
          if (itemEl && !t.closest('.note-badge')) selectItem(itemEl.dataset.nodeId);
          else { const st = t.closest('.uc-subject-title'); if (st && !t.closest('.chevron')) selectOther('subject', st.parentNode.dataset.subjectId); }
          return;
        }
        if (t.closest('.uc-actionbar, .confirm, .chevron, .note-badge, .note-del, .note-link, .note, .uc-key')) return;
        closeMenu();
        const grip = t.closest('.uc-subject-tab');
        if (grip) { e.preventDefault(); beginDrag(e, resizeDrag(grip.parentNode.dataset.subjectId, grip.dataset.axis)); return; }
        const title = t.closest('.uc-subject-title');
        if (title) {
          const id = title.parentNode.dataset.subjectId;
          if (notePicking) return;
          if (realSubjects().some((s) => s.id === id)) {
            selectOther('subject', id);
            // Dragging the title moves the frame: it is drawn around its use cases, so they travel with it
            const inside = (chartData.useCases || []).filter((u) => caseSubjectId(u) === id && placed(u)).map((u) => u.id);
            if (inside.length) beginDrag(e, Object.assign(itemDrag(inside, id), { click: () => selectOther('subject', id) }));
          } else setSel([], null);
          return;
        }
        if (!itemEl) return;
        const id = itemEl.dataset.nodeId;
        if (notePicking) { e.preventDefault(); giveNoteTo(id); return; }
        if ((e.ctrlKey || e.metaKey || e.shiftKey) && !t.closest('.port')) { e.preventDefault(); toggleItem(id); return; }
        if (t.closest('.port')) { beginDrag(e, connectDrag(id)); return; }
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

      // Live routing while dragging: lines, labels and frames follow the pointer. The positions are put back when the
      // drag ends (cleanup), so drop() starts from the untouched ones.
      function liveDrag(d, apply) {
        if (!d.snap) d.snap = [chartData.actors || [], chartData.useCases || [], realSubjects()].map((l) => l.map((o) => Object.assign({}, o)));
        if (d.raf) return;
        d.raf = requestAnimationFrame(() => {
          d.raf = 0;
          apply();
          routeDiagram(chartData);
          renderLinks();
          renderLabels((el) => { if (!el.parentNode) html.appendChild(el); });
          allSubjects().forEach((s) => { const el = els.subjects.get(s.id); if (el && typeof s.x === 'number') Object.assign(el.style, { left: px(s.x), top: px(s.y), width: px(s.w), height: px(s.h) }); });
          const C = chartData.canvas;
          if (C) { canvas.style.width = px(C.width); canvas.style.height = px(C.height); svg.setAttribute('width', C.width); svg.setAttribute('height', C.height); }
          applySelection();
        });
      }
      function liveEnd(d) {
        if (d.raf) cancelAnimationFrame(d.raf);
        if (!d.snap) return;
        [chartData.actors || [], chartData.useCases || [], realSubjects()].forEach((l, i) => l.forEach((o, k) => { if (d.snap[i][k]) { for (const key of ['x', 'y', 'fw', 'fh']) { if (key in d.snap[i][k]) o[key] = d.snap[i][k][key]; else delete o[key]; } } }));
      }

      // --- Resize a subject frame from a tab on its right (axis x) or bottom (axis y) edge (saved as fw / fh, a minimum size) ---
      function resizeDrag(id, axis) {
        const s = subjectOf(id), w0 = s.w, h0 = s.h;
        const apply = (d) => { if (axis !== 'y') s.fw = Math.max(1, Math.round(w0 + d.dx)); if (axis !== 'x') s.fh = Math.max(1, Math.round(h0 + d.dy)); };
        return {
          click: () => selectOther('subject', id),
          move(e, d) { liveDrag(d, () => apply(d)); },
          drop(e, d) {
            apply(d);
            routeDiagram(chartData);
            actors().forEach(keepOutside);
            commit(false);
          },
          cleanup() { liveEnd(this); }
        };
      }

      // --- Move actors and use cases (one or the whole selection) ---
      function itemDrag(ids, keepSubject) {   // keepSubject: the id of a frame being dragged by its title; it moves with its use cases
        const targetSubjects = allSubjects();
        // Lines (and labels) of the moved items fade while they move, as they would lag behind; the drop re-routes them
        let faded = null;
        const fade = (on) => {
          if (!faded && on) {
            const moving = new Set(ids);
            faded = [];
            els.links.forEach((rec) => {
              if (!moving.has(rec.g.dataset.from) && !moving.has(rec.g.dataset.to)) return;
              faded.push(rec.g);
              if (rec.label) faded.push(rec.label);
            });
            els.parents.forEach((g) => { if (moving.has(g.dataset.from) || moving.has(g.dataset.to)) faded.push(g); });
          }
          (faded || []).forEach((x) => x.classList.toggle('drag-fade', on));
        };
        return {
          cleanup() { fade(false); const f = keepSubject && els.subjects.get(keepSubject); if (f) f.style.translate = ''; },
          move(e, d) {
            fade(true);
            const frame = keepSubject && els.subjects.get(keepSubject);
            if (frame) frame.style.translate = `${d.dx}px ${d.dy}px`;   // the frame travels with them
            ids.forEach((id) => { const el = els.items.get(id); if (el) { el.classList.add('is-dragging'); el.style.translate = `${d.dx}px ${d.dy}px`; } });
            let over = null;
            if (!keepSubject && ids.some((id) => kindOf(id) === 'case') && realSubjects().length) {
              const s = subjectAt(canvasPoint(e));
              over = s && els.subjects.get(s.id);
            }
            setMarks(d, [[over, 'drop-target']]);
          },
          drop(e, d) {
            const dx = Math.round(d.dx), dy = Math.round(d.dy);
            const s = !keepSubject && realSubjects().length ? subjectAt(canvasPoint(e)) : null;
            let moved = false;
            ids.forEach((id) => {
              const o = itemOf(id);
              if (!o || !placed(o)) return;
              o.x += dx; o.y += dy;
              if (s && kindOf(id) === 'case' && caseSubjectId(o) !== s.id) { o.subject = s.id; moved = true; }
            });
            // an actor dropped across the middle of the boundaries changes side (its root's `side`, which the layout follows)
            const boxes = allSubjects().filter((x) => typeof x.x === 'number');
            if (boxes.length) {
              const mid = boxes.reduce((n, x) => n + x.x + x.w / 2, 0) / boxes.length;
              ids.forEach((id) => {
                const a = actorOf(id);
                if (!a) return;
                const side = a.x + a.w / 2 < mid ? 'left' : 'right';
                if (side === a._side) return;
                let r = a;
                for (let n = 0; r.parent && actorOf(r.parent) && n < 50; n++) r = actorOf(r.parent);
                r.side = side; a._side = side; moved = true;
              });
            }
            ids.forEach((id) => { const a = actorOf(id); if (a) keepOutside(a); });
            void targetSubjects;
            commit(moved, {
              duration: 200,
              afterPlay: () => {
                ids.forEach((id) => {
                  const inner = els.items.get(id)?.querySelector('.uc-shape, .uc-figure');
                  if (inner) motion.anim(inner, [{ transform: 'scale(1.02)' }, { transform: 'none' }], { duration: 110, easing: motion.curve('curve-out') });
                });
              }
            });
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
            d.target = itemIdAt(e.clientX, e.clientY);
            if (d.target && d.target !== fromId) setMarks(d, [[els.items.get(d.target), 'uc-target']]);
            else if (!d.target) {
              const s = subjectAt(pt);
              setMarks(d, [[s && els.subjects.get(s.id), 'drop-target']]);
            } else setMarks(d, []);
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
        const snap = motion.capture(canvas, FLIP_SPECS), svgSnap = captureSvg();
        const u = newCase(s, pt);
        const l = addLink(kindOf(fromId) === 'actor' ? 'association' : 'include', fromId, u.id);
        selectItem(u.id);
        commit(true, false);
        const mo = { snap, svgSnap, enterScale: 0.82, duration: 180, easing: 'curve-spring-tactile', drawLinkIds: new Set([l.id]) };
        if (autoTidy) { render(mo); updateStatus(true); }   // Auto-Tidy: the layout placed it, not the drop point
        else placeCentred(u, pt, mo);
        editName(u.id);
      }

      // --- Adding things ---
      function viewCentre() {
        const v = viewport.getBoundingClientRect();
        return canvasPoint({ clientX: v.left + v.width / 2, clientY: v.top + v.height / 3 });
      }
      // Put the item's centre at pt once its size is known (a new item is routed first)
      function placeCentred(o, pt, motionOpts) {
        routeDiagram(chartData);
        o.x = Math.round(pt.x - (o.w || 0) / 2);
        o.y = Math.round(pt.y - (o.h || 0) / 2);
        render(motionOpts);
        updateStatus(true);
      }
      // The real subject list when the diagram has none yet: the implicit boundary becomes a subject of its own
      function materialiseSubjects() {
        if (realSubjects().length) return;
        const s = { id: uid('s'), name: chartData.title || 'System' };
        chartData.subjects = [s];
        cases().forEach((u) => { u.subject = s.id; });
      }
      // The next requirement id for a use case made by hand: UC-01, UC-02... (the number after the highest UC-n in use)
      function nextRef() {
        const n = cases().reduce((m, u) => (u.refs || []).reduce((k, r) => { const x = /^UC-(\d+)$/i.exec(String(r)); return x ? Math.max(k, +x[1]) : k; }, m), 0) + 1;
        return `UC-${String(n).padStart(2, '0')}`;
      }
      function newCase(subject, pt) {
        const u = { id: uid('u'), name: 'New use case', refs: [nextRef()] };
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
      function addActor(kind, pt, ghostRect) {
        const snap = pt ? motion.capture(canvas, FLIP_SPECS) : null, svgSnap = pt ? captureSvg() : null;
        const a = { id: uid('a'), name: kind === 'system' ? 'New system' : 'New actor' };
        if (kind === 'system') a.kind = 'system';
        const size = kind === 'system' ? SIZE.tile : SIZE.actor;
        const at = pt || freeSpot(viewCentre(), size[0], size[1]);
        a.x = Math.round(at.x - size[0] / 2); a.y = Math.round(at.y - size[1] / 2);
        chartData.actors = actors();
        chartData.actors.push(a);
        selectItem(a.id);
        commit(!pt, pt ? false : { duration: 190, easing: 'curve-spring-tactile' });
        if (pt) placeCentred(a, pt, { snap, svgSnap, originRect: ghostRect, duration: 190, easing: 'curve-spring-tactile' });
        panIntoView(els.items.get(a.id));
        editName(a.id);
      }
      function addCase(pt, ghostRect) {
        const snap = pt ? motion.capture(canvas, FLIP_SPECS) : null, svgSnap = pt ? captureSvg() : null;
        const centre = pt || freeSpot(viewCentre(), SIZE.useCase[0], SIZE.useCase[1]);
        let s = subjectAt(centre);
        if (!s) { const p = primaryId(); const sel = p && caseOf(p); s = (sel && subjectOf(caseSubjectId(sel))) || subjectAt(viewCentre()) || null; }
        const u = newCase(s, centre);
        selectItem(u.id);
        commit(!pt, pt ? false : { duration: 190, easing: 'curve-spring-tactile' });
        if (pt) placeCentred(u, pt, { snap, svgSnap, originRect: ghostRect, duration: 190, easing: 'curve-spring-tactile' });
        panIntoView(els.items.get(u.id));
        editName(u.id);
      }
      function addSubject(pt, ghostRect) {
        materialiseSubjects();
        const s = { id: uid('s'), name: 'New system' };
        const at = pt || viewCentre();
        s.x = Math.round(at.x - SIZE.subject[0] / 2); s.y = Math.round(at.y - SIZE.subject[1] / 2); s.w = SIZE.subject[0]; s.h = SIZE.subject[1];
        chartData.subjects.push(s);
        selectOther('subject', s.id);
        commit(!pt, { originRect: ghostRect, duration: 190, easing: 'curve-spring-tactile' });
        panIntoView(els.subjects.get(s.id));
        editSubjectName(s.id);
      }

      // --- Delete ---
      function dropRefs(ids) {
        const gone = new Set(ids);
        chartData.links = linksOf().filter((l) => !gone.has(l.from) && !gone.has(l.to));
        [...actors(), ...cases()].forEach((o) => { if (o.parent && gone.has(o.parent)) delete o.parent; });
        // A note loses the items; one left with none goes (a free note never had any and stays)
        chartData.notes = notesList().filter((n) => {
          const had = linkCount(n);
          ['useCases', 'actors'].forEach((k) => { if (n[k]) { n[k] = n[k].filter((x) => !gone.has(x)); if (!n[k].length) delete n[k]; } });
          return !had || linkCount(n);
        });
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
        commit(true, { captureOpts: { ghosts: true }, ghostExit: true, duration: 200 });
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
        commit(true, { captureOpts: { ghosts: true }, ghostExit: true, duration: 200 });
      }
      function deleteLink(id) {
        chartData.links = linksOf().filter((l) => l.id !== id);
        selIds = []; selOther = null;
        commit(true, { captureOpts: { ghosts: true }, ghostExit: true, duration: 180 });
      }
      function confirmDelete(message, label, onOk, anchor) { ui.confirm(anchor, { message, label }, onOk); }
      function deleteSelection(anchorEl) {
        if (presenting()) return;
        const o = selOther;
        if (o && o.kind === 'note') { removeNote(o.id); return; }
        if (o && o.kind === 'link') { deleteLink(o.id); return; }
        if (o && o.kind === 'key') { if (setKeyLabel(o.id, '')) { selOther = null; commit(false); } return; }
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
        cancelUcGhosts();
        const wasCollapsed = s.collapsed === true;
        const snap = motion.capture(canvas, FLIP_SPECS, { ghosts: !wasCollapsed });
        const svgSnap = captureSvg();
        const prevSub = snap && snap._raw ? snap._raw.get(id) : null;
        const memberIds = cases().filter((u) => caseSubjectId(u) === id).map((u) => u.id);
        if (wasCollapsed) delete s.collapsed; else s.collapsed = true;
        // the engine keeps a collapsed subject's use cases where they sit expanded, so expanding restores them;
        // with Auto-Tidy on the other subjects close up (collapse) or make room (expand)
        commit(true, {
          snap, svgSnap, duration: 220,
          afterPlay: () => {
            const subEl = els.subjects.get(id), chevSvg = subEl && subEl.querySelector('.chevron svg');
            if (chevSvg) {
              motion.anim(chevSvg, wasCollapsed
                ? [{ transform: 'rotate(-90deg)' }, { transform: 'none' }]
                : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-90deg)' }],
                { duration: 180, easing: motion.curve('curve-inout') });
            }
            if (!wasCollapsed && prevSub && prevSub.preCloned && subEl && prevSub.vr.height > subEl.getBoundingClientRect().height + 2) {
              const a = motion.ghostExit(prevSub.el, {
                preCloned: prevSub.preCloned, fromRect: prevSub.vr, baseW: prevSub.baseW, baseH: prevSub.baseH,
                transform: 'none', clipPath: 'inset(0 0 85% 0)', opacity: 0.2, duration: 210, easing: 'curve-spring-settle'
              });
              if (a) ucGhosts.push(a);
            } else if (wasCollapsed) {
              // the use cases come back in place: a short fade and settle, one after another, not a flight from the title
              memberIds.forEach((cid, i) => {
                const el = els.items.get(cid);
                if (el) { const a = motion.anim(el, [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: Math.min(i, 6) * 25, easing: motion.curve('curve-out'), fill: 'backwards' }); if (a) ucGhosts.push(a); }
              });
            }
          }
        });
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
        commit(true, { duration: 210 });
      }
      function connectToCases() {
        const actor = selIds.find((id) => actorOf(id)), targets = selIds.filter((id) => caseOf(id));
        if (!actor || !targets.length) return;
        let made = 0;
        targets.forEach((id) => { if (!linkExists('association', actor, id)) { addLink('association', actor, id); made++; } });
        hint(made ? `${esc(nameOf(actorOf(actor)))} connected to ${made} use case${made === 1 ? '' : 's'}` : 'Already connected to all of them');
        if (made) commit(true);
      }
      // --- Line edits ---
      const isCaseCase = (l) => !!caseOf(l.from) && !!caseOf(l.to);
      function pulseReversedLink(id) {
        const line = els.links.get(id)?.g?.querySelector('.edge-line');
        if (line) motion.anim(line, [{ strokeWidth: 'var(--ring-lg)' }, { strokeWidth: '' }], { duration: 220, easing: motion.curve('curve-out') });
      }
      function setLinkType(l, type) {
        if (l.type === type) return;
        if (type === 'association' ? isCaseCase(l) : !isCaseCase(l)) { hint(type === 'association' ? 'An association joins an actor and a use case' : '«include» and «extend» join two use cases'); return; }
        const reversed = (l.type === 'include' && type === 'extend') || (l.type === 'extend' && type === 'include');
        if (reversed) { const f = l.from; l.from = l.to; l.to = f; }
        l.type = type;
        if (type !== 'extend') delete l.extensionPoint;
        if (type === 'association') delete l.condition;
        if (type !== 'association') delete l.navigable;
        if (reversed) hint(type === 'extend' ? '«extend» points from the extension to the base, so the line was reversed' : '«include» points from the base to the part it always needs, so the line was reversed');
        commit(false, reversed ? { drawLinkIds: new Set([l.id]), afterPlay: () => pulseReversedLink(l.id) } : undefined);
      }
      function reverseLink(l) {
        const f = l.from; l.from = l.to; l.to = f;
        if (l.type === 'extend') delete l.extensionPoint;
        commit(false, { drawLinkIds: new Set([l.id]), afterPlay: () => pulseReversedLink(l.id) });
      }
      function addPoint(u, name) {
        u.extensionPoints = Array.isArray(u.extensionPoints) ? u.extensionPoints : [];
        const n = name || `Point ${u.extensionPoints.length + 1}`;
        u.extensionPoints.push(n);
        return n;
      }

      // --- Menus (a small list under a button) ---
      let menuEl = null;
      function closeMenu() {
        if (!menuEl) return false;
        motion.ghostExit(menuEl, { duration: 110, transform: 'scale(0.92, 0.86) translateY(-4px)', origin: 'top left' });
        menuEl.remove(); menuEl = null; return true;
      }
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
        m.style.transformOrigin = below ? 'top left' : 'bottom left';
        motion.anim(m, [
          { transform: `scale(0.92, 0.86) translateY(${below ? -4 : 4}px)`, clipPath: below ? 'inset(0 0 25% 0 round 8px)' : 'inset(25% 0 0 0 round 8px)' },
          { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
        ], { duration: 130, easing: motion.curve('curve-spring-tactile') });
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
      const lineGlyph = (type, arrow) => `<svg width="22" height="10" viewBox="0 0 30 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7H${type === 'association' && !arrow ? 28 : 26}"${type === 'association' ? '' : ' stroke-dasharray="4 3"'}/>${type === 'association' && !arrow ? '' : '<path d="M21 2.5 28 7 21 11.5"/>'}</svg>`;
      const swatchOf = (ids) => { const cs = [...new Set(ids.map((id) => (itemOf(id) || {}).color || ''))]; return cs.length === 1 ? cs[0] : ''; };

      let lastBarKey = null;   // which selection the bar was last drawn for: a redraw of the same one makes no entrance
      function drawSelectionTools() {
        const barKey = presenting() ? null : JSON.stringify([selIds, selOther]);
        const sameBar = barKey !== null && barKey === lastBarKey;
        lastBarKey = barKey;
        // another element: the old bar closes, then the new one opens in its own place; the same one is redrawn quietly
        html.querySelectorAll('.uc-actionbar').forEach((el) => { if (sameBar) el.remove(); else motion.hideBar(el); });
        if (presenting()) return;
        const bar = ui.actionBar('uc-actionbar is-wrap');
        let at = null;
        if (selOther && selOther.kind === 'link') at = linkBar(bar, linkOf(selOther.id));
        else if (selOther && selOther.kind === 'subject') at = subjectBar(bar, subjectOf(selOther.id));
        else if (selIds.length > 1) at = multiBar(bar);
        else if (selIds.length === 1) at = itemBar(bar, itemOf(selIds[0]));
        if (!at) return;
        html.appendChild(bar);
        ui.fitBar(bar);
        const w = ui.barSize(bar).w, h = ui.barSize(bar).h;
        let below = !ui.roomAbove({ getBoundingClientRect: () => ({ top: canvas.getBoundingClientRect().top + at.y * scale }) }, bar);   // by where the anchor is in the window
        // centred on its anchor; only the window's edges move it (the bar is not zoomed, so its width on screen is w)
        const vp = viewport.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
        const sx = Math.max(vp.left + 8 + w / 2, Math.min(cr.left + at.x * scale, vp.right - 8 - w / 2));
        const cx = (sx - cr.left) / scale;
        const place = (isBelow) => {
          bar.classList.toggle('is-below', isBelow);
          Object.assign(bar.style, {
            left: px(Math.round(cx)),   // the bar is centred on it (translate), so it stays put when collapsed
            top: px(Math.round(isBelow ? at.bottom + 10 / scale : at.y - 10 / scale - h))
          });
        };
        place(below);
        if (selOther && selOther.kind === 'link' && linkBarAvoid && linkBarAvoid.id === selOther.id) {
          const r = bar.getBoundingClientRect();
          if (linkBarAvoid.x >= r.left - 4 && linkBarAvoid.x <= r.right + 4 && linkBarAvoid.y >= r.top - 4 && linkBarAvoid.y <= r.bottom + 4) {
            below = !below;
            place(below);
          }
        }
        if (!sameBar) motion.showBar(bar);
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
        if (!isActor) {
          bar.appendChild(abButton('point', `${ui.icon('plus', { size: 'sm' })}<span>Point</span>`, 'Add an extension point'));
          bar.appendChild(abSep());
        }
        bar.appendChild(swatchPicker(o.color || '', setColor, { triggerClass: 'uc-ab-btn', btnClass: 'uc-ab-swatch' }));
        bar.appendChild(abSep());
        bar.appendChild(abButton('note', ui.icon('note'), 'Add a note (N)'));
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete (and its lines)', undefined, undefined, 'is-danger'));
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
        bar.appendChild(swatchPicker(swatchOf(selIds), setColor, { triggerClass: 'uc-ab-btn', btnClass: 'uc-ab-swatch' }));
        bar.appendChild(abSep());
        bar.appendChild(abButton('delete', `${ui.icon('trash')}<span>Delete ${selIds.length}</span>`, `Delete these ${selIds.length} items and their lines`, undefined, undefined, 'is-danger'));
        const x0 = Math.min(...objs.map((o) => o.x)), y0 = Math.min(...objs.map((o) => o.y));
        const x1 = Math.max(...objs.map((o) => o.x + (o.w || 0))), y1 = Math.max(...objs.map((o) => o.y + (o.h || 0)));
        return anchorOfBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      function subjectBar(bar, s) {
        if (!s || typeof s.x !== 'number') return null;
        bar.setAttribute('aria-label', 'Subject');
        bar.appendChild(abButton('rename', ui.icon('rename'), 'Rename (F2)'));
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete the subject and its use cases', undefined, undefined, 'is-danger'));
        return anchorOfBox(boxOf(s));
      }
      function linkBar(bar, l) {
        if (!l || !l.points) return null;
        bar.setAttribute('aria-label', 'Line');
        const caseCase = isCaseCase(l);
        if (!caseCase) {
          if (l.type === 'association') bar.appendChild(abButton('arrow', lineGlyph('association', true), 'Arrow: show direction with an open arrowhead', l.navigable === true, undefined, 'uc-ab-glyph'));
        } else {
          bar.appendChild(abButton('type', `${lineGlyph('include', false)}<span>Include</span>`, '«include»: the base always needs the part', l.type === 'include', 'include'));
          bar.appendChild(abButton('type', `${lineGlyph('extend', false)}<span>Extend</span>`, '«extend»: an optional addition to the base, only sometimes', l.type === 'extend', 'extend'));
        }
        if (bar.children.length) bar.appendChild(abSep());
        if (l.type !== 'association' || l.navigable === true) {
          bar.appendChild(abButton('reverse', `${ui.icon('reverse', { size: 'sm' })}<span>Reverse</span>`, 'Reverse the direction of the line'));
        }
        if (l.type === 'extend' && caseOf(l.to)) {
          const b = abButton('point-menu', `<span>${l.extensionPoint ? esc(l.extensionPoint) : 'Extension point'}</span>${ui.icon('chevron-down', { size: 'xs', bold: true })}`, 'The extension point of the base where this extension applies');
          b.dataset.menu = '';
          bar.appendChild(b);
        }
        bar.appendChild(abButton('delete', ui.icon('trash'), 'Delete this line', undefined, undefined, 'is-danger'));
        if (l.labelBox) return anchorOfBox(l.labelBox);
        const m = midOf(l.points);
        return { x: m.x, y: m.y, bottom: m.y };
      }
      html.addEventListener('click', (e) => {
        const t = e.target;
        const kl = t instanceof Element && t.closest('.uc-key .color-key-label');
        if (kl) {
          if (kl.isContentEditable || presenting()) return;
          e.stopPropagation();
          selectOther('key', kl.dataset.color);
          return;
        }
        const chev = t instanceof Element && t.closest('.uc-subject-title > .chevron');
        if (chev) { e.stopPropagation(); toggleCollapsed(chev.parentNode.parentNode.dataset.subjectId); return; }
        const badge = t instanceof Element && t.closest('.uc-actor > .note-badge, .uc-case > .note-badge');
        if (badge) {
          e.stopPropagation();
          const notes = notesOfItem(badge.parentNode.dataset.nodeId);
          if (!notes.length) return;
          if (presenting()) { selOther = selectedNoteId() === notes[0].id ? null : { kind: 'note', id: notes[0].id }; applyNoteVisibility(); } else editNote(notes[0].id);
          return;
        }
        const b = e.target.closest('.uc-ab-btn');
        if (!b) return;
        e.stopPropagation();
        runAction(b.dataset.act, b.dataset.value, b);
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
          if (act === 'rename') editSubjectName(selOther.id);
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
        if (act === 'kind') {
          if (value === 'human') delete o.kind; else o.kind = value;
          commit(false, {
            duration: 180,
            afterPlay: () => {
              const el = els.items.get(o.id);
              const figSvg = el && el.querySelector('.uc-figure svg');
              if (figSvg) motion.anim(figSvg, [{ transform: 'scale(0.65)' }, { transform: 'none' }], { duration: 160, easing: motion.curve('curve-spring-tactile') });
              const kw = el && el.querySelector('.uc-kw');
              if (kw) motion.anim(kw, [{ transform: 'translateY(-4px) scale(0.85)', clipPath: 'inset(0 0 100% 0)' }, { transform: 'none', clipPath: 'inset(0 0 0 0)' }], { duration: 160, easing: motion.curve('curve-out') });
            }
          });
        }
        else if (act === 'level') { if (value === 'user') delete o.level; else o.level = value; commit(false, { duration: 190 }); }
        else if (act === 'point') { addPoint(o); commit(false); const eps = els.items.get(o.id).querySelectorAll('.uc-ep'); editPoint(o.id, eps.length - 1); }
        else if (act === 'note') addNoteTo(o.id);
        else if (act === 'delete') deleteSelection(btn);
      }

      // --- INLINE TEXT EDITING (double-click, Enter / F2, or straight after creating something) ---
      function beginEdit(el, opts = {}) {
        if (!el || el.isContentEditable) return;
        staleEl(el.closest('.uc-actor, .uc-case, .uc-subject, .uc-label'));   // its text changes behind the model's back
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
          if (changed) commit(false, opts.motionOpts);
          else {
            el.textContent = opts.restore !== undefined ? opts.restore : original;
            if (opts.onCancel) opts.onCancel();
          }
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
        if (!l || presenting() || (l.type !== 'include' && l.type !== 'extend')) return;
        if (!selOther || selOther.kind !== 'link' || selOther.id !== id) selectOther('link', id);
        const labelEl = els.links.get(id) && els.links.get(id).label;
        if (!labelEl) return;
        let cond = labelEl.querySelector('.uc-cond');
        const created = !cond;
        if (!cond) {
          cond = htmlEl('span', 'uc-cond');
          labelEl.appendChild(cond);
        }
        labelEl.classList.add('is-editing-cond');
        if (created && motion.enabled()) {
          motion.anim(cond, [
            { transform: 'translateY(-3px)', clipPath: 'inset(0 0 100% 0)' },
            { transform: 'none', clipPath: 'inset(0 0 0 0)' }
          ], { duration: 150, easing: motion.curve('curve-out') });
        }
        const prev = l.condition || '';
        beginEdit(cond, {
          raw: prev,
          restore: prev ? `[${prev}]` : '',
          apply: (rawVal) => {
            const v = rawVal.replace(/^\[([\s\S]*)\]$/, '$1').trim().slice(0, 80);
            if (v === prev) return false;
            if (v) l.condition = v; else delete l.condition;
            return true;
          },
          onCancel: () => {
            labelEl.classList.remove('is-editing-cond');
            if (created) cond.remove();
          },
          motionOpts: {
            afterPlay: () => {
              if (!l.condition || prev) return;
              const c = els.links.get(l.id)?.label?.querySelector('.uc-cond');
              if (c) motion.anim(c, [
                { transform: 'translateY(-3px)', clipPath: 'inset(0 0 100% 0)' },
                { transform: 'none', clipPath: 'inset(0 0 0 0)' }
              ], { duration: 150, easing: motion.curve('curve-out') });
            }
          }
        });
      }
      function editSelection() {
        if (selOther && selOther.kind === 'note') { editNote(selOther.id); return; }
        if (selOther && selOther.kind === 'subject') { editSubjectName(selOther.id); return; }
        if (selOther && selOther.kind === 'link') { editLinkCondition(selOther.id); return; }
        if (selOther && selOther.kind === 'key') { editKey(html.querySelector(`.uc-key .color-key-label[data-color="${selOther.id}"]`)); return; }
        if (selIds.length === 1) editName(selIds[0]);
      }
      html.addEventListener('dblclick', (e) => {
        const lab = e.target instanceof Element && e.target.closest('.uc-label');
        if (lab) {   // a label's double-click edits the line's condition
          if (e.target.isContentEditable) return;
          e.preventDefault();
          e.stopPropagation();
          editLinkCondition(lab.dataset.edgeId);
          return;
        }
        if (presenting()) return;
        const t = e.target;
        if (t.closest('.uc-actionbar, .chevron, .note-badge, .port, .note') || t.isContentEditable) return;
        const kl = t.closest('.uc-key .color-key-label');
        if (kl) { e.stopPropagation(); editKey(kl); return; }
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
          if (d && d.ghost) { d.ghostRect = d.ghost.getBoundingClientRect(); d.ghost.remove(); document.body.classList.remove('palette-dragging'); }
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
          d.ghost.style.transform = `scale(${scale * 1.02})`;
          d.ghost.style.left = px(e.clientX - d.ghost.offsetWidth * scale / 2);
          d.ghost.style.top = px(e.clientY - d.ghost.offsetHeight * scale / 2);
          const pt = canvasPoint(e);
          const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('#viewport');   // anywhere on the view, also past the edge of a small canvas
          d.pt = over ? pt : null;
          d.id = kind === 'note' ? itemIdAt(e.clientX, e.clientY) : null;
          d.ghost.classList.toggle('off-target', kind === 'note' ? !d.id && !over : !over);
          canvas.querySelectorAll('.drop-target, .note-target').forEach((el) => el.classList.remove('drop-target', 'note-target'));
          if (kind === 'note' && d.id) els.items.get(d.id).classList.add('note-target');
          if (kind === 'case' && over) { const s = subjectAt(pt), el = s && els.subjects.get(s.id); if (el) el.classList.add('drop-target'); }
        };
        const up = () => {
          const d = end();
          if (!d || !d.ghost) return;
          btn.dataset.dragged = '1';
          if (kind === 'note' ? d.id || d.pt : d.pt) onDrop(kind === 'note' ? d.id : d.pt, d.pt, d.ghostRect);   // a note: on an item links it, anywhere else on the canvas it is free
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
      wireTool(document.getElementById('btn-add-actor'), 'actor', () => addActor('human'), (pt, r) => addActor('human', pt, r));
      wireTool(document.getElementById('btn-add-system'), 'system', () => addActor('system'), (pt, r) => addActor('system', pt, r));
      wireTool(document.getElementById('btn-add-usecase'), 'case', () => addCase(), (pt, r) => addCase(pt, r));
      wireTool(document.getElementById('btn-add-subject'), 'subject', () => addSubject(), (pt, r) => addSubject(pt, r));
      // Note: a click adds one to the selected item, or a free one at the view's centre with nothing selected; a drag gives the item under the drop a note, or drops a free one
      wireTool(document.getElementById('btn-add-note'), 'note', () => {
        const p = primaryId();
        if (p) addNoteTo(p); else if (selectedNoteId()) editNote(selectedNoteId()); else addFreeNote();
      }, (id, pt) => (id ? giveNoteTo(id) : addFreeNote(pt)));
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
      }, true);
      window.addEventListener('keydown', (e) => {
        if (presenting() ? !(e.key.startsWith('Arrow')) : false) return;
        if (drag || e.ctrlKey || e.metaKey) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a.tagName === 'BUTTON' && e.key === 'Enter'))) return;
        if (ui.isConfirmOpen() || menuEl) return;
        if ((e.key === 'Enter' || e.key === 'F2') && !presenting() && (selIds.length === 1 || selOther)) { e.preventDefault(); editSelection(); return; }
        if ((e.key === 'n' || e.key === 'N') && !e.altKey && !presenting()) {
          const p = primaryId();
          e.preventDefault();
          if (p && selIds.length === 1) addNoteTo(p); else if (selectedNoteId()) editNote(selectedNoteId()); else addFreeNote();
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
      // Python twin: keep the two byte-identical. An anchored note carries no position on disk (a dragged note's _pos is dropped); a free note keeps its absolute `pos`.
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
        if (d.colorKey && typeof d.colorKey === 'object') {
          const inUse = new Set([...(d.useCases || []), ...(d.actors || [])].map((q) => q.color).filter(Boolean));
          Object.keys(d.colorKey).forEach((k) => { if (!inUse.has(k) || !String(d.colorKey[k] || '').trim()) delete d.colorKey[k]; });
          if (!Object.keys(d.colorKey).length) delete d.colorKey;
        }
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
        toMermaid,   // the writer and reader in mermaid.js; the shell hands them the saved form of the data
        fromMermaid,
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
        // Search: read the live DOM; ordered top to bottom, then left to right. A hidden note card (Notes off) has no box,
        // so its match rings the first linked item instead.
        searchItems() {
          const out = [], clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const add = (id, el, text, at) => {
            text = clean(text);
            if (!text || !el) return;
            const b = at || el;
            out.push({ id, text, el, y: parseFloat(b.style.top) || 0, x: parseFloat(b.style.left) || 0 });
          };
          els.items.forEach((el, id) => {
            const n = el.querySelector('.uc-actor-name, .uc-name');
            const u = caseOf(id);   // a use case is also found by its requirement ids (FR-12, UC-03)
            add((el.classList.contains('uc-actor') ? 'actor:' : 'uc:') + id, el, `${(n && n.textContent) || ''} ${u && Array.isArray(u.refs) ? u.refs.join(' ') : ''}`);
          });
          els.subjects.forEach((el, id) => { const n = el.querySelector('.uc-subject-name'); add('system:' + id, el, n && n.textContent); });
          html.querySelectorAll('.uc-label[data-edge-id]').forEach((el) => add('rel:' + el.dataset.edgeId, el, el.textContent));
          if (notesLayer) [...notesLayer.children].forEach((card) => {
            const t = card.querySelector('.note-text'), id = card.dataset.noteId;
            const shown = card.classList.contains('show') || card.classList.contains('peek');
            const host = shown ? card : els.items.get(linkedItems(noteOf(id) || {})[0]);
            add('note:' + id, host, t && t.textContent, host);
          });
          return out.sort((a, b) => a.y - b.y || a.x - b.x).map(({ id, text, el }) => ({ id, text, el }));
        },
        contentOverflow() {
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          const H = canvas.offsetHeight, W = canvas.offsetWidth;
          if (legendEl) o.bottom = Math.max(o.bottom, 12 + legendEl.offsetHeight + 12);
          if (notesLayer) {
            [...notesLayer.children].forEach((card) => {
              if (!card.classList.contains('show')) return;   // on show: all, or a free note
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
