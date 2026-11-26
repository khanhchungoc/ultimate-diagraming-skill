      const NODE_WIDTH = 144;
      const NODE_HEIGHT = 64;
      const DECISION_WIDTH = 144;
      const DECISION_HEIGHT = 96;
      // Lane sizes come from the engine's LE (LANE_MIN, BOTTOM_PAD), which follows the diagram's direction
      // Lane colours by position for lanes without their own "color": the shell's SWATCHES (shell.js), in order

      // --- DIRECTION ---
      // "direction": "TB" draws the diagram top-to-bottom: lanes become columns and steps run downwards. Node data
      // is always kept in flow terms (see engine.js LE_PROFILES): n.x runs along the flow from the start of the lane
      // track and n.y across the lane from its edge. In a left-to-right diagram those are the screen's x and y; in a
      // top-to-bottom one, n.x is the screen y and n.y the screen x. Every node takes a 96px slot along the flow
      // (a decision's height), and a 64px step is centred in it so steps and decisions line up on one axis.
      const isTB = () => chartData.direction === 'TB';
      // An on-page connector (engine.js CONN) is a CONN.SIZE circle at its own x/y, not a slot with an offset
      const nodeScreenH = (n) => (isConnector(n) ? CONN.SIZE : n.type === 'decision' ? DECISION_HEIGHT : NODE_HEIGHT);
      const flowInset = (n) => (isTB() && !isConnector(n) ? (DECISION_HEIGHT - nodeScreenH(n)) / 2 : 0);
      // A node's extent across its lane (lane sizing, lane hit tests) and along the flow (snapping)
      const crossSize = (n) => (isConnector(n) ? CONN.SIZE : isTB() ? NODE_WIDTH : nodeScreenH(n));
      const flowSize = (n, el) => (isConnector(n) ? CONN.SIZE : isTB() ? DECISION_HEIGHT : ((el && el.offsetWidth) || NODE_WIDTH));
      function nodePos(n) {
        if (isConnector(n)) return { left: (isTB() ? n.y : n.x) || 0, top: (isTB() ? n.x : n.y) || 0 };
        if (isTB()) return { left: n.y || 0, top: (n.x || 0) + flowInset(n) };
        return { left: n.x || 80, top: n.y || 53 };
      }
      function placeNodeEl(el, n) {
        const p = nodePos(n);
        el.style.left = `${p.left}px`;
        el.style.top = `${p.top}px`;
        el.style.translate = '';
        el.style.scale = '';
      }
      // Pointer position in flow terms: gx along the flow from the start of the lane tracks, gy across the lanes from
      // the container's edge (so gy - laneTopOf(lane) is a node's n.y)
      function trackOffset() {
        const track = lanesRoot.querySelector('.lane-track');
        if (!track) return 0;
        const sr = swimlanesContainer.getBoundingClientRect(), tr = track.getBoundingClientRect();
        return (isTB() ? tr.top - sr.top : tr.left - sr.left) / scale;
      }
      function flowPoint(clientX, clientY) {
        const sr = swimlanesContainer.getBoundingClientRect();
        const x = (clientX - sr.left) / scale, y = (clientY - sr.top) / scale;
        return isTB() ? { gx: y - trackOffset(), gy: x } : { gx: x - trackOffset(), gy: y };
      }
      // Flow coordinates -> container coordinates (where an overlay such as a snap guide is drawn)
      function flowToContainer(gx, gy) {
        return isTB() ? { x: gy, y: trackOffset() + gx } : { x: trackOffset() + gx, y: gy };
      }

      // --- MOTION HELPERS (Phase 2) ---
      const FLOW_SPECS = [
        { selector: '.swimlane[data-lane-id]', key: 'laneId', mode: 'pos' },
        { selector: '.flow-node[data-node-id]', key: 'nodeId', mode: 'size' },
        { selector: '.edge-label[data-edge-id]', key: 'edgeId', mode: 'pos' },
        { selector: '.note[data-note-id]', key: 'noteId', mode: 'pos' }
      ];
      const TAB_SPECS = [
        { selector: '.flow-subtabs[data-level]', key: 'level', mode: 'clip' },
        { selector: '.flow-tab[data-tab]', key: 'tab', mode: 'pos' }
      ];
      const coordsDiffer = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.5);
      const freeNoteSkipKeys = () => new Set(notesList().filter(isFree).map(n => n.id));
      let motionDepth = 0;
      let tabGlide = false;

      function captureSvg() {
        const edges = new Map(), leaders = new Map();
        edgeGroup.querySelectorAll('.edge-line[data-edge-id]').forEach(el => {
          const pts = lastRoutes[el.dataset.edgeId]?.points;
          if (pts && pts.length >= 2) edges.set(el.dataset.edgeId, pts.flat());
        });
        noteLeaderGroup.querySelectorAll('.note-leader').forEach(el => {
          if (!el.classList.contains('show') && !el.classList.contains('peek')) return;
          leaders.set(`${el.dataset.noteId}:${el.dataset.nodeId}`, [+el.getAttribute('x1'), +el.getAttribute('y1'), +el.getAttribute('x2'), +el.getAttribute('y2')]);
        });
        return { edges, leaders };
      }

      function playSvg(svgSnap, opts) {
        if (!svgSnap) return;
        const tracks = [], finalDs = [];
        const dur = opts.duration, eas = opts.easing;
        edgeGroup.querySelectorAll('.edge-line[data-edge-id]').forEach(el => {
          const id = el.dataset.edgeId, pts = lastRoutes[id]?.points;
          const newPts = pts && pts.length >= 2 ? pts.flat() : null;
          if (opts.forceDrawEdges || !svgSnap.edges.has(id) || (opts.drawEdges && opts.drawEdges.has(id))) {
            motion.drawPath(el, { duration: opts.drawDuration ?? 140, easing: 'curve-out' });
          } else if (newPts) {
            const oldPts = svgSnap.edges.get(id);
            if (coordsDiffer(oldPts, newPts)) {
              finalDs.push([el, el.getAttribute('d')]);
              tracks.push({ type: 'polyline', el, from: oldPts, to: newPts });
            }
          }
        });
        noteLeaderGroup.querySelectorAll('.note-leader').forEach(el => {
          if (!el.classList.contains('show') && !el.classList.contains('peek')) return;
          const k = `${el.dataset.noteId}:${el.dataset.nodeId}`;
          const to = [+el.getAttribute('x1'), +el.getAttribute('y1'), +el.getAttribute('x2'), +el.getAttribute('y2')];
          const from = svgSnap.leaders.get(k);
          if (from && coordsDiffer(from, to)) tracks.push({ type: 'line', el, from, to });
          else if (!from && opts.drawNewLeaders) motion.drawPath(el, { duration: 150, easing: 'curve-out' });
        });
        if (tracks.length) {
          motion.tweenSvg(tracks, {
            duration: dur, easing: eas,
            onComplete: () => { for (const [el, d] of finalDs) if (el.isConnected) el.setAttribute('d', d); }
          });
        }
      }

      function retractSvgLine(pathEl) {
        if (!pathEl || !motion.enabled() || typeof pathEl.getTotalLength !== 'function') return;
        const len = pathEl.getTotalLength(), svgRoot = document.getElementById('connector-svg');
        if (!len || !svgRoot) return;
        const sr = svgRoot.getBoundingClientRect();
        if (!sr.width || !sr.height) return;
        const wrap = document.createElementNS(SVG_NS, 'svg');
        wrap.setAttribute('data-motion-ghost', '');
        wrap.setAttribute('data-export-skip', '');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.cssText = `position:fixed;left:${sr.left}px;top:${sr.top}px;width:${sr.width}px;height:${sr.height}px;overflow:visible;pointer-events:none;z-index:2200;`;
        wrap.setAttribute('viewBox', `0 0 ${svgRoot.clientWidth || sr.width / scale} ${svgRoot.clientHeight || sr.height / scale}`);
        const clone = pathEl.cloneNode(false);
        clone.removeAttribute('id'); clone.removeAttribute('class');
        const cs = getComputedStyle(pathEl);
        clone.setAttribute('fill', 'none');
        clone.setAttribute('stroke', cs.stroke || 'var(--primary)');
        clone.setAttribute('stroke-width', cs.strokeWidth || '2');
        clone.style.strokeDasharray = `${len} ${len}`;
        wrap.appendChild(clone);
        document.body.appendChild(wrap);
        const anim = motion.anim(clone, [{ strokeDashoffset: 0, opacity: 1 }, { strokeDashoffset: -len, opacity: 0.2 }], {
          duration: Math.max(40, Math.round(100 * motion.speedScale())), easing: motion.curve('curve-in')
        });
        const drop = () => wrap.remove();
        if (anim) { anim.addEventListener('finish', drop, { once: true }); anim.addEventListener('cancel', drop, { once: true }); } else wrap.remove();
      }

      function withTabMotion(fn) {
        if (!motion.enabled()) { fn(); return; }
        const wasShown = !flowTabs.hidden;
        const tabSnap = wasShown ? motion.capture(flowTabs, TAB_SPECS, { ghosts: true }) : null;
        fn();
        if (flowTabs.hidden) return;
        if (!wasShown) {
          flowTabs.style.transformOrigin = 'top left';
          motion.anim(flowTabs, [
            { transform: 'translateY(-6px) scale(0.96)', clipPath: 'inset(0 100% 0 0 round var(--radius-lg))' },
            { transform: 'none', clipPath: 'inset(0 0 0 0 round var(--radius-lg))' }
          ], { duration: motion.dur('dur-base', 180), easing: motion.curve('curve-spring-tactile') });
          return;
        }
        if (tabSnap) {
          flowTabs.querySelectorAll('.flow-subtabs[data-level]').forEach(box => {
            const prevB = tabSnap.get('0:' + box.dataset.level);
            if (!prevB) {
              motion.anim(box, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], {
                duration: motion.dur('dur-base', 180), easing: motion.curve('curve-spring-settle')
              });
              return;
            }
            const vr = box.getBoundingClientRect();
            const ldx = prevB.x - vr.left, ldy = prevB.y - vr.top;
            if (Math.abs(ldx) <= 0.5 && Math.abs(ldy) <= 0.5) return;
            box.querySelectorAll('.flow-tab[data-tab]').forEach(t => {
              const prevT = tabSnap.get('1:' + t.dataset.tab);
              if (prevT) { prevT.x -= ldx; prevT.y -= ldy; }
            });
          });
          motion.play(tabSnap, flowTabs, TAB_SPECS, { duration: motion.dur('dur-tab', 300), easing: 'curve-inout', ghostExit: true });
        }
      }

      function withConnectorMotion(fn, opts) {
        if (!motion.enabled() || motionDepth > 0) { fn(); return; }
        const prevConns = new Map();
        document.querySelectorAll('.flow-node.type-connector[data-node-id]').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0) prevConns.set(el.dataset.nodeId, r);
        });
        withMotion(fn, { ...(opts || {}), skipKeys: new Set(prevConns.keys()) });
        document.querySelectorAll('.flow-node.type-connector[data-node-id]').forEach(el => {
          const pr = prevConns.get(el.dataset.nodeId);
          if (pr) motion.ghostMorph(pr, el, 180, 'curve-spring-settle');
        });
      }

      // Runs fn with every nested withMotion / withConnectorMotion turned into a plain call
      function withoutMotion(fn) { motionDepth++; try { fn(); } finally { motionDepth--; } }

      function withMotion(fn, opts) {
        const o = opts || {};
        if (motionDepth > 0 || !motion.enabled()) { fn(); return; }
        motionDepth++;
        try {
          const snap = motion.capture(swimlanesContainer, FLOW_SPECS, o.ghosts ? { ghosts: true } : undefined);
          const svgSnap = captureSvg();
          withTabMotion(fn);
          if (snap) {
            const st = stage.getBoundingClientRect();
            const k = (stage.offsetWidth ? st.width / stage.offsetWidth : scale) || 1;
            const laneShift = new Map();
            lanesRoot.querySelectorAll('.swimlane[data-lane-id]').forEach(laneEl => {
              const prevL = snap.get('0:' + laneEl.dataset.laneId);
              if (!prevL) return;
              const vr = laneEl.getBoundingClientRect();
              const ldx = prevL.x - (vr.left - st.left) / k;
              const ldy = prevL.y - (vr.top - st.top) / k;
              if (Math.abs(ldx) <= 0.5 && Math.abs(ldy) <= 0.5) return;
              laneShift.set(laneEl, { ldx, ldy });
              laneEl.querySelectorAll('.flow-node[data-node-id]').forEach(nEl => {
                const prevN = snap.get('1:' + nEl.dataset.nodeId);
                if (prevN) { prevN.x -= ldx; prevN.y -= ldy; }
              });
            });
            let skipKeys = o.skipKeys;
            if (o.skipFreeNotes) {
              const free = freeNoteSkipKeys();
              if (free.size) skipKeys = skipKeys ? new Set([...skipKeys, ...free]) : free;
            }
            motion.play(snap, swimlanesContainer, FLOW_SPECS, { ...o, skipKeys });
            if (laneShift.size && (o.fromKey || o.originRect)) {
              // Counteract parent lane shift for entering nodes that morph from a stage-space rect/fromKey
              const durMs = Math.max(40, Math.round((o.duration ?? motion.dur('dur-layout', 230)) * motion.speedScale()));
              const eas = motion.curve(o.easing || 'curve-spring-settle');
              laneShift.forEach(({ ldx, ldy }, laneEl) => {
                laneEl.querySelectorAll('.flow-node[data-node-id]').forEach(nEl => {
                  if (snap.has('1:' + nEl.dataset.nodeId)) return;
                  const anims = nEl.getAnimations();
                  if (anims.length) {
                    const kf = anims[0].effect && anims[0].effect.getKeyframes && anims[0].effect.getKeyframes();
                    if (kf && kf[0] && kf[0].transform && kf[0].transform !== 'none') {
                      const prevT = kf[0].transform;
                      anims[0].cancel();
                      motion.anim(nEl, [{ transform: `translate(${-ldx}px, ${-ldy}px) ${prevT}` }, { transform: 'none' }], { duration: durMs, easing: eas });
                    }
                  }
                });
              });
            }
          }
          playSvg(svgSnap, o);
        } finally {
          motionDepth--;
        }
      }

      // --- STATE & INITIALIZATION ---

      let selectedNodeId = null;         // the primary step: the one clicked last (notes, the N key, the Shift+click anchor)
      let selectedNodeIds = new Set();   // every selected step (see MULTI-SELECT); always contains selectedNodeId
      let selectedEdgeId = null;
      let selectedLaneId = null;   // a lane selected by clicking its name pill (Delete removes it)
      let hoveredNodeId = null;

      // Node Drag state
      let draggingNode = null;
      let dragEdgeFrame = 0;   // pending requestAnimationFrame for edge re-routing while dragging
      let dragMoved = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartGlobalX = 0;
      let dragStartGlobalY = 0;
      let autoLayout = true;   // see AUTO LAYOUT: always on for now (the button is hidden), so a saved 'off' is not read
      let dragCanInsert = false;   // the dragged node has no arrows, so it may be dropped into one
      let dragGroup = null;        // the other selected steps moving with draggingNode: [{ node, x, gy, lane }]
      let dragOrigin = null;       // where the drag started: { x, gy, lane, saved: [{ node, x, y, laneId }] }

      // Edge Connecting state
      let connectingFromNodeId = null;
      let connectingFromPort = null;
      let connectingDownAt = null;       // where the anchor was pressed: a release close to it is a click, not a drag
      let connectingStartPoint = null;

      // Last computed arrow routes (renderEdges), and the arrow a dragged node would be inserted into
      let lastRoutes = {};
      let insertTarget = null;   // { edgeId, x, y } in container coords, or null

      // Dragging a new shape out of the bottom dock
      let paletteDrag = null;    // { type, ghost, startX, startY, moved, placement }

