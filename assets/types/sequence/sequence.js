      // ===== SEQUENCE DIAGRAM PLUGIN =====
      // Renders chartData (participants, messages, fragments) laid out by engine.js and handles editing.
      // Positions are always derived by layoutDiagram(): edits change the logical model, then re-layout.
      const seqCanvas = document.getElementById('seq-canvas');
      const seqSvg = document.getElementById('seq-svg');
      const seqHtml = document.getElementById('seq-html');
      const seqFragG = document.getElementById('seq-fragments');
      const seqLifeG = document.getElementById('seq-lifelines');
      const seqActG = document.getElementById('seq-activations');
      const seqMsgG = document.getElementById('seq-messages');
      const seqDrop = document.getElementById('seq-drop-line');
      const btnAddParticipant = document.getElementById('btn-add-participant');
      const btnAddMessage = document.getElementById('btn-add-message');
      const btnToggleKind = document.getElementById('btn-toggle-kind');
      const btnFrame = document.getElementById('btn-frame');

      const SVG_NS = 'http://www.w3.org/2000/svg';
      const ACT_HALF = 6;      // half width of an activation bar
      const ACT_STEP = 5;      // sideways offset per nested activation
      const MSG_KINDS = ['sync', 'reply', 'async'];
      const FRAG_KINDS = ['opt', 'alt', 'loop'];

      let seqSel = null;       // { kind: 'participant' | 'message' | 'fragment', id }
      let seqDrag = null;      // active drag: { kind, id, el, startX, startY, moved, target }
      let seqCounter = 0;
      let seqSelStash = null;  // { sel, data }: the selection the shell cleared, and the model it belonged to

      function svgEl(name, attrs) {
        const el = document.createElementNS(SVG_NS, name);
        Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
        return el;
      }
      function htmlEl(tag, className, styles) {
        const el = document.createElement(tag);
        el.className = className;
        if (styles) Object.assign(el.style, styles);
        return el;
      }
      const seqUid = (prefix) => `${prefix}_${Date.now().toString(36)}${(seqCounter++).toString(36)}`;
      const px = (v) => `${v}px`;

      function ensureModel() {
        chartData.participants = chartData.participants || [];
        chartData.messages = chartData.messages || [];
        chartData.fragments = chartData.fragments || [];
      }

      // Activation bars: a call (sync) opens a bar on its target until its reply. A call answered in several
      // places (one reply per alt branch) has one bar, to the LAST matching reply that comes before the caller next
      // sends that callee anything. A reply hidden in a collapsed frame sits on its summary row, so the bar ends there.
      function seqActivations() {
        const ms = chartData.messages, bars = [];
        ms.forEach((m, i) => {
          if (m.kind !== 'sync' || m.from === m.to) return;
          let last = null;
          for (let j = i + 1; j < ms.length; j++) {
            const r = ms[j];
            if (r.from === m.from && r.to === m.to) break;
            if (r.kind === 'reply' && r.from === m.to && r.to === m.from) last = r;
          }
          if (last && !(m.hidden && last.hidden)) bars.push({ pid: m.to, y1: m.y - 6, y2: last.y + 6 });
        });
        bars.sort((a, b) => a.y1 - b.y1);
        const open = {};
        bars.forEach((b) => {
          const stack = (open[b.pid] = (open[b.pid] || []).filter((o) => o.y2 > b.y1));
          b.depth = stack.length;
          stack.push(b);
        });
        return bars;
      }

      // A small icon per participant kind (system and actor have none: actor is the pill)
      const KIND_ICONS = {
        ui: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
        queue: '<path d="M6 6h12a3 6 0 0 1 0 12H6a3 6 0 0 1 0-12z"/><path d="M18 6a3 6 0 0 0 0 12"/>',
        external: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
      };
      const PARTICIPANT_KINDS = ['system', 'actor', 'ui', 'database', 'queue', 'external'];
      const FRAG_COLORS = ['blue', 'green', 'yellow', 'red', 'purple', 'gray'];
      function kindIcon(kind, size) {
        const el = document.createElementNS(SVG_NS, 'svg');
        ['width', 'height'].forEach((k) => el.setAttribute(k, size || 14));
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('class', 'seq-kind-icon');
        el.innerHTML = KIND_ICONS[kind] || '<rect x="4" y="6" width="16" height="12" rx="2"/>';
        return el;
      }

      function render() {
        ensureModel();
        // Undo and redo swap chartData for a snapshot and clear the selection first: put it back if the object is
        // still there, so undo, look, redo does not mean selecting again each time
        if (seqSelStash && seqSelStash.data !== chartData && !seqSel && selExists(seqSelStash.sel)) seqSel = seqSelStash.sel;
        seqSelStash = null;
        if (seqSel && !selExists(seqSel)) seqSel = null;
        const ps = chartData.participants, ms = chartData.messages, fs = chartData.fragments, ns = chartData.notes || [];
        const missing = !chartData.layout || ps.some((p) => p.x === undefined) || ms.some((m) => m.y === undefined);
        if (missing) layoutDiagram(chartData);
        const L = chartData.layout;
        seqCanvas.style.width = px(L.width);
        seqCanvas.style.height = px(L.height);
        seqSvg.setAttribute('width', L.width);
        seqSvg.setAttribute('height', L.height);
        [seqFragG, seqLifeG, seqActG, seqMsgG].forEach((g) => { g.textContent = ''; });
        seqHtml.textContent = '';
        const byId = {};
        ps.forEach((p) => { byId[p.id] = p; });
        const showDetails = chartData.showDetails !== false;
        const stepOf = {};
        ms.forEach((m, i) => { stepOf[m.id] = i + 1; });

        // Fragments (behind everything else)
        fs.forEach((f) => {
          if (f.x === undefined) return;
          const tint = FRAG_COLORS.includes(f.color) ? ` seq-tint-${f.color}` : '';
          seqFragG.appendChild(svgEl('rect', { class: `seq-frag-box${tint}`, x: f.x, y: f.y, width: f.w, height: f.h, rx: 6, 'data-frag-id': f.id }));
          // The border selects the frame (an 8px hit stroke); the inside stays click-through
          seqFragG.appendChild(svgEl('rect', { class: 'seq-frag-hit', x: f.x, y: f.y, width: f.w, height: f.h, rx: 6, 'data-frag-id': f.id }));
          const tag = htmlEl('div', `seq-frag-label${tint}${f.collapsed ? ' is-collapsed' : ''}`, { left: px(f.x), top: px(f.y) });
          tag.dataset.fragId = f.id;
          const chev = htmlEl('button', 'seq-frag-chev');
          chev.type = 'button';
          chev.title = f.collapsed ? 'Expand this frame' : 'Collapse this frame';
          chev.setAttribute('aria-label', chev.title);
          chev.setAttribute('aria-expanded', String(!f.collapsed));
          chev.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
          tag.appendChild(chev);
          if (f.kind !== 'group') {
            const kind = htmlEl('span', 'seq-frag-kind');
            kind.textContent = f.kind;
            tag.appendChild(kind);
          }
          const text = htmlEl('span', 'seq-frag-text');
          text.textContent = f.label || (f.kind === 'group' ? 'phase' : 'condition');
          tag.appendChild(text);
          seqHtml.appendChild(tag);
          (f.dividers || []).forEach((d) => {
            seqFragG.appendChild(svgEl('line', { class: 'seq-frag-else', x1: f.x, x2: f.x + f.w, y1: d.y, y2: d.y }));
            seqFragG.appendChild(svgEl('line', { class: 'seq-div-hit', x1: f.x, x2: f.x + f.w, y1: d.y, y2: d.y, 'data-frag-id': f.id, 'data-at': d.at }));
            if (d.label) {
              const el = htmlEl('div', 'seq-frag-branch-label', { left: px(f.x + 10), top: px(d.y + 3) });
              el.dataset.fragId = f.id;
              el.dataset.at = d.at;
              const t = htmlEl('span', 'seq-branch-text');
              t.textContent = d.label;
              el.appendChild(t);
              seqHtml.appendChild(el);
            } else if (f.kind === 'alt') {
              // The short form (elseAt): an unlabelled "else" at the right, as before branches existed
              const el = htmlEl('div', 'seq-frag-else-label', { left: px(f.x + f.w - 10), top: px(d.y + 3), transform: 'translateX(-100%)' });
              el.dataset.fragId = f.id;
              el.dataset.at = d.at;
              el.textContent = 'else';
              seqHtml.appendChild(el);
            }
          });
          if (f.collapsed) {
            const inside = ms.filter((m) => m.hidden && stepOf[m.id] >= stepOf[f.from] && stepOf[m.id] <= stepOf[f.to]);
            if (inside.length) {
              const a = stepOf[inside[0].id], b = stepOf[inside[inside.length - 1].id];
              const sum = htmlEl('button', 'seq-frag-summary', { left: px(f.x + f.w / 2), top: px(inside[0].y), transform: 'translate(-50%, -50%)' });
              sum.type = 'button';
              sum.dataset.fragId = f.id;
              sum.title = 'Expand this frame';
              sum.textContent = `${inside.length} message${inside.length === 1 ? '' : 's'} hidden (step${a === b ? ` ${a}` : `s ${a}–${b}`})`;
              seqHtml.appendChild(sum);
            }
          }
        });

        // Lifelines and participant boxes
        ps.forEach((p) => {
          seqLifeG.appendChild(svgEl('line', { class: 'seq-lifeline', x1: p.x, x2: p.x, y1: SQ.TOP + SQ.BOX_H, y2: L.height - 24, 'data-node-id': p.id }));
          const box = htmlEl('div', `seq-participant${p.kind === 'actor' ? ' is-actor' : ''}${KIND_ICONS[p.kind] ? ` is-${p.kind}` : ''}`, { left: px(p.x - SQ.BOX_W / 2), top: px(SQ.TOP) });
          box.dataset.nodeId = p.id;
          if (KIND_ICONS[p.kind]) box.appendChild(kindIcon(p.kind));
          const name = htmlEl('span', 'seq-participant-name');
          name.textContent = p.name;
          box.appendChild(name);
          seqHtml.appendChild(box);
        });

        // Activation bars
        const bars = seqActivations();
        bars.forEach((b) => {
          const p = byId[b.pid];
          if (!p) return;
          seqActG.appendChild(svgEl('rect', { class: 'seq-activation', x: p.x - ACT_HALF + b.depth * ACT_STEP, y: b.y1, width: ACT_HALF * 2, height: b.y2 - b.y1, rx: 2, 'data-node-id': b.pid }));
        });
        const activeDepth = (pid, y) => bars.reduce((mx, b) => (b.pid === pid && b.y1 <= y && y <= b.y2 ? Math.max(mx, b.depth) : mx), -1);
        const edgeX = (p, y, dir) => {
          const d = activeDepth(p.id, y);
          return d < 0 ? p.x : p.x + dir * (ACT_HALF + d * ACT_STEP);
        };

        // Messages (those inside a collapsed frame are not drawn: its summary row stands for them)
        ms.forEach((m) => {
          const a = byId[m.from], b = byId[m.to];
          if (!a || !b || m.hidden) return;
          const self = a === b;
          let d, labelStyle, detailStyle;
          if (self) {
            const xs = edgeX(a, m.y, 1), xe = edgeX(a, m.y + 28, 1);
            d = `M ${xs} ${m.y} H ${xs + SQ.SELF_LOOP} V ${m.y + 28} H ${xe}`;
            labelStyle = { left: px(xs + SQ.SELF_LOOP + 8), top: px(m.y + 4) };
            detailStyle = { left: px(xs + SQ.SELF_LOOP + 14), top: px(m.y + 24) };
          } else {
            const dir = b.x > a.x ? 1 : -1;
            const x1 = edgeX(a, m.y, dir), x2 = edgeX(b, m.y, -dir);
            d = `M ${x1} ${m.y} H ${x2}`;
            labelStyle = { left: px((x1 + x2) / 2), top: px(m.y - 26), transform: 'translateX(-50%)' };
            detailStyle = { left: px((x1 + x2) / 2), top: px(m.y + 3), transform: 'translateX(-50%)' };
          }
          const marker = m.kind === 'sync' ? 'url(#seq-arrow-solid)' : 'url(#seq-arrow-open)';
          seqMsgG.appendChild(svgEl('path', { class: `seq-line${m.kind === 'reply' ? ' is-reply' : ''}`, d, 'marker-end': marker, 'data-edge-id': m.id }));
          seqMsgG.appendChild(svgEl('path', { class: 'seq-msg-hit', d, 'data-edge-id': m.id }));
          const label = htmlEl('div', `seq-msg-label${self ? ' is-self' : ''}`, labelStyle);
          label.dataset.edgeId = m.id;
          if (chartData.numbered) {
            const num = htmlEl('span', 'seq-msg-num');
            num.textContent = stepOf[m.id];
            label.appendChild(num);
          }
          const text = htmlEl('span', 'seq-msg-label-text');
          text.textContent = m.label || '';
          label.appendChild(text);
          if (m.detail && !showDetails) label.title = m.detail;   // details hidden: the payload is the tooltip
          seqHtml.appendChild(label);
          if (m.detail && showDetails) {
            const det = htmlEl('div', `seq-msg-detail${self ? ' is-self' : ''}`, detailStyle);
            det.dataset.edgeId = m.id;
            const dt = htmlEl('span', 'seq-msg-detail-text');
            dt.textContent = m.detail;
            det.appendChild(dt);
            seqHtml.appendChild(det);
          }
        });

        // Notes: a folded card over one lifeline, or stretched over two
        ns.forEach((n) => {
          if (n.x === undefined) return;
          const el = htmlEl('div', 'seq-note', { left: px(n.x), top: px(n.y), width: px(n.w), height: px(n.h) });
          el.dataset.noteId = n.id;
          const t = htmlEl('span', 'seq-note-text');
          t.textContent = sqWrap(n.text, Math.max(4, Math.floor((n.w - 2 * SQ.NOTE_PAD) / SQ.NOTE_CHAR_W))).join('\n');
          el.appendChild(t);
          seqHtml.appendChild(el);
        });
        applySelection();
      }

      function applySelection() {
        const sel = seqSel || {};
        document.querySelectorAll('.seq-participant').forEach((el) => el.classList.toggle('selected', sel.kind === 'participant' && el.dataset.nodeId === sel.id));
        document.querySelectorAll('.seq-msg-label, .seq-line').forEach((el) => el.classList.toggle('selected', sel.kind === 'message' && el.dataset.edgeId === sel.id));
        document.querySelectorAll('.seq-frag-label, .seq-frag-box').forEach((el) => el.classList.toggle('selected', sel.kind === 'fragment' && el.dataset.fragId === sel.id));
        refreshDock();
      }

      // Nothing silent: a dock button that cannot act is disabled and its tooltip says what to select
      function setDockButton(btn, enabled, title) {
        btn.disabled = !enabled;
        btn.title = title;
      }
      function refreshDock() {
        const kind = seqSel && seqSel.kind;
        setDockButton(btnAddMessage, !!chartData.participants.length,
          chartData.participants.length ? 'Add a message from the selected participant (or after the selected message)' : 'Add a participant first');
        setDockButton(btnToggleKind, kind === 'message',
          kind === 'message' ? 'Change the selected message type: call, reply, async' : 'Select a message to change its type');
        setDockButton(btnFrame, kind === 'message' || kind === 'fragment',
          kind === 'fragment' ? 'Change the selected frame: opt, alt, loop' : kind === 'message' ? 'Wrap the selected message in an opt frame' : 'Select a message to wrap it in a frame');
      }

      function select(kind, id) {
        seqSel = kind ? { kind, id } : null;
        applySelection();
      }
      function selExists(sel) {
        if (!sel) return false;
        const list = sel.kind === 'participant' ? chartData.participants : sel.kind === 'message' ? chartData.messages : chartData.fragments;
        return (list || []).some((o) => o.id === sel.id);
      }

      function relayout() {
        layoutDiagram(chartData);
        render();
        updateStatus(true);
      }

      // --- DRAG TO REORDER (participants sideways, messages up and down) ---
      function dropTarget(drag) {
        const ps = chartData.participants, ms = chartData.messages, L = chartData.layout;
        if (drag.kind === 'participant') {
          const me = ps.find((p) => p.id === drag.id);
          const others = ps.filter((p) => p.id !== drag.id);
          const at = others.filter((p) => p.x < me.x + drag.dx).length;
          const left = others[at - 1], right = others[at];
          const x = left && right ? (left.x + right.x) / 2 : left ? left.x + SQ.BOX_W / 2 + 16 : right.x - SQ.BOX_W / 2 - 16;
          return { index: at, line: { x1: x, x2: x, y1: SQ.TOP - 10, y2: L.height - 30 } };
        }
        const me = ms.find((m) => m.id === drag.id);
        const others = ms.filter((m) => m.id !== drag.id);
        const at = others.filter((m) => m.y < me.y + drag.dy).length;
        const above = others[at - 1], below = others[at];
        const y = above && below ? (above.y + below.y) / 2 : above ? above.y + 34 : below ? below.y - 34 : me.y;
        return { index: at, line: { x1: 8, x2: L.width - 8, y1: y, y2: y } };
      }

      function onSeqPointerDown(e) {
        if (document.body.classList.contains('presentation') || e.button > 0) return;
        if (e.target.isContentEditable) return;
        if (e.target.closest('.seq-frag-chev, .seq-frag-summary')) return;   // handled on click
        const hit = e.target.closest('.seq-participant, .seq-msg-label, .seq-msg-hit, .seq-frag-label');
        if (!hit) return;
        let kind, id;
        if (hit.classList.contains('seq-participant')) { kind = 'participant'; id = hit.dataset.nodeId; }
        else if (hit.classList.contains('seq-frag-label')) { kind = 'fragment'; id = hit.dataset.fragId; }
        else { kind = 'message'; id = hit.dataset.edgeId; }
        select(kind, id);
        if (kind === 'fragment') return;
        seqDrag = { kind, id, el: hit, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, target: null };
        window.addEventListener('pointermove', onSeqPointerMove);
        window.addEventListener('pointerup', onSeqPointerUp);
      }

      function onSeqPointerMove(e) {
        if (!seqDrag) return;
        seqDrag.dx = (e.clientX - seqDrag.startX) / scale;
        seqDrag.dy = (e.clientY - seqDrag.startY) / scale;
        if (!seqDrag.moved && Math.abs(seqDrag.dx) < 4 && Math.abs(seqDrag.dy) < 4) return;
        seqDrag.moved = true;
        const isP = seqDrag.kind === 'participant';
        const el = isP ? seqDrag.el : document.querySelector(`.seq-msg-label[data-edge-id="${seqDrag.id}"]`);
        if (!el) return;
        el.classList.add('dragging');
        const base = el.style.transform.replace(/translate[XY]\([^)]*\)/g, '').trim();
        el.style.transform = `${base} ${isP ? `translateX(${seqDrag.dx}px)` : `translateY(${seqDrag.dy}px)`}`.trim();
        seqDrag.target = dropTarget(seqDrag);
        const line = seqDrag.target.line;
        Object.keys(line).forEach((k) => seqDrop.setAttribute(k, line[k]));
        seqDrop.style.display = 'block';
      }

      function endSeqDrag() {
        window.removeEventListener('pointermove', onSeqPointerMove);
        window.removeEventListener('pointerup', onSeqPointerUp);
        seqDrop.style.display = 'none';
        const drag = seqDrag;
        seqDrag = null;
        return drag;
      }

      function onSeqPointerUp() {
        const drag = endSeqDrag();
        if (!drag) return;
        // A click without movement must not rebuild the DOM: the second click of a double-click has to land on
        // the same element, or the browser's dblclick never reaches the text
        if (!drag.moved) { applySelection(); return; }
        if (!drag.target) { render(); return; }
        const list = drag.kind === 'participant' ? chartData.participants : chartData.messages;
        const from = list.findIndex((item) => item.id === drag.id);
        const [item] = list.splice(from, 1);
        list.splice(drag.target.index, 0, item);
        if (drag.kind === 'message') {
          const order = chartData.messages.map((m) => m.id);
          chartData.fragments.forEach((f) => {
            if (order.indexOf(f.from) > order.indexOf(f.to)) { const t = f.from; f.from = f.to; f.to = t; }
          });
        }
        if (drag.target.index !== from) relayout(); else render();
      }

      // --- INLINE TEXT EDITING (double-click, or straight after creating something) ---
      const EDIT_TEXT = '.seq-participant-name, .seq-msg-label-text, .seq-frag-text';
      const EDIT_OWNER = { participant: '.seq-participant[data-node-id="ID"]', message: '.seq-msg-label[data-edge-id="ID"]', fragment: '.seq-frag-label[data-frag-id="ID"]' };
      function beginEdit(el) {
        if (!el || el.isContentEditable) return;
        el.contentEditable = 'true';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        const original = el.textContent;
        const commit = () => {
          el.removeEventListener('blur', commit);
          el.removeEventListener('keydown', onKey);
          el.contentEditable = 'false';
          const value = el.textContent.trim();
          const owner = el.closest('[data-node-id], [data-edge-id], [data-frag-id]');
          let changed = false;
          if (value && owner) {
            if (owner.dataset.nodeId) { const p = chartData.participants.find((x) => x.id === owner.dataset.nodeId); if (p && p.name !== value) { p.name = value; changed = true; } }
            else if (owner.dataset.edgeId) { const m = chartData.messages.find((x) => x.id === owner.dataset.edgeId); if (m && m.label !== value) { m.label = value; changed = true; } }
            else if (owner.dataset.fragId) { const f = chartData.fragments.find((x) => x.id === owner.dataset.fragId); if (f && f.label !== value) { f.label = value; changed = true; } }
          }
          if (changed) relayout(); else el.textContent = original;
        };
        // Enter commits; Escape puts the text back (the keys stay inside the editor)
        const onKey = (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); el.textContent = original; el.blur(); }
        };
        el.addEventListener('blur', commit);
        el.addEventListener('keydown', onKey);
      }
      function onSeqDblClick(e) {
        if (document.body.classList.contains('presentation')) return;
        const box = e.target.closest('.seq-participant, .seq-msg-label, .seq-frag-label');
        const el = e.target.closest(EDIT_TEXT) || (box && box.querySelector(EDIT_TEXT));
        if (!el) return;
        e.stopPropagation();
        beginEdit(el);
      }
      seqHtml.addEventListener('dblclick', onSeqDblClick);

      // Bring an element into the viewport (a created object can land below or right of the screen)
      function panIntoView(el) {
        if (!el) return;
        const r = el.getBoundingClientRect(), v = viewport.getBoundingClientRect(), pad = 60;
        const dock = document.querySelector('.dock-area .toolbar-center');
        const bottom = Math.min(v.bottom, dock && dock.offsetHeight ? dock.getBoundingClientRect().top : v.bottom);
        let dx = 0, dy = 0;
        if (r.left < v.left + pad) dx = v.left + pad - r.left; else if (r.right > v.right - pad) dx = v.right - pad - r.right;
        if (r.top < v.top + pad) dy = v.top + pad - r.top; else if (r.bottom > bottom - pad) dy = bottom - pad - r.bottom;
        if (!dx && !dy) return;
        panX += dx;
        panY += dy;
        updateTransform();
      }
      // Create means name: a new object is selected, on screen, and its placeholder text is in edit
      function editCreated(kind, id) {
        seqSel = { kind, id };
        relayout();
        const box = seqHtml.querySelector(EDIT_OWNER[kind].replace('ID', id));
        panIntoView(box);
        beginEdit(box && box.querySelector(EDIT_TEXT));
      }

      seqHtml.addEventListener('pointerdown', onSeqPointerDown);
      seqSvg.addEventListener('pointerdown', onSeqPointerDown);

      // --- COLLAPSE AND EXPAND (the chevron in a frame tag, or a collapsed frame's summary row) ---
      // "collapsed" is saved, so an author can ship a page that opens as an overview. In ?present it is how a
      // presenter walks the audience through the flow phase by phase: there it changes the view only (no undo
      // step, no unsaved badge).
      function toggleCollapsed(fid) {
        const f = chartData.fragments.find((x) => x.id === fid);
        if (!f) return;
        if (f.collapsed) delete f.collapsed; else f.collapsed = true;
        if (document.body.classList.contains('presentation')) { layoutDiagram(chartData); render(); return; }
        seqSel = { kind: 'fragment', id: fid };
        relayout();
      }
      seqHtml.addEventListener('click', (e) => {
        const btn = e.target.closest('.seq-frag-chev, .seq-frag-summary');
        if (!btn) return;
        e.stopPropagation();
        toggleCollapsed(btn.closest('[data-frag-id]').dataset.fragId);
      });

      // --- EDITS ---
      // Remove messages and keep every reference valid: a frame shrinks to the messages it still has (or goes), a
      // branch moves to the next message of its frame (or goes, if that would leave a branch empty), a note moves
      // to a neighbour
      function removeMessages(ids) {
        const gone = new Set(ids);
        const order = chartData.messages.map((m) => m.id);
        const pos = (id) => order.indexOf(id);
        const survivor = (id, dir) => {
          let i = pos(id);
          while (i >= 0 && i < order.length && gone.has(order[i])) i += dir;
          return i >= 0 && i < order.length ? order[i] : null;
        };
        chartData.fragments = chartData.fragments.filter((f) => {
          const from = survivor(f.from, 1), to = survivor(f.to, -1);
          if (!from || !to || pos(from) > pos(to)) return false;
          f.from = from;
          f.to = to;
          const fixAt = (at) => {
            const e = survivor(at, 1);
            return e && pos(e) > pos(from) && pos(e) <= pos(to) ? e : null;
          };
          if (f.elseAt !== undefined) {
            const e = fixAt(f.elseAt);
            if (e) f.elseAt = e; else delete f.elseAt;
          }
          if (Array.isArray(f.branches)) {
            const seen = new Set();
            f.branches = f.branches.filter((br) => {
              const e = fixAt(br.at);
              if (!e || seen.has(e)) return false;
              seen.add(e);
              br.at = e;
              return true;
            });
          }
          return true;
        });
        (chartData.notes || []).forEach((n) => {
          ['after', 'before'].forEach((key) => {
            if (n[key] === undefined || !gone.has(n[key])) return;
            const next = key === 'after' ? survivor(n[key], -1) : survivor(n[key], 1);
            const other = key === 'after' ? survivor(n[key], 1) : survivor(n[key], -1);
            delete n[key];
            if (next) n[key] = next;
            else if (other) n[key === 'after' ? 'before' : 'after'] = other;
          });
        });
        chartData.messages = chartData.messages.filter((m) => !gone.has(m.id));
      }

      // A participant leaves the notes over it: a note stretched over two keeps the other lifeline
      function removeParticipantNotes(pid) {
        if (!chartData.notes) return;
        chartData.notes = chartData.notes.filter((n) => {
          const over = Array.isArray(n.over) ? n.over.filter((id) => id !== pid) : n.over === pid ? [] : [n.over];
          if (!over.length) return false;
          n.over = over.length === 1 ? over[0] : over;
          return true;
        });
      }

      function deleteSelection() {
        if (!seqSel) return;
        if (seqSel.kind === 'participant') {
          const id = seqSel.id;
          removeMessages(chartData.messages.filter((m) => m.from === id || m.to === id).map((m) => m.id));
          removeParticipantNotes(id);
          chartData.participants = chartData.participants.filter((p) => p.id !== id);
        } else if (seqSel.kind === 'message') {
          removeMessages([seqSel.id]);
        } else {
          chartData.fragments = chartData.fragments.filter((f) => f.id !== seqSel.id);
        }
        seqSel = null;
        relayout();
      }

      btnAddParticipant.addEventListener('click', () => {
        ensureModel();
        const p = { id: seqUid('p'), name: `Participant ${chartData.participants.length + 1}`, kind: 'system' };
        chartData.participants.push(p);
        editCreated('participant', p.id);
      });

      btnAddMessage.addEventListener('click', () => {
        ensureModel();
        const ps = chartData.participants, ms = chartData.messages;
        if (!ps.length) return;
        let from, to, at = ms.length, kind = 'sync';
        const selMsg = seqSel && seqSel.kind === 'message' ? ms.find((m) => m.id === seqSel.id) : null;
        if (selMsg) {
          from = selMsg.to; to = selMsg.from; at = ms.indexOf(selMsg) + 1; kind = 'reply';
        } else {
          const i = seqSel && seqSel.kind === 'participant' ? ps.findIndex((p) => p.id === seqSel.id) : 0;
          from = ps[i].id;
          to = (ps[i + 1] || ps[i - 1] || ps[i]).id;
        }
        const m = { id: seqUid('m'), from, to, label: 'Message', kind };
        ms.splice(at, 0, m);
        editCreated('message', m.id);
      });

      btnToggleKind.addEventListener('click', () => {
        if (!seqSel || seqSel.kind !== 'message') return;
        const m = chartData.messages.find((x) => x.id === seqSel.id);
        if (!m) return;
        m.kind = MSG_KINDS[(MSG_KINDS.indexOf(m.kind) + 1) % MSG_KINDS.length];
        relayout();
      });

      btnFrame.addEventListener('click', () => {
        ensureModel();
        if (seqSel && seqSel.kind === 'fragment') {
          const f = chartData.fragments.find((x) => x.id === seqSel.id);
          if (f) { f.kind = FRAG_KINDS[(FRAG_KINDS.indexOf(f.kind) + 1) % FRAG_KINDS.length]; relayout(); }
          return;
        }
        if (!seqSel || seqSel.kind !== 'message') return;
        const f = { id: seqUid('f'), kind: 'opt', label: 'condition', from: seqSel.id, to: seqSel.id };
        chartData.fragments.push(f);
        editCreated('fragment', f.id);
      });

      // Escape clears the selection, unless it has a drag to cancel first (the shell does that) or a text is in edit
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || seqDrag || !seqSel) return;
        if (document.activeElement && document.activeElement.isContentEditable) return;
        select(null);
      }, true);

      // --- DISK FORMAT (the page's data block) ---
      // No positions are saved: render() lays out whatever is missing, so the block holds only the logical model,
      // in a fixed key order. scripts/disk_format.py is the Python twin: keep the two byte-identical.
      // fromDisk is not needed (the block is the model minus positions).
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'numbered', 'showDetails', 'participants', 'messages', 'fragments', 'notes'];
      // Engine output, never saved: positions, hidden (inside a collapsed frame), frame dividers, note boxes
      const DISK_LAYOUT = [['participants', ['x']], ['messages', ['y', 'hidden']], ['fragments', ['x', 'y', 'w', 'h', 'elseY', 'dividers']], ['notes', ['x', 'y', 'w', 'h']]];
      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        delete d.layout;   // canvas size, derived by the engine
        DISK_LAYOUT.forEach(([list, keys]) => (d[list] || []).forEach(o => keys.forEach(k => { delete o[k]; })));
        const out = {};
        DISK_KEYS.forEach(k => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach(k => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'sequence',
        defaultTitle: 'Interactive Sequence Diagram',
        toDisk,
        contentEl: seqCanvas,
        report: { node: '.seq-participant', label: '.seq-msg-label', labelText: '.seq-msg-label-text', nodeText: '.seq-participant-name' },
        render,
        isBackground: (el) => el === seqCanvas || el === seqSvg || el === seqHtml,
        clearSelection() { seqSelStash = { sel: seqSel, data: chartData }; select(null); },
        cancelInteraction() {
          if (!seqDrag) return false;
          endSeqDrag();
          render();
          return true;
        },
        hasSelection: () => !!seqSel,
        deleteSelection
      });
