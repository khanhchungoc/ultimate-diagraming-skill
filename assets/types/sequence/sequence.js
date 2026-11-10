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

      // Activation bars: a call (sync) opens a bar on its target until the matching reply.
      function seqActivations() {
        const ms = chartData.messages, bars = [];
        ms.forEach((m, i) => {
          if (m.kind !== 'sync' || m.from === m.to) return;
          for (let j = i + 1; j < ms.length; j++) {
            const r = ms[j];
            if (r.kind === 'reply' && r.from === m.to && r.to === m.from) {
              bars.push({ pid: m.to, y1: m.y - 6, y2: r.y + 6 });
              break;
            }
          }
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

      function render() {
        ensureModel();
        const ps = chartData.participants, ms = chartData.messages, fs = chartData.fragments;
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

        // Fragments (behind everything else)
        fs.forEach((f) => {
          if (f.x === undefined) return;
          seqFragG.appendChild(svgEl('rect', { class: 'seq-frag-box', x: f.x, y: f.y, width: f.w, height: f.h, rx: 6, 'data-frag-id': f.id }));
          const tag = htmlEl('div', 'seq-frag-label', { left: px(f.x), top: px(f.y) });
          tag.dataset.fragId = f.id;
          const kind = htmlEl('span', 'seq-frag-kind');
          kind.textContent = f.kind;
          const text = htmlEl('span', 'seq-frag-text');
          text.textContent = f.label || 'condition';
          tag.appendChild(kind);
          tag.appendChild(text);
          seqHtml.appendChild(tag);
          if (f.elseY !== undefined) {
            seqFragG.appendChild(svgEl('line', { class: 'seq-frag-else', x1: f.x, x2: f.x + f.w, y1: f.elseY, y2: f.elseY }));
            const el = htmlEl('div', 'seq-frag-else-label', { left: px(f.x + f.w - 10), top: px(f.elseY + 3), transform: 'translateX(-100%)' });
            el.textContent = 'else';
            seqHtml.appendChild(el);
          }
        });

        // Lifelines and participant boxes
        ps.forEach((p) => {
          seqLifeG.appendChild(svgEl('line', { class: 'seq-lifeline', x1: p.x, x2: p.x, y1: SQ.TOP + SQ.BOX_H, y2: L.height - 24 }));
          const box = htmlEl('div', `seq-participant${p.kind === 'actor' ? ' is-actor' : ''}`, { left: px(p.x - SQ.BOX_W / 2), top: px(SQ.TOP) });
          box.dataset.nodeId = p.id;
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
          seqActG.appendChild(svgEl('rect', { class: 'seq-activation', x: p.x - ACT_HALF + b.depth * ACT_STEP, y: b.y1, width: ACT_HALF * 2, height: b.y2 - b.y1, rx: 2 }));
        });
        const activeDepth = (pid, y) => bars.reduce((mx, b) => (b.pid === pid && b.y1 <= y && y <= b.y2 ? Math.max(mx, b.depth) : mx), -1);
        const edgeX = (p, y, dir) => {
          const d = activeDepth(p.id, y);
          return d < 0 ? p.x : p.x + dir * (ACT_HALF + d * ACT_STEP);
        };

        // Messages
        ms.forEach((m) => {
          const a = byId[m.from], b = byId[m.to];
          if (!a || !b) return;
          const self = a === b;
          let d, labelStyle;
          if (self) {
            const xs = edgeX(a, m.y, 1), xe = edgeX(a, m.y + 28, 1);
            d = `M ${xs} ${m.y} H ${xs + SQ.SELF_LOOP} V ${m.y + 28} H ${xe}`;
            labelStyle = { left: px(xs + SQ.SELF_LOOP + 8), top: px(m.y + 4) };
          } else {
            const dir = b.x > a.x ? 1 : -1;
            const x1 = edgeX(a, m.y, dir), x2 = edgeX(b, m.y, -dir);
            d = `M ${x1} ${m.y} H ${x2}`;
            labelStyle = { left: px((x1 + x2) / 2), top: px(m.y - 26), transform: 'translateX(-50%)' };
          }
          const marker = m.kind === 'sync' ? 'url(#seq-arrow-solid)' : 'url(#seq-arrow-open)';
          seqMsgG.appendChild(svgEl('path', { class: `seq-line${m.kind === 'reply' ? ' is-reply' : ''}`, d, 'marker-end': marker, 'data-edge-id': m.id }));
          seqMsgG.appendChild(svgEl('path', { class: 'seq-msg-hit', d, 'data-edge-id': m.id }));
          const label = htmlEl('div', `seq-msg-label${self ? ' is-self' : ''}`, labelStyle);
          label.dataset.edgeId = m.id;
          const text = htmlEl('span', 'seq-msg-label-text');
          text.textContent = m.label || '';
          label.appendChild(text);
          seqHtml.appendChild(label);
        });
        applySelection();
      }

      function applySelection() {
        const sel = seqSel || {};
        document.querySelectorAll('.seq-participant').forEach((el) => el.classList.toggle('selected', sel.kind === 'participant' && el.dataset.nodeId === sel.id));
        document.querySelectorAll('.seq-msg-label, .seq-line').forEach((el) => el.classList.toggle('selected', sel.kind === 'message' && el.dataset.edgeId === sel.id));
        document.querySelectorAll('.seq-frag-label, .seq-frag-box').forEach((el) => el.classList.toggle('selected', sel.kind === 'fragment' && el.dataset.fragId === sel.id));
      }

      function select(kind, id) {
        seqSel = kind ? { kind, id } : null;
        applySelection();
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
        if (!drag || !drag.moved || !drag.target) { render(); return; }
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

      // --- INLINE TEXT EDITING (double-click) ---
      seqHtml.addEventListener('dblclick', (e) => {
        if (document.body.classList.contains('presentation')) return;
        const el = e.target.closest('.seq-participant-name, .seq-msg-label-text, .seq-frag-text');
        if (!el) return;
        e.stopPropagation();
        el.contentEditable = 'true';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        const commit = () => {
          el.removeEventListener('blur', commit);
          el.contentEditable = 'false';
          const value = el.textContent.trim();
          const owner = el.closest('[data-node-id], [data-edge-id], [data-frag-id]');
          let changed = false;
          if (value && owner) {
            if (owner.dataset.nodeId) { const p = chartData.participants.find((x) => x.id === owner.dataset.nodeId); if (p && p.name !== value) { p.name = value; changed = true; } }
            else if (owner.dataset.edgeId) { const m = chartData.messages.find((x) => x.id === owner.dataset.edgeId); if (m && m.label !== value) { m.label = value; changed = true; } }
            else if (owner.dataset.fragId) { const f = chartData.fragments.find((x) => x.id === owner.dataset.fragId); if (f && f.label !== value) { f.label = value; changed = true; } }
          }
          if (changed) relayout(); else render();
        };
        el.addEventListener('blur', commit);
        el.addEventListener('keydown', (ke) => { if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); } });
      });

      seqHtml.addEventListener('pointerdown', onSeqPointerDown);
      seqSvg.addEventListener('pointerdown', onSeqPointerDown);

      // --- EDITS ---
      function removeMessages(ids) {
        const gone = new Set(ids);
        const order = chartData.messages.map((m) => m.id);
        const survivor = (id, dir) => {
          let i = order.indexOf(id);
          while (i >= 0 && i < order.length && gone.has(order[i])) i += dir;
          return i >= 0 && i < order.length ? order[i] : null;
        };
        chartData.fragments = chartData.fragments.filter((f) => {
          const from = survivor(f.from, 1), to = survivor(f.to, -1);
          if (!from || !to || order.indexOf(from) > order.indexOf(to)) return false;
          f.from = from;
          f.to = to;
          if (f.elseAt !== undefined) {
            const e = survivor(f.elseAt, 1);
            if (e && order.indexOf(e) > order.indexOf(from) && order.indexOf(e) <= order.indexOf(to)) f.elseAt = e; else delete f.elseAt;
          }
          return true;
        });
        chartData.messages = chartData.messages.filter((m) => !gone.has(m.id));
      }

      function deleteSelection() {
        if (!seqSel) return;
        if (seqSel.kind === 'participant') {
          const id = seqSel.id;
          removeMessages(chartData.messages.filter((m) => m.from === id || m.to === id).map((m) => m.id));
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
        seqSel = { kind: 'participant', id: p.id };
        relayout();
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
        seqSel = { kind: 'message', id: m.id };
        relayout();
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
        seqSel = { kind: 'fragment', id: f.id };
        relayout();
      });

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'sequence',
        defaultTitle: 'Interactive Sequence Diagram',
        contentEl: seqCanvas,
        report: { node: '.seq-participant', label: '.seq-msg-label', labelText: '.seq-msg-label-text', nodeText: '.seq-participant-name' },
        render,
        isBackground: (el) => el === seqCanvas || el === seqSvg || el === seqHtml,
        clearSelection() { select(null); },
        cancelInteraction() {
          if (!seqDrag) return false;
          endSeqDrag();
          render();
          return true;
        },
        hasSelection: () => !!seqSel,
        deleteSelection
      });