// Elements
      const swimlanesContainer = document.getElementById('swimlanes-container');
      const lanesRoot = document.getElementById('lanes-root');
      const edgeGroup = document.getElementById('edge-group');
      const edgeLabelsGroup = document.getElementById('edge-labels-group');
      const dragEdge = document.getElementById('drag-edge');
      const btnAddLane = document.getElementById('btn-add-lane');
      const btnDirection = document.getElementById('btn-direction');

      // --- RENDERING ---
      function render() {
        pruneNotes();
        pruneNodeSelection();   // an undo/redo may have removed a selected step
        const noLanes = chartData.swimlanes === false;
        if (noLanes) normalizeSwimlanes(chartData);
        swimlanesContainer.classList.toggle('no-swimlanes', noLanes);
        updateLaneButton();
        useDirection(chartData);
        const tb = isTB();
        swimlanesContainer.classList.toggle('dir-tb', tb);
        updateDirectionButton();

        // Length of the lane tracks along the flow: a margin past the furthest node, and a small minimum so an empty diagram still has room
        const maxX = chartData.nodes.reduce((m, n) => Math.max(m, (n.x || 0) + (tb ? DECISION_HEIGHT : NODE_WIDTH) + 48), tb ? 360 : 560);

        renderLanes(maxX);   // also sizes the pill gutter (--lane-gutter)
        const along = `${maxX + 4 + (parseFloat(swimlanesContainer.style.getPropertyValue('--lane-gutter')) || 0)}px`;
        swimlanesContainer.style.minWidth = tb ? '' : along;
        swimlanesContainer.style.minHeight = tb ? along : '';
        renderNodes();
        renderEdges();
        // The last lane has no neighbour beyond it, so loop-backs that run around its nodes (and their labels)
        // can reach its outer edge. Grow it on that side until they are OUTER_CLEAR inside. Measured against the
        // lane without the extra, so it shrinks back; it only re-renders when the needed room changed.
        const need = outerReach();
        if (need !== outerExtra) {
          const delta = need - outerExtra;
          outerExtra = need;
          const lastLaneEl = lanesRoot.lastElementChild;
          const lastLane = chartData.lanes[chartData.lanes.length - 1];
          if (lastLaneEl && lastLane) {
            lastLane.height += delta;
            if (tb) {
              lastLaneEl.style.minWidth = `${lastLane.height}px`;
              lastLaneEl.style.width = `${lastLane.height}px`;
            } else {
              lastLaneEl.style.minHeight = `${lastLane.height}px`;
              lastLaneEl.style.height = `${lastLane.height}px`;
            }
            lanePinCache = null;
          } else {
            renderLanes(maxX);
            renderNodes();
            renderEdges();
          }
        }
        renderNotes(true);   // last: notes are fitted around the final nodes, arrows and labels
        pinLaneHeaders();
        renderTabs();
        followTab();
        updateSubButtons();
        syncNodeBar();
      }

      const OUTER_CLEAR = 16;   // px between the outermost arrow/label and the last lane's outer edge
      let outerExtra = 0;       // px added to the last lane's outer side (renderer only, never shifts a node)
      function outerReach() {
        const last = lanesRoot.lastElementChild;
        if (!last || chartData.swimlanes === false) return 0;
        const tb = isTB(), lr = last.getBoundingClientRect();
        const s = lr.width / last.offsetWidth || 1;   // current zoom
        let reach = -Infinity;
        const take = el => { const r = el.getBoundingClientRect(); if (r.width || r.height) reach = Math.max(reach, tb ? r.right : r.bottom); };
        edgeGroup.querySelectorAll('.edge-line').forEach(take);
        edgeLabelsGroup.querySelectorAll('.edge-label.has-label').forEach(take);
        if (reach === -Infinity) return 0;
        const base = (tb ? lr.right : lr.bottom) - outerExtra * s;   // outer edge without the extra
        const need = (reach - base) / s + OUTER_CLEAR;
        return need > 0 ? Math.ceil(need / 4) * 4 : 0;
      }

      // --- LANE HOVER ---
      // The lane under the pointer gets a wash, by pointer Y rather than CSS :hover, so it stays lit while the
      // pointer crosses arrows and edge labels (they live in overlays above the lanes, not inside them).
      let hoverLaneEl = null;
      function setHoverLane(el) {
        if (el === hoverLaneEl) return;
        if (hoverLaneEl) hoverLaneEl.classList.remove('lane-hover');
        hoverLaneEl = el;
        if (el) el.classList.add('lane-hover');
      }
      swimlanesContainer.addEventListener('pointermove', (e) => {
        const tb = isTB();
        const lane = [...lanesRoot.children].find(l => {
          const r = l.getBoundingClientRect();
          return tb ? e.clientX >= r.left && e.clientX < r.right : e.clientY >= r.top && e.clientY < r.bottom;
        });
        setHoverLane(lane || null);
      });
      swimlanesContainer.addEventListener('pointerleave', () => setHoverLane(null));

      // --- LANE NAME PILLS ---
      // Each lane is labelled by a pill (icon + name) at the visible top-left of the lane, with a lane-colour
      // stripe at the visible left edge. They follow the view: when the canvas is panned right they stay at the
      // viewport's left edge, and the pill follows a lane taller than the screen. The pill scales with the diagram
      // exactly like a node, so the lane gutter (sizeLaneGutter) keeps it clear of every node at any zoom. Called
      // after every render and, via plugin.onViewChange, after every pan/zoom.
      const PILL_INSET = 12;     // diagram px from the visible left edge / the lane's visible top
      let lanePinCache = null;
      let lastPinScale = null;
      window.addEventListener('resize', () => { lanePinCache = null; });
      function pinLaneHeaders() {
        if (chartData.swimlanes === false) { swimlanesContainer.classList.remove('lanes-pinned'); return; }
        const tb = isTB();
        if (!lanePinCache) {
          const left = swimlanesContainer.offsetLeft + swimlanesContainer.clientLeft;
          const top = swimlanesContainer.offsetTop + swimlanesContainer.clientTop;
          const vpW = viewport.clientWidth;
          const lanes = [];
          lanesRoot.querySelectorAll('.swimlane').forEach(laneEl => {
            const pill = laneEl.querySelector('.lane-pill');
            if (!pill) return;
            lanes.push({
              laneEl,
              offsetLeft: laneEl.offsetLeft,
              offsetTop: laneEl.offsetTop,
              w: laneEl.offsetWidth,
              h: laneEl.offsetHeight,
              pw: pill.offsetWidth,
              ph: pill.offsetHeight
            });
          });
          if (tb) {
            for (let i = 0; i < lanes.length; i++) {
              const l = lanes[i];
              l.laneEl.style.setProperty('--pill-cx', `${Math.max(PILL_INSET, (l.w - l.pw) / 2)}px`);   // centred at rest (exports)
            }
          }
          lanePinCache = { left, top, vpW, lanes };
        }
        const { left, top, vpW, lanes } = lanePinCache;
        const visLeft = -panX / scale - left;   // viewport's left edge in container coords
        const visTop = -panY / scale - top;
        const inset = PILL_INSET;
        const topSafe = ui.chromeTop ? ui.chromeTop() / scale : 0;
        const safeTop = visTop + topSafe;
        const cs = swimlanesContainer.style;
        if (scale !== lastPinScale) {
          lastPinScale = scale;
          cs.setProperty('--rail-b', `${3 / scale}px`);
        }
        if (tb) {
          // Top-to-bottom: lanes are columns, so the stripe and the pills sit at the visible top edge instead,
          // and each pill follows its column sideways when the column is wider than the screen
          const y0 = Math.max(0, visTop);
          const maxPillY = lanes.length ? Math.max(inset, Math.min(...lanes.map(l => l.h - l.ph - inset))) : inset;
          const pillY = Math.min(Math.max(inset, safeTop + inset), maxPillY);
          swimlanesContainer.classList.toggle('lanes-pinned', visTop > 0);
          cs.removeProperty('--rail-x');
          cs.removeProperty('--pill-x');
          cs.setProperty('--rail-y', `${y0}px`);
          cs.setProperty('--pill-y', `${pillY}px`);
          // Each pill is centred on the visible part of its column (the whole column when it is on screen)
          const visRight = visLeft + vpW / scale;
          for (let i = 0; i < lanes.length; i++) {
            const l = lanes[i];
            const a = Math.max(0, visLeft - l.offsetLeft), b = Math.min(l.w, visRight - l.offsetLeft);
            const maxX = Math.max(inset, l.w - l.pw - inset);
            const x = Math.min(Math.max(b > a ? (a + b - l.pw) / 2 : (l.w - l.pw) / 2, inset), maxX);
            l.laneEl.style.setProperty('--pill-x', `${x}px`);
          }
          placeLaneBar();
          return;
        }
        const x0 = Math.max(0, visLeft);       // visible left edge of the lanes
        swimlanesContainer.classList.toggle('lanes-pinned', visLeft > 0);
        cs.removeProperty('--rail-y');
        cs.removeProperty('--pill-y');
        cs.setProperty('--rail-x', `${x0}px`);
        cs.setProperty('--pill-x', `${x0 + inset}px`);
        for (let i = 0; i < lanes.length; i++) {
          const l = lanes[i];
          const maxY = Math.max(inset, l.h - l.ph - inset);
          const y = Math.min(Math.max(safeTop - l.offsetTop + inset, inset), maxY);
          l.laneEl.style.setProperty('--pill-y', `${y}px`);
        }
        placeLaneBar();
      }

      // The selected lane's bar sits over its pill, or under it when the pill is near the top of the window
      function placeLaneBar() {
        const bar = lanesRoot.querySelector('.lane-selected .lane-bar');
        if (!bar) return;
        const pill = bar.parentElement;
        bar.classList.toggle('is-below', !ui.roomAbove(pill, bar));
      }
      // A lane's colour: a palette slot, or '' for none (the colour for its position). One undo step.
      function setLaneColor(laneId, slot) {
        const lane = chartData.lanes.find(l => l.id === laneId);
        if (!lane || (lane.color || '') === slot) return;
        if (slot) lane.color = slot; else delete lane.color;
        render();
        updateStatus(true);
      }
      // Moves a lane one place (-1 earlier, +1 later), like dragging its pill there
      function moveLane(index, dir) {
        const to = index + dir;
        if (to < 0 || to >= chartData.lanes.length) return;
        withMotion(() => {
          const [moved] = chartData.lanes.splice(index, 1);
          chartData.lanes.splice(to, 0, moved);
          relayout();   // lane order changes how steps are ordered and where loop-backs run
        }, { duration: 210, skipFreeNotes: true });
      }

      function renderLanes(trackWidth) {
        lanePinCache = null;
        lastPinScale = null;
        const hoverIdx = hoverLaneEl ? [...lanesRoot.children].indexOf(hoverLaneEl) : -1;
        hoverLaneEl = null;
        lanesRoot.innerHTML = '';
        const xById = {};
        chartData.nodes.forEach(n => { xById[n.id] = n.x || 0; });
        chartData.lanes.forEach((lane, index) => {
          // Dynamically calculate required lane height from nodes in this lane
          const laneNodes = chartData.nodes.filter(n => n.laneId === lane.id);
          // (lane.height is the lane's size across the flow: its screen width when the diagram runs top-to-bottom)
          const maxNodeBottom = laneNodes.reduce((m, n) => (isConnector(n) ? m : Math.max(m, (n.y || 48) + crossSize(n))), 100);
          // Connectors are placed inside the lane's bounds (engine.js placeConnectors): they only need to fit
          const maxConnBottom = laneNodes.reduce((m, n) => (isConnector(n) ? Math.max(m, (n.y || 0) + CONN.SIZE + CONN.EDGE) : m), 0);
          // Past the lowest node: the bottom pad, or the room its far-side loop-backs need (same rule as the engine;
          // near-side loops run above the nodes, in room the node positions already leave)
          const loopRoom = laneLoopRooms(chartData.nodes, chartData.edges, chartData.lanes, lane.id, id => xById[id] || 0).far;
          const computedHeight = Math.max(LE.LANE_MIN, maxNodeBottom + Math.max(LE.BOTTOM_PAD, loopRoom), maxConnBottom) // derived from nodes only, so lanes shrink back
            + (index === chartData.lanes.length - 1 ? outerExtra : 0);             // room for outer loop-backs (render)
          lane.height = computedHeight;
          const tb = isTB();

          const laneEl = document.createElement('div');
          laneEl.className = 'swimlane';
          laneEl.dataset.laneId = lane.id;
          laneEl.dataset.laneIndex = index;
          if (tb) {
            laneEl.style.minWidth = `${computedHeight}px`;
            laneEl.style.width = `${computedHeight}px`;
          } else {
            laneEl.style.minHeight = `${computedHeight}px`;
            laneEl.style.height = `${computedHeight}px`;
          }
          // stripe, icon, pill tint; a lane without its own colour takes the palette colour for its position (not saved).
          // With subprocess flows the position is the actor's in the one list, so a lane has one colour in every flow.
          const at = chartData.actors ? chartData.actors.findIndex(a => a.id === lane.id) : index;
          const colorAt = at < 0 ? chartData.actors.length : at;
          const laneColor = colorSlot(lane.color || SWATCHES[colorAt % SWATCHES.length].slot);   // a slot, or a custom hex
          const laneSw = paletteOf(laneColor);
          const laneHex = laneSw ? laneSw.hex : laneColor;                                       // --lane-color mixes a hex
          if (laneHex) laneEl.style.setProperty('--lane-color', laneHex);
          if (laneSw) laneEl.dataset.sw = laneSw.slot;
          if (index % 2) laneEl.classList.add('lane-alt');                     // lanes alternate white / light grey
          if (lane.id === selectedLaneId) laneEl.classList.add('lane-selected');

          const track = document.createElement('div');
          track.className = 'lane-track';
          track.dataset.laneId = lane.id;
          if (tb) track.style.minHeight = `${trackWidth}px`;
          else track.style.minWidth = `${trackWidth}px`;

          // Lane name pill (there is no header column): icon + name at the visible top-left of the lane.
          // Drag it to reorder lanes, double-click the name to rename. Positioned by pinLaneHeaders.
          const editable = !document.body.classList.contains('presentation');
          const pill = document.createElement('div');
          pill.className = 'lane-pill swatch-pill';
          pill.draggable = editable;
          pill.dataset.tip = 'Click to select (Delete removes the lane) \u00b7 drag to reorder \u00b7 double-click to rename';
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            if (editable && !pill.classList.contains('editing')) selectLane(lane.id);
          });
          pill.appendChild(laneIconEl(lane, 18));
          const title = document.createElement('span');
          title.className = 'lane-title';
          title.contentEditable = 'false';
          title.spellcheck = false;
          title.textContent = lane.name;
          pill.appendChild(title);
          // The lane's action bar (shown while the lane is selected, over the pill; below it near the viewport's top edge):
          // rename, delete (hide lanes on the only lane), colour (none = the colour for its position)
          if (editable) {
            const bar = ui.actionBar('actionbar lane-bar', 'Swimlane');
            const btn = (act, html, title, extra) => ui.abButton('ab-btn', act, html, title, undefined, undefined, extra);
            bar.appendChild(btn('rename', ui.icon('rename'), 'Rename the lane (or double-click its name)'));
            bar.appendChild(ui.abSep());
            bar.appendChild(swatchPicker(lane.color || '', (slot) => setLaneColor(lane.id, slot), { triggerClass: 'ab-btn', btnClass: 'ab-swatch' }));
            bar.appendChild(ui.abSep());
            if (chartData.lanes.length > 1) bar.appendChild(btn('delete', ui.icon('trash'), 'Delete swimlane (with its steps)', 'is-danger'));
            // One lane is a one-actor diagram: the lane names and borders can go ("swimlanes": false; Show lanes brings them back)
            else bar.appendChild(btn('hide', `${ui.icon('eye')}<span>Hide lanes</span>`, 'Hide the lane name and borders (the Lane button then reads Show lanes)'));
            // Buttons are not drag handles for the pill they sit in, and a press on the bar neither pans nor selects
            bar.addEventListener('pointerdown', (e) => e.stopPropagation());
            bar.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
            bar.addEventListener('dblclick', (e) => e.stopPropagation());
            bar.addEventListener('click', (e) => {
              e.stopPropagation();
              const b = e.target.closest('.ab-btn');
              if (!b || b.dataset.act === undefined) return;
              if (b.dataset.act === 'rename') startRename();
              else if (b.dataset.act === 'delete') confirmDeleteLane(lane.id, b);
              else if (b.dataset.act === 'hide') { chartData.swimlanes = false; selectedLaneId = null; render(); updateStatus(true); }
            });
            pill.appendChild(bar);
          }
          if (tb) pill.style.maxWidth = `${Math.max(80, computedHeight - 2 * PILL_INSET)}px`;   // stays inside its column

          function startRename() {
            pill.draggable = false;   // a draggable ancestor would swallow text selection
            pill.classList.add('editing');
            title.contentEditable = 'true';
            title.focus();
            const range = document.createRange();
            range.selectNodeContents(title);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
          title.addEventListener('dblclick', (e) => {
            if (!editable) return;
            e.stopPropagation();
            startRename();
          });
          title.addEventListener('blur', () => {
            title.contentEditable = 'false';
            pill.draggable = editable;
            pill.classList.remove('editing');
            const name = title.textContent.trim();
            if (name && lane.name !== name) {
              lane.name = name;
              updateStatus(true);
            } else title.textContent = lane.name;
            pinLaneHeaders();   // the pill's height may change
          });
          title.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
            else if (e.key === 'Escape') { title.textContent = lane.name; title.blur(); }
          });

          // Drag the pill to reorder; a blue line shows where the lane will land
          // (also from the reorder grip under it, which is inside the pill)
          pill.addEventListener('dragstart', (e) => {
            laneDragFrom = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            // Restyle after dragstart returns: Chrome cancels a drag whose source changes under the cursor during it
            setTimeout(() => { if (laneDragFrom === index) laneEl.classList.add('lane-dragging'); }, 0);
          });
          pill.addEventListener('dragend', endLaneDrag);

          // Lane-colour stripe at the visible left edge; once panned, also a soft fade behind the pill
          const rail = document.createElement('div');
          rail.className = 'lane-rail';
          rail.setAttribute('aria-hidden', 'true');

          // Empty gutter left of the track (node x is measured from the track), sized below to clear the pills
          const gutter = document.createElement('div');
          gutter.className = 'lane-gutter';

          laneEl.appendChild(gutter);
          laneEl.appendChild(track);
          laneEl.appendChild(rail);
          laneEl.appendChild(pill);
          lanesRoot.appendChild(laneEl);
          if (index === hoverIdx) setHoverLane(laneEl);   // keep the wash across re-renders
        });
        sizeLaneGutter();
      }

      // The gutter indents every node and arrow so the lane pills (at the lane's top-left) never sit on them.
      // Sized from the widest pill at 1:1 scale: nodes start LE.START_X (56) into the track and loop-back
      // corridors run 24px left of a node, so the gutter only needs to cover what the pill adds beyond that.
      // Top-to-bottom, the gutter is a band above the nodes, sized from the tallest pill instead.
      const GUTTER_CLEAR = 12;   // px between the pill's right edge and the nearest corridor
      function sizeLaneGutter() {
        let g = 0;
        if (chartData.swimlanes !== false) {
          const pills = [...lanesRoot.querySelectorAll('.lane-pill')];
          const extent = Math.max(0, ...pills.map(p => (isTB() ? p.offsetHeight : p.offsetWidth)));
          g = Math.max(0, Math.ceil(PILL_INSET + extent + GUTTER_CLEAR - (LE.START_X - 24)));
        }
        swimlanesContainer.style.setProperty('--lane-gutter', `${g}px`);
        return g;
      }

      // Lane icons: lane.icon names an entry of the icon registry (ICONS, assets/icons/default.json). A lane without one
      // (older files, hand-edited JSON) gets a guess from its name, so every lane pill still carries an icon.
      const LANE_ICON_GUESS = [
        [/risk|compliance|security|legal|audit|fraud|admin/, 'shield'],
        [/customer|client|applicant|requester|end.?user|\buser\b/, 'user'],
        [/support|help.?desk|service.?desk|call.?cent/, 'headset'],
        [/finance|billing|treasury|account(?:s|ing)\b/, 'banknote'],
        [/payment|card/, 'credit-card'],
        [/warehouse|logistic|shipping|delivery|fulfil/, 'truck'],
        [/inventory|package|parcel/, 'package'],
        [/mail|notif|message/, 'mail'],
        [/external|third.?party|partner|vendor|integration/, 'globe'],
        [/devops|\bops\b|operat|platform|infra|sre|release/, 'cog'],
        [/test|\bqa\b|quality|verif/, 'check'],
        [/\bba\b|analyst|product|requirement|\bpo\b/, 'clipboard'],
        [/front.?end|\bui\b|\bux\b|web|portal|browser|mobile/, 'monitor'],
        [/develop|engineer|back.?end|software|\bapi\b|\bcode/, 'code'],
        [/data|storage/, 'database'],
        [/engine|system|automat|service|bot|workflow|underwrit/, 'cpu'],
        [/cloud/, 'cloud'],
        [/sales|account manager|officer|manager|broker/, 'briefcase'],
        [/core|lead|exec|board|committee|steer|management/, 'flag']
      ];
      function laneIconName(lane) {
        if (lane.icon && ICONS[lane.icon]) return lane.icon;
        const name = String(lane.name || '').toLowerCase();
        const hit = LANE_ICON_GUESS.find(([re]) => re.test(name));
        return hit ? hit[1] : 'users';
      }
      function laneIconEl(lane, size = 20) {
        const chip = document.createElement('span');
        chip.className = 'lane-icon';
        chip.setAttribute('aria-hidden', 'true');   // decorative: the lane name sits right beside it
        chip.innerHTML = ui.icon(laneIconName(lane), { size });
        return chip;   // tinted with the lane colour (see .lane-icon)
      }

      // --- Lane drag & drop helpers ---
      let laneDragFrom = -1;
      const laneDropLine = document.getElementById('lane-drop-line');


      // Lanes are stacked rows left-to-right and side-by-side columns top-to-bottom
      function laneInsertIndexAt(clientX, clientY) {
        const lanes = [...lanesRoot.children];
        for (let i = 0; i < lanes.length; i++) {
          const r = lanes[i].getBoundingClientRect();
          if (isTB() ? clientX < r.left + r.width / 2 : clientY < r.top + r.height / 2) return i;
        }
        return lanes.length;
      }

      function showLaneDropLine(insertIdx) {
        const lanes = [...lanesRoot.children];
        if (!lanes.length) return;
        const wasHidden = laneDropLine.style.display !== 'block';
        const last = lanes[lanes.length - 1];
        if (isTB()) {
          const x = insertIdx < lanes.length ? lanes[insertIdx].offsetLeft : last.offsetLeft + last.offsetWidth;
          laneDropLine.style.left = `${x - 2}px`;
          laneDropLine.style.top = '';
        } else {
          const y = insertIdx < lanes.length ? lanes[insertIdx].offsetTop : last.offsetTop + last.offsetHeight;
          laneDropLine.style.top = `${y - 2}px`;
          laneDropLine.style.left = '';
        }
        laneDropLine.style.display = 'block';
        if (wasHidden && motion.enabled()) {
          motion.anim(laneDropLine, [{ transform: isTB() ? 'scaleY(0)' : 'scaleX(0)' }, { transform: 'none' }], {
            duration: 90, easing: motion.curve('curve-out')
          });
        }
      }

      function endLaneDrag() {
        laneDragFrom = -1;
        laneDropLine.style.display = 'none';
        document.querySelectorAll('.swimlane.lane-dragging').forEach(l => l.classList.remove('lane-dragging'));
      }

      swimlanesContainer.addEventListener('dragover', (e) => {
        if (laneDragFrom < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        showLaneDropLine(laneInsertIndexAt(e.clientX, e.clientY));
      });
      swimlanesContainer.addEventListener('dragleave', (e) => {
        if (laneDragFrom >= 0 && !swimlanesContainer.contains(e.relatedTarget)) laneDropLine.style.display = 'none';
      });
      swimlanesContainer.addEventListener('drop', (e) => {
        if (laneDragFrom < 0) return;
        e.preventDefault();
        const from = laneDragFrom;
        const insertIdx = laneInsertIndexAt(e.clientX, e.clientY);
        const to = insertIdx > from ? insertIdx - 1 : insertIdx;
        endLaneDrag();
        if (to !== from) moveLane(from, to - from);
      });

      // A start/end node with no label collapses to a circle, centred in its normal 144x64 slot
      const DOT_SIZE = 40;
      function isDot(n) { return (n.type === 'start' || n.type === 'end') && !(n.label || '').trim(); }
      function dotOffset(n) { return isDot(n) ? { x: (NODE_WIDTH - DOT_SIZE) / 2, y: (NODE_HEIGHT - DOT_SIZE) / 2 } : { x: 0, y: 0 }; }

      // --- SHAPED NODES ---
      // A shaped node keeps its slot's box (144x64; a decision 144x96), made transparent by flowchart.css, and draws
      // its outline inside it as an SVG stretched to the box (preserveAspectRatio="none", non-scaling stroke). The
      // outline stays 1px inside the box so the 2px stroke ends on the box edge, like a task's border. `.shape-path`
      // is the filled outline, `.shape-line` an inner stroke (the subprocess's + marker, the cylinder's front rim).
      // Shapes keep their screen orientation in a top-to-bottom diagram: the document's wave is always at the
      // bottom, the delay's arc always on the right. Keep outlineInset() in step with any change here.
      // The diamond has its four corners rounded by DIAMOND_ROUND px along each edge: a quadratic curve through
      // each vertex, so the tip sits a little inside the vertex. outlineInset() measures that curve.
      const DIAMOND_ROUND = 10;
      function diamondPath(w, h) {
        const a = w / 2 - 1, b = h / 2 - 1, L = Math.hypot(a, b), cx = w / 2, cy = h / 2;
        const f = (n) => +n.toFixed(2), kx = DIAMOND_ROUND * a / L, ky = DIAMOND_ROUND * b / L;
        return `M${f(cx - kx)},${f(1 + ky)}Q${cx},1 ${f(cx + kx)},${f(1 + ky)}L${f(w - 1 - kx)},${f(cy - ky)}Q${w - 1},${cy} ${f(w - 1 - kx)},${f(cy + ky)}`
          + `L${f(cx + kx)},${f(h - 1 - ky)}Q${cx},${h - 1} ${f(cx - kx)},${f(h - 1 - ky)}L${f(1 + kx)},${f(cy + ky)}Q1,${cy} ${f(1 + kx)},${f(cy - ky)}Z`;
      }
      const SHAPE_OUTLINES = {
        decision:   { h: DECISION_HEIGHT, svg: `<path class="shape-path diamond-poly" d="${diamondPath(144, DECISION_HEIGHT)}"/>` },
        subprocess: { h: 64, svg: '<rect class="shape-path" x="1" y="1" width="142" height="62" rx="8"/><rect class="shape-line sub-mark" x="7" y="7" width="12" height="12" rx="4"/><path class="shape-line sub-mark" d="M13 10V16M10 13H16"/>' },
        document:   { h: 64, svg: '<path class="shape-path" d="M1 1H143V57C119 49 96 49 72 57C48 65 25 65 1 57Z"/>' },
        io:         { h: 64, svg: '<polygon class="shape-path" points="13,1 143,1 131,63 1,63"/>' },
        database:   { h: 64, svg: '<path class="shape-path" d="M1 9A71 8 0 0 1 143 9V55A71 8 0 0 1 1 55Z"/><path class="shape-line" d="M1 9A71 8 0 0 0 143 9"/>' },
        delay:      { h: 64, svg: '<path class="shape-path" d="M1 1H111A32 31 0 0 1 111 63H1Z"/>' },
      };
      function shapeOutlineSvg(type) {
        const s = SHAPE_OUTLINES[type];
        return s ? `<svg class="shape-outline${type === 'decision' ? ' decision-diamond-svg' : ''}" viewBox="0 0 144 ${s.h}" preserveAspectRatio="none" aria-hidden="true">${s.svg}</svg>` : '';
      }
      // How far inside its box a shaped node's outline is, on screen side `side` of box `r` (screen coordinates),
      // at `along` (screen x for top/bottom, screen y for left/right). 0 where the outline runs on the box edge.
      // The router ends arrows on the box; the outline snap (5f) moves each end in by this much.
      function outlineInset(type, r, side, along) {
        if (type === 'connector') {   // a circle filling its box
          const horiz = side === 'top' || side === 'bottom';
          const t = 2 * Math.max(0, Math.min(1, horiz ? (along - r.x) / r.w : (along - r.y) / r.h)) - 1;
          return (horiz ? r.h : r.w) / 2 * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
        }
        const s = SHAPE_OUTLINES[type];
        if (!s) return 0;
        const horiz = side === 'top' || side === 'bottom';
        const c = Math.max(0, Math.min(1, horiz ? (along - r.x) / r.w : (along - r.y) / r.h));   // 0..1 along the side
        const sx = r.w / 144, sy = r.h / s.h;                            // viewBox units -> px
        const vx = c * 144;                                              // viewBox x (top/bottom sides)
        const arc = (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t));        // depth of a unit ellipse at offset t from its axis
        switch (type) {
          case 'decision': { // four rounded vertices at the side midpoints: a parabola over the rounded part, then the slanted edge
            const a = (horiz ? r.w : r.h) / 2, b = (horiz ? r.h : r.w) / 2, d = Math.abs(c - 0.5) * 2 * a;
            const ka = DIAMOND_ROUND * a / Math.hypot(a, b), kb = ka * b / a;
            return Math.min(b, d < ka ? kb / 2 * (1 + (d / ka) ** 2) : kb + (d - ka) * b / a);
          }
          case 'io':         // slanted sides: 12 units in at the top-left and the bottom-right
            return side === 'left' ? 12 * sx * (1 - c) : side === 'right' ? 12 * sx * c : 0;
          case 'database':   // elliptical top and bottom, 8 units deep, spanning the width
            return horiz ? 8 * sy * arc(2 * c - 1) : 0;
          case 'delay':      // half-ellipse on the right: 32 units wide from x = 111, the full height
            if (side === 'right') return 32 * sx * arc(2 * c - 1);
            if (horiz && vx > 111) return 31 * sy * arc((vx - 111) / 32);
            return 0;
          case 'document': { // wave on the bottom: two cubic halves from y = 57, up to 51 on the right, down to 63 on the left
            if (side !== 'bottom') return 0;
            const right = vx > 72, t = right ? (143 - vx) / 71 : (72 - vx) / 71;
            const y = 57 + (right ? -1 : 1) * 24 * t * (1 - t);
            return Math.max(0, 63 - y) * sy;
          }
          default: return 0;
        }
      }

      // Every node fits its text by width in pixels, not characters ("Dispatch Replacement Laptop" is too wide for a task's
      // two lines at full size, "Dispatch Replacement" + "Laptop" fits once stepped down; narrow shapes need it most): "Specification?" fits a diamond
      // line, "Standard Spec?" (same length, wider letters) does not. A label that needs a third line steps its
      // font down 1px at a time, to FIT_MIN_PX (TOKENS.type.fitMin), until it fits the 2-line clamp. data-base-px keeps the
      // designed size for the legibility report (shell.js), so a fitted label does not count as small text.
      const FIT_MIN_PX = parseFloat(TOKENS.type.fitMin);
      function fitNodeLabel(label, type) {
        label.style.fontSize = '';
        delete label.dataset.basePx;
        if (type === 'connector' || !label.isConnected) return;   // a connector is one letter
        const over = () => label.scrollHeight > label.clientHeight + 2 || label.scrollWidth > label.clientWidth + 2;
        if (!over()) return;
        const base = parseFloat(getComputedStyle(label).fontSize);
        label.dataset.basePx = base;
        for (let px = Math.ceil(base) - 1; px >= FIT_MIN_PX; px--) {
          label.style.fontSize = `${px}px`;
          if (!over()) return;
        }
      }

      // --- ON-PAGE CONNECTORS ---
      // A pair of lettered circles standing for one long arrow (engine.js ON-PAGE CONNECTORS has the data rules and
      // the layout). A pair is made by splitting a selected arrow (the Split chip), never by wiring circles by hand:
      // connectors have no ports and refuse new arrows. Hover lights every circle of the letter and draws a dotted
      // guide between them (never exported); in ?present a click pans to the partner (editing: a click only selects, so Delete works); a rename renames the whole pair; Delete
      // joins the arrow back together.
      const connectorRole = (id) => {
        const i = chartData.edges.some(e => e.to === id), o = chartData.edges.some(e => e.from === id);
        return i && !o ? 'in' : o && !i ? 'out' : null;
      };
      const connectorsLettered = (letter) => chartData.nodes.filter(n => isConnector(n) && connectorLetter(n) === letter);
      // Which of the 4 one-hue styles (flowchart.css, data-style) a letter wears, by its place in the sequence
      // (A 0, B 1, ... AA 24): neighbouring letters always differ, and a pair always matches.
      function connectorStyle(letter) {
        const L = CONNECTOR_LETTERS.length, idx = [...letter].reduce((k, ch) => k * L + Math.max(0, CONNECTOR_LETTERS.indexOf(ch)), 0)
          + (letter.length > 1 ? L : 0);
        return idx % 4;
      }
      // The circles a reader looks for from this one: an in-connector's out-connector, an out-connector's in-connectors
      function connectorPartners(node) {
        const role = connectorRole(node.id), want = role === 'in' ? 'out' : role === 'out' ? 'in' : null;
        return connectorsLettered(connectorLetter(node)).filter(n => n.id !== node.id && (!want || connectorRole(n.id) === want));
      }
      const stepLabel = (id) => { const n = nodeById(id); return n ? (n.label || n.id) : id; };
      function connectorAria(node) {
        const letter = connectorLetter(node), role = connectorRole(node.id);
        if (role === 'in') {
          const to = connectorPartners(node).flatMap(p => chartData.edges.filter(e => e.from === p.id).map(e => stepLabel(e.to)));
          return to.length ? `Connector ${letter}, continues at ${to.join(', ')}` : `Connector ${letter}, continues nowhere`;
        }
        if (role === 'out') {
          const from = connectorPartners(node).flatMap(p => chartData.edges.filter(e => e.to === p.id).map(e => stepLabel(e.from)));
          return from.length ? `Connector ${letter}, from ${from.join(', ')}` : `Connector ${letter}, from nowhere`;
        }
        return `Connector ${letter}`;
      }

      function buildConnectorEl(node) {
        const el = document.createElement('div');
        el.className = 'flow-node type-connector';
        el.dataset.style = connectorStyle(connectorLetter(node));
        el.id = `node-${node.id}`;
        el.dataset.nodeId = node.id;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', connectorAria(node));
        el.dataset.noTip = '';
        placeNodeEl(el, node);
        if (selectedNodeIds.has(node.id)) el.classList.add('selected');
        const label = document.createElement('div');
        label.className = 'node-label';
        label.spellcheck = false;
        label.textContent = connectorLetter(node);
        el.appendChild(label);
        el.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (isPresenting()) return;
          label.contentEditable = 'true';
          label.focus();
          const range = document.createRange();
          range.selectNodeContents(label);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        label.addEventListener('blur', () => {
          if (label.contentEditable !== 'true') return;
          label.contentEditable = 'false';
          renameConnector(node, label.textContent);
        });
        label.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); label.textContent = connectorLetter(node); label.blur(); }
          e.stopPropagation();
        });
        el.addEventListener('pointerdown', (e) => {
          if (isPresenting()) { e.preventDefault(); e.stopPropagation(); jumpToPartner(node); return; }
          handleNodePointerDown(e, node);
        });
        el.addEventListener('mouseenter', () => { hoveredNodeId = node.id; applyNodeHover(); showConnectorPair(node); });
        el.addEventListener('mouseleave', () => { if (hoveredNodeId === node.id) hoveredNodeId = null; applyNodeHover(); showConnectorPair(null); });
        return el;
      }

      // Light every circle of the hovered connector's letter and join each in-connector to its out-connector with a
      // dotted guide (hover only; data-export-skip keeps it out of exports). A hovered step shows the guides of every
      // connector wired to it. Accepts one node, a list of nodes, or null to clear.
      function showConnectorPair(node) {
        document.querySelectorAll('.flow-node.pair-lit').forEach(el => el.classList.remove('pair-lit'));
        edgeGroup.querySelectorAll('.connector-guide').forEach(l => l.remove());
        if (!node) return;
        const letters = new Set((Array.isArray(node) ? node : [node]).map(connectorLetter));
        letters.forEach(drawConnectorGuides);
      }
      // Connectors joined to a step by an arrow, in either direction
      function connectorsAttachedTo(id) {
        const out = [];
        chartData.edges.forEach(e => {
          const other = e.from === id ? e.to : e.to === id ? e.from : null;
          const n = other && nodeById(other);
          if (isConnector(n)) out.push(n);
        });
        return out;
      }
      function drawConnectorGuides(letter) {
        const all = connectorsLettered(letter);
        all.forEach(n => { const el = nodeElOf(n.id); if (el) el.classList.add('pair-lit'); });
        const centre = (id) => { const el = nodeElOf(id); if (!el) return null; const b = containerBox(el); return [b.x + b.w / 2, b.y + b.h / 2]; };
        const outs = all.filter(n => connectorRole(n.id) === 'out');
        const ins = all.filter(n => connectorRole(n.id) !== 'out');
        const pairs = outs.length ? ins.flatMap(i => outs.map(o => [i, o])) : ins.slice(1).map(i => [ins[0], i]);
        pairs.forEach(([a, b]) => {
          const p = centre(a.id), q = centre(b.id);
          if (!p || !q) return;
          const line = document.createElementNS(SVG_NS, 'line');
          line.setAttribute('class', 'connector-guide');
          line.setAttribute('data-export-skip', '');
          line.setAttribute('x1', p[0]); line.setAttribute('y1', p[1]);
          line.setAttribute('x2', q[0]); line.setAttribute('y2', q[1]);
          edgeGroup.appendChild(line);
          motion.drawPath(line, { duration: 120, easing: 'curve-out' });
        });
      }

      // Pan (same zoom) so the partner is centred, with a short pulse on it. An out-connector with several
      // in-connectors steps through them on each click.
      let jumpTurn = 0;
      function jumpToPartner(node) {
        const partners = connectorPartners(node);
        if (!partners.length) return;
        const p = partners[jumpTurn++ % partners.length];
        const el = nodeElOf(p.id);
        if (!el) return;
        const vp = viewport.getBoundingClientRect(), r = el.getBoundingClientRect();
        const dx = (vp.left + vp.width / 2) - (r.left + r.width / 2), dy = (vp.top + vp.height / 2) - (r.top + r.height / 2);
        animateViewport(panX + dx, panY + dy, scale, { duration: motion.dur('dur-camera', 240), easing: 'curve-inout' });
        el.classList.remove('connector-pulse');
        void el.offsetWidth;   // restart the animation
        el.classList.add('connector-pulse');
        setTimeout(() => el.classList.remove('connector-pulse'), 700);
      }

      // A short message above the dock (e.g. why a rename was refused)
      let hintTimer = 0;
      function flashHint(text) {
        let hint = document.querySelector('.flow-hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'hint hint-note flow-hint';
          hint.setAttribute('role', 'status');
          hint.dataset.exportSkip = '';
          document.body.appendChild(hint);
        }
        hint.textContent = text;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => { if (hint.isConnected) motion.hideHint(hint); }, 2600);
      }

      // Every circle of the old letter takes the new one: a rename never splits a pair. A letter in use is refused.
      function renameConnector(node, text) {
        const from = connectorLetter(node), to = String(text || '').trim().toUpperCase();
        if (to === from) { render(); return; }
        if (!isConnectorLetter(to)) { flashHint(`A connector's letter is A to Z (no I or O), then AA, AB, …`); render(); return; }
        if (connectorsLettered(to).length) { flashHint(`Letter ${to} is already used by another connector pair`); render(); return; }
        connectorsLettered(from).forEach(n => { n.label = to; });
        render();
        updateStatus(true);
      }

      // Split arrow `edgeId` into a connector pair: src -> (L) ... (L) -> tgt. The arrow keeps its id, label and feedback
      // flag on the in-side. With `joinLetter`, the arrow joins that letter's existing pair instead (a merge: only
      // offered when that pair continues at the same step).
      function splitEdge(edgeId, joinLetter) {
        const edge = chartData.edges.find(e => e.id === edgeId);
        if (!edge) return;
        const src = nodeById(edge.from), tgt = nodeById(edge.to);
        if (!src || !tgt || isConnector(src) || isConnector(tgt)) return;
        const rt = lastRoutes[edgeId], sr = swimlanesContainer.getBoundingClientRect();
        const midRect = rt && rt.midX != null ? { left: sr.left + rt.midX * scale - 16 * scale, top: sr.top + rt.midY * scale - 16 * scale, width: 32 * scale, height: 32 * scale } : null;
        let cIn;
        withMotion(() => {
          const letter = joinLetter || nextConnectorLetter(chartData.nodes);
          cIn = { id: uid('c'), laneId: src.laneId, type: 'connector', label: letter, x: src.x || 0, y: src.y || 0 };
          chartData.nodes.push(cIn);
          if (!joinLetter) {
            const cOut = { id: uid('c'), laneId: tgt.laneId, type: 'connector', label: letter, x: tgt.x || 0, y: tgt.y || 0 };
            chartData.nodes.push(cOut);
            chartData.edges.push({ id: uid('e'), from: cOut.id, to: tgt.id, label: '' });
          }
          edge.to = cIn.id;
          selectedEdgeId = null;
          placeAfterConnectorEdit();
          selectNode(cIn.id);
        }, { originRect: midRect, duration: 180, drawEdges: new Set([edgeId]), skipFreeNotes: true });
      }

      // The selected arrow's toolbar (components/actionbar.css): Connector, Label, Delete. It sits just right
      // of the midpoint (past the label when there is one), so it never covers the text or the spot to double-click.
      // Connector opens a choice when a pair already continues at this arrow's target: a new pair, or join that pair
      // (a merge: several sources continuing at one out-connector).
      function buildEdgeBar(edge, labelContainer, route, hasLabel) {
        const bar = ui.actionBar('actionbar edge-bar', 'Arrow');
        const btn = (act, icon, title, extra) => ui.abButton('ab-btn', act, ui.icon(icon), title, undefined, undefined, extra);
        if (!isConnector(nodeById(edge.from)) && !isConnector(nodeById(edge.to)) && edge.from !== edge.to) {
          bar.appendChild(btn('split', 'split', 'Connector: split this arrow into a lettered pair'));
        }
        bar.appendChild(btn('label', 'label', 'Label (or double-click the arrow)'));
        bar.appendChild(btn('delete', 'trash', 'Delete the arrow', 'is-danger'));
        bar.style.left = `${route.midX + (hasLabel ? labelContainer.offsetWidth / 2 : 0) + 8}px`;
        bar.style.top = `${route.midY}px`;
        bar.addEventListener('pointerdown', (e) => e.stopPropagation());
        bar.addEventListener('dblclick', (e) => e.stopPropagation());
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          const b = e.target.closest('.ab-btn');
          if (!b) return;
          if (b.dataset.act === 'delete') { deleteEdge(edge.id); return; }
          if (b.dataset.act === 'label') { labelContainer.dispatchEvent(new MouseEvent('dblclick', { bubbles: false })); return; }
          bar.querySelector('.edge-split-menu')?.remove();
          const joins = joinableLetters(edge.to);
          if (!joins.length) { splitEdge(edge.id); return; }
          const menu = document.createElement('div');
          menu.className = 'edge-split-menu';
          menu.dataset.exportSkip = '';
          menu.setAttribute('role', 'menu');
          const item = (text, fn) => {
            const m = document.createElement('button');
            m.type = 'button';
            m.setAttribute('role', 'menuitem');
            m.textContent = text;
            m.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            m.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
            menu.appendChild(m);
            return m;
          };
          const first = item(`Split into new ${nextConnectorLetter(chartData.nodes)}`, () => splitEdge(edge.id));
          joins.forEach(l => item(`Join ${l} (continues at ${stepLabel(edge.to)})`, () => splitEdge(edge.id, l)));
          bar.appendChild(menu);
          menu.style.transformOrigin = 'top left';
          motion.anim(menu, [
            { transform: 'scale(0.92, 0.86) translateY(-4px)', clipPath: 'inset(0 0 25% 0 round var(--radius-lg))' },
            { transform: 'none', clipPath: 'inset(0 0 0 0 round var(--radius-lg))' }
          ], { duration: Math.max(40, Math.round(motion.dur('dur-fast', 140) * motion.speedScale())), easing: motion.curve('curve-spring-tactile') });
          first.focus();
          menu.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              motion.ghostExit(menu, { duration: 100, transform: 'scale(0.92) translateY(-4px)', origin: 'top left' });
              menu.remove();
              b.focus();
            }
          });
        });
        return bar;
      }

      // Pairs whose out-connector continues at step `toId`: an arrow into that step may join them
      const joinableLetters = (toId) => [...new Set(chartData.nodes
        .filter(n => isConnector(n) && connectorRole(n.id) === 'out' && chartData.edges.some(e => e.from === n.id && e.to === toId))
        .map(connectorLetter))];

      // Delete a connector = join: the whole arrow comes back (src -> tgt, with its label and feedback flag). Deleting
      // one in-connector of a merge joins only its source; deleting the out-connector joins every source.
      function joinConnector(node) {
        withMotion(() => {
          joinConnectorData(node);
          pruneNotes();
          clearNodeSelection();
          placeAfterConnectorEdit();
        }, { ghostExit: true, duration: 200, skipFreeNotes: true });
      }
      function joinConnectorData(node) {
        const letter = connectorLetter(node), role = connectorRole(node.id);
        const outs = connectorsLettered(letter).filter(n => connectorRole(n.id) === 'out');
        const targets = outs.flatMap(o => chartData.edges.filter(e => e.from === o.id).map(e => e.to)).filter(t => !isConnector(nodeById(t)));
        const ins = role === 'in' ? [node] : role === 'out' ? connectorsLettered(letter).filter(n => connectorRole(n.id) === 'in') : [];
        const gone = new Set([node.id]);
        ins.forEach(c => {
          gone.add(c.id);
          chartData.edges.filter(e => e.to === c.id).forEach(e => {
            if (targets.length && !chartData.edges.some(x => x !== e && x.from === e.from && x.to === targets[0])) e.to = targets[0];
          });
        });
        // The out-connector goes too once no in-connector is left for it
        const left = connectorsLettered(letter).filter(n => !gone.has(n.id) && connectorRole(n.id) === 'in');
        if (!left.length) outs.forEach(o => gone.add(o.id));
        chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
        chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
      }

      // After an edit breaks a pair (its step or a stub arrow deleted): a connector with no arrows goes, and so does
      // a letter left without its in- or out-side, with its stub arrows. Deleting either stub deletes the whole arrow.
      function pruneConnectors() {
        let changed = true;
        while (changed) {
          changed = false;
          const conns = chartData.nodes.filter(isConnector);
          const gone = new Set(conns.filter(c => !connectorRole(c.id) && !chartData.edges.some(e => e.from === c.id || e.to === c.id)).map(c => c.id));
          const letters = new Set(conns.map(connectorLetter));
          letters.forEach(l => {
            const set = connectorsLettered(l).filter(c => !gone.has(c.id));
            const hasIn = set.some(c => connectorRole(c.id) === 'in'), hasOut = set.some(c => connectorRole(c.id) === 'out');
            if (hasIn !== hasOut) set.forEach(c => gone.add(c.id));
          });
          if (gone.size) {
            chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
            chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
            changed = true;
          }
        }
      }

      // Moving one end of a pair: drag its circle onto a step. An out-connector then continues at that step; an
      // in-connector takes its flow from that step (the arrow keeps its label). Refused when it would join a step to
      // itself through the pair. Returns false when nothing changed.
      function stepUnder(clientX, clientY, skipId) {
        for (const el of document.elementsFromPoint(clientX, clientY)) {
          const n = el.closest('.flow-node');
          if (n && n.dataset.nodeId !== skipId && !n.classList.contains('type-connector')) return n.dataset.nodeId;
        }
        return null;
      }
      function markConnectorTarget(id) {
        document.querySelectorAll('.flow-node.connect-target').forEach(el => el.classList.remove('connect-target'));
        const el = id && nodeElOf(id);
        if (el) el.classList.add('connect-target');
      }
      function moveConnectorTo(node, stepId) {
        const role = connectorRole(node.id), step = nodeById(stepId);
        if (!role || !step) return false;
        const mine = chartData.edges.filter(e => (role === 'out' ? e.from === node.id : e.to === node.id));
        if (mine.some(e => (role === 'out' ? e.to : e.from) === stepId)) return false;   // already there
        // The step at the pair's other end: a pair from a step back into itself is refused
        const others = connectorPartners(node).flatMap(p => chartData.edges
          .filter(e => (role === 'out' ? e.to === p.id : e.from === p.id)).map(e => (role === 'out' ? e.from : e.to)));
        if (others.includes(stepId)) { flashHint('That step is already the other end of this pair'); return false; }
        withConnectorMotion(() => {
          mine.forEach(e => { if (role === 'out') e.to = stepId; else e.from = stepId; });
          node.laneId = step.laneId;
          placeAfterConnectorEdit();
          selectNode(node.id);
        }, { duration: 190, skipFreeNotes: true });
        return true;
      }

      // An arrowhead dropped on a circle of pair `letter`: the arrow now flows into that pair, through a new in-circle
      // beside its source (the merge "Join A" makes from the Split chip). Its label and feedback flag stay on it. A
      // circle it no longer reaches goes (pruneConnectors). Refused when the pair continues at the arrow's own source.
      function joinEdgeTo(edge, letter) {
        const src = nodeById(edge.from);
        if (!src || isConnector(src)) return false;
        const pair = connectorsLettered(letter);
        const continuesAt = pair.flatMap(c => chartData.edges.filter(e => e.from === c.id).map(e => e.to));
        if (continuesAt.includes(src.id)) { flashHint(`Pair ${letter} already continues at this step`); return false; }
        if (pair.some(c => c.id === edge.to)) return false;   // already flows into it
        if (pair.some(c => chartData.edges.some(e => e !== edge && e.from === src.id && e.to === c.id))) {
          flashHint(`This step already flows into pair ${letter}`);
          return false;
        }
        withConnectorMotion(() => {
          const cIn = { id: uid('c'), laneId: src.laneId, type: 'connector', label: letter, x: src.x || 0, y: src.y || 0 };
          chartData.nodes.push(cIn);
          edge.to = cIn.id;
          pruneConnectors();
          selectedEdgeId = null;
          placeAfterConnectorEdit();
          selectNode(cIn.id);
        }, { duration: 190, skipFreeNotes: true });
        return true;
      }

      // Re-place only the circles (an arrow edit moved a stub to another step): steps stay where they are
      function placeCirclesOnly() {
        withConnectorMotion(() => {
          render();
          placeConnectorsInPlace(chartData);
          render();
        }, { duration: 180, skipFreeNotes: true });
      }

      // Lay out after a connector edit: Auto-Tidy on, the whole layout (no step moves, only the circles appear);
      // off, the steps stay where they are and only the circles are placed beside them
      function placeAfterConnectorEdit() {
        if (autoLayout) { relayout(); return; }
        withMotion(() => {
          render();   // sizes the lanes the circles are fitted into
          placeConnectorsInPlace(chartData);
          render();
          updateStatus(true);
        }, { duration: 180, skipFreeNotes: true });
      }

      function renderNodes() {
        document.querySelectorAll('.flow-node').forEach(el => el.remove());

        chartData.nodes.forEach(node => {
          const laneTrack = document.querySelector(`.lane-track[data-lane-id="${node.laneId}"]`);
          if (!laneTrack) return;
          if (isConnector(node)) { laneTrack.appendChild(buildConnectorEl(node)); return; }

          const nodeEl = document.createElement('div');
          nodeEl.className = `flow-node type-${node.type}` + (isDot(node) ? ' terminal-dot' : '');
          nodeEl.id = `node-${node.id}`;
          nodeEl.dataset.nodeId = node.id;
          nodeEl.dataset.noTip = '';
          placeNodeEl(nodeEl, node);
          if (selectedNodeIds.has(node.id)) nodeEl.classList.add('selected');

          // Shaped nodes (decision, subprocess, document, ...): an SVG outline drawn inside the box
          const outline = shapeOutlineSvg(node.type);
          if (outline) nodeEl.insertAdjacentHTML('afterbegin', outline);

          // Text content with double-click edit
          const label = document.createElement('div');
          label.className = 'node-label';
          label.contentEditable = 'false';
          label.spellcheck = false;
          label.dataset.noTip = '';
          label.textContent = node.label || '';

          label.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            label.contentEditable = 'true';
            label.focus();
            const range = document.createRange();
            range.selectNodeContents(label);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          });
          label.addEventListener('blur', () => {
            label.contentEditable = 'false';
            if ((node.label || '') !== label.textContent.trim()) {
              const wasDot = isDot(node);
              node.label = label.textContent.trim();
              syncChildName(node);
              updateStatus(true);
              if (wasDot !== isDot(node)) withMotion(render, { duration: 180, skipFreeNotes: true });
              else fitNodeLabel(label, node.type);
            }
          });
          label.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              label.blur();
            }
          });
          nodeEl.appendChild(label);

          // 4 Anchor Ports
          ['top', 'right', 'bottom', 'left'].forEach(pos => {
            const port = document.createElement('div');
            port.className = `port port-${pos}`;
            port.dataset.port = pos;
            port.dataset.nodeId = node.id;
            port.addEventListener('pointerdown', (e) => handlePortPointerDown(e, node.id, pos));
            nodeEl.appendChild(port);
          });

          const badge = buildNoteBadge(node);   // a note badge (no hover "+": the step bar adds notes)
          if (badge) nodeEl.appendChild(badge);
          if (node.type === 'subprocess' && hasChild(node.id)) { nodeEl.classList.add('has-child'); nodeEl.appendChild(buildSubLink(node)); }

          nodeEl.addEventListener('pointerdown', (e) => handleNodePointerDown(e, node));
          nodeEl.addEventListener('mouseenter', () => {
            hoveredNodeId = node.id; applyNodeHover();
            const attached = connectorsAttachedTo(node.id);
            if (attached.length) showConnectorPair(attached);
            if (notesOf(node.id).length) peekSoon(node.id, NOTE_PEEK_DELAY);
          });
          nodeEl.addEventListener('mouseleave', () => {
            if (hoveredNodeId === node.id) hoveredNodeId = null; applyNodeHover();
            showConnectorPair(null);
            unpeekSoon(node.id);
          });
          laneTrack.appendChild(nodeEl);
          fitNodeLabel(label, node.type);
        });
      }

      // Reads each node's box and the lane borders from the DOM (px at zoom 1) and runs the shared router (assets/shell/ortho-router.js).
      function computeAllEdgeRoutes() {
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const tb = isTB();
        const boxes = {};
        // Rounded to 0.01px: dividing a screen rect by the zoom leaves ~1e-4 of noise that depends on the camera (mid-glide
        // or not), and the route search breaks ties on exact comparisons: the same chart must route the same at any zoom
        const q = (v) => Math.round(v * 100) / 100;
        chartData.nodes.forEach(n => {
          const el = document.getElementById(`node-${n.id}`);
          if (!el) return;
          const r = el.getBoundingClientRect();
          boxes[n.id] = { x: q((r.left - stageRect.left) / scale), y: q((r.top - stageRect.top) / scale), w: q(r.width / scale), h: q(r.height / scale) };
        });
        const laneDividers = Array.from(document.querySelectorAll('.lane-track')).slice(0, -1)
          .map(t => (tb ? t.getBoundingClientRect().right - stageRect.left : t.getBoundingClientRect().bottom - stageRect.top) / scale);
        return routeEdgesOrthogonal({
          chartData, tb, boxes, laneDividers,
          loopSide: loopSides(chartData.nodes, chartData.edges, chartData.lanes),
          outlineInset: (node, r, side, along) => (SHAPE_OUTLINES[node.type] || isConnector(node) ? outlineInset(node.type, r, side, along) : 0),
          labelMaxW: LE.LABEL_MAX_W,
        });
      }

      let measureLabelCtx = null;

      let lastEdgeBarId = null;
      function renderEdges() {
        const oldBar = edgeLabelsGroup.querySelector('.edge-bar');
        const barChanged = !draggingNode && selectedEdgeId !== lastEdgeBarId;
        if (oldBar && barChanged) motion.hideBar(oldBar);   // another arrow: the old bar closes, then the new one opens
        edgeGroup.innerHTML = '';
        edgeLabelsGroup.innerHTML = '';

        const routes = computeAllEdgeRoutes();
        lastRoutes = routes;

        // An arrow that hops over another is drawn after (above) the ones it hops, so the arc reads as passing over
        // (a hop is the only `A` command in a path: corners are `Q`)
        const hops = (ed) => (routes[ed.id] && routes[ed.id].path || '').includes(' A ') ? 1 : 0;
        [...chartData.edges].sort((a, b) => hops(a) - hops(b)).forEach(edge => {
          const pathD = routes[edge.id];
          if (!pathD || !pathD.path) return;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD.path);
          path.setAttribute('class', edge.id === selectedEdgeId ? 'edge-line selected' : 'edge-line');
          path.dataset.edgeId = edge.id;
          path.dataset.from = edge.from;   // ends, so a test can find an arrow by its steps (saved ids may differ)
          path.dataset.to = edge.to;
          path.setAttribute('marker-end', edge.id === selectedEdgeId ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');

          path.addEventListener('click', (e) => {
            e.stopPropagation();
            selectEdge(edge.id);
          });

          path.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            selectEdge(edge.id, false);
            // Reuse the label's own double-click handler (makes it editable, clears the "+" placeholder)
            const labelBox = document.querySelector(`.edge-label[data-edge-id="${edge.id}"]`);
            if (labelBox) labelBox.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
          });

          // Wide invisible hit area so thin arrows are easy to click and select
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          hit.setAttribute('d', pathD.path);
          hit.setAttribute('class', 'edge-hit');
          hit.addEventListener('click', (e) => { e.stopPropagation(); selectEdge(edge.id); });
          hit.addEventListener('dblclick', (e) => path.dispatchEvent(new MouseEvent('dblclick', { bubbles: false })));
          edgeGroup.appendChild(hit);
          edgeGroup.appendChild(path);

          // Edge Label Pill
          if (pathD.midX !== undefined && pathD.midY !== undefined) {
            const labelContainer = document.createElement('div');
            labelContainer.className = 'edge-label';
            labelContainer.dataset.edgeId = edge.id;
            labelContainer.style.pointerEvents = 'auto';
            labelContainer.style.left = `${pathD.midX}px`;
            labelContainer.style.top = `${pathD.midY}px`;

            // Allow arrow labels to drop into multiple lines if 1 line exceeds the horizontal gap
            const fRect = pathD.fromRect;
            const tRect = pathD.toRect;
            let maxLabelW = LE.LABEL_MAX_W;
            if (fRect && tRect) {
              const horizGap = Math.max(tRect.x - (fRect.x + fRect.w), fRect.x - (tRect.x + tRect.w));
              if (horizGap > 0) {
                // Fit the gap with 8px clearance per side (LABEL_STUB total), never past LABEL_MAX_W
                maxLabelW = Math.max(40, Math.min(LE.LABEL_MAX_W, horizGap - LE.LABEL_STUB));
              }
            }
            labelContainer.style.setProperty('--edge-label-max-w', `${maxLabelW}px`);

            const isSelected = (edge.id === selectedEdgeId);
            const hasLabel = Boolean(edge.label && edge.label.trim());

            if (isSelected) labelContainer.classList.add('selected');
            if (hasLabel) {
              labelContainer.classList.add('has-label');
              labelContainer.title = edge.label;
            } else {
              labelContainer.classList.add('empty-placeholder');
            }

            const labelText = document.createElement('span');
            labelText.className = 'edge-label-text';
            labelText.contentEditable = 'false';
            labelText.spellcheck = false;
            labelText.dataset.tip = 'Double-click to edit the label';
            labelText.textContent = hasLabel ? edge.label : '';

            labelText.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
            });

            labelText.addEventListener('blur', () => {
              labelText.contentEditable = 'false';
              edge.label = labelText.textContent.trim();
              updateStatus(true);
              render();
            });

            labelText.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                labelText.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                labelText.textContent = edge.label || '';
                labelText.blur();
              }
            });

            labelContainer.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              const wasEmpty = labelContainer.classList.contains('empty-placeholder') && !labelContainer.classList.contains('editing');
              labelText.contentEditable = 'true';
              labelContainer.classList.add('editing');   // shows an empty label's box, hides the toolbar
              if (wasEmpty) {
                motion.anim(labelContainer, [{ transform: 'translate(-50%, -50%) scale(0.84)' }, { transform: 'translate(-50%, -50%) scale(1)' }], {
                  duration: Math.max(40, Math.round(motion.dur('dur-fast', 140) * motion.speedScale())), easing: motion.curve('curve-out')
                });
              }
              labelText.focus();
              if (hasLabel) {
                const range = document.createRange();
                range.selectNodeContents(labelText);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              }
            });

            labelContainer.appendChild(labelText);
            edgeLabelsGroup.appendChild(labelContainer); // in DOM so it can be measured below

            // Never let the box be narrower than its longest word: the width estimates above are approximate,
            // so measure the real text and widen the box if a word would otherwise be split ("approve/d")
            if (hasLabel) {
              const cs = getComputedStyle(labelText);
              const ctx = (measureLabelCtx = measureLabelCtx || document.createElement('canvas').getContext('2d'));
              ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              const words = String(edge.label).trim().split(/\s+/);
              const wordW = Math.max(...words.map(w => ctx.measureText(w).width));
              const need = Math.ceil(wordW + 16 + 3 + 4);   // padding + border + slack
              if (need > maxLabelW) labelContainer.style.setProperty('--edge-label-max-w', `${need}px`);
            }

            if (isSelected) {
              const total = path.getTotalLength();
              const popBar = !draggingNode && edge.id !== lastEdgeBarId;

              // Drag either end of the selected arrow onto another node to re-attach it. At a connector circle, the
              // handle moves the circle (onto a step) or joins another pair (onto a circle); an arrowhead dropped on a
              // circle sends the arrow into that pair (see startReconnect)
              ['from', 'to'].forEach(end => {
                const atCircle = isConnector(nodeById(end === 'from' ? edge.from : edge.to));
                const pt = path.getPointAtLength(end === 'from' ? 0 : total);
                const h = document.createElement('div');
                h.className = 'edge-end-handle' + (atCircle ? ' at-connector' : '');
                h.dataset.tip = atCircle ? 'Drag onto a step to move this circle there'
                  : end === 'from' ? 'Drag to change the source node' : 'Drag to change the target node, or onto a connector circle to send this arrow into that pair';
                h.style.left = `${pt.x}px`;
                h.style.top = `${pt.y}px`;
                h.addEventListener('pointerdown', (e) => startReconnect(e, edge, end, path));
                edgeLabelsGroup.appendChild(h);
                if (popBar) {
                  motion.anim(h, [{ transform: 'translate(-50%, -50%) scale(0.4)' }, { transform: 'translate(-50%, -50%) scale(1)' }], {
                    duration: 110, easing: motion.curve('curve-spring-tactile')
                  });
                }
              });

              const bar = buildEdgeBar(edge, labelContainer, pathD, hasLabel);
              labelContainer.after(bar);
              if (popBar && motion.enabled()) {
                const br = bar.getBoundingClientRect();
                if (br.width > 0) {
                  motion.showBar(bar);   // fades and slides in whole (its shadow with it)
                }
              }
            }

            labelContainer.addEventListener('click', (e) => {
              e.stopPropagation();
              selectEdge(edge.id, edge.id !== selectedEdgeId);   // a first click draws the toolbar
            });

            // Hovering the arrow or its label lights up both, so it is clear which label belongs to which arrow
            const setLinked = (on) => {
              path.classList.toggle('hover', on);
              labelContainer.classList.toggle('linked', on);
              if (edge.id !== selectedEdgeId) path.setAttribute('marker-end', on ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
            };
            [path, hit].forEach(el => {
              el.addEventListener('mouseenter', () => setLinked(true));
              el.addEventListener('mouseleave', () => setLinked(false));
            });
            labelContainer.addEventListener('mouseenter', () => setLinked(true));
            labelContainer.addEventListener('mouseleave', () => setLinked(false));
          }
        });
        if (!draggingNode) lastEdgeBarId = selectedEdgeId;
        applyNodeHover(); // keep the hover highlight across a re-render (e.g. while dragging)
        positionNotes();  // notes follow their nodes (a dragged node moves its note with it)
      }

      // Hovering a node highlights every arrow touching it (and its label): amber for those entering the
      // node, green for those leaving it (a self-loop counts as leaving)
      function applyNodeHover() {
        document.querySelectorAll('.edge-line, .edge-label').forEach(el => el.classList.remove('hl-in', 'hl-out'));
        document.querySelectorAll('.edge-line').forEach(p => {
          p.setAttribute('marker-end', p.dataset.edgeId === selectedEdgeId ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
        });
        // A lone selected step lights its arrows like a hover does; a hover elsewhere takes over meanwhile
        const focusId = hoveredNodeId || (selectedNodeIds.size === 1 ? selectedNodeId : null);
        if (!focusId) return;
        chartData.edges.forEach(edge => {
          const kind = edge.from === focusId ? 'out' : edge.to === focusId ? 'in' : null;
          if (!kind) return;
          const path = document.querySelector(`.edge-line[data-edge-id="${edge.id}"]`);
          const label = document.querySelector(`.edge-label[data-edge-id="${edge.id}"]`);
          if (path) {
            path.classList.add('hl-' + kind);
            path.setAttribute('marker-end', `url(#arrowhead-${kind})`);
          }
          if (label) label.classList.add('hl-' + kind);
        });
      }

      // --- NODE DRAG INTERACTION ---
      function handleNodePointerDown(e, node) {
        if (isPresenting()) return;   // read-only: a press on a step pans (isBackground), never selects or drags
        if (e.target.classList.contains('port') || e.target.isContentEditable) {
          return;
        }

        // Shift+click with a note selected links the note to this step (or unlinks it)
        if (selectedNoteId && e.shiftKey && !isPresenting()) {
          e.preventDefault();
          toggleNoteLink(selectedNoteId, node.id);
          return;
        }

        // The Note tile is waiting for a step: this one gets the note
        if (notePicking) {
          e.preventDefault();
          giveNoteTo(node.id);
          return;
        }

        if (connectingFromNodeId) {
          if (connectingFromNodeId !== node.id) {
            createConnection(connectingFromNodeId, node.id);
          }
          cancelConnecting();
          return;
        }

        e.preventDefault();
        // MULTI-SELECT: Ctrl/Cmd+click adds the step or takes it out, Shift+click selects the run from the step
        // clicked last. Neither starts a drag.
        if ((e.ctrlKey || e.metaKey) && !isPresenting()) { toggleNode(node.id); return; }
        if (e.shiftKey && !isPresenting()) { selectRun(selectedNodeId, node.id); return; }
        // A step that is one of several selected keeps the selection and drags all of it (a circle is always
        // dragged alone: it moves its end of the pair); any other step becomes the only one selected
        const group = !isConnector(node) && selectedNodeIds.size > 1 && isNodeSelected(node.id);
        if (group) { selectedNodeId = node.id; applyNoteVisibility(); } else selectNode(node.id);
        draggingNode = node;
        const laneIndexOf = (n) => Math.max(0, chartData.lanes.findIndex(l => l.id === n.laneId));
        const startOf = (n) => {
          const el = nodeElOf(n.id), p = nodePos(n);
          return {
            node: n, el, x: n.x || 0, gy: laneTopOf(n.laneId) + (n.y || 0), lane: laneIndexOf(n),
            baseLeft: el ? (parseFloat(el.style.left) || p.left) : p.left,
            baseTop: el ? (parseFloat(el.style.top) || p.top) : p.top,
            laneId: n.laneId
          };
        };
        dragGroup = group ? [...selectedNodeIds].map(nodeById).filter(n => n && n !== node && !isConnector(n)).map(startOf) : null;
        dragOrigin = startOf(node);
        dragOrigin.saved = [node, ...(dragGroup || []).map(g => g.node)].map(n => ({ node: n, x: n.x, y: n.y, laneId: n.laneId }));
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        motion.cancelAll();   // a layout animation still in flight would skew the start rect below
        const nodeEl = document.getElementById(`node-${node.id}`);
        const nRect = nodeEl.getBoundingClientRect();

        // Drag in flow terms (see flowPoint): global X along the flow from the lane track, global Y across the lanes
        dragMoved = false;
        dragCanInsert = !group && canInsert(node.type) && !nodeHasEdges(node.id);
        const dOff = dotOffset(node);   // circle nodes are drawn inset from their slot; data x/y is the slot corner
        const at = flowPoint(nRect.left, nRect.top);
        if (isTB()) {
          dragStartGlobalX = at.gx - dOff.y - flowInset(node);
          dragStartGlobalY = at.gy - dOff.x;
        } else {
          dragStartGlobalX = at.gx - dOff.x;
          dragStartGlobalY = at.gy - dOff.y;
        }

        window.addEventListener('pointermove', onDragNodeMove);
        window.addEventListener('pointerup', onDragNodeUp);
      }

      function onDragNodeMove(e) {
        if (!draggingNode) return;
        if (!dragMoved && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < 4) return;
        dragMoved = true;
        const sdx = (e.clientX - dragStartX) / scale;
        const sdy = (e.clientY - dragStartY) / scale;
        const [dx, dy] = isTB() ? [sdy, sdx] : [sdx, sdy];   // along / across the flow

        const nodeEl = document.getElementById(`node-${draggingNode.id}`);
        const nh = crossSize(draggingNode);

        const currGlobalX = dragStartGlobalX + dx;
        const currGlobalY = dragStartGlobalY + dy;

        // Locate target swimlane containing the center of the dragged node
        const nodeCenterY = currGlobalY + nh / 2;
        let targetLane = chartData.lanes[0];
        let targetLaneTop = 0;
        let cumulativeY = 0;

        for (let i = 0; i < chartData.lanes.length; i++) {
          const lane = chartData.lanes[i];
          const lh = lane.height || LE.LANE_MIN;
          if (nodeCenterY >= cumulativeY && nodeCenterY < cumulativeY + lh) {
            targetLane = lane;
            targetLaneTop = cumulativeY;
            break;
          }
          if (i === chartData.lanes.length - 1 && nodeCenterY >= cumulativeY) {
            targetLane = lane;
            targetLaneTop = cumulativeY;
          }
          cumulativeY += lh;
        }

        // Align to 4px grid. With auto layout on, the drop only picks the lane (or an arrow to insert into) and the
        // re-layout decides where the step sits, so there is nothing to snap to. Off, snap to other nodes' and
        // lane centers when close
        let gridX = Math.max(16, Math.round(currGlobalX / 4) * 4);
        let gridY = Math.round(currGlobalY / 4) * 4;
        if (!autoLayout) {
          const snap = computeSnap(draggingNode, flowSize(draggingNode, nodeEl), nh, currGlobalX, currGlobalY);
          if (snap.x !== null) gridX = Math.max(16, Math.round(snap.x));
          if (snap.y !== null) gridY = Math.round(snap.y);
          showSnapGuides(snap);
        }
        const localX = gridX;
        const localY = Math.max(12, gridY - targetLaneTop);

        draggingNode.x = localX;
        draggingNode.y = localY;
        draggingNode.laneId = targetLane.id;

        const moveDragItem = (item) => {
          const { node: n, el } = item;
          if (!el) return;
          const p = nodePos(n);
          if (n.laneId !== item.laneId) {
            item.laneId = n.laneId;
            const track = document.querySelector(`.lane-track[data-lane-id="${n.laneId}"]`);
            if (track && el.parentElement !== track) track.appendChild(el);
            item.baseLeft = p.left; item.baseTop = p.top;
            el.style.left = `${p.left}px`;
            el.style.top = `${p.top}px`;
            el.style.translate = '';
          } else {
            el.style.translate = `${p.left - item.baseLeft}px ${p.top - item.baseTop}px`;
          }
          el.style.scale = '1.02';
          el.classList.add('dragging');
        };
        moveDragItem(dragOrigin);
        // The other selected steps move by the same distance and the same number of lanes (held within the first
        // and last lane), so a selection that spans lanes keeps its shape
        if (dragGroup) {
          const ddx = localX - dragOrigin.x, ddy = targetLaneTop + localY - dragOrigin.gy;
          const dLane = chartData.lanes.indexOf(targetLane) - dragOrigin.lane, last = chartData.lanes.length - 1;
          dragGroup.forEach(g => {
            const lane = chartData.lanes[Math.max(0, Math.min(last, g.lane + dLane))];
            g.node.x = Math.max(16, g.x + ddx);
            g.node.y = g.gy + ddy - laneTopOf(lane.id);
            g.node.laneId = lane.id;
            moveDragItem(g);
          });
        }
        if (isConnector(draggingNode)) markConnectorTarget(stepUnder(e.clientX, e.clientY, draggingNode.id));
        positionNotes();

        // An unconnected node over an arrow offers to be inserted into it. Connected steps offer it only while Alt
        // is held, and only as a run (see REORDER): without Alt a drag across lanes never rewires anything.
        let target = null;
        if (dragCanInsert) {
          const c = toContainer(e.clientX, e.clientY);
          target = edgeNear(c.x, c.y, draggingNode.id);
          if (target) hideSnapGuides();
          setInsertTarget(target);
        } else if (e.altKey && !isConnector(draggingNode)) {
          const run = runOf(draggedIds());
          if (run) {
            const c = toContainer(e.clientX, e.clientY);
            target = edgeNear(c.x, c.y, run.set);
            if (target) hideSnapGuides();
          } else {
            flashHint(RUN_HINT);
          }
          setInsertTarget(target, 'Move here');
        } else if (insertTarget) {
          setInsertTarget(null);
        }

        // Highlight active target swimlane
        document.querySelectorAll('.lane-track').forEach(t => {
          t.classList.toggle('drag-hover-lane', !target && t.dataset.laneId === targetLane.id);
        });

        // A node without arrows changes no route of its own; re-routing the others around it would make the
        // arrow under the pointer jump away, so wait for the drop.
        // The same holds while Alt looks for an arrow to move a run into.
        if (dragCanInsert || e.altKey) return;

        // Re-route at most once per frame: pointer events can arrive faster than a full route pass,
        // and handling each one synchronously queues them up so the node trails the cursor
        if (!dragEdgeFrame) {
          dragEdgeFrame = requestAnimationFrame(() => { dragEdgeFrame = 0; renderEdges(); });
        }
      }

      // --- SNAP-TO-ALIGNMENT HELPERS (manual layout: auto layout off) ---
      const SNAP_THRESHOLD = 6; // px (unscaled diagram units)

      function laneTopOf(laneId) {
        let top = 0;
        for (const lane of chartData.lanes) {
          if (lane.id === laneId) return top;
          top += lane.height || LE.LANE_MIN;
        }
        return top;
      }

      // Returns {x, y} snapped top-left (global flow coords: x along the flow, y across the lanes; null = no snap)
      // plus guide positions. w/h are the node's extent along/across the flow.
      function computeSnap(dragNode, w, h, gx, gy) {
        let bestX = null, bestY = null; // {delta, pos}
        const mine = {
          x: [gx, gx + w / 2, gx + w],
          y: [gy, gy + h / 2, gy + h]
        };
        chartData.nodes.forEach(n => {
          if (n.id === dragNode.id) return;
          const el = document.getElementById(`node-${n.id}`);
          const nw = flowSize(n, el);
          const nhh = crossSize(n);
          const nx = n.x || 0;
          const ny = laneTopOf(n.laneId) + (n.y || 0);
          const tx = [nx, nx + nw / 2, nx + nw];
          const ty = [ny, ny + nhh / 2, ny + nhh];
          // Center-to-center alignment only
          const dx = tx[1] - mine.x[1];
          if (Math.abs(dx) <= SNAP_THRESHOLD && (!bestX || Math.abs(dx) < Math.abs(bestX.delta))) bestX = { delta: dx, pos: tx[1] };
          const dy = ty[1] - mine.y[1];
          if (Math.abs(dy) <= SNAP_THRESHOLD && (!bestY || Math.abs(dy) < Math.abs(bestY.delta))) bestY = { delta: dy, pos: ty[1] };
        });
        // Lane vertical centers (the horizontal midline of each swimlane)
        let laneTop = 0;
        chartData.lanes.forEach(lane => {
          const lh = lane.height || LE.LANE_MIN;
          const dy = (laneTop + lh / 2) - mine.y[1];
          if (Math.abs(dy) <= SNAP_THRESHOLD && (!bestY || Math.abs(dy) < Math.abs(bestY.delta))) bestY = { delta: dy, pos: laneTop + lh / 2 };
          laneTop += lh;
        });
        return {
          x: bestX ? gx + bestX.delta : null,
          y: bestY ? gy + bestY.delta : null,
          guideX: bestX ? bestX.pos : null,
          guideY: bestY ? bestY.pos : null
        };
      }

      function getSnapGuide(id, cls) {
        let g = document.getElementById(id);
        if (!g) {
          g = document.createElement('div');
          g.id = id;
          g.className = `snap-guide ${cls}`;
          swimlanesContainer.appendChild(g);
        }
        return g;
      }

      // guideX is a position along the flow, guideY across the lanes: top-to-bottom, those are drawn as a
      // horizontal and a vertical line respectively
      function showSnapGuides(snap) {
        const vGuide = getSnapGuide('snap-guide-v', 'snap-guide-v');
        const hGuide = getSnapGuide('snap-guide-h', 'snap-guide-h');
        const [flowGuide, crossGuide] = isTB() ? [hGuide, vGuide] : [vGuide, hGuide];
        const flowProp = isTB() ? 'top' : 'left', crossProp = isTB() ? 'left' : 'top';
        const showGuide = (el, prop, val, axis) => {
          if (val !== null) {
            const wasHidden = el.style.display !== 'block';
            el.style[prop] = `${val}px`;
            el.style.display = 'block';
            if (wasHidden && motion.enabled()) motion.anim(el, [{ transform: axis }, { transform: 'none' }], { duration: 90, easing: motion.curve('curve-out') });
          } else el.style.display = 'none';
        };
        showGuide(flowGuide, flowProp, snap.guideX !== null ? trackOffset() + snap.guideX : null, isTB() ? 'scaleX(0)' : 'scaleY(0)');
        showGuide(crossGuide, crossProp, snap.guideY, isTB() ? 'scaleY(0)' : 'scaleX(0)');
      }

      function hideSnapGuides() {
        document.querySelectorAll('.snap-guide').forEach(g => g.style.display = 'none');
      }

      function onDragNodeUp(e) {
        if (dragEdgeFrame) { cancelAnimationFrame(dragEdgeFrame); dragEdgeFrame = 0; }
        hideSnapGuides();
        document.querySelectorAll('.lane-track').forEach(t => t.classList.remove('drag-hover-lane'));
        const target = insertTarget;
        setInsertTarget(null);
        if (draggingNode) {
          const node = draggingNode, group = dragGroup, origin = dragOrigin;
          const ids = draggedIds();
          draggingNode = null;
          dragGroup = null;
          dragOrigin = null;
          const clearDrag = (n) => { const el = nodeElOf(n.id); if (el) { el.classList.remove('dragging'); placeNodeEl(el, n); } };
          clearDrag(node);
          if (group) group.forEach(g => clearDrag(g.node));
          if (dragMoved && isConnector(node)) {
            // A circle dropped on a step moves that end of the pair there; dropped anywhere else it goes back
            const stepId = stepUnder(e.clientX, e.clientY, node.id);
            markConnectorTarget(null);
            if (!stepId || !moveConnectorTo(node, stepId)) placeCirclesOnly();
          } else if (dragMoved && target) {
            moveRunIntoEdge(ids, target.edgeId, e.clientX, e.clientY, node.id);
          } else if (dragMoved && e.altKey && !dragCanInsert && !runOf(ids)) {
            // Alt asked for a move into an arrow, but this is not a run: everything goes back where it was
            withMotion(() => {
              origin.saved.forEach(o => { o.node.x = o.x; o.node.y = o.y; o.node.laneId = o.laneId; });
              render();
            }, { duration: 190, skipFreeNotes: true });
            flashHint(RUN_HINT);
          } else if (dragMoved && group) {
            finishStepMove([node, ...group.map(g => g.node)]);
          } else if (dragMoved) {
            relayout();   // the lane it was dropped in is kept; its place in the lane comes from the flow
          } else if (group) {
            selectNode(node.id);   // a click (no drag) on one of several selected steps selects only that one
          }
          dragMoved = false;
        }
        dragCanInsert = false;
        window.removeEventListener('pointermove', onDragNodeMove);
        window.removeEventListener('pointerup', onDragNodeUp);
      }

      // --- CONNECTION HANDLING (DRAG OR CLICK-TO-CONNECT) ---
      function handlePortPointerDown(e, nodeId, port) {
        e.stopPropagation();
        e.preventDefault();

        if (connectingFromNodeId && connectingFromNodeId === nodeId) {
          cancelConnecting();
          return;
        }

        startConnecting(e, nodeId, port);
      }

      function startConnecting(e, nodeId, port) {
        connectingFromNodeId = nodeId;
        connectingFromPort = port;
        connectingDownAt = { x: e.clientX, y: e.clientY };
        document.body.classList.add('connecting');

        const fromEl = document.getElementById(`node-${nodeId}`);
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const fRect = fromEl.getBoundingClientRect();

        let sx, sy;
        if (port === 'right') {
          sx = (fRect.right - stageRect.left) / scale;
          sy = (fRect.top + fRect.height / 2 - stageRect.top) / scale;
        } else if (port === 'left') {
          sx = (fRect.left - stageRect.left) / scale;
          sy = (fRect.top + fRect.height / 2 - stageRect.top) / scale;
        } else if (port === 'top') {
          sx = (fRect.left + fRect.width / 2 - stageRect.left) / scale;
          sy = (fRect.top - stageRect.top) / scale;
        } else {
          sx = (fRect.left + fRect.width / 2 - stageRect.left) / scale;
          sy = (fRect.bottom - stageRect.top) / scale;
        }

        connectingStartPoint = { sx, sy };
        dragEdge.style.display = 'block';
        dragEdge.setAttribute('d', `M ${sx} ${sy} L ${sx} ${sy}`);

        window.addEventListener('pointermove', onConnectingMove);
        window.addEventListener('pointerup', onConnectingPointerUp);
      }

      function onConnectingMove(ev) {
        if (!connectingStartPoint) return;
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const mx = (ev.clientX - stageRect.left) / scale;
        const my = (ev.clientY - stageRect.top) / scale;

        dragEdge.setAttribute('d', `M ${connectingStartPoint.sx} ${connectingStartPoint.sy} L ${mx} ${my}`);

        document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('connect-target'));
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetNodeEl = targetEl ? targetEl.closest('.flow-node') : null;
        if (targetNodeEl && targetNodeEl.dataset.nodeId !== connectingFromNodeId) {
          targetNodeEl.classList.add('connect-target');
        }
      }

      function onConnectingPointerUp(ev) {
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetNodeEl = targetEl ? targetEl.closest('.flow-node') : null;

        // A click on the anchor (not dragged; the anchor itself ignores the pointer while connecting, so a release
        // there may land on the lane): connect to the nearest step in its direction
        if (connectingDownAt && connectingFromPort && Math.hypot(ev.clientX - connectingDownAt.x, ev.clientY - connectingDownAt.y) < 6) {
          const t = nearestNodeInDirection(connectingFromNodeId, connectingFromPort);
          if (t) createConnection(connectingFromNodeId, t);
          else flashHint('No step in that direction');
          cancelConnecting();
          return;
        }

        if (targetNodeEl) {
          const targetNodeId = targetNodeEl.dataset.nodeId;
          if (targetNodeId && targetNodeId !== connectingFromNodeId) {
            createConnection(connectingFromNodeId, targetNodeId);
            cancelConnecting();
            return;
          }
        }

        // Released away from any node: drop the connection attempt
        cancelConnecting();
      }

      // Closest step whose centre lies in the port's direction (within a 45° cone), skipping connectors and steps
      // already linked from the source
      function nearestNodeInDirection(fromId, port) {
        const fromEl = document.getElementById(`node-${fromId}`);
        if (!fromEl) return null;
        const fr = fromEl.getBoundingClientRect();
        const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
        const dir = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] }[port];
        let best = null, bestD = Infinity;
        document.querySelectorAll('.flow-node').forEach(el => {
          const id = el.dataset.nodeId;
          if (!id || id === fromId || isConnector(nodeById(id))) return;
          if (chartData.edges.some(e => e.from === fromId && e.to === id)) return;
          const r = el.getBoundingClientRect();
          const dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
          const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1] + dy * dir[0]);
          if (along <= 0 || across > along) return;
          const d = Math.hypot(dx, dy);
          if (d < bestD) { bestD = d; best = id; }
        });
        return best;
      }

      // --- RE-ATTACH AN EXISTING ARROW END TO A DIFFERENT NODE ---
      function startReconnect(e, edge, end, path) {
        e.stopPropagation();
        e.preventDefault();
        const total = path.getTotalLength();
        const fixed = path.getPointAtLength(end === 'from' ? total : 0); // the end that stays put
        const otherId = end === 'from' ? edge.to : edge.from;
        document.body.classList.add('reconnecting');
        path.style.opacity = '0.35';
        dragEdge.style.display = 'block';
        const toLocal = (ev) => {
          const r = swimlanesContainer.getBoundingClientRect();
          return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
        };
        const nodeAt = (ev) => {
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          return el ? el.closest('.flow-node') : null;
        };
        const draw = (ev) => {
          const m = toLocal(ev);
          dragEdge.setAttribute('d', end === 'from'
            ? `M ${m.x} ${m.y} L ${fixed.x} ${fixed.y}`
            : `M ${fixed.x} ${fixed.y} L ${m.x} ${m.y}`);
        };
        draw(e);
        const move = (ev) => {
          draw(ev);
          document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('connect-target'));
          const n = nodeAt(ev);
          if (n && n.dataset.nodeId !== otherId) n.classList.add('connect-target');
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.classList.remove('reconnecting');
          dragEdge.style.display = 'none';
          document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('connect-target'));
          const n = nodeAt(ev);
          const newId = n ? n.dataset.nodeId : null;
          const current = end === 'from' ? edge.from : edge.to;
          // Connector ends: an arrowhead dropped on a circle sends the arrow into that pair; a circle's end of a stub
          // dropped on a step moves the circle there (like dragging the circle itself)
          if (newId && newId !== current && isConnector(nodeById(newId))) {
            if (end === 'to' && !isConnector(nodeById(edge.from)) && joinEdgeTo(edge, connectorLetter(nodeById(newId)))) return;
            if (end === 'from') flashHint('An arrow can flow into a connector pair, not out of one: drop its arrowhead on the circle');
            renderEdges();
            return;
          }
          if (newId && newId !== current && isConnector(nodeById(current))) {
            if (!moveConnectorTo(nodeById(current), newId)) renderEdges();
            return;
          }
          if (newId && newId !== otherId && newId !== current) {
            const f = end === 'from' ? newId : edge.from;
            const t = end === 'to' ? newId : edge.to;
            if (!chartData.edges.some(x => x !== edge && x.from === f && x.to === t)) {
              edge.from = f;
              edge.to = t;
              updateStatus(true);
              // A stub re-attached to another step: its circle follows to that step (steps stay put)
              if (isConnector(nodeById(edge.from)) || isConnector(nodeById(edge.to))) { placeCirclesOnly(); return; }
              renderEdges();
              motion.drawPath(edgeGroup.querySelector(`.edge-line[data-edge-id="${CSS.escape(edge.id)}"]`), { duration: 140, easing: 'curve-out' });
              return;
            }
          }
          renderEdges();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }

      function createConnection(fromId, toId) {
        const existing = chartData.edges.find(e => e.from === fromId && e.to === toId);
        if (existing) return;
        // A pair is never wired by hand: connectors come from splitting an arrow
        if (isConnector(nodeById(fromId)) || isConnector(nodeById(toId))) {
          flashHint('Connectors are made by splitting an arrow (select it, then Split)');
          return;
        }

        const fromNode = chartData.nodes.find(n => n.id === fromId);
        const defaultLabel = (fromNode && fromNode.type === 'decision') ? 'Yes' : '';

        const newEdge = {
          id: `e_${Date.now()}`,
          from: fromId,
          to: toId,
          label: defaultLabel
        };
        chartData.edges.push(newEdge);
        updateStatus(true);
        renderEdges();
        selectEdge(newEdge.id);
        motion.drawPath(edgeGroup.querySelector(`.edge-line[data-edge-id="${CSS.escape(newEdge.id)}"]`), { duration: 140, easing: 'curve-out' });

        setTimeout(() => {
          const labelTextEl = document.querySelector(`.edge-label[data-edge-id="${newEdge.id}"] .edge-label-text`);
          if (labelTextEl) {
            labelTextEl.focus();
            const range = document.createRange();
            range.selectNodeContents(labelTextEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }, 50);
      }

      function cancelConnecting() {
        connectingFromNodeId = null;
        connectingFromPort = null;
        connectingDownAt = null;
        connectingStartPoint = null;
        document.body.classList.remove('connecting');
        dragEdge.style.display = 'none';
        document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('connect-target'));

        window.removeEventListener('pointermove', onConnectingMove);
        window.removeEventListener('pointerup', onConnectingPointerUp);
      }

      // --- SELECTION & DELETION ---
      function markSelectedLane() {
        lanesRoot.querySelectorAll('.swimlane').forEach(l => l.classList.toggle('lane-selected', l.dataset.laneId === selectedLaneId));
      }

      function selectLane(laneId) {
        const hadEdge = selectedEdgeId;
        const prevBar = lanesRoot.querySelector('.lane-selected .lane-bar');
        selectedLaneId = laneId;
        clearNodeSelection();
        selectedEdgeId = null;
        if (hadEdge) renderEdges();
        markSelectedLane();
        const nextBar = lanesRoot.querySelector('.lane-selected .lane-bar');
        if (nextBar && nextBar !== prevBar && motion.enabled()) {
          const nr = nextBar.getBoundingClientRect();
          if (nr.width > 0) {
            motion.showBar(nextBar);
          }
        }
      }

      // Removes a lane together with its steps and every arrow attached to them (one undo step).
      // The last remaining lane cannot be deleted: every step needs a lane.
      function deleteLane(laneId) {
        if (chartData.lanes.length <= 1 || !chartData.lanes.some(l => l.id === laneId) || laneUsedElsewhere(laneId)) return;
        withMotion(() => {
          if (chartData.flows) chartData.actors = chartData.actors.filter(a => a.id !== laneId || laneUsedElsewhere(laneId, true));
          const gone = new Set(chartData.nodes.filter(n => n.laneId === laneId).map(n => n.id));
          chartData.lanes = chartData.lanes.filter(l => l.id !== laneId);
          chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
          chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
          dropChildOf([...gone]);
          pruneConnectors();   // a pair with one end in the lane goes with it
          pruneNotes();
          selectedLaneId = null;
          relayout();
        }, { ghostExit: true, duration: 210, skipFreeNotes: true });
      }

      // Deleting a lane also deletes its steps, so it is confirmed first: a small popover under the delete button
      // (or under the lane's pill for the Delete key). Escape, Cancel, a click elsewhere or a pan/zoom dismisses it.
      function confirmDeleteLane(laneId, anchorEl) {
        ui.closeConfirm();
        const lane = chartData.lanes.find(l => l.id === laneId);
        if (!lane || chartData.lanes.length <= 1) return;
        if (laneUsedElsewhere(laneId)) { flashHint(`\u201c${lane.name}\u201d has steps in another flow: delete or move them there first.`); return; }
        const steps = chartData.nodes.filter(n => n.laneId === laneId).length;
        // Under the anchor (a delete button, else the lane's pill), or above it when there is no room below
        // (the dock's Delete sits at the bottom of the window); kept on screen
        ui.confirm(anchorEl || lanesRoot.querySelector(`.swimlane[data-lane-id="${laneId}"] .lane-pill`), {
          title: `Delete \u201c${lane.name}\u201d?`,
          message: steps ? `Its ${steps} step${steps === 1 ? '' : 's'} and their arrows will be deleted too.` : 'This lane is empty.',
          label: 'Delete swimlane',
          ok: 'Delete lane',
        }, () => deleteLane(laneId));
      }

      function selectNode(nodeId) {
        const hadEdge = !!selectedEdgeId;
        selectedNodeId = nodeId;
        selectedNodeIds = new Set(nodeId ? [nodeId] : []);
        selectedEdgeId = null;
        selectedNoteId = null;
        if (selectedLaneId) { selectedLaneId = null; markSelectedLane(); }
        markSelectedNodes();
        if (hadEdge) renderEdges();
        applyNoteVisibility();   // a selected node shows its note
      }

      // --- MULTI-SELECT (steps only) ---
      // selectedNodeIds holds every selected step and selectedNodeId the primary (the one clicked last), which is all
      // that notes, the N key and note linking look at. Ctrl/Cmd+click toggles a step, Shift+click selects the run
      // along the arrows from the primary, Shift+drag on blank canvas draws a box (the shell calls selectInRect) and
      // Ctrl/Cmd+A selects every step (selectAll). Delete, a drag and Alt+arrows then act on the whole selection as
      // one edit. Arrows, notes and lanes are still selected one at a time, and selecting one clears the steps.
      // The selection is never saved.
      const isNodeSelected = (id) => selectedNodeIds.has(id);
      let boxBase = [];   // the selection a toggle box started from (selectInRect)

      // Show the selection: the outline on each selected step, and the count on the dock's Delete ("Delete 3").
      // With several selected, .multi-select hides the connect ports so a drag always moves the selection.
      function markSelectedNodes() {
        const many = selectedNodeIds.size > 1;
        document.querySelectorAll('.flow-node[data-node-id]').forEach(el => el.classList.toggle('selected', isNodeSelected(el.dataset.nodeId)));
        swimlanesContainer.classList.toggle('multi-select', many);
        updateSubButtons();
        applyNodeHover();
        syncNodeBar();
      }

      // The selected step's action bar (components/actionbar.css), in its node: Note (one step), Go to partner (a circle) and Delete. It sits over the
      // node, or under it when there is no room above in the window (placeNodeBar, also run when the view moves).
      let lastNodeBarKey = null;   // which selection the bar was last drawn for: a redraw of the same one makes no entrance
      function syncNodeBar() {
        const el = selectedNodeId && selectedNodeIds.has(selectedNodeId) && !isPresenting() ? nodeElOf(selectedNodeId) : null;
        const key = el ? `${selectedNodeId}:${selectedNodeIds.size}` : null;
        const same = key !== null && key === lastNodeBarKey;
        lastNodeBarKey = key;
        // another step: the old bar closes, then the new one opens in its own place
        document.querySelectorAll('.node-bar').forEach(b => { if (same) b.remove(); else motion.hideBar(b); });
        if (!el) return;
        const many = selectedNodeIds.size > 1, node = nodeById(selectedNodeId);
        const bar = ui.actionBar('actionbar node-bar', 'Step');
        const btn = (act, html, title, extra) => ui.abButton('ab-btn', act, html, title, undefined, undefined, extra);
        if (!many && isConnector(node) && connectorPartners(node).length) bar.appendChild(btn('goto', ui.icon('arrow-right'), 'Go to the other circle of this pair'));
        if (!many && !isConnector(node)) bar.appendChild(btn('note', ui.icon('note'), 'Add a note (N)'));
        bar.appendChild(btn('delete', many ? `${ui.icon('trash')}<span>Delete ${selectedNodeIds.size}</span>` : ui.icon('trash'), many ? `Delete these ${selectedNodeIds.size} steps` : 'Delete (Delete key)', 'is-danger'));
        ['pointerdown', 'mousedown', 'dblclick'].forEach(t => bar.addEventListener(t, (e) => e.stopPropagation()));
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          const b = e.target.closest('.ab-btn');
          if (!b) return;
          if (b.dataset.act === 'note') addNoteTo(selectedNodeId);
          else if (b.dataset.act === 'goto') jumpToPartner(node);
          else if (many) deleteNodes([...selectedNodeIds]);
          else deleteNode(selectedNodeId);
        });
        el.appendChild(bar);
        placeNodeBar();
        if (!same) motion.showBar(bar);
      }
      function placeNodeBar() {
        const bar = document.querySelector('.node-bar');
        if (!bar) return;
        bar.classList.toggle('is-below', !ui.roomAbove(bar.parentElement, bar));
      }

      function clearNodeSelection() {
        selectedNodeId = null;
        selectedNodeIds.clear();
        markSelectedNodes();
      }

      // Drop ids whose step is gone (deleted by an undo or redo)
      function pruneNodeSelection() {
        if (!selectedNodeIds.size) return;
        selectedNodeIds.forEach(id => { if (!nodeById(id)) selectedNodeIds.delete(id); });
        if (!selectedNodeIds.has(selectedNodeId)) selectedNodeId = [...selectedNodeIds].pop() || null;
        markSelectedNodes();
      }

      // Select exactly `ids`. The primary is `primary` when it is among them, else the last of them. Like
      // selectNode, a step selection replaces a selected arrow, note or lane.
      function setNodeSelection(ids, primary) {
        const hadEdge = !!selectedEdgeId;
        selectedEdgeId = null;
        selectedNoteId = null;
        if (selectedLaneId) { selectedLaneId = null; markSelectedLane(); }
        selectedNodeIds = new Set(ids.filter(id => nodeById(id)));
        selectedNodeId = selectedNodeIds.has(primary) ? primary : ([...selectedNodeIds].pop() || null);
        markSelectedNodes();
        if (hadEdge) renderEdges();
        applyNoteVisibility();   // the primary shows its note
        queueDeleteRefresh();
      }

      // Ctrl/Cmd+click: add the step to the selection, or take it out
      function toggleNode(id) {
        const ids = [...selectedNodeIds].filter(x => x !== id);
        if (!isNodeSelected(id)) ids.push(id);
        setNodeSelection(ids, id);
      }

      // mode: 'replace' (select only these), 'add', or 'toggle' (each one is added or taken out)
      function selectNodes(ids, mode = 'replace') {
        const next = new Set(mode === 'replace' ? [] : selectedNodeIds);
        ids.forEach(id => { if (mode === 'toggle' && next.has(id)) next.delete(id); else next.add(id); });
        setNodeSelection([...next], mode === 'replace' ? selectedNodeId : ids[ids.length - 1]);
      }

      // Shortest path along the arrows from one step to another, or null. Loop-backs (feedback arrows) are not
      // followed, so a range never grows into a whole loop. A connector pair is one hop: circle in -> circle out.
      function flowPath(fromId, toId) {
        const prev = new Map([[fromId, null]]), queue = [fromId];
        while (queue.length) {
          const id = queue.shift();
          if (id === toId) {
            const path = [];
            for (let p = id; p; p = prev.get(p)) path.unshift(p);
            return path;
          }
          const next = chartData.edges.filter(e => e.from === id && !e.feedback).map(e => e.to);
          const node = nodeById(id);
          if (isConnector(node) && connectorRole(id) === 'in') connectorPartners(node).forEach(p => next.push(p.id));
          next.forEach(n => { if (!prev.has(n)) { prev.set(n, id); queue.push(n); } });
        }
        return null;
      }

      // Shift+click: the run of steps along the flow between the primary and this step (forward first, then
      // backward). With no path between them the step is added, as with Ctrl/Cmd+click.
      function selectRun(fromId, toId) {
        if (!fromId || !nodeById(fromId)) { selectNode(toId); return; }
        const path = flowPath(fromId, toId) || flowPath(toId, fromId);
        if (path) setNodeSelection(path, toId); else selectNodes([toId], 'add');
      }

      function selectEdge(edgeId, reRender = true) {
        // The Connector tile is waiting for an arrow: this one is split
        if (connectorPicking) {
          setConnectorPicking(false);
          if (canSplitEdge(edgeId)) { splitEdge(edgeId); return; }
          flashHint('That arrow already ends at a connector');
        }
        selectedEdgeId = edgeId;
        clearNodeSelection();
        selectedNoteId = null;
        applyNoteVisibility();
        if (selectedLaneId) { selectedLaneId = null; markSelectedLane(); }
        if (reRender) {
          renderEdges();
        } else {
          document.querySelectorAll('.edge-line').forEach(p => {
            const isMatch = (p.dataset.edgeId === edgeId);
            p.classList.toggle('selected', isMatch);
            p.setAttribute('marker-end', isMatch ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
          });
          document.querySelectorAll('.edge-label').forEach(c => {
            c.classList.toggle('selected', c.dataset.edgeId === edgeId);
          });
        }
      }

      function deleteNode(nodeId, confirmed) {
        const node = nodeById(nodeId);
        if (isConnector(node)) { joinConnector(node); return; }   // deleting a connector puts the whole arrow back
        if (!confirmed && askSubDelete([nodeId])) return;   // a subprocess with content: Merge / Delete everything / Cancel
        withMotion(() => {
          chartData.nodes = chartData.nodes.filter(n => n.id !== nodeId);
          chartData.edges = chartData.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
          dropChildOf([nodeId]);
          pruneConnectors();   // a pair attached to this step goes with it
          pruneNotes();   // its notes lose the link (a note explaining only this step goes with it)
          clearNodeSelection();
          relayout();
        }, { ghostExit: true, ghosts: true, duration: 200, skipFreeNotes: true });
      }

      // Delete several steps as one edit, so one undo brings them all back. Like a single delete, the arrows around
      // the hole go with it (no bridging).
      function deleteNodes(ids, confirmed) {
        if (!confirmed && askSubDelete(ids)) return;
        withMotion(() => {
          const gone = new Set(ids.filter(id => nodeById(id) && !isConnector(nodeById(id))));
          chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
          chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
          dropChildOf([...gone]);
          pruneConnectors();   // a pair attached to a deleted step goes with it
          // A selected circle whose pair is still there: the whole arrow comes back, as when it is deleted alone
          ids.forEach(id => { const n = nodeById(id); if (isConnector(n)) joinConnectorData(n); });
          pruneConnectors();
          pruneNotes();
          clearNodeSelection();
          relayout();
        }, { ghostExit: true, ghosts: true, duration: 200, skipFreeNotes: true });
      }

      function deleteEdge(edgeId) {
        retractSvgLine(edgeGroup.querySelector(`.edge-line[data-edge-id="${CSS.escape(edgeId)}"]`));
        withMotion(() => {
          const before = chartData.nodes.length;
          chartData.edges = chartData.edges.filter(e => e.id !== edgeId);
          pruneConnectors();   // deleting either stub of a split arrow deletes the whole arrow
          selectedEdgeId = null;
          updateStatus(true);
          if (chartData.nodes.length !== before) render(); else renderEdges();
        }, { ghostExit: true, ghosts: true, duration: 180, skipFreeNotes: true });
      }

      // --- ADD ELEMENTS ---
      // Lane + lane-local top-left for a node of size nw x nh centred on a screen point
      // nw/nh: the node's extent along/across the flow (typeFlowSize / typeCrossSize)
      function placementAt(clientX, clientY, nw, nh) {
        const { gx, gy } = flowPoint(clientX, clientY);
        let top = 0, lane = chartData.lanes[0];
        for (let i = 0; i < chartData.lanes.length; i++) {
          const l = chartData.lanes[i];
          const lh = l.height || LE.LANE_MIN;
          lane = l;
          if (gy < top + lh) break;
          if (i < chartData.lanes.length - 1) top += lh;
        }
        return {
          laneId: lane ? lane.id : "lane-1",
          laneTop: top,
          x: Math.max(16, Math.round((gx - nw / 2) / 4) * 4),
          y: Math.max(12, Math.round((gy - top - nh / 2) / 4) * 4)
        };
      }

      // Place a new node at the center of the visible viewport
      function viewportCenterPlacement(nw, nh) {
        const vp = viewport.getBoundingClientRect();
        return placementAt(vp.left + vp.width / 2, vp.top + vp.height / 2, nw, nh);
      }

      const NODE_DEFAULTS = {
        start: 'Start', end: 'End', task: 'New Step', decision: 'Decision?',
        subprocess: 'Subprocess', io: 'Input / Output', document: 'New Document', database: 'Database', delay: 'Wait',
      };
      const nodeHeightOf = (type) => (type === 'decision' ? DECISION_HEIGHT : NODE_HEIGHT);
      const typeFlowSize = (type) => (isTB() ? DECISION_HEIGHT : NODE_WIDTH);
      const typeCrossSize = (type) => (isTB() ? NODE_WIDTH : nodeHeightOf(type));

      // Ids that cannot collide even when two are made in the same millisecond
      function uid(prefix) {
        let id = `${prefix}_${Date.now()}`, k = 1;
        while (chartData.nodes.some(n => n.id === id) || chartData.edges.some(e => e.id === id)) id = `${prefix}_${Date.now()}_${k++}`;
        return id;
      }

      function makeNode(type, p) {
        const node = { id: uid('n'), laneId: p.laneId, type, label: NODE_DEFAULTS[type] || 'New Step', x: p.x, y: p.y };
        chartData.nodes.push(node);
        if (type === 'subprocess' && canNest(curTab())) addEmptyChild(node);   // a new subprocess gets its own tab (up to MAX_FLOW_DEPTH)
        return node;
      }

      function addNodeAt(type, p) {
        let node;
        withMotion(() => {
          node = makeNode(type, p);
          render();              // draw it where it was dropped first, so relayout can keep it there on screen
          relayout(node.id);
          selectNode(node.id);
        }, { duration: 200, enterScale: 0.84, easing: 'curve-spring-tactile', skipFreeNotes: true });
        return node;
      }

      // Click (no drag) on a dock shape: drop it at the centre of the view, as before
      document.querySelectorAll('[data-node-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          if (btn.dataset.dragged) { delete btn.dataset.dragged; e.preventDefault(); return; }
          if (btn.disabled) return;
          const type = btn.dataset.nodeType;
          addNodeAt(type, viewportCenterPlacement(typeFlowSize(type), typeCrossSize(type)));
        });
        btn.addEventListener('pointerdown', (e) => startPaletteDrag(e, btn));
      });

      // --- INSERT INTO AN ARROW ---
      // Dropping a step, decision or classic shape onto an arrow A->B rewires it to A->new->B and re-runs the layout,
      // so the new node lands between the two. Only new shapes and nodes without arrows can be inserted:
      // moving an already-connected node never rewires anything.
      const INSERT_RANGE = 20;   // diagram px between the pointer and the arrow
      const canInsert = (type) => type !== 'start' && type !== 'end' && type !== 'connector';
      const nodeHasEdges = (id) => chartData.edges.some(e => e.from === id || e.to === id);

      function toContainer(clientX, clientY) {
        const r = swimlanesContainer.getBoundingClientRect();
        return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
      }

      // Nearest arrow whose route passes within INSERT_RANGE of (px, py), with the closest point on it
      // (not offered: arrows touching `exclude`, a node id or a Set of ids)
      function edgeNear(px, py, exclude) {
        let best = null;
        const skip = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
        chartData.edges.forEach(e => {
          if (skip.has(e.from) || skip.has(e.to)) return;
          const pts = lastRoutes[e.id] && lastRoutes[e.id].points;
          if (!pts) return;
          for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
            const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
            const qx = x1 + t * dx, qy = y1 + t * dy, d = Math.hypot(px - qx, py - qy);
            if (d <= INSERT_RANGE && (!best || d < best.d)) best = { edgeId: e.id, x: qx, y: qy, d };
          }
        });
        return best;
      }

      function setInsertTarget(t, text = '+ Insert step') {
        insertTarget = t;
        edgeGroup.querySelectorAll('.edge-line.insert-target').forEach(p => p.classList.remove('insert-target'));
        const hint = document.getElementById('insert-hint');
        if (!t) { if (hint) hint.style.display = 'none'; return; }
        const path = [...edgeGroup.querySelectorAll('.edge-line')].find(p => p.dataset.edgeId === t.edgeId);
        if (path) path.classList.add('insert-target');
        if (hint) {
          const wasHidden = hint.style.display !== 'block';
          hint.textContent = text;
          hint.style.left = `${t.x}px`;
          hint.style.top = `${t.y}px`;
          hint.style.display = 'block';
          if (wasHidden && motion.enabled()) {
            motion.anim(hint, [
              { transform: 'translate(-50%, calc(-100% - 10px)) scale(0.75)' },
              { transform: 'translate(-50%, calc(-100% - 10px)) scale(1)' }
            ], { duration: 110, easing: motion.curve('curve-spring-tactile') });
          }
        }
      }

      // --- AUTO LAYOUT ---
      // With auto layout on (the default; the dock's Auto-Tidy switch toggles it, remembered per browser), every step edit
      // re-runs the layout engine: adding, moving or deleting a step, and reordering, adding or deleting a lane.
      // One exception: a shape dragged from the dock onto blank canvas stays where it is dropped (onPaletteUp).
      // Arrow edits (connect, reconnect, delete, label) do NOT re-lay out, so the order can be rewired one arrow at a
      // time without the diagram jumping; the next step edit (or Tidy) lays the result out. The engine reads only
      // structure (arrows, lanes), not x/y, so with auto layout on a drag only picks a lane. Off, steps stay where
      // they are dropped (with snap guides) and only the Tidy button re-lays out.
      // The re-layout runs before updateStatus, so the edit and its re-layout are a single undo step. With `focusId`,
      // the view is re-panned so that step stays where it was on screen (a step just added appears where it was dropped).
      function relayout(focusId) {
        if (!autoLayout) { render(); updateStatus(true); return; }
        withMotion(() => {
          const before = focusId && document.getElementById(`node-${focusId}`);
          const r0 = before && before.getBoundingClientRect();
          layoutDiagram(chartData);
          render();
          updateStatus(true);
          const el = focusId && document.getElementById(`node-${focusId}`);
          if (r0 && el) {
            const r = el.getBoundingClientRect();
            panX += (r0.left + r0.width / 2) - (r.left + r.width / 2);
            panY += (r0.top + r0.height / 2) - (r.top + r.height / 2);
            updateTransform();
          }
        }, { duration: 220, skipFreeNotes: true });
      }

      // --- REORDER: MOVE A RUN OF STEPS INTO AN ARROW ---
      // A step's place along the flow comes from the arrows, so moving steps earlier or later means rewiring. A run
      // is a set of steps with one way in and one way out:
      //   - every arrow from outside points at one step (the entry);
      //   - at most one arrow leaves the set, from one step (the exit); branches that rejoin inside are fine;
      //   - no Start or End, and no loop-back (feedback arrow) crosses its boundary.
      // A connector pair is part of the set when every step it joins is. A single step is a run of one; so is a new
      // or unconnected step, which is how "drop onto an arrow" inserts it.
      // Alt + drag onto an arrow, or Alt + arrow keys along the flow, moves the run there (moveRunIntoEdge).
      const RUN_HINT = 'Only a connected run of steps (one way in, one way out) can move into an arrow.';

      // The steps being dragged: the grabbed one first
      const draggedIds = () => (draggingNode ? [draggingNode.id, ...(dragGroup || []).map(g => g.node.id)] : []);

      // { set, entry, exit, ins, out } for a run, or null: `ins` are the arrows from outside into the entry, `out`
      // the arrow leaving the exit (null when the run ends the flow)
      function runOf(ids) {
        const set = new Set(ids.filter(id => nodeById(id) && !isConnector(nodeById(id))));
        if (!set.size || [...set].some(id => ['start', 'end'].includes(nodeById(id).type))) return null;
        const links = [];   // arrows inside the set, plus the hop across each pair inside it
        new Set(chartData.nodes.filter(isConnector).map(connectorLetter)).forEach(letter => {
          const circles = connectorsLettered(letter), cids = new Set(circles.map(c => c.id));
          const steps = chartData.edges.filter(e => cids.has(e.from) !== cids.has(e.to)).map(e => (cids.has(e.from) ? e.to : e.from));
          if (!steps.length || !steps.every(id => set.has(id))) return;
          circles.forEach(c => {
            set.add(c.id);
            if (connectorRole(c.id) === 'in') connectorPartners(c).forEach(o => links.push([c.id, o.id]));
          });
        });
        const ins = chartData.edges.filter(e => !set.has(e.from) && set.has(e.to));
        const outs = chartData.edges.filter(e => set.has(e.from) && !set.has(e.to));
        if (outs.length > 1 || [...ins, ...outs].some(e => e.feedback)) return null;
        chartData.edges.forEach(e => { if (set.has(e.from) && set.has(e.to) && e.from !== e.to && !e.feedback) links.push([e.from, e.to]); });
        const entries = ins.length ? [...new Set(ins.map(e => e.to))] : [...set].filter(id => !links.some(l => l[1] === id));
        const exits = outs.length ? [outs[0].from] : [...set].filter(id => !links.some(l => l[0] === id));
        if (entries.length !== 1 || exits.length !== 1) return null;
        // Connected: every member is reached from the entry
        const seen = new Set(entries), queue = [...entries];
        while (queue.length) {
          const id = queue.shift();
          links.forEach(l => { if (l[0] === id && !seen.has(l[1])) { seen.add(l[1]); queue.push(l[1]); } });
        }
        if (seen.size !== set.size) return null;
        return { set, entry: entries[0], exit: exits[0], ins, out: outs[0] || null };
      }

      // Move the run `ids` into arrow C -> D (`edgeId`): one edit, one undo step. Returns false when refused.
      //   Lift:   each arrow P -> entry is re-pointed to S, the step after the run (keeping its id, label and
      //           feedback flag), and exit -> S goes. With no S the arrows into the run go; an arrow that would
      //           duplicate another is dropped.
      //   Splice: C -> D becomes C -> entry (keeping its id and label, so a decision's "Yes" stays on the decision's
      //           side) and a new arrow exit -> D is added. A loop-back flag moves to exit -> D: the leg that returns.
      // A new or unconnected step is the run of one with nothing to lift: A -> B becomes A -> new -> B.
      // With auto layout on (and always for a step that had no arrows) the layout is tidied; off, the steps of a
      // moved run stay where they were dropped and Tidy lays the result out. Given a pointer position, the view is
      // re-panned so that `focusId` (default: the entry) sits under it.
      function moveRunIntoEdge(ids, edgeId, clientX, clientY, focusId, originRect) {
        const run = runOf(ids);
        const edge = chartData.edges.find(x => x.id === edgeId);
        if (!run || !edge || run.set.has(edge.from) || run.set.has(edge.to)) return false;
        const lifted = run.ins.length > 0 || !!run.out;
        const after = run.out ? run.out.to : null;
        const drop = new Set(run.out ? [run.out] : []);
        const secondId = uid('e');
        withMotion(() => {
          run.ins.forEach(p => {
            const dup = chartData.edges.some(x => x !== p && !drop.has(x) && x.from === p.from && x.to === after);
            if (after && p.from !== after && !dup) p.to = after; else drop.add(p);
          });
          chartData.edges = chartData.edges.filter(x => !drop.has(x));
          const target = edge.to;
          edge.to = run.entry;
          const second = { id: secondId, from: run.exit, to: target, label: run.out ? (run.out.label || '') : (nodeById(run.exit).type === 'decision' ? 'Yes' : '') };
          if (edge.feedback) { second.feedback = true; delete edge.feedback; }
          chartData.edges.push(second);
          if (autoLayout || !lifted) layoutDiagram(chartData);
          render();
          updateStatus(true);
          if (ids.length === 1) selectNode(ids[0]); else setNodeSelection(ids, selectedNodeId);
          // Same zoom, re-panned so the step sits where it was dropped (no Fit jump on big diagrams)
          const el = clientX != null && nodeElOf(focusId || run.entry);
          if (el) {
            const r = el.getBoundingClientRect();
            panX += clientX - (r.left + r.width / 2);
            panY += clientY - (r.top + r.height / 2);
            updateTransform();
          }
          run.set.forEach(id => {
            const moved = nodeElOf(id);
            if (!moved) return;
            moved.classList.add('just-inserted');
            setTimeout(() => moved.classList.remove('just-inserted'), 460);
          });
        }, { duration: 220, originRect, drawEdges: new Set([edgeId, secondId]), skipFreeNotes: true });
        return true;
      }

      // Alt + arrow along the flow: the selected run swaps places with its neighbour, P -> [run] -> S. Only along a
      // straight part of the flow: the neighbour must have a single arrow in and a single arrow out.
      function shiftRunAlongFlow(dir) {
        const ids = [...selectedNodeIds], run = runOf(ids);
        if (!run) { flashHint(RUN_HINT); return; }
        const straight = (id) => {
          const i = chartData.edges.filter(e => e.to === id), o = chartData.edges.filter(e => e.from === id);
          return !isConnector(nodeById(id)) && i.length === 1 && o.length === 1 && !i[0].feedback && !o[0].feedback ? { in: i[0], out: o[0] } : null;
        };
        let edge = null;
        if (dir > 0 && run.out) edge = (straight(run.out.to) || {}).out;
        if (dir < 0 && run.ins.length === 1) edge = (straight(run.ins[0].from) || {}).in;
        if (!edge || !moveRunIntoEdge(ids, edge.id)) flashHint('Steps can only move past a step with one arrow in and one arrow out.');
      }

      // Alt + arrow across the lanes: every selected step moves one lane over. The selection stops as a whole at
      // the first and last lane, so it keeps its shape.
      function shiftSelectionLanes(dir) {
        const nodes = [...selectedNodeIds].map(nodeById).filter(n => n && !isConnector(n));
        const at = nodes.map(n => chartData.lanes.findIndex(l => l.id === n.laneId) + dir);
        if (!nodes.length || at.some(i => i < 0 || i >= chartData.lanes.length)) return;
        nodes.forEach((n, k) => { n.laneId = chartData.lanes[at[k]].id; });
        finishStepMove(nodes);
      }

      // Steps were moved to other lanes as one edit. Auto layout on: one re-layout. Off: they stay where they were
      // put (kept inside their lane), and connector circles on a moved step go back beside it.
      function finishStepMove(nodes) {
        if (autoLayout) { relayout(); return; }
        nodes.forEach(n => {
          const lane = chartData.lanes.find(l => l.id === n.laneId);
          const room = ((lane && lane.height) || LE.LANE_MIN) - crossSize(n) - 12;
          n.y = Math.max(12, Math.min(n.y || 0, room));
        });
        const moved = new Set(nodes.map(n => n.id));
        const circles = chartData.edges.some(e => (moved.has(e.from) && isConnector(nodeById(e.to))) || (moved.has(e.to) && isConnector(nodeById(e.from))));
        if (circles) placeCirclesOnly(); else render();
        updateStatus(true);
      }

      // Escape clears a selection of several steps (one selected step stays selected, as before)
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || selectedNodeIds.size < 2 || draggingNode) return;
        clearNodeSelection();
        applyNoteVisibility();
      });

      // Alt + arrows follow the screen: across the lanes moves the selection one lane over, along the flow moves a
      // run one step earlier or later (left to right: up/down change lane; top to bottom: left/right do)
      window.addEventListener('keydown', (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || !/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
        if (isPresenting() || draggingNode || !selectedNodeIds.size) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        const alongFlow = (e.key === 'ArrowLeft' || e.key === 'ArrowRight') !== isTB();
        if (alongFlow) shiftRunAlongFlow(dir); else shiftSelectionLanes(dir);
      });

      // --- DRAG A SHAPE OUT OF THE DOCK ---
      function buildGhost(type) {
        const g = document.createElement('div');
        g.className = `flow-node type-${type} palette-ghost`;
        g.innerHTML = shapeOutlineSvg(type);
        const label = document.createElement('div');
        label.className = 'node-label';
        label.textContent = NODE_DEFAULTS[type];
        g.appendChild(label);
        g.style.transform = `scale(${scale})`;
        document.body.appendChild(g);
        return g;
      }

      function startPaletteDrag(e, btn) {
        if (e.button !== 0 || btn.disabled || document.body.classList.contains('presentation')) return;
        motion.cancelAll();   // arrows still gliding to their places would not match the routes the drop is tested against
        paletteDrag = { type: btn.dataset.nodeType, btn, ghost: null, startX: e.clientX, startY: e.clientY, placement: null, onCanvas: false };
        window.addEventListener('pointermove', onPaletteMove);
        window.addEventListener('pointerup', onPaletteUp);
        window.addEventListener('pointercancel', cancelPaletteDrag);
      }

      function onPaletteMove(e) {
        const pd = paletteDrag;
        if (!pd) return;
        if (!pd.ghost) {
          if (Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY) < 4) return;
          pd.ghost = buildGhost(pd.type);
          document.body.classList.add('palette-dragging');
        }
        const nw = typeFlowSize(pd.type), nh = typeCrossSize(pd.type);         // flow terms, for placement
        const sw = NODE_WIDTH, sh = nodeHeightOf(pd.type);                      // on screen, for the ghost
        const under = document.elementFromPoint(e.clientX, e.clientY);
        pd.onCanvas = !!under && viewport.contains(under) && !under.closest('.dock-area');
        pd.ghost.classList.toggle('off-canvas', !pd.onCanvas);

        let gx = e.clientX - (sw * scale) / 2, gy = e.clientY - (sh * scale) / 2;   // ghost top-left on screen
        pd.placement = null;
        let target = null;
        if (pd.onCanvas) {
          const c = toContainer(e.clientX, e.clientY);
          target = canInsert(pd.type) ? edgeNear(c.x, c.y) : null;
          const p = placementAt(e.clientX, e.clientY, nw, nh);
          if (!target) {
            // The ghost shows the drop point, snapped to other nodes' and lane centres like a manual node drag: the
            // shape stays where it is dropped (no re-layout on a palette drop, see onPaletteUp)
            const snap = computeSnap({ id: '__palette__' }, nw, nh, p.x, p.laneTop + p.y);
            if (snap.x !== null) p.x = Math.max(16, Math.round(snap.x));
            if (snap.y !== null) p.y = Math.max(12, Math.round(snap.y - p.laneTop));
            showSnapGuides(snap);
            const sr = swimlanesContainer.getBoundingClientRect();
            const c = flowToContainer(p.x, p.laneTop + p.y);
            gx = sr.left + c.x * scale;
            gy = sr.top + (c.y + (isTB() ? (DECISION_HEIGHT - sh) / 2 : 0)) * scale;
          } else {
            // Over an arrow: the ghost trails below-right of the cursor so the marching arrow and pill stay visible
            hideSnapGuides();
            gx = e.clientX + 14;
            gy = e.clientY + 14;
          }
          pd.placement = p;
          document.querySelectorAll('.lane-track').forEach(t => t.classList.toggle('drag-hover-lane', !target && t.dataset.laneId === p.laneId));
        } else {
          hideSnapGuides();
          document.querySelectorAll('.lane-track').forEach(t => t.classList.remove('drag-hover-lane'));
        }
        setInsertTarget(target);
        pd.ghost.classList.toggle('inserting', !!target);
        pd.ghost.style.transform = `scale(${scale * 1.03})`;
        pd.ghost.style.left = `${gx}px`;
        pd.ghost.style.top = `${gy}px`;
      }

      function onPaletteUp(e) {
        const pd = paletteDrag;
        const target = insertTarget;
        const dragged = !!(pd && pd.ghost);
        const ghostRect = dragged && motion.enabled() ? pd.ghost.getBoundingClientRect() : null;
        if (dragged) pd.btn.dataset.dragged = '1';   // swallow the click that may follow on the button
        cancelPaletteDrag();
        if (!dragged || !pd.onCanvas || !pd.placement) return;
        if (target) {
          withMotion(() => {
            const node = makeNode(pd.type, pd.placement);
            moveRunIntoEdge([node.id], target.edgeId, e.clientX, e.clientY, node.id, ghostRect);
          }, { duration: 220, originRect: ghostRect, skipFreeNotes: true });
        } else {
          // A shape dropped onto blank canvas stays where it was dropped, even with Auto-Tidy on: it has no
          // arrows yet, so a re-layout would only throw it to the start of the flow. The next step edit (or
          // Tidy) lays it out once it is connected.
          const node = makeNode(pd.type, pd.placement);
          render();
          updateStatus(true);
          selectNode(node.id);
          if (ghostRect) motion.morphRect(ghostRect, nodeElOf(node.id), { duration: 180, easing: 'curve-spring-settle' });
        }
      }

      function cancelPaletteDrag() {
        const had = !!paletteDrag;
        if (paletteDrag && paletteDrag.ghost) paletteDrag.ghost.remove();
        if (paletteDrag && !paletteDrag.ghost) delete paletteDrag.btn.dataset.dragged;
        paletteDrag = null;
        document.body.classList.remove('palette-dragging');
        hideSnapGuides();
        setInsertTarget(null);
        document.querySelectorAll('.lane-track').forEach(t => t.classList.remove('drag-hover-lane'));
        window.removeEventListener('pointermove', onPaletteMove);
        window.removeEventListener('pointerup', onPaletteUp);
        window.removeEventListener('pointercancel', cancelPaletteDrag);
        return had;
      }

      // --- LANES ---
      // In no-swimlane mode the Lane button turns swimlanes back on (revealing the single lane's name pill)
      function updateLaneButton() {
        const label = btnAddLane.querySelector('.btn-label');
        const off = chartData.swimlanes === false;
        if (label) label.textContent = off ? 'Show lanes' : 'Lane';
        btnAddLane.title = off ? 'Show swimlanes (name the actor, then add more lanes)' : 'Add a swimlane';
        btnAddLane.setAttribute('aria-label', off ? 'Show swimlanes' : 'Lane');
      }

      btnAddLane.addEventListener('click', () => {
        if (chartData.swimlanes === false) {
          withMotion(() => {
            delete chartData.swimlanes;
            updateStatus(true);
            render();
          }, { duration: 210, skipFreeNotes: true });
          return;
        }
        withMotion(() => {
          const newLane = {                     // no color: the renderer assigns the palette colour for its position
            id: `lane_${Date.now()}`,
            name: `Actor / Role ${chartData.lanes.length + 1}`,
            icon: 'users',
            height: LE.LANE_MIN
          };
          chartData.lanes.push(newLane);
          relayout();
        }, { duration: 210, skipFreeNotes: true });
      });

      // A whole-diagram layout change (switching direction, Tidy) moves every step at once: slower than a single edit
      const BIG_MS = 520;

      // --- DIRECTION TOGGLE ---
      // Switches between left-to-right and top-to-bottom ("direction": "TB" in the data, so it is saved with the
      // file and undoable). Node positions mean different things in each, so the switch always re-runs the layout.
      function updateDirectionButton() {
        if (!btnDirection) return;
        const next = isTB() ? 'LR' : 'TB';
        const label = next === 'TB' ? 'Vertical' : 'Horizontal';
        btnDirection.querySelector('.btn-label').textContent = label;
        btnDirection.querySelector('svg').replaceWith(ui.iconEl(next === 'TB' ? 'direction-tb' : 'direction-lr'));
        btnDirection.title = next === 'TB' ? 'Switch to a top-to-bottom layout' : 'Switch to a left-to-right layout';
        btnDirection.setAttribute('aria-label', label);
      }
      // The lanes change shape on a direction switch (rows become columns). A lane box holds its steps, so scaling it would
      // stretch them: instead one childless backdrop per lane morphs from the old box to the new one behind the steps while
      // the real lane backgrounds are hidden. One transform animation per lane, so the cost follows the lane count, not the
      // step count.
      const laneBoxes = () => {
        const m = new Map([...lanesRoot.querySelectorAll('.swimlane[data-lane-id]')].map(el => [el.dataset.laneId, el.getBoundingClientRect()]));
        m.set('', swimlanesContainer.getBoundingClientRect());   // the card behind the lanes (key '': no lane has an empty id)
        return m;
      };
      function morphLaneBackdrops(prev, next) {
        if (!motion.enabled() || prev.size < 2) return;
        const cr = (next && next.get('')) || swimlanesContainer.getBoundingClientRect();
        const k = (swimlanesContainer.offsetWidth ? cr.width / swimlanesContainer.offsetWidth : scale) || 1;
        const dur = Math.max(40, Math.round(BIG_MS * motion.speedScale())), eas = motion.curve('curve-inout');
        const made = [];
        const backdrop = (from, to, css) => {
          if (!from || !to || !to.width || !to.height) return;
          const back = document.createElement('div');
          back.setAttribute('data-export-skip', '');
          back.style.cssText = `position:absolute;box-sizing:border-box;pointer-events:none;transform-origin:0 0;left:${(to.left - cr.left) / k}px;top:${(to.top - cr.top) / k}px;width:${to.width / k}px;height:${to.height / k}px;${css}`;
          swimlanesContainer.insertBefore(back, lanesRoot);
          const a = back.animate([{ transform: `translate(${(from.left - to.left) / k}px, ${(from.top - to.top) / k}px) scale(${from.width / to.width}, ${from.height / to.height})` }, { transform: 'none' }], { duration: dur, easing: eas });
          made.push(a);
          a.addEventListener('finish', () => back.remove(), { once: true });
          a.addEventListener('cancel', () => back.remove(), { once: true });
        };
        // The card first (the lanes sit on it): its own look is copied, then hidden while the backdrops run
        const card = getComputedStyle(swimlanesContainer);
        backdrop(prev.get(''), cr, `left:-${card.borderLeftWidth};top:-${card.borderTopWidth};background:${card.backgroundColor};border:${card.border};border-radius:${card.borderRadius};box-shadow:${card.boxShadow}`);
        lanesRoot.querySelectorAll('.swimlane[data-lane-id]').forEach(el => {
          const track = el.querySelector('.lane-track');
          const to = (next && next.get(el.dataset.laneId)) || el.getBoundingClientRect();
          if (track) backdrop(prev.get(el.dataset.laneId), to, `background:${getComputedStyle(track).backgroundColor}`);
        });
        if (!made.length) return;
        swimlanesContainer.classList.add('lane-morph');
        Promise.allSettled(made.map(a => a.finished)).then(() => swimlanesContainer.classList.remove('lane-morph'));
      }

      if (btnDirection) btnDirection.addEventListener('click', () => {
        const prevLanes = laneBoxes();
        let nextLanes = null;
        withMotion(() => {
          if (isTB()) delete chartData.direction;
          else chartData.direction = 'TB';
          selectedEdgeId = null;
          // A moved note's offset is in screen terms, which the switch turns sideways: let every anchored note be re-fitted
          // (a free note's position is in flow terms and turns with the diagram)
          notesList().forEach(n => { if (!isFree(n)) delete n.pos; });
          layoutDiagram(chartData);
          layoutOtherFlows();
          render();
          updateStatus(true);
          nextLanes = laneBoxes();
        }, { duration: BIG_MS });   // arrows morph from their old routes (as in Tidy); the view stays where the reader had it
        morphLaneBackdrops(prevLanes, nextLanes);
      });

      // --- AUTO LAYOUT TOGGLE ---
      // Switch on (aria-checked) = auto layout on (see AUTO LAYOUT). Turning it on tidies the diagram right away. The choice is an
      // editing preference of this browser, not part of the diagram, so it is not saved into the file.
      const btnAutoLayout = document.getElementById('btn-auto-layout');
      function updateAutoLayoutButton() {
        if (!btnAutoLayout) return;
        btnAutoLayout.setAttribute('aria-checked', String(autoLayout));
        btnAutoLayout.title = autoLayout
          ? 'Auto-Tidy is on: the diagram re-arranges itself after every step edit (click to place steps by hand)'
          : 'Auto-Tidy is off: steps stay where you drop them (click to re-arrange after every step edit)';
      }
      if (btnAutoLayout) btnAutoLayout.addEventListener('click', () => {
        autoLayout = !autoLayout;
        updateAutoLayoutButton();
        if (autoLayout) relayout();
      });
      updateAutoLayoutButton();

      // --- NOTES ---
      // A note explains one or more steps, so their labels can stay short. Notes live in chartData.notes:
      //   { "id": "note-1", "text": "...", "nodes": ["n2", "n5"], "pos": {x, y}? }
      // The first id in "nodes" is the note's anchor. Every linked node carries a small badge; hovering it (or the
      // node) peeks its notes, and the dock's Notes button shows them all ("showNotes": true, saved with the file).
      // A dashed leader joins the card to each linked node. Notes are not part of the layout: on every render each
      // unpinned note is fitted into a clear gap a little away from its nodes, diagonal to a single node, clear of
      // nodes, other notes, arrows and labels. Notes belong to no lane and may sit beyond the diagram's edge.
      // Dragging a note pins it: "pos" keeps its top-left relative to its anchor's top-left (screen px), so it
      // follows its anchor and is never re-fitted. Linking: drag a selected note's link handle onto a step, or
      // Shift+click a step while the note is selected; the same on a linked step unlinks it (never the last one).
      // A free note has no links ("nodes": []): its "pos" is absolute, in flow terms like a step's x/y (x along the flow
      // from the start of the lane track, y across), so it stays where it was dropped through Auto-Tidy. It has no
      // leader and no badge, is always on show, and the other notes are fitted around it. Dropping the Note tile (or a
      // free note's link handle) on a step links it; N or the tile with nothing selected adds one at the view's centre.
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const notesLayer = document.getElementById('notes-layer');
      const noteLeaderGroup = document.getElementById('note-leader-group');
      const btnNotes = document.getElementById('btn-notes');
      const NOTE_GAP = 8;            // px kept clear around nodes, notes and labels
      const NOTE_MIN_GAP = 10;       // a note never sits closer than this to a node it explains
      const NOTE_IDEAL_GAP = 20;     // preferred distance: clearly separate from the node, still close to it
      const NOTE_REACH = 168;        // how far (px) from its nodes a note may be fitted
      const NOTE_STEP = 8;           // fitting grid
      const NOTE_PEEK_DELAY = 100;   // ms on a node before its notes peek: feels instant, skips quick fly-overs (the badge peeks at once)
      const NOTE_ICON = ui.icon('note-lines', { size: 'xs', bold: true });
      let noteOffsets = {};          // noteId -> {x, y}: last fitted top-left relative to its anchor (screen px)
      let noteSizes = {};            // noteId -> {w, h}: measured card size
      let peekNodeId = null;         // node whose notes are peeked by hover
      let selectedNoteId = null;     // the note card itself is selected (Delete removes the note)
      let editingNoteId = null;
      let peekTimer = 0;
      let noteDrag = null;           // { id, card, sx, sy, x, y, nx, ny, moved }
      let noteLink = null;           // { id, line, target }: dragging a note's link handle

      const nodeById = (id) => chartData.nodes.find(n => n.id === id);
      const nodeElOf = (id) => document.getElementById(`node-${id}`);
      const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
      const noteById = (id) => notesList().find(n => n.id === id);
      const noteTextOf = (note) => (note && typeof note.text === 'string' ? note.text.trim() : '');
      const isFree = (note) => !(note.nodes || []).length;
      const validPos = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
      // Container px <-> a free note's flow-term position (see placeNodeEl)
      const toFlowPos = (x, y) => { const off = trackOffset(); return isTB() ? { x: Math.round(y - off), y: Math.round(x) } : { x: Math.round(x - off), y: Math.round(y) }; };
      const freeAt = (note) => flowToContainer(note.pos.x, note.pos.y);
      const isLive = (note) => !!noteTextOf(note) || note.id === editingNoteId;
      const linkedIds = (note) => (note.nodes || []).filter(id => nodeElOf(id));
      // Notes with text that explain a node (the one being typed counts too, so its card exists)
      const notesOf = (nodeId) => notesList().filter(n => isLive(n) && (n.nodes || []).includes(nodeId));
      const noteCard = (id) => notesLayer && [...notesLayer.children].find(el => el.dataset.noteId === id);
      const isPresenting = () => document.body.classList.contains('presentation');

      function noteUid() {
        let i = notesList().length + 1;
        while (noteById(`note-${i}`)) i++;
        return `note-${i}`;
      }

      // Keep notes consistent with the nodes: links to deleted nodes go, a note left with no node goes, and a
      // note written the old way (a node's own "note" / "notePos") moves into chartData.notes
      function pruneNotes() {
        const ids = new Set(chartData.nodes.map(n => n.id));
        chartData.nodes.forEach(n => {
          if (typeof n.note === 'string' && n.note.trim()) {
            chartData.notes = notesList();
            const note = { id: noteUid(), text: n.note.trim(), nodes: [n.id] };
            if (n.notePos) note.pos = n.notePos;
            chartData.notes.push(note);
          }
          delete n.note;
          delete n.notePos;
        });
        if (!Array.isArray(chartData.notes)) return;
        const orphans = new Set();   // a linked note whose every step is gone goes too; a free one (never linked) stays
        chartData.notes.forEach(note => {
          const kept = (note.nodes || []).filter(id => ids.has(id));
          if (kept[0] !== (note.nodes || [])[0]) delete note.pos;   // the anchor changed: let it be re-fitted
          if ((note.nodes || []).length && !kept.length) orphans.add(note.id);
          note.nodes = kept;
        });
        chartData.notes = chartData.notes.filter(n => !orphans.has(n.id) && (n.nodes.length || validPos(n.pos)) && (noteTextOf(n) || n.id === editingNoteId));
        if (!chartData.notes.length) delete chartData.notes;
      }

      // An element's box in container coordinates (the frame arrows, labels and notes are drawn in)
      function containerBox(el) {
        const c = swimlanesContainer.getBoundingClientRect(), r = el.getBoundingClientRect();
        return { x: (r.left - c.left) / scale, y: (r.top - c.top) / scale, w: r.width / scale, h: r.height / scale };
      }
      const boxesOverlap = (a, b, pad = 0) =>
        a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
      // Distance between two boxes (0 when they touch or overlap)
      const boxGap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
      // Length of an axis-aligned arrow segment that runs under box b
      function lengthUnder(s, b) {
        const [x1, y1, x2, y2] = s;
        if (y1 === y2) return (y1 > b.y && y1 < b.y + b.h) ? Math.max(0, Math.min(Math.max(x1, x2), b.x + b.w) - Math.max(Math.min(x1, x2), b.x)) : 0;
        if (x1 === x2) return (x1 > b.x && x1 < b.x + b.w) ? Math.max(0, Math.min(Math.max(y1, y2), b.y + b.h) - Math.max(Math.min(y1, y2), b.y)) : 0;
        return boxesOverlap({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }, b) ? 1 : 0;
      }

      function renderNotes(refit) {
        if (!notesLayer) return;
        notesLayer.textContent = '';
        noteLeaderGroup.textContent = '';
        const live = notesList().filter(n => isLive(n) && (isFree(n) || linkedIds(n).length));
        live.forEach(note => {
          notesLayer.appendChild(buildNoteCard(note));
          linkedIds(note).forEach(nodeId => {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('class', 'note-leader');
            line.dataset.noteId = note.id;
            line.dataset.nodeId = nodeId;
            noteLeaderGroup.appendChild(line);
          });
        });
        // Hidden cards have no size: measure them all at once, laid out but invisible
        notesLayer.classList.add('measuring');
        noteSizes = {};
        live.forEach(n => { const c = noteCard(n.id); noteSizes[n.id] = { w: c.offsetWidth, h: c.offsetHeight }; });
        notesLayer.classList.remove('measuring');
        if (refit) noteOffsets = {};
        fitNotes(live);
        positionNotes();
        applyNoteVisibility();
        updateNotesButton();
      }

      // Give every note that is neither pinned nor fitted yet the cheapest spot within NOTE_REACH of its nodes.
      // Cost: how far each linked node is from NOTE_IDEAL_GAP away; for a one-node note, a preference for a
      // diagonal corner (not squarely beside, above or below), so it reads as an annotation rather than a step;
      // heavy penalties for covering a node, another note, an arrow label or the lane-name gutter (where the lane
      // pills sit); a lighter one for hiding arrows; and a small one for leaving the diagram.
      function fitNotes(live) {
        const todo = live.filter(n => !n.pos && !noteOffsets[n.id]);
        if (!todo.length) return;
        const W = swimlanesContainer.clientWidth, H = swimlanesContainer.clientHeight;
        const off = trackOffset();
        const gutter = isTB() ? { x: 0, y: 0, w: W, h: off } : { x: 0, y: 0, w: off, h: H };
        const nodeBoxes = chartData.nodes.map(n => nodeElOf(n.id)).filter(Boolean).map(containerBox);
        const labelBoxes = [...edgeLabelsGroup.querySelectorAll('.edge-label.has-label')].map(containerBox);
        const segs = [];
        Object.values(lastRoutes).forEach(r => {
          const p = r && r.points;
          if (p) for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
        });
        const segBox = ([x1, y1, x2, y2]) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
        const boxesOf = {};
        live.forEach(n => { boxesOf[n.id] = linkedIds(n).map(id => containerBox(nodeElOf(id))); });
        const placed = live.filter(n => n.pos || noteOffsets[n.id]).map(n => {   // free notes are obstacles like any placed note
          const o = n.pos || noteOffsets[n.id], a = isFree(n) ? freeAt(n) : boxesOf[n.id][0];
          return isFree(n) ? { ...a, w: noteSizes[n.id].w, h: noteSizes[n.id].h } : { x: a.x + o.x, y: a.y + o.y, w: noteSizes[n.id].w, h: noteSizes[n.id].h };
        });
        // Reading order (along the flow, then across), so earlier steps get the nearer gaps
        const along = (b) => (isTB() ? [b.y, b.x] : [b.x, b.y]);
        todo.sort((a, b) => { const [a1, a2] = along(boxesOf[a.id][0]), [b1, b2] = along(boxesOf[b.id][0]); return a1 - b1 || a2 - b2; });

        todo.forEach(n => {
          const R = boxesOf[n.id], s = noteSizes[n.id], single = R.length === 1;
          const ux = Math.min(...R.map(r => r.x)), uy = Math.min(...R.map(r => r.y));
          const ur = Math.max(...R.map(r => r.x + r.w)), ub = Math.max(...R.map(r => r.y + r.h));
          const win = { x: ux - s.w - NOTE_REACH, y: uy - s.h - NOTE_REACH, w: ur - ux + 2 * (s.w + NOTE_REACH), h: ub - uy + 2 * (s.h + NOTE_REACH) };
          const nb = nodeBoxes.filter(b => boxesOverlap(b, win, NOTE_GAP));
          const lb = labelBoxes.filter(b => boxesOverlap(b, win, NOTE_GAP));
          const pb = placed.filter(b => boxesOverlap(b, win, NOTE_GAP));
          const sg = segs.filter(sgm => boxesOverlap(segBox(sgm), win, 2));
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
              if (single) {
                // Off-centre, not centred: a note squarely above/below or beside its node reads as part of the
                // flow, so it pays for how centred it is on that side, nothing once shifted by half the node
                const r = R[0];
                const dxc = Math.abs(x + s.w / 2 - (r.x + r.w / 2)), dyc = Math.abs(y + s.h / 2 - (r.y + r.h / 2));
                const aboveOrBelow = y + s.h <= r.y || y >= r.y + r.h;
                cost += 160 * (aboveOrBelow ? Math.max(0, 1 - dxc / (r.w / 2)) : Math.max(0, 1 - dyc / (r.h / 2)));
              }
              if (best && cost >= best.cost) continue;   // every penalty below only adds
              if (off > 0 && boxesOverlap(b, gutter)) cost += 1e6;
              if (x < 0 || y < 0 || x + s.w > W || y + s.h > H) cost += 600;
              for (const o of nb) if (boxesOverlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of pb) if (boxesOverlap(b, o, NOTE_GAP)) cost += 1e5;
              for (const o of lb) if (boxesOverlap(b, o, 4)) cost += 2e4;
              if (best && cost >= best.cost) continue;
              // Hiding an arrow (or sitting right on it) costs more than leaving the diagram: the flow must stay readable
              const halo = { x: x - 6, y: y - 6, w: s.w + 12, h: s.h + 12 };
              for (const sgm of sg) { const len = lengthUnder(sgm, halo); if (len) cost += 5000 + 30 * len; }
              if (!best || cost < best.cost) best = { x, y, cost };
            }
          }
          if (!best) best = { x: ur + NOTE_IDEAL_GAP, y: uy - s.h - NOTE_GAP, cost: 0 };
          noteOffsets[n.id] = { x: best.x - R[0].x, y: best.y - R[0].y };
          placed.push({ x: best.x, y: best.y, w: s.w, h: s.h });
        });
      }

      // Put every card at its anchor + offset (pinned or fitted) and draw its leaders
      function positionNotes() {
        if (!notesLayer) return;
        [...notesLayer.children].forEach(card => {
          const note = noteById(card.dataset.noteId);
          if (!note || (noteDrag && noteDrag.id === note.id)) return;
          const anchor = linkedIds(note)[0], o = note.pos || noteOffsets[note.id];
          if ((!anchor && !isFree(note)) || !o) return;
          const a = anchor && containerBox(nodeElOf(anchor)), { x, y } = a ? { x: a.x + o.x, y: a.y + o.y } : freeAt(note);
          card.style.left = `${x}px`;
          card.style.top = `${y}px`;
          drawLeaders(note.id, { x, y, ...(noteSizes[note.id] || { w: 0, h: 0 }) });
        });
      }

      // Centre to centre: the leaders run under the cards and the nodes (both opaque), so each one shows only
      // between the card's outline and the node's, aimed at the middle of both whatever the node's shape
      function drawLeaders(noteId, b) {
        [...noteLeaderGroup.children].forEach(line => {
          if (line.dataset.noteId !== noteId || line.classList.contains('linking')) return;
          const el = nodeElOf(line.dataset.nodeId);
          if (!el) return;
          const r = containerBox(el), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          line.setAttribute('x1', b.x + b.w / 2);
          line.setAttribute('y1', b.y + b.h / 2);
          line.setAttribute('x2', cx);
          line.setAttribute('y2', cy);
        });
      }

      function notePeeked(note) {
        const ids = note.nodes || [];
        return note.id === selectedNoteId || note.id === editingNoteId || !!(noteDrag && noteDrag.id === note.id)
          || !!(noteLink && noteLink.id === note.id) || ids.includes(peekNodeId) || ids.includes(selectedNodeId);
      }
      let skipNoteUnfoldId = null;
      function applyNoteVisibility() {
        if (!notesLayer) return;
        const all = !!chartData.showNotes;
        const canAnim = motionDepth === 0 && motion.enabled();
        const prevVis = new Map(), badgeRects = new Map();
        if (canAnim) {
          [...notesLayer.children].forEach(card => {
            const note = noteById(card.dataset.noteId);
            if (!note || isFree(note)) return;
            const wasVis = card.classList.contains('show') || card.classList.contains('peek');
            const willVis = all || notePeeked(note);
            prevVis.set(note.id, wasVis);
            const anchorId = linkedIds(note)[0];
            const badgeEl = anchorId && nodeElOf(anchorId)?.querySelector('.note-badge');
            if (wasVis && !willVis) {
              motion.foldNote(card, badgeEl);
            } else if (!wasVis && willVis && badgeEl) {
              const br = badgeEl.getBoundingClientRect();
              if (br.width > 0) badgeRects.set(note.id, br);
            }
          });
        }
        swimlanesContainer.classList.toggle('notes-on', all);
        [...notesLayer.children, ...noteLeaderGroup.children].forEach(el => {
          const note = noteById(el.dataset.noteId);
          if (!note) return;
          el.classList.toggle('show', all || isFree(note));   // a free note has nothing to hover: it is always on show
          el.classList.toggle('peek', notePeeked(note));
          if (el.classList.contains('note')) el.classList.toggle('selected', note.id === selectedNoteId);
        });
        if (canAnim) {
          [...notesLayer.children].forEach(card => {
            const note = noteById(card.dataset.noteId);
            if (!note || isFree(note) || note.id === skipNoteUnfoldId) return;
            const nowVis = card.classList.contains('show') || card.classList.contains('peek');
            if (!prevVis.get(note.id) && nowVis) {
              const anchorId = linkedIds(note)[0];
              const leaderEl = anchorId && noteLeaderGroup.querySelector(`.note-leader[data-note-id="${CSS.escape(note.id)}"][data-node-id="${CSS.escape(anchorId)}"]`);
              const br = badgeRects.get(note.id);
              if (note.id === editingNoteId) {
                motion.anim(card, [{ transform: 'scale(0.88)' }, { transform: 'none' }], { duration: 170, easing: motion.curve('curve-spring-tactile') });
              } else if (br) {
                motion.ghostMorph(br, card, 170, 'curve-spring-tactile');
                if (leaderEl) motion.drawPath(leaderEl, { duration: 150, easing: 'curve-out' });
              } else if (leaderEl) {
                motion.drawPath(leaderEl, { duration: 150, easing: 'curve-out' });
              }
            }
          });
        }
        skipNoteUnfoldId = null;
        // The selected note's steps are outlined, so it is clear which ones it explains
        const sel = selectedNoteId && noteById(selectedNoteId);
        document.querySelectorAll('.flow-node').forEach(el => el.classList.toggle('note-linked', !!sel && (sel.nodes || []).includes(el.dataset.nodeId)));
      }

      // Hover: a node peeks its notes after NOTE_PEEK_DELAY, its badge at once; leaving lets them go after a grace period, so the
      // pointer can travel from the node to a card (which holds the peek while hovered) without the card vanishing
      // on the way.
      function peekSoon(nodeId, delay) {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => {
          if (draggingNode || noteDrag || noteLink || noteToolDrag || paletteDrag || connectingFromNodeId) return;
          if (peekNodeId !== nodeId) { peekNodeId = nodeId; applyNoteVisibility(); }
        }, delay);
      }
      function unpeekSoon(nodeId) {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => {
          if (peekNodeId === nodeId) { peekNodeId = null; applyNoteVisibility(); }
        }, 220);
      }

      function buildNoteBadge(node) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-export-skip', '');
        b.addEventListener('pointerdown', (e) => e.stopPropagation());   // never starts a node drag
        const notes = notesOf(node.id).filter(n => noteTextOf(n));
        if (notes.length) {
          b.className = 'note-badge';
          b.setAttribute('aria-label', notes.map(n => `Note: ${noteTextOf(n)}`).join(' · '));
          b.innerHTML = NOTE_ICON;
          b.addEventListener('mouseenter', () => peekSoon(node.id, 0));
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isPresenting()) {   // read-only: a click keeps the note open (or closes it again)
              selectedNoteId = selectedNoteId === notes[0].id ? null : notes[0].id;
              applyNoteVisibility();
            } else editNote(notes[0].id);
          });
        } else return null;   // no hover (+): the step bar's note button adds one
        return b;
      }

      function buildNoteCard(note) {
        const { card, text } = ui.noteCard(note, {
          onDelete: () => removeNote(note.id),
          onLink: (e) => startNoteLink(e, note.id, card),
          linkTitle: isFree(note) ? 'Link to a step: drag onto it' : 'Link to another step: drag onto it (onto a linked step to unlink; or Shift+click the step)',
          onCommit: (el) => commitNote(note, el),
          // the card grows as it is typed into: keep its leaders attached
          onInput: () => { noteSizes[note.id] = { w: card.offsetWidth, h: card.offsetHeight }; positionNotes(); },
        });
        card.dataset.nodes = (note.nodes || []).join(' ');
        card.addEventListener('pointerdown', (e) => onNotePointerDown(e, note.id, card));
        card.addEventListener('dblclick', (e) => { e.stopPropagation(); editNote(note.id); });
        card.addEventListener('click', (e) => e.stopPropagation());
        card.addEventListener('mouseenter', () => { if ((note.nodes || []).includes(peekNodeId)) clearTimeout(peekTimer); });
        card.addEventListener('mouseleave', () => { if (peekNodeId) unpeekSoon(peekNodeId); });
        text.addEventListener('blur', () => commitNote(note, text));
        return card;
      }

      function selectNote(id) {
        const hadEdge = !!selectedEdgeId;
        selectNode(null);
        selectedNoteId = id;
        if (hadEdge) renderEdges();
        applyNoteVisibility();
        queueDeleteRefresh();
      }

      // N, the "+" chip and the Note tile: open the step's note, or start a new one (dropped again if left empty)
      function addNoteTo(nodeId) {
        if (!nodeById(nodeId) || isConnector(nodeById(nodeId)) || isPresenting()) return;   // a connector is not a step
        const existing = notesOf(nodeId)[0];
        if (existing) { editNote(existing.id); return; }
        const note = { id: noteUid(), text: '', nodes: [nodeId] };
        chartData.notes = notesList();
        chartData.notes.push(note);
        editNote(note.id);
      }

      // A free note with its top-left at a client point (default: the middle of the view); dropped again if left empty
      function addFreeNote(clientX, clientY, fromRect) {
        if (isPresenting()) return;
        const vp = viewport.getBoundingClientRect();
        const c = clientX === undefined ? toContainer(vp.left + vp.width / 2 - 80 * scale, vp.top + vp.height / 2 - 20 * scale) : toContainer(clientX, clientY);
        const note = { id: noteUid(), text: '', nodes: [], pos: toFlowPos(Math.round(c.x / 4) * 4, Math.round(c.y / 4) * 4) };
        chartData.notes = notesList();
        chartData.notes.push(note);
        editNote(note.id);
        const card = noteCard(note.id);
        if (card && motion.enabled()) {
          if (fromRect) motion.morphRect(fromRect, card, { duration: 170, easing: 'curve-spring-tactile' });
          else motion.anim(card, [{ transform: 'scale(0.88)' }, { transform: 'none' }], { duration: 160, easing: motion.curve('curve-spring-tactile') });
        }
      }

      function editNote(id) {
        const note = noteById(id);
        if (!note || isPresenting()) return;
        cancelConnecting();
        setNotePicking(false);
        editingNoteId = id;
        selectedNoteId = id;
        if (!noteCard(id)) renderNotes(false); else applyNoteVisibility();
        const card = noteCard(id);
        if (!card) return;
        const text = card.querySelector('.note-text');
        text.contentEditable = 'true';
        text.focus();
        const range = document.createRange();
        range.selectNodeContents(text);
        range.collapse(false);   // caret at the end: adding to a note is more common than replacing it
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }

      function commitNote(note, text) {
        text.contentEditable = 'false';
        if (editingNoteId !== note.id) return;
        editingNoteId = null;
        const value = text.innerText.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (value) note.text = value;
        else {
          const card = noteCard(note.id), anchorId = linkedIds(note)[0];
          const badgeEl = anchorId && nodeElOf(anchorId)?.querySelector('.note-badge');
          if (card) motion.foldNote(card, badgeEl);
          chartData.notes = notesList().filter(n => n !== note);
          if (!chartData.notes.length) delete chartData.notes;
          if (selectedNoteId === note.id) selectedNoteId = null;
        }
        updateStatus(true);
        render();   // badges appear or go, and the notes are re-fitted around the new size
      }

      // Clicking anywhere else finishes the note being typed (a node press calls preventDefault, which would
      // otherwise keep the focus in the note)
      window.addEventListener('pointerdown', (e) => {
        if (!editingNoteId) return;
        const card = noteCard(editingNoteId);
        if (card && card.contains(e.target)) return;
        const text = card && card.querySelector('.note-text'), note = noteById(editingNoteId);
        if (text) text.blur();
        if (text && note) commitNote(note, text);   // no-op if the blur already committed it
      }, true);

      function removeNote(id) {
        const note = noteById(id);
        if (!note) return;
        const card = noteCard(id), anchorId = linkedIds(note)[0];
        const badgeEl = anchorId && nodeElOf(anchorId)?.querySelector('.note-badge');
        if (card) motion.foldNote(card, badgeEl);
        chartData.notes = notesList().filter(n => n.id !== id);
        if (!chartData.notes.length) delete chartData.notes;
        if (editingNoteId === id) editingNoteId = null;
        if (selectedNoteId === id) selectedNoteId = null;
        updateStatus(true);
        render();
      }

      // Link a note to a step, or unlink it when it is linked already (a note keeps at least one step). A pinned
      // note whose anchor goes keeps its place on screen, measured from its new anchor.
      function toggleNoteLink(noteId, nodeId) {
        const note = noteById(noteId);
        if (!note || !nodeById(nodeId) || isConnector(nodeById(nodeId))) return;
        const prevLinks = new Set(note.nodes || []);
        const oldCard = noteCard(noteId);
        const wasCardVis = !!oldCard && (oldCard.classList.contains('show') || oldCard.classList.contains('peek'));
        const ids = note.nodes || [];
        if (!ids.length) {   // a free note becomes anchored: its absolute pos turns relative to the step
          const card = noteCard(noteId), a = containerBox(nodeElOf(nodeId));
          if (card) { const c = containerBox(card); note.pos = { x: Math.round(c.x - a.x), y: Math.round(c.y - a.y) }; } else delete note.pos;
          note.nodes = [nodeId];
        } else if (!ids.includes(nodeId)) note.nodes = ids.concat(nodeId);
        else if (ids.length > 1) {
          if (ids[0] === nodeId && note.pos) {
            const card = noteCard(noteId), next = nodeElOf(ids[1]);
            if (card && next) {
              const c = containerBox(card), a = containerBox(next);
              note.pos = { x: Math.round(c.x - a.x), y: Math.round(c.y - a.y) };
            } else delete note.pos;
          }
          note.nodes = ids.filter(id => id !== nodeId);
        } else return;   // the last step: delete the note instead
        selectedNoteId = noteId;
        updateStatus(true);
        if (wasCardVis) skipNoteUnfoldId = noteId;
        render();
        if (!prevLinks.has(nodeId) && (note.nodes || []).includes(nodeId)) {
          const line = noteLeaderGroup.querySelector(`.note-leader[data-note-id="${CSS.escape(noteId)}"][data-node-id="${CSS.escape(nodeId)}"]`);
          if (line) motion.drawPath(line, { duration: 150, easing: 'curve-out' });
          const badge = nodeElOf(nodeId)?.querySelector('.note-badge');
          if (badge) motion.pulseEl(badge, 'scale(1.25)', 160);
        }
      }

      // --- Dragging a note's link handle onto a step ---
      function startNoteLink(e, noteId, card) {
        if (e.button !== 0 || isPresenting()) return;
        e.stopPropagation();
        e.preventDefault();
        selectNote(noteId);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'note-leader linking');
        line.dataset.noteId = noteId;
        noteLeaderGroup.appendChild(line);
        const c = containerBox(card);
        noteLink = { id: noteId, line, target: null, x: c.x + c.w / 2, y: c.y + c.h / 2 };
        document.body.classList.add('note-linking');
        window.addEventListener('pointermove', onNoteLinkMove);
        window.addEventListener('pointerup', onNoteLinkUp);
        window.addEventListener('pointercancel', cancelNoteLink);
      }
      function onNoteLinkMove(e) {
        const d = noteLink;
        if (!d) return;
        const p = toContainer(e.clientX, e.clientY);
        d.line.setAttribute('x1', d.x); d.line.setAttribute('y1', d.y);
        d.line.setAttribute('x2', p.x); d.line.setAttribute('y2', p.y);
        d.target = nodeIdAt(e.clientX, e.clientY);
        markNoteTarget(d.target);
      }
      function endNoteLink() {
        window.removeEventListener('pointermove', onNoteLinkMove);
        window.removeEventListener('pointerup', onNoteLinkUp);
        window.removeEventListener('pointercancel', cancelNoteLink);
        const d = noteLink;
        noteLink = null;
        document.body.classList.remove('note-linking');
        if (d) d.line.remove();
        markNoteTarget(null);
        return d;
      }
      function onNoteLinkUp() {
        const d = endNoteLink();
        if (d && d.target) toggleNoteLink(d.id, d.target);
        else applyNoteVisibility();
      }
      function cancelNoteLink() { return !!endNoteLink(); }

      // --- Dragging a note: free placement, pinned relative to its anchor on drop ---
      function onNotePointerDown(e, id, card) {
        if (e.button !== 0 || e.target.isContentEditable) return;
        e.stopPropagation();
        if (isPresenting()) return;
        e.preventDefault();
        if (connectingFromNodeId) cancelConnecting();
        selectNote(id);
        noteDrag = { id, card, sx: e.clientX, sy: e.clientY, x: parseFloat(card.style.left) || 0, y: parseFloat(card.style.top) || 0, moved: false };
        window.addEventListener('pointermove', onNoteMove);
        window.addEventListener('pointerup', onNoteUp);
        window.addEventListener('pointercancel', cancelNoteDrag);
      }
      function onNoteMove(e) {
        const d = noteDrag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        d.moved = true;
        d.card.classList.add('dragging');
        d.nx = Math.round((d.x + (e.clientX - d.sx) / scale) / 4) * 4;
        d.ny = Math.round((d.y + (e.clientY - d.sy) / scale) / 4) * 4;
        d.card.style.translate = `${d.nx - d.x}px ${d.ny - d.y}px`;
        d.card.style.scale = '1.02';
        drawLeaders(d.id, { x: d.nx, y: d.ny, ...(noteSizes[d.id] || { w: 0, h: 0 }) });
      }
      function endNoteDrag() {
        window.removeEventListener('pointermove', onNoteMove);
        window.removeEventListener('pointerup', onNoteUp);
        window.removeEventListener('pointercancel', cancelNoteDrag);
        const d = noteDrag;
        noteDrag = null;
        if (d) {
          d.card.classList.remove('dragging');
          d.card.style.translate = '';
          d.card.style.scale = '';
          if (d.moved) {
            d.card.style.left = `${d.nx}px`;
            d.card.style.top = `${d.ny}px`;
          }
        }
        return d;
      }
      function onNoteUp() {
        const d = endNoteDrag();
        if (!d || !d.moved) return;
        const note = noteById(d.id), anchor = note && linkedIds(note)[0];
        if (note && isFree(note)) { note.pos = toFlowPos(d.nx, d.ny); updateStatus(true); return; }
        if (!anchor) return;
        const a = containerBox(nodeElOf(anchor));
        note.pos = { x: Math.round(d.nx - a.x), y: Math.round(d.ny - a.y) };
        updateStatus(true);
      }
      function cancelNoteDrag() {
        const d = endNoteDrag();
        if (!d) return false;
        if (d.moved) positionNotes();   // back where it was
        return d.moved;
      }

      // N adds a note to the selected step (or opens the one it has), opens the selected note, or with neither adds a free note
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'n' && e.key !== 'N') return;
        if (e.ctrlKey || e.metaKey || e.altKey || isPresenting()) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        if (selectedNodeId) addNoteTo(selectedNodeId); else if (selectedNoteId) editNote(selectedNoteId); else addFreeNote();
      });

      // --- NOTE TOOL (last tile in the Shapes menu) ---
      // A note belongs to a step, so the tile gives one to a step instead of adding a node: drag it onto a step,
      // or click it to add a note to the selected step. With nothing selected, a click waits for the next step
      // clicked (a prompt says so; Escape or a click on the canvas cancels).
      const btnAddNote = document.getElementById('btn-add-note');
      let notePicking = false;
      let noteToolDrag = null;   // { startX, startY, ghost, target }

      function setNotePicking(on) {
        notePicking = on;
        document.body.classList.toggle('note-picking', on);
        let hint = document.querySelector('.note-pick-hint');
        if (on && !hint) {
          hint = document.createElement('div');
          hint.className = 'hint hint-note note-pick-hint';
          hint.setAttribute('role', 'status');
          hint.innerHTML = 'Click a step to add a note · <kbd>Esc</kbd> to cancel';
          document.body.appendChild(hint);
        } else if (!on && hint) motion.hideHint(hint);
      }
      // The step under a screen point (ghosts and overlays ignore the pointer, so they never get in the way)
      function nodeIdAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        const n = el && el.closest('.flow-node:not(.type-connector)');   // a connector is not a step: no notes
        return n ? n.dataset.nodeId : null;
      }
      function giveNoteTo(nodeId) {
        setNotePicking(false);
        selectNode(nodeId);
        addNoteTo(nodeId);
      }

      if (btnAddNote) {
        btnAddNote.addEventListener('click', (e) => {
          if (btnAddNote.dataset.dragged) { delete btnAddNote.dataset.dragged; e.preventDefault(); return; }
          if (isPresenting()) return;
          const nodeId = selectedNodeId, noteId = !nodeId && selectedNoteId;
          // After this click is done: the Shapes bubble hands focus back to its trigger on a keyboard or tap pick,
          // which would otherwise take it straight out of the note just opened
          if (nodeId) setTimeout(() => giveNoteTo(nodeId));
          else if (noteId) setTimeout(() => editNote(noteId));
          else setTimeout(() => addFreeNote());
        });
        btnAddNote.addEventListener('pointerdown', (e) => {
          delete btnAddNote.dataset.dragged;
          if (e.button !== 0 || isPresenting()) return;
          noteToolDrag = { startX: e.clientX, startY: e.clientY, ghost: null, target: null };
          window.addEventListener('pointermove', onNoteToolMove);
          window.addEventListener('pointerup', onNoteToolUp);
          window.addEventListener('pointercancel', cancelNoteToolDrag);
        });
      }
      function markNoteTarget(id) {
        document.querySelectorAll('.flow-node.note-target').forEach(el => el.classList.remove('note-target'));
        const el = id && nodeElOf(id);
        if (el) el.classList.add('note-target');
      }
      function onNoteToolMove(e) {
        const d = noteToolDrag;
        if (!d) return;
        if (!d.ghost) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
          setNotePicking(false);
          d.ghost = document.createElement('div');
          d.ghost.className = 'note note-ghost';
          d.ghost.innerHTML = '<div class="note-text">Note</div>';
          document.body.appendChild(d.ghost);
          document.body.classList.add('palette-dragging');
        }
        // Trails below-right of the cursor, so the step being pointed at stays in view
        d.ghost.style.transform = `scale(${scale})`;
        d.ghost.style.left = `${e.clientX + 12}px`;
        d.ghost.style.top = `${e.clientY + 12}px`;
        d.target = nodeIdAt(e.clientX, e.clientY);
        d.x = e.clientX; d.y = e.clientY;
        d.over = viewport.contains(document.elementFromPoint(e.clientX, e.clientY));
        d.ghost.classList.toggle('off-target', !d.target && !d.over);
        markNoteTarget(d.target);
      }
      function endNoteToolDrag() {
        window.removeEventListener('pointermove', onNoteToolMove);
        window.removeEventListener('pointerup', onNoteToolUp);
        window.removeEventListener('pointercancel', cancelNoteToolDrag);
        const d = noteToolDrag;
        noteToolDrag = null;
        if (d && d.ghost) { d.ghost.remove(); document.body.classList.remove('palette-dragging'); }
        markNoteTarget(null);
        return d;
      }
      function onNoteToolUp() {
        const ghostRect = noteToolDrag && noteToolDrag.ghost && motion.enabled() ? noteToolDrag.ghost.getBoundingClientRect() : null;
        const d = endNoteToolDrag();
        if (!d || !d.ghost) return;
        btnAddNote.dataset.dragged = '1';   // swallow the click that may follow on the tile
        if (d.target) giveNoteTo(d.target); else if (d.over) { setNotePicking(false); addFreeNote(d.x, d.y, ghostRect); }   // anywhere else on the diagram: a free note
      }
      function cancelNoteToolDrag() {
        const d = endNoteToolDrag();
        return !!(d && d.ghost);
      }

      // --- CONNECTOR TOOL (Shapes menu, Flow) ---
      // A connector pair replaces an arrow, so the tile never drops a lone circle: drag it onto an arrow to break that
      // arrow into a lettered pair, or click it to split the selected arrow. With no arrow selected, a click waits for
      // the next arrow clicked (a prompt says so; Escape or a click on the canvas cancels).
      const btnAddConnector = document.getElementById('btn-add-connector');
      let connectorPicking = false;
      let connectorToolDrag = null;   // { startX, startY, ghost, target, hintText }
      function canSplitEdge(edgeId) {
        const e = chartData.edges.find(x => x.id === edgeId);
        return !!e && e.from !== e.to && !!nodeById(e.from) && !!nodeById(e.to) && !isConnector(nodeById(e.from)) && !isConnector(nodeById(e.to));
      }
      function setConnectorPicking(on) {
        connectorPicking = on;
        document.body.classList.toggle('connector-picking', on);
        let hint = document.querySelector('.connector-pick-hint');
        if (on && !hint) {
          hint = document.createElement('div');
          hint.className = 'hint hint-note note-pick-hint connector-pick-hint';
          hint.setAttribute('role', 'status');
          hint.dataset.exportSkip = '';
          hint.innerHTML = 'Click an arrow to break it into a connector pair · <kbd>Esc</kbd> to cancel';
          document.body.appendChild(hint);
        } else if (!on && hint) motion.hideHint(hint);
      }
      if (btnAddConnector) {
        btnAddConnector.addEventListener('click', (e) => {
          if (btnAddConnector.dataset.dragged) { delete btnAddConnector.dataset.dragged; e.preventDefault(); return; }
          if (isPresenting()) return;
          const edgeId = selectedEdgeId;
          // After this click is done (the Shapes bubble hands focus back to its trigger)
          if (edgeId && canSplitEdge(edgeId)) setTimeout(() => splitEdge(edgeId));
          else setConnectorPicking(!connectorPicking);
        });
        btnAddConnector.addEventListener('pointerdown', (e) => {
          delete btnAddConnector.dataset.dragged;
          if (e.button !== 0 || isPresenting()) return;
          connectorToolDrag = { startX: e.clientX, startY: e.clientY, ghost: null, target: null, hintText: null };
          window.addEventListener('pointermove', onConnectorToolMove);
          window.addEventListener('pointerup', onConnectorToolUp);
          window.addEventListener('pointercancel', cancelConnectorToolDrag);
        });
      }
      function onConnectorToolMove(e) {
        const d = connectorToolDrag;
        if (!d) return;
        if (!d.ghost) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
          setConnectorPicking(false);
          d.ghost = document.createElement('div');
          d.ghost.className = 'flow-node type-connector connector-ghost';
          d.ghost.innerHTML = `<div class="node-label">${nextConnectorLetter(chartData.nodes)}</div>`;
          document.body.appendChild(d.ghost);
          document.body.classList.add('palette-dragging');
          const hint = document.getElementById('insert-hint');
          if (hint) { d.hintText = hint.textContent; hint.textContent = 'Break into a connector pair'; }
        }
        const c = toContainer(e.clientX, e.clientY);
        const near = edgeNear(c.x, c.y);
        d.target = near && canSplitEdge(near.edgeId) ? near : null;
        setInsertTarget(d.target);
        // Centred on the cursor (it is small and half transparent, so the arrow under it stays visible)
        const half = (CONN.SIZE / 2) * scale;
        d.ghost.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px) scale(${scale})`;
        d.ghost.classList.toggle('over-arrow', !!d.target);
      }
      function endConnectorToolDrag() {
        window.removeEventListener('pointermove', onConnectorToolMove);
        window.removeEventListener('pointerup', onConnectorToolUp);
        window.removeEventListener('pointercancel', cancelConnectorToolDrag);
        const d = connectorToolDrag;
        connectorToolDrag = null;
        if (d && d.ghost) {
          d.ghost.remove();
          document.body.classList.remove('palette-dragging');
          const hint = document.getElementById('insert-hint');
          if (hint && d.hintText !== null) hint.textContent = d.hintText;
        }
        setInsertTarget(null);
        return d;
      }
      function onConnectorToolUp() {
        const d = endConnectorToolDrag();
        if (!d || !d.ghost) return;
        btnAddConnector.dataset.dragged = '1';   // swallow the click that may follow on the tile
        if (d.target) splitEdge(d.target.edgeId);
      }
      function cancelConnectorToolDrag() {
        const d = endConnectorToolDrag();
        return !!(d && d.ghost);
      }

      // --- NOTES BUTTON (dock) ---
      function updateNotesButton() {
        if (!btnNotes) return;
        const count = notesList().filter(n => noteTextOf(n)).length;
        const on = !!chartData.showNotes;
        btnNotes.setAttribute('aria-pressed', String(on));
        btnNotes.disabled = !count && !on;
        const c = btnNotes.querySelector('.btn-count');
        if (c) { c.textContent = count ? String(count) : ''; c.hidden = !count; }
        btnNotes.title = !count ? 'No notes yet: select a step and press N (or click its + chip) to add one'
          : on ? 'Hide the notes (hover a step’s badge to peek at one)' : 'Show all notes';
      }
      if (btnNotes) btnNotes.addEventListener('click', () => {
        if (chartData.showNotes) delete chartData.showNotes;
        else chartData.showNotes = true;
        peekNodeId = null;
        applyNoteVisibility();
        updateNotesButton();
        updateStatus(true);
      });

      // --- DISK FORMAT (the page's data block) ---
      // Written for a reader: fixed key order, steps in flow order, editor-generated ids renamed after their
      // label, and every position in one trailing "layout" map. The in-memory model keeps x/y/height/color on
      // the objects. scripts/disk_format.py is the Python twin: keep the two byte-identical.
      const DISK_KEYS = ['diagramType', 'schemaVersion', 'title', 'direction', 'swimlanes', 'showNotes',
        'lanes', 'nodes', 'edges', 'notes', 'children', 'layout'];
      const CHILD_KEYS = ['name', 'laneOrder', 'laneHeights', 'nodes', 'edges', 'notes'];
      const NODE_LAYOUT = ['x', 'y'], LANE_LAYOUT = ['height', 'color'];
      const GENERATED_ID = /^(n|c|e|lane)_\d{12,}(_\d+)?$/;   // uid(): <prefix>_<Date.now()>[_k]
      const SLUG_MAX = 30;

      function slug(text, sep = '_') {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
        if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(new RegExp(`${sep}+$`), '');
        return s;
      }

      // `d` is the full model (global lanes, the parent's steps, `children`): ids are renamed across every flow
      function renameGeneratedIds(d) {
        const kids = d.children || {}, tabs = [d, ...Object.values(kids)];
        const lanes = d.lanes || [], nodes = tabs.flatMap(t => t.nodes || []), edges = tabs.flatMap(t => t.edges || []);
        const used = new Set([...lanes, ...nodes, ...edges].map(o => o.id));
        const rename = new Map();
        const take = (base) => {
          let id = base, k = 2;
          while (used.has(id)) id = `${base}_${k++}`;
          used.add(id);
          return id;
        };
        lanes.forEach(l => { if (GENERATED_ID.test(String(l.id || ''))) rename.set(l.id, take('lane-' + (slug(l.name, '-') || 'lane'))); });
        nodes.forEach(n => {
          if (!GENERATED_ID.test(String(n.id || ''))) return;
          if (n.type === 'connector') {
            const role = edges.some(e => e.to === n.id) ? 'in' : 'out';
            rename.set(n.id, take(`c_${slug(n.label) || 'x'}_${role}`));
          } else {
            rename.set(n.id, take('n_' + (slug(n.label) || 'step')));
          }
        });
        let count = 1;
        edges.forEach(e => {
          if (!GENERATED_ID.test(String(e.id || ''))) return;
          while (used.has(`e${count}`)) count++;
          rename.set(e.id, take(`e${count}`));
        });
        if (!rename.size) return;
        const r = (id) => (rename.has(id) ? rename.get(id) : id);
        [...lanes, ...nodes, ...edges].forEach(o => { o.id = r(o.id); });
        nodes.forEach(n => { if ('laneId' in n) n.laneId = r(n.laneId); });
        edges.forEach(e => ['from', 'to'].forEach(k => { if (k in e) e[k] = r(e[k]); }));
        tabs.forEach(t => (t.notes || []).forEach(note => { if (Array.isArray(note.nodes)) note.nodes = note.nodes.map(r); }));
        Object.keys(kids).forEach(key => {
          const c = kids[key];
          c.laneOrder = (c.laneOrder || []).map(r);
          if (c.laneHeights) c.laneHeights = Object.fromEntries(Object.entries(c.laneHeights).map(([k, v]) => [r(k), v]));
          if (rename.has(key)) { kids[r(key)] = c; delete kids[key]; }
        });
      }

      function orderedKeys(d, keys) {
        const out = {};
        keys.forEach(k => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach(k => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }

      // --- SUBPROCESS TABS (plan: dev/plans/plan-subprocess.md) ---
      // A flowchart can hold child flows, one per subprocess step. On disk (and in the Mermaid writer) that is the full
      // model: `lanes` is the one list of actors, `nodes`/`edges`/`notes` the parent flow, `children[slug]` =
      // {name, laneOrder, laneHeights, nodes, edges, notes}. The editor works on one flow at a time, so in memory the
      // ACTIVE flow's lanes, steps, arrows and notes sit on chartData itself (every function here and in the engine sees an
      // ordinary flowchart), and the others are parked beside it:
      //   chartData.tab      the active child's slug (absent: the parent flow)
      //   chartData.flows    { key: { lanes, nodes, edges, notes } } for every other flow; the parent's key is ''
      //   chartData.actors   every lane's id, name, icon and colour, once (a lane edited in one flow is copied here when the
      //                      flow is left, and read from here when another is entered, so an actor is one actor everywhere)
      //   chartData.tabNames { slug: name }
      // A diagram without children has none of these: it is saved and loaded exactly as before.
      const PARENT = '';
      const curTab = () => chartData.tab || PARENT;
      const withoutHeight = (l) => { const o = { ...l }; delete o.height; return o; };
      const flowSort = (items, laneIds) => {
        const idx = new Map(laneIds.map((id, i) => [id, i]));
        items.sort((a, b) => ((a.x || 0) - (b.x || 0)) || ((idx.get(a.laneId) || 0) - (idx.get(b.laneId) || 0)) || ((a.y || 0) - (b.y || 0)));
      };

      // Copy the active flow's lane names, icons and colours into the one actor list
      function syncActors() {
        if (!chartData.flows) return;
        chartData.lanes.forEach(l => {
          const i = chartData.actors.findIndex(a => a.id === l.id);
          if (i < 0) chartData.actors.push(withoutHeight(l)); else chartData.actors[i] = withoutHeight(l);
        });
      }

      // Memory model -> full model (a copy). Flows without children come back as they are.
      function fullOf(data) {
        const d = JSON.parse(JSON.stringify(data));
        if (!d.flows) return d;
        const key = d.tab || PARENT;
        const tabs = { ...d.flows, [key]: { lanes: d.lanes, nodes: d.nodes, edges: d.edges, notes: d.notes } };
        d.actors = d.actors.map(a => (d.lanes.find(l => l.id === a.id) ? withoutHeight(d.lanes.find(l => l.id === a.id)) : a));
        d.lanes.forEach(l => { if (!d.actors.some(a => a.id === l.id)) d.actors.push(withoutHeight(l)); });
        const actor = (id) => d.actors.find(a => a.id === id);
        const parent = tabs[PARENT];
        const shown = new Set(parent.lanes.map(l => l.id));
        d.lanes = parent.lanes.map(l => ({ ...actor(l.id), ...(l.height != null ? { height: l.height } : {}) }))
          .concat(d.actors.filter(a => !shown.has(a.id)).map(a => ({ ...a })));
        d.nodes = parent.nodes;
        d.edges = parent.edges;
        if (parent.notes) d.notes = parent.notes; else delete d.notes;
        d.children = {};
        Object.keys(d.tabNames).forEach(slugKey => {
          const t = tabs[slugKey], c = { name: d.tabNames[slugKey], laneOrder: t.lanes.map(l => l.id) };
          const heights = t.lanes.filter(l => l.height != null);
          if (heights.length) c.laneHeights = Object.fromEntries(heights.map(l => [l.id, l.height]));
          c.nodes = t.nodes;
          c.edges = t.edges;
          if (t.notes && t.notes.length) c.notes = t.notes;
          d.children[slugKey] = c;
        });
        ['flows', 'actors', 'tabNames', 'tab'].forEach(k => delete d[k]);
        return d;
      }

      // Full model -> memory model: the parent flow active, the children parked. No children: nothing changes.
      function tabsOf(d) {
        const kids = d.children || {};
        delete d.children;
        if (!Object.keys(kids).length) return d;
        const actors = d.lanes.map(withoutHeight);
        const inParent = new Set(d.nodes.map(n => n.laneId)), inKids = new Set();
        Object.values(kids).forEach(c => [...(c.laneOrder || []), ...(c.nodes || []).map(n => n.laneId)].forEach(id => inKids.add(id)));
        d.lanes = d.lanes.filter(l => inParent.has(l.id) || !inKids.has(l.id));
        d.actors = actors;
        d.flows = {};
        d.tabNames = {};
        Object.keys(kids).forEach(slugKey => {
          const c = kids[slugKey], heights = c.laneHeights || {};
          const order = [...(c.laneOrder || []), ...(c.nodes || []).map(n => n.laneId)].filter((id, i, all) => all.indexOf(id) === i && actors.some(a => a.id === id));
          d.tabNames[slugKey] = c.name || slugKey;
          d.flows[slugKey] = { lanes: order.map(id => ({ ...actors.find(a => a.id === id), ...(heights[id] != null ? { height: heights[id] } : {}) })),
            nodes: c.nodes || [], edges: c.edges || [], notes: c.notes || [] };
          if (!d.flows[slugKey].notes.length) delete d.flows[slugKey].notes;
        });
        return d;
      }

      // The last lane's extra room for outer loop-backs (outerExtra) is drawn, never saved: a Save without edits writes what the engine wrote
      const withoutOuterExtra = (data) => (!outerExtra || !data.lanes || !data.lanes.length ? data
        : { ...data, lanes: data.lanes.map((l, i) => (i === data.lanes.length - 1 && l.height != null ? { ...l, height: l.height - outerExtra } : l)) });
      function toDisk(data) {
        const d = fullOf(withoutOuterExtra(data));
        delete d.layout;
        slotColors(d, 'lanes');
        const lanes = d.lanes || [], nodes = d.nodes || [], kids = d.children || {};
        // Flow order: x runs along the flow in both directions (the engine has ranked the steps already)
        flowSort(nodes, lanes.map(l => l.id));
        Object.values(kids).forEach(c => flowSort(c.nodes || [], c.laneOrder || []));
        renameGeneratedIds(d);
        const layout = {};
        [[lanes, LANE_LAYOUT], [nodes, NODE_LAYOUT], ...Object.values(d.children || {}).map(c => [c.nodes || [], NODE_LAYOUT])].forEach(([items, keys]) => items.forEach(o => {
          const pos = {};
          keys.forEach(k => { if (k in o) { pos[k] = o[k]; delete o[k]; } });
          if (Object.keys(pos).length) layout[o.id] = pos;
        }));
        if (Object.keys(layout).length) d.layout = layout;
        if (d.children) {
          // children in the order the parent flow reaches them, each with its keys in a fixed order
          // depth first, mirroring child_order in scripts/subprocess_flow.py; a child whose step is missing goes last
          const order = [];
          const walk = (flowNodes) => (flowNodes || []).forEach(n => {
            if (d.children[n.id] && !order.includes(n.id)) { order.push(n.id); walk(d.children[n.id].nodes); }
          });
          walk(nodes);
          Object.keys(d.children).forEach(k => { if (!order.includes(k)) order.push(k); });
          d.children = Object.fromEntries(order.map(k => [k, orderedKeys(d.children[k], CHILD_KEYS)]));
        }
        return orderedKeys(d, DISK_KEYS);
      }

      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        const layout = d.layout || {};
        delete d.layout;
        [...(d.lanes || []), ...(d.nodes || []), ...Object.values(d.children || {}).flatMap(c => c.nodes || [])].forEach(o => Object.assign(o, layout[o.id] || {}));
        slotColors(d, 'lanes');
        tabsOf(d);
        // A step without a position (added by hand to the JSON, or pasted from Mermaid) would sit on top of another:
        // when any is missing the whole diagram is laid out, as ERD and use case pages do. Placed pages load as saved.
        const missing = (nodes) => (nodes || []).some(n => !Number.isFinite(n.x) || !Number.isFinite(n.y));
        if (missing(d.nodes)) layoutDiagram(d);
        Object.values(d.flows || {}).forEach(f => { if (missing(f.nodes)) layoutFlow(f, d.direction); });
        return d;
      }

      // Lay out a parked flow (a copy of its arrays goes through the engine, and comes back)
      function layoutFlow(f, direction) {
        const flat = { direction, lanes: f.lanes, nodes: f.nodes, edges: f.edges, notes: f.notes || [] };
        layoutDiagram(flat);
        f.lanes = flat.lanes; f.nodes = flat.nodes; f.edges = flat.edges;
      }

      // --- TAB ROW, SWITCHING, THE LINK ON A SUBPROCESS STEP ---
      const flowTabs = document.getElementById('flow-tabs');
      let renderedTab = null;     // the flow the canvas was last drawn for (null: nothing drawn yet)
      const tabViews = {};        // key -> { scale, panX, panY }: each flow keeps its own pan and zoom
      const PARENT_LABEL = 'Main flow';

      // Flow tree. The model stays flat (flows / tabNames by slug); a flow's parent is the flow holding the step with that id,
      // so no field is stored. MAX_FLOW_DEPTH: level 1 is the main flow (plan: dev/plans/archive/plan-subprocess-depth.md).
      const MAX_FLOW_DEPTH = 4;
      const flowOf = (key) => (key === curTab() ? chartData : (chartData.flows || {})[key]);
      const parentOf = (slug) => [PARENT, ...Object.keys(chartData.tabNames || {})].find(k => { const f = flowOf(k); return f && f.nodes.some(n => n.id === slug); }) || PARENT;
      const depthOf = (key) => { let d = 1; for (let k = key; k !== PARENT && d <= MAX_FLOW_DEPTH + 8; k = parentOf(k)) d++; return d; };
      const canNest = (key) => depthOf(key) < MAX_FLOW_DEPTH;
      // The flows directly under `key`, in the order its steps come
      function childrenOf(key) {
        const f = flowOf(key), kids = Object.keys(chartData.tabNames || {}).filter(k => parentOf(k) === key);
        if (!f) return kids;
        const sorted = [...f.nodes];
        flowSort(sorted, f.lanes.map(l => l.id));
        const order = sorted.map(n => n.id);
        return kids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      }
      const subtreeOf = (key) => childrenOf(key).flatMap(k => [k, ...subtreeOf(k)]);

      // Tab keys in tree order: the parent, then each child with its own children after it (depth first)
      function tabKeys() {
        if (!chartData.flows) return [];
        const keys = [PARENT, ...subtreeOf(PARENT)];
        return keys.concat(Object.keys(chartData.tabNames).filter(k => !keys.includes(k)));
      }
      const tabLabel = (key) => (key === PARENT ? PARENT_LABEL : chartData.tabNames[key]);
      const hasChild = (nodeId) => !!chartData.flows && nodeId in chartData.tabNames;

      // The tab bar: Main flow plus nested boxes along the active path. Siblings at each open level stay visible;
      // an expanded tab's children sit in an inner box immediately after it so ownership stays clear.
      function renderTabs() {
        flowTabs.hidden = !chartData.flows;
        document.querySelectorAll('[data-export="svg-all"]').forEach(el => { el.hidden = !chartData.flows; });
        const tile = document.getElementById('btn-add-subprocess');
        if (tile) {
          const full = !canNest(curTab());
          tile.disabled = full;
          tile.title = full ? `Subprocess: the deepest level is ${MAX_FLOW_DEPTH}` : tile.dataset.title || (tile.dataset.title = tile.title);
        }
        flowTabs.replaceChildren();
        if (!chartData.flows) return;
        const cur = curTab();
        const tab = (key) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'flow-tab';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(key === cur));
          b.tabIndex = key === cur ? 0 : -1;
          b.dataset.tab = key;
          b.textContent = tabLabel(key);
          b.title = key === PARENT ? 'The main flow' : `Subprocess: ${tabLabel(key)}`;
          // A tab above the current flow goes back up, with the step that led down selected
          let step = null;
          for (let k = cur; k !== PARENT && k !== key; k = parentOf(k)) if (parentOf(k) === key) step = k;
          if (step) b.title = `Back to ${key === PARENT ? 'the main flow' : `"${tabLabel(key)}"`}, at the step "${tabLabel(step)}"`;
          b.addEventListener('click', () => switchTab(key, step));
          if (key !== PARENT) {
            b.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabMenu(key, b, e.clientX, e.clientY); });
            b.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = b.getBoundingClientRect(); openTabMenu(key, b, r.left, r.bottom); } });
          }
          b.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              const all = [...b.parentElement.children].filter(c => c.classList.contains('flow-tab')), i = all.indexOf(b);
              e.preventDefault();
              all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();   // moves focus; Enter opens it
            } else if (e.altKey && e.key === 'ArrowUp' && cur !== PARENT) {
              e.preventDefault();
              switchTab(parentOf(cur), cur);
              const again = flowTabs.querySelector(`.flow-tab[aria-selected="true"]`);
              if (again) again.focus();
            }
          });
          return b;
        };
        const box = (parent, level) => { const d = document.createElement('div'); d.className = 'flow-subtabs'; d.dataset.level = String(level); d.setAttribute('role', 'none'); parent.appendChild(d); return d; };
        const path = [cur];
        while (path[0] !== PARENT) path.unshift(parentOf(path[0]));
        const renderLevel = (parentKey, container, depth) => {
          const kids = childrenOf(parentKey);
          if (!kids.length) return;
          const b = box(container, depth);
          const nextOnPath = path[depth];
          kids.forEach(k => {
            b.appendChild(tab(k));
            if (k === nextOnPath) renderLevel(k, b, depth + 1);
          });
        };
        flowTabs.appendChild(tab(PARENT));
        renderLevel(PARENT, flowTabs, 1);
        // hanging boxes: each is one flex row
        const act = flowTabs.querySelector('.flow-tab[aria-selected="true"]');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      // Each flow keeps its own pan and zoom: called at the end of render(), so an undo that lands on another flow follows too
      function followTab() {
        const t = curTab();
        if (renderedTab === null) { renderedTab = t; return; }
        if (renderedTab === t) return;
        tabGlide = true;   // the view following a tab switch is not the reader panning: it keeps an open confirm (a tab's delete asks from the parent)
        setTimeout(() => { tabGlide = false; }, 420);
        tabViews[renderedTab] = viewTarget();   // where a glide in flight lands, not where it passes
        renderedTab = t;
        const v = tabViews[t];
        if (v) {
          if (motion.enabled()) animateViewport(v.panX, v.panY, v.scale, { duration: motion.dur('dur-tab', 300), easing: 'curve-inout' });
          else { cancelViewportAnim(); scale = v.scale; panX = v.panX; panY = v.panY; updateTransform(); }
        } else fitView(true);
      }

      // Make `key` the active flow (not an edit: nothing to undo or save). `selectId` selects that step in it.
      // A tab switch is calm: the old flow dims out in place, the new one settles in with a short slide (no node flies in from afar)
      const TAB_SWITCH_MOTION = () => ({
        duration: motion.dur('dur-tab', 300), easing: 'curve-inout', ghosts: true, ghostExit: true,
        exitDuration: 160, exitTransform: 'scale(0.99)', exitEasing: 'curve-inout',
        enterScale: 0.98, enterShift: 14, enterEasing: 'curve-out', forceDrawEdges: true, drawDuration: 220
      });
      function switchTab(key, selectId, originRect) {
        if (!chartData.flows || (key !== PARENT && !(key in chartData.tabNames))) return;
        if (key !== curTab()) {
          withMotion(() => {
            plugin.cancelInteraction();
            plugin.clearSelection();
            ui.closeConfirm();
            syncActors();
            const cur = curTab();
            chartData.flows[cur] = { lanes: chartData.lanes, nodes: chartData.nodes, edges: chartData.edges };
            if (chartData.notes) chartData.flows[cur].notes = chartData.notes;
            const next = chartData.flows[key];
            delete chartData.flows[key];
            // the actors list is the one source of a lane's name, icon and colour
            chartData.lanes = next.lanes.map(l => ({ ...chartData.actors.find(a => a.id === l.id), ...(l.height != null ? { height: l.height } : {}) }));
            chartData.nodes = next.nodes;
            chartData.edges = next.edges;
            if (next.notes) chartData.notes = next.notes; else delete chartData.notes;
            if (key === PARENT) delete chartData.tab; else chartData.tab = key;
            render();
          }, TAB_SWITCH_MOTION());
        }
        if (selectId && nodeById(selectId)) selectNode(selectId);
      }

      // A child flow's own lanes, steps and arrows go when its parent step does
      function dropFlows(keys) {
        keys.forEach(k => { delete chartData.flows[k]; delete chartData.tabNames[k]; });
        if (!Object.keys(chartData.tabNames).length) ['flows', 'actors', 'tabNames'].forEach(k => delete chartData[k]);
      }
      // A child flow, and every flow below it, go when its parent step does
      function dropChildOf(ids) {
        if (!chartData.flows) return;
        dropFlows(ids.filter(id => id in chartData.tabNames).flatMap(id => [id, ...subtreeOf(id)]));
      }
      const laneUsedElsewhere = (laneId, inLanes) => !!chartData.flows && Object.values(chartData.flows).some(f => (inLanes ? f.lanes.some(l => l.id === laneId) : f.nodes.some(n => n.laneId === laneId)));

      // After a direction change every parked flow is laid out again too (a step's x/y mean different things in each)
      function layoutOtherFlows() {
        Object.values(chartData.flows || {}).forEach(f => layoutFlow(f, chartData.direction));
      }

      // Visit every flow in turn (the export of all of them), then come back to the one the person was on
      function eachTab(fn) {
        const home = curTab();
        const seen = {};   // two flows may share a name: the file names must differ
        tabKeys().forEach(key => { switchTab(key); const n = tabLabel(key); seen[n] = (seen[n] || 0) + 1; fn(seen[n] > 1 ? `${n} ${seen[n]}` : n); });
        switchTab(home);
      }

      // The subprocess step's + marker (top left, inside the box) becomes a button when the step has a child flow: opens its tab
      function buildSubLink(node) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sub-open';
        b.setAttribute('data-export-skip', '');
        b.title = `Open the subprocess flow: ${chartData.tabNames[node.id]}`;
        b.setAttribute('aria-label', b.title);
                b.addEventListener('pointerdown', (e) => e.stopPropagation());   // never starts a node drag
        b.addEventListener('click', (e) => { e.stopPropagation(); switchTab(node.id, null, nodeElOf(node.id)?.getBoundingClientRect()); });
        return b;
      }


      // --- COLLAPSE TO SUBPROCESS / EXPAND (dock buttons) ---
      // Collapse: a run of two or more steps (runOf: one way in, one way out, no loop-back across the boundary) moves into a
      // new child flow and leaves one subprocess step in its place; the child gets a start pill, the run and one end pill.
      // Expand does the reverse (the same wiring as `--extract --flat`, scripts/subprocess_flow.py flatten). Each is one edit.
      // Collapse is offered while the flow is above MAX_FLOW_DEPTH. Neither is offered while a connector is involved.
      const btnCollapseSub = document.getElementById('btn-collapse-sub');
      const btnExpandSub = document.getElementById('btn-expand-sub');
      let subSeq = 0;
      const subId = (prefix) => `${prefix}_${Date.now()}_${subSeq++}`;

      function collapsibleRun() {
        if (!canNest(curTab()) || selectedNodeIds.size < 2) return null;
        const ids = [...selectedNodeIds];
        if (ids.some(id => hasChild(id))) return null;
        const run = runOf(ids);
        return run && [...run.set].every(id => !isConnector(nodeById(id))) ? run : null;
      }
      const expandableId = () => {
        const id = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
        return id && hasChild(id) ? id : null;
      };
      function updateSubButtons() {
        if (btnCollapseSub) btnCollapseSub.hidden = !collapsibleRun();
        if (btnExpandSub) btnExpandSub.hidden = !expandableId();
      }

      function collapseToSubprocess() {
        const run = collapsibleRun();
        if (!run) return;
        const ids = run.set, id = subId('n'), name = 'New Subprocess';
        const toKey = Object.fromEntries([...ids].map(nid => [nid, id]));
        let originRect = null;
        if (motion.enabled()) {
          let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
          ids.forEach(nid => {
            const vr = nodeElOf(nid)?.getBoundingClientRect();
            if (vr && vr.width > 0) { l = Math.min(l, vr.left); t = Math.min(t, vr.top); r = Math.max(r, vr.right); b = Math.max(b, vr.bottom); }
          });
          if (l < Infinity) originRect = { left: l, top: t, width: Math.max(1, r - l), height: Math.max(1, b - t) };
        }
        withMotion(() => {
          syncActors();
          const entry = nodeById(run.entry), exit = nodeById(run.exit);
          const inner = chartData.edges.filter(e => ids.has(e.from) && ids.has(e.to));
          const moved = chartData.nodes.filter(n => ids.has(n.id));
          const notes = notesList();
          const kidNotes = notes.filter(n => n.nodes.length && n.nodes.every(i => ids.has(i)));
          const start = { id: subId('n'), laneId: entry.laneId, type: 'start', label: name };
          const end = { id: subId('n'), laneId: exit.laneId, type: 'end', label: 'Subprocess Done' };
          const kidNodes = [start, ...moved, end];
          const kidEdges = [...inner, { id: subId('e'), from: start.id, to: entry.id, label: '' }, { id: subId('e'), from: exit.id, to: end.id, label: '' }];
          // the parent: the run is replaced by one subprocess step, the arrows that entered and left it now meet that step
          run.ins.forEach(e => { e.to = id; });
          if (run.out) run.out.from = id;
          chartData.nodes = chartData.nodes.filter(n => !ids.has(n.id)).concat({ id, laneId: entry.laneId, type: 'subprocess', label: name, x: entry.x, y: entry.y });
          chartData.edges = chartData.edges.filter(e => !inner.includes(e));
          if (kidNotes.length) { chartData.notes = notes.filter(n => !kidNotes.includes(n)); if (!chartData.notes.length) delete chartData.notes; }
          const used = new Set(kidNodes.map(n => n.laneId));
          if (!chartData.flows) { chartData.actors = chartData.lanes.map(withoutHeight); chartData.flows = {}; chartData.tabNames = {}; }
          const flow = { lanes: chartData.lanes.filter(l => used.has(l.id)).map(withoutHeight), nodes: kidNodes, edges: kidEdges };
          if (kidNotes.length) flow.notes = kidNotes;
          chartData.flows[id] = flow;
          chartData.tabNames[id] = name;
          layoutFlow(flow, chartData.direction);
          // a lane that only the child still uses leaves the parent (as it would on reload)
          chartData.lanes = chartData.lanes.filter(l => chartData.nodes.some(n => n.laneId === l.id) || !used.has(l.id));
          pruneNotes();
          clearNodeSelection();
          layoutDiagram(chartData);
          render();
          selectNode(id);
          updateStatus(true);
        }, { duration: 240, ghosts: true, toKey, originRect, skipFreeNotes: true });
        // the new step is waiting for its name: its text opens for editing
        const label = document.querySelector(`#node-${CSS.escape(id)} .node-label`);
        if (label) label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      }

      // A subprocess step added from Shapes: a child flow of its own, start pill -> one step -> end pill in the step's lane
      function addEmptyChild(node) {
        syncActors();
        const start = { id: subId('n'), laneId: node.laneId, type: 'start', label: node.label };
        const step = { id: subId('n'), laneId: node.laneId, type: 'task', label: 'New Step' };
        const end = { id: subId('n'), laneId: node.laneId, type: 'end', label: 'Subprocess Done' };
        const edges = [{ id: subId('e'), from: start.id, to: step.id, label: '' }, { id: subId('e'), from: step.id, to: end.id, label: '' }];
        if (!chartData.flows) { chartData.actors = chartData.lanes.map(withoutHeight); chartData.flows = {}; chartData.tabNames = {}; }
        const flow = { lanes: chartData.lanes.filter(l => l.id === node.laneId).map(withoutHeight), nodes: [start, step, end], edges };
        chartData.flows[node.id] = flow;
        chartData.tabNames[node.id] = node.label;
        layoutFlow(flow, chartData.direction);
      }

      // Why Expand cannot run on subprocess step `id` ('' when it can)
      function expandBlocker(id) {
        const kid = chartData.flows[id];
        if (kid.nodes.filter(n => n.type === 'start').length !== 1) return 'Expand needs the subprocess to have exactly one start pill.';
        const letters = (nodes) => new Set(nodes.filter(isConnector).map(n => String(n.label || '').trim().toUpperCase()));
        const clash = [...letters(kid.nodes)].find(l => letters(chartData.nodes).has(l));
        return clash ? `Both flows use the connector ${clash}: rename one before expanding.` : '';
      }

      function expandSubprocess(id = expandableId()) {
        if (!id) return;
        const why = expandBlocker(id);
        if (why) { flashHint(why); return; }
        const kid = chartData.flows[id];
        const fromKey = Object.fromEntries(kid.nodes.filter(n => n.type !== 'start' && n.type !== 'end').map(n => [n.id, id]));
        withMotion(() => {
          syncActors();
          const starts = kid.nodes.filter(n => n.type === 'start'), ends = kid.nodes.filter(n => n.type === 'end');
          const start = starts[0];
          const edges = chartData.edges;
          const outs = edges.filter(e => e.from === id);
          let decision = null, branches = outs;
          const next = outs.length === 1 ? nodeById(outs[0].to) : null;
          if (next && next.type === 'decision') {
            branches = edges.filter(e => e.from === next.id);
            if (ends.length === branches.length && !edges.some(e => e.to === next.id && e.from !== id)) decision = next;
          }
          const drop = new Set([id, start.id]), dropEdges = new Set(), fresh = [];
          const wire = (from, to, a, b) => fresh.push({ id: subId('e'), from, to, label: a.label || b.label || '', ...(a.feedback ? { feedback: true } : {}) });
          let kidEdges = kid.edges.slice();
          const first = kidEdges.filter(e => e.from === start.id);
          edges.filter(e => e.to === id).forEach(ie => first.forEach(f => wire(ie.from, f.to, ie, f)));
          if (outs.length) {
            let target;
            if (decision) {
              const map = endToBranch(ends, branches);
              target = (end) => (map[end.id] ? [map[end.id]] : []);
              drop.add(decision.id);
              branches.forEach(b => dropEdges.add(b.id));
            } else target = () => outs;
            ends.forEach(end => {
              drop.add(end.id);
              kidEdges.filter(e => e.to === end.id).forEach(ie => target(end).forEach(t => wire(ie.from, t.to, ie, t)));
            });
            kidEdges = kidEdges.filter(e => !ends.some(end => end.id === e.to));
          }
          kidEdges = kidEdges.filter(e => e.from !== start.id);
          const relink = first.length ? first[0].to : null;
          notesList().forEach(n => { n.nodes = n.nodes.map(i => (i === id ? relink : i)).filter(Boolean); });
          // the child's lanes that the parent lacks come in, in the order of the one actor list
          const at = (laneId) => chartData.actors.findIndex(a => a.id === laneId);
          kid.lanes.forEach(l => {
            if (chartData.lanes.some(x => x.id === l.id)) return;
            let pos = chartData.lanes.findIndex(x => at(x.id) > at(l.id));
            if (pos < 0) pos = chartData.lanes.length;
            chartData.lanes.splice(pos, 0, withoutHeight(chartData.actors.find(a => a.id === l.id) || l));
          });
          chartData.nodes = chartData.nodes.filter(n => !drop.has(n.id)).concat(kid.nodes.filter(n => !drop.has(n.id)));
          chartData.edges = edges.filter(e => !drop.has(e.from) && !drop.has(e.to) && !dropEdges.has(e.id)).concat(kidEdges, fresh);
          if (kid.notes && kid.notes.length) chartData.notes = notesList().concat(kid.notes);
          dropFlows([id]);   // only this flow: the ones below it stay, one level up
          pruneConnectors();
          pruneNotes();
          clearNodeSelection();
          layoutDiagram(chartData);
          render();
          updateStatus(true);
        }, { duration: 240, fromKey, skipFreeNotes: true });
      }

      // Which branch of the decision after a subprocess each of the child's end pills stands for: by the same name, then by a
      // branch word inside the end's name ("Approved" in "Specification Approved"), then Yes/No by wording (not, fail, reject,
      // decline, cancel... is the No), then by position. Mirrors _end_to_branch in scripts/subprocess_flow.py.
      function endToBranch(ends, branches) {
        const lab = (x) => String(x || '').trim().toLowerCase();
        const left = branches.slice(), out = {};
        const take = (end, b) => { out[end.id] = b; left.splice(left.indexOf(b), 1); };
        ends.forEach(end => { const b = left.find(x => lab(x.label) === lab(end.label)); if (b) take(end, b); });
        ends.filter(e => !out[e.id]).forEach(end => { const b = left.find(x => lab(x.label) && lab(end.label).includes(lab(x.label))); if (b) take(end, b); });
        const rest = ends.filter(e => !out[e.id]);
        const yes = left.find(b => lab(b.label) === 'yes'), no = left.find(b => lab(b.label) === 'no');
        if (rest.length === 2 && left.length === 2 && yes && no) {
          const NO_WORDS = /\b(not|no|fail|failed|reject|rejected|declin\w*|cancel\w*|denied|invalid|incomplete|unable|refused)\b/i;
          const neg = rest.filter(e => NO_WORDS.test(String(e.label || '')));
          const n = neg.length === 1 ? neg[0] : rest[1];
          out[n.id] = no;
          out[rest.find(e => e !== n).id] = yes;
        } else rest.forEach((e, i) => { if (left[i]) out[e.id] = left[i]; });
        return out;
      }

      // --- DELETING A SUBPROCESS: Merge into parent / Delete everything / Cancel ---
      // A subprocess that has content asks first (a freshly added one, still blank, goes at once). Merge is Expand; Delete
      // everything is the plain delete, which takes the flows below along (dropChildOf).
      const isBlankChild = (id) => {
        const f = chartData.flows[id], tasks = f.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
        return !childrenOf(id).length && tasks.length <= 1 && tasks.every(n => n.type === 'task' && n.label === 'New Step');
      };
      const stepCount = (nodes) => nodes.filter(n => n.type !== 'start' && n.type !== 'end').length;

      function confirmDeleteSub(id, anchorEl) {
        ui.closeConfirm();
        const node = nodeById(id);
        if (!node || !hasChild(id)) return;
        const why = expandBlocker(id);
        const after = stepCount(chartData.nodes) - 1 + stepCount(chartData.flows[id].nodes);
        const note = after > 30 ? ` The parent will have ${after} steps.` : '';
        ui.confirm(anchorEl || document.getElementById(`node-${id}`), {
          title: `Delete the subprocess \u201c${chartData.tabNames[id]}\u201d?`,
          message: `Merge puts its steps into this flow; Delete everything removes them.${note}`,
          label: 'Delete subprocess',
          ok: 'Delete everything',
          alt: { text: 'Merge into parent', onClick: () => expandSubprocess(id) },
        }, () => deleteNode(id, true));
        const alt = document.querySelector('.confirm .confirm-alt');
        if (alt && why) { alt.disabled = true; alt.title = why; }
      }

      // True when a question was asked (the delete waits for the answer). Several steps at once: one plain question.
      function askSubDelete(ids) {
        const full = ids.filter(id => nodeById(id) && hasChild(id) && !isBlankChild(id));
        if (!full.length) return false;
        const anchor = document.getElementById(`node-${full[0]}`);
        if (ids.length === 1) { confirmDeleteSub(full[0], anchor); return true; }
        ui.closeConfirm();
        ui.confirm(anchor, {
          title: `Delete ${ids.length} steps?`,
          message: `${full.length === 1 ? 'A subprocess' : `${full.length} subprocesses`} among them will be deleted with everything inside.`,
          label: 'Delete steps',
        }, () => deleteNodes(ids, true));
        return true;
      }

      // The tab's Delete: on the parent flow, with the step selected, so Merge always runs on the parent's own data
      function deleteSubprocessTab(key) {
        switchTab(parentOf(key), key);
        if (!hasChild(key)) return;
        if (isBlankChild(key)) { deleteNode(key, true); return; }
        confirmDeleteSub(key, flowTabs.querySelector(`.flow-tab[data-tab="${CSS.escape(key)}"]`));
      }

      // Right-click (or the Menu key, Shift+F10) on a subprocess tab: a one-item menu at the pointer
      let tabMenu = null;
      function closeTabMenu(focusKey) {
        if (!tabMenu) return;
        motion.ghostExit(tabMenu, { duration: 110, transform: 'scale(0.92, 0.86) translateY(-4px)', origin: 'top left' });
        tabMenu.remove();
        tabMenu = null;
        document.removeEventListener('pointerdown', onTabMenuOutside, true);
        const back = focusKey != null && flowTabs.querySelector(`.flow-tab[data-tab="${CSS.escape(focusKey)}"]`);
        if (back) back.focus();
      }
      function onTabMenuOutside(e) { if (tabMenu && !tabMenu.contains(e.target)) closeTabMenu(); }
      function openTabMenu(key, btn, x, y) {
        closeTabMenu();
        ui.closeConfirm();
        const m = document.createElement('div');
        m.className = 'menu tab-menu';
        m.setAttribute('role', 'menu');
        m.dataset.exportSkip = '';
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = 'Delete';
        item.addEventListener('click', () => { closeTabMenu(); deleteSubprocessTab(key); });
        m.appendChild(item);
        m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTabMenu(key); } });
        document.body.appendChild(m);
        m.style.cssText = `position: fixed; right: auto; left: ${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px; top: ${Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8))}px; transform-origin: top left`;
        motion.anim(m, [
          { transform: 'scale(0.92, 0.86) translateY(-4px)', clipPath: 'inset(0 0 25% 0 round var(--radius-lg))' },
          { transform: 'none', clipPath: 'inset(0 0 0 0 round var(--radius-lg))' }
        ], { duration: Math.max(40, Math.round(motion.dur('dur-fast', 140) * motion.speedScale())), easing: motion.curve('curve-spring-tactile') });
        tabMenu = m;
        item.focus();
        document.addEventListener('pointerdown', onTabMenuOutside, true);
      }

      // The tab of a subprocess step is named like the step, and so is its start pill (the contract of the parent and the child)
      function syncChildName(node) {
        if (!hasChild(node.id) || !node.label) return;
        chartData.tabNames[node.id] = node.label;
        const start = chartData.flows[node.id].nodes.find(n => n.type === 'start');
        if (start) start.label = node.label;
        withTabMotion(renderTabs);
      }
      if (btnCollapseSub) btnCollapseSub.addEventListener('click', collapseToSubprocess);
      if (btnExpandSub) btnExpandSub.addEventListener('click', () => expandSubprocess());


      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'flowchart',
        defaultTitle: 'Interactive Swimlane Flowchart',
        toDisk,
        fromDisk,
        toMermaid,   // the writer and reader in mermaid.js; the shell hands them the saved form of the data
        fromMermaid,
        contentEl: swimlanesContainer,
        report: { node: '.flow-node', label: '.edge-label', labelText: '.edge-label-text', nodeText: '.node-label' },
        render: () => withMotion(render, { ghostExit: true, ghosts: true }),
        tidy: () => withMotion(() => { layoutDiagram(chartData); render(); updateStatus(true); }, { duration: BIG_MS, skipFreeNotes: true }),
        eachTab,
        isBackground: (el) => (isPresenting() && !!el.closest('.flow-node:not(.type-connector)')) || el.id === 'swimlanes-container' || el.classList.contains('lane-track') || el.classList.contains('lane-gutter'),
        clearSelection() {
          const hadNodes = selectedNodeIds.size > 0;
          const hadEdge = !!selectedEdgeId;
          if (!hadNodes && !hadEdge && !selectedLaneId && !selectedNoteId && !peekNodeId && !connectorPicking) return;
          clearNodeSelection();
          selectedEdgeId = null;
          selectedLaneId = null;
          selectedNoteId = null;
          peekNodeId = null;
          setConnectorPicking(false);   // a click on the canvas cancels waiting for an arrow
          markSelectedLane();
          if (hadNodes || hadEdge) renderEdges();
          applyNoteVisibility();
        },
        // Shift + drag on blank canvas: the steps (and connector circles) the box touches. `start` is true on the
        // first call of a box, so a toggle box always toggles against the selection it started from.
        selectInRect(r, mode, start) {
          if (start) boxBase = [...selectedNodeIds];
          const hit = [...document.querySelectorAll('.flow-node[data-node-id]')].filter(el => {
            const b = el.getBoundingClientRect();
            return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
          }).map(el => el.dataset.nodeId);
          const next = mode === 'toggle'
            ? boxBase.filter(id => !hit.includes(id)).concat(hit.filter(id => !boxBase.includes(id)))
            : hit;
          const same = next.length === selectedNodeIds.size && next.every(id => selectedNodeIds.has(id));
          if (!same || selectedEdgeId || selectedNoteId || selectedLaneId) setNodeSelection(next, selectedNodeId);
        },
        selectAll() { setNodeSelection(chartData.nodes.map(n => n.id), selectedNodeId); },
        cancelInteraction() {
          if (ui.closeConfirm()) return true;
          const wasConnecting = !!connectingFromNodeId;
          cancelConnecting();
          const wasPicking = notePicking || connectorPicking;
          setNotePicking(false);
          setConnectorPicking(false);
          return cancelNoteLink() || cancelNoteToolDrag() || cancelConnectorToolDrag() || cancelNoteDrag() || cancelPaletteDrag() || wasConnecting || wasPicking;
        },
        // Text search (shell contract): live DOM, in reading order along the flow. Steps and connector letters first
        // (by flow position, then lane, then across), then arrow labels, notes, lane titles. Notes are always in the DOM
        // but display:none until shown or peeked; then the item's el is its first linked step.
        searchItems() {
          const items = [];
          const add = (id, el, text) => { text = (text || '').trim(); if (el && text) items.push({ id, text, el }); };
          const tb = isTB();
          const laneAt = {};
          chartData.lanes.forEach((l, i) => { laneAt[l.id] = i; });
          const order = {};
          [...chartData.nodes].sort((a, b) => ((a.x || 0) - (b.x || 0)) || ((laneAt[a.laneId] || 0) - (laneAt[b.laneId] || 0)) || ((a.y || 0) - (b.y || 0)))
            .forEach((n, i) => { order[n.id] = i; });
          [...document.querySelectorAll('.flow-node')]
            .sort((a, b) => (order[a.dataset.nodeId] ?? 1e9) - (order[b.dataset.nodeId] ?? 1e9))
            .forEach(el => add('node:' + el.dataset.nodeId, el, el.querySelector('.node-label')?.textContent));
          const pos = (el) => parseFloat(tb ? el.style.top : el.style.left) || 0;
          [...document.querySelectorAll('.edge-label.has-label')].sort((a, b) => pos(a) - pos(b))
            .forEach(el => add('edge:' + el.dataset.edgeId, el, el.querySelector('.edge-label-text')?.textContent));
          const noteAt = (c) => Math.min(1e9, ...((noteById(c.dataset.noteId) || {}).nodes || []).map(id => order[id] ?? 1e9));
          [...(notesLayer ? notesLayer.children : [])].sort((a, b) => noteAt(a) - noteAt(b))
            .forEach(el => {
              // a hidden card has no box: ring and centre its first linked step instead
              const shown = getComputedStyle(el).display !== 'none';
              const first = ((noteById(el.dataset.noteId) || {}).nodes || [])[0];
              add('note:' + el.dataset.noteId, shown ? el : nodeElOf(first), el.querySelector('.note-text')?.textContent);
            });
          document.querySelectorAll('.swimlane').forEach(el => add('lane:' + el.dataset.laneId, el.querySelector('.lane-pill'), el.querySelector('.lane-title')?.textContent));
          return items;
        },
        onViewChange() { if (!tabGlide) ui.closeConfirm(); pinLaneHeaders(); placeNodeBar(); },
        // Notes on show may sit in the margin outside the lanes: Fit and screenshots take them in (peeked ones
        // are transient and do not count)
        contentOverflow() {
          // Notes and edge labels/arrows that reach past the container (e.g. a loop-back's label on the outer
          // corridor at the first lane's edge) stay OUTER_CLEAR inside the frame Fit and screenshots use.
          const W = swimlanesContainer.offsetWidth, H = swimlanesContainer.offsetHeight, PAD = 12;
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          const take = (el, pad) => {
            const b = containerBox(el);
            if (!b.w && !b.h) return;
            o.left = Math.max(o.left, pad - b.x);
            o.top = Math.max(o.top, pad - b.y);
            o.right = Math.max(o.right, b.x + b.w + pad - W);
            o.bottom = Math.max(o.bottom, b.y + b.h + pad - H);
          };
          if (notesLayer) [...notesLayer.children].forEach(c => { if (c.classList.contains('show')) take(c, PAD); });   // on show: all, or a free note
          edgeLabelsGroup.querySelectorAll('.edge-label.has-label').forEach(l => take(l, OUTER_CLEAR));
          return o;
        },
        hasSelection() {
          return !!(selectedNodeIds.size || selectedEdgeId || selectedNoteId || (selectedLaneId && chartData.lanes.length > 1));
        },
        deleteSelection(anchorEl) {
          if (selectedNoteId) removeNote(selectedNoteId);
          else if (selectedNodeIds.size > 1) deleteNodes([...selectedNodeIds]);
          else if (selectedNodeId) deleteNode(selectedNodeId);
          else if (selectedEdgeId) deleteEdge(selectedEdgeId);
          else if (selectedLaneId) confirmDeleteLane(selectedLaneId, anchorEl);
        }
      });
