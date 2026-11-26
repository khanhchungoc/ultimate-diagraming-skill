      // --- C4 DIAGRAM PLUGIN ---
      // Renders chartData (diagramType "c4") from the model engine.js lays out (Engine contract: dev/plans/plan-c4.md):
      // elements (people, systems, containers, databases, queues, externals) as tiles, groups as frames (a collapsed one is a
      // single system tile), the arrows in data._edges with their label pills, and the colour key. It selects, highlights the
      // arrows in and out of what is hovered, collapses and expands groups (also in one go through the Level control) and
      // searches; and it edits (contract: "Editing (phase 4)" in dev/plans/plan-c4.md): add from the dock, select (click,
      // Ctrl/Shift, Shift+drag box, Ctrl+A), the action bars, inline rename, connect by port or by button with a required label,
      // delete, ungroup. Two layout modes (contract: "Moving boxes (phase 5)"): Auto-Tidy (the default) re-lays everything out
      // after every edit (layoutDiagram, positions dropped); manual layout (chartData._manual, saved as the `layout` map) keeps
      // positions, an edit calls routeDiagram, and boxes are dragged (MOVING BOXES below). The shell's morph motion plays on
      // both. Every finished edit ends in one updateStatus(true) (one undo step); an add waits for its first rename and a
      // connection for its label, so each is one step.
      //
      // x/y of elements and groups are the only saved positions (the "layout" map, toDisk, written in manual layout only); sizes, _edges, _hidden, _depth,
      // _collapsed, points, path, labelBox and canvas are derived by routeDiagram on every render and never saved.
      // Everything on screen is absolute within #c4-canvas. The plugin sits in its own function so its names cannot clash with the engine's.
      (function () {
      'use strict';

      const NS = 'http://www.w3.org/2000/svg';
      const canvas = document.getElementById('c4-canvas');
      const svg = document.getElementById('c4-svg');
      const edgesG = document.getElementById('c4-edges');
      const html = document.getElementById('c4-html');
      const rubber = document.getElementById('c4-rubber');
      const btnLevel = document.getElementById('btn-level');
      const levelWrap = btnLevel && btnLevel.closest('[data-dock-pop]');
      const levelBtns = [...document.querySelectorAll('#level-pop [data-level]')];
      const btnLayerDir = document.getElementById('btn-layer-dir');
      const layerDirEls = [...document.querySelectorAll('[data-layer-dir]')];
      const btnSteps = document.getElementById('btn-steps');

      // The generic glyph per kind (an element's own `icon` wins; a `logo:` name has no renderer yet and falls back to it) and the
      // palette slot per kind (an element's own `color` wins; an external system stays neutral)
      const KIND_ICON = { person: 'user', system: 'server', container: 'container', component: 'cpu', database: 'database', queue: 'queue', external: 'cloud' };
      const KIND_SLOT = { person: '1', system: '2', container: '3', component: '3', database: '8', queue: '5' };
      const KIND_NAME = { person: 'Person', system: 'Software system', container: 'Container', component: 'Component', database: 'Database', queue: 'Queue', external: 'External system' };
      const GROUP_SLOT = '2';   // a collapsed system group is drawn as a system tile
      const KINDS = ['person', 'system', 'container', 'database', 'queue', 'external'];   // what the dock adds (components wait for Level 3)
      const CONTAINER_KINDS = new Set(['container', 'database', 'queue', 'component']);
      const DEFAULT_NAME = { person: 'Person', system: 'Software system', container: 'Container', database: 'Database', queue: 'Queue', external: 'External system' };
      const NAME_MAX = 80, LABEL_MAX = 80, TECH_MAX = 60, DESC_MAX = 200, STEP_MAX = 8;

      // --- STATE ---
      let sel = [];            // the selection, primary last: [{ kind: 'element' | 'group' | 'edge', id }]
      let hoverId = null;      // the element or collapsed group under the pointer
      let hoverEdgeId = null;
      let drag = null;         // a connection being dragged from a port
      let mv = null;           // boxes being moved by the pointer or by Alt+arrows (MOVING BOXES)
      let keyDraft = null;     // the colour slot whose colour key entry is being named
      let boxBase = [];        // the selection a Shift+drag box started from
      let newLink = null;      // the relation whose label is still being edited (its connection is not a step yet)
      let selNoteId = null;    // the selected note card (no element, group or arrow is selected then)
      const noteCtl = createNotes({   // the card being typed in; a note added a moment ago remembers the Notes state it found
        data: () => chartData,
        cardOf: (id) => noteCard(id),
        canEdit: () => !presenting(),
        restoreSwitch: true,
        openCard: (n) => {
          const card = noteCard(n.id);
          if (card) selectNote(n.id);
          return card;
        },
        // the card folds into what it explained (a FLIP in render), so the snapshot is taken before the data changes
        beforeRemove: (n) => {
          const a = noteAnchor(n);
          motion.cancelAll();
          return { a, snap: motion.enabled() && html.childElementCount > 0 ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null };
        },
        clearSelection: (id) => { if (selNoteId === id) selNoteId = null; },
        render: ({ note, token, reason }) => {
          if (reason === 'text') {
            const names = noteNames(note);
            noteCard(note.id).setAttribute('aria-label', names ? `Note on ${names}: ${note.text}` : `Note: ${note.text}`);
            placeNotes();
            updateNotesButton();
          } else if (reason !== 'same') render({ snap: token.snap, toKey: token.a ? { [note.id]: token.a.id } : undefined, duration: 160 });
        },
        onChange: () => updateStatus(true),
      });
      let notesLayer = null;
      const els = { nodes: new Map(), groups: new Map(), edges: new Map() };   // id -> element, kept across renders (render); edges: id -> { g, line, hit, label, badge, ... }
      let byId = new Map();    // group id -> group (rebuilt each render)
      let elById = new Map();  // element id -> element (rebuilt each render)
      let edgeById = new Map(); // edge id -> edge (rebuilt each render)

      // --- MODEL ACCESS ---
      const groups = () => chartData.groups || [];
      const elements = () => chartData.elements || [];
      const relations = () => chartData.relations || [];
      const edges = () => chartData._edges || [];
      const groupOf = (id) => byId.get(id) || groups().find((g) => g.id === id);
      const elementOf = (id) => elById.get(id) || elements().find((e) => e.id === id);
      const nodeOrGroup = (id) => elementOf(id) || groupOf(id);
      const edgeOf = (id) => edgeById.get(id) || edges().find((e) => e.id === id);
      const isDirectEdge = (e) => !!e && e.count === 1 && !e.agg && Array.isArray(e.members) && e.members.length === 1;
      const presenting = () => document.body.classList.contains('presentation');
      const placed = (o) => typeof o.x === 'number' && typeof o.y === 'number';
      const nameOf = (o) => (o && o.name != null ? String(o.name) : '');
      const showTech = () => chartData.showTech !== false;
      const showSteps = () => chartData.showSteps !== false;
      const px = (v) => `${v}px`;
      const isTyping = () => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };

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
      // Client point -> canvas coordinates
      function canvasPoint(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / scale - canvas.clientLeft, y: (e.clientY - r.top) / scale - canvas.clientTop };
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
      function edgeMarkerUrl(color) {
        if (!color) return 'url(#c4-mk)';
        const safe = String(color).replace(/[^a-zA-Z0-9_-]/g, '_');
        const id = `c4-mk-c-${safe}`;
        if (!document.getElementById(id)) {
          const base = document.getElementById('c4-mk');
          if (!base) return 'url(#c4-mk)';
          const copy = base.cloneNode(true);
          copy.id = id;
          setSwatch(copy, color);
          copy.style.setProperty('--mk', 'var(--sw-line, var(--connector))');
          base.parentNode.appendChild(copy);
        }
        return `url(#${id})`;
      }

      document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.add('c4-touch'); }, true);   // bigger ports for a finger

      // --- INPUT CHECKS (the boundary: a name or a label is checked once, here, and refused loudly) ---
      function cleanText(v, what, max) {
        if (typeof v !== 'string') throw new TypeError(`${what} must be text`);
        const t = v.replace(/\s+/g, ' ').trim();
        if (!t) throw new RangeError(`${what} is required`);
        if (t.length > max) throw new RangeError(`${what} is longer than ${max} characters`);
        return t;
      }
      function askText(v, what, max) {   // the page's form of cleanText: the refusal is a toast
        try { return cleanText(v, what, max); } catch (err) { ui.toast(err.message); return null; }
      }
      const optText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
      // Editor ids are <prefix>_<ms>; two in one millisecond take a _<k> suffix (the form the codec renames to a name slug)
      function newId(prefix) {
        const used = new Set(groups().concat(elements(), chartData.notes || []).map((o) => o.id));
        const base = `${prefix}_${Date.now()}`;
        let id = base, k = 2;
        while (used.has(id)) id = `${base}_${k++}`;
        return id;
      }
      const setOpt = (o, key, v) => { if (v === '' || v === undefined || v === false || v === null) delete o[key]; else o[key] = v; };

      // --- GROUP TREE ---
      const parentGroup = (g) => (g.parent ? groupOf(g.parent) : null);
      function ancestors(g) {   // outermost last; a cycle is refused by the codec, the guard keeps a bad file from looping
        const out = [], seen = new Set([g.id]);
        for (let p = parentGroup(g); p && !seen.has(p.id); p = parentGroup(p)) { seen.add(p.id); out.push(p); }
        return out;
      }
      const depthOf = (g) => ancestors(g).length + 1;
      // A group is collapsible at Level 1 when it is a system or directly holds container-tier elements (not an outer ownership boundary)
      const isCollapsibleGroup = (g) => g.kind === 'system' || elements().some((e) => e.group === g.id && CONTAINER_KINDS.has(e.kind));
      const levelOf = (g) => [g].concat(ancestors(g)).filter(isCollapsibleGroup).length;
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

      function isAncestorOrSelf(aId, bId) {
        if (aId === bId) return true;
        const aG = groupOf(aId), bG = groupOf(bId), aE = elementOf(aId), bE = elementOf(bId);
        if (aG) {
          if (bE && bE.group && (bE.group === aId || ancestors(groupOf(bE.group)).some((x) => x.id === aId))) return true;
          if (bG && ancestors(bG).some((x) => x.id === aId)) return true;
        }
        if (bG) {
          if (aE && aE.group && (aE.group === bId || ancestors(groupOf(aE.group)).some((x) => x.id === bId))) return true;
          if (aG && ancestors(aG).some((x) => x.id === bId)) return true;
        }
        return false;
      }

      // --- RENDERING ---
      const FLIP_SPECS = [
        { selector: '.c4-node[data-node-id]', key: 'nodeId' },
        { selector: '.c4-group[data-group-id]', key: 'groupId' },
        { selector: '.edge-label[data-edge-id]', key: 'edgeId' },
        { selector: '.c4-step[data-edge-id]', key: (el) => `step:${el.dataset.edgeId}` },
        { selector: '.note[data-note-id]', key: 'noteId' },   // a note glides with what it explains
        { selector: '.c4-actionbar', key: () => 'bar' }   // the action bar follows what it belongs to
      ];
      function captureEdges() {
        const m = new Map();
        els.edges.forEach((rec, id) => m.set(id, rec.d));
        return m;
      }
      // A new or re-routed arrow draws itself in; one that did not change stays as it is
      function playEdges(prev) {
        if (!prev || !motion.enabled()) return;
        els.edges.forEach((rec, id) => { if (prev.get(id) !== rec.d) motion.drawPath(rec.line, { duration: 160, easing: 'curve-out' }); });
      }

      // The elements on screen are kept across renders, keyed by id (els.nodes, els.groups, els.edges): a render updates each
      // one in place and creates or removes only what changed, so a big diagram is not rebuilt on every edit and each box keeps
      // its element through the morphs. What a box holds (name, tech, chips, ports, placeholders) is built again only when what
      // it shows changed (its `sig`); a group that turns from frame to tile (or back) gets a new element. Events reach every
      // element through one listener per layer (ITEM EVENTS below), so nothing is attached per element on a render.
      const itemState = new WeakMap();   // element -> { sig, paint, shape }: what the last render built into it
      const setStyle = (el, k, v) => { if (el.style[k] !== v) el.style[k] = v; };
      const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
      const setCls = (el, cls) => { if (el.className !== cls) el.className = cls; };
      function placeBox(el, o) {
        setStyle(el, 'left', px(o.x)); setStyle(el, 'top', px(o.y)); setStyle(el, 'width', px(o.w)); setStyle(el, 'height', px(o.h));
        setStyle(el, 'translate', '');        // left by a move that was let go (MOVING BOXES); a fresh element has none
        setStyle(el, 'transformOrigin', '');  // left by an entrance morph
      }
      function setPaint(el, st, v) {   // the swatch roles of a slot or hex; none clears them (the class comes with the className)
        if (st.paint === v) return;
        st.paint = v;
        if (v) setSwatch(el, v);
        else { el.style.removeProperty('--swatch-color'); delete el.dataset.sw; }
      }
      // Puts the kept elements of one layer in order and drops any other child (the legend, notes and bar are added afresh)
      function placeChildren(parent, list) {
        const want = new Set(list);
        [...parent.children].forEach((c) => { if (!want.has(c)) c.remove(); });
        let cur = parent.firstElementChild;
        list.forEach((el) => { if (el === cur) cur = cur.nextElementSibling; else parent.insertBefore(el, cur); });
      }
      const itemDirty = (el) => { const st = el && itemState.get(el); if (st) st.sig = null; };   // an inline edit wrote into it: build its content again

      function render(opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        const useMotion = opts !== false && motion.enabled() && html.childElementCount > 0;
        const snap = o.snap || (useMotion ? motion.capture(canvas, FLIP_SPECS) : null);
        const prevEdges = useMotion ? (o.prevEdges || captureEdges()) : null;
        byId = new Map(groups().map((g) => [g.id, g]));
        elById = new Map(elements().map((e) => [e.id, e]));
        const wasManual = chartData._manual === true;
        routeDiagram(chartData, o.pinned ? { pinned: o.pinned } : undefined);   // keeps every position; lays out afresh by itself when nothing is placed
        edgeById = new Map(edges().map((e) => [e.id, e]));
        if (!wasManual) delete chartData._manual;   // the engine marks every route it runs as manual; the page decides the mode (Auto-Tidy keeps its positions in memory only)
        const C = chartData.canvas || { width: 800, height: 400 };
        canvas.style.width = px(C.width);
        canvas.style.height = px(C.height);
        svg.setAttribute('width', C.width);
        svg.setAttribute('height', C.height);
        const hadFocus = document.activeElement && html.contains(document.activeElement) && (document.activeElement.dataset.nodeId || document.activeElement.dataset.groupId || document.activeElement.dataset.edgeId);
        sel = sel.filter(selectionExists);
        if (hoverId && !elementOf(hoverId) && !groupOf(hoverId)) hoverId = null;

        const order = [];
        const seenGroups = new Set();
        groups().filter((g) => placed(g) && g.w > 0 && !hiddenGroup(g)).sort((a, b) => depthOf(a) - depthOf(b)).forEach((g) => {
          order.push(syncGroup(g));
          seenGroups.add(g.id);
        });
        els.groups.forEach((el, id) => { if (!seenGroups.has(id)) els.groups.delete(id); });
        renderEdges();
        const seenNodes = new Set();
        elements().forEach((e) => {
          if (e._hidden || !placed(e) || !(e.w > 0)) return;
          order.push(syncNode(e));
          seenNodes.add(e.id);
        });
        els.nodes.forEach((el, id) => { if (!seenNodes.has(id)) els.nodes.delete(id); });
        renderLabels(order);
        placeChildren(html, order);   // also drops the legend, notes and action bar of the last render: they are made again below
        renderLegend();
        renderNotes();
        updateLevelButtons();
        updateLayerDirButton();
        updateStepsButton();
        updateNotesButton();
        applyState();
        updateModeUi();
        syncTouchDrag();
        const back = hadFocus && (els.nodes.get(hadFocus) || els.groups.get(hadFocus) || (els.edges.get(hadFocus) || {}).label);
        if (back && document.activeElement !== back) back.focus({ preventScroll: true });
        if (snap) {
          motion.play(snap, canvas, FLIP_SPECS, { duration: o.duration, fromKey: o.fromKey, toKey: o.toKey, ghostExit: o.ghostExit, enterScale: o.enterScale });
          playEdges(prevEdges);
          if (o.afterPlay) o.afterPlay();
        }
      }
      const selectionExists = (s) => (s.kind === 'edge' ? edges().some((e) => e.id === s.id) : s.kind === 'group' ? !!groupOf(s.id) && !hiddenGroup(groupOf(s.id)) : !!elementOf(s.id) && !elementOf(s.id)._hidden);

      // The icon of an element: its own `icon`, else the generic one of its kind (a `logo:` name present in LOGOS is drawn by nodeContent; one that is not falls back to this)
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

      // The press on a tile, tag, arrow or label: one rule for all. Ctrl/Shift adds to the selection, a plain press selects it alone.
      function press(ev, item) {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        if (ev.target.closest && ev.target.closest('.is-editing')) return;
        if (isTyping()) document.activeElement.blur();   // commit a field being edited, as any click on the canvas does
        if (presenting()) { setSel([item]); return; }
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { ev.preventDefault(); toggleSel(item); return; }
        if (ev.target.closest && ev.target.closest('.chevron')) return;
        if (item.kind !== 'edge' && sel.length > 1 && inSel(item.kind, item.id)) { startMove(ev, item, sel.slice()); return; }   // the whole selection moves; a click without a move selects this one
        setSel([item]);
        if (item.kind !== 'edge') startMove(ev, item, [item]);
      }

      // The note a box shows a pin for (the Notes switch is off and a note with text explains it), or null
      function pinNoteOf(kind, id) {
        if (chartData.showNotes === true) return null;
        const n = notesList().find((x) => noteText(x) && (kind === 'element' ? (x.elements || []).includes(id) : (x.groups || []).includes(id)));
        return n ? n.id : null;
      }
      function notePin(label) {   // a press shows every note and selects the box's note (ITEM EVENTS)
        const b = htmlEl('button', 'c4-note-pin');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.title = `Show note on ${label}`;
        b.setAttribute('aria-label', b.title);
        b.innerHTML = ui.icon('notes', { size: 'xs' });
        return b;
      }

      function cardPlaceholder(field, label, title) {   // a press opens the field (ITEM EVENTS)
        const ph = htmlEl('span', `c4-placeholder c4-${field}-ph`, '');
        ph.dataset.exportSkip = '';
        ph.dataset.field = field;
        ph.dataset.ph = label;
        ph.title = title;
        return ph;
      }
      function nodeContent(e, pinId) {   // what a tile holds: chip, name, tech, description, placeholders, note pin and ports
        const chip = htmlEl('span', 'c4-disc');
        if (String(e.icon).startsWith('logo:') && ui.hasLogo(e.icon.slice(5))) { chip.classList.add('is-logo'); chip.innerHTML = ui.logo(e.icon.slice(5), { size: 'tile' }); }   // a local-pack logo keeps its own colours on a white disc
        else chip.innerHTML = ui.icon(iconOf(e), { size: 'tile', fine: true });
        const text = htmlEl('span', 'c4-text');
        text.appendChild(htmlEl('span', 'c4-name t-title', nameOf(e)));
        if (e.tech && showTech()) text.appendChild(htmlEl('span', 'c4-tech t-detail', `[${e.tech}]`));
        if (e.description) text.appendChild(htmlEl('span', 'c4-desc t-detail', String(e.description)));
        const missingTech = !e.tech && showTech(), missingDesc = !e.description;
        if (missingTech || missingDesc) {
          const phRow = htmlEl('span', 'c4-ph-row');
          phRow.dataset.exportSkip = '';
          if (missingTech) phRow.appendChild(cardPlaceholder('tech', '+ tech', 'Add technology (e.g. Node.js, PostgreSQL)'));
          if (missingDesc) phRow.appendChild(cardPlaceholder('desc', '+ description', 'Add a short description'));
          text.appendChild(phRow);
        }
        const kids = [chip, text];
        if (pinId) kids.push(notePin(nameOf(e)));
        ['N', 'E', 'S', 'W'].forEach((side) => {   // a port on each side: drag it onto another element to connect
          const port = ui.port({ N: 'top', E: 'right', S: 'bottom', W: 'left' }[side]);
          port.dataset.side = side;
          port.dataset.touchDrag = '';
          port.setAttribute('role', 'button');
          port.setAttribute('aria-label', `Connect from ${nameOf(e)}: drag to another element`);
          port.title = 'Drag to another element to connect them';
          kids.push(port);
        });
        return kids;
      }
      function syncNode(e) {
        let el = els.nodes.get(e.id), st = el && itemState.get(el);
        if (!el) {
          el = htmlEl('div', 'c4-node');
          el.dataset.item = '';
          el.dataset.nodeId = e.id;
          el.tabIndex = -1;
          el.setAttribute('role', 'group');
          st = { sig: null, paint: null };
          itemState.set(el, st);
          els.nodes.set(e.id, el);
        }
        setCls(el, 'c4-node swatch-scope');   // drops the state classes of the last render (applyState sets them again)
        if (el.dataset.kind !== e.kind) el.dataset.kind = e.kind;
        setAttr(el, 'aria-label', ariaOf(e));
        placeBox(el, e);
        if (el.style.getPropertyValue('--c4-h') !== px(e.h)) el.style.setProperty('--c4-h', px(e.h));
        setPaint(el, st, e.color || KIND_SLOT[e.kind] || '9');   // external: the neutral slot
        const pinId = pinNoteOf('element', e.id);
        const sig = JSON.stringify([e.kind, nameOf(e), e.tech || '', e.description || '', e.icon || '', showTech(), pinId]);
        if (st.sig !== sig) { st.sig = sig; el.replaceChildren(...nodeContent(e, pinId)); }
        return el;
      }

      function chevron(g, collapsed) {   // a click opens or closes the group (ITEM EVENTS)
        const b = ui.chevron({ expanded: !collapsed, label: collapsed ? `Expand ${nameOf(g)}` : `Collapse ${nameOf(g)} to one box` });
        b.dataset.exportSkip = '';
        return b;
      }
      function syncGroup(g) {
        const tile = isTile(g), shape = tile ? 'tile' : 'frame';
        let el = els.groups.get(g.id), st = el && itemState.get(el);
        if (el && st.shape !== shape) { el.remove(); el = null; }   // a frame and a tile are different boxes
        if (!el) {
          el = htmlEl('div', 'c4-group');
          el.dataset.groupId = g.id;
          if (tile) {
            el.dataset.item = '';
            el.tabIndex = -1;
            el.setAttribute('role', 'group');
          }
          st = { sig: null, paint: null, shape };
          itemState.set(el, st);
          els.groups.set(g.id, el);
        }
        const tint = tile ? (g.color || (g.kind === 'boundary' ? null : GROUP_SLOT)) : swatchOf(g);   // a tile: a system tile; a frame: its colour, a slot or custom hex, as a sequence frame's
        setCls(el, `c4-group ${tile ? 'is-tile' : 'is-frame'}${g.shared === true ? ' is-shared' : ''}${tint ? ' swatch-scope' : ''}`);
        if (el.dataset.kind !== g.kind) el.dataset.kind = g.kind;
        placeBox(el, g);
        setPaint(el, st, tint || null);
        const pinId = pinNoteOf('group', g.id);
        const kind = g.kind === 'boundary' ? 'boundary' : 'software system';
        if (tile) {
          // One system box: the tile of a system, dashed because it opens (the dashed summary of a collapsed frame)
          const n = descendants(g).filter((id) => elementOf(id)).length;
          setAttr(el, 'aria-label', `${nameOf(g)}, ${kind}, ${n} inside, collapsed`);
          const sig = JSON.stringify([nameOf(g), n, pinId]);
          if (st.sig !== sig) {
            st.sig = sig;
            const text = htmlEl('span', 'c4-text');
            text.appendChild(htmlEl('span', 'c4-name t-title', nameOf(g)));
            text.appendChild(htmlEl('span', 'c4-desc t-detail', `${n} ${n === 1 ? 'element' : 'elements'} inside`));
            const chip = htmlEl('span', 'c4-disc');
            chip.innerHTML = ui.icon(KIND_ICON.system, { size: 'tile', fine: true });
            el.replaceChildren(chip, text, chevron(g, true));
            if (pinId) el.appendChild(notePin(nameOf(g)));
          }
        } else {
          const hasKids = descendants(g).length > 0;
          const sig = JSON.stringify([nameOf(g), kind, tint, hasKids, pinId]);
          if (st.sig !== sig) {
            st.sig = sig;
            const tag = htmlEl('div', 'frame-tag c4-tag');
            if (tint) paint(tag, tint);
            tag.tabIndex = -1;
            tag.setAttribute('role', 'group');
            tag.setAttribute('aria-label', `${nameOf(g)}, ${kind}`);
            if (hasKids) tag.appendChild(chevron(g, false));
            tag.appendChild(htmlEl('span', 'c4-tag-name', nameOf(g)));
            if (pinId) tag.appendChild(notePin(nameOf(g)));
            el.replaceChildren(tag);
          }
        }
        return el;
      }

      // --- ARROWS ---
      const edgeTitle = (e) => `${nameOf(elementOf(e.from) || groupOf(e.from))} → ${nameOf(elementOf(e.to) || groupOf(e.to))}: ${e.step ? `[${e.step}] ` : ''}${e.label || ''}${e.tech ? ` [${e.tech}]` : ''}${e.count > 1 ? ` (${e.count} relations)` : ''}`;
      function setMarkers(line, color) {
        line.style.setProperty('--mk-e', edgeMarkerUrl(color));
        line.style.setProperty('--mk-e-in', 'url(#c4-mk-in)');
        line.style.setProperty('--mk-e-out', 'url(#c4-mk-out)');
        line.style.setProperty('--mk-e-sel', 'url(#c4-mk-sel)');
      }
      // els.edges: id -> { g, line, hit, tip, d, tint, label, badge }, kept across renders as the boxes are
      function renderEdges() {
        const list = [];
        edges().forEach((e) => {
          if (!e.path) return;
          const tint = swatchOf(e);
          let rec = els.edges.get(e.id);
          if (!rec) {
            const g = svgEl('g', { 'data-edge-id': e.id });
            const tip = svgEl('title', { 'data-export-skip': '' });
            const line = svgEl('path', { class: 'edge-line' });
            const hit = svgEl('path', { class: 'edge-hit' });
            g.append(tip, hit, line);
            rec = { g, line, hit, tip, d: null, tint: undefined, label: null, badge: null };
            els.edges.set(e.id, rec);
          }
          const { g, line, hit, tip } = rec;
          setAttr(g, 'class', `c4-edge${e.async ? ' is-async' : ''}${tint ? ' is-colored swatch-scope' : ''}`);   // drops the state classes (applyState sets them again)
          setAttr(g, 'data-from', e.from);
          setAttr(g, 'data-to', e.to);
          if (rec.tint !== tint) {
            rec.tint = tint;
            if (tint) setSwatch(g, tint); else { g.style.removeProperty('--swatch-color'); delete g.dataset.sw; }
            setMarkers(line, tint);
          }
          const title = edgeTitle(e);
          if (tip.textContent !== title) tip.textContent = title;
          if (rec.d !== e.path) { rec.d = e.path; line.setAttribute('d', e.path); hit.setAttribute('d', e.path); }
          rec.seen = true;
          list.push(g);
        });
        els.edges.forEach((rec, id) => {
          if (rec.seen) { rec.seen = false; return; }
          els.edges.delete(id);   // its label and badge go with the html layer (placeChildren)
        });
        placeChildren(edgesG, list);
      }
      function renderLabels(order) {
        edges().forEach((e) => {
          const b = e.labelBox, rec = els.edges.get(e.id);
          if (!rec) return;
          const direct = isDirectEdge(e), tint = swatchOf(e);
          const isNewLink = !!(newLink && e.members && e.members.includes(relations().indexOf(newLink)));
          if (b && (e.label || (showTech() && e.tech) || e.count > 1 || isNewLink)) {
            let el = rec.label, st = el && itemState.get(el);
            if (!el) {
              el = htmlEl('div', 'edge-label');
              el.dataset.edgeId = e.id;
              el.setAttribute('role', 'group');
              st = { sig: null, paint: null };
              itemState.set(el, st);
              rec.label = el;
            }
            setCls(el, `edge-label c4-label${tint ? ' is-colored swatch-scope' : ''}`);
            setPaint(el, st, tint);
            const ti = direct ? '0' : '-1';   // a merged arrow (a count tag) is not editable: no tab stop
            if (el.getAttribute('tabindex') !== ti) el.setAttribute('tabindex', ti);
            setAttr(el, 'aria-label', `${e.step ? `Step ${e.step}, ` : ''}${e.label || 'Arrow'}, from ${nameOf(nodeOrGroup(e.from))} to ${nameOf(nodeOrGroup(e.to))}`);
            setStyle(el, 'left', px(Math.round(b.x + b.w / 2)));
            setStyle(el, 'top', px(Math.round(b.y + b.h / 2)));
            setStyle(el, 'transformOrigin', '');
            const title = edgeTitle(e);
            if (el.title !== title) el.title = title;
            const sig = JSON.stringify([e.label || '', e.count, e.tech || '', showTech(), direct]);
            if (st.sig !== sig) {
              st.sig = sig;
              const kids = [htmlEl('span', 'c4-label-text', `${e.label || ''}${e.count > 1 ? ` ×${e.count}` : ''}`)];
              if (showTech()) {
                if (e.tech) kids.push(htmlEl('span', 'c4-label-tech', `[${e.tech}]`));
                else if (direct) {   // a press opens the field (ITEM EVENTS)
                  const ph = htmlEl('span', 'c4-placeholder c4-label-tech-ph', '');
                  ph.dataset.exportSkip = '';
                  ph.dataset.field = 'tech';
                  ph.dataset.ph = '+ tech';
                  ph.title = 'Add technology (e.g. REST, gRPC, SQL)';
                  kids.push(ph);
                }
              }
              el.replaceChildren(...kids);
            }
            order.push(el);
          } else rec.label = null;
          if (showSteps() && e.step && e.badge) {
            let sb = rec.badge, st = sb && itemState.get(sb);
            if (!sb) {
              sb = htmlEl('div', 'c4-step');
              sb.dataset.edgeId = e.id;
              st = { sig: null, paint: null };
              itemState.set(sb, st);
              rec.badge = sb;
            }
            setCls(sb, `c4-step${tint ? ' is-colored swatch-scope' : ''}`);
            setPaint(sb, st, tint);
            if (sb.textContent !== String(e.step)) sb.textContent = e.step;
            setAttr(sb, 'aria-label', `Step ${e.step}: ${e.label || ''}`);
            const title = edgeTitle(e);
            if (sb.title !== title) sb.title = title;
            setStyle(sb, 'left', px(Math.round(e.badge.x + e.badge.w / 2)));
            setStyle(sb, 'top', px(Math.round(e.badge.y + e.badge.h / 2)));
            setStyle(sb, 'transformOrigin', '');
            order.push(sb);
          } else rec.badge = null;
        });
      }

      // --- ITEM EVENTS ---
      // One listener per event and layer (the html layer: tiles, frames, labels, step badges; the svg layer: arrows),
      // dispatching by data-node-id / data-group-id / data-edge-id. They run in the order the per-element listeners did,
      // innermost first: a note pin or chevron keeps the press to itself, a placeholder opens its field, a port starts a
      // connection, anything else is a press on its box. pointerenter / pointerleave do not bubble: they are caught on the
      // way down (capture) and handled only when they are aimed at the box itself, as on the box.
      function itemAt(t) {   // the kept box, label or badge an event target belongs to: { el, kind, id } or null
        const el = t && t.closest ? t.closest('.c4-node, .c4-group, .c4-label, .c4-step') : null;
        if (!el || !html.contains(el)) return null;
        if (el.dataset.nodeId) return els.nodes.get(el.dataset.nodeId) === el ? { el, kind: 'element', id: el.dataset.nodeId } : null;
        if (el.dataset.groupId) return els.groups.get(el.dataset.groupId) === el ? { el, kind: 'group', id: el.dataset.groupId } : null;
        const rec = els.edges.get(el.dataset.edgeId);
        return rec && (rec.label === el || rec.badge === el) ? { el, kind: 'edge', id: el.dataset.edgeId } : null;
      }
      const edgeAt = (t) => {
        const g = t && t.closest ? t.closest('.c4-edge') : null, rec = g && els.edges.get(g.dataset.edgeId);
        return rec && rec.g === g ? g.dataset.edgeId : null;
      };
      html.addEventListener('pointerdown', (ev) => {
        const it = itemAt(ev.target);
        if (!it) return;
        const t = ev.target;
        if (t.closest('.c4-note-pin, .chevron')) { ev.stopPropagation(); return; }
        const ph = t.closest('.c4-placeholder');
        if (ph && ev.button === 0 && !presenting()) {
          ev.preventDefault();
          ev.stopPropagation();
          if (isTyping()) document.activeElement.blur();
          if (it.kind === 'edge') editEdgeField(it.id, 'tech'); else editField(it.id, ph.dataset.field);
          return;
        }
        if (it.kind === 'element' && t.closest('.port') && ev.button === 0 && !presenting()) { startConnectDrag(ev, it.id); return; }
        if (it.kind === 'group' && !it.el.classList.contains('is-tile') && !t.closest('.frame-tag')) return;   // a frame takes presses on its tag only
        press(ev, { kind: it.kind, id: it.id });
      });
      html.addEventListener('click', (ev) => {
        const it = itemAt(ev.target);
        if (!it) return;
        const pin = ev.target.closest('.c4-note-pin'), chev = !pin && it.kind === 'group' && ev.target.closest('.chevron');
        if (pin) { ev.stopPropagation(); const id = pinNoteOf(it.kind, it.id); setShowNotes(true); if (id) selectNote(id); }
        else if (chev) { ev.stopPropagation(); toggleGroup(it.id); }
      });
      html.addEventListener('pointerenter', (ev) => {
        const it = itemAt(ev.target);
        if (!it || it.el !== ev.target) return;
        if (it.kind === 'edge') { hoverEdgeId = it.id; applyState(); }
        else if ((it.kind === 'element' || it.el.classList.contains('is-tile')) && ev.pointerType !== 'touch' && !(mv && mv.moved)) { hoverId = it.id; applyState(); }   // no hover dimming while boxes are carried
      }, true);
      html.addEventListener('pointerleave', (ev) => {
        const it = itemAt(ev.target);
        if (!it || it.el !== ev.target) return;
        if (it.kind === 'edge') { if (hoverEdgeId === it.id) { hoverEdgeId = null; applyState(); } }
        else if ((it.kind === 'element' || it.el.classList.contains('is-tile')) && hoverId === it.id) { hoverId = null; applyState(); }
      }, true);
      edgesG.addEventListener('pointerdown', (ev) => { const id = edgeAt(ev.target); if (id) press(ev, { kind: 'edge', id }); });
      edgesG.addEventListener('pointerenter', (ev) => {
        const id = edgeAt(ev.target);
        if (id && ev.target === els.edges.get(id).g) { hoverEdgeId = id; applyState(); }
      }, true);
      edgesG.addEventListener('pointerleave', (ev) => {
        const id = edgeAt(ev.target);
        if (id && ev.target === els.edges.get(id).g && hoverEdgeId === id) { hoverEdgeId = null; applyState(); }
      }, true);

      // The colour key: the palette slots groups, elements and relations use and what each means (colorKey); a slot with no label is left
      // out, except the one being named right now (keyDraft: the prompt "What does Blue mean?" after a colour was picked)
      let legendEl = null;
      function renderLegend() {
        const used = [], key = chartData.colorKey || {};
        groups().forEach((g) => { const c = swatchOf(g); if (c && swatchSlot(c) && !used.includes(c)) used.push(c); });
        elements().forEach((e) => {
          const c = swatchOf(e) || KIND_SLOT[e.kind] || (e.kind === 'external' ? '9' : null);
          if (c && swatchSlot(c) && !used.includes(c)) used.push(c);
        });
        relations().forEach((r) => { const c = swatchOf(r); if (c && swatchSlot(c) && !used.includes(c)) used.push(c); });
        const shown = used.filter((c) => key[c] || c === keyDraft);
        if (legendEl) legendEl.remove();
        legendEl = ui.colorKey(shown, key, { cls: 'c4-key', prompts: keyDraft !== null });
        if (legendEl) html.appendChild(legendEl);
      }
      function setKeyLabel(slot, value) {   // sets or clears one label; true when it changed
        const was = (chartData.colorKey && chartData.colorKey[slot]) || '';
        if (value === was) return false;
        if (value) (chartData.colorKey = chartData.colorKey || {})[slot] = value;
        else { delete chartData.colorKey[slot]; if (!Object.keys(chartData.colorKey).length) delete chartData.colorKey; }
        return true;
      }
      function editKey(slot) {
        const el = html.querySelector(`.color-key-label[data-color="${slot}"]`);
        if (!el || presenting()) { keyDraft = null; return; }
        const was = (chartData.colorKey && chartData.colorKey[slot]) || '';
        el.classList.remove('is-empty');
        beginEdit(el, {
          raw: was, restore: was, label: 'Colour key entry',
          apply: (v) => setKeyLabel(slot, optText(v, NAME_MAX)),
          settle: (changed) => { keyDraft = null; if (!changed) renderLegend(); }
        });
      }

      // --- SELECTION AND HOVER ---
      const inSel = (kind, id) => sel.some((s) => s.kind === kind && s.id === id);
      const selIds = (kind) => sel.filter((s) => s.kind === kind).map((s) => s.id);
      const primary = () => sel[sel.length - 1] || null;
      function setSel(list) {
        selNoteId = null;
        sel = list.filter(selectionExists);
        applyState();
      }
      function toggleSel(item) {
        setSel(inSel(item.kind, item.id) ? sel.filter((s) => !(s.kind === item.kind && s.id === item.id)) : sel.concat(item));
      }
      const select = (s) => setSel(s ? [s] : []);
      // What is lit: the arrows in (amber) and out (blue) of the hovered element, as the flowchart does; a lone selected element
      // lights its arrows too. Directly linked neighbor nodes/tiles highlight on hover without dimming unrelated items.
      function applyState() {
        const lone = sel.length === 1 && sel[0].kind !== 'edge' ? sel[0].id : null;
        const focusId = hoverId || lone;
        const near = new Set(focusId ? [focusId] : []);
        els.edges.forEach((rec, id) => {
          const e = edgeOf(id) || {};
          const out = !!focusId && e.from === focusId, inn = !!focusId && !out && e.to === focusId;
          if (out || inn) { near.add(e.from); near.add(e.to); }
          const isSel = inSel('edge', id), hov = hoverEdgeId === id && !isSel;
          const line = rec.line || rec.g.querySelector('.edge-line');
          [line, rec.label].forEach((x) => {
            if (!x) return;
            x.classList.toggle('hl-in', inn);
            x.classList.toggle('hl-out', out);
          });
          line.classList.toggle('selected', isSel);
          rec.g.classList.toggle('selected', isSel);
          rec.g.classList.toggle('hover', hov);
          if (rec.label) { rec.label.classList.toggle('selected', isSel); rec.label.classList.toggle('linked', hov); }
          if (rec.badge) { rec.badge.classList.toggle('selected', isSel); }
        });
        const tags = [...els.groups].filter(([, el]) => !el.classList.contains('is-tile')).map(([id, el]) => [id, el.querySelector('.frame-tag')]).filter(([, t]) => t);
        const items = [...els.nodes, ...[...els.groups].filter(([id]) => isTile(groupOf(id))), ...tags];
        const first = primary();
        items.forEach(([id, el]) => {
          const isNode = el.classList.contains('c4-node');
          if (isNode) el.classList.toggle('selected', inSel('element', id));
          if (isNode || el.classList.contains('is-tile')) el.classList.toggle('is-hover', !!hoverId && id !== hoverId && near.has(id));
          const ti = first && first.kind !== 'edge' && first.id === id ? '0' : '-1';
          if (el.getAttribute('tabindex') !== ti) el.setAttribute('tabindex', ti);   // written only when it changes: a write restyles the box
        });
        if (!(first && first.kind !== 'edge') && items.length) items[0][1].setAttribute('tabindex', '0');
        els.groups.forEach((el, id) => {
          el.classList.toggle('selected', inSel('group', id));
          const t = el.querySelector('.frame-tag');
          if (t) t.classList.toggle('selected', inSel('group', id));
        });
        canvas.classList.toggle('is-multi', sel.length > 1);
        applyNoteSelection();
        drawBar();
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }

      // --- COLLAPSE, EXPAND AND LEVELS ---
      // One path for a chevron and for the Level control: set `collapsed` on some groups, route, and morph. A group that opens
      // morphs from its box into the frame (morphRect) and its contents grow out of that box (fromKey); a group that closes
      // morphs the other way and its contents shrink into the new box (toKey). Reduced motion jumps to the end state.
      function setCollapsed(changes, opts) {
        changes = new Map([...changes].filter(([id, v]) => groupOf(id) && (groupOf(id).collapsed === true) !== v));
        if (!changes.size) return;
        const useMotion = motion.enabled() && html.childElementCount > 0;
        motion.cancelAll();
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null;
        const prevEdges = useMotion ? captureEdges() : null;
        const fromKey = {}, toKey = {};
        [...changes].sort((a, b) => depthOf(groupOf(a[0])) - depthOf(groupOf(b[0]))).forEach(([id, v]) => {   // the outermost group claims what is inside it
          const inside = descendants(groupOf(id)), m = v ? toKey : fromKey;
          inside.forEach((d) => { if (!(d in m) && !(d in fromKey) && !(d in toKey)) m[d] = id; });
          notesList().forEach((n) => { if (noteTargets(n).some((t) => inside.includes(t.id)) && !(n.id in fromKey) && !(n.id in toKey)) m[n.id] = id; });   // a note on a member folds into the tile too
        });
        const prev = new Map();
        if (snap) changes.forEach((v, id) => { const r = snap._raw.get(id); if (r) prev.set(id, r.vr); });
        changes.forEach((v, id) => { groupOf(id).collapsed = v; });
        if (!manualMode()) layoutDiagram(chartData);
        render({
          snap, prevEdges, fromKey, toKey, duration: 220,
          afterPlay: () => prev.forEach((rect, id) => { const el = els.groups.get(id); if (el) motion.morphRect(rect, el, { duration: 220, easing: 'curve-spring-settle' }); })
        });
        if (!(opts && opts.silent) && !presenting()) updateStatus(true);
      }
      function toggleGroup(id) { const g = groupOf(id); if (g) setCollapsed(new Map([[id, g.collapsed !== true]])); }

      // LEVEL: "show to depth N". Level 1 collapses every collapsible system/container group (leaving outer ownership boundaries open);
      // Level 2 opens them to their containers and also reopens any group collapsed manually via its chevron. Saved model keeps `collapsed` per group.
      function levelsWanted(n) {
        const m = new Map();
        groups().forEach((g) => {
          if (isCollapsibleGroup(g)) m.set(g.id, levelOf(g) >= n);
          else if (n >= 2 && g.collapsed === true) m.set(g.id, false);
        });
        return m;
      }
      function currentLevel() {
        const targets = groups().filter(isCollapsibleGroup);
        const anyCollapsed = groups().some((g) => g.collapsed === true);
        if (!targets.length && !anyCollapsed) return null;
        const nonTargetsCollapsed = groups().some((g) => !isCollapsibleGroup(g) && g.collapsed === true);
        for (const b of levelBtns) {
          const n = +b.dataset.level;
          if (n === 1 && !targets.length) continue;
          if (n >= 2 && nonTargetsCollapsed) continue;
          const want = levelsWanted(n);
          if (want.size && [...want].every(([id, v]) => (groupOf(id).collapsed === true) === v)) return n;
        }
        return null;
      }
      function updateLevelButtons() {
        const targets = groups().filter(isCollapsibleGroup);
        const anyCollapsed = groups().some((g) => g.collapsed === true);
        const disabled = !targets.length && !anyCollapsed;
        const n = currentLevel();
        if (btnLevel) {
          btnLevel.disabled = disabled;
          if (disabled && levelWrap && levelWrap.classList.contains('open')) {
            levelWrap.classList.remove('open');
            btnLevel.setAttribute('aria-expanded', 'false');
          }
          const count = btnLevel.querySelector('.btn-count');
          if (count) {
            count.textContent = !disabled && n ? `L${n}` : '';
            count.hidden = disabled || !n;
          }
          const desc = n === 1 ? 'Level 1, system context' : n === 2 ? 'Level 2, containers' : 'mixed';
          btnLevel.title = disabled
            ? 'No expandable systems yet: add a group with containers to switch levels'
            : `Level: ${desc}`;
          btnLevel.setAttribute('aria-label', disabled ? 'Level (unavailable)' : n ? `Level: L${n}` : 'Level');
        }
        levelBtns.forEach((b) => {
          const lv = +b.dataset.level;
          b.setAttribute('aria-checked', String(!disabled && lv === n));
          b.disabled = disabled || (lv === 1 && !targets.length);
        });
      }
      levelBtns.forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        setCollapsed(levelsWanted(+b.dataset.level), { silent: true });
      }));

      // =====================================================================================================
      // --- EDITING ---
      // =====================================================================================================
      // The one way an edit ends: Auto-Tidy (layoutDiagram drops every position and places everything afresh), the morph from
      // the old geometry to the new (render plays it), and one updateStatus(true) = one undo step. relayout false: a change that
      // moves nothing (colour, icon), only drawn again. mo: motion options for render, or false for none.
      // Auto-Tidy lays everything out again (layoutDiagram); manual layout keeps what is placed (routeDiagram: only what is new
      // is placed, and what now overlaps is shifted away from the boxes in `pinned`).
      const manualMode = () => chartData._manual === true;
      const lay = (pinned) => (manualMode() ? routeDiagram(chartData, { pinned: pinned || [] }) : layoutDiagram(chartData));
      function commit(relayout, mo) {
        const useMotion = mo !== false && motion.enabled() && html.childElementCount > 0;
        const o = mo && typeof mo === 'object' ? Object.assign({}, mo) : {};
        if (useMotion) {
          motion.cancelAll();
          if (!o.snap) o.snap = motion.capture(canvas, FLIP_SPECS, o.captureOpts);
          if (!o.prevEdges) o.prevEdges = captureEdges();
        }
        if (relayout !== false) lay();
        render(mo === false ? false : o);
        updateStatus(true);
      }

      // --- Menus and popovers: one floating box at a time, under their button; Esc, a press elsewhere or a pick closes it ---
      let floating = null;   // { el, onClose(why) }
      function closeFloating(why) {
        if (!floating) return false;
        const f = floating;
        floating = null;
        if (f.onClose) f.onClose(why || 'cancel');
        motion.ghostExit(f.el, { duration: 110, transform: 'scale(0.92, 0.86) translateY(-4px)', origin: 'top left' });
        f.el.remove();
        return true;
      }
      function openFloating(el, anchor, onClose) {
        closeFloating('replaced');
        el.dataset.exportSkip = '';
        document.body.appendChild(el);
        const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
        el.style.left = px(Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)));
        const below = r.bottom + 6 + el.offsetHeight < innerHeight - 8;
        el.style.top = px(below ? r.bottom + 6 : Math.max(8, r.top - 6 - el.offsetHeight));
        el.style.transformOrigin = below ? 'top left' : 'bottom left';
        motion.anim(el, [
          { transform: `scale(0.92, 0.86) translateY(${below ? -4 : 4}px)`, clipPath: below ? 'inset(0 0 25% 0 round 8px)' : 'inset(25% 0 0 0 round 8px)' },
          { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
        ], { duration: 130, easing: motion.curve('curve-spring-tactile') });
        floating = { el, onClose };
        return floating;
      }
      document.addEventListener('pointerdown', (e) => { if (floating && !floating.el.contains(e.target) && !e.target.closest('[data-menu]')) closeFloating('outside'); }, true);

      function openMenu(anchor, title, items, onPick) {
        const m = htmlEl('div', 'menu c4-menu');
        m.id = 'c4-menu';
        m.setAttribute('role', 'menu');
        m.setAttribute('aria-label', title);
        m.appendChild(htmlEl('div', 'menu-label', title)).setAttribute('role', 'presentation');
        items.forEach((it) => {
          const b = htmlEl('button', '', it.label);
          b.type = 'button';
          b.dataset.value = it.value;
          b.setAttribute('role', 'menuitem');
          if (it.selected) b.setAttribute('aria-current', 'true');
          b.addEventListener('click', (e) => { e.stopPropagation(); closeFloating('pick'); onPick(it.value); });
          m.appendChild(b);
        });
        m.addEventListener('keydown', (e) => {
          const bs = [...m.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFloating('cancel'); }
        });
        openFloating(m, anchor);
        const cur = m.querySelector('[aria-current]') || m.querySelector('button');
        if (cur) cur.focus();
      }

      // --- Inline text editing (double-click, ghost placeholder click, Enter / F2, or straight after creating something) ---
      // o: raw (text to edit), restore (text when unchanged), placeholder (empty hint), host (element toggled with .is-editing),
      // validate(value, why) -> 'ok' | 'keep' | 'drop', forceApply (apply even if value === original), apply(value) -> true when
      // model changed, onCancel(), onTab(dir), settle(changed), pending (an add whose undo step ends here), after().
      function beginEdit(el, o) {
        if (!el || el.isContentEditable) return;
        itemDirty(el.closest('.c4-node, .c4-group, .c4-label'));   // its box is built again on the next render, as before the edit
        const host = o.host || null;
        if (o.raw !== undefined) el.textContent = o.raw;
        if (o.placeholder) el.dataset.editPh = o.placeholder;
        el.classList.add('is-editing');
        if (host) host.classList.add('is-editing');
        el.contentEditable = 'plaintext-only';
        el.spellcheck = false;
        if (o.label) el.setAttribute('aria-label', o.label);
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        const original = el.textContent;
        let done = false;
        const cleanup = () => {
          el.removeEventListener('blur', onBlur);
          el.removeEventListener('keydown', onKey);
          el.contentEditable = 'false';
          el.classList.remove('is-editing');
          if (host) host.classList.remove('is-editing');
          delete el.dataset.editPh;
        };
        const finish = (why, tabDir) => {
          if (done) return;
          const value = el.textContent;
          if (why === 'cancel') {
            done = true;
            cleanup();
            if (o.onCancel) { o.onCancel(); return; }
            el.textContent = o.restore !== undefined ? o.restore : original;
            if (o.settle) o.settle(false);
            if (o.pending) updateStatus(true);
            if (o.after) o.after();
            return;
          }
          if (o.validate && (why === 'enter' || why === 'tab')) {
            const verdict = o.validate(value, why);
            if (verdict === 'keep') { el.focus(); return; }
            if (verdict === 'drop') { done = true; cleanup(); if (o.onCancel) o.onCancel(); return; }
          }
          done = true;
          cleanup();
          if (o.validate && why === 'blur') {
            const verdict = o.validate(value, why);
            if (verdict === 'keep' || verdict === 'drop') {
              if (o.onCancel) { o.onCancel(); return; }
              el.textContent = o.restore !== undefined ? o.restore : original;
              if (o.settle) o.settle(false);
              if (o.pending) updateStatus(true);
              return;
            }
          }
          const changed = (o.forceApply || value !== original) ? !!o.apply(value) : false;
          if (o.settle) o.settle(changed);
          if (changed) commit(true);
          else { el.textContent = o.restore !== undefined ? o.restore : original; if (o.pending) updateStatus(true); }
          if (why === 'tab' && o.onTab) { o.onTab(tabDir); return; }
          if (why === 'enter' && o.after) o.after();
        };
        const onBlur = () => finish('blur', 0);
        const onKey = (ke) => {
          if (ke.key === 'Enter' || ke.key === 'Tab' || ke.key === 'F2') ke.stopPropagation();
          if (ke.key === 'Enter') { ke.preventDefault(); finish('enter', 0); if (done) el.blur(); }
          else if (ke.key === 'Tab' && o.onTab) { ke.preventDefault(); finish('tab', ke.shiftKey ? -1 : 1); }
          else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); finish('cancel', 0); el.blur(); }
        };
        el.addEventListener('blur', onBlur);
        el.addEventListener('keydown', onKey);
      }
      function nameEl(kind, id) {
        if (kind === 'element') { const n = els.nodes.get(id); return n && n.querySelector('.c4-name'); }
        const g = els.groups.get(id);
        return g && (g.querySelector('.c4-tag-name') || g.querySelector('.c4-name'));
      }
      function editField(id, field, pending) {
        const o = elementOf(id), node = els.nodes.get(id);
        if (!o || !node || presenting()) return;
        const fields = showTech() ? ['name', 'tech', 'desc'] : ['name', 'desc'];
        if (!fields.includes(field)) field = 'name';
        const el = field === 'name'
          ? node.querySelector('.c4-name')
          : field === 'tech'
            ? (node.querySelector('.c4-tech') || node.querySelector('.c4-tech-ph'))
            : (node.querySelector('.c4-desc') || node.querySelector('.c4-desc-ph'));
        if (!el) return;
        const nextOf = (dir) => fields[(fields.indexOf(field) + dir + fields.length) % fields.length];
        const refocus = () => { const t = els.nodes.get(id); if (t) t.focus({ preventScroll: true }); };
        if (field === 'name') {
          beginEdit(el, {
            raw: nameOf(o), restore: nameOf(o), label: 'Element name', pending,
            after: refocus,
            onTab: (dir) => editField(id, nextOf(dir)),
            apply: (v) => {
              const t = askText(v, 'A name', NAME_MAX);
              if (t === null || t === nameOf(o)) return false;
              o.name = t;
              return true;
            }
          });
        } else if (field === 'tech') {
          beginEdit(el, {
            raw: o.tech || '', restore: o.tech ? `[${o.tech}]` : '', label: 'Technology', placeholder: 'Node.js, PostgreSQL ...',
            after: refocus,
            onTab: (dir) => editField(id, nextOf(dir)),
            apply: (v) => {
              const t = optText(v, TECH_MAX);
              if (t === (o.tech || '')) return false;
              setOpt(o, 'tech', t);
              return true;
            }
          });
        } else {
          beginEdit(el, {
            raw: o.description || '', restore: o.description || '', label: 'Description', placeholder: 'What it is or does',
            after: refocus,
            onTab: (dir) => editField(id, nextOf(dir)),
            apply: (v) => {
              const t = optText(v, DESC_MAX);
              if (t === (o.description || '')) return false;
              setOpt(o, 'description', t);
              return true;
            }
          });
        }
      }
      function editName(kind, id, pending) {
        if (kind === 'element') { editField(id, 'name', pending); return; }
        const o = groupOf(id), el = nameEl(kind, id);
        if (!o || !el) return;
        beginEdit(el, {
          raw: nameOf(o), pending,
          after: () => { const g = els.groups.get(id); const t = g && (g.querySelector('.frame-tag') || g); if (t) t.focus({ preventScroll: true }); },
          apply: (v) => {
            const t = askText(v, 'A name', NAME_MAX);
            if (t === null || t === nameOf(o)) return false;
            o.name = t;
            return true;
          }
        });
      }
      function editEdgeField(edgeId, field, opts) {
        const e = edgeOf(edgeId);
        if (!e || presenting()) return;
        const isNew = !!(opts && opts.isNew), newRel = opts && opts.newRel;
        if (!isNew && !isDirectEdge(e)) { ui.toast('This arrow merges several relations: open the group to edit them'); return; }
        const rec = els.edges.get(edgeId), lbl = rec && rec.label;
        const backKind = newRel && elementOf(newRel.from) ? 'element' : 'group';
        if (!lbl) { if (isNew && newRel) dropNewRelation(newRel, { kind: backKind, id: newRel.from }); return; }
        const members = isNew ? [newRel] : e.members.map((i) => relations()[i]).filter(Boolean);
        const back = isNew ? { kind: backKind, id: newRel.from } : null;
        const findEdgeId = () => {
          if (isNew && newRel) {
            const idx = relations().indexOf(newRel);
            const found = idx >= 0 && edges().find((x) => x.members.includes(idx));
            return found ? found.id : edgeId;
          }
          return edgeId;
        };
        const refocus = () => queueMicrotask(() => { const l = (els.edges.get(findEdgeId()) || {}).label; if (l) l.focus({ preventScroll: true }); });
        if (field === 'tech') {
          if (!showTech()) return;
          const el = lbl.querySelector('.c4-label-tech') || lbl.querySelector('.c4-label-tech-ph');
          if (!el) return;
          beginEdit(el, {
            raw: e.tech || '', restore: e.tech ? `[${e.tech}]` : '', label: 'Technology of the relation', placeholder: 'REST, gRPC, SQL ...', host: lbl,
            after: refocus,
            onTab: () => editEdgeField(edgeId, 'label'),
            apply: (v) => {
              const t = optText(v, TECH_MAX);
              if (t === (e.tech || '')) return false;
              members.forEach((r) => setOpt(r, 'tech', t));
              return true;
            }
          });
          return;
        }
        const el = lbl.querySelector('.c4-label-text');
        if (!el) return;
        beginEdit(el, {
          raw: isNew ? '' : (e.label || ''),
          restore: isNew ? '' : `${e.label || ''}${e.count > 1 ? ` ×${e.count}` : ''}`,
          label: 'Relation label',
          placeholder: 'Label...',
          host: lbl,
          forceApply: isNew,
          after: refocus,
          onCancel: () => { if (isNew && newRel) dropNewRelation(newRel, back); else { el.textContent = `${e.label || ''}${e.count > 1 ? ` ×${e.count}` : ''}`; refocus(); } },
          onTab: showTech() ? () => editEdgeField(findEdgeId(), 'tech') : undefined,
          validate: (v, why) => {
            if (isNew && why === 'blur' && !String(v || '').trim()) return 'drop';
            const label = askText(v, 'A label', LABEL_MAX);
            if (label === null) return 'keep';
            if (isNew) {
              if (relations().some((r) => sameRelation(r, Object.assign({}, newRel, { label })))) {
                ui.toast('That connection already exists with this label');
                return 'drop';
              }
              return 'ok';
            }
            if (label !== e.label && members.some((r) => relations().some((x) => !members.includes(x) && sameRelation(x, Object.assign({}, r, { label }))))) {
              ui.toast('That connection already exists with this label');
              return 'keep';
            }
            return 'ok';
          },
          apply: (v) => {
            const label = cleanText(v, 'A label', LABEL_MAX);
            if (isNew) {
              newRel.label = label;
              newLink = null;
              return true;
            }
            if (label === e.label) return false;
            members.forEach((r) => { r.label = label; });
            return true;
          }
        });
      }
      function editSelection() {
        const p = primary();
        if (!p || sel.length !== 1) return;
        if (p.kind === 'edge') editEdgeField(p.id, 'label');
        else editName(p.kind, p.id);
      }
      html.addEventListener('dblclick', (e) => {
        if (presenting()) return;
        const t = e.target;
        const kl = t.closest('.color-key-label');
        if (kl) { if (!kl.isContentEditable) { e.stopPropagation(); keyDraft = kl.dataset.color; editKey(kl.dataset.color); } return; }
        if (t.closest('.c4-actionbar, .chevron, .port') || t.isContentEditable) return;
        const lbl = t.closest('.c4-label');
        if (lbl) {
          e.stopPropagation();
          editEdgeField(lbl.dataset.edgeId, t.closest('.c4-label-tech, .c4-label-tech-ph') ? 'tech' : 'label');
          return;
        }
        const node = t.closest('.c4-node');
        if (node) {
          e.stopPropagation();
          const field = t.closest('.c4-tech, .c4-tech-ph') ? 'tech' : t.closest('.c4-desc, .c4-desc-ph') ? 'desc' : 'name';
          editField(node.dataset.nodeId, field);
          return;
        }
        const grp = t.closest('.c4-group');
        if (!grp) return;
        e.stopPropagation();
        const id = grp.dataset.groupId;
        if (!grp.classList.contains('is-tile') || t.closest('.c4-name')) editName('group', id); else toggleGroup(id);
      });

      // --- Add (the dock): a tile clicks or drags onto the canvas; one added while a group is selected (or dropped on one) joins it ---
      function addItem(kind, drop) {
        if (presenting()) return null;
        const isGroup = kind === 'group';
        if (!isGroup && !KINDS.includes(kind)) throw new RangeError(`unknown element kind "${kind}"`);
        if (isTyping()) document.activeElement.blur();
        motion.cancelAll();
        const p = primary();
        const host = drop ? (drop.hostId ? groupOf(drop.hostId) : null) : (sel.length === 1 && p.kind === 'group' ? groupOf(p.id) : null);
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS) : null, prevEdges = useMotion ? captureEdges() : null;
        const o = isGroup ? { id: newId('g'), name: 'New group', kind: 'system' } : { id: newId('e'), kind, name: DEFAULT_NAME[kind] };
        if (host) { host.collapsed = false; o[isGroup ? 'parent' : 'group'] = host.id; }
        if (isGroup) (chartData.groups = groups()).push(o); else (chartData.elements = elements()).push(o);
        let pinned = null;
        if (drop && !host && drop.pt) {
          const sz = isGroup ? { w: TOKENS.c4.emptyW, h: TOKENS.c4.emptyH } : c4Card(o.name, '');
          o.x = Math.max(0, Math.round(drop.pt.x - sz.w / 2));
          o.y = Math.max(0, Math.round(drop.pt.y - sz.h / 2));
          chartData._manual = true;
          pinned = [o.id];
          routeDiagram(chartData, { pinned });
        } else {
          lay();
        }
        sel = [{ kind: isGroup ? 'group' : 'element', id: o.id }];
        render({ snap, prevEdges, pinned, fromKey: host ? { [o.id]: host.id } : undefined, enterScale: 0.82, duration: 200 });
        editName(sel[0].kind, o.id, true);
        return o.id;
      }

      let paletteDrag = null;   // { kind, btn, startX, startY, pointerId, ghost, w, h, onCanvas, hostId, dropEl }
      function buildPaletteGhost(kind) {
        let el, w, h;
        if (kind === 'note') {
          el = htmlEl('div', 'note c4-ghost');
          el.appendChild(htmlEl('div', 'note-text', 'Note'));
          w = 160; h = 56;
        } else if (kind === 'group') {
          el = htmlEl('div', 'c4-group is-frame c4-ghost');
          const tag = htmlEl('div', 'frame-tag c4-tag');
          tag.appendChild(htmlEl('span', 'c4-tag-name', 'New group'));
          el.appendChild(tag);
          w = TOKENS.c4.emptyW; h = TOKENS.c4.emptyH;
          el.style.width = px(w); el.style.height = px(h);
        } else {
          const sz = c4Card(DEFAULT_NAME[kind], '');
          w = sz.w; h = sz.h;
          el = htmlEl('div', 'c4-node swatch-scope c4-ghost');
          el.dataset.kind = kind;
          el.style.width = px(w); el.style.height = px(h);
          setSwatch(el, KIND_SLOT[kind] || '9');
          const chip = htmlEl('span', 'c4-disc');
          chip.innerHTML = ui.icon(KIND_ICON[kind] || 'cloud', { size: 'tile', fine: true });
          const text = htmlEl('span', 'c4-text');
          text.appendChild(htmlEl('span', 'c4-name t-title', DEFAULT_NAME[kind]));
          el.append(chip, text);
        }
        document.body.appendChild(el);
        return { el, w, h };
      }
      function hostAtPoint(kind, x, y) {
        if (kind === 'note') return '';
        const height = kind === 'group' ? 1 : 0;
        const hit = groups().filter((g) => placed(g) && g.w > 0 && !hiddenGroup(g)
          && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h
          && depthOf(g) + height <= MAX_GROUP_DEPTH)
          .sort((a, b) => depthOf(b) - depthOf(a))[0];
        return hit ? hit.id : '';
      }
      function setPaletteDrop(pd, hostId) {
        const next = hostId ? els.groups.get(hostId) || null : null;
        if (pd.dropEl && pd.dropEl !== next) pd.dropEl.classList.remove('c4-drop');
        if (next) next.classList.add('c4-drop');
        pd.dropEl = next;
        pd.hostId = hostId || '';
      }
      function startPaletteDrag(e, kind, btn) {
        delete btn.dataset.dragged;
        if (e.button !== 0 || btn.disabled || presenting() || paletteDrag) return;
        paletteDrag = { kind, btn, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, ghost: null, w: 0, h: 0, onCanvas: false, hostId: '', dropEl: null };
        window.addEventListener('pointermove', onPaletteMove);
        window.addEventListener('pointerup', onPaletteUp);
        window.addEventListener('pointercancel', cancelPaletteDrag);
      }
      function onPaletteMove(e) {
        const pd = paletteDrag;
        if (!pd || e.pointerId !== pd.pointerId) return;
        if (!pd.ghost) {
          if (Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY) < 4) return;
          const wrap = pd.btn.closest('.dock-pop-wrap');
          if (wrap) {
            wrap.classList.remove('open');
            const trig = wrap.querySelector('.dock-pop-trigger');
            if (trig) trig.setAttribute('aria-expanded', 'false');
          }
          document.body.classList.add('palette-dragging');
          const built = buildPaletteGhost(pd.kind);
          pd.ghost = built.el;
          pd.w = built.w;
          pd.h = built.h;
        }
        pd.ghost.style.transform = `scale(${scale})`;
        pd.ghost.style.left = `${e.clientX - (pd.w * scale) / 2}px`;
        pd.ghost.style.top = `${e.clientY - (pd.h * scale) / 2}px`;
        const under = document.elementFromPoint(e.clientX, e.clientY);
        pd.onCanvas = !!under && viewport.contains(under) && !under.closest('.dock-area');
        pd.ghost.classList.toggle('off-target', !pd.onCanvas);
        if (pd.onCanvas && pd.kind !== 'note') {
          const pt = canvasPoint(e);
          setPaletteDrop(pd, hostAtPoint(pd.kind, pt.x, pt.y));
        } else {
          setPaletteDrop(pd, '');
        }
      }
      function endPaletteDrag() {
        window.removeEventListener('pointermove', onPaletteMove);
        window.removeEventListener('pointerup', onPaletteUp);
        window.removeEventListener('pointercancel', cancelPaletteDrag);
        const pd = paletteDrag;
        paletteDrag = null;
        if (pd) {
          if (pd.dropEl) pd.dropEl.classList.remove('c4-drop');
          if (pd.ghost) pd.ghost.remove();
        }
        document.body.classList.remove('palette-dragging');
        return pd;
      }
      function onPaletteUp(e) {
        if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
        const pd = endPaletteDrag();
        const dragged = !!(pd && pd.ghost);
        if (dragged) pd.btn.dataset.dragged = '1';
        if (!dragged || !pd.onCanvas) return;
        const pt = canvasPoint(e);
        if (pd.kind === 'note') {
          addFreeNoteAt({ x: Math.max(0, Math.round(pt.x - pd.w / 2)), y: Math.max(0, Math.round(pt.y - pd.h / 2)) });
        } else {
          addItem(pd.kind, { pt, hostId: pd.hostId });
        }
      }
      function cancelPaletteDrag() {
        const pd = endPaletteDrag();
        if (pd && !pd.ghost) delete pd.btn.dataset.dragged;
        return !!(pd && pd.ghost);
      }

      [...KINDS, 'group'].forEach((k) => {
        const b = document.getElementById(`btn-add-${k}`);
        if (!b) return;
        // A keyboard or tap pick hands the focus back to the Add button right after this click: open the name a tick later then
        b.addEventListener('click', (e) => {
          if (b.dataset.dragged) { delete b.dataset.dragged; e.preventDefault(); return; }
          if (e.detail === 0) setTimeout(() => addItem(k), 0); else addItem(k);
        });
        b.addEventListener('pointerdown', (e) => startPaletteDrag(e, k, b));
      });

      // --- Connect: drag from a port onto another element or group ---
      function nodeIdAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const node = el.closest('.c4-node');
        if (node) return { id: node.dataset.nodeId, kind: 'element' };
        const grp = el.closest('.c4-group.is-tile') || (el.closest('.frame-tag') && el.closest('.c4-group'));
        if (grp) return { id: grp.dataset.groupId, kind: 'group' };
        return null;
      }
      function startConnectDrag(ev, fromId) {
        ev.preventDefault();
        ev.stopPropagation();
        if (isTyping()) document.activeElement.blur();
        endDrag();
        setSel([{ kind: elementOf(fromId) ? 'element' : 'group', id: fromId }]);
        drag = { from: fromId, x: ev.clientX, y: ev.clientY, moved: false };
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp);
        window.addEventListener('pointercancel', cancelDrag);
      }
      function onDragMove(e) {
        const d = drag, src = d && nodeOrGroup(d.from);
        if (!d || !src) return;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        if (!d.moved) { d.moved = true; document.body.classList.add('c4-dragging', 'is-dragging'); hoverId = null; applyState(); }
        const pt = canvasPoint(e);
        rubber.setAttribute('x1', src.x + src.w / 2); rubber.setAttribute('y1', src.y + src.h / 2);
        rubber.setAttribute('x2', pt.x); rubber.setAttribute('y2', pt.y);
        rubber.style.display = 'block';
        canvas.querySelectorAll('.c4-target').forEach((el) => el.classList.remove('c4-target'));
        const hit = nodeIdAt(e.clientX, e.clientY);
        if (hit && !isAncestorOrSelf(d.from, hit.id)) {
          const targetEl = hit.kind === 'group' ? els.groups.get(hit.id) : els.nodes.get(hit.id);
          if (targetEl) targetEl.classList.add('c4-target');
        }
      }
      function endDrag() {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        window.removeEventListener('pointercancel', cancelDrag);
        document.body.classList.remove('c4-dragging', 'is-dragging');
        rubber.style.display = 'none';
        canvas.querySelectorAll('.c4-target').forEach((el) => el.classList.remove('c4-target'));
        const d = drag;
        drag = null;
        return d;
      }
      function onDragUp(e) {
        const hit = drag && drag.moved ? nodeIdAt(e.clientX, e.clientY) : null;   // before the bar comes back: it may sit over the target
        const d = endDrag();
        if (!d || !d.moved) return;
        if (!hit) return;
        connectItems(d.from, hit.id);
      }
      function cancelDrag() { return !!endDrag(); }
      // The new arrow appears at once (laid out, drawn in) and opens inline label editing; the connection is one undo step with the label,
      // and Esc on the label (or blurring while empty) takes the whole connection back.
      function connectItems(fromId, toId) {
        if (!nodeOrGroup(fromId) || !nodeOrGroup(toId)) throw new RangeError('connectItems: both ends must be elements or groups');
        if (fromId === toId) { ui.toast('An item cannot connect to itself'); return false; }
        if (isAncestorOrSelf(fromId, toId)) { ui.toast('A group cannot connect to an item inside it'); return false; }
        if (isTyping()) document.activeElement.blur();
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS) : null, prevEdges = useMotion ? captureEdges() : null;
        const rel = { from: fromId, to: toId, label: '' };
        (chartData.relations = relations()).push(rel);
        lay();
        const index = relations().indexOf(rel);
        const e = edges().find((x) => x.members.includes(index));
        sel = e ? [{ kind: 'edge', id: e.id }] : [];
        newLink = rel;   // no action bar over the arrow while its label is edited
        render({ snap, prevEdges, duration: 200 });
        if (e) editEdgeField(e.id, 'label', { isNew: true, newRel: rel }); else newLink = null;
        return true;
      }
      const sameRelation = (a, b) => a !== b && a.from === b.from && a.to === b.to && String(a.label) === String(b.label);
      function dropNewRelation(rel, back) {
        newLink = null;
        motion.cancelAll();
        const snap = motion.enabled() && html.childElementCount > 0 ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null;
        const prevEdges = snap ? captureEdges() : null;
        chartData.relations = relations().filter((r) => r !== rel);
        lay();
        sel = back ? [back] : [];
        render({ snap, prevEdges, ghostExit: true, duration: 180 });
        // nothing was committed: the model is what the last step left, so this makes no undo step
      }

      // --- Delete ---
      function dropNoteRefs(gone) {   // a note loses the elements and groups that went; one left with none goes
        if (!Array.isArray(chartData.notes)) return;
        chartData.notes = chartData.notes.filter((n) => {
          let had = 0, left = 0;
          ['elements', 'groups'].forEach((k) => { if (Array.isArray(n[k])) { had += n[k].length; n[k] = n[k].filter((x) => !gone.has(x)); left += n[k].length; if (!n[k].length) delete n[k]; } });
          return !had || left;
        });
        if (!chartData.notes.length) delete chartData.notes;
      }
      function pruneSpanRefs(gone) {
        groups().forEach((g) => {
          if (!Array.isArray(g.span)) return;
          g.span = g.span.filter((id) => !gone.has(id));
          if (!g.span.length) delete g.span;
        });
      }
      // What a selection removes: the selected elements and groups (a group takes everything inside it) and the relations
      // that touch a removed element or group, or that a selected arrow stands for
      function removal() {
        const gids = new Set(selIds('group')), eids = new Set(selIds('element'));
        selIds('group').forEach((id) => descendants(groupOf(id)).forEach((d) => { if (groupOf(d)) gids.add(d); else eids.add(d); }));
        const rels = new Set();
        selIds('edge').forEach((id) => { const e = edgeOf(id); if (e) e.members.forEach((i) => rels.add(relations()[i])); });
        relations().forEach((r) => { if (eids.has(r.from) || eids.has(r.to) || gids.has(r.from) || gids.has(r.to)) rels.add(r); });
        return { gids, eids, rels };
      }
      function removeAll({ gids, eids, rels }) {
        chartData.elements = elements().filter((e) => !eids.has(e.id));
        chartData.groups = groups().filter((g) => !gids.has(g.id));
        chartData.relations = relations().filter((r) => !rels.has(r));
        pruneSpanRefs(gids);
        dropNoteRefs(new Set([...gids, ...eids]));
        sel = [];
        commit(true, { captureOpts: { ghosts: true }, ghostExit: true, duration: 200 });
      }
      function deleteSelection(anchorEl) {
        if (presenting()) return;
        if (selNoteId) { removeNote(selNoteId); return; }
        if (!sel.length) return;
        const r = removal(), full = selIds('group').filter((id) => descendants(groupOf(id)).length);
        if (!full.length) { removeAll(r); return; }
        const inside = r.eids.size - selIds('element').length, name = full.length === 1 ? nameOf(groupOf(full[0])) : `${full.length} groups`;
        const what = inside ? ` and its ${inside} element${inside === 1 ? '' : 's'}` : '';
        ui.confirm(anchorEl || els.groups.get(full[0]), { message: `Delete ${name}${what}?`, label: 'Delete group' }, () => removeAll(removal()));
      }
      function ungroup(id) {
        const g = groupOf(id);
        if (!g) return;
        elements().forEach((e) => { if (e.group === id) setOpt(e, 'group', g.parent || ''); });
        groups().forEach((x) => { if (x.parent === id) setOpt(x, 'parent', g.parent || ''); });
        chartData.groups = groups().filter((x) => x !== g);
        chartData.relations = relations().filter((r) => r.from !== id && r.to !== id);
        pruneSpanRefs(new Set([id]));
        dropNoteRefs(new Set([id]));
        sel = [];
        commit(true);
      }

      // --- NOTES ---
      // chartData.notes: { id, text, elements?: [ids], groups?: [ids] } (the codec's shape). A card sits beside the first of its
      // targets that is on screen: a note on a member of a collapsed group is hidden, one on the collapsed tile stays. Where it
      // sits is never saved: placeNotes fits it into a free spot on every render, so one model always gives one picture and a
      // card follows its target through Auto-Tidy and collapse (it is part of the morph: FLIP_SPECS). The Notes switch
      // (showNotes) shows every card; a note being typed in is shown whatever the switch says. One note per target: adding to an
      // item that has one edits it.
      const NOTE_GAP = 8, NOTE_MIN_GAP = 10, NOTE_IDEAL_GAP = 20, NOTE_REACH = 160, NOTE_STEP = 8;
      const btnNotes = document.getElementById('btn-notes');
      const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
      const noteOf = (id) => notesList().find((n) => n.id === id);
      const noteText = (n) => (n && typeof n.text === 'string' ? n.text.trim() : '');
      const noteTargets = (n) => (n.elements || []).map((id) => ({ kind: 'element', id })).concat((n.groups || []).map((id) => ({ kind: 'group', id })));
      const isFreeNote = (n) => !!n && !noteTargets(n).length && !!n.pos && typeof n.pos.x === 'number' && typeof n.pos.y === 'number';
      const targetEl = (t) => (t.kind === 'element' ? els.nodes : els.groups).get(t.id);
      const noteAnchor = (n) => noteTargets(n).find(targetEl);
      const noteShown = (n) => (isFreeNote(n) || !!noteAnchor(n)) && (n.id === noteCtl.editingId() || (!!noteText(n) && chartData.showNotes === true));
      const noteCard = (id) => notesLayer && [...notesLayer.children].find((c) => c.dataset.noteId === id);
      const noteNames = (n) => noteTargets(n).map((t) => nameOf(t.kind === 'element' ? elementOf(t.id) : groupOf(t.id))).join(', ');

      function renderNotes() {
        notesLayer = null;
        const live = notesList().filter(noteShown);
        if (selNoteId && !live.some((n) => n.id === selNoteId)) selNoteId = null;
        if (!live.length) return;
        notesLayer = htmlEl('div', 'note-layer');
        notesLayer.id = 'c4-notes';
        live.forEach((n) => notesLayer.appendChild(buildNoteCard(n)));
        html.appendChild(notesLayer);
        placeNotes();
      }
      function buildNoteCard(n) {
        const edit = !presenting();
        const { card, text } = ui.noteCard(n, edit ? { onDelete: () => removeNote(n.id), onCommit: (el) => commitNote(n, el), onInput: placeNotes } : {});
        card.classList.add('show');
        card.tabIndex = 0;
        card.setAttribute('role', 'note');
        const names = noteNames(n);
        card.setAttribute('aria-label', names ? `Note on ${names}: ${noteText(n) || 'empty'}` : `Note: ${noteText(n) || 'empty'}`);
        if (edit) text.addEventListener('blur', () => commitNote(n, text));
        card.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0 || ev.target.isContentEditable) return;
          ev.stopPropagation();
          if (edit) selectNote(n.id);
        });
        card.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editNote(n.id); });
        card.addEventListener('keydown', (ev) => {
          if (ev.target !== card || !edit) return;
          if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); ev.stopPropagation(); editNote(n.id); }
          else if (ev.key === 'Delete' || ev.key === 'Backspace') selectNote(n.id);   // the shell's Delete handler then removes it
        });
        return card;
      }

      // Fit every card into a free spot beside its target: the nearest one (about NOTE_IDEAL_GAP away) that overlaps no tile,
      // frame tag, label pill, earlier card or, as a second choice, arrow. Candidates are tried on a NOTE_STEP grid in a fixed
      // order, and only the obstacles near the target are looked at, so the cost does not grow with the size of the diagram.
      function placeNotes() {
        if (!notesLayer) return;
        const C = chartData.canvas || { width: 0, height: 0 };
        const boxes = [], segs = [];
        els.nodes.forEach((el, id) => boxes.push(boxOf(elementOf(id))));
        els.groups.forEach((el, id) => {
          const g = groupOf(id), tag = el.querySelector('.frame-tag');
          if (el.classList.contains('is-tile')) boxes.push(boxOf(g));
          else if (tag) boxes.push({ x: g.x + tag.offsetLeft, y: g.y + tag.offsetTop, w: tag.offsetWidth, h: tag.offsetHeight });
        });
        edges().forEach((e) => {
          if (e.labelBox) boxes.push(e.labelBox);
          const p = e.points || [];
          for (let i = 1; i < p.length; i++) segs.push({ x: Math.min(p[i - 1][0], p[i][0]), y: Math.min(p[i - 1][1], p[i][1]), w: Math.abs(p[i][0] - p[i - 1][0]), h: Math.abs(p[i][1] - p[i - 1][1]) });
        });
        const cards = [...notesLayer.children];
        const sizes = cards.map((c) => ({ w: c.offsetWidth, h: c.offsetHeight }));
        cards.forEach((card, i) => {
          const n = noteOf(card.dataset.noteId);
          if (isFreeNote(n)) {
            const b = { x: Math.round(n.pos.x), y: Math.round(n.pos.y), w: sizes[i].w, h: sizes[i].h };
            boxes.push(b);
            card.style.left = px(b.x);
            card.style.top = px(b.y);
            return;
          }
          const t = noteAnchor(n);
          const b = fitNote(boxOf(t.kind === 'element' ? elementOf(t.id) : groupOf(t.id)), sizes[i], boxes, segs, C);
          boxes.push(b);   // a placed card is an obstacle for the next
          card.style.left = px(b.x);
          card.style.top = px(b.y);
        });
      }
      const boxHit = (b, o, g) => b.x < o.x + o.w + g && b.x + b.w + g > o.x && b.y < o.y + o.h + g && b.y + b.h + g > o.y;
      function fitNote(a, s, boxes, segs, C) {
        const win = { x: a.x - s.w - NOTE_REACH, y: a.y - s.h - NOTE_REACH, w: a.w + 2 * s.w + 2 * NOTE_REACH, h: a.h + 2 * s.h + 2 * NOTE_REACH };
        const nearBoxes = boxes.filter((o) => boxHit(win, o, NOTE_GAP)), nearSegs = segs.filter((o) => boxHit(win, o, 3));
        let best = null;
        for (let y = Math.round(win.y); y <= a.y + a.h + NOTE_REACH; y += NOTE_STEP) {
          for (let x = Math.round(win.x); x <= a.x + a.w + NOTE_REACH; x += NOTE_STEP) {
            const b = { x, y, w: s.w, h: s.h };
            const gap = Math.hypot(Math.max(0, a.x - (x + s.w), x - (a.x + a.w)), Math.max(0, a.y - (y + s.h), y - (a.y + a.h)));
            if (gap < NOTE_MIN_GAP) continue;
            let cost = Math.abs(gap - NOTE_IDEAL_GAP) * 10 + Math.hypot(x + s.w / 2 - a.x - a.w / 2, y + s.h / 2 - a.y - a.h / 2) / 2;   // the nearest side, then the one it faces squarely
            if (best && cost >= best.cost) continue;
            if (x < 0 || y < 0 || x + s.w > C.width || y + s.h > C.height) cost += 150;   // outside the canvas is allowed (contentOverflow grows it) but costs a little
            if (nearBoxes.some((o) => boxHit(b, o, NOTE_GAP))) cost += 1e5;
            else if (nearSegs.some((o) => boxHit(b, o, 3))) cost += 2e4;
            if (!best || cost < best.cost) best = { x, y, cost };
          }
        }
        return { x: best.x, y: best.y, w: s.w, h: s.h };
      }
      function selectNote(id) { setSel([]); selNoteId = id; applyNoteSelection(); }
      function applyNoteSelection() {
        canvas.querySelectorAll('.note-linked').forEach((el) => el.classList.remove('note-linked'));
        if (!notesLayer) return;
        [...notesLayer.children].forEach((c) => c.classList.toggle('selected', c.dataset.noteId === selNoteId));
        const n = noteOf(selNoteId);
        if (n) noteTargets(n).forEach((t) => { const el = targetEl(t); if (el) el.classList.add('note-linked'); });   // what the selected note explains
      }

      // The Notes switch: every card grows out of the box it explains, or folds back into it. A note is never a step of its own
      // while being typed in: the add and its text are one step (commitNote).
      function noteKeys() { const m = {}; notesList().forEach((n) => { const a = noteAnchor(n); if (a) m[n.id] = a.id; }); return m; }
      function setShowNotes(on) {
        if ((chartData.showNotes === true) === on) return;
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0, keys = noteKeys();
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null;
        if (on) chartData.showNotes = true; else delete chartData.showNotes;
        render({ snap, fromKey: keys, toKey: keys, duration: 170 });
        if (!presenting()) updateStatus(true);
      }
      if (btnNotes) btnNotes.addEventListener('click', () => setShowNotes(chartData.showNotes !== true));
      function updateNotesButton() {
        if (!btnNotes) return;
        const count = notesList().filter(noteText).length, on = chartData.showNotes === true;
        btnNotes.setAttribute('aria-checked', String(on));
        btnNotes.disabled = !count && !on;
        const c = btnNotes.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        btnNotes.title = !count ? 'No notes yet: select an element, group or arrow and add a Note from the Add tiles' : on ? 'Hide all notes' : 'Show all notes';
      }

      // --- LAYERS DIRECTION & STEPS TOOLBAR ---
      function setLayerDirection(dir) {
        if (presenting() || chartData.arrange !== 'layers') return;
        const next = dir === 'vertical' ? 'vertical' : 'horizontal';
        const cur = chartData.layerDirection === 'vertical' ? 'vertical' : 'horizontal';
        if (cur === next) return;
        if (next === 'vertical') chartData.layerDirection = 'vertical';
        else delete chartData.layerDirection;
        delete chartData._manual;
        commit(true);
      }
      if (btnLayerDir) btnLayerDir.addEventListener('click', () => setLayerDirection(chartData.layerDirection === 'vertical' ? 'horizontal' : 'vertical'));
      function updateLayerDirButton() {
        const isLayers = chartData.arrange === 'layers';
        layerDirEls.forEach((el) => { el.hidden = !isLayers; });
        if (!btnLayerDir || !isLayers) return;
        const vert = chartData.layerDirection === 'vertical';
        const lbl = btnLayerDir.querySelector('.btn-label');
        const ic = btnLayerDir.querySelector('.c4-dir-icon');
        if (lbl) lbl.textContent = vert ? 'Columns' : 'Bands';
        if (ic) ic.innerHTML = ui.icon(vert ? 'direction-lr' : 'direction-tb');
        btnLayerDir.title = vert ? 'Vertical columns (click to switch to horizontal bands)' : 'Horizontal bands (click to switch to vertical columns)';
        btnLayerDir.setAttribute('aria-label', btnLayerDir.title);
      }

      function setShowSteps(on) {
        if (showSteps() === on) return;
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS, { ghosts: true }) : null;
        if (on) delete chartData.showSteps; else chartData.showSteps = false;
        render({ snap, duration: 170 });
        if (!presenting()) updateStatus(true);
      }
      if (btnSteps) btnSteps.addEventListener('click', () => setShowSteps(!showSteps()));
      function updateStepsButton() {
        if (!btnSteps) return;
        const count = relations().filter((r) => typeof r.step === 'string' && r.step.trim()).length;
        const on = showSteps();
        btnSteps.hidden = !count && on;
        btnSteps.setAttribute('aria-checked', String(on));
        btnSteps.disabled = !count && on;
        const c = btnSteps.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        btnSteps.title = on ? 'Hide step numbers on arrows' : 'Show step numbers on arrows';
      }

      // Add: the selected element, group or arrow gets a note (an arrow's note is on both its ends); nothing selected asks for a
      // selection. The card grows out of its target and its text opens for typing; add and text are one undo step.
      function addNote() {
        if (presenting()) return;
        if (isTyping()) document.activeElement.blur();
        if (selNoteId) { editNote(selNoteId); return; }
        const ids = [];
        sel.forEach((s) => (s.kind === 'edge' ? [(edgeOf(s.id) || {}).from, (edgeOf(s.id) || {}).to] : [s.id]).forEach((id) => { if (id && !ids.includes(id)) ids.push(id); }));
        if (!ids.length) { ui.toast('Select an element, group or arrow first, then add its note'); return; }
        const has = ids.length === 1 && notesList().find((n) => noteTargets(n).length === 1 && noteTargets(n)[0].id === ids[0]);
        if (has) { setShowNotes(true); editNote(has.id); return; }
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS) : null;
        const note = { id: newId('n'), text: '' }, es = ids.filter(elementOf), gs = ids.filter((id) => !elementOf(id) && groupOf(id));
        if (es.length) note.elements = es;
        if (gs.length) note.groups = gs;
        (chartData.notes = notesList()).push(note);
        noteCtl.begin(note, true);
        chartData.showNotes = true;
        sel = [];
        render({ snap, fromKey: { [note.id]: noteAnchor(note).id }, duration: 170 });
        editNote(note.id);
      }
      function addFreeNoteAt(pt) {
        if (presenting()) return;
        if (isTyping()) document.activeElement.blur();
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS) : null;
        const note = { id: newId('n'), text: '', pos: { x: Math.max(0, Math.round(pt.x)), y: Math.max(0, Math.round(pt.y)) } };
        (chartData.notes = notesList()).push(note);
        noteCtl.begin(note, true);
        chartData.showNotes = true;
        sel = [];
        render({ snap, enterScale: 0.82, duration: 170 });
        editNote(note.id);
      }
      function editNote(id) { noteCtl.edit(id); }
      function commitNote(n, text) { noteCtl.commit(n, text); }
      function removeNote(id, step = true) { noteCtl.remove(id, step); }
      const btnAddNote = document.getElementById('btn-add-note');
      if (btnAddNote) {
        btnAddNote.addEventListener('click', (e) => {
          if (btnAddNote.dataset.dragged) { delete btnAddNote.dataset.dragged; e.preventDefault(); return; }
          if (e.detail === 0) setTimeout(addNote, 0); else addNote();
        });
        btnAddNote.addEventListener('pointerdown', (e) => startPaletteDrag(e, 'note', btnAddNote));
      }

      // --- Property edits ---
      function setColor(slot) {
        const objs = [];
        sel.forEach((s) => {
          if (s.kind === 'edge') {
            const e = edgeOf(s.id);
            if (isDirectEdge(e)) { const rel = relations()[e.members[0]]; if (rel && (rel.color || '') !== slot) objs.push(rel); }
          } else {
            const o = s.kind === 'group' ? groupOf(s.id) : elementOf(s.id);
            if (o && (o.color || '') !== slot) objs.push(o);
          }
        });
        if (!objs.length) return;
        objs.forEach((o) => setOpt(o, 'color', slot));
        if (slot && !(chartData.colorKey && chartData.colorKey[slot])) keyDraft = slot;   // invite a name for the colour (optional: leave it empty)
        commit(false, { duration: 160 });
        if (keyDraft) editKey(keyDraft);
      }
      function moveToGroup(ids, target) {
        const list = ids.map(elementOf).filter(Boolean);
        if (!list.length) return;
        let host = null;
        if (target === '+new') {
          const same = list.every((e) => e.group === list[0].group);
          host = { id: newId('g'), name: 'New group', kind: 'system' };
          if (same && list[0].group) host.parent = list[0].group;
          (chartData.groups = groups()).push(host);
        } else if (target) {
          host = groupOf(target);
          if (!host) throw new RangeError(`unknown group "${target}"`);
          [host].concat(ancestors(host)).forEach((g) => { g.collapsed = false; });   // the result is shown, not hidden in a closed box
        }
        list.forEach((e) => setOpt(e, 'group', host ? host.id : ''));
        commit(true);
      }
      const groupItems = (ids) => {
        const cur = new Set(ids.map(elementOf).filter(Boolean).map((e) => e.group || ''));
        const out = [{ label: 'No group', value: '', selected: cur.size === 1 && cur.has('') }];
        groups().filter((g) => placed(g) && !hiddenGroup(g)).sort((a, b) => depthOf(a) - depthOf(b)).forEach((g) => out.push({ label: `${' '.repeat(depthOf(g) - 1)}${nameOf(g)}`, value: g.id, selected: cur.size === 1 && cur.has(g.id) }));
        out.push({ label: 'New group', value: '+new' });
        return out;
      };

      // --- Icon picker (#c4-icons): shared ui.buildIconPicker in shell.js ---
      function openIcons(anchor, o) {
        const missing = [...new Set(elements().map((e) => e.icon).filter((n) => n && ICONS[n] === undefined && !ui.hasLogo(String(n).slice(5))))];
        const { box, search } = ui.buildIconPicker({
          id: 'c4-icons',
          searchId: 'c4-icon-search',
          current: o.icon || '',
          defaultIcon: KIND_ICON[o.kind] || 'cloud',
          defaultLabel: `Default for ${KIND_NAME[o.kind] || o.kind}`,
          missing,
          missingText: `Missing icon pack: ${missing.join(', ')}. Those elements show the icon of their kind.`,
          classes: { box: 'c4-icons', head: 'c4-icon-head', logo: 'c4-icon-logo', note: 'c4-icons-note', missing: 'c4-icons-missing' },
          onPick: (name) => { closeFloating('pick'); if ((o.icon || '') !== name) { setOpt(o, 'icon', name); commit(false, { duration: 160 }); } },
          onEscape: () => closeFloating('cancel')
        });
        openFloating(box, anchor);
        search.focus();
      }

      // --- Step badge editor popover (#c4-step-pop) ---
      function openStepPop(anchor, rel) {
        const box = htmlEl('div', 'c4-pop c4-step-pop');
        box.id = 'c4-step-pop';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Step number');
        const row = htmlEl('div', 'c4-step-row');
        const input = htmlEl('input', 'c4-input');
        input.id = 'c4-step-input';
        input.type = 'text';
        input.maxLength = STEP_MAX;
        input.placeholder = 'e.g. 1, 2a, 3b';
        input.value = rel.step || '';
        input.setAttribute('aria-label', 'Step number');
        const applyBtn = htmlEl('button', 'btn', 'Set');
        applyBtn.type = 'button';
        const hint = htmlEl('div', 'c4-step-hint', `Max ${STEP_MAX} chars; leave blank to clear.`);
        const save = () => {
          const val = optText(input.value, STEP_MAX);
          closeFloating('pick');
          if ((rel.step || '') === val) return;
          setOpt(rel, 'step', val);
          if (val && chartData.showSteps === false) delete chartData.showSteps;
          commit(true, { duration: 160 });
        };
        applyBtn.addEventListener('click', save);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFloating('cancel'); }
        });
        row.append(input, applyBtn);
        box.append(row, hint);
        openFloating(box, anchor);
        input.focus();
        input.select();
      }

      const mainLayerGroups = () => groups().filter((x) => !x.parent && x.shared !== true);
      const SIDE_LABELS = { N: 'Top', S: 'Bottom', W: 'Left', E: 'Right' };
      const sharedDefaultSide = () => (chartData.layerDirection === 'vertical' ? 'S' : 'E');
      const connectTargetItems = (fromId) => {
        const out = [];
        groups().filter((x) => !hiddenGroup(x) && !isAncestorOrSelf(fromId, x.id)).forEach((x) => {
          out.push({ label: `Layer: ${nameOf(x)}`, value: x.id });
        });
        elements().filter((x) => !x._hidden && !isAncestorOrSelf(fromId, x.id)).forEach((x) => {
          out.push({ label: nameOf(x), value: x.id });
        });
        return out;
      };
      const sharedSideItems = (g) => {
        const cur = g.side || sharedDefaultSide();
        return ['N', 'S', 'W', 'E'].map((s) => ({ label: `${SIDE_LABELS[s]} (${s})`, value: s, selected: cur === s }));
      };
      const sharedSpanLabel = (g) => {
        const main = mainLayerGroups();
        const sp = Array.isArray(g.span) && g.span.length ? g.span.filter((id) => main.some((m) => m.id === id)) : [];
        if (!sp.length || sp.length === main.length) return 'All layers';
        if (sp.length === 1) return nameOf(groupOf(sp[0]));
        return `${nameOf(groupOf(sp[0]))} – ${nameOf(groupOf(sp[sp.length - 1]))}`;
      };
      const sharedSpanItems = (g) => {
        const main = mainLayerGroups();
        const sp = Array.isArray(g.span) && g.span.length ? g.span : null;
        const out = [{ label: 'All layers', value: '__all__', selected: !sp }];
        main.forEach((m) => {
          const on = !sp ? false : sp.includes(m.id);
          out.push({ label: `${on ? '✓ ' : ''}${nameOf(m)}`, value: m.id, selected: on });
        });
        return out;
      };
      function applySharedSpan(g, picked) {
        const main = mainLayerGroups();
        if (picked === '__all__' || !main.length) {
          if (g.span) { delete g.span; commit(true); }
          return;
        }
        const order = main.map((m) => m.id);
        const cur = new Set(Array.isArray(g.span) ? g.span.filter((id) => order.includes(id)) : []);
        if (cur.has(picked)) cur.delete(picked); else cur.add(picked);
        if (!cur.size || cur.size === order.length) { delete g.span; commit(true); return; }
        const idxs = [...cur].map((id) => order.indexOf(id)).sort((a, b) => a - b);
        const lo = idxs[0], hi = idxs[idxs.length - 1];
        // Keep span contiguous between min and max selected layers
        g.span = order.slice(lo, hi + 1);
        commit(true);
      }

      // --- ACTION BARS ---
      const ab = (act, content, title, pressed, value, extra) => ui.abButton('ab-btn', act, content, title, pressed, value, extra);
      const abMenu = (act, icon, text, title) => { const b = ab(act, `${ui.icon(icon, { size: 'sm' })}<span>${text}</span>${ui.icon('chevron-down', { size: 'xs', bold: true })}`, title); b.dataset.menu = ''; return b; };
      const abText = (act, icon, text, title, pressed) => ab(act, `${ui.icon(icon, { size: 'sm' })}<span>${text}</span>`, title, pressed);
      function colourPicker(current) {
        return swatchPicker(current || '', setColor, { triggerClass: 'ab-btn', btnClass: 'ab-swatch', act: 'color' });
      }
      const uniform = (objs) => { const cs = [...new Set(objs.map((o) => o.color || ''))]; return cs.length === 1 ? cs[0] : ''; };
      const boxOf = (o) => ({ x: o.x, y: o.y, w: o.w || 0, h: o.h || 0 });
      const anchorOfBox = (b) => ({ x: b.x + b.w / 2, y: b.y, bottom: b.y + b.h });

      function elementBar(bar, o) {
        bar.setAttribute('aria-label', 'Element');
        const iconBtn = abText('icon', 'shapes', 'Icon', 'Icon: pick an icon or tech logo');
        iconBtn.removeAttribute('title');
        bar.appendChild(iconBtn);
        if (!o.group) bar.appendChild(ab('core', ui.icon('focus'), 'Centre: the rest of the diagram rings round it', o.core === true));
        bar.appendChild(ui.abSep('ab-sep'));
        bar.appendChild(colourPicker(o.color));
        bar.appendChild(ui.abSep('ab-sep'));
        bar.appendChild(ab('delete', ui.icon('trash'), 'Delete (and its arrows)', undefined, undefined, 'is-danger'));
        return anchorOfBox(boxOf(o));
      }
      function groupBar(bar, g) {
        bar.setAttribute('aria-label', 'Group');
        bar.appendChild(abMenu('connect', 'link', 'Connect', 'Connect this group to another layer or element'));
        if (chartData.arrange === 'layers' && !g.parent && g.kind === 'boundary') {
          bar.appendChild(abText('shared', 'layers', 'Shared', 'Cross-cutting shared layer (arrows optional)', g.shared === true));
          if (g.shared === true) {
            bar.appendChild(abMenu('side', 'direction-lr', SIDE_LABELS[g.side || sharedDefaultSide()], 'Which side of the layers this shared layer sits on'));
            bar.appendChild(abMenu('span', 'columns', sharedSpanLabel(g), 'Which layers this shared layer spans'));
          }
        } else if (!g.parent) {
          bar.appendChild(ab('core', ui.icon('focus'), 'Centre: the rest of the diagram rings round it', g.core === true));
        }
        bar.appendChild(ab('ungroup', ui.icon('split'), 'Ungroup: keep the members, remove the frame'));
        bar.appendChild(ui.abSep('ab-sep'));
        bar.appendChild(colourPicker(g.color));
        bar.appendChild(ui.abSep('ab-sep'));
        bar.appendChild(ab('delete', ui.icon('trash'), 'Delete the group and its members', undefined, undefined, 'is-danger'));
        return anchorOfBox(boxOf(g));
      }
      function edgeBar(bar, e) {
        bar.setAttribute('aria-label', 'Arrow');
        const direct = isDirectEdge(e), rel = direct ? relations()[e.members[0]] : null;
        if (direct && rel) {
          bar.appendChild(abText('step', 'numbers', rel.step ? `#${rel.step}` : 'Step', 'Step number badge (e.g. 1, 2a)', !!rel.step));
          bar.appendChild(ab('async', ui.icon('line-dashed'), 'Asynchronous: draw it dashed', rel.async === true));
          bar.appendChild(ab('reverse', ui.icon('reverse'), 'Reverse the direction'));
        } else bar.appendChild(htmlEl('span', 'c4-ab-tag', `${e.count} relations`));
        if (direct && rel) {
          bar.appendChild(ui.abSep('ab-sep'));
          bar.appendChild(colourPicker(rel.color));
          bar.appendChild(ui.abSep('ab-sep'));
        }
        bar.appendChild(ab('delete', ui.icon('trash'), e.count > 1 ? `Delete these ${e.count} relations` : 'Delete this arrow', undefined, undefined, 'is-danger'));
        const rec = els.edges.get(e.id), b = e.labelBox;
        if (b) {
          const cx = Math.round(b.x + b.w / 2), cy = Math.round(b.y + b.h / 2);
          const h = (rec && rec.label && rec.label.offsetHeight) || b.h;
          return { x: cx, y: Math.round(cy - h / 2), bottom: Math.round(cy + h / 2) };
        }
        const pts = e.points || [], m = pts[Math.floor(pts.length / 2)] || [0, 0];
        return { x: m[0], y: m[1], bottom: m[1] };
      }
      function multiBar(bar) {
        bar.setAttribute('aria-label', 'Selection');
        const nodes = sel.filter((s) => s.kind !== 'edge').map((s) => (s.kind === 'group' ? groupOf(s.id) : elementOf(s.id)));
        bar.appendChild(htmlEl('span', 'c4-ab-tag', `${sel.length} selected`));
        bar.appendChild(ui.abSep('ab-sep'));
        if (selIds('element').length) bar.appendChild(abMenu('group', 'frame', 'Group', 'Move the selected elements to a group'));
        if (nodes.length) { bar.appendChild(colourPicker(uniform(nodes))); bar.appendChild(ui.abSep('ab-sep')); }
        bar.appendChild(ab('delete', `${ui.icon('trash')}<span>Delete ${sel.length}</span>`, `Delete these ${sel.length} items`, undefined, undefined, 'is-danger'));
        const boxes = nodes.map(boxOf).concat(sel.filter((s) => s.kind === 'edge').map((s) => edgeOf(s.id)).filter((e) => e && e.labelBox).map((e) => e.labelBox));
        const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + (b.w || 0))), y1 = Math.max(...boxes.map((b) => b.y + (b.h || 0)));
        return anchorOfBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }

      let lastBarKey = null;   // which selection the bar was last drawn for: a redraw of the same one makes no entrance
      let barLater = false;   // patchMoved: the bar is built a frame later, so measuring it does not hold up the release
      function drawBar() {
        if (barLater) {
          barLater = false;
          html.querySelectorAll('.c4-actionbar').forEach((el) => el.remove());
          lastBarKey = null;
          requestAnimationFrame(drawBar);
          return;
        }
        const key = presenting() || newLink || !sel.length ? null : JSON.stringify(sel);
        const same = key !== null && key === lastBarKey;
        lastBarKey = key;
        html.querySelectorAll('.c4-actionbar').forEach((el) => (same ? el.remove() : motion.hideBar(el)));
        if (key === null) return;
        const bar = ui.actionBar('actionbar c4-actionbar is-wrap');
        const p = primary();
        let at = null;
        if (sel.length > 1) at = multiBar(bar);
        else if (p.kind === 'edge') at = edgeBar(bar, edgeOf(p.id));
        else if (p.kind === 'group') at = placed(groupOf(p.id)) ? groupBar(bar, groupOf(p.id)) : null;
        else at = placed(elementOf(p.id)) ? elementBar(bar, elementOf(p.id)) : null;
        if (!at) return;
        html.appendChild(bar);
        ui.fitBar(bar);
        const w = ui.barSize(bar).w, h = ui.barSize(bar).h;
        const below = !ui.roomAbove({ getBoundingClientRect: () => ({ top: canvas.getBoundingClientRect().top + at.y * scale }) }, bar);   // by where the anchor is in the window
        bar.classList.toggle('is-below', below);
        // centred on its anchor; only the window's edges move it (the bar is not zoomed, so its width on screen is w)
        const vp = viewport.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
        const sx = Math.max(vp.left + 8 + w / 2, Math.min(cr.left + at.x * scale, vp.right - 8 - w / 2));
        Object.assign(bar.style, {
          left: px(Math.round((sx - cr.left) / scale)),   // the bar is centred on it (translate), so it stays put when collapsed
          top: px(Math.round(below ? at.bottom + 10 / scale : at.y - 10 / scale - h))
        });
        if (!same) motion.showBar(bar);
      }
      html.addEventListener('click', (e) => {
        const b = e.target.closest('.c4-actionbar .ab-btn[data-act]');
        if (!b || presenting()) return;
        e.stopPropagation();
        runAction(b.dataset.act, b.dataset.value, b);
      });

      // Where a menu or popover opens: under the whole bar (not under its button, which would cover the bar's other rows)
      function barAnchor(btn) {
        const a = btn.getBoundingClientRect(), bar = btn.closest('.c4-actionbar').getBoundingClientRect();
        return bar.height ? { left: a.left, right: a.right, top: bar.top, bottom: bar.bottom } : a;
      }
      function runAction(act, value, btn) {
        const p = primary();
        if (!p) return;
        const at = barAnchor(btn);
        if (sel.length > 1) {
          if (act === 'delete') deleteSelection(btn);
          else if (act === 'group') openMenu(at, 'Move to group', groupItems(selIds('element')), (v) => moveToGroup(selIds('element'), v));
          return;
        }
        if (p.kind === 'edge') {
          const e = edgeOf(p.id);
          if (!e) return;
          const members = e.members.map((i) => relations()[i]).filter(Boolean);
          if (act === 'delete') deleteSelection(btn);
          else if (act === 'step' && isDirectEdge(e) && members[0]) openStepPop(at, members[0]);
          else if (act === 'async') { const on = !members.every((r) => r.async === true); members.forEach((r) => setOpt(r, 'async', on)); commit(false, { duration: 160 }); }
          else if (act === 'reverse') {
            if (members.some((r) => relations().some((x) => !members.includes(x) && x.from === r.to && x.to === r.from && x.label === r.label))) { ui.toast('The reverse connection already exists with this label'); return; }
            members.forEach((r) => { const t = r.from; r.from = r.to; r.to = t; });
            commit(true);
          }
          return;
        }
        const o = p.kind === 'group' ? groupOf(p.id) : elementOf(p.id);
        if (!o) return;
        if (act === 'delete') deleteSelection(btn);
        else if (act === 'core') { setOpt(o, 'core', o.core !== true); commit(true); }
        else if (p.kind === 'group') {
          if (act === 'ungroup') ungroup(o.id);
          else if (act === 'connect') {
            const targets = connectTargetItems(o.id);
            if (!targets.length) { ui.toast('No other layer or element to connect to'); return; }
            openMenu(at, 'Connect to', targets, (v) => connectItems(o.id, v));
          } else if (act === 'shared') {
            const next = o.shared !== true;
            setOpt(o, 'shared', next);
            if (!next) { delete o.span; delete o.side; } else pruneSpanRefs(new Set([o.id]));
            delete chartData._manual;
            commit(true);
          } else if (act === 'side') {
            openMenu(at, 'Shared layer side', sharedSideItems(o), (v) => { o.side = v; delete chartData._manual; commit(true); });
          } else if (act === 'span') {
            openMenu(at, 'Spanned layers', sharedSpanItems(o), (v) => applySharedSpan(o, v));
          }
        } else if (act === 'icon') openIcons(at, o);
      }

      // --- KEYBOARD ---
      function cancelInteraction() {
        let did = false;
        if (ui.closeConfirm()) did = true;
        if (closeFloating('cancel')) did = true;
        if (cancelDrag()) did = true;
        if (cancelMove()) did = true;
        if (cancelPaletteDrag()) did = true;
        return did;
      }
      function clearSelectionNow() {
        if (sel.length || hoverEdgeId || selNoteId) { sel = []; hoverEdgeId = null; setSel([]); }
      }
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || isTyping()) return;
        if (cancelInteraction()) return;
        if (sel.length || selNoteId) clearSelectionNow();
      }, true);
      window.addEventListener('keydown', (e) => {
        if (presenting() || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && e.key === 'Enter') return;
        if (ui.isConfirmOpen() || floating) return;
        if ((e.key === 'Enter' || e.key === 'F2') && sel.length === 1) { e.preventDefault(); editSelection(); }
      });

      // Enter / F2 / Space / the arrows on a focused tile, tag or label.
      html.addEventListener('keydown', (ev) => {
        const item = ev.target.closest('.c4-node, .c4-group, .c4-label');
        if (!item || ev.target.closest('button') || ev.target.isContentEditable) return;
        const lbl = item.classList.contains('c4-label');
        const kind = lbl ? 'edge' : item.dataset.nodeId ? 'element' : 'group', id = item.dataset.nodeId || item.dataset.groupId || item.dataset.edgeId;
        if (lbl && (ev.key === 'Delete' || ev.key === 'Backspace')) { select({ kind, id }); return; }   // the shell's Delete handler then removes the arrow
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'F2') {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.key === ' ') { if (kind === 'group' && item.classList.contains('is-tile')) toggleGroup(id); else select({ kind, id }); return; }
          select({ kind, id });
          if (!presenting()) editSelection();
        } else if (ev.key.startsWith('Arrow') && !lbl && !ev.altKey) {   // Alt + arrow moves the selection (MOVING BOXES)
          const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
          const here = item.getBoundingClientRect(), hc = { x: here.left + here.width / 2, y: here.top + here.height / 2 };
          let best = null, bestScore = Infinity;
          [...els.nodes.values(), ...[...els.groups.values()].filter((g) => g.classList.contains('is-tile')), ...[...els.groups.values()].map((g) => g.querySelector('.frame-tag')).filter(Boolean)].forEach((el) => {
            if (el === item || item.contains(el)) return;
            const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - hc.x, dy = r.top + r.height / 2 - hc.y;
            const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
            if (along <= 0) return;
            const score = along + 2 * across;
            if (score < bestScore) { bestScore = score; best = el; }
          });
          if (!best) return;
          ev.preventDefault();
          const host = best.closest('.c4-group'), bid = best.dataset.nodeId || (host && host.dataset.groupId);
          select({ kind: best.dataset.nodeId ? 'element' : 'group', id: bid });
          best.focus();
        }
      });

      // --- MOVING BOXES (contract: "Moving boxes (phase 5)" in dev/plans/plan-c4.md) ---
      // Drag an element, a collapsed group's tile, a group by its tag, or the whole selection (4 px first, so a click still
      // selects); Alt + arrows (Shift: 40 px) does the same from the keyboard. While it moves, the boxes follow by `translate`
      // only (no model change, nothing routed), the arrows and cards that touch them fade, and the group an element would join
      // is highlighted (.c4-drop). On release the page writes the positions and the new membership, turns manual layout on,
      // calls routeDiagram(chartData, { pinned }) and lets render() morph from where the boxes were let go: one undo step.
      // Esc, a cancelled pointer or a second finger puts everything back.
      const MAX_GROUP_DEPTH = 2;   // scripts/audit_c4.py MAX_GROUP_DEPTH: a group is never dropped where it would nest deeper
      const MOVE_THRESHOLD = 4, STEP = 8, STEP_BIG = 40;
      const groupHeight = (g) => 1 + Math.max(0, ...groups().filter((x) => x.parent === g.id).map(groupHeight));
      const itemOf = (s) => (s.kind === 'group' ? groupOf(s.id) : elementOf(s.id));
      const parentOf = (s) => (s.kind === 'group' ? itemOf(s).parent : itemOf(s).group) || '';

      // What a move carries: the picked items and, for a group, everything inside it (hidden members too, so they open where
      // the group sits). `tops` are the picked items that no picked group already carries: only they change membership.
      function moveSet(items) {
        const picked = items.filter((s) => s.kind !== 'edge' && itemOf(s)), ids = new Set();
        const pickedGroups = new Set(picked.filter((s) => s.kind === 'group').map((s) => s.id));
        picked.forEach((s) => { ids.add(s.id); if (s.kind === 'group') descendants(groupOf(s.id)).forEach((d) => ids.add(d)); });
        const carried = (s) => { for (let p = parentOf(s), n = 0; p && n < 50; p = (groupOf(p) || {}).parent, n++) if (pickedGroups.has(p)) return true; return false; };
        const seen = [...ids].map((id) => els.nodes.get(id) || els.groups.get(id)).filter(Boolean);
        const shown = [...ids].map((id) => elementOf(id) || groupOf(id)).filter((o) => o && placed(o) && (els.nodes.has(o.id) || els.groups.has(o.id)));
        return {
          ids, els: seen, tops: picked.filter((s) => !carried(s)),
          minX: Math.min(...shown.map((o) => o.x)), minY: Math.min(...shown.map((o) => o.y)),
          dx: 0, dy: 0, moved: false, faded: []
        };
      }
      const clampMove = (m, dx, dy) => ({ dx: Math.max(dx, -m.minX), dy: Math.max(dy, -m.minY) });   // nothing leaves the top-left of the canvas

      function beginVisual(m) {
        m.moved = true;
        document.body.classList.add('c4-moving', 'is-dragging');
        hoverId = null;
        applyState();
        m.els.forEach((el) => el.classList.add('is-dragging'));
        // the arrows and note cards that touch what moves fade out: they are routed again on release
        els.edges.forEach((rec, id) => {
          const e = edgeOf(id);
          if (e && (m.ids.has(e.from) || m.ids.has(e.to))) [rec.g, rec.label, rec.badge].forEach((x) => { if (x) m.faded.push(x); });
        });
        notesList().forEach((n) => { if (noteTargets(n).some((t) => m.ids.has(t.id))) { const c = noteCard(n.id); if (c) m.faded.push(c); } });
        m.faded.forEach((x) => x.classList.add('drag-fade'));
      }
      function showMove(m, dx, dy) {
        const c = clampMove(m, dx, dy);
        m.dx = c.dx; m.dy = c.dy;
        const t = `${m.dx}px ${m.dy}px`;
        m.els.forEach((el) => { el.style.translate = t; });
      }
      function clearVisual(m) {
        document.body.classList.remove('c4-moving', 'is-dragging');
        canvas.querySelectorAll('.c4-drop').forEach((el) => el.classList.remove('c4-drop'));
        m.faded.forEach((x) => x.classList.remove('drag-fade'));
        m.els.forEach((el) => el.classList.remove('is-dragging'));
      }

      // The group a box would belong to if it were let go now: the innermost group frame (or collapsed tile) under its centre
      // that is not the box itself or inside it, and where a group would not nest deeper than the audit allows.
      function hostAt(m, s, dx, dy) {
        const o = itemOf(s);
        if (!placed(o) || !(o.w > 0)) return parentOf(s);
        const cx = o.x + dx + o.w / 2, cy = o.y + dy + o.h / 2;
        const height = s.kind === 'group' ? groupHeight(o) : 0;
        const hit = groups().filter((g) => !m.ids.has(g.id) && placed(g) && g.w > 0 && !hiddenGroup(g)
          && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h && depthOf(g) + height <= MAX_GROUP_DEPTH)
          .sort((a, b) => depthOf(b) - depthOf(a))[0];
        return hit ? hit.id : '';
      }
      // A group let go with its centre over one of its own inner frames would nest into itself: that drop is refused
      const ownInner = (m, dx, dy) => m.tops.some((s) => {
        if (s.kind !== 'group') return false;
        const o = itemOf(s), cx = o.x + dx + o.w / 2, cy = o.y + dy + o.h / 2;
        return descendants(o).map(groupOf).some((g) => g && placed(g) && g.w > 0 && !hiddenGroup(g) && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h);
      });
      const dropChanges = (m, dx, dy) => m.tops.map((s) => ({ s, host: hostAt(m, s, dx, dy) })).filter(({ s, host }) => host !== parentOf(s));
      function showDrop(m) {   // m.drop: the frames lit on the last frame of the move
        const next = new Set(dropChanges(m, m.dx, m.dy).map(({ host }) => host && els.groups.get(host)).filter(Boolean));
        (m.drop || []).forEach((el) => { if (!next.has(el)) el.classList.remove('c4-drop'); });
        next.forEach((el) => el.classList.add('c4-drop'));
        m.drop = next;
      }

      // Release: write positions and membership, route, morph, one undo step. announce: say "Manual layout on" (the keyboard way)
      function finishMove(m, reparent, announce) {
        const dx = Math.round(m.dx), dy = Math.round(m.dy);
        if (reparent && ownInner(m, dx, dy)) { glideBack(m); ui.toast('A group cannot go inside itself'); return; }
        const changes = reparent ? dropChanges(m, dx, dy) : [];
        if (!dx && !dy && !changes.length) { clearVisual(m); m.els.forEach((el) => { el.style.translate = ''; }); return; }
        motion.cancelAll();
        const useMotion = motion.enabled() && html.childElementCount > 0;
        const snap = useMotion ? motion.capture(canvas, FLIP_SPECS) : null, prevEdges = useMotion ? captureEdges() : null;
        const wasManual = manualMode();
        chartData._manual = true;   // the first move keeps every position as it is now (they are all on the model) and turns manual layout on
        m.ids.forEach((id) => { const o = elementOf(id) || groupOf(id); if (o && placed(o)) { o.x += dx; o.y += dy; } });
        const toKey = {};
        // groups whose frame could change shape of its tag (the chevron shows only on a group with something inside)
        const around = new Set(changes.flatMap(({ s, host }) => [parentOf(s), host]).filter(Boolean).flatMap((id) => [id].concat(ancestors(groupOf(id)).map((a) => a.id))));
        const filled = () => new Map([...around].map((id) => [id, descendants(groupOf(id)).length > 0]));
        const had = filled();
        changes.forEach(({ s, host }) => {
          setOpt(itemOf(s), s.kind === 'group' ? 'parent' : 'group', host);
          const into = host && groupOf(host);
          if (into && isTile(into)) toKey[s.id] = host;   // let go over a closed group: it shrinks into the tile
        });
        clearVisual(m);
        const mo = { snap, prevEdges, toKey, pinned: [...m.ids], duration: 200 };   // the route shifts away what now overlaps the moved boxes
        const same = !Object.keys(toKey).length && [...filled()].every(([id, v]) => had.get(id) === v);   // nothing appears, goes or changes its tag
        if (!same || !patchMoved(mo)) render(mo);
        updateStatus(true);
        if (!wasManual && announce) updateModeUi(true);
      }

      // The release without a new membership touches only what changed: route, then the boxes whose geometry moved are updated
      // in place, the arrows, labels and cards are drawn again, and the shell's morph plays over them. False (nothing done) when
      // a box would appear or go, so that render() redraws everything.
      function patchMoved(mo) {
        const was = new Map();
        const snapGeo = (o) => [o.x, o.y, o.w, o.h];
        els.nodes.forEach((el, id) => was.set(id, snapGeo(elementOf(id))));
        els.groups.forEach((el, id) => was.set(id, snapGeo(groupOf(id))));
        routeDiagram(chartData, { pinned: mo.pinned });
        edgeById = new Map(edges().map((e) => [e.id, e]));
        chartData._manual = true;
        const sameEdges = edges().filter((e) => e.path).length === els.edges.size && edges().every((e) => !e.path || els.edges.has(e.id));
        const shown = new Set(elements().filter((e) => !e._hidden && placed(e) && e.w > 0).map((e) => e.id)
          .concat(groups().filter((g) => placed(g) && g.w > 0 && !hiddenGroup(g)).map((g) => g.id)));
        if (!sameEdges || shown.size !== was.size || [...shown].some((id) => !was.has(id))) return false;
        const C = chartData.canvas || { width: 800, height: 400 };
        canvas.style.width = px(C.width); canvas.style.height = px(C.height);
        svg.setAttribute('width', C.width); svg.setAttribute('height', C.height);
        const put = (el, o) => { el.style.translate = ''; Object.assign(el.style, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h) }); if (el.classList.contains('c4-node')) el.style.setProperty('--c4-h', px(o.h)); };
        els.nodes.forEach((el, id) => { const o = elementOf(id); if (el.style.translate || was.get(id).some((v, i) => v !== snapGeo(o)[i])) put(el, o); });
        els.groups.forEach((el, id) => { const o = groupOf(id); if (el.style.translate || was.get(id).some((v, i) => v !== snapGeo(o)[i])) put(el, o); });
        edges().forEach((e) => {   // an arrow whose route did not change stays as it is
          const rec = els.edges.get(e.id);
          if (!rec) return;
          if (rec.d !== e.path) { rec.d = e.path; rec.line.setAttribute('d', e.path); rec.hit.setAttribute('d', e.path); }
          const b = e.labelBox;
          if (rec.label && b) {
            const st = rec.label.style, wantL = px(Math.round(b.x + b.w / 2)), wantT = px(Math.round(b.y + b.h / 2));
            if (st.left !== wantL || st.top !== wantT) Object.assign(st, { left: wantL, top: wantT });
          }
        });
        if (notesLayer) { notesLayer.remove(); renderNotes(); }
        barLater = true;
        drawBar();
        if (mo.snap) {
          motion.play(mo.snap, canvas, FLIP_SPECS, { duration: mo.duration });
          playEdges(mo.prevEdges);
        }
        return true;
      }

      // The pointer
      function startMove(ev, item, items) {
        if (presenting() || ev.button !== 0 || mv) return;
        const m = moveSet(items);
        if (!m.tops.length) return;
        Object.assign(m, { item, sx: ev.clientX, sy: ev.clientY, pointerId: ev.pointerId, kb: false, multi: items.length > 1 });
        mv = m;
        window.addEventListener('pointermove', onMoveMove);
        window.addEventListener('pointerup', onMoveUp);
        window.addEventListener('pointercancel', cancelMove);
      }
      function endMoveListeners() {
        window.removeEventListener('pointermove', onMoveMove);
        window.removeEventListener('pointerup', onMoveUp);
        window.removeEventListener('pointercancel', cancelMove);
      }
      function onMoveMove(e) {
        const m = mv;
        if (!m || m.kb || e.pointerId !== m.pointerId) return;
        if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < MOVE_THRESHOLD) return;
        if (!m.moved) beginVisual(m);
        showMove(m, (e.clientX - m.sx) / scale, (e.clientY - m.sy) / scale);
        showDrop(m);
      }
      function onMoveUp(e) {
        const m = mv;
        if (!m || m.kb || e.pointerId !== m.pointerId) return;
        mv = null;
        endMoveListeners();
        if (!m.moved) { if (m.multi && !e.ctrlKey && !e.shiftKey && !e.metaKey) setSel([m.item]); return; }   // a click: select this one
        finishMove(m, true);
      }
      // Esc, a cancelled pointer, a second finger: the boxes glide back and nothing is written
      function cancelMove() {
        const m = mv;
        if (!m) return false;
        mv = null;
        endMoveListeners();
        glideBack(m);
        return true;
      }
      function glideBack(m) {
        if (m.moved) {
          m.els.forEach((el) => {
            const from = el.style.translate;
            el.style.translate = '';
            if (from) motion.anim(el, [{ translate: from }, { translate: '0px 0px' }], { duration: 160, easing: motion.curve('curve-out') });
          });
        }
        clearVisual(m);
      }

      // The keyboard: Alt + arrows move the selection by 8 px (Shift: 40); the move is written, as one undo step, when the key is let go
      window.addEventListener('keydown', (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || !e.key.startsWith('Arrow') || presenting() || isTyping() || (mv && !mv.kb) || floating || ui.isConfirmOpen()) return;
        if (!sel.some((s) => s.kind !== 'edge')) return;
        e.preventDefault();
        e.stopPropagation();
        if (!mv) {
          const m = moveSet(sel);
          if (!m.tops.length) return;
          Object.assign(m, { kb: true, item: null });
          mv = m;
          beginVisual(m);
        }
        const k = e.shiftKey ? STEP_BIG : STEP, d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
        showMove(mv, mv.dx + d[0], mv.dy + d[1]);
        showDrop(mv);
      }, true);
      function endKeyMove(e) {
        if (!mv || !mv.kb || (e.type === 'keyup' && !(e.key.startsWith('Arrow') || e.key === 'Alt'))) return;
        const m = mv;
        mv = null;
        finishMove(m, false, true);
      }
      window.addEventListener('keyup', endKeyMove);
      window.addEventListener('blur', endKeyMove);

      // A finger may drag a box (the shell hands it the touch) only while editing; on blank canvas it still pans
      const touchBoxes = '.c4-node, .c4-group.is-tile, .c4-tag';
      function syncTouchDrag() {
        const edit = !presenting();
        html.querySelectorAll(touchBoxes).forEach((el) => { if (edit) el.dataset.touchDrag = ''; else delete el.dataset.touchDrag; });
      }
      new MutationObserver(syncTouchDrag).observe(document.body, { attributes: true, attributeFilter: ['class'] });

      // --- AUTO-TIDY AND MANUAL LAYOUT, SHOWN ---
      // The Tidy button is pressed while Auto-Tidy is on; manual layout shows a badge beside the save status and Tidy goes back to Auto-Tidy.
      const btnTidy = document.getElementById('btn-auto-tidy');
      const modeBadge = document.getElementById('c4-mode');
      const TIDY_AUTO = 'Auto-Tidy is on: every edit lays the diagram out again. Drag a box to place it by hand.';
      const TIDY_MANUAL = 'Manual layout: boxes stay where you put them. Click to lay everything out again and go back to Auto-Tidy.';
      let modeTimer = 0;
      if (modeBadge && document.getElementById('save-status')) document.getElementById('save-status').after(modeBadge);
      function updateModeUi(announce) {
        const man = manualMode();
        if (btnTidy) { btnTidy.removeAttribute('aria-pressed'); btnTidy.title = man ? TIDY_MANUAL : TIDY_AUTO; }
        if (!modeBadge) return;
        const show = man && !presenting(), was = !modeBadge.hidden;
        modeBadge.hidden = !show;
        clearTimeout(modeTimer);
        modeBadge.textContent = announce ? 'Manual layout on' : 'Manual layout';   // the badge is a live region: the keyboard move is announced
        if (announce) modeTimer = setTimeout(() => { modeBadge.textContent = 'Manual layout'; }, 2500);
        if (show && !was) motion.anim(modeBadge, [{ transform: 'scale(0.7)' }, { transform: 'none' }], { duration: 160, easing: motion.curve('curve-spring-tactile') });
      }
      // Tidy: forget the manual layout and lay everything out afresh (one undo step)
      function tidy() {
        if (presenting()) return;
        if (isTyping()) document.activeElement.blur();
        delete chartData._manual;
        commit(true, { duration: 260 });
      }

      // --- SELECTION BOX AND SELECT ALL (the shell draws the box: Shift + drag on blank canvas; Ctrl + Shift toggles) ---
      function touches(el, r) {
        const b = el.getBoundingClientRect();
        return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      }
      function selectInRect(r, mode, start) {
        if (presenting()) return;
        if (start) boxBase = sel.slice();
        const hit = [];
        els.nodes.forEach((el, id) => { if (touches(el, r)) hit.push({ kind: 'element', id }); });
        els.groups.forEach((el, id) => { if (el.classList.contains('is-tile') && touches(el, r)) hit.push({ kind: 'group', id }); });
        const has = (list, s) => list.some((x) => x.kind === s.kind && x.id === s.id);
        const next = mode === 'toggle' ? boxBase.filter((s) => !has(hit, s)).concat(hit.filter((s) => !has(boxBase, s))) : hit;
        if (next.length === sel.length && next.every((s) => has(sel, s))) return;
        setSel(next);
      }
      function selectAll() {
        if (presenting()) return;
        setSel([...els.nodes.keys()].map((id) => ({ kind: 'element', id })).concat([...els.groups.keys()].map((id) => ({ kind: 'group', id }))));
      }

      // --- DISK FORMAT ---
      // The same bytes as c4_to_disk / c4_from_disk in scripts/disk_format.py (contract: the codec spec above C4_KEYS there). An
      // editor id (e_<ms>, g_<ms>, n_<ms>) is renamed to its name slug; authored ids are never touched.
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'arrange', 'layerDirection', 'showTech', 'showNotes', 'showSteps', 'colorKey', 'groups', 'elements', 'relations', 'notes', 'layout'];
      const DISK_DERIVED = [['groups', ['w', 'h']], ['elements', ['w', 'h']], ['relations', ['points', 'labelBox']]];
      const DISK_OBJECTS = ['groups', 'elements', 'relations', 'notes'];
      const GENERATED_ID = /^(e|g|n)_\d{12,}(_\d+)?$/;
      const SLUG_MAX = 30;
      function slug(text) {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/_+$/, '');
        return s;
      }
      function renameGeneratedIds(d) {
        const gs = d.groups || [], es = d.elements || [], ns = d.notes || [];
        const used = new Set([...gs, ...es, ...ns].map((o) => o.id));
        const rename = new Map();
        const take = (base) => { let id = base, k = 2; while (used.has(id)) id = `${base}_${k++}`; used.add(id); return id; };
        const generated = (o) => GENERATED_ID.test(String(o.id == null ? '' : o.id));
        [[es, 'element'], [gs, 'group']].forEach(([items, fallback]) => items.forEach((o) => { if (generated(o)) rename.set(o.id, take(slug(o.name) || fallback)); }));
        let count = 1;
        ns.forEach((o) => {
          if (!generated(o)) return;
          while (used.has(`n${count}`)) count++;
          rename.set(o.id, take(`n${count}`));
        });
        if (!rename.size) return;
        const r = (id) => (rename.has(id) ? rename.get(id) : id);
        [...gs, ...es, ...ns].forEach((o) => { o.id = r(o.id); });
        (d.relations || []).forEach((rel) => ['from', 'to'].forEach((k) => { rel[k] = r(rel[k]); }));
        es.forEach((o) => { if ('group' in o) o.group = r(o.group); });
        gs.forEach((g) => {
          if ('parent' in g) g.parent = r(g.parent);
          if (Array.isArray(g.span)) g.span = g.span.map(r);
        });
        ns.forEach((n) => ['elements', 'groups'].forEach((k) => { if (Array.isArray(n[k])) n[k] = n[k].map(r); }));
      }
      const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
      function toDisk(data) {
        const d = {};
        Object.keys(data).forEach((k) => { if (k !== 'layout' && k !== 'canvas' && (k[0] !== '_' || k === '_readme')) d[k] = JSON.parse(JSON.stringify(data[k])); });
        d.schemaVersion = 1;
        slotColors(d, 'elements', 'groups', 'relations');
        DISK_OBJECTS.forEach((name) => (d[name] || []).forEach((o) => Object.keys(o).forEach((k) => { if (k[0] === '_') delete o[k]; })));
        DISK_DERIVED.forEach(([list, keys]) => (d[list] || []).forEach((o) => keys.forEach((k) => { delete o[k]; })));
        renameGeneratedIds(d);
        const layout = {};
        ['elements', 'groups'].forEach((list) => (d[list] || []).forEach((o) => {   // elements, then collapsed groups: an open group's frame is derived from its members
          if (isNum(o.x) && isNum(o.y) && (list === 'elements' || o.collapsed === true)) layout[o.id] = { x: o.x, y: o.y };
          delete o.x; delete o.y;
        }));
        if (data._manual === true && Object.keys(layout).length) d.layout = layout;   // Auto-Tidy saves no positions: the layout is the same every time
        const out = {};
        DISK_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }
      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        const layout = d.layout || {};
        delete d.layout;
        if (Object.keys(layout).length) d._manual = true;   // a saved layout map means manual layout
        if (d.schemaVersion === undefined || d.schemaVersion === 1) {
          ['elements', 'groups'].forEach((list) => (d[list] || []).forEach((o) => Object.assign(o, layout[o.id] || {})));
        }
        slotColors(d, 'elements', 'groups', 'relations');
        return d;
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'c4',
        defaultTitle: 'Interactive C4 Diagram',
        toDisk,
        fromDisk,
        toMermaid,   // the writer and reader in mermaid.js (Mermaid C4: one level)
        fromMermaid,
        contentEl: canvas,
        report: { node: '.c4-node, .c4-group.is-tile', label: '.c4-label', labelText: '.c4-label-text', nodeText: '.c4-name' },
        render,
        isBackground: (el) => el === canvas || el === svg || el === html || el === legendEl || el.id === 'c4-overlay',
        fitPad: (w) => (w < 600 ? 32 : 0),   // Fit leaves 80px round the picture; a phone is 390px wide, so it keeps 32 (0: the shell default)
        contentOverflow() {   // the colour key sits above the diagram; a note card may stand outside it
          const C = chartData.canvas || { width: 0, height: 0 };
          const o = { left: 0, top: legendEl ? 44 : 0, right: legendEl ? Math.max(0, legendEl.offsetLeft + legendEl.offsetWidth + 16 - C.width) : 0, bottom: 0 };
          if (notesLayer) {
            [...notesLayer.children].forEach((c) => {
              const x = parseFloat(c.style.left) || 0, y = parseFloat(c.style.top) || 0;
              o.left = Math.max(o.left, 12 - x); o.top = Math.max(o.top, 12 - y);
              o.right = Math.max(o.right, x + c.offsetWidth + 12 - C.width); o.bottom = Math.max(o.bottom, y + c.offsetHeight + 12 - C.height);
            });
          }
          return o;
        },
        clearSelection: clearSelectionNow,
        cancelInteraction,
        tidy,
        hasSelection: () => !presenting() && (sel.length > 0 || !!selNoteId),
        selectInRect,
        selectAll,
        deleteSelection,
        // Search: the live DOM, top to bottom then left to right: elements (name, technology, description), groups, arrow labels
        searchItems() {
          const out = [], clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const add = (id, el, text) => { text = clean(text); if (text && el) out.push({ id, text, el, y: parseFloat(el.style.top) || 0, x: parseFloat(el.style.left) || 0 }); };
          els.nodes.forEach((el, id) => {
            const e = elementOf(id);
            add(`element:${id}`, el, e ? [nameOf(e), showTech() ? e.tech : '', e.description].filter(Boolean).join(' ') : el.textContent);
          });
          els.groups.forEach((el, id) => add(`group:${id}`, el, nameOf(groupOf(id))));
          els.edges.forEach((rec, id) => {
            const e = edgeOf(id);
            add(`rel:${id}`, rec.label, e ? [e.label, showTech() ? e.tech : ''].filter(Boolean).join(' ') : (rec.label && rec.label.textContent));
          });
          notesList().forEach((n) => {   // a note whose card is hidden (Notes off, or its target inside a closed group) rings its target instead
            const a = noteAnchor(n), host = noteCard(n.id) || (a && targetEl(a));
            add(`note:${n.id}`, host, n.text);
          });
          return out.sort((a, b) => a.y - b.y || a.x - b.x).map(({ id, text, el }) => ({ id, text, el }));
        }
      });
      })();
