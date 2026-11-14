      // --- ER DIAGRAM PLUGIN ---
      // Renders chartData (diagramType "erd") from the model engine.js lays out: tables with column rows, subject-area
      // bands, crow's-foot relationship lines, label pills and notes. Wave 2 draws and toggles display only; the
      // editing members (add, rename, draw, drag, delete) are wave 3 and are marked TODO(wave 3).
      //
      // Model (see engine.js header): entities[].x/y are flow terms and the only positions that are saved; box,
      // points, labelBox and data.canvas are derived on every render (layoutDiagram when any table lacks x/y, else
      // routeDiagram) and never saved (toDisk drops them). Everything on screen is absolute within #erd-canvas.
      //
      // State kept in this file (module scope): erdSel (selection), hoverEntityId / hoverRelId (highlight),
      // autoLayout (the dock switch, localStorage "erd-auto-layout"), the note fitting caches, and peek/selected note.
      // Render entry points: render() (everything), applyHighlight() (hover/selection classes only),
      // applyNoteVisibility() (notes only), pinBands() (band pills; also after every pan/zoom).

      const ERD_SVG_NS = 'http://www.w3.org/2000/svg';
      const erdCanvas = document.getElementById('erd-canvas');
      const erdBands = document.getElementById('erd-bands');
      const erdSvg = document.getElementById('erd-svg');
      const erdRels = document.getElementById('erd-rels');
      const erdLeaders = document.getElementById('erd-note-leaders');
      const erdHtml = document.getElementById('erd-html');
      const erdBtnColumns = document.getElementById('btn-columns');
      const erdBtnTypes = document.getElementById('btn-types');
      const erdBtnNotes = document.getElementById('btn-notes');
      const erdBtnDirection = document.getElementById('btn-direction');
      const erdBtnAuto = document.getElementById('btn-auto-layout');

      const ERD_DETAILS = ['all', 'keys', 'names'];
      const ERD_END_KINDS = ['one', 'zeroOrOne', 'oneOrMany', 'zeroOrMany'];
      const ERD_RADIUS = 8;         // line corner radius
      const ERD_HOP = 6;            // radius of the hop a line makes over an earlier one it crosses
      const ERD_PILL_INSET = 10;    // px from the band edge to its name pill
      const ERD_KEY_ICON = '<svg class="g-pk" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>';
      const ERD_LINK_ICON = '<svg class="g-fk" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      const ERD_CHEVRON_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      const ERD_NOTE_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h9"/></svg>';
      const ERD_DIR_ICONS = {
        LR: '<path d="M3 12h18"/><path d="m16 7 5 5-5 5"/>',
        TB: '<path d="M12 3v18"/><path d="m7 16 5 5 5-5"/>'
      };

      // --- STATE ---
      let erdSel = null;              // { kind: 'entity' | 'rel', id }: the clicked table or line (class `selected`)
      let hoverEntityId = null;
      let hoverRelId = null;
      let autoLayout = true;          // Auto-Tidy switch (not saved in the file)
      try { autoLayout = localStorage.getItem('erd-auto-layout') !== 'off'; } catch (e) {}
      let routedSig = null;           // signature of the inputs routeDiagram last ran on (skips the re-route on a re-render)

      const isTB = () => chartData.direction === 'TB';
      const erdEntities = () => chartData.entities || [];
      const erdRelsList = () => chartData.relationships || [];
      const erdGroups = () => chartData.groups || [];
      const erdEntity = (id) => erdEntities().find((e) => e.id === id);
      const erdRel = (id) => erdRelsList().find((r) => r.id === id);
      const erdDetail = () => (ERD_DETAILS.includes(chartData.detail) ? chartData.detail : 'all');

      function erdSvgEl(tag, attrs) {
        const el = document.createElementNS(ERD_SVG_NS, tag);
        Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
        return el;
      }
      function erdHtmlEl(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
      }

      // The state variants of the four end markers (stage.html has the base ones): the line's hover, in/out and
      // selected colours, applied through CSS variables on each line (see .erd-rel in erd.css)
      (function makeMarkerVariants() {
        ERD_END_KINDS.forEach((kind) => {
          const base = document.getElementById(`erd-end-${kind}`);
          if (!base) return;
          [['in', '--edge-in'], ['out', '--edge-out'], ['sel', '--primary']].forEach(([suffix, token]) => {
            const copy = base.cloneNode(true);
            copy.id = `${base.id}-${suffix}`;
            copy.style.setProperty('--mk', `var(${token})`);
            base.parentNode.appendChild(copy);
          });
        });
      })();

      // --- RENDERING ---
      const erdIsPlaced = (e) => typeof e.x === 'number' && typeof e.y === 'number';

      // The inputs routeDiagram reads, as text: a re-render that changes none of them (theme, fonts, undo to the same
      // state) keeps the routes it already has instead of searching them again
      function inputSignature() {
        const derived = new Set(['box', 'points', 'labelBox', 'canvas', '_band']);
        return JSON.stringify([chartData.direction, chartData.detail, chartData.showTypes, chartData.groups, chartData.entities, chartData.relationships],
          (k, v) => (derived.has(k) ? undefined : v));
      }

      function ensureLayout() {
        const ents = erdEntities();
        const derivedKept = !!chartData.canvas && ents.every((e) => e.box) && erdRelsList().every((r) => r.points);
        if (ents.some((e) => !erdIsPlaced(e))) {
          layoutDiagram(chartData);
        } else {
          const sig = inputSignature();
          if (!(derivedKept && sig === routedSig)) routeDiagram(chartData);
        }
        routedSig = inputSignature();
      }

      function groupColor(index) {
        const g = erdGroups()[index];
        return (g && g.color) || SWATCHES[index % SWATCHES.length].hex;
      }
      // The swatch an entity wears: its area's colour, or its own `color` when there are no areas ('' = neutral)
      function entityColor(e) {
        const groups = erdGroups();
        if (!groups.length) return e.color || '';
        const at = groups.findIndex((g) => g.id === e.group);
        return groupColor(at < 0 ? 0 : at);
      }

      function render() {
        ensureLayout();
        const C = chartData.canvas || { width: 800, height: 400 };
        const groups = erdGroups();
        const tb = isTB();
        erdCanvas.classList.toggle('dir-tb', tb);
        erdCanvas.classList.toggle('erd-no-bands', !groups.length);
        erdCanvas.style.width = `${C.width}px`;
        erdCanvas.style.height = `${C.height}px`;
        erdSvg.setAttribute('width', C.width);
        erdSvg.setAttribute('height', C.height);
        erdBands.textContent = '';
        erdRels.textContent = '';
        erdLeaders.textContent = '';
        erdHtml.textContent = '';
        if (erdSel && !(erdSel.kind === 'entity' ? erdEntity(erdSel.id) : erdRel(erdSel.id))) erdSel = null;
        if (hoverEntityId && !erdEntity(hoverEntityId)) hoverEntityId = null;
        if (hoverRelId && !erdRel(hoverRelId)) hoverRelId = null;

        renderBands(groups, tb);
        renderRelationships();
        erdEntities().forEach((e) => erdHtml.appendChild(buildEntity(e)));
        renderLabels();
        renderNotes(true);
        updateButtons();
        pinBands();
        applyHighlight();
      }

      function renderBands(groups, tb) {
        groups.forEach((g, i) => {
          if (!g.box) return;
          const band = erdHtmlEl('div', `erd-band swatch-scope${i % 2 ? ' erd-band-alt' : ''}`);
          band.dataset.groupId = g.id;
          band.style.left = `${g.box.x}px`;
          band.style.top = `${g.box.y}px`;
          band.style.width = `${g.box.w}px`;
          band.style.height = `${g.box.h}px`;
          band.style.setProperty('--swatch-color', groupColor(i));
          band.style.setProperty('--band-head', `${ER.BAND_HEAD}px`);
          const pill = erdHtmlEl('span', 'erd-band-pill', g.name || g.id);
          pill.style.maxHeight = tb ? '' : `${Math.max(60, g.box.h - 2 * ERD_PILL_INSET)}px`;
          pill.title = g.name || g.id;
          band.appendChild(erdHtmlEl('div', 'erd-band-rail'));
          band.appendChild(pill);
          erdBands.appendChild(band);
        });
      }

      // A table: header strip in its area's swatch, then one row per visible column
      function buildEntity(e) {
        const box = e.box || { x: 0, y: 0, w: ER.MIN_W, h: ER.HEAD_H };
        const detail = erdDetail();
        const showTypes = chartData.showTypes !== false;
        const vis = erVisibleColumns(e, chartData);
        const el = erdHtmlEl('div', 'erd-entity');
        el.dataset.nodeId = e.id;
        el.style.left = `${box.x}px`;
        el.style.top = `${box.y}px`;
        el.style.width = `${box.w}px`;
        el.style.height = `${box.h}px`;
        const color = entityColor(e);
        if (color) { el.classList.add('swatch-scope'); el.style.setProperty('--swatch-color', color); }
        const flat = !vis.cols.length && !vis.more;
        if (flat) el.classList.add('is-flat');
        if (e.collapsed === true) el.classList.add('is-collapsed');

        const head = erdHtmlEl('div', 'erd-head');
        const name = erdHtmlEl('span', 'erd-name', erName(e));
        name.title = erName(e);
        head.appendChild(name);
        if ((e.columns || []).length && detail !== 'names') {
          const chev = erdHtmlEl('button', 'erd-chevron');
          chev.type = 'button';
          chev.dataset.exportSkip = '';
          chev.title = e.collapsed ? 'Expand this table' : 'Collapse this table to its header';
          chev.setAttribute('aria-label', chev.title);
          chev.setAttribute('aria-expanded', String(e.collapsed !== true));
          chev.innerHTML = ERD_CHEVRON_ICON;
          chev.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          chev.addEventListener('click', (ev) => { ev.stopPropagation(); toggleCollapsed(e.id); });
          head.appendChild(chev);
        }
        el.appendChild(head);

        vis.cols.forEach(({ col }) => {
          const row = erdHtmlEl('div', `erd-row${col.pk ? ' pk' : ''}${col.fk ? ' fk' : ''}`);
          row.dataset.col = col.name;
          const glyph = erdHtmlEl('span', `erd-glyph${col.pk && col.fk ? ' both' : ''}`);
          if (col.pk) glyph.insertAdjacentHTML('beforeend', ERD_KEY_ICON);
          if (col.fk) glyph.insertAdjacentHTML('beforeend', ERD_LINK_ICON);
          glyph.title = col.pk && col.fk ? 'Primary key and foreign key' : col.pk ? 'Primary key' : col.fk ? 'Foreign key' : '';
          row.appendChild(glyph);
          row.appendChild(erdHtmlEl('span', 'erd-col-name', col.name));
          if (col.unique) {
            const u = erdHtmlEl('span', 'erd-uniq', 'U');
            u.title = 'Unique';
            row.appendChild(u);
          }
          if (showTypes && col.note) row.appendChild(erdHtmlEl('span', 'erd-col-note', col.note));
          if (showTypes) {
            const t = erdHtmlEl('span', 'erd-col-type', `${col.type == null ? '' : col.type}${col.nullable ? '?' : ''}`);
            if (col.nullable) t.title = 'Nullable';
            row.appendChild(t);
          } else if (col.note) {
            row.appendChild(erdHtmlEl('span', 'erd-col-note', col.note));
          }
          const tip = [col.pk && col.fk ? 'Primary key, foreign key' : col.pk ? 'Primary key' : col.fk ? 'Foreign key' : '',
            col.unique ? 'unique' : '', col.nullable ? 'nullable' : '', col.note || ''].filter(Boolean).join(' · ');
          if (tip) row.title = tip;
          el.appendChild(row);
        });
        if (vis.more) {
          const more = erdHtmlEl('div', 'erd-more', `+ ${vis.more} more`);
          more.title = `${vis.more} more column${vis.more === 1 ? '' : 's'} (the Columns button shows them)`;
          el.appendChild(more);
        }

        el.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType === 'touch') return;
          hoverEntityId = e.id;
          applyHighlight();
          peekSoon(e.id, NOTE_PEEK_DELAY);
        });
        el.addEventListener('pointerleave', (ev) => {
          if (ev.pointerType === 'touch') return;
          if (hoverEntityId === e.id) hoverEntityId = null;
          applyHighlight();
          unpeekSoon(e.id);
        });
        el.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0 || ev.target.closest('.erd-note-badge')) return;
          selectEntity(e.id);
        });
        const badge = buildNoteBadge(e);
        if (badge) el.appendChild(badge);
        return el;
      }

      // --- RELATIONSHIPS ---
      // A line from the child's key row to the parent's key row: rounded corners, and a small hop where it crosses an
      // earlier line's vertical run. `obstacles`: those vertical runs [{x, yMin, yMax}].
      function relationshipPath(points, obstacles) {
        let pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5);
        pts = pts.filter((p, i) => {
          if (i === 0 || i === pts.length - 1) return true;
          const a = pts[i - 1], b = pts[i + 1];
          return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.5;
        });
        if (pts.length < 2) return '';
        const last = pts.length - 1;
        const items = [pts[0]];
        for (let i = 0; i < last; i++) {
          const p1 = pts[i], p2 = pts[i + 1];
          if (Math.abs(p1[1] - p2[1]) < 1 && obstacles.length) {
            const right = p2[0] > p1[0];
            const lo = Math.min(p1[0], p2[0]), hi = Math.max(p1[0], p2[0]);
            // Room a hop needs from each end: past a bend the corner and the hop; at a table, the crow's foot
            const room = (k) => (k === 0 || k === last ? 30 : 14);
            const roomLo = right ? room(i) : room(i + 1), roomHi = right ? room(i + 1) : room(i);
            const hops = obstacles.filter((o) => o.x > lo + roomLo && o.x < hi - roomHi && p1[1] > o.yMin + 8 && p1[1] < o.yMax - 8)
              .map((o) => o.x).sort((a, b) => (right ? a - b : b - a));
            hops.forEach((x) => items.push({ hop: true, x, y: p1[1], dir: right ? 1 : -1 }));
          }
          items.push(p2);
        }
        let d = `M ${items[0][0]} ${items[0][1]}`;
        for (let i = 1; i < items.length; i++) {
          const it = items[i];
          if (it.hop) {   // a semicircle over the crossing, always bulging up
            d += ` L ${(it.x - ERD_HOP * it.dir).toFixed(1)} ${it.y} A ${ERD_HOP} ${ERD_HOP} 0 0 ${it.dir > 0 ? 1 : 0} ${(it.x + ERD_HOP * it.dir).toFixed(1)} ${it.y}`;
            continue;
          }
          const prev = items[i - 1], next = i < items.length - 1 ? items[i + 1] : null;
          if (next) {
            const a = prev.hop ? [prev.x + ERD_HOP * prev.dir, prev.y] : prev;
            const c = it;
            const b = next.hop ? [next.x - ERD_HOP * next.dir, next.y] : next;
            const vin = [c[0] - a[0], c[1] - a[1]], vout = [b[0] - c[0], b[1] - c[1]];
            const lin = Math.hypot(vin[0], vin[1]), lout = Math.hypot(vout[0], vout[1]);
            if (lin > 0.5 && lout > 0.5) {
              // The first and last segments belong to one bend; a middle one is shared by two
              const roomIn = (i - 1 === 0 || prev.hop) ? lin : lin / 2;
              const roomOut = (i + 1 === items.length - 1 || next.hop) ? lout : lout / 2;
              const r = Math.min(ERD_RADIUS, roomIn, roomOut);
              d += ` L ${(c[0] - vin[0] / lin * r).toFixed(1)} ${(c[1] - vin[1] / lin * r).toFixed(1)} Q ${c[0]} ${c[1]} ${(c[0] + vout[0] / lout * r).toFixed(1)} ${(c[1] + vout[1] / lout * r).toFixed(1)}`;
              continue;
            }
          }
          d += ` L ${it[0]} ${it[1]}`;
        }
        return d;
      }

      function renderRelationships() {
        const rels = erdRelsList();
        const verticals = [];   // per relationship, its vertical runs
        rels.forEach((rel) => {
          const v = [];
          const p = rel.points || [];
          for (let k = 1; k < p.length; k++) {
            if (p[k][0] === p[k - 1][0] && p[k][1] !== p[k - 1][1]) v.push({ x: p[k][0], yMin: Math.min(p[k][1], p[k - 1][1]), yMax: Math.max(p[k][1], p[k - 1][1]) });
          }
          verticals.push(v);
        });
        rels.forEach((rel, i) => {
          if (!rel.points || rel.points.length < 2) return;
          const ends = erRelEnds(rel, chartData);
          const earlier = [].concat(...verticals.slice(0, i));   // each crossing is hopped once: by the later line
          const d = relationshipPath(rel.points, earlier);
          const g = erdSvgEl('g', { class: 'erd-rel', 'data-edge-id': rel.id, 'data-from': rel.from, 'data-to': rel.to });
          const hit = erdSvgEl('path', { class: 'erd-rel-hit', d });
          const line = erdSvgEl('path', { class: `erd-rel-line${rel.identifying === true ? ' identifying' : ''}`, d });
          const fromKind = ERD_END_KINDS.includes(ends.fromEnd) ? ends.fromEnd : 'zeroOrMany';
          const toKind = ERD_END_KINDS.includes(ends.toEnd) ? ends.toEnd : 'one';
          [['', ''], ['-in', '-in'], ['-out', '-out'], ['-sel', '-sel']].forEach(([suffix]) => {
            const key = suffix.replace('-', '');
            line.style.setProperty(`--mk-s${key ? '-' + key : ''}`, `url(#erd-end-${fromKind}${suffix})`);
            line.style.setProperty(`--mk-e${key ? '-' + key : ''}`, `url(#erd-end-${toKind}${suffix})`);
          });
          g.appendChild(hit);
          g.appendChild(line);
          g.addEventListener('pointerenter', (ev) => {
            if (ev.pointerType === 'touch') return;
            hoverRelId = rel.id;
            applyHighlight();
          });
          g.addEventListener('pointerleave', () => { if (hoverRelId === rel.id) hoverRelId = null; applyHighlight(); });
          g.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); selectRel(rel.id); } });
          erdRels.appendChild(g);
        });
      }

      function renderLabels() {
        erdRelsList().forEach((rel) => {
          const b = rel.labelBox;
          const text = rel.label === undefined || rel.label === null ? '' : String(rel.label);
          if (!b || !text) return;
          const el = erdHtmlEl('div', 'erd-rel-label');
          el.dataset.edgeId = rel.id;
          el.style.left = `${b.x}px`;
          el.style.top = `${b.y}px`;
          el.style.width = `${b.w}px`;
          el.style.height = `${b.h}px`;
          el.title = text;
          el.appendChild(erdHtmlEl('span', 'erd-rel-label-text', text));
          el.addEventListener('pointerenter', (ev) => { if (ev.pointerType !== 'touch') { hoverRelId = rel.id; applyHighlight(); } });
          el.addEventListener('pointerleave', () => { if (hoverRelId === rel.id) hoverRelId = null; applyHighlight(); });
          el.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); selectRel(rel.id); } });
          erdHtml.appendChild(el);
        });
      }

      // --- HOVER AND SELECTION ---
      // Hover a table: the lines entering it (amber) and leaving it (blue) and the rows they join light up, the rest dims.
      // Hover a line: its two rows light up. Classes are the shell's transient ones (hover, linked, selected, hl-in,
      // hl-out), which an export strips.
      function joinedRows(rel) {
        const from = erdEntity(rel.from), to = erdEntity(rel.to);
        const out = [];
        if (from) {
          const names = (Array.isArray(rel.columns) ? rel.columns : []).filter((n) => (from.columns || []).some((c) => c.name === n));
          out.push({ id: from.id, cols: names });
        }
        if (to) {
          const named = (Array.isArray(rel.toColumns) ? rel.toColumns : []).filter((n) => (to.columns || []).some((c) => c.name === n));
          const first = erToCol(rel, to);
          out.push({ id: to.id, cols: named.length ? named : (first ? [first] : []) });
        }
        return out;
      }
      const entityEl = (id) => [...erdHtml.querySelectorAll('.erd-entity')].find((el) => el.dataset.nodeId === id);
      const relEl = (id) => [...erdRels.children].find((el) => el.dataset.edgeId === id);
      const labelEl = (id) => [...erdHtml.querySelectorAll('.erd-rel-label')].find((el) => el.dataset.edgeId === id);
      function markRows(rel, cls) {
        joinedRows(rel).forEach((end) => {
          const el = entityEl(end.id);
          if (!el) return;
          let shown = 0;
          [...el.querySelectorAll('.erd-row')].forEach((row) => {
            if (end.cols.includes(row.dataset.col)) { row.classList.add(cls); shown++; }
          });
          if (!shown) { const head = el.querySelector('.erd-head'); if (head) head.classList.add(cls); }   // a hidden column: the header
        });
      }

      function applyHighlight() {
        erdCanvas.querySelectorAll('.hl-in, .hl-out, .hover, .linked, .is-dim').forEach((el) => el.classList.remove('hl-in', 'hl-out', 'hover', 'linked', 'is-dim'));
        const keep = new Set();
        const keepRels = new Set();
        if (hoverEntityId) {
          keep.add(hoverEntityId);
          erdRelsList().forEach((rel) => {
            const kind = rel.from === hoverEntityId ? 'out' : rel.to === hoverEntityId ? 'in' : null;
            if (!kind) return;
            keep.add(rel.from); keep.add(rel.to); keepRels.add(rel.id);
            const g = relEl(rel.id), label = labelEl(rel.id);
            if (g) g.classList.add(`hl-${kind}`);
            if (label) label.classList.add(`hl-${kind}`);
            markRows(rel, `hl-${kind}`);
          });
        } else if (hoverRelId) {
          const rel = erdRel(hoverRelId);
          if (rel) {
            keep.add(rel.from); keep.add(rel.to); keepRels.add(rel.id);
            const g = relEl(rel.id), label = labelEl(rel.id);
            if (g) g.classList.add('hover');
            if (label) label.classList.add('hover');
            markRows(rel, 'hover');
          }
        }
        if (keep.size) {
          erdHtml.querySelectorAll('.erd-entity').forEach((el) => {
            if (keep.has(el.dataset.nodeId)) { if (el.dataset.nodeId !== hoverEntityId) el.classList.add('linked'); } else el.classList.add('is-dim');
          });
          [...erdRels.children, ...erdHtml.querySelectorAll('.erd-rel-label')].forEach((el) => { if (!keepRels.has(el.dataset.edgeId)) el.classList.add('is-dim'); });
        }
        // Selection
        erdCanvas.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
        if (erdSel) {
          const el = erdSel.kind === 'entity' ? entityEl(erdSel.id) : relEl(erdSel.id);
          if (el) el.classList.add('selected');
          if (erdSel.kind === 'rel') { const label = labelEl(erdSel.id); if (label) label.classList.add('selected'); }
        }
        applyNoteVisibility();
      }

      function selectEntity(id) {
        selectedNoteId = null;
        erdSel = { kind: 'entity', id };
        applyHighlight();
      }
      function selectRel(id) {
        selectedNoteId = null;
        erdSel = { kind: 'rel', id };
        applyHighlight();
      }

      // --- BAND NAME PILLS ---
      // Each area's pill sits at its band's start; once the view is panned past the header it stays at the visible
      // edge (left in LR, top in TB), with a stripe in the area's colour. Called after every render and every pan/zoom.
      function pinBands() {
        const groups = erdGroups();
        if (!groups.length) return;
        const left = erdCanvas.offsetLeft + erdCanvas.clientLeft;   // canvas origin, stage coordinates
        const top = erdCanvas.offsetTop + erdCanvas.clientTop;
        const visLeft = -panX / scale - left, visTop = -panY / scale - top;
        const visRight = visLeft + viewport.clientWidth / scale;
        const tb = isTB();
        const x0 = Math.max(0, visLeft), y0 = Math.max(0, visTop);
        [...erdBands.children].forEach((band) => {
          const g = groups.find((q) => q.id === band.dataset.groupId);
          const pill = band.querySelector('.erd-band-pill');
          if (!g || !g.box || !pill) return;
          const inset = ERD_PILL_INSET;
          band.style.setProperty('--rail-b', `${3 / scale}px`);
          if (tb) {
            band.style.removeProperty('--rail-x');
            band.style.setProperty('--rail-y', `${y0}px`);
            band.style.removeProperty('--pill-y');
            const pw = pill.offsetWidth, w = g.box.w;
            const a = Math.max(0, visLeft - g.box.x), b = Math.min(w, visRight - g.box.x);
            const x = Math.min(Math.max(b > a ? (a + b - pw) / 2 : (w - pw) / 2, inset), Math.max(inset, w - pw - inset));
            band.style.setProperty('--pill-x', `${x}px`);
            band.style.setProperty('--pill-cx', `${Math.max(inset, (w - pw) / 2)}px`);
            pill.style.top = `${y0 + 11}px`;
          } else {
            band.style.removeProperty('--rail-y');
            band.style.setProperty('--rail-x', `${x0}px`);
            band.style.setProperty('--pill-x', `${x0 + inset}px`);
            const ph = pill.offsetHeight;
            const y = Math.min(Math.max(visTop - g.box.y + inset, inset), Math.max(inset, g.box.h - ph - inset));
            band.style.setProperty('--pill-y', `${y}px`);
            pill.style.top = '';
          }
        });
      }

      // --- COLLAPSE ---
      function toggleCollapsed(id) {
        const e = erdEntity(id);
        if (!e) return;
        if (e.collapsed === true) delete e.collapsed; else e.collapsed = true;
        // TODO(wave 3): with Auto-Tidy off, re-route only (routeDiagram) so tables stay where they are
        layoutDiagram(chartData);
        render();
        updateStatus(true);
      }

      // --- DOCK: Columns, Types, Notes, direction, Auto-Tidy ---
      function updateButtons() {
        const detail = erdDetail();
        const modeLabel = { all: 'All', keys: 'Keys', names: 'Names' }[detail];
        if (erdBtnColumns) {
          const mode = erdBtnColumns.querySelector('.erd-mode');
          if (mode) mode.textContent = modeLabel;
          const next = { all: 'key columns only', keys: 'table names only', names: 'all columns' }[detail];
          erdBtnColumns.title = `Columns: ${{ all: 'all', keys: 'key columns only', names: 'table names only' }[detail]}. Click for ${next}`;
          erdBtnColumns.setAttribute('aria-label', `Columns: ${modeLabel}`);
        }
        if (erdBtnTypes) {
          const on = chartData.showTypes !== false;
          erdBtnTypes.setAttribute('aria-pressed', String(on));
          erdBtnTypes.title = on ? 'Hide the column types' : 'Show the column types';
        }
        if (erdBtnDirection) {
          const next = isTB() ? 'LR' : 'TB';
          const label = next === 'TB' ? 'Vertical' : 'Horizontal';
          erdBtnDirection.querySelector('.btn-label').textContent = label;
          erdBtnDirection.querySelector('svg').innerHTML = ERD_DIR_ICONS[next];
          erdBtnDirection.title = next === 'TB' ? 'Switch to a top-to-bottom layout' : 'Switch to a left-to-right layout';
          erdBtnDirection.setAttribute('aria-label', label);
        }
        if (erdBtnAuto) {
          erdBtnAuto.setAttribute('aria-checked', String(autoLayout));
          erdBtnAuto.title = autoLayout
            ? 'Auto-Tidy is on: the diagram re-arranges itself after every structural edit (click to place tables by hand)'
            : 'Auto-Tidy is off: tables stay where you drop them (click to re-arrange after every structural edit)';
        }
        updateNotesButton();
      }

      if (erdBtnColumns) erdBtnColumns.addEventListener('click', () => {
        const next = ERD_DETAILS[(ERD_DETAILS.indexOf(erdDetail()) + 1) % ERD_DETAILS.length];
        if (next === 'all') delete chartData.detail; else chartData.detail = next;
        layoutDiagram(chartData);   // sizes change; rank and order do not (check_golden.py)
        render();
        updateStatus(true);
        fitView();
      });
      if (erdBtnTypes) erdBtnTypes.addEventListener('click', () => {
        if (chartData.showTypes === false) delete chartData.showTypes; else chartData.showTypes = false;
        layoutDiagram(chartData);
        render();
        updateStatus(true);
      });
      if (erdBtnDirection) erdBtnDirection.addEventListener('click', () => {
        chartData.direction = isTB() ? 'LR' : 'TB';
        erdSel = null;
        notesList().forEach((n) => { delete n.pos; });   // a pinned note's offset is in screen terms, which the switch turns sideways
        layoutDiagram(chartData);
        render();
        updateStatus(true);
        fitView();
      });

      // --- AUTO-TIDY ---
      // On: every structural edit re-lays out (relayout()), as one undo step. Off: tables stay where they are put.
      // The choice is an editing preference of this browser, not part of the diagram.
      // TODO(wave 3): relayout() is called by the editing code after each structural edit.
      function relayout() {
        layoutDiagram(chartData);
        render();
        updateStatus(true);
      }
      if (erdBtnAuto) erdBtnAuto.addEventListener('click', () => {
        autoLayout = !autoLayout;
        try { localStorage.setItem('erd-auto-layout', autoLayout ? 'on' : 'off'); } catch (e) {}
        updateButtons();
        if (autoLayout) relayout();
      });

      // --- NOTES ---
      // Notes live in chartData.notes: { id, text, entities: [table ids], pos?: {x, y} }. The first table is the anchor.
      // A table with a note carries a badge; hover the badge (or the table) to peek, the Notes button shows them all
      // ("showNotes": true). Each unpinned note is fitted into a clear gap near its table on every render, and a dashed
      // leader joins the card to its tables. (The card is the flowchart's, and so is the fitting, with this type's
      // obstacles.) TODO(wave 3): editing, linking, pinning by drag.
      const NOTE_GAP = 8, NOTE_MIN_GAP = 10, NOTE_IDEAL_GAP = 20, NOTE_REACH = 168, NOTE_STEP = 8, NOTE_PEEK_DELAY = 100;
      let noteOffsets = {};          // noteId -> {x, y}: fitted top-left relative to its anchor table's top-left
      let noteSizes = {};            // noteId -> {w, h}
      let peekEntityId = null;       // the table whose notes hover peeks
      let selectedNoteId = null;     // a note kept open by a click on its badge or card
      let peekTimer = 0;
      let erdNotesLayer = null;

      const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
      const noteTextOf = (note) => (note && typeof note.text === 'string' ? note.text.trim() : '');
      const noteById = (id) => notesList().find((n) => n.id === id);
      const linkedEntities = (note) => (note.entities || []).filter((id) => erdEntity(id) && erdEntity(id).box);
      const liveNotes = () => notesList().filter((n) => noteTextOf(n) && linkedEntities(n).length);
      const notesOfEntity = (id) => liveNotes().filter((n) => (n.entities || []).includes(id));
      const erdPresenting = () => document.body.classList.contains('presentation');
      const boxesOverlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
      const boxGap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
      // Length of an axis-aligned segment that runs under box b
      function lengthUnder(s, b) {
        const [x1, y1, x2, y2] = s;
        if (y1 === y2) return (y1 > b.y && y1 < b.y + b.h) ? Math.max(0, Math.min(Math.max(x1, x2), b.x + b.w) - Math.max(Math.min(x1, x2), b.x)) : 0;
        if (x1 === x2) return (x1 > b.x && x1 < b.x + b.w) ? Math.max(0, Math.min(Math.max(y1, y2), b.y + b.h) - Math.max(Math.min(y1, y2), b.y)) : 0;
        return 0;
      }

      function renderNotes(refit) {
        erdNotesLayer = erdHtmlEl('div');
        erdNotesLayer.id = 'erd-notes';
        erdHtml.appendChild(erdNotesLayer);
        const live = liveNotes();
        live.forEach((note) => {
          const card = erdHtmlEl('div', 'erd-note');
          card.dataset.noteId = note.id;
          card.appendChild(erdHtmlEl('div', 'erd-note-text', note.text));
          card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          card.addEventListener('click', (ev) => { ev.stopPropagation(); selectedNoteId = selectedNoteId === note.id ? null : note.id; applyNoteVisibility(); });
          card.addEventListener('mouseenter', () => { if ((note.entities || []).includes(peekEntityId)) clearTimeout(peekTimer); });
          card.addEventListener('mouseleave', () => { if (peekEntityId) unpeekSoon(peekEntityId); });
          erdNotesLayer.appendChild(card);
          linkedEntities(note).forEach((id) => {
            erdLeaders.appendChild(erdSvgEl('line', { class: 'erd-note-leader', 'data-note-id': note.id, 'data-entity-id': id }));
          });
        });
        // Hidden cards have no size: measure them all at once, laid out but invisible
        erdNotesLayer.classList.add('measuring');
        noteSizes = {};
        live.forEach((n) => { const c = noteCard(n.id); noteSizes[n.id] = { w: c.offsetWidth, h: c.offsetHeight }; });
        erdNotesLayer.classList.remove('measuring');
        if (refit) noteOffsets = {};
        fitNotes(live);
        positionNotes();
      }
      const noteCard = (id) => [...erdNotesLayer.children].find((el) => el.dataset.noteId === id);

      // Give every note that is neither pinned nor fitted yet the cheapest spot within NOTE_REACH of its tables:
      // about NOTE_IDEAL_GAP away, off-centre for a single table; heavy penalties for covering a table, another note, a
      // label or the band header; a lighter one for hiding a line; a small one for leaving the canvas.
      function fitNotes(live) {
        const todo = live.filter((n) => !n.pos && !noteOffsets[n.id]);
        if (!todo.length) return;
        const C = chartData.canvas || { width: 0, height: 0 };
        const W = C.width, H = C.height;
        const head = erdGroups().length ? ER.BAND_HEAD : 0;
        const gutter = head ? (isTB() ? { x: 0, y: 0, w: W, h: head } : { x: 0, y: 0, w: head, h: H }) : null;
        const entityBoxes = erdEntities().filter((e) => e.box).map((e) => e.box);
        const labelBoxes = erdRelsList().filter((r) => r.labelBox).map((r) => r.labelBox);
        const segs = [];
        erdRelsList().forEach((r) => {
          const p = r.points || [];
          for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
        });
        const segBox = ([x1, y1, x2, y2]) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
        const boxesOf = {};
        live.forEach((n) => { boxesOf[n.id] = linkedEntities(n).map((id) => erdEntity(id).box); });
        const placed = live.filter((n) => n.pos || noteOffsets[n.id]).map((n) => {
          const o = n.pos || noteOffsets[n.id], a = boxesOf[n.id][0];
          return { x: a.x + o.x, y: a.y + o.y, w: noteSizes[n.id].w, h: noteSizes[n.id].h };
        });
        todo.sort((a, b) => boxesOf[a.id][0].x - boxesOf[b.id][0].x || boxesOf[a.id][0].y - boxesOf[b.id][0].y);
        todo.forEach((n) => {
          const R = boxesOf[n.id], s = noteSizes[n.id], single = R.length === 1;
          const ux = Math.min(...R.map((r) => r.x)), uy = Math.min(...R.map((r) => r.y));
          const ur = Math.max(...R.map((r) => r.x + r.w)), ub = Math.max(...R.map((r) => r.y + r.h));
          const win = { x: ux - s.w - NOTE_REACH, y: uy - s.h - NOTE_REACH, w: ur - ux + 2 * (s.w + NOTE_REACH), h: ub - uy + 2 * (s.h + NOTE_REACH) };
          const nb = entityBoxes.filter((b) => boxesOverlap(b, win, NOTE_GAP));
          const lb = labelBoxes.filter((b) => boxesOverlap(b, win, NOTE_GAP));
          const pb = placed.filter((b) => boxesOverlap(b, win, NOTE_GAP));
          const sg = segs.filter((q) => boxesOverlap(segBox(q), win, 2));
          let best = null;
          for (let y = Math.round(win.y); y <= win.y + win.h - s.h; y += NOTE_STEP) {
            for (let x = Math.round(win.x); x <= win.x + win.w - s.w; x += NOTE_STEP) {
              const b = { x, y, w: s.w, h: s.h };
              let cost = 0, tooClose = false;
              for (const r of R) {
                const gap = boxGap(b, r);
                if (gap < NOTE_MIN_GAP) { tooClose = true; break; }
                cost += Math.abs(gap - NOTE_IDEAL_GAP) * 10 / R.length;
              }
              if (tooClose) continue;
              if (single) {   // off-centre, not squarely above, below or beside: it reads as an annotation, not a table
                const r = R[0];
                const dxc = Math.abs(x + s.w / 2 - (r.x + r.w / 2)), dyc = Math.abs(y + s.h / 2 - (r.y + r.h / 2));
                const aboveOrBelow = y + s.h <= r.y || y >= r.y + r.h;
                cost += 160 * (aboveOrBelow ? Math.max(0, 1 - dxc / (r.w / 2)) : Math.max(0, 1 - dyc / (r.h / 2)));
              }
              if (best && cost >= best.cost) continue;
              if (gutter && boxesOverlap(b, gutter)) cost += 1e6;
              if (x < 0 || y < 0 || x + s.w > W || y + s.h > H) cost += 600;
              for (const o of nb) if (boxesOverlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of pb) if (boxesOverlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of lb) if (boxesOverlap(b, o, 4)) cost += 2e4;
              if (best && cost >= best.cost) continue;
              const halo = { x: x - 6, y: y - 6, w: s.w + 12, h: s.h + 12 };
              for (const q of sg) { const len = lengthUnder(q, halo); if (len) cost += 5000 + 30 * len; }
              if (!best || cost < best.cost) best = { x, y, cost };
            }
          }
          if (!best) best = { x: ur + NOTE_IDEAL_GAP, y: uy - s.h - NOTE_GAP, cost: 0 };
          noteOffsets[n.id] = { x: best.x - R[0].x, y: best.y - R[0].y };
          placed.push({ x: best.x, y: best.y, w: s.w, h: s.h });
        });
      }

      // Put every card at its anchor + offset and draw its leaders (centre to centre; they run under the opaque cards and tables)
      function positionNotes() {
        if (!erdNotesLayer) return;
        [...erdNotesLayer.children].forEach((card) => {
          const note = noteById(card.dataset.noteId);
          if (!note) return;
          const ids = linkedEntities(note), o = note.pos || noteOffsets[note.id];
          if (!ids.length || !o) return;
          const a = erdEntity(ids[0]).box, x = a.x + o.x, y = a.y + o.y, s = noteSizes[note.id] || { w: 0, h: 0 };
          card.style.left = `${x}px`;
          card.style.top = `${y}px`;
          [...erdLeaders.children].forEach((line) => {
            if (line.dataset.noteId !== note.id) return;
            const r = erdEntity(line.dataset.entityId).box;
            line.setAttribute('x1', x + s.w / 2);
            line.setAttribute('y1', y + s.h / 2);
            line.setAttribute('x2', r.x + r.w / 2);
            line.setAttribute('y2', r.y + r.h / 2);
          });
        });
        applyNoteVisibility();
      }

      function notePeeked(note) {
        const ids = note.entities || [];
        return note.id === selectedNoteId || ids.includes(peekEntityId) || (erdSel && erdSel.kind === 'entity' && ids.includes(erdSel.id));
      }
      function applyNoteVisibility() {
        if (!erdNotesLayer) return;
        const all = !!chartData.showNotes;
        erdCanvas.classList.toggle('notes-on', all);
        [...erdNotesLayer.children, ...erdLeaders.children].forEach((el) => {
          const note = noteById(el.dataset.noteId);
          if (!note) return;
          el.classList.toggle('show', all);
          el.classList.toggle('peek', !!notePeeked(note));
          if (el.classList.contains('erd-note')) el.classList.toggle('selected', note.id === selectedNoteId);
        });
      }
      // Hover: a table peeks its notes after NOTE_PEEK_DELAY (its badge at once); leaving lets them go after a grace
      // period, so the pointer can travel from the table to a card without it vanishing on the way
      function peekSoon(id, delay) {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => { if (peekEntityId !== id) { peekEntityId = id; applyNoteVisibility(); } }, delay);
      }
      function unpeekSoon(id) {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => { if (peekEntityId === id) { peekEntityId = null; applyNoteVisibility(); } }, 220);
      }
      function buildNoteBadge(e) {
        const notes = notesOfEntity(e.id);
        if (!notes.length) return null;
        const b = erdHtmlEl('button', 'erd-note-badge');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.setAttribute('aria-label', notes.map((n) => `Note: ${noteTextOf(n)}`).join(' · '));
        b.innerHTML = ERD_NOTE_ICON;
        b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        b.addEventListener('mouseenter', () => peekSoon(e.id, 0));
        // TODO(wave 3): a click edits the note (read-only in ?present); until then it keeps the note open or closes it
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          selectedNoteId = selectedNoteId === notes[0].id ? null : notes[0].id;
          applyNoteVisibility();
        });
        return b;
      }

      // Notes button: pressed while every note is on show; the count says how many there are
      function updateNotesButton() {
        if (!erdBtnNotes) return;
        const count = notesList().filter((n) => noteTextOf(n)).length;
        const on = !!chartData.showNotes;
        erdBtnNotes.setAttribute('aria-pressed', String(on));
        erdBtnNotes.disabled = !count && !on;
        const c = erdBtnNotes.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        erdBtnNotes.title = !count ? 'No notes yet: select a table and add one with the Note button'
          : on ? 'Hide the notes (hover a table’s badge to peek at one)' : 'Show all notes';
      }
      if (erdBtnNotes) erdBtnNotes.addEventListener('click', () => {
        if (chartData.showNotes) delete chartData.showNotes; else chartData.showNotes = true;
        peekEntityId = null;
        applyNoteVisibility();
        updateNotesButton();
        updateStatus(true);
      });

      // --- DISK FORMAT (the page's data block) ---
      // Written for a reader: fixed key order, each table's flow-term x/y in one trailing "layout" map, derived
      // geometry dropped, editor-generated ids renamed (tables and areas after their name, r<N>, n<N>). The in-memory
      // model keeps x/y on the tables. scripts/disk_format.py (ERD_KEYS, erd_to_disk) is the Python twin: keep the two
      // byte-identical (dev/e2e_erd.mjs saves a generated page without edits and compares).
      const ERD_DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'direction', 'detail', 'showTypes', 'showNotes', 'colorKey',
        'groups', 'entities', 'relationships', 'notes', 'layout'];
      const ERD_DERIVED = [['entities', ['box']], ['groups', ['box']], ['relationships', ['points', 'labelBox']]];
      const ERD_GENERATED_ID = /^(t|r|g|n)_\d{12,}(_\d+)?$/;   // page ids: <prefix>_<Date.now()>[_k]
      const ERD_SLUG_MAX = 30;

      function slug(text, sep = '_') {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
        if (s.length > ERD_SLUG_MAX) s = s.slice(0, ERD_SLUG_MAX).replace(new RegExp(`${sep}+$`), '');
        return s;
      }

      function renameGeneratedIds(d) {
        const gs = d.groups || [], es = d.entities || [], rs = d.relationships || [], ns = d.notes || [];
        const used = new Set([...gs, ...es, ...rs, ...ns].map((o) => o.id));
        const rename = new Map();
        const take = (base) => {
          let id = base, k = 2;
          while (used.has(id)) id = `${base}_${k++}`;
          used.add(id);
          return id;
        };
        const generated = (o) => ERD_GENERATED_ID.test(String(o.id || ''));
        [[es, 'table'], [gs, 'area']].forEach(([items, fallback]) => items.forEach((o) => {
          if (generated(o)) rename.set(o.id, take(slug(o.name) || fallback));
        }));
        [[rs, 'r'], [ns, 'n']].forEach(([items, prefix]) => {
          let count = 1;
          items.forEach((o) => {
            if (!generated(o)) return;
            while (used.has(`${prefix}${count}`)) count++;
            rename.set(o.id, take(`${prefix}${count}`));
          });
        });
        if (!rename.size) return;
        const r = (id) => (rename.has(id) ? rename.get(id) : id);
        [...gs, ...es, ...rs, ...ns].forEach((o) => { o.id = r(o.id); });
        es.forEach((e) => { if ('group' in e) e.group = r(e.group); });
        rs.forEach((rel) => ['from', 'to'].forEach((k) => { if (k in rel) rel[k] = r(rel[k]); }));
        ns.forEach((n) => { if (Array.isArray(n.entities)) n.entities = n.entities.map(r); });
      }

      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        delete d.layout;
        delete d.canvas;
        delete d._band;
        ERD_DERIVED.forEach(([list, keys]) => (d[list] || []).forEach((o) => keys.forEach((k) => { delete o[k]; })));
        renameGeneratedIds(d);
        const layout = {};
        (d.entities || []).forEach((e) => {
          const pos = {};
          ['x', 'y'].forEach((k) => { if (k in e) { pos[k] = e[k]; delete e[k]; } });
          if (Object.keys(pos).length) layout[e.id] = pos;
        });
        if (Object.keys(layout).length) d.layout = layout;
        const out = {};
        ERD_DISK_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }

      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        const layout = d.layout || {};
        delete d.layout;
        (d.entities || []).forEach((e) => Object.assign(e, layout[e.id] || {}));
        return d;
      }

      // --- MERMAID (erDiagram) ---
      // Tables with attributes (PK, FK, UK) and the four end kinds; areas, notes and positions are not representable.
      // The parent is written first: its marker is the relationship's toEnd, the child's marker is its fromEnd.
      function toMermaid() {
        const left = { one: '||', zeroOrOne: '|o', oneOrMany: '}|', zeroOrMany: '}o' };
        const right = { one: '||', zeroOrOne: 'o|', oneOrMany: '|{', zeroOrMany: 'o{' };
        const word = (s, fallback) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_\-\[\]()]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
        const nameOf = (e) => {
          const n = String(erName(e));
          return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(n) ? n : `"${n.replace(/"/g, "'")}"`;
        };
        const lines = ['erDiagram'];
        erdRelsList().forEach((rel) => {
          const from = erdEntity(rel.from), to = erdEntity(rel.to);
          if (!from || !to) return;
          const ends = erRelEnds(rel, chartData);
          const label = rel.label ? `"${String(rel.label).replace(/"/g, "'")}"` : '""';
          lines.push(`    ${nameOf(to)} ${left[ends.toEnd] || left.one}${rel.identifying === true ? '--' : '..'}${right[ends.fromEnd] || right.zeroOrMany} ${nameOf(from)} : ${label}`);
        });
        erdEntities().forEach((e) => {
          lines.push(`    ${nameOf(e)} {`);
          (e.columns || []).forEach((c) => {
            const keys = [c.pk ? 'PK' : '', c.fk ? 'FK' : '', c.unique ? 'UK' : ''].filter(Boolean).join(', ');
            const comment = c.note ? ` "${String(c.note).replace(/"/g, "'")}"` : '';
            lines.push(`        ${word(c.type, 'string')} ${word(c.name, 'column')}${keys ? ' ' + keys : ''}${comment}`);
          });
          lines.push('    }');
        });
        return lines.join('\n') + '\n';
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'erd',
        defaultTitle: 'Interactive ER Diagram',
        toDisk,
        fromDisk,
        toMermaid,
        contentEl: erdCanvas,
        report: { node: '.erd-entity', label: '.erd-rel-label', labelText: '.erd-rel-label-text', nodeText: '.erd-name' },
        render,
        isBackground: (el) => el === erdCanvas || el === erdSvg || el === erdHtml || el === erdBands || el.id === 'erd-notes'
          || el.classList.contains('erd-band') || el.classList.contains('erd-band-rail') || el.classList.contains('erd-band-pill'),
        clearSelection() {
          erdSel = null;
          selectedNoteId = null;
          peekEntityId = null;
          applyHighlight();
        },
        cancelInteraction() { return false; },   // TODO(wave 3): cancel a relationship being drawn, a drag, a text edit
        hasSelection() { return false; },        // TODO(wave 3): true while a table, column, line, area or note is selected
        deleteSelection() {},                    // TODO(wave 3)
        onViewChange: pinBands,
        // Notes on show may sit in the margin outside the canvas: Fit and screenshots take them in (peeked ones are
        // transient and do not count)
        contentOverflow() {
          if (!erdNotesLayer || !chartData.showNotes) return null;
          const W = erdCanvas.offsetWidth, H = erdCanvas.offsetHeight, PAD = 12;
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          [...erdNotesLayer.children].forEach((card) => {
            const x = parseFloat(card.style.left) || 0, y = parseFloat(card.style.top) || 0, w = card.offsetWidth, h = card.offsetHeight;
            if (!w) return;
            o.left = Math.max(o.left, PAD - x);
            o.top = Math.max(o.top, PAD - y);
            o.right = Math.max(o.right, x + w + PAD - W);
            o.bottom = Math.max(o.bottom, y + h + PAD - H);
          });
          return o;
        }
      });
