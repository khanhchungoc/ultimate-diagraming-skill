      // --- ER DIAGRAM PLUGIN ---
      // Renders chartData (diagramType "erd") from the model engine.js lays out: tables with column rows (tinted by
      // their own `color`), relationship curves (one cubic Bezier each, leaving a table side at right angles, crow's-foot
      // ends), label pills and notes, and edits it (EDITING below): add, rename, keys, reorder, colour, draw and re-point
      // relationships, notes, delete. Every finished edit ends in one updateStatus(true) (one undo
      // step): commit() for structural ones, which keeps every table where it is and only re-routes the lines.
      //
      // Model (see engine.js header): entities[].x/y (absolute top-left) are the only positions that are saved (the
      // "layout" map); box, curve, points, labelBox and data.canvas are derived on every render (layoutDiagram when any
      // table lacks x/y, else routeDiagram) and never saved (toDisk drops them). Everything on screen is absolute
      // within #erd-canvas.
      //
      // State kept in this file (module scope): erdSel (selection: table, column or line), hoverEntityId / hoverRelId
      // (highlight), the note fitting caches, and peek/selected note.
      // Render entry points: render() (everything), applyHighlight() (hover/selection classes, the related tables and
      // their key rows, chips and peeks only), applyNoteVisibility() (notes only).

      const ERD_SVG_NS = 'http://www.w3.org/2000/svg';
      const erdCanvas = document.getElementById('erd-canvas');
      const erdSvg = document.getElementById('erd-svg');
      const erdRels = document.getElementById('erd-rels');
      const erdLeaders = document.getElementById('erd-note-leaders');
      const erdHtml = document.getElementById('erd-html');
      const erdBtnColumns = document.getElementById('btn-columns');
      const erdBtnTypes = document.getElementById('btn-types');
      const erdBtnNotes = document.getElementById('btn-notes');

      const ERD_DETAILS = ['all', 'keys', 'names'];
      const ERD_END_KINDS = ['one', 'zeroOrOne', 'oneOrMany', 'zeroOrMany'];
      const ERD_KEY_ICON = ui.icon('key', { size: 'sm', bold: true, class: 'g-pk' });
      const ERD_LINK_ICON = ui.icon('link', { size: 'sm', bold: true, class: 'g-fk' });
      const ERD_NOTE_ICON = ui.icon('note-lines', { size: 'xs', bold: true });

      // --- STATE ---
      let erdSel = null;              // { kind: 'entity' | 'rel', id } | { kind: 'col', entity, col } | { kind: 'key', color }: class `selected`
      let erdKeyDraft = null;         // a colour whose legend entry is being named for the first time (shown only while it is edited)
      // Several tables selected (see MULTI-SELECT): the ids, valid only while erdSel is still the primary's selection
      // object they were made for (a direct erdSel = ... elsewhere drops the group). Never saved.
      let erdMultiIds = [];
      let erdMultiOwner = null;
      let hoverEntityId = null;
      let hoverRelId = null;
      let routedSig = null;           // signature of the inputs routeDiagram last ran on (skips the re-route on a re-render)

      const erdEntities = () => chartData.entities || [];
      const erdRelsList = () => chartData.relationships || [];
      const erdEntity = (id) => erdEntities().find((e) => e.id === id);
      const erdRel = (id) => erdRelsList().find((r) => r.id === id);
      // The column of the parent a line enters: the first toColumns name that exists, else its first primary key
      function erdToCol(rel, to) {
        const cols = to.columns || [];
        const named = (Array.isArray(rel.toColumns) ? rel.toColumns : []).find((n) => cols.some((c) => c.name === n));
        if (named) return named;
        const pk = cols.find((c) => c.pk);
        return pk ? pk.name : null;
      }
      // The selected tables, primary last (one table when a single table or one of its columns is selected)
      function selectedEntityIds() {
        if (erdSel && erdSel.kind === 'entity' && erdSel === erdMultiOwner) {
          const ids = erdMultiIds.filter((id) => erdEntity(id));
          if (ids.length > 1 && ids.includes(erdSel.id)) return ids.filter((id) => id !== erdSel.id).concat(erdSel.id);
        }
        const one = erdSel && (erdSel.kind === 'entity' ? erdSel.id : erdSel.kind === 'col' ? erdSel.entity : null);
        return one && erdEntity(one) ? [one] : [];
      }
      const isMultiSelected = () => selectedEntityIds().length > 1 && erdSel.kind === 'entity';
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

      // The highlighted variant of the four end markers (stage.html has the base ones): the primary colour of a hovered or
      // selected line, applied through CSS variables on each line (see .erd-rel in erd.css)
      (function makeMarkerVariants() {
        ERD_END_KINDS.forEach((kind) => {
          const base = document.getElementById(`erd-end-${kind}`);
          if (!base) return;
          const copy = base.cloneNode(true);
          copy.id = `${base.id}-sel`;
          copy.style.setProperty('--mk', 'var(--primary)');
          base.parentNode.appendChild(copy);
        });
      })();

      // --- RENDERING ---
      const erdIsPlaced = (e) => typeof e.x === 'number' && typeof e.y === 'number';

      // The inputs routeDiagram reads, as text: a re-render that changes none of them (theme, fonts, undo to the same
      // state) keeps the routes it already has instead of searching them again
      function inputSignature() {
        const derived = new Set(['box', 'curve', 'points', 'labelBox', 'canvas', '_loose']);
        return JSON.stringify([chartData.detail, chartData.showTypes, chartData.entities, chartData.relationships],
          (k, v) => (derived.has(k) ? undefined : v));
      }

      // layoutDiagram also routes, so remember that the inputs are routed (render() would otherwise route again).
      function erdLayout() {
        layoutDiagram(chartData);
        routedSig = inputSignature();
      }

      // --- BACKGROUND LAYOUT ---
      // A cold layout of 30 tables takes seconds, so a diagram of ERD_ASYNC_MIN tables or more is laid out in a Web Worker
      // built from the engine's own source (provided by the shell's loadEngineSource() helper).
      // The result is applied only if the model is unchanged since it was posted, else it is dropped. Without Worker, Blob or
      // the markers, or under ?tidy / ?report (which read the finished layout at once), the layout runs synchronously.
      // shortcut: 10 tables is the point where the worker's start-up stops costing more than the layout, upgrade if that moves.
      const ERD_ASYNC_MIN = 10;
      const erdEngineSrc = () => (typeof loadEngineSource === 'function' ? loadEngineSource() : '');
      const ERD_WORKER_TAIL = '\nonmessage = (e) => { const { seq, data, opts } = e.data; layoutDiagram(data, opts); postMessage({ seq, data }); };';
      let erdJob = null, erdSeq = 0;

      const erdAsyncOK = () => !!erdEngineSrc() && typeof Worker === 'function' && erdEntities().length >= ERD_ASYNC_MIN
        && !/[?&](tidy|report)(=|&|$)/.test(window.location.search);

      function erdEndJob() {
        if (!erdJob) return;
        erdJob.worker.terminate();
        URL.revokeObjectURL(erdJob.url);
        erdJob = null;
        delete document.body.dataset.erdBusy;
        erdHint(null);
      }

      // Posts the model to a new worker (replacing a running one); false when a worker cannot be made. after() runs once the
      // positions are in.
      function erdStartJob(after) {
        erdEndJob();
        let worker, url;
        try {
          // TOKENS sits outside the engine markers (the shell reads it first), so the worker is given its own copy
          url = URL.createObjectURL(new Blob([`const TOKENS = ${JSON.stringify(TOKENS)};\n` + erdEngineSrc() + ERD_WORKER_TAIL], { type: 'text/javascript' }));
          worker = new Worker(url);
        } catch (e) {
          if (url) URL.revokeObjectURL(url);
          return false;
        }
        const job = erdJob = { seq: ++erdSeq, worker, url, after, sig: inputSignature() };
        worker.onmessage = (ev) => erdFinishJob(job, ev.data);
        worker.onerror = (ev) => { ev.preventDefault(); erdFinishJob(job, null); };
        worker.postMessage({ seq: job.seq, data: chartData });
        document.body.dataset.erdBusy = '';
        erdHint('Laying out the diagram…', true, true);
        return true;
      }

      function erdFinishJob(job, result) {
        if (job !== erdJob || (result && result.seq !== erdSeq)) return;   // replaced meanwhile
        erdEndJob();
        if (!result) { erdLayout(); job.after(); return; }          // the worker failed (CSP): lay out here
        if (inputSignature() !== job.sig) return;                          // the model changed while it ran: stale
        const byId = (list) => new Map(list.map((x) => [x.id, x]));
        const ents = byId(erdEntities()), rels = byId(erdRelsList());
        result.data.entities.forEach((e) => Object.assign(ents.get(e.id), e));
        (result.data.relationships || []).forEach((r) => Object.assign(rels.get(r.id), r));
        chartData.canvas = result.data.canvas;
        routedSig = inputSignature();
        job.after();
      }

      // Lays out (a full layout) and then runs after() (render, undo step). In the background when erdAsyncOK: the
      // screen shows the edit on the old layout meanwhile.
      function erdLayoutThen(after) {
        if (erdAsyncOK() && erdStartJob(after)) render();
        else { erdLayout(); after(); }
      }

      // Tables without a position, while the worker lays them out: a grid, so the page can draw something. The job's
      // signature is taken again because the model's x/y changed.
      function erdProvisional() {
        const todo = erdEntities().filter((e) => !erdIsPlaced(e)), cols = Math.ceil(Math.sqrt(todo.length));
        todo.forEach((e, i) => { e.x = ER.MARGIN + (i % cols) * (ER.MAX_W + ER.GAP_X); e.y = ER.MARGIN + Math.floor(i / cols) * 360; });
        if (erdJob) erdJob.sig = inputSignature();
      }

      function ensureLayout() {
        const ents = erdEntities();
        const derivedKept = !!chartData.canvas && ents.every((e) => e.box) && erdRelsList().every((r) => r.curve);
        if (ents.some((e) => !erdIsPlaced(e))) {
          // anything unplaced (a v1/v2 page, a table made by hand): the whole diagram is laid out
          const background = erdJob || (erdAsyncOK() && erdStartJob(() => {
            render({ duration: 260, easing: 'curve-spring-settle', skipFreeNotes: true });
            fitView(true);
            committedJson = savedJson = JSON.stringify(chartData);   // the laid-out page is the one that counts as unedited
            setStatusBadge(false);
          }));
          if (background) { erdProvisional(); routeDiagram(chartData); } else layoutDiagram(chartData);
        } else {
          const sig = inputSignature();
          if (!(derivedKept && sig === routedSig)) routeDiagram(chartData);
        }
        routedSig = inputSignature();
      }

      // The swatch a table wears ('' = neutral)
      const entityColor = (e) => e.color || '';
      const ERD_KEY_GAP = 34;   // the legend sits this far above the top-left corner of the tables
      const ERD_FLIP_SPECS = [
        { selector: '.erd-entity[data-node-id]', key: 'nodeId', mode: 'clip' },
        { selector: '.erd-row[data-col]', key: (el) => { const p = el.closest('.erd-entity[data-node-id]'); return p ? `${p.dataset.nodeId}:${el.dataset.col}` : ''; } },
        { selector: '.edge-label[data-edge-id]', key: 'edgeId' },
        { selector: '.note[data-note-id]', key: 'noteId' },
        { selector: '.color-key-item[data-color]', key: 'color' }
      ];
      const ERD_TIDY_FLIP_SPECS = ERD_FLIP_SPECS.filter((_, i) => i !== 1);
      const ERD_NUM_RE = /-?[\d.]+(?:e[-+]?\d+)?/gi;
      let erdInRender = false;
      function erdCapture(opts) {
        if (!motion.enabled()) return null;
        const specs = opts && opts.skipRows ? ERD_TIDY_FLIP_SPECS : ERD_FLIP_SPECS;
        const html = motion.capture(erdCanvas, specs, opts);
        if (!html) return null;
        const beziers = new Map();
        erdRels.querySelectorAll('.erd-rel[data-edge-id] .edge-line').forEach((line) => {
          const nums = (line.getAttribute('d') || '').match(ERD_NUM_RE);
          if (nums && nums.length === 8) beziers.set(line.parentNode.dataset.edgeId, nums.map(Number));
        });
        const leaders = new Map();
        erdLeaders.querySelectorAll('.note-leader[data-note-id][data-entity-id]').forEach((ln) => {
          leaders.set(`${ln.dataset.noteId}:${ln.dataset.entityId}`,
            [+ln.getAttribute('x1'), +ln.getAttribute('y1'), +ln.getAttribute('x2'), +ln.getAttribute('y2')]);
        });
        return { html, beziers, leaders };
      }
      function erdPlay(snap, opts) {
        if (!snap || !motion.enabled()) return;
        const o = opts || {};
        const skipKeys = o.skipKeys ? new Set(o.skipKeys) : new Set();
        if (o.skipFreeNotes) notesList().forEach((n) => { if (isFreeNote(n)) skipKeys.add(n.id); });
        const specs = o.skipRows ? ERD_TIDY_FLIP_SPECS : ERD_FLIP_SPECS;
        const durMs = motion.play(snap.html, erdCanvas, specs, Object.assign({}, o, { skipKeys }));
        if (o.shrinkGhosts) {
          const st = stage.getBoundingClientRect();
          const k = (stage.offsetWidth ? st.width / stage.offsetWidth : scale) || 1;
          const op = o.shrinkOpacity ?? 0.9;
          for (const [key, prev] of snap.html) {
            if (!key.startsWith('0:') || !prev.preCloned) continue;
            const cur = entityEl(prev.id);
            if (!cur) continue;
            const dw = prev.baseW - cur.offsetWidth, dh = prev.baseH - cur.offsetHeight;
            if (dw <= 2 && dh <= 2) continue;
            const cvr = cur.getBoundingClientRect();
            const dx = (cvr.left - st.left) / k - prev.x, dy = (cvr.top - st.top) / k - prev.y;
            motion.ghostExit(prev.el, {
              preCloned: prev.preCloned, fromRect: prev.vr, baseW: prev.baseW, baseH: prev.baseH,
              transform: `translate(${dx}px, ${dy}px)`,
              clipPath: `inset(0 ${Math.max(0, dw)}px ${Math.max(0, dh)}px 0 round var(--radius-lg))`,
              opacity: op, duration: durMs || 200, easing: o.easing || 'curve-spring-settle'
            });
          }
        }
        const tracks = [];
        erdRels.querySelectorAll('.erd-rel[data-edge-id]').forEach((g) => {
          const id = g.dataset.edgeId, line = g.querySelector('.edge-line'), rel = erdRel(id);
          const from = snap.beziers.get(id);
          if (from && rel && rel.curve && rel.curve.length === 4) {
            const to = rel.curve.flat();
            if (to.some((v, i) => Math.abs(v - from[i]) > 0.5)) tracks.push({ type: 'bezier', el: line, from, to });
          } else if (o.drawNewRels && line) {
            motion.drawPath(line, { duration: 140, easing: 'curve-out' });
          }
        });
        erdLeaders.querySelectorAll('.note-leader[data-note-id][data-entity-id]').forEach((ln) => {
          const key = `${ln.dataset.noteId}:${ln.dataset.entityId}`, from = snap.leaders.get(key);
          const to = [+ln.getAttribute('x1'), +ln.getAttribute('y1'), +ln.getAttribute('x2'), +ln.getAttribute('y2')];
          if (from) {
            if (to.some((v, i) => Math.abs(v - from[i]) > 0.5)) tracks.push({ type: 'line', el: ln, from, to });
          } else if (o.drawNewLeaders) {
            motion.drawPath(ln, { duration: 150, easing: 'curve-out' });
          }
        });
        if (tracks.length) motion.tweenSvg(tracks, { duration: o.duration ?? durMs, easing: o.easing || 'curve-spring-settle' });
      }

      function render(motionOpts) {
        const m = motionOpts === false ? null : (motionOpts || {});
        const snap = m ? (m.snap || erdCapture(m.shrinkGhosts || m.skipRows ? { ghosts: !!m.shrinkGhosts, skipRows: !!m.skipRows } : undefined)) : null;
        ensureLayout();
        const C = chartData.canvas || { width: 800, height: 400 };
        erdCanvas.style.width = `${C.width}px`;
        erdCanvas.style.height = `${C.height}px`;
        erdSvg.setAttribute('width', C.width);
        erdSvg.setAttribute('height', C.height);
        const oldBar = erdHtml.querySelector('.erd-actionbar');
        let oldBarRect = null;
        if (oldBar) {
          if (!erdSel || erdPresenting()) motion.hideBar(oldBar);
          else { oldBarRect = oldBar.getBoundingClientRect(); oldBar.remove(); }
        }
        erdRels.textContent = '';
        erdLeaders.textContent = '';
        erdHtml.textContent = '';
        if (erdSel && !erdSelExists(erdSel)) erdSel = null;
        if (selectedNoteId && !noteById(selectedNoteId)) selectedNoteId = null;
        if (hoverEntityId && !erdEntity(hoverEntityId)) hoverEntityId = null;
        if (hoverRelId && !erdRel(hoverRelId)) hoverRelId = null;

        erdInRender = true;
        try {
          erdHideCard();
          renderRelationships();
          erdEntities().forEach((e) => erdHtml.appendChild(buildEntity(e)));
          drawKey();
          renderLabels();
          renderNotes(true);
          updateButtons();
          erdUpdateOverview(true);
          applyHighlight();
          drawSelectionTools(oldBarRect);
        } finally { erdInRender = false; }
        if (snap) erdPlay(snap, m);
        if (m && m.collapseId && motion.enabled()) {
          const ent = erdEntity(m.collapseId), chev = entityEl(m.collapseId)?.querySelector('.chevron svg');
          if (ent && chev) {
            const on = ent.collapsed === true;
            motion.anim(chev, [{ transform: on ? 'rotate(0deg)' : 'rotate(-90deg)' }, { transform: on ? 'rotate(-90deg)' : 'none' }],
              { duration: 180, easing: motion.curve('curve-inout') });
          }
        }
      }
      function erdSelExists(sel) {
        if (sel.kind === 'entity') return !!erdEntity(sel.id);
        if (sel.kind === 'rel') return !!erdRel(sel.id);
        if (sel.kind === 'col') { const e = erdEntity(sel.entity); return !!e && (e.columns || []).some((c) => c.name === sel.col); }
        if (sel.kind === 'key') return !!(chartData.colorKey && chartData.colorKey[sel.color]) && erdKeyColors().includes(sel.color);
        return false;
      }

      // A table: header strip in its area's swatch, then one row per visible column
      // `asCard`: the table drawn for the overview's expanded card (every column, nothing to press, no ports)
      function buildEntity(src, asCard) {
        const e = asCard ? Object.assign({}, src, { collapsed: false }) : src;
        const box = src.box || { x: 0, y: 0, w: ER.MIN_W, h: ER.HEAD_H };
        const detail = erdDetail();
        const showTypes = chartData.showTypes !== false;
        const vis = erVisibleColumns(e, chartData);
        const el = erdHtmlEl('div', 'erd-entity');
        el.dataset.item = '';
        if (asCard) {
          el.classList.add('erd-card-table');
          el.style.minWidth = `${box.w}px`;
        } else {
          el.dataset.nodeId = e.id;
          el.style.left = `${box.x}px`;
          el.style.top = `${box.y}px`;
          el.style.width = `${box.w}px`;
          el.style.height = `${box.h}px`;
        }
        const color = entityColor(e);
        if (color) setSwatch(el, color);
        const flat = !vis.cols.length && !vis.more;
        if (flat) el.classList.add('is-flat');
        if (e.collapsed === true) el.classList.add('is-collapsed');

        const head = erdHtmlEl('div', 'erd-head');
        const name = erdHtmlEl('span', 'erd-name', erName(e));
        name.title = erName(e);
        head.appendChild(name);
        if (!asCard) head.appendChild(buildPort(''));
        if (!asCard && (e.columns || []).length && detail !== 'names') {
          const chev = ui.chevron({ expanded: e.collapsed !== true, label: e.collapsed ? 'Expand this table' : 'Collapse this table to its header' });
          chev.dataset.exportSkip = '';
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
          if (!asCard) row.appendChild(buildPort(col.name));
          if (col.unique) {
            const u = erdHtmlEl('span', 'erd-uniq', 'U');
            u.title = 'Unique';
            row.appendChild(u);
          }
          if (col.note) row.appendChild(erdHtmlEl('span', 'erd-col-note', col.note));
          if (showTypes) {
            const t = erdHtmlEl('span', 'erd-col-type', `${col.type == null ? '' : col.type}${col.nullable ? '?' : ''}`);
            if (col.nullable) t.title = 'Nullable';
            row.appendChild(t);
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

        if (asCard) return el;
        el.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType === 'touch' || erdDrag) return;
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
        // Presses on a table are handled by onErdPointerDown (EDITING), which selects, drags and draws
        const badge = buildNoteBadge(e);
        if (badge) el.appendChild(badge);
        return el;
      }

      // --- RELATIONSHIPS ---
      // One cubic Bezier per line (rel.curve = P0..P3 from the engine). It leaves each table at right angles to the side,
      // so the end markers (orient="auto", drawn pointing at the table) sit square on the edge.
      const erdCurvePath = (c) => `M ${c[0][0]} ${c[0][1]} C ${c[1][0]} ${c[1][1]} ${c[2][0]} ${c[2][1]} ${c[3][0]} ${c[3][1]}`;
      // The point of a line at t = 0.5 (where its label sits)
      function relMid(rel) {
        const c = rel.curve;
        if (!c) return { x: 0, y: 0 };
        return { x: (c[0][0] + 3 * c[1][0] + 3 * c[2][0] + c[3][0]) / 8, y: (c[0][1] + 3 * c[1][1] + 3 * c[2][1] + c[3][1]) / 8 };
      }

      // The join of a line as its tooltip: "order.customer_id → customer.id", "order.(a, b) → parent.(x, y)"
      function erdJoinText(rel) {
        const side = ({ id, cols }) => `${erName(erdEntity(id))}${cols.length > 1 ? `.(${cols.join(', ')})` : cols.length ? `.${cols[0]}` : ''}`;
        const [from, to] = joinedRows(rel);
        return from && to ? `${side(from)} → ${side(to)}` : '';
      }

      function renderRelationships() {
        erdRelsList().forEach((rel) => {
          if (!rel.curve || rel.curve.length !== 4) return;
          const ends = erRelEnds(rel, chartData);
          const d = erdCurvePath(rel.curve);
          const g = erdSvgEl('g', { class: 'erd-rel', 'data-edge-id': rel.id, 'data-from': rel.from, 'data-to': rel.to });
          const hit = erdSvgEl('path', { class: 'edge-hit', d });
          const line = erdSvgEl('path', { class: `edge-line${rel.identifying === true ? ' identifying' : ''}`, d });
          const fromKind = ERD_END_KINDS.includes(ends.fromEnd) ? ends.fromEnd : 'zeroOrMany';
          const toKind = ERD_END_KINDS.includes(ends.toEnd) ? ends.toEnd : 'one';
          ['', '-sel'].forEach((suffix) => {
            line.style.setProperty(`--mk-s${suffix}`, `url(#erd-end-${fromKind}${suffix})`);
            line.style.setProperty(`--mk-e${suffix}`, `url(#erd-end-${toKind}${suffix})`);
          });
          const tip = erdSvgEl('title', { 'data-export-skip': '' });
          tip.textContent = erdJoinText(rel);
          g.appendChild(tip);
          g.appendChild(hit);
          g.appendChild(line);
          g.addEventListener('pointerenter', (ev) => {
            if (ev.pointerType === 'touch' || erdDrag) return;
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
          const el = erdHtmlEl('div', 'edge-label edge-label--single');
          el.dataset.edgeId = rel.id;
          el.style.left = `${b.x}px`;
          el.style.top = `${b.y}px`;
          el.style.width = `${b.w}px`;
          el.style.height = `${b.h}px`;
          el.title = text;
          el.appendChild(erdHtmlEl('span', 'erd-rel-label-text', text));
          el.addEventListener('pointerenter', (ev) => { if (ev.pointerType !== 'touch' && !erdDrag) { hoverRelId = rel.id; applyHighlight(); } });
          el.addEventListener('pointerleave', () => { if (hoverRelId === rel.id) hoverRelId = null; applyHighlight(); });
          el.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); selectRel(rel.id); } });
          erdHtml.appendChild(el);
        });
      }

      // --- HOVER AND SELECTION ---
      // The neighbourhood of one table (hovered, or the only one selected; hover wins while the pointer is over another):
      //  - lines: those entering it (hl-in) and leaving it (hl-out), thicker, all in the primary colour (the crow's feet show
      //    the direction);
      //  - related tables: rel-child (points at it) / rel-parent (it points at them): a ring in the primary colour. Everything
      //    else dims;
      //  - key rows: the joining rows of every table in the neighbourhood that are drawn get key-hl (bold, light tint).
      // Hover a line: its two rows light up, and its tooltip names the join ("order.customer_id → customer.id").
      // Classes are transient (a selected one is stripped from an export, see body.exporting in erd.css), none of it is saved.
      function joinedRows(rel) {
        const from = erdEntity(rel.from), to = erdEntity(rel.to);
        const out = [];
        if (from) {
          const names = (Array.isArray(rel.columns) ? rel.columns : []).filter((n) => (from.columns || []).some((c) => c.name === n));
          out.push({ id: from.id, cols: names });
        }
        if (to) {
          const named = (Array.isArray(rel.toColumns) ? rel.toColumns : []).filter((n) => (to.columns || []).some((c) => c.name === n));
          const first = erdToCol(rel, to);
          out.push({ id: to.id, cols: named.length ? named : (first ? [first] : []) });
        }
        return out;
      }
      const entityEl = (id) => [...erdHtml.querySelectorAll('.erd-entity')].find((el) => el.dataset.nodeId === id);
      const relEl = (id) => [...erdRels.children].find((el) => el.dataset.edgeId === id);
      const labelEl = (id) => [...erdHtml.querySelectorAll('.edge-label')].find((el) => el.dataset.edgeId === id);
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

      // The tables around table `id` and the rows that join them: Map(table id -> { child, parent, rows: Map(column ->
      // { in: [parent targets], out: [child sources] }) }). `in` = the column is a foreign key row of a relationship that
      // leaves the table (a child end), `out` = the column is referenced by one that enters it (a parent end).
      function erdNeighbourhood(id) {
        const tables = new Map();
        const tab = (tid) => { let t = tables.get(tid); if (!t) { t = { child: false, parent: false, rows: new Map() }; tables.set(tid, t); } return t; };
        const rowRefs = (tid, col, dir) => {
          const t = tab(tid);
          let r = t.rows.get(col);
          if (!r) { r = { in: [], out: [] }; t.rows.set(col, r); }
          return r[dir];
        };
        const has = (e, n) => (e.columns || []).some((c) => c.name === n);
        erdRelsList().forEach((rel) => {
          if (rel.from !== id && rel.to !== id) return;
          const from = erdEntity(rel.from), to = erdEntity(rel.to);
          if (!from || !to) return;
          tab(from.id).child = true;
          tab(to.id).parent = true;
          const rawFrom = Array.isArray(rel.columns) ? rel.columns : [], rawTo = Array.isArray(rel.toColumns) ? rel.toColumns : [];
          const first = erdToCol(rel, to);
          rawFrom.forEach((n, i) => {
            if (!has(from, n)) return;
            const target = rawTo[i] !== undefined ? rawTo[i] : (i === 0 ? first : null);
            rowRefs(from.id, n, 'in').push(`${erName(to)}${target && has(to, target) ? `.${target}` : ''}`);
          });
          const toCols = rawTo.filter((n) => has(to, n));
          if (!toCols.length && first) toCols.push(first);
          toCols.forEach((n) => {
            const j = rawTo.indexOf(n), src = j >= 0 ? rawFrom[j] : rawFrom[0];
            rowRefs(to.id, n, 'out').push(`${erName(from)}${src && has(from, src) ? `.${src}` : ''}`);
          });
        });
        return tables;
      }
      // The table whose neighbourhood is on show: the hovered one, else the only one selected (not while a line is hovered,
      // nor while a drag moves things)
      function erdFocusId() {
        if (hoverEntityId) return hoverEntityId;
        if (hoverRelId || (erdDrag && erdDrag.moved)) return null;
        return erdSel && erdSel.kind === 'entity' && !isMultiSelected() && erdEntity(erdSel.id) ? erdSel.id : null;
      }

      function applyHighlight() {
        erdHtml.querySelectorAll('.color-key-label').forEach((l) => l.classList.toggle('is-selected', !!erdSel && erdSel.kind === 'key' && erdSel.color === l.dataset.color));
        erdCanvas.querySelectorAll('.hl-in, .hl-out, .hover, .rel-child, .rel-parent, .key-hl, .is-dim')
          .forEach((el) => el.classList.remove('hl-in', 'hl-out', 'hover', 'rel-child', 'rel-parent', 'key-hl', 'is-dim'));
        erdCanvas.querySelectorAll('.ov-show').forEach((el) => el.classList.remove('ov-show'));
        const keep = new Set();
        const keepRels = new Set();
        const focus = erdFocusId();
        if (focus) {
          keep.add(focus);
          erdRelsList().forEach((rel) => {
            const kind = rel.from === focus ? 'out' : rel.to === focus ? 'in' : null;
            if (!kind) return;
            keep.add(rel.from); keep.add(rel.to); keepRels.add(rel.id);
            const g = relEl(rel.id), label = labelEl(rel.id);
            if (g) g.classList.add(`hl-${kind}`);
            if (label) { label.classList.add(`hl-${kind}`, 'ov-show'); }
          });
          erdNeighbourhood(focus).forEach((info, tid) => {
            const el = entityEl(tid), ent = erdEntity(tid);
            if (!el || !ent) return;
            const isFocus = tid === focus;
            if (!isFocus) {
              if (info.child) el.classList.add('rel-child');
              if (info.parent) el.classList.add('rel-parent');
            }
            if (erdOverview && !isFocus) return;
            const rowEls = [...el.querySelectorAll('.erd-row')];
            info.rows.forEach((r, col) => {
              const rowEl = rowEls.find((x) => x.dataset.col === col);
              if (rowEl) rowEl.classList.add('key-hl');
            });
          });
        } else if (hoverRelId) {
          const rel = erdRel(hoverRelId);
          if (rel) {
            keep.add(rel.from); keep.add(rel.to); keepRels.add(rel.id);
            const g = relEl(rel.id), label = labelEl(rel.id);
            if (g) g.classList.add('hover');
            if (label) label.classList.add('hover', 'ov-show');
            markRows(rel, 'hover');
          }
        }
        if (keep.size) {
          erdHtml.querySelectorAll('.erd-entity').forEach((el) => { if (!keep.has(el.dataset.nodeId)) el.classList.add('is-dim'); });
          [...erdRels.children, ...erdHtml.querySelectorAll('.edge-label')].forEach((el) => { if (!keepRels.has(el.dataset.edgeId)) el.classList.add('is-dim'); });
        }
        // Selection
        erdCanvas.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
        if (erdSel) {
          if (erdSel.kind === 'entity') {
            const many = isMultiSelected();
            (many ? selectedEntityIds() : [erdSel.id]).forEach((id) => { const el = entityEl(id); if (el) el.classList.add('selected'); });
          }
          else if (erdSel.kind === 'rel') {
            const el = relEl(erdSel.id), label = labelEl(erdSel.id);
            if (el) el.classList.add('selected');
            if (label) label.classList.add('selected');
          } else if (erdSel.kind === 'col') {
            const el = entityEl(erdSel.entity);
            const row = el && [...el.querySelectorAll('.erd-row')].find((r) => r.dataset.col === erdSel.col);
            if (row) row.classList.add('selected');
          }
        }
        markTouchPorts();
        applyNoteVisibility();
        erdSyncCard();
      }

      // Touch: a finger reaches the plugin only inside `.selected` or `[data-touch-drag]` (the shell's rule). The ports of
      // the selected table (or of the table whose row is selected) and the end handles of a selected line are such
      // targets, and show (erd-touch) so a finger can drag a relationship out of a row. With several tables selected
      // there are no ports: a drag moves them all.
      function markTouchPorts() {
        const many = isMultiSelected();
        erdCanvas.classList.toggle('is-multi', many);
        erdCanvas.querySelectorAll('.port:not(.port-end)[data-touch-drag]').forEach((p) => p.removeAttribute('data-touch-drag'));
        const id = !many && !erdPresenting() ? erdSelectedEntityId() : null;
        const el = id && entityEl(id);
        if (el) el.querySelectorAll('.port:not(.port-end)').forEach((p) => p.setAttribute('data-touch-drag', ''));
        el && el.classList.add('touch-ports');
        erdCanvas.querySelectorAll('.erd-entity.touch-ports').forEach((x) => { if (x !== el) x.classList.remove('touch-ports'); });
        if (deleteLabelEl) deleteLabelEl.textContent = many ? `Delete ${selectedEntityIds().length}` : 'Delete';
      }
      const deleteLabelEl = document.querySelector('#btn-delete-selection .btn-label');
      window.addEventListener('pointerdown', (e) => { document.body.classList.toggle('erd-touch', e.pointerType === 'touch'); document.body.classList.toggle('is-touch', e.pointerType === 'touch'); }, true);

      // Selecting changes classes and the tools drawn on the selection, never the tables themselves: the second click
      // of a double-click must land on the element the first one did
      function setSelection(sel) {
        selectedNoteId = null;
        erdSel = sel;
        erdMultiIds = [];
        erdMultiOwner = null;
        applyHighlight();
        drawSelectionTools();
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }
      const selectEntity = (id) => setSelection({ kind: 'entity', id });
      const selectRel = (id) => setSelection({ kind: 'rel', id });
      const selectCol = (entity, col) => setSelection({ kind: 'col', entity, col });

      // --- MULTI-SELECT (tables only) ---
      // erdSel is the primary table (the one clicked last: the action bar and notes follow it) and erdMultiIds holds all
      // of them. Ctrl/Cmd+click toggles a table, Shift+drag on blank canvas draws the shell's box (selectInRect), Ctrl/Cmd+A
      // selects every table (selectAll), Esc or a click on blank canvas clears. A drag moves them all, Delete deletes them
      // all as one undo step. Lines, columns, areas and notes are still selected one at a time. Never saved; off in ?present.
      function setEntitySelection(ids, primary) {
        ids = ids.filter((id) => erdEntity(id));
        selectedNoteId = null;
        if (ids.length <= 1) {
          if (ids.length) selectEntity(ids[0]); else setSelection(null);
          return;
        }
        const main = ids.includes(primary) ? primary : ids[ids.length - 1];
        erdSel = { kind: 'entity', id: main };
        erdMultiIds = ids.slice();
        erdMultiOwner = erdSel;
        applyHighlight();
        drawSelectionTools();
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }
      function toggleEntity(id) {
        const cur = selectedEntityIds();
        const ids = cur.filter((x) => x !== id);
        if (!cur.includes(id)) ids.push(id);
        setEntitySelection(ids, id);
      }
      let erdBoxBase = [];   // the selection a toggle box started from (selectInRect)
      function erdSelectInRect(r, mode, start) {
        if (erdPresenting()) return;
        if (start) erdBoxBase = erdSel && (erdSel.kind === 'entity' || erdSel.kind === 'col') ? selectedEntityIds() : [];
        const hit = erdEntities().filter((e) => {
          const el = entityEl(e.id);
          if (!el) return false;
          const b = el.getBoundingClientRect();
          return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        }).map((e) => e.id);
        const next = mode === 'toggle'
          ? erdBoxBase.filter((id) => !hit.includes(id)).concat(hit.filter((id) => !erdBoxBase.includes(id)))
          : hit;
        const cur = selectedEntityIds();
        const same = next.length === cur.length && next.every((id) => cur.includes(id)) && !(erdSel && erdSel.kind !== 'entity') && (next.length > 0 || !erdSel);
        if (!same) setEntitySelection(next, erdSel && erdSel.kind === 'entity' ? erdSel.id : null);
      }
      function erdSelectAll() {
        if (erdPresenting()) return;
        setEntitySelection(erdEntities().map((e) => e.id), erdSel && erdSel.kind === 'entity' ? erdSel.id : null);
      }

      // --- OVERVIEW (zoomed out) ---
      // Below 50% zoom (back above 60%) body.erd-overview: tables keep their boxes but draw only their name, centred at about
      // 14px on screen; lines keep a constant on-screen width; labels, markers and notes are scaled by 1/scale
      // (--inv on the canvas) so they stay readable; a label that would then cover another label or a table is hidden
      // until its line or either table is hovered. All of it is CSS keyed to body.erd-overview:not(.exporting), so every
      // export and copy is the full diagram. Nothing here changes the layout or the saved file.
      let erdOverview = false, erdMeasuredAt = null, erdLastScale = null, lastWheelZoomAt = 0;
      window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) lastWheelZoomAt = performance.now(); }, { passive: true, capture: true });
      function erdUpdateOverview(force) {
        if (force !== true && scale === erdLastScale) return;
        erdLastScale = scale;
        const was = erdOverview;
        if (!erdOverview && scale < 0.5) erdOverview = true; else if (erdOverview && scale > 0.6) erdOverview = false;
        const canMorph = was !== erdOverview && force !== true && motion.enabled()
          && !viewport.classList.contains('panning') && (performance.now() - lastWheelZoomAt > 120);
        const nameSpec = [{ selector: '.erd-entity[data-node-id] .erd-name', key: (el) => el.closest('.erd-entity').dataset.nodeId }];
        const nameSnap = canMorph ? motion.capture(erdHtml, nameSpec) : null;
        document.body.classList.toggle('erd-overview', erdOverview);
        erdCanvas.style.setProperty('--inv', String(1 / scale));
        if (erdOverview) { if (force === true || was !== erdOverview || erdMeasuredAt !== scale) { erdMeasuredAt = scale; erdOverviewMeasure(); } }
        else if (was || force === true) { erdMeasuredAt = null; erdOverviewReset(); }
        if (nameSnap) {
          motion.play(nameSnap, erdHtml, nameSpec, { duration: 160, easing: 'curve-inout', enter: false });
          if (!erdOverview) {
            erdHtml.querySelectorAll('.erd-entity[data-node-id]').forEach((ent) => {
              motion.anim(ent, [
                { clipPath: `inset(0 0 ${Math.max(0, ent.offsetHeight - ER.HEAD_H)}px 0 round var(--radius-lg))` },
                { clipPath: 'inset(0 0 0 0 round var(--radius-lg))' }
              ], { duration: 160, easing: motion.curve('curve-inout') });
            });
          }
        }
        if (was !== erdOverview) { applyHighlight(); if (!erdOverview) erdHideCard(); }
      }
      function erdOverviewReset() {
        erdHtml.querySelectorAll('.erd-name').forEach((n) => { n.style.fontSize = ''; });
        erdHtml.querySelectorAll('.ov-hide').forEach((n) => n.classList.remove('ov-hide'));
      }
      function erdOverviewMeasure() {
        const inv = 1 / scale, rootCs = getComputedStyle(document.documentElement);
        const px = (v) => parseFloat(rootCs.getPropertyValue(v)), fitMin = parseFloat(TOKENS.type.fitMinOverview);   // the zoomed-out overview may go smaller than diagram labels
        const base = Math.max(px('--text-md'), px('--text-lg') * inv); // the same size erd.css gives an overview table name
        erdHtml.querySelectorAll('.erd-entity .erd-name').forEach((n) => {
          const card = n.closest('.erd-entity');
          if (n.isContentEditable) return;
          n.style.fontSize = `${base}px`;
          const w = n.scrollWidth, avail = card.offsetWidth - 16;
          if (w > avail && w > 0) n.style.fontSize = `${Math.max(base * avail / w, fitMin * inv)}px`;
        });
        // Labels: keep the ones that fit when drawn at constant screen size, longest line first
        const rels = erdRelsList().map((r) => {
          let len = 0;
          const p = r.points || [];
          for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
          return { r, len };
        }).sort((a, b) => b.len - a.len);
        const tables = erdEntities().filter((e) => e.box).map((e) => e.box);
        const taken = [];
        rels.forEach(({ r }) => {
          const el = labelEl(r.id);
          if (!el || !r.labelBox) return;
          const b = r.labelBox, w = b.w * inv, h = b.h * inv;
          const q = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
          const clash = taken.some((o) => boxesOverlap(q, o, 2 * inv)) || tables.some((o) => boxesOverlap(q, o, 0));
          el.classList.toggle('ov-hide', clash);
          if (!clash) taken.push(q);
        });
      }

      // The expanded card: in the overview, selecting a table (a click, not a hover) shows the full table at 100% size
      // over its own box (fixed to the screen, an overlay: nothing moves). Read only and click-through (erd.css), so the
      // table under it can still be dragged, and a double-click reaches the table and zooms to it.
      let erdCardEl = null, erdCardId = null;
      function erdHideCard(animate) {
        if (erdCardEl) {
          if (animate && motion.enabled()) {
            const mini = erdCardId && entityEl(erdCardId);
            motion.ghostExit(erdCardEl, { toRect: mini ? mini.getBoundingClientRect() : null, duration: 150, easing: 'curve-in' });
          }
          erdCardEl.remove();
        }
        erdCardEl = null; erdCardId = null;
      }
      function erdSyncCard() {
        const sel = erdSel && erdSel.kind === 'entity' && !isMultiSelected() && erdEntity(erdSel.id) ? erdSel.id : null;
        const want = !erdOverview || (erdDrag && erdDrag.moved) ? null : sel;
        if (want === erdCardId && (!want || erdCardEl)) return;
        erdHideCard(true);
        if (!want) return;
        const e = erdEntity(want), el = entityEl(want);
        if (!e || !el) return;
        const wrap = erdHtmlEl('div', 'erd-expand-card');
        wrap.dataset.exportSkip = '';
        wrap.dataset.cardFor = want;
        const table = buildEntity(e, true);
        wrap.appendChild(table);
        const info = erdNeighbourhood(want).get(want);
        if (info) {
          [...table.querySelectorAll('.erd-row')].forEach((row) => { if (info.rows.has(row.dataset.col)) row.classList.add('key-hl'); });
        }
        document.body.appendChild(wrap);
        const r = el.getBoundingClientRect(), vp = viewport.getBoundingClientRect(), w = wrap.offsetWidth, h = wrap.offsetHeight;
        wrap.style.left = `${Math.max(vp.left + 8, Math.min(r.left, vp.right - w - 8))}px`;
        wrap.style.top = `${Math.max(vp.top + (ui.chromeTop ? ui.chromeTop() : 0) + 8, Math.min(r.top, vp.bottom - h - 8))}px`;
        erdCardEl = wrap;
        erdCardId = want;
        motion.morphRect(r, wrap, { duration: 190, easing: 'curve-spring-tactile', origin: 'top left' });
      }
      // Zoom to a table at 100%, centred in the view
      function erdZoomToTable(id) {
        const el = entityEl(id);
        if (!el) return;
        const r = el.getBoundingClientRect(), vp = viewport.getBoundingClientRect();
        const sx = (r.left + r.width / 2 - vp.left - panX) / scale, sy = (r.top + r.height / 2 - vp.top - panY) / scale;
        if (erdCardEl) {
          const box = erdEntity(id)?.box;
          const toRect = box ? { left: vp.left + vp.width / 2 - box.w / 2, top: vp.top + vp.height / 2 - box.h / 2, width: box.w, height: box.h } : null;
          motion.ghostExit(erdCardEl, { toRect, opacity: 0.9, duration: 150, easing: 'curve-out' });
          erdCardEl.remove();
          erdCardEl = null; erdCardId = null;
        }
        animateViewport(vp.width / 2 - sx, vp.height / 2 - sy, 1, { duration: 150, easing: 'curve-out', onComplete: erdSyncCard });
      }

      // --- COLLAPSE ---
      function toggleCollapsed(id) {
        const e = erdEntity(id);
        if (!e) return;
        const was = e.collapsed === true;
        if (was) delete e.collapsed; else e.collapsed = true;
        // Tables stay where they are, only their sizes and the lines change (render() re-routes because the model
        // changed). In ?present it is a change of view, not an edit.
        render({ duration: 200, easing: 'curve-spring-settle', shrinkGhosts: !was, shrinkOpacity: 1, collapseId: id });
        if (!erdPresenting()) updateStatus(true);
      }

      // --- DOCK: Columns, Types, Notes ---
      function updateButtons() {
        const detail = erdDetail();
        const modeLabel = { all: 'All', keys: 'Keys', names: 'Names' }[detail];
        if (erdBtnColumns) {
          const mode = erdBtnColumns.querySelector('.btn-count');
          if (mode) mode.textContent = modeLabel;
          erdBtnColumns.title = `Columns: ${{ all: 'all', keys: 'key columns only', names: 'table names only' }[detail]}`;
          erdBtnColumns.setAttribute('aria-label', `Columns: ${modeLabel}`);
          document.querySelectorAll('#columns-pop [data-detail]').forEach((t) => t.setAttribute('aria-checked', String(t.dataset.detail === detail)));
        }
        if (erdBtnTypes) {
          const on = chartData.showTypes !== false;
          erdBtnTypes.setAttribute('aria-checked', String(on));
          erdBtnTypes.title = on ? 'Hide the column types' : 'Show the column types';
        }
        updateNotesButton();
      }

      // --- OVERLAPS (after a hand move) ---
      // Screen boxes of every table computed from the saved x/y (no routing), so a loop of pushes does not have to route
      function erdLiveBoxes() {
        const eb = new Map();
        erdEntities().forEach((e) => { const s = erEntitySize(e, chartData); eb.set(e.id, { x: e.x, y: e.y, w: s.w, h: s.h }); });
        return eb;
      }

      // Resolve overlaps by pushing along the shortest axis, one push at a time until nothing overlaps.
      //   opts.tables: ids of the tables just moved or made; they are the ones pushed (any direction), the others stay.
      // Without it (a resize), the later table (by top, then left) is pushed right or down only.
      function erdSettle(opts = {}) {
        const mine = opts.tables || new Set();
        const GAP = 24;
        const free = mine.size > 0;
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const q4 = (v) => Math.ceil(v / 4) * 4;
        // [dx, dy] that moves P clear of F by `gap`, the shortest way (right and down only unless `any`)
        const clear = (P, F, gap, any) => {
          const c = [[q4(F.x + F.w + gap - P.x), 0], [0, q4(F.y + F.h + gap - P.y)]];
          if (any) c.push([-q4(P.x + P.w + gap - F.x), 0], [0, -q4(P.y + P.h + gap - F.y)]);
          return c.sort((m, n) => Math.abs(m[0] + m[1]) - Math.abs(n[0] + n[1]))[0];
        };
        const step = () => {
          const eb = erdLiveBoxes();
          const list = erdEntities().map((e) => ({ e, b: eb.get(e.id) })).sort((m, n) => m.b.y - n.b.y || m.b.x - n.b.x);
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const A = list[i], B = list[j];
              if (!hit(A.b, B.b) || (mine.size > 1 && mine.has(A.e.id) && mine.has(B.e.id))) continue;
              const pushB = !(mine.has(A.e.id) && !mine.has(B.e.id));
              const [P, F] = pushB ? [B, A] : [A, B];
              const [dx, dy] = clear(P.b, F.b, GAP, free && mine.has(P.e.id));
              // tables moved together stay together: the whole set takes the push
              (mine.size > 1 && mine.has(P.e.id) ? erdEntities().filter((e) => mine.has(e.id)) : [P.e]).forEach((e) => { e.x += dx; e.y += dy; });
              return true;
            }
          }
          return false;
        };
        for (let n = 0; n < 600 && step(); n++);
      }
      // The canvas starts at 0,0: keep every table on it (shift all right/down when a move left something past the edge)
      function erdNormalize() {
        let minX = Infinity, minY = Infinity;
        erdLiveBoxes().forEach((b) => { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); });
        const dx = minX < 8 ? erdRound4(16 - minX) : 0, dy = minY < 8 ? erdRound4(16 - minY) : 0;
        if (!dx && !dy) return;
        erdEntities().forEach((e) => { e.x += dx; e.y += dy; });
      }
      // Put a table's top-left at a screen point (exact: whole pixels, a snapped drop keeps its alignment; else the 4px grid)
      function erdPlaceAt(e, x, y, exact) {
        e.x = exact ? Math.round(x) : erdRound4(x);
        e.y = exact ? Math.round(y) : erdRound4(y);
      }
      // Re-route from the saved positions (after a hand move; no relayout)
      function erdRoute() {
        routeDiagram(chartData);
        routedSig = inputSignature();
      }
      function erdSettled(opts) {
        erdSettle(opts);
        erdNormalize();
        erdRoute();
      }

      // The tables changed size (Columns, Types). Placed tables stay where they are and only the lines are re-routed; a
      // table that now overlaps another is pushed right or down, whichever is shorter.
      function resizeLayout(after) {
        if (erdEntities().some((e) => !erdIsPlaced(e))) { erdLayoutThen(after); return; }
        erdSettled();
        after();
      }

      document.querySelectorAll('#columns-pop [data-detail]').forEach((tile) => tile.addEventListener('click', () => {
        const next = tile.dataset.detail;
        if (next === erdDetail()) return;
        if (next === 'all') delete chartData.detail; else chartData.detail = next;
        resizeLayout(() => { render({ duration: 230, easing: 'curve-spring-settle', shrinkGhosts: true, shrinkOpacity: 0.2 }); updateStatus(true); fitView(true); });   // sizes change; rank and order do not (check_golden.py)
      }));
      if (erdBtnTypes) erdBtnTypes.addEventListener('click', () => {
        if (chartData.showTypes === false) delete chartData.showTypes; else chartData.showTypes = false;
        resizeLayout(() => { render({ duration: 200, easing: 'curve-spring-settle', shrinkGhosts: true, shrinkOpacity: 0.2 }); updateStatus(true); });
      });

      // --- NOTES ---
      // Notes live in chartData.notes: { id, text, entities: [table ids], pos?: {x, y} }. The first table is the anchor.
      // A table with a note carries a badge; hover the badge (or the table) to peek, the Notes button shows them all
      // ("showNotes": true). Each unpinned note is fitted into a clear gap near its table on every render, and a dashed
      // leader joins the card to its tables. (The card is the flowchart's, and so is the fitting, with this type's
      // obstacles.) Editing (NOTES, in EDITING): add (dock, N, the + chip), edit in place, link and unlink tables, drag to pin.
      // A free note has no tables ("entities": []) and an absolute `pos` in canvas coordinates (a table's x/y space): no
      // leader, no badge, always on show, never moved by Tidy; the other notes are fitted around it.
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
      let editingNoteId = null;      // the note being typed: it counts as live while still empty
      const isFreeNote = (note) => !(note.entities || []).length;
      const liveNotes = () => notesList().filter((n) => (noteTextOf(n) || n.id === editingNoteId) && (isFreeNote(n) || linkedEntities(n).length));
      // A table note has no `column`
      const notesOfEntity = (id) => liveNotes().filter((n) => !n.column && (n.entities || []).includes(id));
      const erdPresenting = () => document.body.classList.contains('presentation');
      const boxesOverlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
      const boxGap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
      // Length of segment s that runs under box b (Liang-Barsky clip)
      function lengthUnder(s, b) {
        const [x1, y1, x2, y2] = s, dx = x2 - x1, dy = y2 - y1;
        let t0 = 0, t1 = 1;
        for (const [p, q] of [[-dx, x1 - b.x], [dx, b.x + b.w - x1], [-dy, y1 - b.y], [dy, b.y + b.h - y1]]) {
          if (p === 0) { if (q < 0) return 0; continue; }
          const r = q / p;
          if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
        }
        return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
      }

      function renderNotes(refit) {
        if (erdNotesLayer && erdNotesLayer.isConnected) erdNotesLayer.remove();
        erdLeaders.textContent = '';
        erdNotesLayer = erdHtmlEl('div', 'note-layer');
        erdNotesLayer.id = 'erd-notes';
        erdHtml.appendChild(erdNotesLayer);
        const live = liveNotes();
        live.forEach((note) => {
          const card = buildNoteCard(note);
          erdNotesLayer.appendChild(card);
          linkedEntities(note).forEach((id) => {
            erdLeaders.appendChild(erdSvgEl('line', { class: 'note-leader', 'data-note-id': note.id, 'data-entity-id': id }));
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
      const noteCard = (id) => erdNotesLayer && [...erdNotesLayer.children].find((el) => el.dataset.noteId === id);

      // The card: plain text (edited in place), a delete button and a link handle. A press selects it and drags it; in
      // ?present it is read only and a click keeps it open.
      function buildNoteCard(note) {
        const { card, text } = ui.noteCard(note, {
          onDelete: () => removeNote(note.id),
          onLink: (ev) => startNoteLink(ev, note.id, card),
          linkTitle: 'Link to another table: drag onto it (onto a linked table to unlink; or Shift+click the table)',
          onCommit: (el) => commitNote(note, el),
          // the card grows as it is typed into: keep its leaders attached
          onInput: () => { noteSizes[note.id] = { w: card.offsetWidth, h: card.offsetHeight }; positionNotes(); },
        });
        card.addEventListener('pointerdown', (ev) => onNotePointerDown(ev, note.id, card));
        card.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editNote(note.id); });
        card.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (erdPresenting()) { selectedNoteId = selectedNoteId === note.id ? null : note.id; applyNoteVisibility(); }
        });
        card.addEventListener('mouseenter', () => { if ((note.entities || []).includes(peekEntityId)) clearTimeout(peekTimer); });
        card.addEventListener('mouseleave', () => { if (peekEntityId) unpeekSoon(peekEntityId); });
        text.addEventListener('blur', () => commitNote(note, text));
        return card;
      }

      // Give every note that is neither pinned nor fitted yet the cheapest spot within NOTE_REACH of its tables:
      // about NOTE_IDEAL_GAP away, off-centre for a single table; heavy penalties for covering a table, another note, a
      // label; a lighter one for hiding a line; a small one for leaving the canvas.
      function fitNotes(live) {
        const todo = live.filter((n) => !n.pos && !noteOffsets[n.id]);
        if (!todo.length) return;
        const C = chartData.canvas || { width: 0, height: 0 };
        const W = C.width, H = C.height;
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
        const placed = live.filter((n) => n.pos || noteOffsets[n.id]).map((n) => {   // free notes are obstacles like any placed note
          const o = n.pos || noteOffsets[n.id], a = isFreeNote(n) ? { x: 0, y: 0 } : boxesOf[n.id][0];
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
          if ((!ids.length && !isFreeNote(note)) || !o) return;
          const a = ids.length ? erdEntity(ids[0]).box : { x: 0, y: 0 }, x = a.x + o.x, y = a.y + o.y, s = noteSizes[note.id] || { w: 0, h: 0 };
          card.style.left = `${x}px`;
          card.style.top = `${y}px`;
          drawLeaders(note.id, { x, y, w: s.w, h: s.h });
        });
        applyNoteVisibility();
      }
      function drawLeaders(noteId, b) {
        [...erdLeaders.children].forEach((line) => {
          if (line.dataset.noteId !== noteId || !line.dataset.entityId) return;
          const e = erdEntity(line.dataset.entityId);
          if (!e || !e.box) return;
          const r = e.box;
          line.setAttribute('x1', b.x + b.w / 2);
          line.setAttribute('y1', b.y + b.h / 2);
          line.setAttribute('x2', r.x + r.w / 2);
          line.setAttribute('y2', r.y + r.h / 2);
        });
      }

      function notePeeked(note) {
        const ids = note.entities || [];
        return note.id === selectedNoteId || ids.includes(peekEntityId) || (erdSel && erdSel.kind === 'entity' && ids.includes(erdSel.id));
      }
      let wasVisibleNoteIds = new Set(), pendingNoteOriginRect = null;
      function applyNoteVisibility() {
        if (!erdNotesLayer) return;
        const all = !!chartData.showNotes;
        const canAnim = !erdInRender && motion.enabled();
        const nextVis = new Set();
        if (canAnim) {
          [...erdNotesLayer.children].forEach((card) => {
            const id = card.dataset.noteId, note = noteById(id);
            if (!note) return;
            const willShow = all || isFreeNote(note) || !!notePeeked(note);
            if (willShow) nextVis.add(id);
            if (id === selectedNoteId && wasVisibleNoteIds.has(id)) {
              // clicked while a hover peek was still unfolding: settle it, so its link handle is where it will stay
              card.getAnimations().forEach((a) => a.finish());
              card.style.pointerEvents = '';
            }
            if (!willShow && wasVisibleNoteIds.has(id) && !isFreeNote(note)) {
              const badge = (note.entities || [])[0] && entityEl(note.entities[0])?.querySelector('.note-badge');
              motion.foldNote(card, badge);
            }
          });
        }
        erdCanvas.classList.toggle('notes-on', all);
        [...erdNotesLayer.children, ...erdLeaders.children].forEach((el) => {
          const note = noteById(el.dataset.noteId);
          if (!note) return;
          const show = all || isFreeNote(note), peek = !!notePeeked(note);
          el.classList.toggle('show', show);   // a free note has nothing to hover: it is always on show
          el.classList.toggle('peek', peek);
          if (el.classList.contains('note')) {
            el.classList.toggle('selected', note.id === selectedNoteId);
            if (show || peek) nextVis.add(note.id);
          }
        });
        if (canAnim) {
          [...erdNotesLayer.children].forEach((card) => {
            const id = card.dataset.noteId, note = noteById(id);
            if (!note || !nextVis.has(id) || wasVisibleNoteIds.has(id)) return;
            if (pendingNoteOriginRect) {
              const r = pendingNoteOriginRect; pendingNoteOriginRect = null;
              motion.morphRect(r, card, { duration: 170, easing: 'curve-spring-tactile' });
            } else if (isFreeNote(note)) {
              motion.unfoldNote(card);
            } else {
              const badge = (note.entities || [])[0] && entityEl(note.entities[0])?.querySelector('.note-badge');
              const leader = erdLeaders.querySelector(`.note-leader[data-note-id="${id}"]`);
              if (editingNoteId !== id && selectedNoteId !== id && badge && badge.getBoundingClientRect().width > 0) {
                card.style.pointerEvents = 'none';
                setTimeout(() => { if (card.isConnected) card.style.pointerEvents = ''; }, 180);
              }
              if (selectedNoteId === id || editingNoteId === id) {
                // a selected card is about to be dragged from (its link handle): fade in place, never move it
                motion.anim(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: motion.curve('curve-out') });
                if (leader) motion.drawPath(leader, { duration: 150, easing: 'curve-out' });
              } else motion.unfoldNote(card, badge, leader);
            }
          });
        }
        wasVisibleNoteIds = nextVis;
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
        if (!notes.length) {
          return null;   // no hover +: the table bar's note button adds one
        }
        const b = erdHtmlEl('button', 'note-badge');
        b.type = 'button';
        b.dataset.exportSkip = '';
        b.setAttribute('aria-label', notes.map((n) => `Note: ${noteTextOf(n)}`).join(' · '));
        b.innerHTML = ERD_NOTE_ICON;
        b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        b.addEventListener('mouseenter', () => peekSoon(e.id, 0));
        // A click edits the note; in ?present (read only) it keeps the note open, or closes it again
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (erdPresenting()) {
            selectedNoteId = selectedNoteId === notes[0].id ? null : notes[0].id;
            applyNoteVisibility();
          } else editNote(notes[0].id);
        });
        return b;
      }

      // Notes button: pressed while every note is on show; the count says how many there are
      function updateNotesButton() {
        if (!erdBtnNotes) return;
        const count = notesList().filter((n) => noteTextOf(n)).length;
        const on = !!chartData.showNotes;
        erdBtnNotes.setAttribute('aria-checked', String(on));
        erdBtnNotes.disabled = !count && !on;
        const c = erdBtnNotes.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        erdBtnNotes.title = !count ? 'No notes yet: select a table and press N (or click its + chip) to add one'
          : on ? 'Hide the notes (hover a table’s badge to peek at one)' : 'Show all notes';
      }
      if (erdBtnNotes) erdBtnNotes.addEventListener('click', () => {
        if (chartData.showNotes) delete chartData.showNotes; else chartData.showNotes = true;
        peekEntityId = null;
        applyNoteVisibility();
        updateNotesButton();
        updateStatus(true);
      });

      // =====================================================================================================
      // --- EDITING ---
      // Selection kinds: a table, a column row, a line or a note (selectedNoteId). Presses are handled
      // in one place (onErdPointerDown); drags go through beginDrag (a drag starts after 4px; a press without
      // movement only selects, and never rebuilds the DOM, so a double-click lands on the element the first click did).
      // Every finished edit calls updateStatus(true) once: commit() (structural: tables stay, lines re-route) or a plain render() + updateStatus(true) for colours and notes. Text edits (beginEdit) commit on blur.
      // =====================================================================================================
      const erdBtnAddTable = document.getElementById('btn-add-table');
      const erdBtnAddRel = document.getElementById('btn-add-relationship');
      const erdBtnAddNote = document.getElementById('btn-add-note');

      let erdDrag = null;            // the pointer drag in progress: { startX, startY, dx, dy, moved, move?, drop?, click?, cleanup? }
      let relArmed = false;          // the Relationship tool waits for a drag from a column
      let notePicking = false;       // the Note tool waits for a table
      let erdUidCounter = 0;
      const erdUid = (prefix) => `${prefix}_${Date.now()}_${erdUidCounter++}`;
      const erdPx = (v) => `${v}px`;
      const erdRound4 = (v) => Math.round(v / 4) * 4;

      // Client point -> canvas coordinates (the unscaled px every box, point and handle is in)
      function erdPoint(e) {
        const r = erdCanvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / scale - erdCanvas.clientLeft, y: (e.clientY - r.top) / scale - erdCanvas.clientTop };
      }
      const erdFirstPk = (ent) => erdToCol({}, ent);

      // A structural edit: tables stay and only lines are re-routed
      function commit(motionOpts) {
        render(motionOpts);
        updateStatus(true);
      }

      // A short message above the dock (why something was refused), or a prompt that stays while a tool waits
      let erdHintTimer = 0;
      function erdHint(html, sticky, progress) {
        let hint = document.querySelector('.hint');
        clearTimeout(erdHintTimer);
        if (html === null) { if (hint) motion.hideHint(hint); return; }
        if (!hint) {
          hint = erdHtmlEl('div', 'hint');
          hint.setAttribute('role', 'status');
          hint.dataset.exportSkip = '';
          document.body.appendChild(hint);
        }
        hint.classList.toggle('is-progress', !!progress);
        hint.innerHTML = html;
        if (!sticky) erdHintTimer = setTimeout(() => { if (hint.isConnected) motion.hideHint(hint); }, 3200);
      }
      const erdText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

      // Bring an element into the viewport (a created table can land below or right of the screen)
      function panIntoView(el) {
        if (!el) return;
        const r = el.getBoundingClientRect(), v = viewport.getBoundingClientRect(), pad = 60;
        const dock = document.querySelector('.dock-area .toolbar-center');
        const bottom = Math.min(v.bottom, dock && dock.offsetHeight ? dock.getBoundingClientRect().top : v.bottom);
        let dx = 0, dy = 0;
        if (r.left < v.left + pad) dx = v.left + pad - r.left; else if (r.right > v.right - pad) dx = v.right - pad - r.right;
        if (r.top < v.top + pad) dy = v.top + pad - r.top; else if (r.bottom > bottom - pad) dy = bottom - pad - r.bottom;
        if (!dx && !dy) return;
        animateViewport(panX + dx, panY + dy, scale, { duration: motion.dur('dur-camera', 240), easing: 'curve-out' });
      }

      // --- OVERLAYS: the rubber band of a drawing drag, a drop line, snap guides ---
      const erdOverlay = erdSvgEl('svg', { id: 'erd-overlay', width: 1, height: 1 });
      erdOverlay.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:54';
      erdOverlay.dataset.exportSkip = '';
      const erdRubber = erdSvgEl('line', { id: 'erd-rubber', x1: 0, y1: 0, x2: 0, y2: 0 });
      erdOverlay.appendChild(erdRubber);
      erdCanvas.appendChild(erdOverlay);
      const erdDropLine = erdHtmlEl('div', 'erd-drop-line');
      erdDropLine.dataset.exportSkip = '';
      erdCanvas.appendChild(erdDropLine);
      const erdGuideV = erdHtmlEl('div', 'erd-guide erd-guide-v');
      const erdGuideH = erdHtmlEl('div', 'erd-guide erd-guide-h');
      [erdGuideV, erdGuideH].forEach((g) => { g.dataset.exportSkip = ''; erdCanvas.appendChild(g); });
      function showRubber(x1, y1, x2, y2) {
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => erdRubber.setAttribute(k, v));
        erdRubber.style.display = 'block';
      }
      function markTarget(target) {
        erdCanvas.querySelectorAll('.erd-target').forEach((el) => el.classList.remove('erd-target'));
        if (!target) return;
        const el = entityEl(target.entity);
        if (!el) return;
        el.classList.add('erd-target');
        const part = target.col ? [...el.querySelectorAll('.erd-row')].find((r) => r.dataset.col === target.col) : el.querySelector('.erd-head');
        if (part) part.classList.add('erd-target');
      }
      // The table (and its row) under a client point; overlays never get in the way (they ignore the pointer)
      function erdTargetAt(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const ent = el && el.closest('.erd-entity');
        if (!ent || ent.classList.contains('erd-ghost') || ent.classList.contains('erd-card-table')) return null;
        const row = el.closest('.erd-row');
        return { entity: ent.dataset.nodeId, col: row ? row.dataset.col : null };
      }
      const erdEntityIdAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const ent = el && el.closest('.erd-entity:not(.erd-ghost)');
        return ent ? ent.dataset.nodeId : null;
      };

      // --- DRAGS ---
      function beginDrag(e, d) {
        endDrag();
        erdDrag = Object.assign({ startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false }, d);
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp);
        window.addEventListener('pointercancel', cancelDrag);
      }
      function onDragMove(e) {
        const d = erdDrag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        if (!d.moved) {
          d.moved = true;
          document.body.classList.add('erd-dragging', 'is-dragging');
          hoverEntityId = null;
          hoverRelId = null;
          applyHighlight();
        }
        d.dx = (e.clientX - d.startX) / scale;
        d.dy = (e.clientY - d.startY) / scale;
        if (d.move) d.move(e, d);
      }
      function endDrag() {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        window.removeEventListener('pointercancel', cancelDrag);
        document.body.classList.remove('erd-dragging', 'is-dragging');
        erdRubber.style.display = 'none';
        erdDropLine.style.display = 'none';
        erdGuideV.style.display = 'none';
        erdGuideH.style.display = 'none';
        erdCanvas.querySelectorAll('.erd-target, .drop-target').forEach((el) => el.classList.remove('erd-target', 'drop-target'));
        const d = erdDrag;
        erdDrag = null;
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
        if (d.moved) render(false);   // everything back where it was immediately
        return true;
      }

      // =====================================================================================================
      // --- ACTION BAR, HANDLES, PORTS ---
      // =====================================================================================================
      function buildPort(col) {
        const p = ui.port('right');
        p.dataset.col = col;
        p.title = col ? 'Drag to another table or column to relate them' : 'Drag to another table to relate them';
        return p;
      }

      const ERD_END_PATHS = {
        one: '<path d="M-7 -6V6M-12 -6V6"/>',
        zeroOrOne: '<circle cx="-14" cy="0" r="4"/><path d="M-7 -6V6"/>',
        oneOrMany: '<path d="M-11 0 0 -6M-11 0H0M-11 0 0 6M-15 -6V6"/>',
        zeroOrMany: '<circle cx="-15.5" cy="0" r="4"/><path d="M-11 0 0 -6M-11 0H0M-11 0 0 6"/>'
      };
      const ERD_END_NAMES = { one: 'exactly one', zeroOrOne: 'zero or one', oneOrMany: 'one or many', zeroOrMany: 'zero or many' };
      const erdEndGlyph = (kind) => `<svg width="22" height="12" viewBox="-26 -9 30 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M-26 0H0"/>${ERD_END_PATHS[kind]}</svg>`;
      const abButton = (act, html, title, pressed, value, extra) => ui.abButton('erd-ab-btn', act, html, title, pressed, value, extra);
      const abSep = () => ui.abSep('erd-ab-sep');

      // The end handles sit this far along the line from the table edge, past the crow's foot (the marker is 26px long)
      const ERD_HANDLE_GAP = 34;
      // The point of the curve `dist` px along it from one end (the last point when `fromEnd`), found by sampling
      function erdPointAlong(c, dist, fromEnd) {
        const at = (t) => [0, 1].map((k) => (1 - t) ** 3 * c[0][k] + 3 * (1 - t) ** 2 * t * c[1][k] + 3 * (1 - t) * t * t * c[2][k] + t ** 3 * c[3][k]);
        let prev = at(fromEnd ? 1 : 0), run = 0;
        for (let i = 1; i <= 240; i++) {
          const p = at(fromEnd ? 1 - i / 240 : i / 240);
          run += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
          if (run >= dist) return p;
          prev = p;
        }
        return at(0.5);   // a line shorter than the gap: the middle
      }
      function addHandle(role, id, x, y) {
        const h = ui.port('end');
        h.dataset.role = role;
        h.dataset.id = id;
        h.setAttribute('data-touch-drag', '');   // a finger may drag it (the shell's touch rule)
        h.title = role === 'from' ? 'Drag to another table or column to move the child end' : 'Drag to another table or column to move the parent end';
        Object.assign(h.style, { left: erdPx(x), top: erdPx(y) });
        erdHtml.appendChild(h);
      }

      // The tools drawn on the selection: never exported ([data-export-skip]), not in ?present, hidden while dragging
      let lastHandleRelId = null;
      let lastBarKey = null;   // which selection the bar was last drawn for: a redraw of the same one makes no entrance
      function drawSelectionTools() {
        const oldBar = erdHtml.querySelector('.erd-actionbar');
        const barKey = erdSel && !erdPresenting() ? JSON.stringify([erdSel.kind, erdSel.id, erdSel.entity || null, erdSel.col || null, erdMultiIds]) : null;
        const sameBar = barKey !== null && barKey === lastBarKey;
        lastBarKey = barKey;
        if (oldBar) { if (sameBar) oldBar.remove(); else motion.hideBar(oldBar); }   // another element: the old bar closes, then the new one opens
        erdHtml.querySelectorAll('.port-end').forEach((el) => el.remove());
        if (!erdSel || erdPresenting()) { lastHandleRelId = null; return; }
        if (erdSel.kind !== 'rel') lastHandleRelId = null;
        const bar = ui.actionBar('erd-actionbar');
        let at = null, below = false;
        if (erdSel.kind === 'entity') {
          const e = erdEntity(erdSel.id);
          if (!e || !e.box) return;
          bar.setAttribute('aria-label', 'Table');
          bar.appendChild(abButton('addcol', `${ui.icon('plus')}<span>Column</span>`, 'Add a column after the last one'));
          bar.appendChild(abButton('note', ui.icon('note'), 'Add a note to this table (N)'));
          bar.appendChild(abSep());
          bar.appendChild(swatchPicker(e.color || '', (slot) => setEntityColor(e.id, slot), { triggerClass: 'erd-ab-btn', btnClass: 'erd-ab-swatch' }));
          bar.appendChild(abSep());
          const nSel = selectedEntityIds().length;
          bar.appendChild(abButton('delete', ui.icon('trash'), nSel > 1 ? `Delete these ${nSel} tables and their relationships` : 'Delete this table and its relationships', undefined, undefined, 'is-danger'));
          at = { x: e.box.x + e.box.w / 2, y: e.box.y - 10 / scale };
          at.top = e.box.y; at.bottom = e.box.y + e.box.h + 10 / scale;
        } else if (erdSel.kind === 'col') {
          const e = erdEntity(erdSel.entity);
          const col = e && (e.columns || []).find((c) => c.name === erdSel.col);
          const rowEl = e && entityEl(e.id) && [...entityEl(e.id).querySelectorAll('.erd-row')].find((r) => r.dataset.col === erdSel.col);
          if (!e || !col || !e.box || !rowEl) return;
          bar.setAttribute('aria-label', 'Column');
          [['pk', 'PK', 'Primary key (P)', col.pk], ['fk', 'FK', 'Foreign key (F)', col.fk], ['unique', 'U', 'Unique (U)', col.unique], ['nullable', '?', 'Nullable (?)', col.nullable]]
            .forEach(([act, label, title, on]) => bar.appendChild(abButton(act, `<span>${label}</span>`, title, !!on)));
          bar.appendChild(abSep());
          bar.appendChild(abButton('colnote', ui.icon('note'), col.note ? 'Edit note on this column (or double-click it)' : 'Add a note to this column (N), e.g. its allowed values'));
          bar.appendChild(abSep());
          bar.appendChild(abButton('up', ui.icon('chevron-up'), 'Move up (Alt+Up)'));
          bar.appendChild(abButton('down', ui.icon('chevron-down'), 'Move down (Alt+Down)'));
          bar.appendChild(abSep());
          bar.appendChild(abButton('delcol', ui.icon('trash'), 'Delete this column', undefined, undefined, 'is-danger'));
          // Over the table's header, not over its rows: the bar must not hide the neighbouring rows (the row itself is marked)
          at = { x: e.box.x + e.box.w / 2, y: e.box.y - 10 / scale };
          at.top = e.box.y; at.bottom = e.box.y + e.box.h + 10 / scale;
        } else if (erdSel.kind === 'rel') {
          const rel = erdRel(erdSel.id);
          if (!rel || !rel.curve || !rel.points || rel.points.length < 2) return;
          bar.setAttribute('aria-label', 'Relationship');
          bar.classList.add('is-wrap', 'is-wide');
          const ends = erRelEnds(rel, chartData);
          bar.appendChild(erdHtmlEl('span', 'erd-ab-tag', 'Child'));
          ERD_END_KINDS.forEach((k) => bar.appendChild(abButton('fromEnd', erdEndGlyph(k), `Child end (the table with the key): ${ERD_END_NAMES[k]}`, ends.fromEnd === k, k, 'erd-ab-glyph')));
          bar.appendChild(erdHtmlEl('span', 'erd-ab-break'));
          bar.appendChild(erdHtmlEl('span', 'erd-ab-tag', 'Parent'));
          ERD_END_KINDS.forEach((k) => bar.appendChild(abButton('toEnd', erdEndGlyph(k), `Parent end (the table it points to): ${ERD_END_NAMES[k]}`, ends.toEnd === k, k, 'erd-ab-glyph')));
          bar.appendChild(erdHtmlEl('span', 'erd-ab-break'));
          bar.appendChild(abButton('identifying', `${ui.icon(rel.identifying === true ? 'line-solid' : 'line-dashed')}<span>Identifying</span>`,
            'Identifying: the key is part of the child’s primary key (solid line); off: dashed', rel.identifying === true));
          bar.appendChild(abButton('reverse', ui.icon('reverse'), 'Reverse: swap the child and the parent'));
          bar.appendChild(abButton('label', ui.icon('label'), 'Label the line (or double-click it)'));
          const gap = ERD_HANDLE_GAP * (erdOverview ? 1 / scale : 1);   // the markers grow by 1 / scale in the overview
          const hFrom = erdPointAlong(rel.curve, gap, false), hTo = erdPointAlong(rel.curve, gap, true);
          addHandle('from', rel.id, hFrom[0], hFrom[1]);
          addHandle('to', rel.id, hTo[0], hTo[1]);
          if (lastHandleRelId !== erdSel.id && motion.enabled()) {
            erdHtml.querySelectorAll('.port-end').forEach((h) => {
              motion.anim(h, [{ transform: 'scale(0.4)' }, { transform: 'none' }], { duration: 110, easing: motion.curve('curve-spring-tactile') });
            });
          }
          lastHandleRelId = erdSel.id;
          erdHtml.appendChild(bar);
          ui.fitBar(bar);
          placeRelBar(bar, rel, [hFrom, hTo]);
          if (!sameBar) motion.showBar(bar);
          return;
        } else return;
        erdHtml.appendChild(bar);
        if (at.top !== undefined) {   // over its table, or under it when there is no room above in the window
          below = !ui.roomAbove({ getBoundingClientRect: () => ({ top: erdHtml.getBoundingClientRect().top + at.top * scale }) }, bar);
          if (below) at.y = at.bottom;
        }
        bar.classList.toggle('is-below', below);
        Object.assign(bar.style, { left: erdPx(at.x), top: erdPx(Math.max(2, at.y)) });
        if (bar.classList.contains('is-wrap')) ui.fitBar(bar);
        if (!sameBar) motion.showBar(bar);
      }
      // The line's bar sits above or below a point near the middle of its curve, wherever it hides the fewest tables
      function placeRelBar(bar, rel, handles) {
        const k = 1 / scale, p = rel.points, size = ui.barSize(bar), w = size.w * k, h = size.h * k;   // the bar is not zoomed: its footprint in the diagram grows with 1 / zoom
        const segs = [8, 6, 10, 4, 12].filter((i) => p[i]).map((i) => ({ x: p[i][0], y: p[i][1] }));
        const boxes = erdEntities().filter((e) => e.box).map((e) => e.box);
        // the label pills are obstacles too: a double-click on one must not land on the bar the first click opened
        erdHtml.querySelectorAll('.edge-label').forEach((l) => boxes.push({ x: parseFloat(l.style.left), y: parseFloat(l.style.top), w: l.offsetWidth, h: l.offsetHeight }));
        const C = chartData.canvas || { width: 1e9, height: 1e9 };
        // Candidates in a fixed order of preference: centred on the middle of the line, over it (or under it when the window has no
        // room above), then under/over, then slid sideways, then the next points along. The first with no overlap wins, so the bar
        // stays put while the line is only moved; an end handle under the bar outweighs everything else.
        const pad = 14 * k;
        const room = (s) => ui.roomAbove({ getBoundingClientRect: () => ({ top: erdHtml.getBoundingClientRect().top + s.y * scale }) }, bar);
        let best = null, rank = 0;
        segs.slice(0, 3).forEach((s) => [1, 3, 6].forEach((far) => {   // then further from the line, where tables are in the way
          const gap = 16 * k * far, preferBelow = !room(s);
          [0, -0.5, 0.5, -0.8, 0.8, -1.1, 1.1].forEach((shift) => [preferBelow, !preferBelow].forEach((below) => {
            // the bar's left edge: centred on the point, or slid along it, never off the canvas
            const x = Math.max(4, Math.min(s.x - w / 2 + shift * w, C.width - w - 4)), y = below ? s.y + gap : s.y - gap - h;
            let cost = rank++ * 0.01;
            boxes.forEach((b) => {
              const ox = Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x)), oy = Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
              cost += ox * oy;
            });
            if (y < 0) cost += 300;   // past the top of the canvas is fine (the bar floats), but a clear spot inside is better
            handles.forEach((hd) => { if (hd[0] > x - pad && hd[0] < x + w + pad && hd[1] > y - pad && hd[1] < y + h + pad) cost += 1e6; });
            if (!best || cost < best.cost) best = { cost, x: x + w / 2, y: below ? s.y + gap : s.y - gap, below };
          }));
        }));
        bar.classList.toggle('is-below', best.below);
        Object.assign(bar.style, { left: erdPx(best.x), top: erdPx(best.y) });
      }

      erdHtml.addEventListener('click', (e) => {
        const b = e.target.closest('.erd-ab-btn');
        if (!b || !erdSel) return;
        e.stopPropagation();
        runAction(b.dataset.act, b.dataset.value);
      });

      function runAction(act, value) {
        const sel = erdSel;
        if (sel.kind === 'entity') {
          const e = erdEntity(sel.id);
          if (!e) return;
          if (act === 'addcol') addColumn(e.id);
          else if (act === 'collapse') toggleCollapsed(e.id);
          else if (act === 'note') addNoteTo(e.id);
          else if (act === 'delete') deleteSelection(erdHtml.querySelector('.erd-ab-btn[data-act="delete"]'));
        } else if (sel.kind === 'col') {
          const e = erdEntity(sel.entity);
          if (!e) return;
          if (['pk', 'fk', 'unique', 'nullable'].includes(act)) toggleFlag(e.id, sel.col, act);
          else if (act === 'up') moveColumnBy(e.id, sel.col, -1);
          else if (act === 'down') moveColumnBy(e.id, sel.col, 1);
          else if (act === 'delcol') deleteColumn(e.id, sel.col);
          else if (act === 'colnote') editColumn(e.id, sel.col, 'note');
        } else if (sel.kind === 'rel') {
          const rel = erdRel(sel.id);
          if (!rel) return;
          const ends = erRelEnds(rel, chartData);
          if (act === 'fromEnd' && ends.fromEnd !== value) { rel.fromEnd = value; commit(); }
          else if (act === 'toEnd' && ends.toEnd !== value) { rel.toEnd = value; commit(); }
          else if (act === 'identifying') { if (rel.identifying === true) delete rel.identifying; else rel.identifying = true; commit(); }
          else if (act === 'reverse') reverseRelationship(rel);
          else if (act === 'label') editRelLabel(rel.id);
        }
      }

      // The colour of the selected table (all of them, when several are selected): a palette slot, '' = neutral
      function setEntityColor(id, slot) {
        const ids = selectedEntityIds().includes(id) ? selectedEntityIds() : [id];
        const ents = ids.map(erdEntity).filter((e) => e && (e.color || '') !== slot);
        if (!ents.length) return;
        ents.forEach((e) => { if (slot) e.color = slot; else delete e.color; });
        render();
        updateStatus(true);
        if (slot && !(chartData.colorKey && chartData.colorKey[slot])) nameColor(slot);   // invite a name for the colour (optional: leave it empty)
      }

      // --- COLOUR LEGEND (optional) ---
      // `colorKey` says what a table colour means. Tinting never asks for it: the legend is drawn only when some colour a table
      // uses has a label, lists only those, and sits above the top-left corner of the tables. "Name colour" in a tinted table's
      // bar (or Enter / F2 / a double-click on an entry) edits a label; clearing one removes it, clearing the last removes `colorKey`.
      function erdKeyColors() {
        const used = [];
        erdEntities().forEach((e) => { if (e.color && !used.includes(e.color)) used.push(e.color); });
        return used;
      }
      function drawKey() {
        const keySpec = [{ selector: '.color-key-item[data-color]', key: 'color' }];
        const snap = !erdInRender && motion.enabled() ? motion.capture(erdHtml, keySpec) : null;
        erdHtml.querySelectorAll('.color-key').forEach((el) => el.remove());
        const key = chartData.colorKey || {}, boxes = erdEntities().filter((e) => e.box).map((e) => e.box);
        const shown = erdKeyColors().filter((c) => key[c] || c === erdKeyDraft);
        const el = boxes.length && ui.colorKey(shown, key, { prompts: erdKeyDraft !== null, cls: 'erd-key' });
        if (!el) return;
        el.querySelectorAll('.color-key-item').forEach((it) => { const lbl = it.querySelector('.color-key-label'); if (lbl) it.dataset.color = lbl.dataset.color; });
        Object.assign(el.style, { left: erdPx(Math.min(...boxes.map((b) => b.x))), top: erdPx(Math.min(...boxes.map((b) => b.y)) - ERD_KEY_GAP) });
        erdHtml.appendChild(el);
        if (snap) motion.play(snap, erdHtml, keySpec, { duration: 170, easing: 'curve-spring-settle' });
      }
      // Sets or clears (value '') one label; true when it changed
      function setKeyLabel(color, value) {
        const was = (chartData.colorKey && chartData.colorKey[color]) || '';
        if (value === was) return false;
        if (value) (chartData.colorKey = chartData.colorKey || {})[color] = value;
        else { delete chartData.colorKey[color]; if (!Object.keys(chartData.colorKey).length) delete chartData.colorKey; }
        return true;
      }
      function editKey(el) {
        if (!el || erdPresenting()) return;
        const color = el.dataset.color, was = (chartData.colorKey && chartData.colorKey[color]) || '';
        el.classList.remove('is-empty');
        beginEdit(el, { raw: was, restore: was, apply: (value) => { erdKeyDraft = null; return setKeyLabel(color, value); } });
        el.addEventListener('blur', () => { if (erdKeyDraft) { erdKeyDraft = null; drawKey(); } });
      }
      function nameColor(color) {
        if (!color) return;
        erdKeyDraft = color;
        drawKey();
        editKey(erdHtml.querySelector(`.color-key-label[data-color="${color}"]`));
      }
      erdHtml.addEventListener('click', (e) => {
        const kl = e.target.closest('.color-key-label');
        if (!kl || kl.isContentEditable || erdPresenting()) return;
        e.stopPropagation();
        setSelection({ kind: 'key', color: kl.dataset.color });
      });

      // =====================================================================================================
      // --- PRESSES ---
      // =====================================================================================================
      function onErdPointerDown(e) {
        if (e.button > 0) return;
        const t = e.target;
        if (!(t instanceof Element) || t.isContentEditable) return;
        const entEl = t.closest('.erd-entity');
        if (erdPresenting()) {   // read only: selecting a table is all a press does
          if (entEl && !t.closest('.chevron, .note-badge')) selectEntity(entEl.dataset.nodeId);
          return;
        }
        if (t.closest('.erd-actionbar, .confirm, .chevron, .note-badge, .note-del, .note-link')) return;   // handled on click
        const handle = t.closest('.port-end');
        if (handle) { e.stopPropagation(); beginDrag(e, handleDrag(handle.dataset.role, handle.dataset.id)); return; }
        if (!entEl || t.closest('.note')) return;
        const id = entEl.dataset.nodeId;
        if (notePicking) { e.preventDefault(); const nr = t.closest('.erd-row'); giveNoteTo(id, nr ? nr.dataset.col : null); return; }
        if (selectedNoteId && e.shiftKey) { e.preventDefault(); toggleNoteLink(selectedNoteId, id); return; }
        // MULTI-SELECT: Ctrl/Cmd/Shift+click adds the table or takes it out; it never starts a drag
        if ((e.ctrlKey || e.metaKey || e.shiftKey) && !t.closest('.port:not(.port-end)')) { e.preventDefault(); toggleEntity(id); return; }
        // A table of several selected: a press anywhere on it (ports are hidden) drags them all
        const group = isMultiSelected() && selectedEntityIds().includes(id) ? selectedEntityIds() : null;
        if (group) {
          if (erdSel.id !== id) { erdSel = { kind: 'entity', id }; erdMultiOwner = erdSel; applyHighlight(); drawSelectionTools(); }
          beginDrag(e, Object.assign(entityDrag(id, entEl, group), { click: () => selectEntity(id) }));
          return;
        }
        const port = t.closest('.port:not(.port-end)'), row = t.closest('.erd-row'), head = t.closest('.erd-head');
        if (port) {
          const from = { entity: id, col: port.dataset.col || null };
          beginDrag(e, connectDrag(from, () => (from.col ? selectCol(id, from.col) : selectEntity(id))));
          return;
        }
        if (relArmed && (row || head)) { beginDrag(e, connectDrag({ entity: id, col: row ? row.dataset.col : null })); return; }
        // A finger on a row of the selected table moves the table (a tap selects the row); a mouse drags the row
        if (row && e.pointerType === 'touch' && erdSel && erdSel.kind === 'entity' && erdSel.id === id) {
          const drag = entityDrag(id, entEl);
          drag.click = () => selectCol(id, row.dataset.col);
          beginDrag(e, drag);
          return;
        }
        if (row) { selectCol(id, row.dataset.col); beginDrag(e, rowDrag(id, row.dataset.col, row)); return; }
        selectEntity(id);
        beginDrag(e, entityDrag(id, entEl));
      }
      erdHtml.addEventListener('pointerdown', onErdPointerDown);

      // --- Draw a relationship: drag from a row's port (or the header's) onto another table or one of its rows ---
      function connectDrag(from, onClick) {
        const a = erdEntity(from.entity);
        return {
          click: onClick,
          move(e, d) {
            const x = a.box.x + a.box.w / 2, y = a.box.y + a.box.h / 2;
            const pt = erdPoint(e);
            showRubber(x, y, pt.x, pt.y);
            d.target = erdTargetAt(e);
            markTarget(d.target);
          },
          drop(e, d) {
            if (relArmed) setRelArmed(false);
            if (!d.target) { render(); return; }
            connectEntities(from, d.target);
          }
        };
      }

      // Inference (plan, Editing): from a column onto a column, the start column becomes a foreign key, the line is dashed
      // (solid when that column is part of the child's primary key), the ends are zero-or-many to one (zero-or-one when
      // the column is nullable) and `columns` names the start column; `toColumns` only when the target is not the first
      // primary-key column. Dropped on a header: no columns (a self-reference always needs its column).
      function connectEntities(src, dst) {
        const a = erdEntity(src.entity), b = erdEntity(dst.entity);
        if (!a || !b) return false;
        const srcCol = src.col ? (a.columns || []).find((c) => c.name === src.col) : null;
        const dstCol = dst.col ? (b.columns || []).find((c) => c.name === dst.col) : null;
        const self = a === b;
        if (self && !srcCol) { erdHint('Start a self-reference from a column'); render(); return false; }
        if (self && dstCol && dstCol === srcCol) { erdHint('Drop it on another column of the table'); render(); return false; }
        const rel = { id: erdUid('r'), from: a.id, to: b.id };
        const useSrc = !!srcCol && (!!dstCol || self);
        if (useSrc) rel.columns = [srcCol.name];
        if (dstCol && dstCol.name !== erdFirstPk(b)) rel.toColumns = [dstCol.name];
        rel.fromEnd = 'zeroOrMany';
        rel.toEnd = useSrc && srcCol.nullable ? 'zeroOrOne' : 'one';
        if (useSrc && srcCol.pk) rel.identifying = true;
        const same = erdRelsList().find((r) => r.from === rel.from && r.to === rel.to && JSON.stringify(r.columns || null) === JSON.stringify(rel.columns || null)
          && JSON.stringify(r.toColumns || null) === JSON.stringify(rel.toColumns || null));
        if (same) { erdHint('Those two are already related that way'); selectRel(same.id); render(); return false; }
        if (useSrc && !srcCol.fk) srcCol.fk = true;
        chartData.relationships = erdRelsList();
        chartData.relationships.push(rel);
        erdSel = { kind: 'rel', id: rel.id };
        selectedNoteId = null;
        commit();
        const line = relEl(rel.id)?.querySelector('.edge-line');
        if (line) motion.drawPath(line, { duration: 140, easing: 'curve-out' });
        return true;
      }

      // --- Re-point one end of the selected line: drag its handle onto another table or column ---
      function handleDrag(role, relId) {
        const rel = erdRel(relId);
        return {
          move(e, d) {
            if (!rel || !rel.curve) return;
            const fixed = role === 'from' ? rel.curve[3] : rel.curve[0];
            const pt = erdPoint(e);
            showRubber(fixed[0], fixed[1], pt.x, pt.y);
            d.target = erdTargetAt(e);
            markTarget(d.target);
          },
          drop(e, d) {
            if (!rel || !d.target) { render(); return; }
            const ent = erdEntity(d.target.entity);
            const col = d.target.col && (ent.columns || []).find((c) => c.name === d.target.col);
            const before = JSON.stringify(rel);
            const draft = JSON.parse(before);
            if (role === 'from') {
              draft.from = ent.id;
              if (col) draft.columns = [col.name]; else delete draft.columns;
            } else {
              draft.to = ent.id;
              if (col && col.name !== erdFirstPk(ent)) draft.toColumns = [col.name]; else delete draft.toColumns;
            }
            if (draft.from === draft.to && !(draft.columns && draft.columns.length)) { erdHint('A self-reference needs a column: drop the child end on one'); render(); return; }
            Object.keys(rel).forEach((k) => delete rel[k]);
            Object.assign(rel, draft);
            if (role === 'from' && col && !col.fk) col.fk = true;
            commit();
          }
        };
      }

      function reverseRelationship(rel) {
        const from = erdEntity(rel.from), to = erdEntity(rel.to);
        if (!from || !to) return;
        const ends = erRelEnds(rel, chartData);
        const toCol = erdToCol(rel, to);                              // where the line entered the parent
        const oldCols = Array.isArray(rel.columns) ? rel.columns.slice() : null;
        rel.from = to.id;
        rel.to = from.id;
        rel.fromEnd = ends.toEnd;
        rel.toEnd = ends.fromEnd;
        if (Array.isArray(rel.toColumns) && rel.toColumns.length) rel.columns = rel.toColumns.slice();
        else if (toCol) rel.columns = [toCol]; else delete rel.columns;
        if (oldCols && oldCols.length && !(oldCols.length === 1 && oldCols[0] === erdFirstPk(from))) rel.toColumns = oldCols; else delete rel.toColumns;
        commit();
        const line = relEl(rel.id)?.querySelector('.edge-line');
        if (line && motion.enabled()) {
          motion.anim(line, [{ strokeWidth: '3.2px' }, { strokeWidth: '' }], { duration: 180, easing: motion.curve('curve-out') });
          if (rel.identifying) motion.drawPath(line, { duration: 160, easing: 'curve-out' });
          else motion.anim(line, [{ strokeDashoffset: '20' }, { strokeDashoffset: '0' }], { duration: 180, easing: motion.curve('curve-out') });
        }
      }

      // --- Move a table ---
      // A drop writes the table's x/y wherever it lands (a drag never re-lays out); overlapping
      // tables are pushed apart (erdSettle) and only the lines are re-routed (routeDiagram). Dashed guides snap a table's
      // centre to another table's centre within 6px.
      // `group`: ids of every table moving together (several selected).
      function entityDrag(id, el, group) {
        const e = erdEntity(id);
        const ids = group || [id];
        const els = ids.map((x) => entityEl(x)).filter(Boolean);
        // Lines of the moved tables fade while they move (they would lag behind); the drop re-routes them
        let lineEls = null;
        const fadeLines = (on) => {
          if (!lineEls && on) lineEls = erdRelsList().filter((r) => ids.includes(r.from) || ids.includes(r.to)).flatMap((r) => [relEl(r.id), labelEl(r.id)]).filter(Boolean);
          (lineEls || []).forEach((x) => x.classList.toggle('drag-fade', on));
        };
        return {
          move(ev, d) {
            els.forEach((x) => x.classList.add('is-dragging'));
            fadeLines(true);
            let dx = d.dx, dy = d.dy;
            if (e.box) {
              const cx = e.box.x + e.box.w / 2 + dx, cy = e.box.y + e.box.h / 2 + dy;
              let sx = null, sy = null;
              erdEntities().forEach((o) => {
                if (ids.includes(o.id) || !o.box) return;
                const ox = o.box.x + o.box.w / 2, oy = o.box.y + o.box.h / 2;
                if (Math.abs(ox - cx) <= 6 && (sx === null || Math.abs(ox - cx) < Math.abs(sx - cx))) sx = ox;
                if (Math.abs(oy - cy) <= 6 && (sy === null || Math.abs(oy - cy) < Math.abs(sy - cy))) sy = oy;
              });
              if (sx !== null) { dx += sx - cx; erdGuideV.style.left = erdPx(sx); erdGuideV.style.display = 'block'; } else erdGuideV.style.display = 'none';
              if (sy !== null) { dy += sy - cy; erdGuideH.style.top = erdPx(sy); erdGuideH.style.display = 'block'; } else erdGuideH.style.display = 'none';
              d.sdx = dx; d.sdy = dy; d.snapped = sx !== null || sy !== null;
            }
            els.forEach((x) => { x.style.translate = `${dx}px ${dy}px`; });
          },
          drop(ev, d) {
            els.forEach((x) => x.classList.remove('is-dragging'));
            fadeLines(false);
            const dx = d.sdx === undefined ? d.dx : d.sdx, dy = d.sdy === undefined ? d.dy : d.sdy;
            const ents = ids.map(erdEntity).filter((x) => x && x.box);
            if (!ents.length) { render(); return; }
            const snap = erdCapture();
            ents.forEach((t) => erdPlaceAt(t, t.box.x + dx, t.box.y + dy, !!d.snapped));   // a snapped drop keeps its exact alignment
            const beforeSettle = new Map(ents.map((t) => [t.id, { x: t.x, y: t.y }]));
            erdSettled({ tables: new Set(ids) });
            const skipKeys = new Set();
            ents.forEach((t) => {
              const b = beforeSettle.get(t.id);
              if (t.x === b.x && t.y === b.y) {
                skipKeys.add(t.id);
                (t.columns || []).forEach((c) => skipKeys.add(`${t.id}:${c.name}`));
              }
            });
            render({ snap, skipKeys, duration: 190, easing: 'curve-spring-settle' });
            if (motion.enabled()) {
              skipKeys.forEach((tid) => {
                const dropped = !tid.includes(':') && entityEl(tid);
                if (dropped) motion.anim(dropped, [{ transform: 'scale(1.015)' }, { transform: 'none' }], { duration: 130, easing: motion.curve('curve-spring-settle') });
              });
            }
            updateStatus(true);
          }
        };
      }

      // --- Reorder a column: drag its row within the table ---
      function rowDrag(entityId, colName, el) {
        const e = erdEntity(entityId);
        return {
          move(ev, d) {
            el.classList.add('is-dragging');
            el.style.translate = `0 ${d.dy}px`;
            const rows = [...el.parentNode.querySelectorAll('.erd-row')].filter((r) => r !== el);
            d.before = null;
            for (const r of rows) {
              const rect = r.getBoundingClientRect();
              if (ev.clientY < rect.top + rect.height / 2) { d.before = r; break; }
            }
            const ref = d.before || rows[rows.length - 1];
            if (!ref) return;
            const rect = ref.getBoundingClientRect();
            const y = erdPoint({ clientX: rect.left, clientY: d.before ? rect.top : rect.bottom }).y;
            Object.assign(erdDropLine.style, { display: 'block', left: erdPx(e.box.x + 4), width: erdPx(e.box.w - 8), top: erdPx(y - 2), height: '4px' });
          },
          drop(ev, d) {
            el.classList.remove('is-dragging');
            const snap = erdCapture();
            const cols = e.columns || [], from = cols.findIndex((c) => c.name === colName);
            let to;
            if (d.before) to = cols.findIndex((c) => c.name === d.before.dataset.col);
            else {
              const rows = [...el.parentNode.querySelectorAll('.erd-row')].filter((r) => r !== el);
              const last = rows[rows.length - 1];
              to = last ? cols.findIndex((c) => c.name === last.dataset.col) + 1 : from;
            }
            if (from < 0 || to < 0) { render({ snap }); return; }
            const [col] = cols.splice(from, 1);
            if (to > from) to--;
            if (to === from) { cols.splice(from, 0, col); render({ snap }); return; }
            cols.splice(to, 0, col);
            commit({ snap, duration: 180, easing: 'curve-spring-settle' });
          }
        };
      }

      // =====================================================================================================
      // --- INLINE TEXT EDITING (double-click, Enter / F2, or straight after creating something) ---
      // Enter commits; Esc keeps the old text; Tab commits and moves on (opts.onTab). opts.apply(value, how) changes the
      // model and returns true when it did (then the edit ends in commit()); opts.onEnter runs after an Enter commit.
      // =====================================================================================================
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
        let how = null, done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el.removeEventListener('blur', finish);
          el.removeEventListener('keydown', onKey);
          el.contentEditable = 'false';
          el.classList.remove('is-editing');
          const value = el.textContent.replace(/\s*\n\s*/g, ' ').trim();
          const changed = value !== original || (how === 'enter' && value === '') ? !!opts.apply(value, how) : false;
          if (changed) commit();
          else {
            if (opts.restore !== undefined) el.textContent = opts.restore;
            else el.textContent = original;
            if (opts.onCancel) opts.onCancel();
          }
          if (how === 'tab' && opts.onTab) opts.onTab(changed);
          else if (how === 'enter' && opts.onEnter) opts.onEnter(changed);
        };
        const onKey = (ke) => {
          // The keys an edit uses stop here: an Enter that reached the window would open the selection's edit again
          if (ke.key === 'Enter' || ke.key === 'Tab' || ke.key === 'F2') ke.stopPropagation();
          if (ke.key === 'Enter') { ke.preventDefault(); how = 'enter'; el.blur(); finish(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); el.textContent = original; el.blur(); finish(); }
          else if (ke.key === 'Tab' && opts.onTab) { ke.preventDefault(); how = 'tab'; el.blur(); finish(); }
        };
        el.addEventListener('blur', finish);
        el.addEventListener('keydown', onKey);
      }

      const colEls = (id) => (entityEl(id) ? [...entityEl(id).querySelectorAll('.erd-row')] : []);
      function editEntityName(id) {
        const e = erdEntity(id);
        const el = entityEl(id) && entityEl(id).querySelector('.erd-name');
        if (!e || !el) return;
        const first = (erVisibleColumns(e, chartData).cols[0] || {}).col;
        beginEdit(el, {
          apply: (value) => { if (!value || value === erName(e)) return false; e.name = value; return true; },
          onTab: first ? () => editColumn(id, first.name, 'name') : undefined
        });
      }

      // A column's name, type or note (inline text next to the column name, e.g. allowed values: "new, paid, shipped").
      // Tab: name -> type -> the next row's name; Enter on the last row adds a column; an empty name on Enter removes the
      // column; an empty note removes the note.
      function editColumn(entityId, colName, field) {
        const e = erdEntity(entityId);
        const col = e && (e.columns || []).find((c) => c.name === colName);
        const row = colEls(entityId).find((r) => r.dataset.col === colName);
        if (!e || !col || !row) return;
        selectCol(entityId, colName);
        const showTypes = chartData.showTypes !== false;
        const vis = erVisibleColumns(e, chartData).cols.map((v) => v.col.name);
        const isLast = vis[vis.length - 1] === colName;
        const nextName = vis[vis.indexOf(colName) + 1];
        let removed = false;
        if (field === 'note') {
          let el = row.querySelector('.erd-col-note');
          if (!el) {   // no note yet: place it right before the type (or at the end when types are hidden)
            el = erdHtmlEl('span', 'erd-col-note');
            row.insertBefore(el, row.querySelector('.erd-col-type'));
          }
          beginEdit(el, {
            raw: col.note == null ? '' : String(col.note),
            apply: (value) => {
              if ((col.note || '') === value) return false;
              if (value) col.note = value; else delete col.note;
              return true;
            },
            restore: col.note == null ? '' : String(col.note),
            onCancel: () => { if (!col.note && el.parentNode) el.remove(); },
            onTab: nextName ? () => editColumn(entityId, nextName, 'name') : undefined
          });
          return;
        }
        if (field === 'type' && showTypes) {
          const el = row.querySelector('.erd-col-type');
          beginEdit(el, {
            raw: col.type == null ? '' : String(col.type),
            restore: `${col.type == null ? '' : col.type}${col.nullable ? '?' : ''}`,
            apply: (value) => {
              if ((col.type || '') === value) return false;
              if (value) col.type = value; else delete col.type;
              return true;
            },
            onTab: nextName ? () => editColumn(entityId, nextName, 'name') : undefined,
            onEnter: () => { if (isLast) addColumn(entityId); }
          });
          return;
        }
        beginEdit(row.querySelector('.erd-col-name'), {
          apply: (value, how) => {
            if (!value) {
              if (how !== 'enter') return false;
              removed = true;
              removeColumn(e, colName);
              return true;
            }
            if (value === colName) return false;
            if ((e.columns || []).some((c) => c !== col && c.name === value)) { erdHint(`${erdText(erName(e))} already has a column “${erdText(value)}”`); return false; }
            renameColumn(e, colName, value);
            colName = value;
            return true;
          },
          onTab: () => (showTypes ? editColumn(entityId, colName, 'type') : (nextName && editColumn(entityId, nextName, 'name'))),
          onEnter: () => { if (isLast && !removed) addColumn(entityId); }
        });
      }

      // A line's label: made for the edit when the line has none (the engine places it after the commit)
      function editRelLabel(id) {
        const rel = erdRel(id);
        if (!rel || !rel.curve || erdPresenting()) return;
        if (!erdSel || erdSel.kind !== 'rel' || erdSel.id !== id) selectRel(id);
        let box = labelEl(id);
        if (!box) {
          const mid = relMid(rel);
          box = erdHtmlEl('div', 'edge-label edge-label--single');
          box.dataset.edgeId = id;
          box.dataset.exportSkip = '';
          Object.assign(box.style, { left: erdPx(mid.x - 44), top: erdPx(mid.y - 11), width: '88px', height: '22px' });
          box.appendChild(erdHtmlEl('span', 'erd-rel-label-text'));
          erdHtml.appendChild(box);
        }
        box.classList.add('is-editing-label');
        beginEdit(box.querySelector('.erd-rel-label-text'), {
          raw: rel.label == null ? '' : String(rel.label),
          apply: (value) => {
            if ((rel.label || '') === value) return false;
            if (value) rel.label = value; else delete rel.label;
            return true;
          },
          restore: rel.label == null ? '' : String(rel.label),
          // nothing typed on a line with no label: no blank pill is left behind
          onCancel: () => { box.classList.remove('is-editing-label'); if (rel.label == null && !box.querySelector('.erd-rel-label-text').textContent.trim()) box.remove(); }
        });
      }

      erdHtml.addEventListener('dblclick', (e) => {
        if (erdPresenting()) return;
        const t = e.target;
        if (t.closest('.erd-actionbar, .chevron, .note-badge, .port, .note')) return;
        if (t.isContentEditable) return;
        const label = t.closest('.edge-label');
        if (label) { e.stopPropagation(); editRelLabel(label.dataset.edgeId); return; }
        const kl = t.closest('.color-key-label');
        if (kl) { e.stopPropagation(); editKey(kl); return; }
        const ent = t.closest('.erd-entity');
        if (!ent) return;
        const id = ent.dataset.nodeId, row = t.closest('.erd-row');
        e.stopPropagation();
        if (erdOverview) { erdZoomToTable(id); return; }   // editing needs the rows: zoom in first
        if (row) editColumn(id, row.dataset.col, t.closest('.erd-col-type') ? 'type' : t.closest('.erd-col-note') ? 'note' : 'name');
        else if (t.closest('.erd-head')) editEntityName(id);
      });
      erdRels.addEventListener('dblclick', (e) => {
        if (erdPresenting()) return;
        const g = e.target.closest('.erd-rel');
        if (g) { e.stopPropagation(); editRelLabel(g.dataset.edgeId); }
      });
      function editSelection() {
        const s = erdSel;
        if (selectedNoteId && !s) { editNote(selectedNoteId); return; }
        if (!s) return;
        if (s.kind === 'entity') editEntityName(s.id);
        else if (s.kind === 'col') editColumn(s.entity, s.col, 'name');
        else if (s.kind === 'rel') editRelLabel(s.id);
        else if (s.kind === 'key') editKey(erdHtml.querySelector(`.color-key-label[data-color="${s.color}"]`));
      }

      // =====================================================================================================
      // --- MODEL OPERATIONS ---
      // =====================================================================================================
      // Columns are named in relationships (`columns`, `toColumns`): a rename follows, a delete drops the name
      function renameColumn(e, from, to) {
        const col = (e.columns || []).find((c) => c.name === from);
        if (!col) return;
        col.name = to;
        notesList().forEach((n) => { if (n.column === from && (n.entities || [])[0] === e.id) n.column = to; });
        erdRelsList().forEach((r) => {
          if (r.from === e.id && Array.isArray(r.columns)) r.columns = r.columns.map((n) => (n === from ? to : n));
          if (r.to === e.id && Array.isArray(r.toColumns)) r.toColumns = r.toColumns.map((n) => (n === from ? to : n));
        });
        if (erdSel && erdSel.kind === 'col' && erdSel.entity === e.id && erdSel.col === from) erdSel.col = to;
      }
      function removeColumn(e, name) {
        e.columns = (e.columns || []).filter((c) => c.name !== name);
        if (notesList().some((n) => n.column === name && (n.entities || [])[0] === e.id)) {
          chartData.notes = notesList().filter((n) => !(n.column === name && (n.entities || [])[0] === e.id));
          if (!chartData.notes.length) delete chartData.notes;
        }
        erdRelsList().forEach((r) => {
          if (r.from === e.id && Array.isArray(r.columns)) { r.columns = r.columns.filter((n) => n !== name); if (!r.columns.length) delete r.columns; }
          if (r.to === e.id && Array.isArray(r.toColumns)) { r.toColumns = r.toColumns.filter((n) => n !== name); if (!r.toColumns.length) delete r.toColumns; }
        });
        if (erdSel && erdSel.kind === 'col' && erdSel.entity === e.id && erdSel.col === name) erdSel = { kind: 'entity', id: e.id };
      }
      function deleteColumn(entityId, name) {
        const e = erdEntity(entityId);
        if (!e) return;
        removeColumn(e, name);
        erdSel = { kind: 'entity', id: e.id };
        commit();
      }
      function addColumn(entityId, afterName) {
        const e = erdEntity(entityId);
        if (!e) return;
        if (erdDetail() !== 'all') { erdHint('Show all columns first (the Columns button), then add one'); return; }
        if (e.collapsed === true) delete e.collapsed;
        e.columns = e.columns || [];
        let n = e.columns.length + 1, name;
        do { name = `column_${n++}`; } while (e.columns.some((c) => c.name === name));
        const at = afterName ? e.columns.findIndex((c) => c.name === afterName) : e.columns.length - 1;
        e.columns.splice(at + 1, 0, { name, type: 'text' });
        erdSel = { kind: 'col', entity: e.id, col: name };
        selectedNoteId = null;
        commit();
        const row = colEls(e.id).find((r) => r.dataset.col === name);
        panIntoView(row);
        editColumn(e.id, name, 'name');
      }
      function toggleFlag(entityId, name, flag) {
        const e = erdEntity(entityId), col = e && (e.columns || []).find((c) => c.name === name);
        if (!col) return;
        if (col[flag]) delete col[flag]; else col[flag] = true;
        commit();
        if (!motion.enabled()) return;
        const row = colEls(entityId).find((r) => r.dataset.col === name);
        if (!row) return;
        const target = flag === 'unique' ? row.querySelector('.erd-uniq') : flag === 'nullable' ? row.querySelector('.erd-col-type') : row.querySelector('.erd-glyph');
        if (target) motion.anim(target, [{ transform: 'scale(0.7)' }, { transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 140, easing: motion.curve('curve-spring-tactile') });
      }
      // Up or down to the neighbouring column that is on show
      function moveColumnBy(entityId, name, dir) {
        const e = erdEntity(entityId);
        if (!e) return false;
        const cols = e.columns || [], from = cols.findIndex((c) => c.name === name);
        const visible = new Set(erVisibleColumns(e, chartData).cols.map((v) => v.col.name));
        let to = from + dir;
        while (to >= 0 && to < cols.length && !visible.has(cols[to].name)) to += dir;
        if (from < 0 || to < 0 || to >= cols.length) return false;
        const [col] = cols.splice(from, 1);
        cols.splice(to, 0, col);
        commit();
        return true;
      }

      // --- Tables ---
      function erdSelectedEntityId() {
        if (!erdSel) return null;
        if (erdSel.kind === 'entity') return erdSel.id;
        if (erdSel.kind === 'col') return erdSel.entity;
        return null;
      }
      // A new table must be placed (a table without x/y would send the whole diagram to the layout):
      // at the drop point; else beside the selected table; then moved down clear of other tables, and overlaps pushed apart
      function placeNewTable(e, pt) {
        const size = erEntitySize(e, chartData);
        const sel = erdEntity(erdSelectedEntityId());
        let x, y;
        if (pt) { x = pt.x - size.w / 2; y = pt.y - ER.HEAD_H / 2; }
        else if (sel && sel.box) { x = sel.box.x + sel.box.w + 80; y = sel.box.y; }
        else {
          const v = viewport.getBoundingClientRect();
          const c = erdPoint({ clientX: v.left + v.width / 2, clientY: v.top + v.height / 2 });
          x = c.x - size.w / 2; y = c.y - size.h / 2;
        }
        const boxes = erdEntities().filter((o) => o !== e && o.box).map((o) => o.box);
        for (let k = 0; k < 80 && boxes.some((b) => boxesOverlap({ x, y, w: size.w, h: size.h }, b, 16)); k++) y += 40;
        erdPlaceAt(e, x, y);
        erdSettled({ tables: new Set([e.id]) });
      }
      function addTable(opts = {}) {
        const ents = chartData.entities = erdEntities();
        let n = ents.length + 1;
        const names = new Set(ents.map((x) => erName(x)));
        while (names.has(`table_${n}`)) n++;
        const e = { id: erdUid('t'), name: `table_${n}`, columns: [{ name: 'id', type: 'uuid', pk: true }] };
        const afterId = opts.pt ? null : erdSelectedEntityId();
        const at = afterId ? ents.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) ents.splice(at + 1, 0, e); else ents.push(e);
        placeNewTable(e, opts.pt);
        selectedNoteId = null;
        erdSel = { kind: 'entity', id: e.id };
        commit({ originRect: opts.originRect || null, duration: 200, easing: 'curve-spring-tactile' });
        if (!opts.originRect) panIntoView(entityEl(e.id));
        editEntityName(e.id);
      }

      // --- Delete ---
      function ghostRetractRel(g) {
        const line = g && g.querySelector('.edge-line');
        if (!line || !motion.enabled()) return;
        const len = line.getTotalLength();
        if (!len) return;
        const clone = line.cloneNode(true);
        clone.style.stroke = getComputedStyle(line).stroke;
        clone.style.strokeWidth = getComputedStyle(line).strokeWidth;
        erdOverlay.appendChild(clone);
        const a = clone.animate(
          [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: 0, opacity: 1 },
           { strokeDasharray: `${len} ${len}`, strokeDashoffset: len, opacity: 0 }],
          { duration: 120, easing: motion.curve('curve-in') }
        );
        const rm = () => clone.remove();
        a.addEventListener('finish', rm, { once: true });
        a.addEventListener('cancel', rm, { once: true });
      }
      function deleteEntity(id) { deleteEntities([id]); }
      function deleteEntities(ids) {
        ids = ids.filter((id) => erdEntity(id));
        if (!ids.length) return;
        const gone = new Set(ids);
        if (motion.enabled()) {
          ids.forEach((id) => { const el = entityEl(id); if (el) motion.ghostExit(el, { duration: 120, easing: 'curve-in', transform: 'scale(0.92)' }); });
          erdRels.querySelectorAll('.erd-rel').forEach((g) => { if (gone.has(g.dataset.from) || gone.has(g.dataset.to)) ghostRetractRel(g); });
        }
        chartData.entities = erdEntities().filter((e) => !gone.has(e.id));
        chartData.relationships = erdRelsList().filter((r) => !gone.has(r.from) && !gone.has(r.to));
        // A note loses the tables; one left with no table goes (a free note never had any and stays)
        if (Array.isArray(chartData.notes)) {
          chartData.notes = chartData.notes.filter((n) => {
            const had = (n.entities || []).length;
            n.entities = (n.entities || []).filter((x) => !gone.has(x));
            return !had || n.entities.length;
          });
          if (!chartData.notes.length) delete chartData.notes;
        }
        erdSel = null;
        commit({ enter: false, duration: 180 });
      }
      function deleteRel(id) {
        ghostRetractRel(relEl(id));
        chartData.relationships = erdRelsList().filter((r) => r.id !== id);
        erdSel = null;
        commit({ enter: false, duration: 160 });
      }

      // Deleting a table with relationships, or an area with tables, is confirmed first, in a small bubble at the button
      function confirmDelete(message, label, onOk, anchorEl) { ui.confirm(anchorEl, { message, label }, onOk); }

      function deleteSelection(anchorEl) {
        if (erdPresenting()) return;
        if (selectedNoteId && !erdSel) { removeNote(selectedNoteId); return; }
        const s = erdSel;
        if (!s) return;
        if (s.kind === 'entity' && isMultiSelected()) {
          const ids = selectedEntityIds(), set = new Set(ids);
          const count = erdRelsList().filter((r) => set.has(r.from) || set.has(r.to)).length;
          if (count) {
            confirmDelete(`Delete ${ids.length} tables and their ${count} relationship${count === 1 ? '' : 's'}?`, 'Delete tables', () => deleteEntities(ids), anchorEl || entityEl(s.id));
          } else deleteEntities(ids);
        } else if (s.kind === 'entity') {
          const e = erdEntity(s.id);
          if (!e) return;
          const count = erdRelsList().filter((r) => r.from === e.id || r.to === e.id).length;
          if (count) {
            confirmDelete(`Delete ${erName(e)} and its ${count} relationship${count === 1 ? '' : 's'}?`, 'Delete table', () => deleteEntity(e.id), anchorEl || entityEl(e.id));
          } else deleteEntity(e.id);
        } else if (s.kind === 'col') deleteColumn(s.entity, s.col);
        else if (s.kind === 'rel') deleteRel(s.id);
        else if (s.kind === 'key') { setKeyLabel(s.color, ''); erdSel = null; commit(); }
      }

      // =====================================================================================================
      // --- NOTES ---
      // N, the + chip and the Note button open the table's (or the selected column's) note, or start a new one (dropped again if left empty). A note
      // belongs to one or more tables (`entities`; the first is its anchor): drag its link handle onto a table to link it
      // or unlink it, or Shift+click a table. Drag a card to pin it (`pos`, relative to the anchor table).
      // =====================================================================================================
      function addNoteTo(entityId, col) {
        if (col) { editColumn(entityId, col, 'note'); return; }
        if (!erdEntity(entityId) || erdPresenting()) return;
        const existing = notesOfEntity(entityId)[0];
        if (existing) { editNote(existing.id); return; }
        const note = { id: erdUid('n'), text: '', entities: [entityId] };
        chartData.notes = notesList();
        chartData.notes.push(note);
        editNote(note.id);
      }
      // A free note with its top-left at a canvas point (default: the middle of the view); dropped again if left empty
      function addFreeNote(pt, originRect) {
        if (erdPresenting()) return;
        const v = viewport.getBoundingClientRect();
        const c = pt || erdPoint({ clientX: v.left + v.width / 2 - 80 * scale, clientY: v.top + v.height / 2 - 20 * scale });
        const note = { id: erdUid('n'), text: '', entities: [], pos: { x: erdRound4(c.x), y: erdRound4(c.y) } };
        chartData.notes = notesList();
        chartData.notes.push(note);
        pendingNoteOriginRect = originRect || null;
        editNote(note.id);
      }
      function selectNote(id) {
        erdSel = null;
        selectedNoteId = id;
        applyHighlight();
        drawSelectionTools();
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }
      function editNote(id) {
        const note = noteById(id);
        if (!note || erdPresenting()) return;
        cancelDrag();
        setRelArmed(false);
        setNotePicking(false);
        editingNoteId = id;
        selectNote(id);
        if (!noteCard(id)) renderNotes(false);
        const card = noteCard(id);
        if (!card) return;
        card.style.pointerEvents = '';
        applyNoteVisibility();
        const text = card.querySelector('.note-text');
        text.contentEditable = 'true';
        text.focus();
        const range = document.createRange();
        range.selectNodeContents(text);
        range.collapse(false);   // caret at the end: adding to a note is more common than replacing it
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
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
          if (selectedNoteId === note.id) selectedNoteId = null;
        }
        updateStatus(true);
        render({ skipKeys: new Set([note.id]), duration: 160 });   // badges appear or go, and the notes are fitted again around the new size
      }
      // Clicking anywhere else finishes the note being typed
      window.addEventListener('pointerdown', (e) => {
        if (!editingNoteId) return;
        const card = noteCard(editingNoteId);
        if (card && card.contains(e.target)) return;
        const text = card && card.querySelector('.note-text'), note = noteById(editingNoteId);
        if (text) text.blur();
        if (text && note) commitNote(note, text);   // no-op if the blur already committed it
      }, true);
      function removeNote(id) {
        if (!noteById(id)) return;
        chartData.notes = notesList().filter((n) => n.id !== id);
        if (!chartData.notes.length) delete chartData.notes;
        if (editingNoteId === id) editingNoteId = null;
        if (selectedNoteId === id) selectedNoteId = null;
        updateStatus(true);
        render();
      }
      // Link a note to a table, or unlink it when it is linked already (a note keeps at least one table). A pinned note
      // whose anchor goes keeps its place, measured from its new anchor.
      function toggleNoteLink(noteId, entityId) {
        const note = noteById(noteId), e = erdEntity(entityId);
        if (!note || !e) return;
        const ids = note.entities || [];
        if (!ids.length) {   // a free note becomes anchored: its absolute pos turns relative to the table
          if (e.box) note.pos = { x: Math.round(note.pos.x - e.box.x), y: Math.round(note.pos.y - e.box.y) }; else delete note.pos;
          note.entities = [entityId];
        } else if (!ids.includes(entityId)) note.entities = ids.concat(entityId);
        else if (ids.length > 1) {
          if (ids[0] === entityId && note.pos) {
            const card = noteCard(noteId), next = erdEntity(ids[1]);
            if (card && next && next.box) note.pos = { x: Math.round((parseFloat(card.style.left) || 0) - next.box.x), y: Math.round((parseFloat(card.style.top) || 0) - next.box.y) };
            else delete note.pos;
          }
          note.entities = ids.filter((id) => id !== entityId);
        } else { erdHint('A note keeps at least one table: delete the note instead'); return; }
        selectedNoteId = noteId;
        updateStatus(true);
        render({ drawNewLeaders: true, skipFreeNotes: true });
        if (motion.enabled()) {
          const badge = entityEl(entityId)?.querySelector('.note-badge');
          if (badge) motion.anim(badge, [{ transform: 'scale(0.4)' }, { transform: 'none' }], { duration: 140, easing: motion.curve('curve-spring-tactile') });
        }
      }
      function startNoteLink(ev, noteId, card) {
        if (ev.button !== 0 || erdPresenting()) return;
        ev.stopPropagation();
        ev.preventDefault();
        selectNote(noteId);
        const line = erdSvgEl('line', { class: 'note-leader linking', 'data-note-id': noteId });
        erdOverlay.appendChild(line);
        const cx = (parseFloat(card.style.left) || 0) + card.offsetWidth / 2, cy = (parseFloat(card.style.top) || 0) + card.offsetHeight / 2;
        document.body.classList.add('note-linking');
        beginDrag(ev, {
          move(e, d) {
            const p = erdPoint(e);
            line.setAttribute('x1', cx); line.setAttribute('y1', cy); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
            d.target = erdEntityIdAt(e.clientX, e.clientY);
            erdCanvas.querySelectorAll('.note-target').forEach((el) => el.classList.remove('note-target'));
            const el = d.target && entityEl(d.target);
            if (el) el.classList.add('note-target');
          },
          drop(e, d) { if (d.target) toggleNoteLink(noteId, d.target); else applyNoteVisibility(); },
          cleanup() {
            line.remove();
            document.body.classList.remove('note-linking');
            erdCanvas.querySelectorAll('.note-target').forEach((el) => el.classList.remove('note-target'));
          }
        });
      }
      // Drag a card: free placement, pinned relative to its anchor table on drop
      function onNotePointerDown(ev, id, card) {
        if (ev.button !== 0 || ev.target.isContentEditable) return;
        ev.stopPropagation();
        if (erdPresenting()) return;
        setRelArmed(false);
        selectNote(id);
        const x0 = parseFloat(card.style.left) || 0, y0 = parseFloat(card.style.top) || 0;
        beginDrag(ev, {
          move(e, d) {
            card.classList.add('dragging');
            d.nx = erdRound4(x0 + d.dx);
            d.ny = erdRound4(y0 + d.dy);
            card.style.translate = `${d.nx - x0}px ${d.ny - y0}px`;
            drawLeaders(id, { x: d.nx, y: d.ny, ...(noteSizes[id] || { w: 0, h: 0 }) });
          },
          drop(e, d) {
            card.classList.remove('dragging');
            card.style.translate = '';
            card.style.left = erdPx(d.nx);
            card.style.top = erdPx(d.ny);
            const note = noteById(id), anchor = note && linkedEntities(note)[0];
            if (!anchor && !(note && isFreeNote(note))) { render(); return; }
            const a = anchor ? erdEntity(anchor).box : { x: 0, y: 0 };   // a free note's pos is absolute
            note.pos = { x: Math.round(d.nx - a.x), y: Math.round(d.ny - a.y) };
            updateStatus(true);
          },
          cleanup() { card.classList.remove('dragging'); card.style.translate = ''; }
        });
      }
      // N: add a note to the selected table (or open the one it has), or open the selected note
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'n' && e.key !== 'N') return;
        if (e.ctrlKey || e.metaKey || e.altKey || erdPresenting()) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        const id = erdSelectedEntityId();
        e.preventDefault();
        if (id) addNoteTo(id, erdSel.kind === 'col' ? erdSel.col : null); else if (selectedNoteId) editNote(selectedNoteId); else addFreeNote();
      });

      // --- The dock: Table, Relationship, Note ---
      function setRelArmed(on) {
        if (relArmed === on) return;
        relArmed = on;
        document.body.classList.toggle('erd-armed', on);
        if (erdBtnAddRel) erdBtnAddRel.setAttribute('aria-pressed', String(on));
        if (on) erdHint('Drag from a column to another table or column · <kbd>Esc</kbd> to cancel', true); else if (!notePicking) erdHint(null);
      }
      function setNotePicking(on) {
        if (notePicking === on) return;
        notePicking = on;
        document.body.classList.toggle('note-picking', on);
        if (erdBtnAddNote) erdBtnAddNote.setAttribute('aria-pressed', String(on));
        if (on) erdHint('Click a table or a column to add a note · <kbd>Esc</kbd> to cancel', true); else if (!relArmed) erdHint(null);
      }
      function giveNoteTo(id, col) {
        setNotePicking(false);
        if (col) selectCol(id, col); else selectEntity(id);
        addNoteTo(id, col);
      }

      if (erdBtnAddRel) {
        erdBtnAddRel.setAttribute('aria-pressed', 'false');
        erdBtnAddRel.addEventListener('click', () => {
          if (erdPresenting()) return;
          setNotePicking(false);
          setRelArmed(!relArmed);
        });
      }

      // Table: a click adds one after the selection; dragging the button onto the canvas drops it there
      let tableToolDrag = null;   // { startX, startY, ghost, pt }
      if (erdBtnAddTable) {
        erdBtnAddTable.addEventListener('click', (e) => {
          if (erdBtnAddTable.dataset.dragged) { delete erdBtnAddTable.dataset.dragged; e.preventDefault(); return; }
          if (erdPresenting()) return;
          setRelArmed(false);
          setNotePicking(false);
          addTable();
        });
        erdBtnAddTable.addEventListener('pointerdown', (e) => {
          delete erdBtnAddTable.dataset.dragged;
          if (e.button !== 0 || erdPresenting()) return;
          tableToolDrag = { startX: e.clientX, startY: e.clientY, ghost: null, pt: null };
          window.addEventListener('pointermove', onTableToolMove);
          window.addEventListener('pointerup', onTableToolUp);
          window.addEventListener('pointercancel', cancelTableToolDrag);
        });
      }
      function onTableToolMove(e) {
        const d = tableToolDrag;
        if (!d) return;
        if (!d.ghost) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
          d.ghost = erdHtmlEl('div', 'erd-entity erd-ghost');
          d.ghost.style.width = erdPx(ER.MIN_W);
          d.ghost.appendChild(erdHtmlEl('div', 'erd-head', ''));
          d.ghost.firstChild.appendChild(erdHtmlEl('span', 'erd-name', 'new table'));
          const row = erdHtmlEl('div', 'erd-row pk');
          row.appendChild(erdHtmlEl('span', 'erd-glyph'));
          row.firstChild.innerHTML = ERD_KEY_ICON;
          row.appendChild(erdHtmlEl('span', 'erd-col-name', 'id'));
          row.appendChild(erdHtmlEl('span', 'erd-col-type', 'uuid'));
          d.ghost.appendChild(row);
          document.body.appendChild(d.ghost);
          document.body.classList.add('palette-dragging');
        }
        d.ghost.style.transform = `scale(${scale * 1.015})`;
        d.ghost.style.left = `${e.clientX - ER.MIN_W * scale / 2}px`;
        d.ghost.style.top = `${e.clientY - ER.HEAD_H * scale / 2}px`;
        const pt = erdPoint(e);
        const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('#viewport');   // anywhere on the view, also past the edge of a small canvas
        d.pt = over ? pt : null;
        d.ghost.classList.toggle('off-target', !over);
      }
      function endTableToolDrag() {
        window.removeEventListener('pointermove', onTableToolMove);
        window.removeEventListener('pointerup', onTableToolUp);
        window.removeEventListener('pointercancel', cancelTableToolDrag);
        const d = tableToolDrag;
        tableToolDrag = null;
        if (d && d.ghost) { d.ghostRect = d.ghost.getBoundingClientRect(); d.ghost.remove(); document.body.classList.remove('palette-dragging'); }
        return d;
      }
      function onTableToolUp() {
        const d = endTableToolDrag();
        if (!d || !d.ghost) return;
        erdBtnAddTable.dataset.dragged = '1';   // swallow the click that may follow on the button
        if (d.pt) addTable({ pt: d.pt, originRect: d.ghostRect });
      }
      function cancelTableToolDrag() {
        const d = endTableToolDrag();
        return !!(d && d.ghost);
      }

      // Note: a click adds one to the selected table (or opens the selected note); with nothing selected it waits for a
      // click on a table; dragging the button onto a table gives that table a note
      let noteToolDrag = null;   // { startX, startY, ghost, target }
      if (erdBtnAddNote) {
        erdBtnAddNote.setAttribute('aria-pressed', 'false');
        erdBtnAddNote.addEventListener('click', (e) => {
          if (erdBtnAddNote.dataset.dragged) { delete erdBtnAddNote.dataset.dragged; e.preventDefault(); return; }
          if (erdPresenting()) return;
          const id = erdSelectedEntityId(), noteId = !id && selectedNoteId;
          if (id) { setNotePicking(false); addNoteTo(id, erdSel.kind === 'col' ? erdSel.col : null); }
          else if (noteId) editNote(noteId);
          else { setRelArmed(false); setNotePicking(false); addFreeNote(); }
        });
        erdBtnAddNote.addEventListener('pointerdown', (e) => {
          delete erdBtnAddNote.dataset.dragged;
          if (e.button !== 0 || erdPresenting()) return;
          noteToolDrag = { startX: e.clientX, startY: e.clientY, ghost: null, target: null };
          window.addEventListener('pointermove', onNoteToolMove);
          window.addEventListener('pointerup', onNoteToolUp);
          window.addEventListener('pointercancel', cancelNoteToolDrag);
        });
      }
      // What a dragged note would land on: a column (its row) or, off the rows, the table
      function erdNoteTargetAt(x, y) {
        const el = document.elementFromPoint(x, y);
        const ent = el && el.closest('.erd-entity:not(.erd-ghost):not(.erd-card-table)');
        if (!ent) return null;
        const row = el.closest('.erd-row');
        return { id: ent.dataset.nodeId, col: row ? row.dataset.col : null };
      }
      function markNoteTarget(t) {
        erdCanvas.querySelectorAll('.erd-entity.note-target, .erd-row.note-target').forEach((el) => el.classList.remove('note-target'));
        const el = t && (t.col ? colEls(t.id).find((r) => r.dataset.col === t.col) : entityEl(t.id));
        if (el) el.classList.add('note-target');
      }
      function onNoteToolMove(e) {
        const d = noteToolDrag;
        if (!d) return;
        if (!d.ghost) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
          setNotePicking(false);
          d.ghost = erdHtmlEl('div', 'note note-ghost');
          d.ghost.appendChild(erdHtmlEl('div', 'note-text', 'Note'));
          document.body.appendChild(d.ghost);
          document.body.classList.add('palette-dragging');
        }
        d.ghost.style.transform = `scale(${scale})`;
        d.ghost.style.left = `${e.clientX + 12}px`;
        d.ghost.style.top = `${e.clientY + 12}px`;
        d.target = erdNoteTargetAt(e.clientX, e.clientY);
        d.pt = viewport.contains(document.elementFromPoint(e.clientX, e.clientY)) ? erdPoint(e) : null;   // off a table: a free note here
        d.ghost.classList.toggle('off-target', !d.target && !d.pt);
        markNoteTarget(d.target);
      }
      function endNoteToolDrag() {
        window.removeEventListener('pointermove', onNoteToolMove);
        window.removeEventListener('pointerup', onNoteToolUp);
        window.removeEventListener('pointercancel', cancelNoteToolDrag);
        const d = noteToolDrag;
        noteToolDrag = null;
        if (d && d.ghost) { d.ghostRect = d.ghost.getBoundingClientRect(); d.ghost.remove(); document.body.classList.remove('palette-dragging'); }
        markNoteTarget(null);
        return d;
      }
      function onNoteToolUp() {
        const d = endNoteToolDrag();
        if (!d || !d.ghost) return;
        erdBtnAddNote.dataset.dragged = '1';   // swallow the click that may follow on the button
        if (d.target) giveNoteTo(d.target.id, d.target.col); else if (d.pt) { setNotePicking(false); addFreeNote(d.pt, d.ghostRect); }
      }
      function cancelNoteToolDrag() {
        const d = endNoteToolDrag();
        return !!(d && d.ghost);
      }

      // =====================================================================================================
      // --- KEYBOARD ---
      // Enter or F2 edits; P F U ? toggle PK, FK, unique, nullable on a column; Up/Down walk the columns (Alt+Up/Down move
      // one), Left/Right the tables; N adds a note; Delete deletes (the shell); Escape cancels what is under way, then
      // clears the selection.
      // =====================================================================================================
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || erdPresenting()) return;
        const a = document.activeElement;
        if (a && a.isContentEditable) return;   // the edit's own handler keeps or drops the text
        if (cancelErdInteraction()) return;
        if (erdSel || selectedNoteId || erdCardEl) { erdSel = null; erdMultiIds = []; erdMultiOwner = null; selectedNoteId = null; peekEntityId = null; applyHighlight(); drawSelectionTools(); }
      }, true);

      window.addEventListener('keydown', (e) => {
        if (erdPresenting() || erdDrag || e.ctrlKey || e.metaKey) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a.tagName === 'BUTTON' && e.key === 'Enter'))) return;
        if (ui.isConfirmOpen()) return;
        const sel = erdSel;
        if ((e.key === 'Enter' || e.key === 'F2') && (sel || selectedNoteId)) { e.preventDefault(); editSelection(); return; }
        if (sel && sel.kind === 'col' && !e.altKey) {
          const flag = { p: 'pk', f: 'fk', u: 'unique', '?': 'nullable' }[e.key.toLowerCase()];
          if (flag) { e.preventDefault(); toggleFlag(sel.entity, sel.col, flag); return; }
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const dir = e.key === 'ArrowUp' ? -1 : 1;
          if (e.altKey) {
            if (sel && sel.kind === 'col') {
              e.preventDefault();
              if (moveColumnBy(sel.entity, sel.col, dir)) panIntoView(colEls(sel.entity).find((r) => r.dataset.col === sel.col));
            }
            return;
          }
          const id = erdSelectedEntityId();
          const ents = erdEntities();
          if (!ents.length) return;
          e.preventDefault();
          if (!id) { selectEntity(ents[dir > 0 ? 0 : ents.length - 1].id); return; }
          const ent = erdEntity(id), names = erVisibleColumns(ent, chartData).cols.map((v) => v.col.name);
          const at = sel.kind === 'col' ? names.indexOf(sel.col) : -1;
          const next = at + dir;
          if (next >= 0 && next < names.length) selectCol(id, names[next]);
          else if (at >= 0 && next < 0) selectEntity(id);
          panIntoView(sel.kind === 'col' || next >= 0 ? colEls(id).find((r) => erdSel && r.dataset.col === erdSel.col) : entityEl(id));
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (e.altKey) return;
          const ents = erdEntities();
          if (!ents.length) return;
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1, id = erdSelectedEntityId();
          const i = ents.findIndex((x) => x.id === id);
          const next = i < 0 ? ents[dir > 0 ? 0 : ents.length - 1] : ents[Math.max(0, Math.min(ents.length - 1, i + dir))];
          selectEntity(next.id);
          panIntoView(entityEl(next.id));
        }
      });

      // Everything under way that Escape (or a tap on blank canvas) cancels; true when something was
      function cancelErdInteraction() {
        let did = false;
        if (ui.closeConfirm()) did = true;
        if (cancelDrag()) did = true;
        if (cancelTableToolDrag()) did = true;
        if (cancelNoteToolDrag()) did = true;
        if (relArmed) { setRelArmed(false); did = true; }
        if (notePicking) { setNotePicking(false); did = true; }
        return did;
      }

      // --- DISK FORMAT (the page's data block) ---
      // Written for a reader: fixed key order, schemaVersion 3, every table's absolute x/y in one trailing "layout" map
      // {tableId: {x, y}}, derived geometry dropped, editor-generated ids renamed (tables after their name, r<N>, n<N>).
      // The in-memory model keeps x/y on the objects. scripts/disk_format.py (ERD_KEYS, erd_to_disk) is the Python twin:
      // keep the two byte-identical (dev/e2e_erd.mjs saves a generated page without edits and compares). A page of an
      // older version has no usable positions (v1: flow terms; v2: group-relative): fromDisk drops them, turns each
      // group's colour into its tables' `color` and its name into `colorKey`, and render() lays the diagram out.
      const ERD_DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'detail', 'showTypes', 'showNotes', 'colorKey',
        'entities', 'relationships', 'notes', 'layout'];
      const ERD_DERIVED = [['entities', ['box']], ['relationships', ['curve', 'points', 'labelBox']]];
      const ERD_SCHEMA_VERSION = 3;
      const ERD_GENERATED_ID = /^(t|r|n)_\d{12,}(_\d+)?$/;   // page ids: <prefix>_<Date.now()>[_k]
      const ERD_SLUG_MAX = 30;

      function slug(text, sep = '_') {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
        if (s.length > ERD_SLUG_MAX) s = s.slice(0, ERD_SLUG_MAX).replace(new RegExp(`${sep}+$`), '');
        return s;
      }

      function renameGeneratedIds(d) {
        const es = d.entities || [], rs = d.relationships || [], ns = d.notes || [];
        const used = new Set([...es, ...rs, ...ns].map((o) => o.id));
        const rename = new Map();
        const take = (base) => {
          let id = base, k = 2;
          while (used.has(id)) id = `${base}_${k++}`;
          used.add(id);
          return id;
        };
        const generated = (o) => ERD_GENERATED_ID.test(String(o.id || ''));
        es.forEach((o) => { if (generated(o)) rename.set(o.id, take(slug(o.name) || 'table')); });
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
        [...es, ...rs, ...ns].forEach((o) => { o.id = r(o.id); });
        rs.forEach((rel) => ['from', 'to'].forEach((k) => { if (k in rel) rel[k] = r(rel[k]); }));
        ns.forEach((n) => { if (Array.isArray(n.entities)) n.entities = n.entities.map(r); });
      }

      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        ['layout', 'canvas', '_band', '_loose', 'direction'].forEach((k) => { delete d[k]; });
        d.schemaVersion = ERD_SCHEMA_VERSION;
        slotColors(d, 'entities');
        ERD_DERIVED.forEach(([list, keys]) => (d[list] || []).forEach((o) => keys.forEach((k) => { delete o[k]; })));
        renameGeneratedIds(d);
        // The legend keeps only the colours a table still uses
        if (d.colorKey) {
          const inUse = new Set((d.entities || []).map((q) => q.color));
          Object.keys(d.colorKey).forEach((k) => { if (!inUse.has(k)) delete d.colorKey[k]; });
          if (!Object.keys(d.colorKey).length) delete d.colorKey;
        }
        const layout = {};
        (d.entities || []).forEach((o) => {
          const pos = {};
          ['x', 'y'].forEach((k) => { if (k in o) { pos[k] = o[k]; delete o[k]; } });
          if (Object.keys(pos).length) layout[o.id] = pos;
        });
        if (Object.keys(layout).length) d.layout = layout;
        const out = {};
        ERD_DISK_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }

      // A note naming a column (from older pages) becomes that column's inline `note`
      function inlineColumnNotes(d) {
        if (!Array.isArray(d.notes)) return;
        const byId = new Map((d.entities || []).map((e) => [e.id, e]));
        d.notes = d.notes.filter((n) => {
          if (!n || !n.column) return true;
          const e = byId.get((n.entities || [])[0]);
          const col = e && (e.columns || []).find((c) => c.name === n.column);
          const text = typeof n.text === 'string' ? n.text.trim() : '';
          if (col && text && !col.note) col.note = text;
          return false;
        });
        if (!d.notes.length) delete d.notes;
      }
      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        inlineColumnNotes(d);
        const layout = d.layout || {};
        delete d.layout;
        delete d.direction;
        if (d.schemaVersion === ERD_SCHEMA_VERSION) {
          (d.entities || []).forEach((o) => Object.assign(o, layout[o.id] || {}));
          slotColors(d, 'entities');
          return d;
        }
        // v1/v2 (or none): positions dropped. A group's colour becomes its tables' `color`, its name a colorKey entry
        // (slot -> name) unless that slot already has one
        const groups = {};
        (Array.isArray(d.groups) ? d.groups : []).forEach((g) => { groups[g.id] = g; });
        delete d.groups;
        const key = d.colorKey && typeof d.colorKey === 'object' && !Array.isArray(d.colorKey) ? colorKeySlots(d.colorKey) : {};
        (d.entities || []).forEach((e) => {
          const g = groups[e.group];
          delete e.group;
          if (g && g.color) {
            e.color = colorSlot(g.color);
            if (g.name && !(e.color in key)) key[e.color] = g.name;
          }
        });
        if (Object.keys(key).length) d.colorKey = key;
        slotColors(d, 'entities');
        return d;
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'erd',
        defaultTitle: 'Interactive ER Diagram',
        toDisk,
        fromDisk,
        toMermaid,   // the writer and reader in mermaid.js; the shell hands them the saved form of the data
        fromMermaid,
        contentEl: erdCanvas,
        // After Import Mermaid: tables the text added have no position. They take the place a warm layout of a copy gives them,
        // then are pushed clear of the tables that stay where they were (a cold layout of everything when none was placed)
        placeImported() {
          const fresh = erdEntities().filter((e) => !erdIsPlaced(e));
          if (!fresh.length) return;
          const copy = JSON.parse(JSON.stringify(chartData));
          layoutDiagram(copy, { warm: true });
          const at = new Map(copy.entities.map((e) => [e.id, e]));
          fresh.forEach((e) => { e.x = at.get(e.id).x; e.y = at.get(e.id).y; });
          if (fresh.length < erdEntities().length) erdSettle({ tables: new Set(fresh.map((e) => e.id)) });
        },
        // The Tidy button: a cold layout, one undo step
        tidy() {
          const done = () => { render({ duration: 360, easing: 'curve-spring-settle', skipFreeNotes: true, skipRows: true }); updateStatus(true); };   // every table moves: slower than a single edit
          if (!(erdAsyncOK() && erdStartJob(done))) { erdLayout(); done(); }
        },
        // Text search (spec: dev/plans/search.md): areas, tables by position each followed by its columns, then relation labels.
        // Columns with no rendered row (collapsed, Columns detail, "+N more") are one item per table (id colsof:<table>), text joins their names; el is its header.
        searchItems() {
          const items = [], add = (id, text, el) => { text = String(text == null ? '' : text).trim(); if (text && el) items.push({ id, text, el }); };
          erdHtml.querySelectorAll('.color-key-label').forEach((l) => add('area:' + l.dataset.color, l.textContent, l));
          const tables = [...erdHtml.querySelectorAll('.erd-entity[data-node-id]')].map((el) => ({ el, e: erdEntity(el.dataset.nodeId) }))
            .filter((t) => t.e).sort((a, b) => (a.e.box.y - b.e.box.y) || (a.e.box.x - b.e.box.x));
          tables.forEach(({ el, e }) => {
            const head = el.querySelector('.erd-head') || el;
            add('table:' + e.id, el.querySelector('.erd-name') && el.querySelector('.erd-name').textContent, head);
            const shown = new Set();
            el.querySelectorAll('.erd-row').forEach((row) => { shown.add(row.dataset.col); add('col:' + e.id + '.' + row.dataset.col, row.querySelector('.erd-col-name').textContent, row); });
            add('colsof:' + e.id, (e.columns || []).filter((c) => !shown.has(c.name)).map((c) => c.name).join(' '), head);   // hidden: collapsed, Columns detail, "+N more"
          });
          erdHtml.querySelectorAll('.edge-label').forEach((l) => add('rel:' + l.dataset.edgeId, l.textContent, l));
          return items;
        },
        report: { node: '.erd-entity', label: '.edge-label', labelText: '.erd-rel-label-text', nodeText: '.erd-name' },
        render,
        isBackground: (el) => el === erdCanvas || el === erdSvg || el === erdOverlay || el === erdHtml || el.id === 'erd-notes',
        clearSelection() {
          erdSel = null;
          erdMultiIds = [];
          erdMultiOwner = null;
          selectedNoteId = null;
          peekEntityId = null;
          applyHighlight();
          drawSelectionTools();
        },
        cancelInteraction: cancelErdInteraction,
        hasSelection: () => !!erdSel || !!selectedNoteId,
        selectInRect: erdSelectInRect,
        selectAll: erdSelectAll,
        onViewChange: erdUpdateOverview,
        deleteSelection,
        // Notes on show may sit in the margin outside the canvas: Fit and screenshots take them in (peeked ones are
        // transient and do not count)
        contentOverflow() {
          const W = erdCanvas.offsetWidth, H = erdCanvas.offsetHeight, PAD = 12;
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          const key = erdHtml.querySelector('.color-key');   // above the tables: past the canvas edge when a table sits near it
          if (key) o.top = Math.max(0, PAD - (parseFloat(key.style.top) || 0));
          if (!erdNotesLayer || !chartData.showNotes) return key ? o : null;
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
