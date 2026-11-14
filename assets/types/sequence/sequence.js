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
      const btnAddNote = document.getElementById('btn-add-note');
      const btnFrame = document.getElementById('btn-frame');
      const btnNumbers = document.getElementById('btn-numbers');
      const btnDetails = document.getElementById('btn-details');
      const btnShowAll = document.getElementById('btn-show-all');
      const btnLifespans = document.getElementById('btn-lifespans');

      const SVG_NS = 'http://www.w3.org/2000/svg';
      const ACT_HALF = 6;      // half width of an activation bar
      const ACT_STEP = 5;      // sideways offset per nested activation
      const FRAG_KINDS = ['opt', 'alt', 'loop', 'par', 'group'];

      // Selection: { kind: 'participant' | 'fragment' | 'note', id }, { kind: 'message', id, ids?, anchor? } (ids: a
      // range of messages, in time order), or { kind: 'divider', id: <fragment id>, at: <message id> } (a branch)
      let seqSel = null;
      let seqDrag = null;      // active drag (see beginDrag)
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
      // Editor ids: <prefix>_<Date.now()>_<k>. toDisk renames them to readable ids (see renameGeneratedIds)
      const seqUid = (prefix) => `${prefix}_${Date.now()}_${seqCounter++}`;
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
          const foc = focusState(f.id);
          if (foc && foc.toCollapse.length) {
            const on = isFocused(foc);
            const fb = htmlEl('button', 'seq-frag-focus');
            fb.type = 'button';
            fb.title = on ? 'Show every phase again' : 'Focus on this phase: collapse the others (the participants they leave become rails)';
            fb.setAttribute('aria-label', fb.title);
            fb.setAttribute('aria-pressed', String(on));
            fb.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>';
            tag.appendChild(fb);
          }
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

        // Lifelines and participant boxes (a rail is a thin box with the kind icon and the name written downwards).
        // With lifespans a box sits at the top of its lifeline (p.top) and the lifeline ends in a short cap (p.bottom).
        ps.forEach((p) => {
          const rail = !!p.rail, boxH = rail ? SQ.RAIL_H : SQ.BOX_H, top = p.top === undefined ? SQ.TOP : p.top;
          const y2 = p.bottom === undefined ? L.height - 24 : p.bottom;
          seqLifeG.appendChild(svgEl('line', { class: `seq-lifeline${rail ? ' is-rail' : ''}`, x1: p.x, x2: p.x, y1: top + boxH, y2, 'data-node-id': p.id }));
          // A wide invisible stroke over the lifeline: dragging from it draws a message (see DRAW FROM A LIFELINE)
          seqLifeG.appendChild(svgEl('line', { class: 'seq-life-hit', x1: p.x, x2: p.x, y1: top + boxH, y2, 'data-pid': p.id, 'data-export-skip': '' }));
          if (p.bottom !== undefined) seqLifeG.appendChild(svgEl('line', { class: 'seq-cap', x1: p.x - 7, x2: p.x + 7, y1: p.bottom, y2: p.bottom, 'data-node-id': p.id }));
          const box = htmlEl('div', `seq-participant${p.kind === 'actor' ? ' is-actor' : ''}${KIND_ICONS[p.kind] ? ` is-${p.kind}` : ''}${rail ? ' is-rail' : ''}`, { left: px(p.x - (rail ? SQ.RAIL_W : SQ.BOX_W) / 2), top: px(top) });
          box.dataset.nodeId = p.id;
          if (KIND_ICONS[p.kind] || rail) box.appendChild(kindIcon(p.kind));
          const name = htmlEl('span', 'seq-participant-name');
          name.textContent = p.name;
          box.appendChild(name);
          if (rail) {
            const tip = htmlEl('span', 'seq-rail-tip');
            tip.textContent = p.name;
            tip.dataset.exportSkip = '';
            box.appendChild(tip);
          }
          seqHtml.appendChild(box);
        });
        // Insert a participant between two boxes, or at the right end (shown while the pointer is on the row)
        ps.forEach((p, i) => {
          const x = i + 1 < ps.length ? (p.x + ps[i + 1].x) / 2 : p.x + (p.rail ? SQ.RAIL_W : SQ.BOX_W) / 2 + 26;
          const ins = htmlEl('button', 'seq-insert', { left: px(x), top: px(SQ.TOP + SQ.BOX_H / 2) });
          ins.type = 'button';
          ins.dataset.index = i + 1;
          ins.dataset.exportSkip = '';
          ins.title = i + 1 < ps.length ? 'Insert a participant here' : 'Add a participant at the right end';
          ins.setAttribute('aria-label', ins.title);
          ins.textContent = '+';
          seqHtml.appendChild(ins);
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
        // The opaque band the participant row rides on once the top of the diagram is panned off screen
        // (#seq-html is a shrink-to-fit box with no width of its own, so left/right: 0 would give the band none)
        const band = htmlEl('div', 'seq-pin-band');
        band.style.width = `${chartData.layout ? chartData.layout.width : 0}px`;
        seqHtml.appendChild(band);
        applySelection();
        pinParticipants();
      }

      // --- PINNED PARTICIPANT ROW ---
      // Below the first screen of a long diagram no lifeline would have a name: once the boxes are panned off the
      // top, they ride at the top of the viewport over an opaque band (as the flowchart pins its lane pills).
      // Called after every render and, via plugin.onViewChange, after every pan/zoom. Exports (body.exporting) and
      // screenshots (body.capture) reset it in CSS, so they always show the row at the diagram's top.
      const PIN_INSET = 8;
      // Height of the participant row: taller when a rail is in it
      const topRowH = () => (chartData.participants.some((p) => p.rail) ? SQ.RAIL_H : SQ.BOX_H);
      function pinParticipants() {
        const L = chartData.layout;
        if (!L) return;
        const top = seqCanvas.offsetTop + seqCanvas.clientTop;     // canvas origin, stage coords
        const visTop = -panY / scale - top;                        // viewport's top edge in canvas coords
        const on = visTop + PIN_INSET > SQ.TOP && !document.body.classList.contains('capture');
        const dy = Math.min(visTop + PIN_INSET - SQ.TOP, L.height - SQ.BOX_H - SQ.TOP - 40);
        seqCanvas.classList.toggle('seq-pinned', on && dy > 0);
        seqCanvas.style.setProperty('--pin-h', `${topRowH() + 16}px`);
        seqCanvas.style.setProperty('--pin-dy', `${on ? Math.max(0, dy) : 0}px`);
        seqCanvas.style.setProperty('--pin-top', `${on ? Math.max(0, dy) + SQ.TOP - PIN_INSET : 0}px`);
        // With lifespans the row names only the lifelines alive at the rows under it: a box rides at the top once its
        // own place has scrolled past it, and fades out when its lifeline has ended above. Nothing moves sideways.
        const pinTop = SQ.TOP + (on ? Math.max(0, dy) : 0);
        seqHtml.querySelectorAll('.seq-participant').forEach((el) => {
          const p = chartData.lifespans ? partById(el.dataset.nodeId) : null;
          if (!p || !seqCanvas.classList.contains('seq-pinned')) { el.style.translate = ''; el.classList.remove('is-gone'); return; }
          const own = Math.max(0, pinTop - (p.top === undefined ? SQ.TOP : p.top));
          el.style.translate = own > 0 ? `0 ${own}px` : 'none';
          el.classList.toggle('is-gone', p.bottom !== undefined && p.bottom < pinTop);
        });
      }

      // --- LOOKUPS ---
      const isPresent = () => document.body.classList.contains('presentation');
      const msgById = (id) => chartData.messages.find((m) => m.id === id);
      const fragById = (id) => chartData.fragments.find((f) => f.id === id);
      const noteById = (id) => (chartData.notes || []).find((n) => n.id === id);
      const partById = (id) => chartData.participants.find((p) => p.id === id);
      const msgIndex = (id) => chartData.messages.findIndex((m) => m.id === id);
      const selIds = (sel) => (sel && sel.kind === 'message' ? (sel.ids || [sel.id]) : []);
      // A point of the pointer in diagram (canvas) coordinates
      function canvasPoint(e) {
        const r = seqHtml.getBoundingClientRect();
        return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
      }
      // The participant whose lifeline is nearest to x
      function nearestParticipant(x) {
        let best = null;
        chartData.participants.forEach((p) => { if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p; });
        return best;
      }
      // A fragment's branches as [{at, label}] (the short form elseAt is one unlabelled branch), and the way back:
      // one unlabelled branch of an alt is written as elseAt, the form an old page has
      function branchList(f) {
        if (Array.isArray(f.branches)) return f.branches.map((b) => ({ at: b.at, label: b.label || '' }));
        return f.elseAt === undefined ? [] : [{ at: f.elseAt, label: '' }];
      }
      function setBranches(f, list) {
        const order = chartData.messages.map((m) => m.id);
        const a = order.indexOf(f.from), b = order.indexOf(f.to), seen = new Set();
        list = list.filter((br) => { const i = order.indexOf(br.at); if (i <= a || i > b || seen.has(i)) return false; seen.add(i); return true; })
          .sort((u, v) => order.indexOf(u.at) - order.indexOf(v.at));
        delete f.elseAt;
        delete f.branches;
        if (!list.length || (f.kind !== 'alt' && f.kind !== 'par')) return;
        if (f.kind === 'alt' && list.length === 1 && !list[0].label) f.elseAt = list[0].at;
        else f.branches = list.map((br) => ({ at: br.at, label: br.label || '' }));
      }
      // Message index range of a frame
      const fragRange = (f) => [msgIndex(f.from), msgIndex(f.to)];
      // Would a frame over messages [a, b] cross the edge of another frame (half in, half out)?
      function crossesFrame(a, b, skipId) {
        return chartData.fragments.some((o) => {
          if (o.id === skipId) return false;
          const [oa, ob] = fragRange(o);
          return (oa < a && a <= ob && ob < b) || (a < oa && oa <= b && b < ob);
        });
      }

      // Row gaps: where a message (or a note) can go. Each gap has the index a new message would take and its y.
      // Messages hidden in a collapsed frame have no gap of their own.
      function rowSlots(skipId) {
        const ms = chartData.messages.filter((m) => m.id !== skipId);
        const vis = [];
        ms.forEach((m, i) => { if (!m.hidden) vis.push({ m, i }); });
        if (!vis.length) return [{ index: ms.length, y: SQ.TOP + SQ.BOX_H + SQ.FIRST_GAP + SQ.ARROW_AT }];
        const slots = [{ index: vis[0].i, y: vis[0].m.y - 34 }];
        for (let k = 1; k < vis.length; k++) slots.push({ index: vis[k].i, y: (vis[k - 1].m.y + vis[k].m.y) / 2 });
        let last = vis[vis.length - 1].i + 1;
        while (last < ms.length && ms[last].hidden) last++;
        slots.push({ index: last, y: vis[vis.length - 1].m.y + 34 });
        return slots;
      }
      const nearestSlot = (slots, y) => slots.reduce((b, s) => (Math.abs(s.y - y) < Math.abs(b.y - y) ? s : b), slots[0]);
      // The innermost drawn frame a message inserted at `index` (of the list without skipId) would land in
      function frameAtSlot(index, skipId) {
        const order = chartData.messages.map((m) => m.id).filter((id) => id !== skipId);
        const full = chartData.messages.map((m) => m.id);
        let best = null;
        chartData.fragments.forEach((f) => {
          if (f.x === undefined) return;
          // A frame whose first or last message is the one moving keeps its edge on the neighbour that stays
          let fa = full.indexOf(f.from), fb = full.indexOf(f.to);
          while (fa <= fb && full[fa] === skipId) fa++;
          while (fb >= fa && full[fb] === skipId) fb--;
          if (fa > fb) return;
          const a = order.indexOf(full[fa]), b = order.indexOf(full[fb]);
          if (a < index && index <= b && (!best || b - a < best.span)) best = { f, span: b - a };
        });
        return best && best.f;
      }
      function showDropLine(y, frame) {
        const L = chartData.layout;
        const x1 = frame ? frame.x + 6 : 8, x2 = frame ? frame.x + frame.w - 6 : L.width - 8;
        Object.entries({ x1, x2, y1: y, y2: y }).forEach(([k, v]) => seqDrop.setAttribute(k, v));
        seqDrop.style.display = 'block';
      }

      // Focus: a selected participant dims every message that does not touch it; a selected message lights its
      // two participant boxes (which matters once the row is pinned far from the message)
      function applySelection() {
        const sel = seqSel || {};
        const ids = selIds(sel);
        document.querySelectorAll('.seq-participant').forEach((el) => el.classList.toggle('selected', sel.kind === 'participant' && el.dataset.nodeId === sel.id));
        // On touch a drag from a lifeline pans unless its participant is selected (the shell's data-touch-drag rule)
        document.querySelectorAll('.seq-life-hit, .seq-activation').forEach((el) => {
          el.toggleAttribute('data-touch-drag', sel.kind === 'participant' && (el.dataset.pid || el.dataset.nodeId) === sel.id);
        });
        document.querySelectorAll('.seq-cap').forEach((el) => el.classList.toggle('selected', sel.kind === 'participant' && el.dataset.nodeId === sel.id));
        document.querySelectorAll('.seq-msg-label, .seq-line, .seq-msg-detail').forEach((el) => el.classList.toggle('selected', ids.includes(el.dataset.edgeId)));
        document.querySelectorAll('.seq-frag-label, .seq-frag-box').forEach((el) => el.classList.toggle('selected', sel.kind === 'fragment' && el.dataset.fragId === sel.id));
        document.querySelectorAll('.seq-note').forEach((el) => el.classList.toggle('selected', sel.kind === 'note' && el.dataset.noteId === sel.id));
        const isDiv = (el) => sel.kind === 'divider' && el.dataset.fragId === sel.id && el.dataset.at === sel.at;
        document.querySelectorAll('.seq-frag-else, .seq-frag-branch-label, .seq-frag-else-label').forEach((el) => el.classList.toggle('selected', isDiv(el)));
        const byMsg = {};
        chartData.messages.forEach((m) => { byMsg[m.id] = m; });
        document.querySelectorAll('.seq-msg-label, .seq-line, .seq-msg-detail').forEach((el) => {
          const m = byMsg[el.dataset.edgeId];
          el.classList.toggle('is-dim', sel.kind === 'participant' && !!m && m.from !== sel.id && m.to !== sel.id);
        });
        const lit = new Set();
        ids.forEach((id) => { const m = byMsg[id]; if (m) { lit.add(m.from); lit.add(m.to); } });
        document.querySelectorAll('.seq-participant').forEach((el) => el.classList.toggle('linked', lit.has(el.dataset.nodeId)));
        drawSelectionTools(sel);
        refreshDock();
      }

      // Nothing silent: a dock button that cannot act is disabled and its tooltip says what to select
      function setDockButton(btn, enabled, title) {
        btn.disabled = !enabled;
        btn.title = title;
      }
      // The frame the Frame button would make: the selected message range, if no frame's edge cuts through it
      function frameCandidate() {
        const ids = selIds(seqSel);
        if (!ids.length) return null;
        const idx = ids.map(msgIndex).filter((i) => i >= 0).sort((u, v) => u - v);
        if (!idx.length) return null;
        const a = idx[0], b = idx[idx.length - 1];
        return { a, b, ok: !crossesFrame(a, b) };
      }
      function refreshDock() {
        const kind = seqSel && seqSel.kind;
        // View toggles: pressed while on. They are saved flags ("numbered", "showDetails"), so each is one undo step.
        btnNumbers.setAttribute('aria-pressed', String(!!chartData.numbered));
        btnNumbers.title = chartData.numbered ? 'Hide the step numbers' : 'Number every message (the number stays the same when a frame is collapsed)';
        const hasDetails = chartData.messages.some((m) => m.detail);
        btnDetails.setAttribute('aria-pressed', String(hasDetails && chartData.showDetails !== false));
        setDockButton(btnDetails, hasDetails, !hasDetails ? 'No message has a detail yet: select a message, press Enter, then Tab'
          : chartData.showDetails !== false ? 'Hide the details under the arrows (the detail becomes the label\'s tooltip)' : 'Show each message\'s detail under its arrow');
        btnLifespans.setAttribute('aria-pressed', String(!!chartData.lifespans));
        btnLifespans.title = chartData.lifespans ? 'Draw every lifeline from the top to the bottom again' : 'Trim lifelines: each one runs only from its participant\'s first message to its last';
        const anyCollapsed = chartData.fragments.some((f) => f.collapsed);
        btnShowAll.hidden = !anyCollapsed;
        btnShowAll.title = 'Expand every collapsed frame';
        setDockButton(btnAddParticipant, true, kind === 'participant' ? 'Add a participant to the right of the selected one' : 'Add a participant at the right end');
        const msgOk = kind === 'participant' || kind === 'message';
        setDockButton(btnAddMessage, msgOk, msgOk ? 'Add a message after the selected one (or at the first row from the selected participant). Or drag from a lifeline\'s + to another lifeline'
          : chartData.participants.length ? 'Select a participant or a message first (or drag from a lifeline\'s + to another lifeline)' : 'Add a participant first');
        const fc = frameCandidate();
        setDockButton(btnFrame, !!(fc && fc.ok), !fc ? 'Select a message, or a range (Shift+click a second message), to wrap it in a frame'
          : fc.ok ? `Wrap the selected message${fc.a === fc.b ? '' : 's'} in a frame` : 'A frame edge cuts through the selection: select whole frames only');
        const noteOk = kind === 'participant' || kind === 'message';
        setDockButton(btnAddNote, noteOk, noteOk ? (kind === 'message' ? 'Add a note under the selected message, over its sender' : 'Add a note over the selected participant, above the first message')
          : 'Select a message or a participant to add a note');
      }

      function select(kind, id, extra) {
        seqSel = kind ? Object.assign({ kind, id }, extra || {}) : null;
        applySelection();
      }
      function selExists(sel) {
        if (!sel) return false;
        if (sel.kind === 'participant') return !!partById(sel.id);
        if (sel.kind === 'message') return selIds(sel).every((id) => !!msgById(id));
        if (sel.kind === 'note') return !!noteById(sel.id);
        const f = fragById(sel.id);
        if (sel.kind === 'divider') return !!f && branchList(f).some((b) => b.at === sel.at);
        return !!f;
      }

      function relayout() {
        layoutDiagram(chartData);
        render();
        updateStatus(true);
      }

      // --- DRAGS ---
      // One drag at a time: beginDrag arms it on pointerdown; it starts after 4px of movement. While it runs the
      // action bar is hidden (body.seq-dragging). cancelInteraction (Escape) drops it.
      function beginDrag(e, d) {
        seqDrag = Object.assign({ startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false }, d);
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp);
      }
      function onDragMove(e) {
        const d = seqDrag;
        if (!d) return;
        d.dx = (e.clientX - d.startX) / scale;
        d.dy = (e.clientY - d.startY) / scale;
        if (!d.moved && Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4) return;
        if (!d.moved) { d.moved = true; document.body.classList.add('seq-dragging'); }
        if (d.move) d.move(canvasPoint(e), d);
      }
      function endSeqDrag() {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        document.body.classList.remove('seq-dragging');
        seqDrop.style.display = 'none';
        seqRubber.style.display = 'none';
        document.querySelectorAll('.seq-lifeline.is-target').forEach((el) => el.classList.remove('is-target'));
        const d = seqDrag;
        seqDrag = null;
        return d;
      }
      function onDragUp(e) {
        const d = endSeqDrag();
        if (!d) return;
        // A click without movement must not rebuild the DOM: the second click of a double-click has to land on
        // the same element, or the browser's dblclick never reaches the text
        if (!d.moved) { if (d.click) d.click(); else applySelection(); return; }
        if (d.drop) d.drop(canvasPoint(e), d); else render();
      }
      // The rubber band of a connect or retarget drag, and the lifeline it would land on
      const seqRubber = svgEl('line', { id: 'seq-rubber', x1: 0, y1: 0, x2: 0, y2: 0, 'marker-end': 'url(#seq-arrow-solid)' });
      seqSvg.appendChild(seqRubber);
      function showRubber(x1, y1, x2, y2) {
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => seqRubber.setAttribute(k, v));
        seqRubber.style.display = 'block';
      }
      function lightLifeline(pid) {
        document.querySelectorAll('.seq-lifeline').forEach((el) => el.classList.toggle('is-target', el.dataset.nodeId === pid));
      }

      // Reorder participants sideways
      function participantDrag(id, el) {
        return {
          move(pt, d) {
            el.classList.add('dragging');
            el.style.transform = `translateX(${d.dx}px)`;
            const ps = chartData.participants, me = partById(id), L = chartData.layout;
            const others = ps.filter((p) => p.id !== id);
            d.index = others.filter((p) => p.x < me.x + d.dx).length;
            const left = others[d.index - 1], right = others[d.index];
            const x = left && right ? (left.x + right.x) / 2 : left ? left.x + SQ.BOX_W / 2 + 16 : right ? right.x - SQ.BOX_W / 2 - 16 : me.x;
            Object.entries({ x1: x, x2: x, y1: SQ.TOP - 10, y2: L.height - 30 }).forEach(([k, v]) => seqDrop.setAttribute(k, v));
            seqDrop.style.display = 'block';
          },
          drop(pt, d) {
            const ps = chartData.participants, from = ps.findIndex((p) => p.id === id);
            if (d.index === undefined || d.index === from) { render(); return; }
            const [p] = ps.splice(from, 1);
            ps.splice(d.index, 0, p);
            relayout();
          }
        };
      }

      // --- MOVING A MESSAGE, AND WHICH FRAME IT BELONGS TO ---
      // A message belongs to a frame when it sits between the frame's first and last message. Before a move the
      // message is detached: a frame whose first or last it was keeps its edge on the neighbour that stays (a frame
      // whose only message leaves is removed), and a branch starting at it moves to the next message of the frame
      // (or goes, if that would leave a branch empty). Dropped between two messages of a frame, it then joins it.
      function detachMessage(id) {
        const order = chartData.messages.map((m) => m.id), i = order.indexOf(id);
        chartData.fragments = chartData.fragments.filter((f) => {
          const brs = branchList(f);
          let a = order.indexOf(f.from), b = order.indexOf(f.to);
          if (a === i && b === i) return false;
          if (a === i) { f.from = order[i + 1]; a = i + 1; }
          if (b === i) { f.to = order[i - 1]; b = i - 1; }
          const next = brs.map((br) => {
            if (br.at !== id) return br;
            const n = i + 1;
            return n <= b && !brs.some((o) => o.at === order[n]) ? { at: order[n], label: br.label } : null;
          }).filter(Boolean);
          // A branch now at the frame's first message would be empty: it merges into the one above
          const kept = next.filter((br) => order.indexOf(br.at) > a);
          if (kept.length !== brs.length || next.some((br, k) => br.at !== brs[k].at)) {
            const short = f.elseAt !== undefined;
            delete f.elseAt; delete f.branches;
            if (kept.length) { if (short && kept.length === 1 && !kept[0].label) f.elseAt = kept[0].at; else f.branches = kept; }
          }
          return true;
        });
      }
      // Move a message to `index` in the list without it
      function moveMessage(id, index) {
        const ms = chartData.messages, from = msgIndex(id);
        if (from < 0 || index === from) return false;
        detachMessage(id);
        const [m] = ms.splice(from, 1);
        ms.splice(Math.max(0, Math.min(index, ms.length)), 0, m);
        return true;
      }
      function messageDrag(id) {
        return {
          move(pt, d) {
            const el = document.querySelector(`.seq-msg-label[data-edge-id="${id}"]`);
            if (el) {
              el.classList.add('dragging');
              const base = el.style.transform.replace(/translate[XY]\([^)]*\)/g, '').trim();
              el.style.transform = `${base} translateY(${d.dy}px)`.trim();
            }
            const m = msgById(id);
            d.slot = nearestSlot(rowSlots(id), m.y + d.dy);
            showDropLine(d.slot.y, frameAtSlot(d.slot.index, id));
          },
          drop(pt, d) {
            if (d.slot && moveMessage(id, d.slot.index)) relayout(); else render();
          }
        };
      }

      // --- CREATE A MESSAGE BY DRAWING IT: from a lifeline's + to another lifeline ---
      // Hovering a lifeline shows a + dot snapped to the gap between two rows; dragging it draws a rubber-band arrow,
      // lights the lifeline it would land on and shows the row. Released on the same lifeline: a self-message.
      const seqPlus = htmlEl('div', 'seq-plus');
      seqPlus.dataset.exportSkip = '';
      seqPlus.title = 'Drag to another lifeline to add a message here (or drag from any lifeline or activation bar)';
      seqPlus.textContent = '+';
      function hidePlus() { seqPlus.style.display = 'none'; }
      function onCanvasHover(e) {
        if (seqDrag || isPresent() || !chartData.layout) { hidePlus(); return; }
        const pt = canvasPoint(e);
        seqCanvas.classList.toggle('seq-row-hover', pt.y < SQ.TOP + SQ.BOX_H + 22 && pt.y > 0);
        if (e.target === seqPlus) return;
        // On a lifeline the + wins over a frame's border or a branch divider crossing it
        const free = e.target === seqCanvas || e.target === seqSvg || e.target === seqHtml || e.target.classList.contains('seq-pin-band')
          || e.target.classList.contains('seq-frag-hit') || e.target.classList.contains('seq-div-hit')
          || e.target.classList.contains('seq-life-hit') || e.target.classList.contains('seq-activation');
        const p = free && pt.y > SQ.TOP + SQ.BOX_H + 8 && pt.y < chartData.layout.height - 30 ? nearestParticipant(pt.x) : null;
        if (!p || Math.abs(p.x - pt.x) > 16) { hidePlus(); return; }
        const slot = nearestSlot(rowSlots(), pt.y);
        if (!seqPlus.isConnected) seqHtml.appendChild(seqPlus);
        Object.assign(seqPlus.style, { display: 'flex', left: px(p.x), top: px(slot.y) });
        seqPlus.dataset.pid = p.id;
        seqPlus.dataset.index = slot.index;
        seqPlus.dataset.y = slot.y;
      }
      seqCanvas.addEventListener('pointermove', onCanvasHover);
      seqCanvas.addEventListener('pointerleave', () => { hidePlus(); seqCanvas.classList.remove('seq-row-hover'); });
      // fromLine: the drag started on a lifeline or an activation bar, not on the + (a click there selects the
      // participant). A self-message needs the pointer to have gone 30px out from the lifeline, so a wobble draws nothing.
      function connectDrag(pid = seqPlus.dataset.pid, index = +seqPlus.dataset.index, y = +seqPlus.dataset.y, fromLine = false) {
        const from = partById(pid);
        return {
          move(pt, d) {
            hidePlus();
            d.away = Math.max(d.away || 0, Math.abs(pt.x - from.x));
            let to = nearestParticipant(pt.x);
            if (to && to.id === from.id && d.away < 30) to = null;   // a self-message: out to the side and back
            d.to = to;
            lightLifeline(to && to.id);
            showRubber(from.x, y, pt.x, y + (pt.y - y) * 0.15);
            showDropLine(y, frameAtSlot(index));
          },
          drop(pt, d) {
            if (!d.to) { render(); return; }
            const kind = drawnKind(from.id, d.to.id, index);
            expandFramesHiding([from.id, d.to.id]);   // never draw into a collapsed frame: open the ones that hide a rail
            const m = { id: seqUid('m'), from: from.id, to: d.to.id, label: kind === 'reply' ? 'Reply' : 'Message', kind };
            chartData.messages.splice(index, 0, m);
            editCreated('message', m.id);
          },
          click() { hidePlus(); if (fromLine) select('participant', from.id); }
        };
      }
      // The kind of a message added from `from` to `to` at `index` (drawn, or added by the dock's Message button): the reply of the latest call from `to` to `from`
      // that is still open there (no reply to it yet, and `to` has sent `from` nothing since); otherwise a call
      function drawnKind(from, to, index) {
        if (from === to) return 'sync';
        const ms = chartData.messages;
        for (let i = index - 1; i >= 0; i--) {
          const m = ms[i];
          if (m.from === from && m.to === to && m.kind === 'reply') return 'sync';   // already answered
          if (m.from === to && m.to === from) return (m.kind || 'sync') === 'sync' ? 'reply' : 'sync';
        }
        return 'sync';
      }

      // --- HANDLES ON THE SELECTION ---
      // Retarget: drag a message end to another lifeline. Frame range: drag its top or bottom edge to a row gap.
      // Note: stretch it over a second lifeline from its right edge.
      function handleDrag(h) {
        const role = h.dataset.role;
        if (role === 'from' || role === 'to') {
          const m = msgById(h.dataset.id);
          const fixed = partById(role === 'from' ? m.to : m.from);
          return {
            move(pt, d) {
              const p = nearestParticipant(pt.x);
              d.target = p;
              lightLifeline(p && p.id);
              if (role === 'to') showRubber(fixed.x, m.y, pt.x, m.y); else showRubber(pt.x, m.y, fixed.x, m.y);
            },
            drop(pt, d) {
              if (!d.target || d.target.id === m[role]) { render(); return; }
              m[role] = d.target.id;
              relayout();
            }
          };
        }
        if (role === 'top' || role === 'bottom') {
          const f = fragById(h.dataset.id);
          return {
            move(pt, d) {
              d.slot = nearestSlot(rowSlots(), pt.y);
              showDropLine(d.slot.y, null);
            },
            drop(pt, d) {
              const ms = chartData.messages;
              let [a, b] = fragRange(f);
              if (role === 'top') a = d.slot.index; else b = d.slot.index - 1;
              if (a > b || a < 0 || b >= ms.length || crossesFrame(a, b, f.id)) { render(); return; }
              const brs = branchList(f);
              f.from = ms[a].id;
              f.to = ms[b].id;
              setBranches(f, brs);   // a branch now outside the frame goes
              relayout();
            }
          };
        }
        if (role === 'stretch') {
          const n = noteById(h.dataset.id);
          return {
            move(pt, d) {
              const p = nearestParticipant(pt.x);
              d.target = p;
              lightLifeline(p && p.id);
            },
            drop(pt, d) {
              const first = Array.isArray(n.over) ? n.over[0] : n.over;
              if (!d.target) { render(); return; }
              const over = d.target.id === first ? first : [first, d.target.id];
              if (JSON.stringify(over) === JSON.stringify(n.over)) { render(); return; }
              n.over = over;
              relayout();
            }
          };
        }
        return null;
      }

      // Move a note: vertically to another row gap, sideways to another lifeline (a stretched note keeps its span)
      function noteDrag(id, el) {
        const n = noteById(id);
        return {
          move(pt, d) {
            el.classList.add('dragging');
            el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
            d.slot = nearestSlot(rowSlots(), n.y + d.dy);
            showDropLine(d.slot.y, null);
            const p = nearestParticipant(n.x + n.w / 2 + d.dx);
            lightLifeline(p && p.id);
          },
          drop(pt, d) {
            const ps = chartData.participants, ms = chartData.messages;
            const over = Array.isArray(n.over) ? n.over : [n.over];
            const centre = nearestParticipant(n.x + n.w / 2 + d.dx);
            const was = nearestParticipant(n.x + n.w / 2);
            const shift = ps.indexOf(centre) - ps.indexOf(was);
            const idx = over.map((pid) => Math.max(0, Math.min(ps.length - 1, ps.findIndex((p) => p.id === pid) + shift)));
            n.over = idx.length > 1 && idx[0] !== idx[1] ? idx.map((i) => ps[i].id) : ps[idx[0]].id;
            delete n.after;
            delete n.before;
            if (d.slot.index < ms.length) n.before = ms[d.slot.index].id;
            else if (ms.length) n.after = ms[ms.length - 1].id;
            relayout();
          }
        };
      }

      // Move a branch divider to another row gap inside its frame
      function dividerDrag(fid, at) {
        const f = fragById(fid);
        return {
          move(pt, d) {
            d.slot = nearestSlot(rowSlots(), pt.y);
            showDropLine(d.slot.y, f);
          },
          drop(pt, d) {
            const ms = chartData.messages, [a, b] = fragRange(f), k = d.slot.index;
            const brs = branchList(f);
            if (k <= a || k > b || !ms[k] || brs.some((br) => br.at === ms[k].id)) { render(); return; }
            brs.forEach((br) => { if (br.at === at) br.at = ms[k].id; });
            setBranches(f, brs);
            seqSel = { kind: 'divider', id: fid, at: ms[k].id };
            relayout();
          }
        };
      }

      // Shift + drag on blank canvas: a marquee selects every message it touches, as one range
      function marqueeDrag(e) {
        const start = canvasPoint(e);
        const box = htmlEl('div', 'seq-marquee');
        box.dataset.exportSkip = '';
        seqHtml.appendChild(box);
        const rect = (pt) => ({ x: Math.min(start.x, pt.x), y: Math.min(start.y, pt.y), w: Math.abs(pt.x - start.x), h: Math.abs(pt.y - start.y) });
        return {
          move(pt) {
            const r = rect(pt);
            Object.assign(box.style, { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });
          },
          drop(pt) {
            box.remove();
            const r = rect(pt);
            const byId = {};
            chartData.participants.forEach((p) => { byId[p.id] = p; });
            const ids = chartData.messages.filter((m) => {
              if (m.hidden || !byId[m.from] || !byId[m.to]) return false;
              const lo = Math.min(byId[m.from].x, byId[m.to].x), hi = Math.max(byId[m.from].x, byId[m.to].x) + (m.from === m.to ? SQ.SELF_LOOP : 0);
              return m.y >= r.y && m.y <= r.y + r.h && hi >= r.x && lo <= r.x + r.w;
            }).map((m) => m.id);
            if (ids.length) selectRange(ids[0], ids[ids.length - 1]); else select(null);
          },
          click() { box.remove(); }
        };
      }
      // A range of messages from anchor to id (in time order, inclusive)
      function selectRange(anchor, id) {
        const ms = chartData.messages, a = msgIndex(anchor), b = msgIndex(id);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const ids = ms.slice(lo, hi + 1).filter((m) => !m.hidden || m.id === anchor || m.id === id).map((m) => m.id);
        select('message', id, ids.length > 1 ? { ids, anchor } : {});
      }

      function onSeqPointerDown(e) {
        if (isPresent() || e.button > 0) return;
        if (e.target.isContentEditable) return;
        if (e.target.closest('.seq-frag-chev, .seq-frag-summary, .seq-frag-focus, .seq-actionbar, .seq-insert, .seq-add-branch')) return;   // handled on click
        const handle = e.target.closest('.seq-handle');
        if (handle) { e.stopPropagation(); const d = handleDrag(handle); if (d) beginDrag(e, d); return; }
        if (e.target === seqPlus) { e.stopPropagation(); beginDrag(e, connectDrag()); return; }
        // DRAW FROM A LIFELINE: a drag from a lifeline or an activation bar draws a message from the nearest row gap
        const src = e.target.closest('.seq-life-hit, .seq-activation');
        if (src) {
          e.stopPropagation();
          const slot = nearestSlot(rowSlots(), canvasPoint(e).y);
          beginDrag(e, connectDrag(src.dataset.pid || src.dataset.nodeId, slot.index, slot.y, true));
          return;
        }
        const hit = e.target.closest('.seq-participant, .seq-msg-label, .seq-msg-hit, .seq-msg-detail, .seq-frag-label, .seq-frag-hit, .seq-div-hit, .seq-frag-branch-label, .seq-frag-else-label, .seq-note');
        if (!hit) {
          // Shift + drag on blank canvas draws a marquee instead of panning
          if (e.shiftKey && (e.target === seqCanvas || e.target === seqSvg || e.target === seqHtml || e.target.classList.contains('seq-pin-band'))) {
            e.stopPropagation();
            beginDrag(e, marqueeDrag(e));
          }
          return;
        }
        const cl = hit.classList;
        if (cl.contains('seq-participant')) {
          select('participant', hit.dataset.nodeId);
          beginDrag(e, participantDrag(hit.dataset.nodeId, hit));
        } else if (cl.contains('seq-frag-label') || cl.contains('seq-frag-hit')) {
          select('fragment', hit.dataset.fragId);
        } else if (cl.contains('seq-div-hit') || cl.contains('seq-frag-branch-label') || cl.contains('seq-frag-else-label')) {
          select('divider', hit.dataset.fragId, { at: hit.dataset.at });
          beginDrag(e, dividerDrag(hit.dataset.fragId, hit.dataset.at));
        } else if (cl.contains('seq-note')) {
          select('note', hit.dataset.noteId);
          beginDrag(e, noteDrag(hit.dataset.noteId, hit));
        } else {
          const id = hit.dataset.edgeId;
          if (e.shiftKey && seqSel && seqSel.kind === 'message') { selectRange(seqSel.anchor || seqSel.id, id); return; }
          select('message', id);
          beginDrag(e, messageDrag(id));
        }
      }

      // --- ACTION BAR AND HANDLES (drawn on the selection, never exported) ---
      const ICON = {
        async: '<path d="M3 12h16"/><path d="m14 7 6 5-6 5"/>',
        reverse: '<path d="M4 8h16"/><path d="m16 4 4 4-4 4"/><path d="M20 16H4"/><path d="m8 12-4 4 4 4"/>',
        reply2: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
        show: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
        trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'
      };
      const iconSvg = (body) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
      function abButton(act, html, title, pressed, value) {
        const b = htmlEl('button', 'seq-ab-btn');
        b.type = 'button';
        b.dataset.act = act;
        if (value !== undefined) b.dataset.value = value;
        b.title = title;
        b.setAttribute('aria-label', title);
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
        b.innerHTML = html;
        return b;
      }
      function addHandle(role, id, x, y, extraClass) {
        const h = htmlEl('div', `seq-handle ${extraClass || ''}`.trim(), { left: px(x), top: px(y) });
        h.dataset.role = role;
        h.dataset.id = id;
        h.dataset.exportSkip = '';
        seqHtml.appendChild(h);
      }
      function drawSelectionTools(sel) {
        seqHtml.querySelectorAll('.seq-actionbar, .seq-handle, .seq-add-branch').forEach((el) => el.remove());
        if (!sel.kind || isPresent()) return;
        const bar = htmlEl('div', 'seq-actionbar');
        bar.dataset.exportSkip = '';
        bar.setAttribute('role', 'toolbar');
        let at = null;
        const byId = {};
        chartData.participants.forEach((p) => { byId[p.id] = p; });
        if (sel.kind === 'message' && !sel.ids) {
          const m = msgById(sel.id), a = byId[m && m.from], b = byId[m && m.to];
          if (!m || !a || !b || m.hidden) return;
          bar.setAttribute('aria-label', 'Message');
          // Kind follows from the flow (see drawnKind), so the one choice left is a call nobody answers
          if ((m.kind || 'sync') !== 'reply') {
            bar.appendChild(abButton('async', iconSvg(ICON.async), 'No reply expected (fire and forget: an open arrowhead, no activation bar)', m.kind === 'async'));
            bar.appendChild(htmlEl('span', 'seq-ab-sep'));
          }
          bar.appendChild(abButton('reverse', iconSvg(ICON.reverse), 'Reverse the direction'));
          if ((m.kind || 'sync') === 'sync' && m.from !== m.to) bar.appendChild(abButton('reply', `${iconSvg(ICON.reply2)}<span>Reply</span>`, 'Add the reply under this call (or under the last message of its bar)'));
          const self = m.from === m.to;
          at = { x: self ? a.x + SQ.SELF_LOOP + 60 : (a.x + b.x) / 2, y: m.y - 62 };
          // End handles: drag one to another lifeline to move that end
          if (self) { addHandle('from', m.id, a.x, m.y, 'seq-end'); addHandle('to', m.id, a.x, m.y + 28, 'seq-end'); }
          else { addHandle('from', m.id, a.x, m.y, 'seq-end'); addHandle('to', m.id, b.x, m.y, 'seq-end'); }
        } else if (sel.kind === 'participant') {
          const p = byId[sel.id];
          if (!p) return;
          bar.setAttribute('aria-label', 'Participant kind');
          if (p.rail) {
            bar.appendChild(abButton('show', `${iconSvg(ICON.show)}<span>Show</span>`, 'Expand the frames that hide this participant'));
            bar.appendChild(htmlEl('span', 'seq-ab-sep'));
          }
          PARTICIPANT_KINDS.forEach((k) => bar.appendChild(abButton('pkind', KIND_ICONS[k] ? iconSvg(KIND_ICONS[k]) : `<span>${k === 'actor' ? 'Actor' : 'System'}</span>`,
            `Kind: ${k}`, (p.kind || 'system') === k, k)));
          at = { x: p.x, y: SQ.TOP + (p.rail ? SQ.RAIL_H : SQ.BOX_H) + 8 };
          bar.classList.add('is-below');
        } else if (sel.kind === 'fragment') {
          const f = fragById(sel.id);
          if (!f || f.x === undefined) return;
          bar.setAttribute('aria-label', 'Frame');
          FRAG_KINDS.forEach((k) => bar.appendChild(abButton('fkind', `<span>${k}</span>`, `Kind: ${k}`, f.kind === k, k)));
          bar.appendChild(htmlEl('span', 'seq-ab-sep'));
          bar.appendChild(abButton('color', '<span class="seq-swatch is-none"></span>', 'No colour', !f.color, ''));
          FRAG_COLORS.forEach((c) => bar.appendChild(abButton('color', `<span class="seq-swatch seq-tint-${c}"></span>`, `Colour: ${c}`, f.color === c, c)));
          bar.appendChild(htmlEl('span', 'seq-ab-sep'));
          const foc = focusState(f.id);
          if (foc && foc.toCollapse.length) {
            const on = isFocused(foc);
            bar.appendChild(abButton('focus', `${iconSvg(ICON.focus)}<span>Focus</span>`, on ? 'Show every phase again' : 'Collapse the other phases and expand this one', on));
            bar.appendChild(htmlEl('span', 'seq-ab-sep'));
          }
          bar.appendChild(abButton('delete-with', `${iconSvg(ICON.trash)}<span>With messages</span>`, 'Delete the frame and every message in it'));
          at = { x: f.x + 150, y: f.y - 40 };
          if (!f.collapsed) {
            addHandle('top', f.id, f.x + f.w / 2, f.y, 'seq-edge');
            addHandle('bottom', f.id, f.x + f.w / 2, f.y + f.h, 'seq-edge');
            if (f.kind === 'alt' || f.kind === 'par') {
              const add = htmlEl('button', 'seq-add-branch', { left: px(f.x + f.w / 2 + 24), top: px(f.y + f.h) });
              add.type = 'button';
              add.dataset.exportSkip = '';
              add.dataset.fragId = f.id;
              add.textContent = '+ branch';
              add.title = 'Add a branch above the frame\'s last message';
              seqHtml.appendChild(add);
            }
          }
        } else if (sel.kind === 'note') {
          const n = noteById(sel.id);
          if (n && n.x !== undefined) addHandle('stretch', n.id, n.x + n.w, n.y + n.h / 2, 'seq-stretch');
          return;
        } else {
          return;
        }
        Object.assign(bar.style, { left: px(at.x), top: px(Math.max(2, at.y)) });
        seqHtml.appendChild(bar);
      }

      seqHtml.addEventListener('click', (e) => {
        const add = e.target.closest('.seq-add-branch');
        if (add) { e.stopPropagation(); addBranch(add.dataset.fragId); return; }
        const ins = e.target.closest('.seq-insert');
        if (ins) { e.stopPropagation(); insertParticipant(+ins.dataset.index); return; }
        const b = e.target.closest('.seq-ab-btn');
        if (!b || !seqSel) return;
        e.stopPropagation();
        runAction(b.dataset.act, b.dataset.value);
      });
      function runAction(act, value) {
        const sel = seqSel;
        if (sel.kind === 'message') {
          const m = msgById(sel.id);
          if (!m) return;
          if (act === 'async') { if (m.kind === 'reply') return; m.kind = m.kind === 'async' ? 'sync' : 'async'; relayout(); }
          else if (act === 'reverse') { const t = m.from; m.from = m.to; m.to = t; relayout(); }
          else if (act === 'reply') addReply(m);
        } else if (sel.kind === 'participant') {
          const p = partById(sel.id);
          if (p && act === 'pkind' && (p.kind || 'system') !== value) { p.kind = value; relayout(); }
          else if (p && act === 'show') { expandFramesHiding([p.id]); relayout(); }
        } else if (sel.kind === 'fragment') {
          const f = fragById(sel.id);
          if (!f) return;
          if (act === 'fkind' && f.kind !== value) {
            const brs = branchList(f);
            f.kind = value;
            setBranches(f, brs);   // away from alt/par the branches go, in the same undo step
            relayout();
          } else if (act === 'color' && (f.color || '') !== value) {
            if (value) f.color = value; else delete f.color;
            relayout();
          } else if (act === 'focus') {
            focusFrame(f.id);
          } else if (act === 'delete-with') {
            const [a, b] = fragRange(f);
            chartData.fragments = chartData.fragments.filter((x) => x.id !== f.id);
            removeMessages(chartData.messages.slice(a, b + 1).map((x) => x.id));
            seqSel = null;
            relayout();
          }
        }
      }
      // Reply: the reverse dashed message under the call, or under the last message of its bar
      function addReply(m) {
        const ms = chartData.messages, i = ms.indexOf(m);
        let at = i + 1;
        // Inside the bar: everything until the callee next answers or the caller calls it again
        for (let j = i + 1; j < ms.length; j++) {
          const r = ms[j];
          if ((r.from === m.from && r.to === m.to) || (r.kind === 'reply' && r.from === m.to && r.to === m.from)) break;
          if (r.from === m.to || r.to === m.to) at = j + 1; else break;
        }
        const reply = { id: seqUid('m'), from: m.to, to: m.from, label: 'Reply', kind: 'reply' };
        ms.splice(at, 0, reply);
        // It stays in the frames its call is in: a frame that ended at the last message of the bar grows
        chartData.fragments.forEach((f) => { if (msgIndex(f.to) === at - 1 && msgIndex(f.from) <= i) f.to = reply.id; });
        editCreated('message', reply.id);
      }
      // + branch: a divider above the frame's last message that does not start a branch yet
      function addBranch(fid) {
        const f = fragById(fid);
        if (!f) return;
        const [a, b] = fragRange(f), brs = branchList(f), ms = chartData.messages;
        let k = b;
        while (k > a && brs.some((br) => br.at === ms[k].id)) k--;
        if (k <= a) return;
        brs.push({ at: ms[k].id, label: 'condition' });
        setBranches(f, brs);
        seqSel = { kind: 'divider', id: fid, at: ms[k].id };
        relayout();
        editBranch(fid, ms[k].id);
      }

      // --- INLINE TEXT EDITING (double-click, Enter / F2, or straight after creating something) ---
      // Enter commits; Escape keeps the old text. A note takes Shift+Enter for a line break. Tab in a message's label
      // moves on to its detail; an empty detail removes it.
      const EDIT_TEXT = '.seq-participant-name, .seq-msg-label-text, .seq-frag-text';
      const EDIT_OWNER = { participant: '.seq-participant[data-node-id="ID"]', message: '.seq-msg-label[data-edge-id="ID"]', fragment: '.seq-frag-label[data-frag-id="ID"]' };
      function applyText(el, value) {
        const owner = el.closest('[data-node-id], [data-edge-id], [data-frag-id]');
        if (!value || !owner) return false;
        if (owner.dataset.nodeId) { const p = partById(owner.dataset.nodeId); if (p && p.name !== value) { p.name = value; return true; } }
        else if (owner.dataset.edgeId) { const m = msgById(owner.dataset.edgeId); if (m && m.label !== value) { m.label = value; return true; } }
        else if (owner.dataset.fragId) { const f = fragById(owner.dataset.fragId); if (f && f.label !== value) { f.label = value; return true; } }
        return false;
      }
      function beginEdit(el, opts = {}) {
        if (!el || el.isContentEditable) return;
        const multi = !!opts.multiline;
        if (opts.raw !== undefined) el.textContent = opts.raw;
        el.contentEditable = multi ? 'plaintext-only' : 'true';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        const original = el.textContent;
        let tabbed = false;
        const commit = () => {
          el.removeEventListener('blur', commit);
          el.removeEventListener('keydown', onKey);
          el.contentEditable = 'false';
          const value = (multi ? el.innerText : el.textContent).replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
          const changed = (opts.apply || applyText)(el, value);
          if (changed) relayout();
          else if (opts.restore) render();
          else el.textContent = original;
          if (tabbed && opts.onTab) opts.onTab();
        };
        const onKey = (ke) => {
          // The keys an edit uses stop here: an Enter that reached the window would open the selection's edit again
          if (ke.key === 'Enter' || ke.key === 'Tab' || ke.key === 'F2') ke.stopPropagation();
          if (ke.key === 'Enter' && multi && ke.shiftKey) { ke.preventDefault(); document.execCommand('insertText', false, '\n'); }
          else if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); el.textContent = original; el.blur(); }
          else if (ke.key === 'Tab' && opts.onTab) { ke.preventDefault(); tabbed = true; el.blur(); }
        };
        el.addEventListener('blur', commit);
        el.addEventListener('keydown', onKey);
      }
      function editMessage(id) {
        const el = seqHtml.querySelector(`.seq-msg-label[data-edge-id="${id}"] .seq-msg-label-text`);
        beginEdit(el, { onTab: () => editDetail(id) });
      }
      // The detail line under a message's arrow; one is made for the edit when the message has none (or details are hidden)
      function editDetail(id) {
        const m = msgById(id);
        if (!m || m.hidden) return;
        let el = seqHtml.querySelector(`.seq-msg-detail[data-edge-id="${id}"] .seq-msg-detail-text`);
        if (!el) {
          const label = seqHtml.querySelector(`.seq-msg-label[data-edge-id="${id}"]`);
          if (!label) return;
          const box = htmlEl('div', `seq-msg-detail is-editing${m.from === m.to ? ' is-self' : ''}`, {
            left: label.style.left, top: px(m.from === m.to ? m.y + 24 : m.y + 3), transform: label.style.transform });
          box.dataset.edgeId = id;
          el = htmlEl('span', 'seq-msg-detail-text');
          box.appendChild(el);
          seqHtml.appendChild(box);
        }
        beginEdit(el, {
          raw: m.detail || '', restore: true,
          apply: (e, value) => {
            if ((m.detail || '') === value) return false;
            if (value) m.detail = value.replace(/\s*\n\s*/g, ' '); else delete m.detail;
            return true;
          }
        });
      }
      function editNote(id) {
        const n = noteById(id);
        const el = seqHtml.querySelector(`.seq-note[data-note-id="${id}"] .seq-note-text`);
        if (!n || !el) return;
        beginEdit(el, {
          multiline: true, raw: n.text || '', restore: true,
          apply: (e, value) => { if (!value || value === n.text) return false; n.text = value; return true; }
        });
      }
      // A branch's condition. An "else" (no label) is given a label element for the edit
      function editBranch(fid, at) {
        const f = fragById(fid);
        if (!f || f.x === undefined) return;
        const d = (f.dividers || []).find((x) => x.at === at);
        if (!d) return;
        let el = seqHtml.querySelector(`.seq-frag-branch-label[data-frag-id="${fid}"][data-at="${at}"] .seq-branch-text`);
        if (!el) {
          seqHtml.querySelectorAll(`.seq-frag-else-label[data-frag-id="${fid}"][data-at="${at}"]`).forEach((x) => x.remove());
          const box = htmlEl('div', 'seq-frag-branch-label is-editing', { left: px(f.x + 10), top: px(d.y + 3) });
          box.dataset.fragId = fid;
          box.dataset.at = at;
          el = htmlEl('span', 'seq-branch-text');
          box.appendChild(el);
          seqHtml.appendChild(box);
        }
        const brs = branchList(f), br = brs.find((x) => x.at === at);
        beginEdit(el, {
          raw: br ? br.label : '', restore: true,
          apply: (e, value) => {
            if (!br || br.label === value) return false;
            br.label = value;
            setBranches(f, brs);
            return true;
          }
        });
      }
      function editSelection() {
        const sel = seqSel;
        if (!sel) return;
        if (sel.kind === 'message') editMessage(sel.id);
        else if (sel.kind === 'note') editNote(sel.id);
        else if (sel.kind === 'divider') editBranch(sel.id, sel.at);
        else {
          const box = seqHtml.querySelector(EDIT_OWNER[sel.kind].replace('ID', sel.id));
          beginEdit(box && box.querySelector(EDIT_TEXT));
        }
      }
      function onSeqDblClick(e) {
        if (isPresent()) return;
        if (e.target.closest('.seq-frag-chev, .seq-frag-summary, .seq-frag-focus, .seq-actionbar')) return;
        const div = e.target.closest('.seq-div-hit, .seq-frag-branch-label, .seq-frag-else-label');
        if (div) { e.stopPropagation(); editBranch(div.dataset.fragId, div.dataset.at); return; }
        const note = e.target.closest('.seq-note');
        if (note) { e.stopPropagation(); editNote(note.dataset.noteId); return; }
        const det = e.target.closest('.seq-msg-detail');
        if (det) { e.stopPropagation(); editDetail(det.dataset.edgeId); return; }
        const lab = e.target.closest('.seq-msg-label');
        if (lab) { e.stopPropagation(); editMessage(lab.dataset.edgeId); return; }
        const box = e.target.closest('.seq-participant, .seq-frag-label');
        if (box && box.classList.contains('is-rail')) return;   // a rail's name is written downwards: Show it to rename
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
        // The pinned participant row covers the top of the viewport
        const top = v.top + (seqCanvas.classList.contains('seq-pinned') ? (topRowH() + 24) * scale : 0);
        let dx = 0, dy = 0;
        if (r.left < v.left + pad) dx = v.left + pad - r.left; else if (r.right > v.right - pad) dx = v.right - pad - r.right;
        if (r.top < top + pad) dy = top + pad - r.top; else if (r.bottom > bottom - pad) dy = bottom - pad - r.bottom;
        if (!dx && !dy) return;
        panX += dx;
        panY += dy;
        updateTransform();
      }
      // Create means name: a new object is selected, on screen, and its placeholder text is in edit
      function editCreated(kind, id) {
        seqSel = { kind, id };
        relayout();
        if (kind === 'note') {
          panIntoView(seqHtml.querySelector(`.seq-note[data-note-id="${id}"]`));
          editNote(id);
          return;
        }
        const box = seqHtml.querySelector(EDIT_OWNER[kind].replace('ID', id));
        panIntoView(box);
        if (kind === 'message') editMessage(id); else beginEdit(box && box.querySelector(EDIT_TEXT));
      }

      seqHtml.addEventListener('pointerdown', onSeqPointerDown);
      seqSvg.addEventListener('pointerdown', onSeqPointerDown);
      // Shift + drag on blank canvas: the canvas itself is the target there
      seqCanvas.addEventListener('pointerdown', (e) => { if (e.target === seqCanvas) onSeqPointerDown(e); });

      // --- COLLAPSE AND EXPAND (the chevron in a frame tag, or a collapsed frame's summary row) ---
      // "collapsed" is saved, so an author can ship a page that opens as an overview. In ?present it is how a
      // presenter walks the audience through the flow phase by phase: there it changes the view only (no undo
      // step, no unsaved badge).
      function toggleCollapsed(fid) {
        const f = fragById(fid);
        if (!f) return;
        if (f.collapsed) delete f.collapsed; else f.collapsed = true;
        commitView(fid);
      }
      // A change of what is shown: in ?present the view only, otherwise one undo step with the frame selected
      function commitView(fid) {
        if (isPresent()) { layoutDiagram(chartData); render(); return; }
        if (fid) seqSel = { kind: 'fragment', id: fid };
        relayout();
      }
      // --- FOCUS: collapse every other top-level frame, expand this one and the frames around it ---
      // The participants those phases leave behind become rails (the diagram sets "rails"), so it gets narrower.
      // Only top-level frames fold: a frame that crosses another one's edge is left alone (it could not be collapsed
      // without cutting that frame in half). Pressing Focus on the focused frame shows everything again.
      function frameSpans() {
        return chartData.fragments.map((f) => ({ f, a: msgIndex(f.from), b: msgIndex(f.to) })).filter((r) => r.a >= 0 && r.b >= r.a);
      }
      function focusState(fid) {
        const rs = frameSpans(), me = rs.find((r) => r.f.id === fid);
        if (!me) return null;
        const encloses = (o, i) => o !== i && o.a <= i.a && i.b <= o.b && (o.b - o.a > i.b - i.a || (o.b - o.a === i.b - i.a && rs.indexOf(o) < rs.indexOf(i)));
        const crossing = (r) => rs.some((o) => o !== r && ((o.a < r.a && r.a <= o.b && o.b < r.b) || (r.a < o.a && o.a <= r.b && r.b < o.b)));
        const tops = rs.filter((r) => !rs.some((o) => encloses(o, r)));
        const keep = rs.filter((r) => r === me || encloses(r, me));
        const toCollapse = tops.filter((r) => !keep.includes(r) && !crossing(r));
        return { me, keep, toCollapse };
      }
      const isFocused = (st) => st.keep.every((r) => !r.f.collapsed) && st.toCollapse.length > 0 && st.toCollapse.every((r) => r.f.collapsed);
      function focusFrame(fid) {
        const st = focusState(fid);
        if (!st) return;
        if (isFocused(st)) { chartData.fragments.forEach((f) => { delete f.collapsed; }); delete chartData.rails; }
        else {
          st.keep.forEach((r) => { delete r.f.collapsed; });
          st.toCollapse.forEach((r) => { r.f.collapsed = true; });
          chartData.rails = true;
        }
        commitView(fid);
        panIntoView(seqHtml.querySelector(`.seq-frag-label[data-frag-id="${fid}"]`));
      }
      function showAll() {
        chartData.fragments.forEach((f) => { delete f.collapsed; });
        commitView(null);
      }
      // Expand every collapsed frame that hides a message of (or a note over) one of these participants
      function expandFramesHiding(pids) {
        const ms = chartData.messages;
        frameSpans().forEach((r) => {
          if (!r.f.collapsed) return;
          if (ms.slice(r.a, r.b + 1).some((m) => pids.includes(m.from) || pids.includes(m.to))) delete r.f.collapsed;
        });
      }
      btnShowAll.addEventListener('click', showAll);
      seqHtml.addEventListener('click', (e) => {
        const btn = e.target.closest('.seq-frag-chev, .seq-frag-summary, .seq-frag-focus');
        if (!btn) return;
        e.stopPropagation();
        const fid = btn.closest('[data-frag-id]').dataset.fragId;
        if (btn.classList.contains('seq-frag-focus')) focusFrame(fid); else toggleCollapsed(fid);
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
            if (!f.branches.length) delete f.branches;
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
        if (!chartData.notes.length) delete chartData.notes;
      }
      function deleteParticipant(id) {
        removeMessages(chartData.messages.filter((m) => m.from === id || m.to === id).map((m) => m.id));
        removeParticipantNotes(id);
        chartData.participants = chartData.participants.filter((p) => p.id !== id);
        seqSel = null;
        relayout();
      }

      // Deleting a participant with messages is confirmed first, in a small bubble at the button (or the box)
      let seqConfirmEl = null;
      function closeConfirm() {
        if (!seqConfirmEl) return false;
        seqConfirmEl.remove();
        seqConfirmEl = null;
        document.removeEventListener('pointerdown', onConfirmOutside, true);
        return true;
      }
      function onConfirmOutside(e) { if (seqConfirmEl && !seqConfirmEl.contains(e.target)) closeConfirm(); }
      function confirmDeleteParticipant(p, count, anchorEl) {
        closeConfirm();
        const box = htmlEl('div', 'seq-confirm');
        box.dataset.exportSkip = '';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-label', 'Delete participant');
        const msg = htmlEl('div', 'seq-confirm-msg');
        msg.textContent = `Delete ${p.name} and its ${count} message${count === 1 ? '' : 's'}?`;
        const row = htmlEl('div', 'seq-confirm-actions');
        const cancel = htmlEl('button', 'btn seq-confirm-cancel');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => closeConfirm());
        const ok = htmlEl('button', 'btn seq-confirm-delete');
        ok.type = 'button';
        ok.textContent = 'Delete';
        ok.addEventListener('click', () => { closeConfirm(); deleteParticipant(p.id); });
        row.append(cancel, ok);
        box.append(msg, row);
        box.addEventListener('keydown', (e) => {
          // Keys inside the bubble stay there (Delete/Backspace would open it again)
          if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
          if (e.key !== 'Tab') e.stopPropagation();
        });
        document.body.appendChild(box);
        seqConfirmEl = box;
        const anchor = anchorEl || seqHtml.querySelector(`.seq-participant[data-node-id="${p.id}"]`);
        const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
        const bw = box.offsetWidth, bh = box.offsetHeight;
        const top = r.bottom + 8 + bh > innerHeight - 8 ? r.top - 8 - bh : r.bottom + 8;
        box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bw - 8))}px`;
        box.style.top = `${Math.max(8, Math.min(top, innerHeight - bh - 8))}px`;
        cancel.focus();
        document.addEventListener('pointerdown', onConfirmOutside, true);
      }

      function deleteSelection(anchorEl) {
        const sel = seqSel;
        if (!sel) return;
        if (sel.kind === 'participant') {
          const p = partById(sel.id);
          if (!p) return;
          const count = chartData.messages.filter((m) => m.from === p.id || m.to === p.id).length;
          if (count) { confirmDeleteParticipant(p, count, anchorEl); return; }
          deleteParticipant(p.id);
          return;
        }
        if (sel.kind === 'message') removeMessages(selIds(sel));
        else if (sel.kind === 'note') {
          chartData.notes = (chartData.notes || []).filter((n) => n.id !== sel.id);
          if (!chartData.notes.length) delete chartData.notes;
        } else if (sel.kind === 'divider') {
          // The messages of the branch merge into the branch above
          const f = fragById(sel.id);
          if (f) setBranches(f, branchList(f).filter((br) => br.at !== sel.at));
        } else {
          chartData.fragments = chartData.fragments.filter((f) => f.id !== sel.id);
        }
        seqSel = null;
        relayout();
      }

      // --- CREATE (dock buttons and the + between participant boxes) ---
      function insertParticipant(index) {
        ensureModel();
        const p = { id: seqUid('p'), name: `Participant ${chartData.participants.length + 1}`, kind: 'system' };
        chartData.participants.splice(Math.max(0, Math.min(index, chartData.participants.length)), 0, p);
        editCreated('participant', p.id);
      }
      btnAddParticipant.addEventListener('click', () => {
        ensureModel();
        const i = seqSel && seqSel.kind === 'participant' ? chartData.participants.findIndex((p) => p.id === seqSel.id) : -1;
        insertParticipant(i >= 0 ? i + 1 : chartData.participants.length);
      });

      // The keyboard and touch path to a new message: after the selected message (same two ends), or at the
      // first row from the selected participant to its neighbour
      btnAddMessage.addEventListener('click', () => {
        ensureModel();
        const ps = chartData.participants, ms = chartData.messages;
        if (!seqSel || (seqSel.kind !== 'message' && seqSel.kind !== 'participant')) return;
        let m;
        if (seqSel.kind === 'message') {
          const ids = selIds(seqSel), last = msgById(ids[ids.length - 1]);
          if (!last) return;
          const i = ms.indexOf(last), kind = drawnKind(last.from, last.to, i + 1);
          m = { id: seqUid('m'), from: last.from, to: last.to, label: kind === 'reply' ? 'Reply' : 'Message', kind };
          ms.splice(i + 1, 0, m);
          // A frame that ended at the selected message takes the new one in
          chartData.fragments.forEach((f) => { if (f.to === last.id && f.from !== last.id) f.to = m.id; });
        } else {
          const i = ps.findIndex((p) => p.id === seqSel.id);
          const to = (ps[i + 1] || ps[i - 1] || ps[i]).id, kind = drawnKind(ps[i].id, to, 0);
          m = { id: seqUid('m'), from: ps[i].id, to, label: kind === 'reply' ? 'Reply' : 'Message', kind };
          ms.unshift(m);
        }
        editCreated('message', m.id);
      });

      btnFrame.addEventListener('click', () => {
        ensureModel();
        const fc = frameCandidate();
        if (!fc || !fc.ok) return;
        const ms = chartData.messages;
        const f = { id: seqUid('f'), kind: 'opt', label: 'condition', from: ms[fc.a].id, to: ms[fc.b].id };
        chartData.fragments.push(f);
        editCreated('fragment', f.id);
      });

      btnAddNote.addEventListener('click', () => {
        if (!seqSel || (seqSel.kind !== 'message' && seqSel.kind !== 'participant')) return;
        const n = { id: seqUid('n'), text: 'Note' };
        if (seqSel.kind === 'message') {
          const ids = selIds(seqSel), m = msgById(ids[ids.length - 1]);
          if (!m) return;
          n.over = m.from;
          n.after = m.id;
        } else {
          n.over = seqSel.id;
          if (chartData.messages.length) n.before = chartData.messages[0].id;
        }
        chartData.notes = chartData.notes || [];
        chartData.notes.push(n);
        editCreated('note', n.id);
      });

      btnNumbers.addEventListener('click', () => {
        if (chartData.numbered) delete chartData.numbered; else chartData.numbered = true;
        relayout();
      });
      btnLifespans.addEventListener('click', () => {
        if (chartData.lifespans) delete chartData.lifespans; else chartData.lifespans = true;
        relayout();
      });
      btnDetails.addEventListener('click', () => {
        if (chartData.showDetails === false) delete chartData.showDetails; else chartData.showDetails = false;
        relayout();
      });

      // --- KEYBOARD ---
      // Enter or F2 edits; Escape cancels the edit, then clears the selection; Up/Down walk the messages,
      // Left/Right the participants; Alt+Up/Down move a message; Shift+Up/Down grow the range.
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || seqDrag || !seqSel) return;
        if (document.activeElement && document.activeElement.isContentEditable) return;
        if (closeConfirm()) return;
        select(null);
      }, true);
      window.addEventListener('keydown', (e) => {
        if (isPresent() || seqDrag || e.ctrlKey || e.metaKey) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a.tagName === 'BUTTON' && e.key === 'Enter'))) return;
        if ((e.key === 'Enter' || e.key === 'F2') && seqSel) { e.preventDefault(); editSelection(); return; }
        const ms = chartData.messages.filter((m) => !m.hidden), ps = chartData.participants;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const dir = e.key === 'ArrowUp' ? -1 : 1;
          if (!ms.length) return;
          e.preventDefault();
          if (e.altKey && seqSel && seqSel.kind === 'message' && !seqSel.ids) {
            const vi = ms.findIndex((m) => m.id === seqSel.id), other = ms[vi + dir];
            if (!other) return;
            // In the list without the moving message, past the neighbour in that direction is the neighbour's own
            // index both ways (down: it moved up one; up: it is still there)
            if (moveMessage(seqSel.id, msgIndex(other.id))) { relayout(); panIntoView(seqHtml.querySelector(`.seq-msg-label[data-edge-id="${seqSel.id}"]`)); }
            return;
          }
          if (e.shiftKey && seqSel && seqSel.kind === 'message') {
            const cur = seqSel.id, vi = ms.findIndex((m) => m.id === cur), next = ms[vi + dir];
            if (next) selectRange(seqSel.anchor || cur, next.id);
            return;
          }
          let next;
          if (seqSel && seqSel.kind === 'message') { const vi = ms.findIndex((m) => m.id === seqSel.id); next = ms[Math.max(0, Math.min(ms.length - 1, vi + dir))]; }
          else if (seqSel && seqSel.kind === 'participant') next = ms.find((m) => m.from === seqSel.id || m.to === seqSel.id) || ms[0];
          else next = dir > 0 ? ms[0] : ms[ms.length - 1];
          select('message', next.id);
          panIntoView(seqHtml.querySelector(`.seq-msg-label[data-edge-id="${next.id}"]`));
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (!ps.length || e.altKey) return;
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          let next;
          if (seqSel && seqSel.kind === 'participant') { const i = ps.findIndex((p) => p.id === seqSel.id); next = ps[Math.max(0, Math.min(ps.length - 1, i + dir))]; }
          else if (seqSel && seqSel.kind === 'message') { const m = msgById(seqSel.id); next = partById(dir < 0 ? m.from : m.to); }
          else next = dir > 0 ? ps[0] : ps[ps.length - 1];
          if (!next) return;
          select('participant', next.id);
          panIntoView(seqHtml.querySelector(`.seq-participant[data-node-id="${next.id}"]`));
        }
      });

      // --- DISK FORMAT (the page's data block) ---
      // No positions are saved: render() lays out whatever is missing, so the block holds only the logical model,
      // in a fixed key order. scripts/disk_format.py is the Python twin: keep the two byte-identical.
      // fromDisk is not needed (the block is the model minus positions).
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'numbered', 'showDetails', 'rails', 'lifespans', 'participants', 'messages', 'fragments', 'notes'];
      // Engine output, never saved: positions, hidden (inside a collapsed frame), frame dividers, note boxes
      const DISK_LAYOUT = [['participants', ['x', 'rail', 'top', 'bottom']], ['messages', ['y', 'hidden']], ['fragments', ['x', 'y', 'w', 'h', 'elseY', 'dividers']], ['notes', ['x', 'y', 'w', 'h']]];
      // Ids made in the page are renamed on save so the file stays readable to an agent: m<next free number>,
      // p_<name slug>, f<N>, n<N>; every reference follows. Ids an author chose are never touched.
      const GENERATED_ID = /^(p|m|f|n)_\d{12,}(_\d+)?$/;
      function slug(text, sep = '_') {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
        if (s.length > 30) s = s.slice(0, 30).replace(new RegExp(`${sep}+$`), '');
        return s;
      }
      function renameGeneratedIds(d) {
        const ps = d.participants || [], ms = d.messages || [], fs = d.fragments || [], ns = d.notes || [];
        const used = new Set([...ps, ...ms, ...fs, ...ns].map((o) => o.id));
        const rename = new Map();
        const take = (base) => {
          let id = base, k = 2;
          while (used.has(id)) id = `${base}_${k++}`;
          used.add(id);
          return id;
        };
        const numbered = (list, prefix) => {
          let count = 1;
          list.forEach((o) => {
            if (!GENERATED_ID.test(String(o.id || ''))) return;
            while (used.has(`${prefix}${count}`)) count++;
            rename.set(o.id, take(`${prefix}${count}`));
          });
        };
        ps.forEach((p) => { if (GENERATED_ID.test(String(p.id || ''))) rename.set(p.id, take('p_' + (slug(p.name) || 'participant'))); });
        numbered(ms, 'm');
        numbered(fs, 'f');
        numbered(ns, 'n');
        if (!rename.size) return;
        const r = (id) => (rename.has(id) ? rename.get(id) : id);
        [...ps, ...ms, ...fs, ...ns].forEach((o) => { o.id = r(o.id); });
        ms.forEach((m) => ['from', 'to'].forEach((k) => { if (k in m) m[k] = r(m[k]); }));
        fs.forEach((f) => {
          ['from', 'to', 'elseAt'].forEach((k) => { if (k in f) f[k] = r(f[k]); });
          if (Array.isArray(f.branches)) f.branches.forEach((b) => { if ('at' in b) b.at = r(b.at); });
        });
        ns.forEach((n) => {
          if (Array.isArray(n.over)) n.over = n.over.map(r); else if ('over' in n) n.over = r(n.over);
          ['after', 'before'].forEach((k) => { if (k in n) n[k] = r(n[k]); });
        });
      }
      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        delete d.layout;   // canvas size, derived by the engine
        renameGeneratedIds(d);
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
          if (closeConfirm()) return true;
          if (!seqDrag) return false;
          endSeqDrag();
          render();
          return true;
        },
        hasSelection: () => !!seqSel,
        onViewChange() { closeConfirm(); pinParticipants(); },
        deleteSelection
      });
