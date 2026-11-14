      const NODE_WIDTH = 144;
      const NODE_HEIGHT = 64;
      const DECISION_WIDTH = 144;
      const DECISION_HEIGHT = 80;
      // Lane sizes come from the engine's LE (LANE_MIN, BOTTOM_PAD), which follows the diagram's direction
      // Lane colours by position for lanes without their own "color": sky, amber, emerald, rose, purple, orange,
      // teal, indigo. Light tints; flowchart.css derives the stripe, pill and dark-theme shades from the hue.
      const LANE_PALETTE = ['#e0f2fe', '#fef3c7', '#dcfce7', '#fee2e2', '#f3e8ff', '#ffedd5', '#ccfbf1', '#e0e7ff'];

      // --- DIRECTION ---
      // "direction": "TB" draws the diagram top-to-bottom: lanes become columns and steps run downwards. Node data
      // is always kept in flow terms (see engine.js LE_PROFILES): n.x runs along the flow from the start of the lane
      // track and n.y across the lane from its edge. In a left-to-right diagram those are the screen's x and y; in a
      // top-to-bottom one, n.x is the screen y and n.y the screen x. Every node takes an 80px slot along the flow
      // (a decision's height), and a 64px step is centred in it so steps and decisions line up on one axis.
      const isTB = () => chartData.direction === 'TB';
      // An on-page connector (engine.js CONN) is a CONN.SIZE circle at its own x/y, not a slot with an offset
      const nodeScreenH = (n) => (isConnector(n) ? CONN.SIZE : n.type === 'decision' ? DECISION_HEIGHT : NODE_HEIGHT);
      const flowInset = (n) => (isTB() && !isConnector(n) ? (DECISION_HEIGHT - nodeScreenH(n)) / 2 : 0);
      // A node's extent across its lane (lane sizing, lane hit tests) and along the flow (snapping)
      const crossSize = (n) => (isConnector(n) ? CONN.SIZE : isTB() ? NODE_WIDTH : nodeScreenH(n));
      const flowSize = (n, el) => (isConnector(n) ? CONN.SIZE : isTB() ? DECISION_HEIGHT : ((el && el.offsetWidth) || NODE_WIDTH));
      function placeNodeEl(el, n) {
        if (isConnector(n)) {
          el.style.left = `${(isTB() ? n.y : n.x) || 0}px`;
          el.style.top = `${(isTB() ? n.x : n.y) || 0}px`;
        } else if (isTB()) {
          el.style.left = `${n.y || 0}px`;
          el.style.top = `${(n.x || 0) + flowInset(n)}px`;
        } else {
          el.style.left = `${n.x || 80}px`;
          el.style.top = `${n.y || 53}px`;
        }
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
      let autoLayout = true;   // see AUTO LAYOUT
      try { autoLayout = localStorage.getItem('flowchart-auto-layout') !== 'off'; } catch (e) {}
      let dragCanInsert = false;   // the dragged node has no arrows, so it may be dropped into one
      let dragGroup = null;        // the other selected steps moving with draggingNode: [{ node, x, gy, lane }]
      let dragOrigin = null;       // where the drag started: { x, gy, lane, saved: [{ node, x, y, laneId }] }

      // Edge Connecting state
      let connectingFromNodeId = null;
      let connectingFromPort = null;
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

        // Length of the lane tracks along the flow: past the furthest node, and at least a screenful
        const maxX = chartData.nodes.reduce((m, n) => Math.max(m, (n.x || 0) + (tb ? DECISION_HEIGHT : NODE_WIDTH) + 48), tb ? 640 : 1200);

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
          outerExtra = need;
          renderLanes(maxX);
          renderNodes();
          renderEdges();
        }
        renderNotes(true);   // last: notes are fitted around the final nodes, arrows and labels
        pinLaneHeaders();
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
        edgeGroup.querySelectorAll('.connector-path').forEach(take);
        edgeLabelsGroup.querySelectorAll('.edge-label-container.has-label').forEach(take);
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
      function pinLaneHeaders() {
        if (chartData.swimlanes === false) { swimlanesContainer.classList.remove('lanes-pinned'); return; }
        const left = swimlanesContainer.offsetLeft + swimlanesContainer.clientLeft;   // container origin, stage coords
        const top = swimlanesContainer.offsetTop + swimlanesContainer.clientTop;
        const visLeft = -panX / scale - left;   // viewport's left edge in container coords
        const visTop = -panY / scale - top;
        const inset = PILL_INSET;
        const cs = swimlanesContainer.style;
        if (isTB()) {
          // Top-to-bottom: lanes are columns, so the stripe and the pills sit at the visible top edge instead,
          // and each pill follows its column sideways when the column is wider than the screen
          const y0 = Math.max(0, visTop);
          swimlanesContainer.classList.toggle('lanes-pinned', visTop > 0);
          cs.removeProperty('--rail-x');
          cs.removeProperty('--pill-x');
          cs.setProperty('--rail-y', `${y0}px`);
          cs.setProperty('--rail-b', `${3 / scale}px`);
          cs.setProperty('--pill-y', `${y0 + inset}px`);
          // Each pill is centred on the visible part of its column (the whole column when it is on screen)
          const visRight = visLeft + viewport.clientWidth / scale;
          lanesRoot.querySelectorAll('.swimlane').forEach(laneEl => {
            const pill = laneEl.querySelector('.lane-pill');
            if (!pill) return;
            const w = laneEl.offsetWidth, pw = pill.offsetWidth;
            const a = Math.max(0, visLeft - laneEl.offsetLeft), b = Math.min(w, visRight - laneEl.offsetLeft);
            const maxX = Math.max(inset, w - pw - inset);
            const x = Math.min(Math.max(b > a ? (a + b - pw) / 2 : (w - pw) / 2, inset), maxX);
            laneEl.style.setProperty('--pill-x', `${x}px`);
            laneEl.style.setProperty('--pill-cx', `${Math.max(inset, (w - pw) / 2)}px`);   // centred at rest (exports)
          });
          return;
        }
        const x0 = Math.max(0, visLeft);       // visible left edge of the lanes
        swimlanesContainer.classList.toggle('lanes-pinned', visLeft > 0);
        cs.removeProperty('--rail-y');
        cs.removeProperty('--pill-y');
        cs.setProperty('--rail-x', `${x0}px`);
        cs.setProperty('--rail-b', `${3 / scale}px`);
        cs.setProperty('--pill-x', `${x0 + inset}px`);
        lanesRoot.querySelectorAll('.swimlane').forEach(laneEl => {
          const pill = laneEl.querySelector('.lane-pill');
          if (!pill) return;
          const pillH = pill.offsetHeight + (pill.querySelector('.lane-tools') ? 36 : 0);   // + hover tools below it
          const maxY = Math.max(inset, laneEl.offsetHeight - pillH - inset);
          const y = Math.min(Math.max(visTop - laneEl.offsetTop + inset, inset), maxY);
          laneEl.style.setProperty('--pill-y', `${y}px`);
        });
      }

      function renderLanes(trackWidth) {
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
          // stripe, icon, pill tint; a lane without its own colour takes the palette colour for its position (not saved)
          laneEl.style.setProperty('--lane-color', lane.color || LANE_PALETTE[index % LANE_PALETTE.length]);
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
          pill.className = 'lane-pill';
          pill.draggable = editable;
          pill.dataset.tip = 'Click to select (Delete removes the lane) \u00b7 drag to reorder \u00b7 double-click to rename';
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            if (editable && !pill.classList.contains('editing')) selectLane(lane.id);
          });
          pill.appendChild(laneIconEl(lane, 15));
          const title = document.createElement('span');
          title.className = 'lane-title';
          title.contentEditable = 'false';
          title.spellcheck = false;
          title.textContent = lane.name;
          pill.appendChild(title);
          // Tools under the pill (shown while the lane is selected): a reorder grip, which drags the pill it
          // belongs to, and a delete button (hidden when this is the only lane)
          if (editable) {
            const tools = document.createElement('div');
            tools.className = 'lane-tools';
            tools.dataset.exportSkip = '';
            const grip = document.createElement('span');
            grip.className = 'lane-tool lane-tool-move';
            grip.dataset.tip = 'Drag to reorder swimlane';
            grip.setAttribute('aria-label', 'Reorder swimlane');
            grip.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
            grip.addEventListener('click', (e) => e.stopPropagation());
            tools.appendChild(grip);
            if (chartData.lanes.length > 1) {
              const del = document.createElement('button');
              del.type = 'button';
              del.className = 'lane-tool lane-tool-delete';
              del.draggable = false;
              del.dataset.tip = 'Delete swimlane (with its steps)';
              del.setAttribute('aria-label', 'Delete swimlane');
              del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>';
              del.addEventListener('pointerdown', (e) => e.stopPropagation());
              del.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
              del.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteLane(lane.id, del); });
              tools.appendChild(del);
            }
            pill.appendChild(tools);
          }
          if (tb) pill.style.maxWidth = `${Math.max(80, computedHeight - 2 * PILL_INSET)}px`;   // stays inside its column

          title.addEventListener('dblclick', (e) => {
            if (!editable) return;
            e.stopPropagation();
            pill.draggable = false;   // a draggable ancestor would swallow text selection
            pill.classList.add('editing');
            title.contentEditable = 'true';
            title.focus();
            const range = document.createRange();
            range.selectNodeContents(title);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
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

      // Lane icons: lane.icon names an entry of TYPE_ICONS (assets/types/flowchart/icons.json). A lane without one
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
        if (lane.icon && TYPE_ICONS[lane.icon]) return lane.icon;
        const name = String(lane.name || '').toLowerCase();
        const hit = LANE_ICON_GUESS.find(([re]) => re.test(name));
        return hit ? hit[1] : 'users';
      }
      function laneIconEl(lane, size = 20) {
        const chip = document.createElement('span');
        chip.className = 'lane-icon';
        chip.setAttribute('aria-hidden', 'true');   // decorative: the lane name sits right beside it
        chip.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICONS[laneIconName(lane)]}</svg>`;
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
        if (to !== from) {
          const [moved] = chartData.lanes.splice(from, 1);
          chartData.lanes.splice(to, 0, moved);
          relayout();   // lane order changes how steps are ordered and where loop-backs run
        }
      });

      // A start/end node with no label collapses to a circle, centred in its normal 144x64 slot
      const DOT_SIZE = 40;
      function isDot(n) { return (n.type === 'start' || n.type === 'end') && !(n.label || '').trim(); }
      function dotOffset(n) { return isDot(n) ? { x: (NODE_WIDTH - DOT_SIZE) / 2, y: (NODE_HEIGHT - DOT_SIZE) / 2 } : { x: 0, y: 0 }; }

      // --- SHAPED NODES ---
      // A shaped node keeps its slot's box (144x64; a decision 144x80), made transparent by flowchart.css, and draws
      // its outline inside it as an SVG stretched to the box (preserveAspectRatio="none", non-scaling stroke). The
      // outline stays 1px inside the box so the 2px stroke ends on the box edge, like a task's border. `.shape-path`
      // is the filled outline, `.shape-line` an inner stroke (the subprocess bars, the cylinder's front rim).
      // Shapes keep their screen orientation in a top-to-bottom diagram: the document's wave is always at the
      // bottom, the delay's arc always on the right. Keep outlineInset() in step with any change here.
      const SHAPE_OUTLINES = {
        decision:   { h: 80, svg: '<polygon class="shape-path diamond-poly" points="72,1 143,40 72,79 1,40"/>' },
        subprocess: { h: 64, svg: '<rect class="shape-path" x="1" y="1" width="142" height="62" rx="2"/><path class="shape-line" d="M13 1V63M131 1V63"/>' },
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
          case 'decision':   // four vertices at the side midpoints
            return (horiz ? r.h : r.w) / 2 * Math.min(1, Math.abs(c - 0.5) * 2);
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

      // Narrow shapes fit their text by width in pixels, not characters: "Specification?" fits a diamond
      // line, "Standard Spec?" (same length, wider letters) does not. A label that needs a third line steps its
      // font down 1px at a time, to FIT_MIN_PX, until it fits the 2-line clamp. data-base-px keeps the
      // designed size for the legibility report (shell.js), so a fitted label does not count as small text.
      const FIT_TYPES = new Set(['decision', 'subprocess', 'io', 'database', 'delay']);
      const FIT_MIN_PX = 11;
      function fitNodeLabel(label, type) {
        label.style.fontSize = '';
        delete label.dataset.basePx;
        if (!FIT_TYPES.has(type) || !label.isConnected) return;
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
      // guide between them (never exported); a click pans to the partner; a rename renames the whole pair; Delete
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
        el.dataset.tip = `${connectorAria(node)}\nClick to jump there · Drag onto a step to move this end there · Double-click to change the letter`;
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
        });
      }

      // Pan (same zoom) so the partner is centred, with a short pulse on it. An out-connector with several
      // in-connectors steps through them on each click.
      let jumpTurn = 0, panAnim = 0;
      function jumpToPartner(node) {
        const partners = connectorPartners(node);
        if (!partners.length) return;
        const p = partners[jumpTurn++ % partners.length];
        const el = nodeElOf(p.id);
        if (!el) return;
        const vp = viewport.getBoundingClientRect(), r = el.getBoundingClientRect();
        const dx = (vp.left + vp.width / 2) - (r.left + r.width / 2), dy = (vp.top + vp.height / 2) - (r.top + r.height / 2);
        const x0 = panX, y0 = panY, t0 = performance.now(), MS = 280;
        cancelAnimationFrame(panAnim);
        const stepPan = (t) => {
          const k = Math.min(1, (t - t0) / MS), ease = 1 - Math.pow(1 - k, 3);
          panX = x0 + dx * ease;
          panY = y0 + dy * ease;
          updateTransform();
          if (k < 1) panAnim = requestAnimationFrame(stepPan);
        };
        panAnim = requestAnimationFrame(stepPan);
        el.classList.remove('connector-pulse');
        void el.offsetWidth;   // restart the animation
        el.classList.add('connector-pulse');
        setTimeout(() => el.classList.remove('connector-pulse'), 1200);
      }

      // A short message above the dock (e.g. why a rename was refused)
      let hintTimer = 0;
      function flashHint(text) {
        let hint = document.querySelector('.flow-hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'note-pick-hint flow-hint';
          hint.setAttribute('role', 'status');
          hint.dataset.exportSkip = '';
          document.body.appendChild(hint);
        }
        hint.textContent = text;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => hint.remove(), 2600);
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
        const letter = joinLetter || nextConnectorLetter(chartData.nodes);
        const cIn = { id: uid('c'), laneId: src.laneId, type: 'connector', label: letter, x: src.x || 0, y: src.y || 0 };
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
      }

      // The selected arrow's Split chip (beside its label). When a pair already continues at this arrow's target, it
      // opens a choice: a new pair, or join that pair (a merge: several sources continuing at one out-connector).
      const SPLIT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M2 12h4"/><circle cx="9" cy="12" r="3"/><circle cx="15" cy="12" r="3"/><path d="M18 12h4"/></svg>';
      function buildSplitChip(edge, labelContainer, route) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'edge-split-chip';
        chip.dataset.exportSkip = '';
        chip.title = 'Split into a connector pair';
        chip.setAttribute('aria-label', 'Split this arrow into a connector pair');
        chip.innerHTML = SPLIT_ICON;
        chip.style.left = `${route.midX + labelContainer.offsetWidth / 2 + 18}px`;
        chip.style.top = `${route.midY}px`;
        chip.addEventListener('pointerdown', (e) => e.stopPropagation());
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const joins = joinableLetters(edge.to);
          if (!joins.length) { splitEdge(edge.id); return; }
          const menu = document.createElement('div');
          menu.className = 'edge-split-menu';
          menu.dataset.exportSkip = '';
          menu.setAttribute('role', 'menu');
          const item = (text, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.textContent = text;
            b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
            menu.appendChild(b);
            return b;
          };
          const first = item(`Split into new ${nextConnectorLetter(chartData.nodes)}`, () => splitEdge(edge.id));
          joins.forEach(l => item(`Join ${l} (continues at ${stepLabel(edge.to)})`, () => splitEdge(edge.id, l)));
          menu.style.left = chip.style.left;
          menu.style.top = `${route.midY + 16}px`;
          chip.after(menu);
          first.focus();
          menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); menu.remove(); chip.focus(); } });
        });
        return chip;
      }

      // Pairs whose out-connector continues at step `toId`: an arrow into that step may join them
      const joinableLetters = (toId) => [...new Set(chartData.nodes
        .filter(n => isConnector(n) && connectorRole(n.id) === 'out' && chartData.edges.some(e => e.from === n.id && e.to === toId))
        .map(connectorLetter))];

      // Delete a connector = join: the whole arrow comes back (src -> tgt, with its label and feedback flag). Deleting
      // one in-connector of a merge joins only its source; deleting the out-connector joins every source.
      function joinConnector(node) {
        joinConnectorData(node);
        pruneNotes();
        clearNodeSelection();
        placeAfterConnectorEdit();
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
        mine.forEach(e => { if (role === 'out') e.to = stepId; else e.from = stepId; });
        node.laneId = step.laneId;
        placeAfterConnectorEdit();
        selectNode(node.id);
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
        const cIn = { id: uid('c'), laneId: src.laneId, type: 'connector', label: letter, x: src.x || 0, y: src.y || 0 };
        chartData.nodes.push(cIn);
        edge.to = cIn.id;
        pruneConnectors();
        selectedEdgeId = null;
        placeAfterConnectorEdit();
        selectNode(cIn.id);
        return true;
      }

      // Re-place only the circles (an arrow edit moved a stub to another step): steps stay where they are
      function placeCirclesOnly() {
        render();
        placeConnectorsInPlace(chartData);
        render();
      }

      // Lay out after a connector edit: Auto-Tidy on, the whole layout (no step moves, only the circles appear);
      // off, the steps stay where they are and only the circles are placed beside them
      function placeAfterConnectorEdit() {
        if (autoLayout) { relayout(); return; }
        render();   // sizes the lanes the circles are fitted into
        placeConnectorsInPlace(chartData);
        render();
        updateStatus(true);
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
          label.dataset.tip = `${node.label || ''}
Double-click to edit text`;   // full text: the label is clamped to 2 lines
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
              updateStatus(true);
              if (wasDot !== isDot(node)) render();
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
            port.dataset.tip = `Click or drag to connect`;
            port.addEventListener('pointerdown', (e) => handlePortPointerDown(e, node.id, pos));
            nodeEl.appendChild(port);
          });

          nodeEl.appendChild(buildNoteBadge(node));   // note badge, or the "+" chip to add one

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

      // --- PLANAR ORTHOGONAL ROUTING & CHANNEL STAGGERING ENGINE ---
      // Top-to-bottom diagrams are routed in flow terms too: node boxes are transposed (x <-> y) before the route
      // search, so every rule written for a left-to-right flow applies unchanged, and the finished polylines are
      // transposed back before hops and labels are placed on screen (step 6).
      function computeAllEdgeRoutes() {
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const rects = {};
        const nodeMap = {};
        const tb = isTB();

        chartData.nodes.forEach(n => {
          nodeMap[n.id] = n;
          const el = document.getElementById(`node-${n.id}`);
          if (!el) return;
          const r = el.getBoundingClientRect();
          const x = (r.left - stageRect.left) / scale;
          const y = (r.top - stageRect.top) / scale;
          const w = r.width / scale;
          const h = r.height / scale;
          rects[n.id] = tb ? { x: y, y: x, w: h, h: w, cx: y + h / 2, cy: x + w / 2 } : { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        });

        // True when an axis-aligned segment keeps 6px clear of every node except `ignore`
        // (route search calls this hundreds of thousands of times per render, so it is a plain loop)
        const rectList = Object.keys(rects).map(id => [id, rects[id]]);
        const segmentClear = (x1, y1, x2, y2, ignore) => {
          const minX = Math.min(x1, x2) - 6, maxX = Math.max(x1, x2) + 6;
          const minY = Math.min(y1, y2) - 6, maxY = Math.max(y1, y2) + 6;
          for (let k = 0; k < rectList.length; k++) {
            const r = rectList[k][1];
            if (r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY && !ignore.includes(rectList[k][0])) return false;
          }
          return true;
        };

        const verticalEntryUsed = {};
        const outEdges = {};
        const inEdges = {};
        chartData.nodes.forEach(n => { outEdges[n.id] = []; inEdges[n.id] = []; });

        const validEdges = chartData.edges.filter(e => rects[e.from] && rects[e.to]);
        validEdges.forEach(e => {
          outEdges[e.from].push(e);
          inEdges[e.to].push(e);
        });

        // 0. Backward arrows (target left of source): pick the exit/entry sides that give the
        // fewest bends over a route that stays clear of every other node. When no candidate is
        // clear, the legacy fixed rule below (left exit + bypass corridor / bottom U-turn) applies.
        const backPorts = {};
        const backRoute = (f, t, fp, tp, ids) => {
          let pts;
          if (fp === 'left' && tp === 'right') {
            const sx = f.x, sy = f.cy, ex = t.x + t.w, ey = t.cy;
            if (ex > sx - 12) return null;
            if (Math.abs(sy - ey) < 6) pts = [[sx, sy], [ex, sy]];
            else { const mx = (sx + ex) / 2; pts = [[sx, sy], [mx, sy], [mx, ey], [ex, ey]]; }
          } else if (fp === 'left') {            // left exit, vertical entry into top/bottom: one bend
            const sx = f.x, sy = f.cy, ex = t.cx;
            const ey = tp === 'top' ? t.y : t.y + t.h;
            if (ex > sx - 20 || (tp === 'top' ? sy >= ey - 8 : sy <= ey + 8)) return null;
            pts = [[sx, sy], [ex, sy], [ex, ey]];
          } else if (tp === 'right') {           // vertical exit, side entry: one bend
            const sx = f.cx, sy = fp === 'top' ? f.y : f.y + f.h, ex = t.x + t.w, ey = t.cy;
            if (ex > sx - 20 || (fp === 'top' ? ey >= sy - 8 : ey <= sy + 8)) return null;
            pts = [[sx, sy], [sx, ey], [ex, ey]];
          } else if (fp === 'bottom' && tp === 'bottom') { // U-turn below both nodes: two bends
            const sx = f.cx, sy = f.y + f.h, ex = t.cx, ey = t.y + t.h;
            const g = Math.max(sy, ey) + 36;
            pts = [[sx, sy], [sx, g], [ex, g], [ex, ey]];
          } else if (fp === 'top' && tp === 'top') {       // U-turn above both nodes (a near-side loop, see loopSides)
            const sx = f.cx, sy = f.y, ex = t.cx, ey = t.y;
            const g = Math.min(sy, ey) - 36;
            pts = [[sx, sy], [sx, g], [ex, g], [ex, ey]];
          } else {
            return null;
          }
          for (let i = 0; i < pts.length - 1; i++) {
            if (!segmentClear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)) return null;
          }
          return pts.length - 2; // bends
        };
        // A same-lane loop-back U-turns on the side its lane reserved for it (the layout's loopSides rule)
        const loopSide = loopSides(chartData.nodes, chartData.edges, chartData.lanes);
        validEdges.forEach(e => {
          const f = rects[e.from], t = rects[e.to];
          if (!(t.cx < f.cx - 30)) return;
          const dy = t.cy - f.cy;
          const uTurn = nodeMap[e.from].laneId === nodeMap[e.to].laneId && loopSide(e) === 'near' ? 'top' : 'bottom';
          const legacy = dy > 30 ? { fromPort: 'left', toPort: 'top' }
            : dy < -30 ? { fromPort: 'left', toPort: 'bottom' }
            : { fromPort: uTurn, toPort: uTurn };
          // A side port is only reused when it is not already an exit/entry for a different role
          const leftExitFree = !inEdges[e.from].some(ie => ie !== e && rects[ie.from].cx < f.cx - 30 && Math.abs(rects[ie.from].cy - f.cy) <= 30);
          const rightEntryFree = !outEdges[e.to].some(o => o !== e && rects[o.to].cx >= t.cx - 30 && Math.abs(rects[o.to].cx - t.cx) >= 30);
          const cands = [];
          const sameRow = Math.abs(dy) <= 30;
          if (rightEntryFree) {
            if (leftExitFree) cands.push(['left', 'right']);
            if (!sameRow) cands.push([dy < 0 ? 'top' : 'bottom', 'right']);
          }
          if (!sameRow && leftExitFree) cands.push(['left', dy < 0 ? 'bottom' : 'top']);
          cands.push([uTurn, uTurn]);
          let best = null;
          cands.forEach(([fp, tp]) => {
            const bends = backRoute(f, t, fp, tp, [e.from, e.to]);
            if (bends === null) return;
            const isLegacy = fp === legacy.fromPort && tp === legacy.toPort;
            // Fewest bends wins; on a tie keep the legacy choice
            if (!best || bends < best.bends || (bends === best.bends && isLegacy)) best = { fromPort: fp, toPort: tp, bends };
          });
          backPorts[e.id] = best ? { fromPort: best.fromPort, toPort: best.toPort } : legacy;
        });

        // 1. Identify nodes that have a leftward loopback leaving their 'left' port
        const hasLeftLoopback = new Set();
        validEdges.forEach(e => {
          const bp = backPorts[e.id];
          if (bp && bp.fromPort === 'left' && Math.abs(rects[e.to].cy - rects[e.from].cy) > 30) {
            hasLeftLoopback.add(e.from);
          }
        });

        // 2. Assign departure and arrival ports per edge
        const edgePorts = {};
        Object.keys(outEdges).forEach(uId => {
          const uOuts = outEdges[uId];
          if (!uOuts.length) return;
          const f = rects[uId];
          const uNode = nodeMap[uId];
          const fwdOuts = [];

          uOuts.forEach(e => {
            const t = rects[e.to];
            if (t.cx < f.cx - 30) {
              edgePorts[e.id] = backPorts[e.id];
            } else {
              fwdOuts.push(e);
            }
          });

          const isMultiOrDecision = (uNode && uNode.type === 'decision') || fwdOuts.length > 1;
          const upCands = fwdOuts.filter(e => rects[e.to].cy < f.cy - 30).sort((a, b) => rects[a.to].cy - rects[b.to].cy);
          const downCands = fwdOuts.filter(e => rects[e.to].cy > f.cy + 30).sort((a, b) => rects[b.to].cy - rects[a.to].cy);
          // A target directly above/below gets the top/bottom exit (straight line); others leave via the side
          const alignedFirst = (list) => list.sort((a, b) => (Math.abs(rects[a.to].cx - f.cx) < 30 ? 0 : 1) - (Math.abs(rects[b.to].cx - f.cx) < 30 ? 0 : 1));
          alignedFirst(upCands);
          alignedFirst(downCands);

          // A decision gives each branch its own vertex: a vertex already taken by a loop-back branch
          // is not reused for a forward one (it would leave the diamond's slanted sides, off the vertex)
          const backTaken = new Set(uNode && uNode.type === 'decision'
            ? uOuts.filter(e => !fwdOuts.includes(e)).map(e => edgePorts[e.id] && edgePorts[e.id].fromPort)
            : []);
          let topEdgeId = (isMultiOrDecision && upCands.length > 0 && !backTaken.has('top')) ? upCands[0].id : null;
          let bottomEdgeId = (isMultiOrDecision && downCands.length > 0 && !backTaken.has('bottom')) ? downCands[0].id : null;
          if (!topEdgeId && upCands.length > 0 && !backTaken.has('top') && Math.abs(rects[upCands[0].to].cx - f.cx) < 30) {
            topEdgeId = upCands[0].id;
          }
          if (!bottomEdgeId && downCands.length > 0 && !backTaken.has('bottom') && Math.abs(rects[downCands[0].to].cx - f.cx) < 30) {
            bottomEdgeId = downCands[0].id;
          }

          fwdOuts.forEach(e => {
            const t = rects[e.to];
            let fromPort = 'right';
            if (e.id === topEdgeId) {
              fromPort = 'top';
            } else if (e.id === bottomEdgeId) {
              fromPort = 'bottom';
            }

            let toPort = 'left';
            if (hasLeftLoopback.has(e.to) && Math.abs(t.cy - f.cy) > 30) {
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (fromPort === 'right' && fwdOuts.length === 1 && uNode && uNode.type !== 'decision') {
              // One step into another lane: leave via top/bottom for a single bend instead of a Z
              const dy = t.cy - f.cy;
              if (Math.abs(dy) > 30 && (Math.abs(t.cx - f.cx) < 30 || t.x > f.cx + 40)) {
                const sy = dy > 0 ? f.y + f.h : f.y;
                if (segmentClear(f.cx, sy, f.cx, t.cy, [uId, e.to]) && segmentClear(f.cx, t.cy, t.x, t.cy, [uId, e.to])) {
                  fromPort = dy > 0 ? 'bottom' : 'top';
                }
              }
            }
            if ((fromPort === 'top' || fromPort === 'bottom') && Math.abs(t.cx - f.cx) < 30) {
              // Target sits directly above/below: straight vertical line
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (fromPort === 'right' && toPort === 'left' && Math.abs(t.cy - f.cy) > 30 && t.cx > f.x + f.w + 24) {
              // Side exit into a node in another lane that lies clearly to the right:
              // run along the source row, then enter the target from its bottom/top (one bend instead of two)
              const enterSide = t.cy < f.cy ? 'bottom' : 'top';
              const ey = enterSide === 'bottom' ? t.y + t.h : t.y;
              const sideKey = e.to + ':' + enterSide;
              // The run along the source row must not cut across the vertical trunk of a sibling fan-in
              // arrow: a source in a farther lane (same side) whose column lies between this source and
              // the target climbs straight up to the target's left port, so crossing it is unavoidable
              // here. Enter the left port instead (the sibling trunk then nests inside this route).
              // A sibling in the target's own column (|dx| < 30) climbs straight into the same
              // top/bottom port, so the row run would cut across it just the same.
              const cutsSiblingTrunk = (inEdges[e.to] || []).some(o => {
                if (o === e || !rects[o.from]) return false;
                const s = rects[o.from];
                const farther = enterSide === 'bottom' ? s.cy > f.cy + 30 : s.cy < f.cy - 30;
                return farther && s.cx > f.x + f.w && s.cx < t.cx + 30;
              });
              if (!verticalEntryUsed[sideKey] && !cutsSiblingTrunk
                  && segmentClear(f.x + f.w, f.cy, t.cx, f.cy, [uId, e.to])
                  && segmentClear(t.cx, f.cy, t.cx, ey, [uId, e.to])) {
                toPort = enterSide;
                verticalEntryUsed[sideKey] = true;
              }
            }
            edgePorts[e.id] = { fromPort, toPort };
          });
        });

        // 2b. Port roles: a top/bottom port must not serve as both an entry and an exit.
        // When it does, split it into two slots (entries one side, exits the other) so the
        // arrowhead of an incoming edge never sits on the departure point of an outgoing one.
        const PORT_SLOT = 10;
        const fromOffX = {};
        const toOffX = {};
        Object.keys(rects).forEach(nid => {
          ['top', 'bottom'].forEach(side => {
            const outs = outEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].fromPort === side);
            const ins = inEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].toPort === side);
            if (!outs.length || !ins.length) return;

            // If an edge is a straight vertical line to/from an aligned node, preserve it at cx (offset 0)
            // and put the slot offset on the other edge(s) so arrowheads never collide with departure points
            const isStraightOut = outs.some(e => Math.abs(rects[e.to].cx - rects[nid].cx) < 30 && (edgePorts[e.id].toPort === 'top' || edgePorts[e.id].toPort === 'bottom'));
            const isStraightIn = ins.some(e => Math.abs(rects[e.from].cx - rects[nid].cx) < 30 && (edgePorts[e.id].fromPort === 'top' || edgePorts[e.id].fromPort === 'bottom'));

            if (isStraightOut && !isStraightIn) {
              outs.forEach(e => { fromOffX[e.id] = 0; });
              const insMeanX = ins.reduce((s, e) => s + rects[e.from].cx, 0) / ins.length;
              const slotDir = insMeanX >= rects[nid].cx ? 1 : -1;
              ins.forEach(e => { toOffX[e.id] = slotDir * PORT_SLOT; });
              return;
            } else if (isStraightIn && !isStraightOut) {
              ins.forEach(e => { toOffX[e.id] = 0; });
              const outsMeanX = outs.reduce((s, e) => s + rects[e.to].cx, 0) / outs.length;
              const slotDir = outsMeanX >= rects[nid].cx ? 1 : -1;
              outs.forEach(e => { fromOffX[e.id] = slotDir * PORT_SLOT; });
              return;
            }

            const meanX = (list, key) => list.reduce((s, e) => s + rects[e[key]].cx, 0) / list.length;
            // Put each group on the side facing where its other ends are, to avoid new crossings
            const insFirst = meanX(ins, 'from') <= meanX(outs, 'to');
            ins.forEach(e => { toOffX[e.id] = insFirst ? -PORT_SLOT : PORT_SLOT; });
            outs.forEach(e => { fromOffX[e.id] = insFirst ? PORT_SLOT : -PORT_SLOT; });
          });
        });

        // Arrow-end rule (references/types/flowchart.md, checklist item 7): short left/right sides MERGE
        // same-role ends (one arrowhead / one fork point); long top/bottom sides SPREAD them 24px apart
        // (5a1, 5a3); entries and exits never share a point on any side (2b, 5a2).
        // 3. Stagger vertical arrival offsets on shared 'left' ports
        const toPortOffsetY = {};
        Object.keys(inEdges).forEach(vId => {
          const leftIns = inEdges[vId].filter(e => edgePorts[e.id] && edgePorts[e.id].toPort === 'left');
          if (leftIns.length > 1) {
            leftIns.sort((a, b) => rects[a.from].cy - rects[b.from].cy);
            // Arrows entering the same port converge on one entry point (single arrowhead)
            leftIns.forEach(e => { toPortOffsetY[e.id] = 0; });
          } else if (leftIns.length === 1) {
            toPortOffsetY[leftIns[0].id] = 0;
          }
        });

        // 4. Stagger vertical channel X for right->left elbow edges sharing the same column gap
        const channelXMap = {};
        const rlElbows = validEdges.filter(e => {
          const p = edgePorts[e.id];
          if (!p || p.fromPort !== 'right' || p.toPort !== 'left') return false;
          const sy = rects[e.from].cy;
          const ey = rects[e.to].cy + (toPortOffsetY[e.id] || 0);
          return Math.abs(sy - ey) >= 6;
        });

        // Group rlElbows by target column bucket
        const gapGroups = {};
        rlElbows.forEach(e => {
          const tx = Math.round(rects[e.to].x / 100) * 100;
          if (!gapGroups[tx]) gapGroups[tx] = [];
          gapGroups[tx].push(e);
        });

        Object.values(gapGroups).forEach(group => {
          if (group.length === 1) {
            const e = group[0];
            const sx = rects[e.from].x + rects[e.from].w;
            const ex = rects[e.to].x;
            channelXMap[e.id] = sx + (ex - sx) * 0.5;
          } else {
            // Sort upward edges by startY ascending, downward edges by startY descending for planar nesting
            const goingUp = group.filter(e => rects[e.to].cy < rects[e.from].cy).sort((a, b) => rects[a.from].cy - rects[b.from].cy);
            const goingDown = group.filter(e => rects[e.to].cy >= rects[e.from].cy).sort((a, b) => rects[b.from].cy - rects[a.from].cy);
            const ordered = [...goingUp, ...goingDown];

            ordered.forEach((e, idx) => {
              const sx = rects[e.from].x + rects[e.from].w;
              const ex = rects[e.to].x;
              const gap = ex - sx;
              const frac = (idx + 1) / (ordered.length + 1);
              channelXMap[e.id] = sx + Math.max(24, Math.min(gap - 24, gap * frac));
            });
          }
        });

        // 5. First pass: build polylines for all edges
        const edgePolylines = {};
        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const f = rects[e.from];
          const t = rects[e.to];
          const offsetY = toPortOffsetY[e.id] || 0;
          let points = [];

          if (p.toPort === 'right') {
            // Backward arrow entering the target's right side
            const ex = t.x + t.w, ey = t.cy;
            if (p.fromPort === 'left') {
              const sx = f.x, sy = f.cy;
              if (Math.abs(sy - ey) < 6) {
                points = [[sx, sy], [ex, sy]];
              } else {
                const mx = (sx + ex) / 2;
                points = [[sx, sy], [mx, sy], [mx, ey], [ex, ey]];
              }
            } else {
              const sx = f.cx + (fromOffX[e.id] || 0);
              const sy = p.fromPort === 'top' ? f.y : f.y + f.h;
              points = [[sx, sy], [sx, ey], [ex, ey]];
            }
          } else if (p.fromPort === 'left' && (p.toPort === 'top' || p.toPort === 'bottom')) {
            const sx = f.x;
            const sy = f.cy;
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            const xExit = sx - 24;
            const sourceAbove = (p.toPort === 'top') ? (sy < ey - 8) : (sy > ey + 8);
            if (sourceAbove && ex < sx - 20 && segmentClear(ex, sy, sx, sy, [e.from, e.to]) && segmentClear(ex, sy, ex, ey, [e.from, e.to])) {
              // Direct one-bend loop-back
              points = [[sx, sy], [ex, sy], [ex, ey]];
            } else {
              // Dedicated Outer Bypass Corridor: route outside node rows
              let bypassY = (p.toPort === 'top') ? Math.min(f.y - 20, t.y - 20) : Math.max(f.y + f.h + 20, t.y + t.h + 20);
              bypassY = Math.max(20, bypassY);
              points = [[sx, sy], [xExit, sy], [xExit, bypassY], [ex, bypassY], [ex, ey]];
            }
          } else if ((p.fromPort === 'top' || p.fromPort === 'bottom') && (p.toPort === 'top' || p.toPort === 'bottom')) {
            const sx = f.cx + (fromOffX[e.id] || 0);
            const sy = (p.fromPort === 'top') ? f.y : (f.y + f.h);
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            if (e.to === e.from || t.cx < f.cx - 30) {
              // U-turn: below both nodes, or above them when it leaves and enters through their tops
              const gutterY = p.fromPort === 'top' && p.toPort === 'top' ? Math.min(sy, ey) - 36 : Math.max(sy, ey) + 36;
              points = [[sx, sy], [sx, gutterY], [ex, gutterY], [ex, ey]];
            } else if (Math.abs(sx - ex) < 1) {
              points = [[sx, sy], [ex, ey]];
            } else {
              const midY = sy + (ey - sy) * 0.5;
              points = [[sx, sy], [sx, midY], [ex, midY], [ex, ey]];
            }
          } else if (p.fromPort === 'right' && (p.toPort === 'top' || p.toPort === 'bottom')) {
            // Side exit, then straight into the target's top/bottom: a single bend
            const sx = f.x + f.w;
            const sy = f.cy;
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            points = [[sx, sy], [ex, sy], [ex, ey]];
          } else if ((p.fromPort === 'top' || p.fromPort === 'bottom') && p.toPort === 'left') {
            const sx = f.cx + (fromOffX[e.id] || 0);
            const sy = (p.fromPort === 'top') ? f.y : (f.y + f.h);
            const ex = t.x;
            const ey = t.cy + offsetY;
            points = [[sx, sy], [sx, ey], [ex, ey]];
          } else {
            const sx = f.x + f.w;
            const sy = f.cy;
            const ex = t.x;
            const ey = t.cy + offsetY;

            if (Math.abs(sy - ey) < 6) {
              points = [[sx, sy], [ex, sy]];
            } else {
              const midX = channelXMap[e.id] !== undefined ? channelXMap[e.id] : (sx + (ex - sx) * 0.5);
              points = [[sx, sy], [midX, sy], [midX, ey], [ex, ey]];
            }
          }
          edgePolylines[e.id] = points;
        });

        // 4b. U-turn loop-backs that share a gutter and overlap horizontally would draw on top of each other:
        // give each its own gutter row, shortest spans nearest the nodes (further down below the nodes, further up
        // above them).
        [1, -1].forEach(dir => {
          const isU = pts => pts && pts.length === 4 && Math.abs(pts[1][1] - pts[2][1]) < 1 &&
            Math.abs(pts[0][0] - pts[1][0]) < 1 && Math.abs(pts[2][0] - pts[3][0]) < 1 &&
            (pts[1][1] - pts[0][1]) * dir > 0 && (pts[2][1] - pts[3][1]) * dir > 0;
          const us = validEdges.filter(e => isU(edgePolylines[e.id])).map(e => {
            const pts = edgePolylines[e.id];
            return { e, y: pts[1][1], lo: Math.min(pts[0][0], pts[3][0]), hi: Math.max(pts[0][0], pts[3][0]) };
          }).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
          const placed = [];
          us.forEach(u => {
            let k = 0;
            while (placed.some(q => Math.abs(q.y - (u.y + dir * k * 14)) < 2 && q.lo < u.hi && u.lo < q.hi)) k++;
            const pts = edgePolylines[u.e.id];
            if (k) { pts[1][1] += dir * k * 14; pts[2][1] += dir * k * 14; }
            placed.push({ y: pts[1][1], lo: u.lo, hi: u.hi });
          });
        });

        // 5a. Obstructed routes: when the standard route runs through another node, search every
        // exit/entry side pair (L, Z and U shapes) for a route that stays clear, preferring the
        // fewest bends and the least overlap with other arrows. Unobstructed routes are untouched.
        const polyClear = (pts, ids) => {
          for (let i = 0; i < pts.length - 1; i++) {
            if (!segmentClear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)) return false;
          }
          return true;
        };
        // How a route relates to another arrow: collinear overlap, near-parallel run (<18px) and
        // perpendicular crossings. Arrows that share a node (forks/merges) are exempt by the caller.
        const bboxCache = new WeakMap();
        const bboxOf = (pts) => {
          let b = bboxCache.get(pts);
          if (b) return b;
          b = [Infinity, Infinity, -Infinity, -Infinity];
          for (const [x, y] of pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
          bboxCache.set(pts, b);
          return b;
        };
        const NONE = { overlap: 0, near: 0, cross: 0 };
        const relate = (pts, otherPts, skipFirst = false, skipLast = false) => {
          // Every relation needs the two routes within 18px of each other: skip pairs whose boxes are further apart.
          // Only stable (unmutated) polylines are cached; the candidate route is measured fresh.
          const a = bboxOf(otherPts);
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (const [x, y] of pts) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
          if (x1 > a[2] + 18 || a[0] > x2 + 18 || y1 > a[3] + 18 || a[1] > y2 + 18) return NONE;
          let overlap = 0, near = 0, cross = 0;
          const lastI = pts.length - 2, lastJ = otherPts.length - 2;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            const aV = Math.abs(ax - bx) < 1, aH = Math.abs(ay - by) < 1;
            for (let j = 0; j < otherPts.length - 1; j++) {
              if ((skipFirst && i === 0 && j === 0) || (skipLast && i === lastI && j === lastJ)) continue;
              const [cx, cy] = otherPts[j], [dx, dy] = otherPts[j + 1];
              const cV = Math.abs(cx - dx) < 1, cH = Math.abs(cy - dy) < 1;
              if (aV && cV) {
                const run = Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy));
                if (run > 1) { const gap = Math.abs(ax - cx); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if (aH && cH) {
                const run = Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx));
                if (run > 1) { const gap = Math.abs(ay - cy); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if ((aV && cH) || (aH && cV)) {
                const [vx, vy1, vy2, hy, hx1, hx2] = aV
                  ? [ax, Math.min(ay, by), Math.max(ay, by), cy, Math.min(cx, dx), Math.max(cx, dx)]
                  : [cx, Math.min(cy, dy), Math.max(cy, dy), ay, Math.min(ax, bx), Math.max(ax, bx)];
                if (hx1 + 1 < vx && vx < hx2 - 1 && vy1 + 1 < hy && hy < vy2 - 1) cross += 1;
              }
            }
          }
          return { overlap, near, cross };
        };
        // Cost model: overlap >> near-parallel > crossing (~1.75 bends) > bend > length
        const COST = { overlap: 20000, near: 2500, cross: 1750, bend: 1000, divider: 1500, nearNode: 600, portClash: 2500, sharedBranch: 1200, entryShare: 1500 };
        const laneDividers = Array.from(document.querySelectorAll('.lane-track')).slice(0, -1)
          .map(t => (tb ? t.getBoundingClientRect().right - stageRect.left : t.getBoundingClientRect().bottom - stageRect.top) / scale);
        const routeDefects = (pts, ids) => {
          // Penalties independent of other arrows: hugging a lane divider, crowding a node
          let d = 0;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) > 30 && laneDividers.some(y => Math.abs(ay - y) < 8)) d += COST.divider;
            const x1 = Math.min(ax, bx) - 14, x2 = Math.max(ax, bx) + 14, y1 = Math.min(ay, by) - 14, y2 = Math.max(ay, by) + 14;
            let tight = false;
            for (let k = 0; k < rectList.length && !tight; k++) {
              const r = rectList[k][1];
              tight = r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1 && !ids.includes(rectList[k][0]);
            }
            if (tight) d += COST.nearNode;
          }
          return d;
        };
        // An arrow must not enter a side of a node that another arrow leaves from (or vice versa)
        // (top/bottom sides are exempt: they get separate entry/exit slots in 2b and 5a2)
        const sideOnly = side => (side === 'left' || side === 'right') ? side : null;
        const portClashes = (edge, fp, tp) => validEdges.filter(o => o !== edge && edgePorts[o.id] && (
          (o.from === edge.to && sideOnly(tp) && edgePorts[o.id].fromPort === tp) ||
          (o.to === edge.from && sideOnly(fp) && edgePorts[o.id].toPort === fp))).length;
        // Two branches of one decision that carry different labels should leave from different vertices.
        // Not a hard rule (a diamond has only four): it is a cost, so a branch moves to another side only
        // when that side has less overlap/crossing, and shares a vertex when every alternative is worse.
        const sharedBranchVertex = (edge, fp) => {
          const src = nodeMap[edge.from];
          if (!src || src.type !== 'decision') return 0;
          return outEdges[edge.from].filter(o => o !== edge && edgePorts[o.id] && edgePorts[o.id].fromPort === fp
            && (o.label || '').trim().toLowerCase() !== (edge.label || '').trim().toLowerCase()).length;
        };
        const ownBodyClear = (pts, edge) => {
          for (const id of [edge.from, edge.to]) {
            const r = rects[id];
            if (!r) continue;
            const x1 = r.x + 3, x2 = r.x + r.w - 3, y1 = r.y + 3, y2 = r.y + r.h - 3;
            for (let i = 0; i < pts.length - 1; i++) {
              const ax = Math.min(pts[i][0], pts[i + 1][0]), bx = Math.max(pts[i][0], pts[i + 1][0]);
              const ay = Math.min(pts[i][1], pts[i + 1][1]), by = Math.max(pts[i][1], pts[i + 1][1]);
              if (ax < x2 && bx > x1 && ay < y2 && by > y1) return false;
            }
          }
          return true;
        };
        const routeCost = (pts, edge, others, fp, tp, limit = Infinity) => {
          const ids = [edge.from, edge.to];
          let len = 0;
          for (let i = 0; i < pts.length - 1; i++) len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
          if ((pts.length - 2) * COST.bend + len >= limit) return Infinity;   // cannot beat the best so far
          if (!polyClear(pts, ids)) return Infinity;
          // A route must not run back through the body of its own source or target node
          if (!ownBodyClear(pts, edge)) return Infinity;
          // Every penalty is non-negative, so once the running cost reaches `limit` this route cannot win: stop
          const fixed = (pts.length - 2) * COST.bend + len;
          let defect = portClashes(edge, fp, tp) * COST.portClash + sharedBranchVertex(edge, fp) * COST.sharedBranch;
          if (fixed + defect >= limit) return Infinity;
          for (let k = 0; k < others.length; k++) {
            const o = others[k], op = edgePorts[o.id];
            const incident = o.from === edge.from || o.to === edge.to || o.from === edge.to || o.to === edge.from;
            const skipFirst = o.from === edge.from && op && op.fromPort === fp;
            const skipLast = o.to === edge.to && op && op.toPort === tp;
            const r = relate(pts, edgePolylines[o.id], skipFirst, skipLast);
            defect += (r.overlap > 0 ? COST.overlap + r.overlap : 0) + (incident ? 0 : r.near * COST.near) + r.cross * COST.cross;
            if (fixed + defect >= limit) return Infinity;
          }
          defect += routeDefects(pts, ids);
          if (fixed + defect >= limit) return Infinity;
          return { cost: fixed + defect, defect };
        };
        const anchor = (r, side) => side === 'top' ? [r.cx, r.y] : side === 'bottom' ? [r.cx, r.y + r.h]
          : side === 'left' ? [r.x, r.cy] : [r.x + r.w, r.cy];
        // Whole-diagram bounds, for corridor routes that run around everything
        const bounds = Object.values(rects).reduce((b, r) => ({
          minX: Math.min(b.minX, r.x), maxX: Math.max(b.maxX, r.x + r.w),
          minY: Math.min(b.minY, r.y), maxY: Math.max(b.maxY, r.y + r.h)
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        const altRoutes = (f, t, deep) => {
          const out = [];
          const SIDES = ['top', 'bottom', 'left', 'right'];
          const horiz = s => s === 'left' || s === 'right';
          SIDES.forEach(fp => SIDES.forEach(tp => {
            const [sx, sy] = anchor(f, fp), [ex, ey] = anchor(t, tp);
            const add = (pts, dev = 0) => out.push({ fp, tp, pts, dev });
            if (horiz(fp) && horiz(tp)) {
              if (fp === tp) return;
              const dirOk = fp === 'right' ? ex > sx + 28 : ex < sx - 28;
              if (!dirOk) return;
              if (Math.abs(sy - ey) < 6) { add([[sx, sy], [ex, sy]]); return; }
              const lo = Math.min(sx, ex) + 14, hi = Math.max(sx, ex) - 14;
              for (let x = lo; x <= hi; x += 10) add([[sx, sy], [x, sy], [x, ey], [ex, ey]], Math.abs(x - (sx + ex) / 2));
            } else if (!horiz(fp) && !horiz(tp)) {
              if (fp !== tp) {
                const dirOk = fp === 'bottom' ? ey > sy + 28 : ey < sy - 28;
                if (!dirOk) return;
                if (Math.abs(sx - ex) < 1) { add([[sx, sy], [ex, ey]]); return; }
                const lo = Math.min(sy, ey) + 14, hi = Math.max(sy, ey) - 14;
                for (let y = lo; y <= hi; y += 10) add([[sx, sy], [sx, y], [ex, y], [ex, ey]], Math.abs(y - (sy + ey) / 2));
              } else {
                [14, 20, 28, 36, 48, 72].forEach(d => {
                  const g = fp === 'top' ? Math.min(sy, ey) - d : Math.max(sy, ey) + d;
                  if (g < 8) return;
                  add([[sx, sy], [sx, g], [ex, g], [ex, ey]]);
                });
              }
            } else if (horiz(fp)) {
              // horizontal exit, vertical entry: one bend
              if (!(fp === 'right' ? ex <= sx + 20 : ex >= sx - 20) && !(tp === 'top' ? ey <= sy + 8 : ey >= sy - 8)) {
                add([[sx, sy], [ex, sy], [ex, ey]]);
              }
            } else {
              // vertical exit, horizontal entry: one bend
              if (!(fp === 'top' ? sy <= ey + 8 : sy >= ey - 8) && !(tp === 'left' ? ex <= sx + 20 : ex >= sx - 20)) {
                add([[sx, sy], [sx, ey], [ex, ey]]);
              }
            }
            if (deep && horiz(fp) !== horiz(tp)) {
              // Three bends through a corridor: leave, run along a corridor, drop/rise, then enter
              const STEP = 16;
              if (!horiz(fp)) {
                // vertical exit -> corridor above/below -> sideways to x -> vertical -> horizontal entry
                [16, 20, 36, 56].forEach(d => {
                  const g = fp === 'top' ? sy - d : sy + d;
                  for (let x = bounds.minX - 24; x <= bounds.maxX + 24; x += STEP) {
                    if (tp === 'left' ? x > ex - 14 : x < ex + 14) continue;
                    if (Math.abs(x - sx) < 10 || Math.abs(ey - g) < 10) continue;
                    add([[sx, sy], [sx, g], [x, g], [x, ey], [ex, ey]], 0);
                  }
                });
              } else {
                // horizontal exit -> out to x -> vertical to corridor g -> across -> vertical entry
                [16, 20, 36, 56].forEach(d => {
                  const x = fp === 'right' ? sx + d : sx - d;
                  for (let g = bounds.minY - 24; g <= bounds.maxY + 24; g += STEP) {
                    if (tp === 'top' ? g > ey - 14 : g < ey + 14) continue;
                    if (Math.abs(g - sy) < 10 || Math.abs(ex - x) < 10) continue;
                    add([[sx, sy], [x, sy], [x, g], [ex, g], [ex, ey]], 0);
                  }
                });
              }
            }
          }));
          return out;
        };
        // Longest arrows first: they are the most constrained, shorter ones then route around them
        const manhattan = e => Math.abs(rects[e.from].cx - rects[e.to].cx) + Math.abs(rects[e.from].cy - rects[e.to].cy);
        [...validEdges].sort((a2, b2) => manhattan(b2) - manhattan(a2)).forEach(e => {
          if (e.to === e.from) return;
          const cur = edgePolylines[e.id];
          if (!cur) return;
          const others = validEdges.filter(o => o !== e && edgePolylines[o.id]);
          // A decision branch that leaves from the top/bottom vertex an incoming arrow already takes gets pushed
          // off the vertex onto the diamond's slanted edge (2b/5a2). That is a cost, not a ban: the branch moves
          // to a free vertex only when that route is clean enough to beat it (a detour that adds a crossing does not).
          const srcIsDecision = nodeMap[e.from] && nodeMap[e.from].type === 'decision';
          const entryVertex = s => srcIsDecision && (s === 'top' || s === 'bottom')
            && (inEdges[e.from] || []).some(o => edgePorts[o.id] && edgePorts[o.id].toPort === s);
          const entryShare = s => entryVertex(s) ? COST.entryShare : 0;
          const base = routeCost(cur, e, others, edgePorts[e.id].fromPort, edgePorts[e.id].toPort);
          // Already clean (clear of nodes, no overlap/crossing/crowding, on its own vertex): keep it
          if (base !== Infinity && base.defect === 0 && !entryVertex(edgePorts[e.id].fromPort)) return;
          const baseCost = base === Infinity ? Infinity : base.cost + entryShare(edgePorts[e.id].fromPort);
          let best = null;
          // 3-bend corridor routes are only worth searching when the standard route is in real trouble
          const deep = base === Infinity || base.defect >= COST.cross;
          altRoutes(rects[e.from], rects[e.to], deep).forEach(c => {
            const r = routeCost(c.pts, e, others, c.fp, c.tp, best ? best.cost : baseCost - 250);
            if (r === Infinity) return;
            // Changing sides is a bigger visual change than sliding a channel, so it must earn it
            const sideChange = (c.fp !== edgePorts[e.id].fromPort || c.tp !== edgePorts[e.id].toPort) ? 600 : 0;
            const cost = r.cost + c.dev * 0.3 + sideChange + entryShare(c.fp);
            if (!best || cost < best.cost) best = { cost, c };
          });
          // Hysteresis: only switch for a clear win, so near-ties keep the standard route
          if (best && best.cost < baseCost - 250) {
            edgePolylines[e.id] = best.c.pts;
            edgePorts[e.id] = { fromPort: best.c.fp, toPort: best.c.tp };
          }
        });

        // 5a1. Spread arrows that share one contact point on a top/bottom side: several entries from
        // different sources, or several exits to different targets, would otherwise merge into a single
        // line. They get 24px apart (a straight, aligned arrow keeps the centre and the others move away).
        const SPREAD = 24;
        // Order of arrow ends along a top/bottom side: by where their other end lies. On a tie (targets in one
        // column), the arrow whose vertical run is longer goes on the inside of the turn, so the shorter one,
        // turning first, never has its horizontal run cut by the longer one's vertical.
        const farOrder = (far1, far2, cx, pts1, a1, b1, pts2, a2, b2) => {
          const run1 = Math.abs(pts1[b1][1] - pts1[a1][1]), run2 = Math.abs(pts2[b2][1] - pts2[a2][1]);
          // Both heading the same way with different-depth turns: the deeper run goes on the inside, so the
          // shallower one's horizontal never crosses it (ordering by target x alone made them cross)
          if (Math.abs(run1 - run2) >= 1 && (far1 > cx) === (far2 > cx) && pts1.length === 3 && pts2.length === 3) {
            return far1 > cx ? run2 - run1 : run1 - run2;
          }
          if (Math.abs(far1 - far2) >= 1) return far1 - far2;
          return far1 > cx ? run2 - run1 : run1 - run2;
        };
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', r.y], ['bottom', r.y + r.h]].forEach(([side, edgeY]) => {
            ['out', 'in'].forEach(role => {
              // A decision's top/bottom side is a single vertex: never spread arrows along it (incoming
              // ones share one arrowhead; outgoing branches each get their own vertex in step 2)
              if (nodeMap[nid] && nodeMap[nid].type === 'decision') return;
              const ends = [];
              validEdges.forEach(e => {
                const pts = edgePolylines[e.id];
                if (!pts) return;
                const n = pts.length;
                if (role === 'out' && e.from === nid && Math.abs(pts[0][1] - edgeY) < 1 && Math.abs(pts[0][0] - pts[1][0]) < 1)
                  ends.push({ e, a: 0, b: 1, x: pts[0][0], fixed: n < 3, peer: e.to, far: pts[n - 1][0] });
                if (role === 'in' && e.to === nid && Math.abs(pts[n - 1][1] - edgeY) < 1 && Math.abs(pts[n - 1][0] - pts[n - 2][0]) < 1)
                  ends.push({ e, a: n - 1, b: n - 2, x: pts[n - 1][0], fixed: n < 3, peer: e.from, far: pts[0][0] });
              });
              ends.sort((p1, p2) => p1.x - p2.x);
              let i = 0;
              while (i < ends.length) {
                let j = i + 1;
                while (j < ends.length && ends[j].x - ends[j - 1].x < 10) j++;
                const cluster = ends.slice(i, j);
                i = j;
                if (cluster.length < 2 || new Set(cluster.map(c => c.peer)).size < 2) continue;
                const fixed = cluster.filter(c => c.fixed), movable = cluster.filter(c => !c.fixed).sort((p1, p2) =>
                  farOrder(p1.far, p2.far, r.cx, edgePolylines[p1.e.id], p1.a, p1.b, edgePolylines[p2.e.id], p2.a, p2.b));
                // Nested U-turn loop-backs (each deeper than the last): the one whose source is furthest away
                // sits in the deepest gutter, so it must land first/left or its rising leg cuts the shallower loop
                if (movable.length > 1 && movable.every(c => edgePolylines[c.e.id].length === 4)) movable.reverse();
                if (!movable.length) continue;
                const base0 = cluster.reduce((s2, c) => s2 + c.x, 0) / cluster.length;
                const shiftEnd = (c, nx) => { edgePolylines[c.e.id][c.a][0] = nx; edgePolylines[c.e.id][c.b][0] = nx; };
                if (fixed.length) {
                  const fx = fixed[0].x;
                  // Each moved end slides toward the side its other end lies on, so it never has to cross
                  // the straight arrow (movable is sorted by `far`, so the nearest-to-centre ends sit closest)
                  const sideCount = { '-1': 0, '1': 0 };
                  const ordered = [...movable].sort((p1, p2) => Math.abs(p1.far - fx) - Math.abs(p2.far - fx));
                  ordered.forEach(c => {
                    const dir = c.far < fx - 1 ? -1 : c.far > fx + 1 ? 1 : (sideCount['1'] <= sideCount['-1'] ? 1 : -1);
                    sideCount[dir] += 1;
                    shiftEnd(c, fx + dir * SPREAD * sideCount[dir]);
                  });
                } else {
                  const m = movable.length;
                  movable.forEach((c, k) => shiftEnd(c, base0 + (k - (m - 1) / 2) * SPREAD));
                }
              }
            });
          });
        });

        // 5a2. Port separation: where an arrow enters and another leaves the same side of a node,
        // keep their contact points at least 16px apart so an arrowhead never sits on a departure.
        const SEP = 16, SHIFT = 9;
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', 0, r.y], ['bottom', 0, r.y + r.h], ['left', 1, r.x], ['right', 1, r.x + r.w]].forEach(([side, ai, edgeCoord]) => {
            const fi = 1 - ai; // ai: coordinate that slides along the side, fi: the fixed one
            const ends = [];
            validEdges.forEach(e => {
              const pts = edgePolylines[e.id];
              if (!pts || pts.length < 3) return;       // straight lines stay aligned
              const n = pts.length;
              if (e.from === nid && Math.abs(pts[0][fi] - edgeCoord) < 1 && Math.abs(pts[0][ai] - pts[1][ai]) < 1) ends.push({ e, role: 'out', a: 0, b: 1, other: pts[n - 1][ai] });
              if (e.to === nid && Math.abs(pts[n - 1][fi] - edgeCoord) < 1 && Math.abs(pts[n - 1][ai] - pts[n - 2][ai]) < 1) ends.push({ e, role: 'in', a: n - 1, b: n - 2, other: pts[0][ai] });
            });
            const outs = ends.filter(x => x.role === 'out'), ins = ends.filter(x => x.role === 'in');
            if (!outs.length || !ins.length) return;
            const at = x => edgePolylines[x.e.id][x.a][ai];
            const minGap = Math.min(...ins.flatMap(i => outs.map(o => Math.abs(at(i) - at(o)))));
            if (minGap >= SEP) return;
            const mean = l => l.reduce((s2, x) => s2 + x.other, 0) / l.length;
            const insLow = mean(ins) <= mean(outs);
            const shift = (x, d) => { edgePolylines[x.e.id][x.a][ai] += d; edgePolylines[x.e.id][x.b][ai] += d; };
            ins.forEach(x => shift(x, insLow ? -SHIFT : SHIFT));
            outs.forEach(x => shift(x, insLow ? SHIFT : -SHIFT));
          });
        });

        // 5a3. Arrowhead clearance on top/bottom sides. Every contact point (entry or exit) on one side
        // must be at least CLEAR px from the next one. 5a1/5a2 leave gaps they cannot see: a straight,
        // aligned arrow keeps the side's centre and was exempt, so a neighbouring arrowhead could land
        // 3px from it. Straight arrows stay where they are; the others slide to the side their other end
        // lies on. Edges that merge on purpose (same role, same other node, same spot) move together.
        const CLEAR = 24;
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', r.y], ['bottom', r.y + r.h]].forEach(([side, edgeY]) => {
            const units = new Map();
            validEdges.forEach(e => {
              const pts = edgePolylines[e.id];
              if (!pts) return;
              const n = pts.length;
              const add = (role, a, b, peer, far) => {
                const mergeIn = role === 'in' && nodeMap[nid] && nodeMap[nid].type === 'decision';
                const key = role + '|' + (mergeIn ? '*' : peer) + '|' + Math.round(pts[a][0]);
                if (!units.has(key)) units.set(key, { x: pts[a][0], fixed: false, far, ends: [] });
                const u = units.get(key);
                u.ends.push({ pts, a, b });
                if (n < 3) u.fixed = true;
              };
              if (e.from === nid && Math.abs(pts[0][1] - edgeY) < 1 && Math.abs(pts[0][0] - pts[1][0]) < 1) add('out', 0, 1, e.to, pts[n - 1][0]);
              if (e.to === nid && Math.abs(pts[n - 1][1] - edgeY) < 1 && Math.abs(pts[n - 1][0] - pts[n - 2][0]) < 1) add('in', n - 1, n - 2, e.from, pts[0][0]);
            });
            const sorted = [...units.values()].sort((u1, u2) => u1.x - u2.x);
            const lo = r.x + 14, hi = r.x + r.w - 14;
            const place = (u, nx) => {
              const x = Math.max(lo, Math.min(hi, nx));
              u.ends.forEach(en => { en.pts[en.a][0] = x; en.pts[en.b][0] = x; });
              u.x = x;
            };
            let i = 0;
            while (i < sorted.length) {
              let j = i + 1;
              while (j < sorted.length && sorted[j].x - sorted[j - 1].x < CLEAR - 0.5) j++;
              const cluster = sorted.slice(i, j);
              i = j;
              const fixed = cluster.filter(u => u.fixed);
              const movable = cluster.filter(u => !u.fixed).sort((u1, u2) => farOrder(u1.far, u2.far, r.cx,
                u1.ends[0].pts, u1.ends[0].a, u1.ends[0].b, u2.ends[0].pts, u2.ends[0].a, u2.ends[0].b));
              if (cluster.length < 2 || !movable.length) continue;
              // Nested U-turn loop-backs: the arrow with the furthest source runs in the deepest gutter, so it
              // must take the slot nearest the fixed/centre line (or the outermost on the other side), never
              // the reverse, or its rising leg cuts through the shallower loop
              const nested = movable.length > 1 && movable.every(u => u.ends.every(en => en.pts.length === 4));
              if (nested) movable.reverse();
              if (!fixed.length) {
                const mean = cluster.reduce((s2, u) => s2 + u.x, 0) / cluster.length;
                movable.forEach((u, k) => place(u, mean + (k - (movable.length - 1) / 2) * CLEAR));
              } else {
                const fMin = Math.min(...fixed.map(u => u.x)), fMax = Math.max(...fixed.map(u => u.x));
                const anchor = (fMin + fMax) / 2;
                const left = movable.filter(u => u.far < anchor - 1).sort((u1, u2) => nested ? u1.far - u2.far : u2.far - u1.far);
                const right = movable.filter(u => !(u.far < anchor - 1));
                left.forEach((u, k) => place(u, fMin - CLEAR * (k + 1)));
                right.forEach((u, k) => place(u, fMax + CLEAR * (k + 1)));
              }
            }
          });
        });

        // 5b. De-overlap: unrelated edges must not share a collinear stretch. Spread interior
        // segments (never the port-attached first/last ones) onto parallel tracks.
        // Edges sharing a source or a target may still merge/fork on purpose.
        const TRACK_GAP = 8;
        ['v', 'h'].forEach(orient => {
          const segs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts) return;
            for (let i = 1; i < pts.length - 2; i++) {
              const a = pts[i], b = pts[i + 1];
              const isV = Math.abs(a[0] - b[0]) < 1;
              const isH = Math.abs(a[1] - b[1]) < 1;
              if (orient === 'v' ? !isV : !isH) continue;
              const k = orient === 'v' ? 0 : 1; // fixed axis
              const m = 1 - k;                  // running axis
              segs.push({ e, i, pos: a[k], lo: Math.min(a[m], b[m]), hi: Math.max(a[m], b[m]) });
            }
          });
          const parent = segs.map((_, i) => i);
          const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
          for (let a = 0; a < segs.length; a++) {
            for (let b = a + 1; b < segs.length; b++) {
              const A = segs[a], B = segs[b];
              if (A.e.id === B.e.id || A.e.from === B.e.from || A.e.to === B.e.to) continue;
              if (Math.abs(A.pos - B.pos) >= 1) continue;
              if (Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) <= 2) continue;
              parent[find(a)] = find(b);
            }
          }
          const clusters = {};
          segs.forEach((s, idx) => { (clusters[find(idx)] = clusters[find(idx)] || []).push(s); });
          Object.values(clusters).forEach(cl => {
            if (cl.length < 2) return;
            // Order tracks by where each edge heads next so nesting stays planar
            cl.sort((p, q) => (orient === 'v' ? rects[p.e.to].cx - rects[q.e.to].cx : rects[p.e.to].cy - rects[q.e.to].cy));
            cl.forEach((s, idx) => {
              const shift = (idx - (cl.length - 1) / 2) * TRACK_GAP;
              const pts = edgePolylines[s.e.id];
              const k = orient === 'v' ? 0 : 1;
              pts[s.i][k] += shift;
              pts[s.i + 1][k] += shift;
            });
          });
        });

        // 5c. Two-way connections (A->B plus B->A) between vertically stacked nodes: draw them as two
        // straight parallel arrows, side by side, instead of two lines that swap sides and have to hop.
        {
          const PAIR_GAP = 20;
          const done = new Set();
          validEdges.forEach(a => {
            if (done.has(a.id)) return;
            const b = validEdges.find(o => o !== a && o.from === a.to && o.to === a.from && !done.has(o.id));
            if (!b) return;
            const pa = edgePolylines[a.id], pb = edgePolylines[b.id];
            const f = rects[a.from], t = rects[a.to];
            if (!pa || !pb || !f || !t) return;
            const vertEnds = pts => pts.length >= 2 && Math.abs(pts[0][0] - pts[1][0]) < 1 &&
              Math.abs(pts[pts.length - 1][0] - pts[pts.length - 2][0]) < 1;
            if (!vertEnds(pa) || !vertEnds(pb)) return;
            const lo = Math.max(f.x, t.x) + 14, hi = Math.min(f.x + f.w, t.x + t.w) - 14;
            if (hi - lo < PAIR_GAP) {
              // Nodes offset sideways: two nested S-shapes. The downward arrow takes the inner side at both
              // ends and the lower crossbar; the upward arrow the outer side and the upper crossbar.
              const aDown = f.y < t.y;
              const U = aDown ? f : t, L = aDown ? t : f;
              const y0 = U.y + U.h, y1 = L.y;
              if (y1 - y0 < 48 || Math.abs(L.cx - U.cx) < 30) return;
              const sgn = L.cx > U.cx ? 1 : -1, h = PAIR_GAP / 2;
              const midY = (y0 + y1) / 2;
              // Centre of the pair on one node side: nearest to the node centre where neither line sits
              // within 14px of another arrow's contact point on that side
              const pickCentre = (nodeId, node, edgeY) => {
                const others = [];
                validEdges.forEach(o => {
                  if (o === a || o === b) return;
                  const q = edgePolylines[o.id];
                  if (!q) return;
                  if (o.from === nodeId && Math.abs(q[0][1] - edgeY) < 1) others.push(q[0][0]);
                  if (o.to === nodeId && Math.abs(q[q.length - 1][1] - edgeY) < 1) others.push(q[q.length - 1][0]);
                });
                const lo2 = node.x + 14 + h, hi2 = node.x + node.w - 14 - h;
                for (let d = 0; d <= 60; d += 4) {
                  for (const c of d ? [node.cx - d, node.cx + d] : [node.cx]) {
                    if (c < lo2 || c > hi2) continue;
                    if (others.every(ox => Math.abs(ox - (c - h)) >= 14 && Math.abs(ox - (c + h)) >= 14)) return c;
                  }
                }
                return node.cx;
              };
              const uId = aDown ? a.from : a.to, lId = aDown ? a.to : a.from;
              const cU = pickCentre(uId, U, y0), cL = pickCentre(lId, L, y1);
              const down = [[cU - h * sgn, y0], [cU - h * sgn, midY + 6], [cL - h * sgn, midY + 6], [cL - h * sgn, y1]];
              const up = [[cL + h * sgn, y1], [cL + h * sgn, midY - 6], [cU + h * sgn, midY - 6], [cU + h * sgn, y0]];
              const [sa2, sb2] = aDown ? [down, up] : [up, down];
              if (!polyClear(sa2, [a.from, a.to]) || !polyClear(sb2, [b.from, b.to])) return;
              edgePolylines[a.id] = sa2;
              edgePolylines[b.id] = sb2;
              done.add(a.id); done.add(b.id);
              return;
            }
            const c = Math.max(lo + PAIR_GAP / 2, Math.min(hi - PAIR_GAP / 2, (f.cx + t.cx) / 2));
            const xa = c - PAIR_GAP / 2, xb = c + PAIR_GAP / 2;
            const sa = [[xa, pa[0][1]], [xa, pa[pa.length - 1][1]]];
            const sb = [[xb, pb[0][1]], [xb, pb[pb.length - 1][1]]];
            if (!polyClear(sa, [a.from, a.to]) || !polyClear(sb, [b.from, b.to])) return;
            edgePolylines[a.id] = sa;
            edgePolylines[b.id] = sb;
            done.add(a.id); done.add(b.id);
          });
        }

        // 5c2. Tiny jogs: an end leg offset from the leg before it by less than two corner radii draws a cramped
        // S-bend whose corners cannot take the normal radius (nodes a few px apart, or a contact point spread
        // a few px off centre). Slide the end along its node's flat side to line up with the leg instead, when
        // that spot is on the side, is not a diamond vertex, and keeps CLEAR from other arrows' contact points.
        {
          const JOG = 16, CLEAR_PT = 24;
          const ends = (nid, skipId) => {
            const out = [];
            validEdges.forEach(o => {
              if (o.id === skipId) return;
              const op = edgePolylines[o.id];
              if (!op) return;
              if (o.from === nid) out.push(op[0]);
              if (o.to === nid) out.push(op[op.length - 1]);
            });
            return out;
          };
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts || pts.length < 4) return;
            // [end, leg, jog, rest]: indices for the source end, then for the target end
            [[e.from, 0, 1, 2, 3], [e.to, pts.length - 1, pts.length - 2, pts.length - 3, pts.length - 4]].forEach(([nid, a, b, c, d]) => {
              const node = nodeMap[nid], r = rects[nid];
              if (!node || !r || node.type === 'decision') return;
              const vertLeg = Math.abs(pts[a][0] - pts[b][0]) < 1 && Math.abs(pts[c][0] - pts[d][0]) < 1 && Math.abs(pts[b][1] - pts[c][1]) < 1;
              const horizLeg = Math.abs(pts[a][1] - pts[b][1]) < 1 && Math.abs(pts[c][1] - pts[d][1]) < 1 && Math.abs(pts[b][0] - pts[c][0]) < 1;
              const ax = vertLeg ? 0 : horizLeg ? 1 : -1;      // the coordinate that slides along the node's side
              if (ax < 0) return;
              const target = pts[c][ax];
              const off = Math.abs(target - pts[a][ax]);
              if (off < 0.5 || off >= JOG) return;
              const lo = ax === 0 ? r.x + 14 : r.y + 14, hi = ax === 0 ? r.x + r.w - 14 : r.y + r.h - 14;
              if (target < lo || target > hi) return;
              const side = pts[a][1 - ax];
              const crowded = ends(nid, e.id).some(p => Math.abs(p[1 - ax] - side) < 1 &&
                Math.abs(p[ax] - target) >= 1 && Math.abs(p[ax] - target) < CLEAR_PT);
              if (crowded) return;
              pts[a][ax] = target;
              pts[b][ax] = target;
            });
          });
        }

        // 5e. Top-to-bottom: back to screen coordinates (flow x -> screen y). A port named in flow terms maps to the
        // screen side it faces: along the flow ('right') is down, against it ('left') up, across the lanes sideways.
        if (tb) {
          const SIDE = { right: 'bottom', left: 'top', bottom: 'right', top: 'left' };
          Object.keys(edgePolylines).forEach(id => { edgePolylines[id] = edgePolylines[id].map(([a, b]) => [b, a]); });
          Object.keys(edgePorts).forEach(id => {
            const p = edgePorts[id];
            if (p) edgePorts[id] = { ...p, fromPort: SIDE[p.fromPort] || p.fromPort, toPort: SIDE[p.toPort] || p.toPort };
          });
          Object.values(rects).forEach(r => {
            [r.x, r.y, r.w, r.h, r.cx, r.cy] = [r.y, r.x, r.h, r.w, r.cy, r.cx];
          });
        }

        // 5f. Arrow ends on the outline. The router ends arrows on the node's box; a shaped node's outline runs inside
        // it in places (a diamond's sides away from the vertices, the io's slant, the cylinder's ellipses, the delay's
        // arc, the document's wave), so an end there would stop in mid-air. Slide each such end along its end leg
        // onto the outline (outlineInset). Runs in screen coordinates (after 5e): shapes keep their screen orientation
        // in a top-to-bottom diagram, so the side that matters is the screen side.
        validEdges.forEach(e => {
          const pts = edgePolylines[e.id];
          if (!pts || pts.length < 2) return;
          const snap = (nid, a, b) => {
            const node = nodeMap[nid], r = rects[nid];
            if (!node || !r || !(SHAPE_OUTLINES[node.type] || isConnector(node))) return;
            const vertLeg = Math.abs(pts[a][0] - pts[b][0]) < 1, horizLeg = Math.abs(pts[a][1] - pts[b][1]) < 1;
            let side = null;
            if (vertLeg && Math.abs(pts[a][1] - r.y) < 1) side = 'top';
            else if (vertLeg && Math.abs(pts[a][1] - (r.y + r.h)) < 1) side = 'bottom';
            else if (horizLeg && Math.abs(pts[a][0] - r.x) < 1) side = 'left';
            else if (horizLeg && Math.abs(pts[a][0] - (r.x + r.w)) < 1) side = 'right';
            if (!side) return;
            const ax = (side === 'top' || side === 'bottom') ? 1 : 0;   // the coordinate that moves
            const inset = outlineInset(node.type, r, side, pts[a][1 - ax]);
            if (inset < 0.5) return;
            const nv = (side === 'top' || side === 'left') ? pts[a][ax] + inset : pts[a][ax] - inset;
            // keep the leg pointing the same way and at least 4px long
            if (Math.abs(pts[b][ax] - nv) >= 4 && Math.sign(pts[b][ax] - nv) === Math.sign(pts[b][ax] - pts[a][ax])) pts[a][ax] = nv;
          };
          snap(e.from, 0, 1);
          snap(e.to, pts.length - 1, pts.length - 2);
        });

        // 6. Collect vertical segments from edges for planar bridge/hop overpasses
        const verticalSegments = [];
        validEdges.forEach(other => {
          const pts = edgePolylines[other.id];
          if (!pts) return;
          for (let i = 0; i < pts.length - 1; i++) {
            if (Math.abs(pts[i][0] - pts[i + 1][0]) < 1) {
              const vx = pts[i][0];
              const yMin = Math.min(pts[i][1], pts[i + 1][1]);
              const yMax = Math.max(pts[i][1], pts[i + 1][1]);
              verticalSegments.push({ edgeId: other.id, x: vx, yMin, yMax });
            }
          }
        });

        // 7. Second pass: choose collision-free label coordinates and generate curved/hop path
        const placedLabels = [];
        const allNodeBoxes = Object.values(rects);
        const routes = {};

        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const points = edgePolylines[e.id];

          const otherObstacles = verticalSegments.filter(obs => {
            if (obs.edgeId === e.id) return false;
            const otherE = chartData.edges.find(ed => ed.id === obs.edgeId);
            // Forks (same source) and true merges (same target, same entry side) meet on purpose. Two arrows
            // into one node through different sides are separate lines, so where they cross, one hops.
            // Only exempt them when they really share the contact point: arrows entering one side at
            // different x positions are separate lines, so a crossing between them must still hop.
            const oPts = edgePolylines[obs.edgeId];
            if (otherE && otherE.from === e.from && oPts && Math.abs(oPts[0][0] - points[0][0]) < 2 && Math.abs(oPts[0][1] - points[0][1]) < 2) return false;
            if (otherE && otherE.to === e.to && edgePorts[otherE.id] && edgePorts[otherE.id].toPort === p.toPort &&
                oPts && Math.abs(oPts[oPts.length - 1][0] - points[points.length - 1][0]) < 2 && Math.abs(oPts[oPts.length - 1][1] - points[points.length - 1][1]) < 2) return false;
            return true;
          });

          const d = buildCurvedPathWithHops(points, otherObstacles, 8);

          const otherPolylines = [];
          validEdges.forEach(other => {
            if (other.id !== e.id && edgePolylines[other.id]) {
              otherPolylines.push(edgePolylines[other.id]);
            }
          });

          const labelPos = pickClearLabelPosition(points, p.fromPort, e.label, allNodeBoxes, placedLabels, otherPolylines);
          if (e.label && e.label.trim()) {
            // Reserve the box the label is drawn in: one line is estimated generously; a wrapped label is as wide
            // as its wrap width and as tall as its lines (a 28px box let the next label sit on its second line)
            const lw = labelPos.wrapped ? labelPos.w : Math.max(48, e.label.length * 7 + 20);
            const lh = Math.max(28, labelPos.h);
            placedLabels.push({ x: labelPos.x - lw / 2, y: labelPos.y - lh / 2, w: lw, h: lh });
          }

          routes[e.id] = {
            path: d,
            points,   // final polyline (container coords): used to find the arrow under a dragged node
            midX: labelPos.x,
            midY: labelPos.y,
            fromRect: rects[e.from],
            toRect: rects[e.to],
          };
        });

        return routes;
      }

      function buildCurvedPathWithHops(points, verticalObstacles, r = 8) {
        if (!points || points.length === 0) return '';
        if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;

        // Drop repeated and collinear points: a zero-length segment or a straight "corner" would otherwise
        // leave the real bend next to it unrounded
        points = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5);
        points = points.filter((p, i) => {
          if (i === 0 || i === points.length - 1) return true;
          const a = points[i - 1], b = points[i + 1];
          return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.5;
        });

        // Insert bridge hop markers along horizontal segments that cross other vertical edges
        const expanded = [points[0]];
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const isHorizontal = Math.abs(p1[1] - p2[1]) < 1;

          if (isHorizontal && verticalObstacles && verticalObstacles.length > 0) {
            const y = p1[1];
            const minX = Math.min(p1[0], p2[0]);
            const maxX = Math.max(p1[0], p2[0]);
            const goingRight = p2[0] > p1[0];
            // Room a hop needs from each end of the segment: past a bend, the corner's radius plus the hop's
            // (8 + 6); at the arrow's source, just the hop plus a little; at its target, room for the arrowhead.
            // (A flat 18px dropped crossings next to a source, e.g. an arrow rising just right of a decision vertex.)
            const endRoom = (k) => (k === 0 ? 8 : k === points.length - 1 ? 18 : 14);
            const lo1 = endRoom(i), lo2 = endRoom(i + 1);
            const minRoom = goingRight ? lo1 : lo2, maxRoom = goingRight ? lo2 : lo1;

            const hops = [];
            verticalObstacles.forEach(obs => {
              const vx = obs.x;
              if (vx > minX + minRoom && vx < maxX - maxRoom && y > obs.yMin + 8 && y < obs.yMax - 8) {
                hops.push(vx);
              }
            });

            hops.sort((a, b) => goingRight ? a - b : b - a);
            hops.forEach(vx => {
              expanded.push({ isHop: true, x: vx, y: y, dir: goingRight ? 1 : -1 });
            });
          }
          expanded.push(p2);
        }

        // Render rounded quarter-arc corners (r=8) and semicircular hops (r=6). Every bend gets the same radius r;
        // it shrinks only when a segment is too short to hold it (a segment shared by two bends gives each half).
        const hopR = 6;
        const hopEdge = (h, side) => [h.x + side * hopR * h.dir, h.y];   // side -1: where the hop starts, +1: ends
        let d = `M ${expanded[0][0]} ${expanded[0][1]}`;
        for (let i = 1; i < expanded.length; i++) {
          const item = expanded[i];
          if (item.isHop) {
            const hx = item.x;
            const hy = item.y;
            const dir = item.dir;
            d += ` L ${(hx - hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            d += ` A ${hopR} ${hopR} 0 0 1 ${(hx + hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            continue;
          }

          const prev = expanded[i - 1];
          const next = i < expanded.length - 1 ? expanded[i + 1] : null;

          if (next) {
            // A hop next to the bend bounds that segment like an end point does (its arc needs the rest)
            const pPrev = prev.isHop ? hopEdge(prev, 1) : prev;
            const pCurr = item;
            const pNext = next.isHop ? hopEdge(next, -1) : next;

            const vIn = [pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]];
            const vOut = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];
            const lenIn = Math.hypot(vIn[0], vIn[1]);
            const lenOut = Math.hypot(vOut[0], vOut[1]);

            if (lenIn > 0.5 && lenOut > 0.5) {
              // The first segment and hop-bounded segments belong to this bend alone; others are shared
              const roomIn = (i - 1 === 0 || prev.isHop) ? lenIn : lenIn / 2;
              const roomOut = next.isHop ? lenOut : lenOut / 2;
              const curR = Math.min(r, roomIn, roomOut);
              const startX = pCurr[0] - (vIn[0] / lenIn) * curR;
              const startY = pCurr[1] - (vIn[1] / lenIn) * curR;
              const endX = pCurr[0] + (vOut[0] / lenOut) * curR;
              const endY = pCurr[1] + (vOut[1] / lenOut) * curR;

              d += ` L ${startX.toFixed(1)} ${startY.toFixed(1)}`;
              d += ` Q ${pCurr[0].toFixed(1)} ${pCurr[1].toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
              continue;
            }
          }
          d += ` L ${item[0]} ${item[1]}`;
        }
        return d;
      }

      let measureLabelCtx = null;

      function pickClearLabelPosition(points, fromPort, labelText, nodeBoxes, placedLabels, otherPolylines) {
        const candidates = [];

        if (points.length === 2) {
          candidates.push({
            x: (points[0][0] + points[1][0]) / 2,
            y: (points[0][1] + points[1][1]) / 2
          });
        } else if (points.length === 3) {
          if (fromPort === 'top' || fromPort === 'bottom') {
            const p0 = points[0];
            const p1 = points[1];
            const p2 = points[2];
            const sign = p1[1] > p0[1] ? 1 : -1;
            const distY = Math.abs(p1[1] - p0[1]);
            candidates.push({
              x: p0[0],
              y: p0[1] + sign * Math.min(34, distY * 0.45)
            });
            candidates.push({
              x: (p1[0] + p2[0]) / 2,
              y: p1[1]
            });
          } else {
            candidates.push({
              x: (points[0][0] + points[1][0]) / 2,
              y: points[0][1]
            });
            // The second leg too: a short first leg (an arrow into a connector beside its step) has no room
            candidates.push({ x: (points[1][0] + points[2][0]) / 2, y: (points[1][1] + points[2][1]) / 2 });
          }
        } else if (points.length >= 4) {
          const p0 = points[0];
          const p1 = points[1];
          const p2 = points[2];
          const p3 = points[3];

          if (Math.abs(p1[0] - p2[0]) < 2) {
            for (const t of [0.5, 0.22, 0.78, 0.35, 0.65]) {
              candidates.push({
                x: p1[0],
                y: p1[1] + (p2[1] - p1[1]) * t
              });
            }
          } else {
            candidates.push({
              x: (p1[0] + p2[0]) / 2,
              y: (p1[1] + p2[1]) / 2
            });
          }
          candidates.push({ x: (p0[0] + p1[0]) / 2, y: (p0[1] + p1[1]) / 2 });
          candidates.push({ x: (p2[0] + p3[0]) / 2, y: (p2[1] + p3[1]) / 2 });
          if (points.length >= 5) {
            const p4 = points[4];
            candidates.push({ x: (p3[0] + p4[0]) / 2, y: (p3[1] + p4[1]) / 2 });
          }
        }

        // Fallback spots along every long segment, tried after the preferred ones above (middle outwards,
        // 22px clear of corners). Without them a label whose one preferred spot sits on a crossing or
        // junction had nowhere else to go and stayed on it.
        for (let i = 0; i < points.length - 1; i++) {
          const p = points[i], q = points[i + 1];
          const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
          if (len < 56) continue;
          for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
            if (len * t < 22 || len * (1 - t) < 22) continue;
            candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
          }
        }

        // Stretches of this arrow that another arrow runs along (collinear overlap): a label there could
        // belong to either arrow, so it must sit on a part of its own line that only it occupies.
        const sharedStretches = [];
        if (otherPolylines) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const isV = Math.abs(p[0] - q[0]) < 1, isH = Math.abs(p[1] - q[1]) < 1;
            if (!isV && !isH) continue;
            const k = isV ? 0 : 1, m = 1 - k;                       // k: fixed axis, m: running axis
            const lo = Math.min(p[m], q[m]), hi = Math.max(p[m], q[m]);
            for (const poly of otherPolylines) {
              for (let j = 0; j < poly.length - 1; j++) {
                const c = poly[j], d = poly[j + 1];
                if (Math.abs(c[k] - d[k]) >= 1 || Math.abs(c[k] - p[k]) >= 2) continue;
                const a0 = Math.max(lo, Math.min(c[m], d[m])), a1 = Math.min(hi, Math.max(c[m], d[m]));
                if (a1 - a0 > 2) sharedStretches.push(isV ? { x: p[0], y: a0, w: 0, h: a1 - a0 } : { x: a0, y: p[1], w: a1 - a0, h: 0 });
              }
            }
          }
        }
        // Dense spots along every long segment, so a short clear stretch (e.g. next to the source) is found
        if (sharedStretches.length) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
            if (len < 56) continue;
            for (let d = 22; d <= len - 22; d += 14) {
              const t = d / len;
              candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
            }
          }
        }

        const textLen = labelText ? labelText.trim().length : 0;
        const singleLineWidth = Math.max(40, textLen * 6.6 + 18);
        let lw = singleLineWidth;
        let lh = 24;

        // Check horizontal span of edge points to determine available gap
        let horizClearance = null;
        if (points.length >= 2) {
          const minX = Math.min(...points.map(p => p[0]));
          const maxX = Math.max(...points.map(p => p[0]));
          if (maxX - minX > 50) {
            horizClearance = maxX - minX - 16;
          }
        }

        // Allow arrow labels to drop into multiple lines if 1 line exceeds the horizontal gap
        // Labels also never grow past LABEL_MAX_W (matches the CSS max-width); longer text wraps
        const wrapAt = Math.min(horizClearance || Infinity, LE.LABEL_MAX_W);
        if (singleLineWidth > wrapAt) {
          // Never narrower than the longest word, so words are not split mid-word
          const longestWord = Math.max(0, ...String(labelText || '').trim().split(/\s+/).map(w => w.length));
          const minWordW = Math.max(40, longestWord * 7.4 + 20);
          lw = Math.max(minWordW, Math.min(singleLineWidth, wrapAt));
          const lines = Math.ceil(singleLineWidth / lw);
          lh = Math.max(24, lines * 15 + 8);
        }

        function BoxOverlap(bx, by, bw, bh, ox, oy, ow, oh, pad) {
          return (
            bx < ox + ow + pad &&
            bx + bw > ox - pad &&
            by < oy + oh + pad &&
            by + bh > oy - pad
          );
        }

        // The first spot that touches nothing wins. When every spot touches something, take the least bad one
        // (a node or another label is far worse than sitting on another arrow) instead of the first.
        let fallback = null;
        for (const cand of candidates) {
          const bx = cand.x - lw / 2;
          const by = cand.y - lh / 2;
          let penalty = 0;

          for (const nb of nodeBoxes) {
            if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, 8)) penalty += 1000;
          }
          for (const pl of placedLabels) {
            if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 6)) penalty += 1000;
          }
          if (otherPolylines) {
            for (const poly of otherPolylines) {
              for (let i = 0; i < poly.length - 1; i++) {
                const sx = Math.min(poly[i][0], poly[i + 1][0]);
                const sy = Math.min(poly[i][1], poly[i + 1][1]);
                const sw = Math.abs(poly[i + 1][0] - poly[i][0]);
                const sh = Math.abs(poly[i + 1][1] - poly[i][1]);
                if (BoxOverlap(bx, by, lw, lh, sx, sy, sw, sh, 6)) penalty += 10;
              }
            }
          }
          for (const st of sharedStretches) {
            if (BoxOverlap(bx, by, lw, lh, st.x, st.y, st.w, st.h, 2)) { penalty += 300; break; }
          }
          if (penalty === 0) return { x: cand.x, y: cand.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
          if (!fallback || penalty < fallback.penalty) fallback = { cand, penalty };
        }

        // The size checked here comes back with the spot, so the caller reserves the box the label really takes
        // (a wrapped label is narrower but taller than one line)
        const spot = fallback ? fallback.cand : (candidates[0] || { x: points[0][0], y: points[0][1] });
        return { x: spot.x, y: spot.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
      }

      function renderEdges() {
        edgeGroup.innerHTML = '';
        edgeLabelsGroup.innerHTML = '';

        const routes = computeAllEdgeRoutes();
        lastRoutes = routes;

        chartData.edges.forEach(edge => {
          const pathD = routes[edge.id];
          if (!pathD || !pathD.path) return;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD.path);
          path.setAttribute('class', edge.id === selectedEdgeId ? 'connector-path selected' : 'connector-path');
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
            const labelBox = document.querySelector(`.edge-label-container[data-edge-id="${edge.id}"]`);
            if (labelBox) labelBox.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
          });

          // Wide invisible hit area so thin arrows are easy to click and select
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          hit.setAttribute('d', pathD.path);
          hit.setAttribute('class', 'connector-hit');
          hit.addEventListener('click', (e) => { e.stopPropagation(); selectEdge(edge.id); });
          hit.addEventListener('dblclick', (e) => path.dispatchEvent(new MouseEvent('dblclick', { bubbles: false })));
          edgeGroup.appendChild(hit);
          edgeGroup.appendChild(path);

          // Edge Label Pill
          if (pathD.midX !== undefined && pathD.midY !== undefined) {
            const labelContainer = document.createElement('div');
            labelContainer.className = 'edge-label-container';
            labelContainer.dataset.edgeId = edge.id;
            labelContainer.style.pointerEvents = 'auto';
            labelContainer.style.left = `${pathD.midX}px`;
            labelContainer.style.top = `${pathD.midY}px`;

            // Allow arrow labels to drop into multiple lines if 1 line exceeds the horizontal gap
            const fRect = pathD.fromRect;
            const tRect = pathD.toRect;
            if (fRect && tRect && tRect.x > (fRect.x + fRect.w)) {
              const horizGap = tRect.x - (fRect.x + fRect.w);
              const longestWordW = Math.max(0, ...String(edge.label || '').trim().split(/\s+/).map(w => w.length)) * 7.4 + 20;
              // Fit the gap with the arrow stubs kept clear, never past LABEL_MAX_W, never narrower than the longest word
              const maxLabelW = Math.max(40, longestWordW, Math.min(LE.LABEL_MAX_W, horizGap - 2 * LE.LABEL_STUB));
              labelContainer.style.maxWidth = `${maxLabelW}px`;
            } else {
              labelContainer.style.maxWidth = `${LE.LABEL_MAX_W}px`;
            }

            const isSelected = (edge.id === selectedEdgeId);
            const hasLabel = Boolean(edge.label && edge.label.trim());

            if (isSelected) labelContainer.classList.add('selected');
            if (hasLabel) {
              labelContainer.classList.add('has-label');
            } else {
              labelContainer.classList.add('empty-placeholder');
            }

            const labelText = document.createElement('span');
            labelText.className = 'edge-label-text';
            labelText.contentEditable = 'false';
            labelText.spellcheck = false;
            labelText.dataset.tip = 'Double-click to edit condition';
            labelText.textContent = hasLabel ? edge.label : '+';

            labelText.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
            });

            labelText.addEventListener('blur', () => {
              labelText.contentEditable = 'false';
              const text = labelText.textContent.trim();
              if (text === '' || text === '+') {
                edge.label = '';
              } else {
                edge.label = text;
              }
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
              labelText.contentEditable = 'true';
              labelText.focus();
              if (labelText.textContent.trim() === '+') {
                labelText.textContent = '';
                labelContainer.classList.remove('empty-placeholder');
              } else {
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
              if (need > parseFloat(labelContainer.style.maxWidth)) labelContainer.style.maxWidth = `${need}px`;
            }

            if (isSelected) {
              const total = path.getTotalLength();

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
              });

              // Split chip beside the label: replace this arrow with a connector pair
              if (!isConnector(nodeById(edge.from)) && !isConnector(nodeById(edge.to)) && edge.from !== edge.to) {
                labelContainer.after(buildSplitChip(edge, labelContainer, pathD));
              }
            }

            labelContainer.addEventListener('click', (e) => {
              e.stopPropagation();
              selectEdge(edge.id, false);
              // The "+" placeholder starts typing on a single click
              if (labelContainer.classList.contains('empty-placeholder') && labelText.contentEditable !== 'true') {
                labelContainer.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
              }
            });

            // Hovering the arrow or its label lights up both, so it is clear which label belongs to which arrow
            const setLinked = (on) => {
              path.classList.toggle('hover', on);
              labelContainer.classList.toggle('linked', on);
              if (edge.id !== selectedEdgeId) path.setAttribute('marker-end', on ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
            };
            [path, hit].forEach(el => {
              el.addEventListener('mouseenter', () => {
                labelContainer.classList.add('hover-visible');
                setLinked(true);
              });
              el.addEventListener('mouseleave', () => {
                setLinked(false);
                if (edge.id !== selectedEdgeId && !labelText.matches(':focus')) {
                  labelContainer.classList.remove('hover-visible');
                }
              });
            });
            labelContainer.addEventListener('mouseenter', () => setLinked(true));
            labelContainer.addEventListener('mouseleave', () => setLinked(false));
          }
        });
        applyNodeHover(); // keep the hover highlight across a re-render (e.g. while dragging)
        positionNotes();  // notes follow their nodes (a dragged node moves its note with it)
      }

      // Hovering a node highlights every arrow touching it (and its label): amber for those entering the
      // node, green for those leaving it (a self-loop counts as leaving)
      function applyNodeHover() {
        document.querySelectorAll('.connector-path, .edge-label-container').forEach(el => el.classList.remove('hl-in', 'hl-out'));
        document.querySelectorAll('.connector-path').forEach(p => {
          p.setAttribute('marker-end', p.dataset.edgeId === selectedEdgeId ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
        });
        if (!hoveredNodeId) return;
        chartData.edges.forEach(edge => {
          const kind = edge.from === hoveredNodeId ? 'out' : edge.to === hoveredNodeId ? 'in' : null;
          if (!kind) return;
          const path = document.querySelector(`.connector-path[data-edge-id="${edge.id}"]`);
          const label = document.querySelector(`.edge-label-container[data-edge-id="${edge.id}"]`);
          if (path) {
            path.classList.add('hl-' + kind);
            path.setAttribute('marker-end', `url(#arrowhead-${kind})`);
          }
          if (label) label.classList.add('hl-' + kind);
        });
      }

      // --- NODE DRAG INTERACTION ---
      function handleNodePointerDown(e, node) {
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
        const startOf = (n) => ({ node: n, x: n.x || 0, gy: laneTopOf(n.laneId) + (n.y || 0), lane: laneIndexOf(n) });
        dragGroup = group ? [...selectedNodeIds].map(nodeById).filter(n => n && n !== node && !isConnector(n)).map(startOf) : null;
        dragOrigin = startOf(node);
        dragOrigin.saved = [node, ...(dragGroup || []).map(g => g.node)].map(n => ({ node: n, x: n.x, y: n.y, laneId: n.laneId }));
        dragStartX = e.clientX;
        dragStartY = e.clientY;

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

        // If the node crossed swimlanes, reparent into the target lane track
        if (draggingNode.laneId !== targetLane.id) {
          draggingNode.laneId = targetLane.id;
          const targetTrack = document.querySelector(`.lane-track[data-lane-id="${targetLane.id}"]`);
          if (targetTrack && nodeEl.parentElement !== targetTrack) {
            targetTrack.appendChild(nodeEl);
          }
        }

        placeNodeEl(nodeEl, draggingNode);
        // The other selected steps move by the same distance and the same number of lanes (held within the first
        // and last lane), so a selection that spans lanes keeps its shape
        if (dragGroup) {
          const ddx = localX - dragOrigin.x, ddy = targetLaneTop + localY - dragOrigin.gy;
          const dLane = chartData.lanes.indexOf(targetLane) - dragOrigin.lane, last = chartData.lanes.length - 1;
          dragGroup.forEach(g => {
            const lane = chartData.lanes[Math.max(0, Math.min(last, g.lane + dLane))];
            const el = nodeElOf(g.node.id);
            g.node.x = Math.max(16, g.x + ddx);
            g.node.y = g.gy + ddy - laneTopOf(lane.id);
            if (g.node.laneId !== lane.id) {
              g.node.laneId = lane.id;
              const track = document.querySelector(`.lane-track[data-lane-id="${lane.id}"]`);
              if (track && el && el.parentElement !== track) track.appendChild(el);
            }
            if (el) placeNodeEl(el, g.node);
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
        if (snap.guideX !== null) {
          flowGuide.style[flowProp] = `${trackOffset() + snap.guideX}px`;
          flowGuide.style.display = 'block';
        } else flowGuide.style.display = 'none';
        if (snap.guideY !== null) {
          crossGuide.style[crossProp] = `${snap.guideY}px`;
          crossGuide.style.display = 'block';
        } else crossGuide.style.display = 'none';
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
          if (dragMoved && isConnector(node)) {
            // A circle dropped on a step moves that end of the pair there; dropped anywhere else it goes back
            const stepId = stepUnder(e.clientX, e.clientY, node.id);
            markConnectorTarget(null);
            if (!stepId || !moveConnectorTo(node, stepId)) placeCirclesOnly();
          } else if (dragMoved && target) {
            moveRunIntoEdge(ids, target.edgeId, e.clientX, e.clientY, node.id);
          } else if (dragMoved && e.altKey && !dragCanInsert && !runOf(ids)) {
            // Alt asked for a move into an arrow, but this is not a run: everything goes back where it was
            origin.saved.forEach(o => { o.node.x = o.x; o.node.y = o.y; o.node.laneId = o.laneId; });
            render();
            flashHint(RUN_HINT);
          } else if (dragMoved && group) {
            finishStepMove([node, ...group.map(g => g.node)]);
          } else if (dragMoved) {
            relayout();   // the lane it was dropped in is kept; its place in the lane comes from the flow
          } else if (isConnector(node)) {
            jumpToPartner(node);   // a click (no drag) on a connector takes the reader to the other end
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

        setTimeout(() => {
          const labelTextEl = document.querySelector(`.edge-label-container[data-edge-id="${newEdge.id}"] .edge-label-text`);
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
        selectedLaneId = laneId;
        clearNodeSelection();
        selectedEdgeId = null;
        if (hadEdge) renderEdges();
        markSelectedLane();
      }

      // Removes a lane together with its steps and every arrow attached to them (one undo step).
      // The last remaining lane cannot be deleted: every step needs a lane.
      function deleteLane(laneId) {
        if (chartData.lanes.length <= 1 || !chartData.lanes.some(l => l.id === laneId)) return;
        const gone = new Set(chartData.nodes.filter(n => n.laneId === laneId).map(n => n.id));
        chartData.lanes = chartData.lanes.filter(l => l.id !== laneId);
        chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
        chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
        pruneConnectors();   // a pair with one end in the lane goes with it
        pruneNotes();
        selectedLaneId = null;
        relayout();
      }

      // Deleting a lane also deletes its steps, so it is confirmed first: a small popover under the delete button
      // (or under the lane's pill for the Delete key). Escape, Cancel, a click elsewhere or a pan/zoom dismisses it.
      let laneConfirmEl = null;
      function closeLaneConfirm() {
        if (!laneConfirmEl) return false;
        laneConfirmEl.remove();
        laneConfirmEl = null;
        document.removeEventListener('pointerdown', onLaneConfirmOutside, true);
        return true;
      }
      function onLaneConfirmOutside(e) {
        if (laneConfirmEl && !laneConfirmEl.contains(e.target)) closeLaneConfirm();
      }
      function confirmDeleteLane(laneId, anchorEl) {
        closeLaneConfirm();
        const lane = chartData.lanes.find(l => l.id === laneId);
        if (!lane || chartData.lanes.length <= 1) return;
        const steps = chartData.nodes.filter(n => n.laneId === laneId).length;
        const box = document.createElement('div');
        box.className = 'lane-confirm';
        box.dataset.exportSkip = '';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-label', 'Delete swimlane');
        const title = document.createElement('div');
        title.className = 'lane-confirm-title';
        title.textContent = `Delete \u201c${lane.name}\u201d?`;
        const msg = document.createElement('div');
        msg.className = 'lane-confirm-msg';
        msg.textContent = steps ? `Its ${steps} step${steps === 1 ? '' : 's'} and their arrows will be deleted too.` : 'This lane is empty.';
        const row = document.createElement('div');
        row.className = 'lane-confirm-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn lane-confirm-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => closeLaneConfirm());
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn lane-confirm-delete';
        ok.textContent = 'Delete lane';
        ok.addEventListener('click', () => { closeLaneConfirm(); deleteLane(laneId); });
        row.append(cancel, ok);
        box.append(title, msg, row);
        box.addEventListener('keydown', (e) => {
          // Keep keys inside the popover from reaching the shell (Delete/Backspace would re-open it)
          if (e.key === 'Escape') { e.preventDefault(); closeLaneConfirm(); }
          if (e.key !== 'Tab') e.stopPropagation();
        });
        document.body.appendChild(box);
        laneConfirmEl = box;
        // Under the anchor (a delete button, else the lane's pill), or above it when there is no room below
        // (the dock's Delete sits at the bottom of the window); kept on screen
        const anchor = anchorEl || lanesRoot.querySelector(`.swimlane[data-lane-id="${laneId}"] .lane-pill`);
        const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
        const bw = box.offsetWidth, bh = box.offsetHeight;
        const top = r.bottom + 8 + bh > innerHeight - 8 ? r.top - 8 - bh : r.bottom + 8;
        box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bw - 8))}px`;
        box.style.top = `${Math.max(8, Math.min(top, innerHeight - bh - 8))}px`;
        cancel.focus();
        document.addEventListener('pointerdown', onLaneConfirmOutside, true);
      }

      function selectNode(nodeId) {
        selectedNodeId = nodeId;
        selectedNodeIds = new Set(nodeId ? [nodeId] : []);
        selectedEdgeId = null;
        selectedNoteId = null;
        if (selectedLaneId) { selectedLaneId = null; markSelectedLane(); }
        markSelectedNodes();
        document.querySelectorAll('.connector-path').forEach(p => p.classList.remove('selected'));
        document.querySelectorAll('.edge-label-container').forEach(c => c.classList.remove('selected'));
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
      const deleteLabelEl = document.querySelector('#btn-delete-selection .btn-label');
      let boxBase = [];   // the selection a toggle box started from (selectInRect)

      // Show the selection: the outline on each selected step, and the count on the dock's Delete ("Delete 3").
      // With several selected, .multi-select hides the connect ports so a drag always moves the selection.
      function markSelectedNodes() {
        const many = selectedNodeIds.size > 1;
        document.querySelectorAll('.flow-node[data-node-id]').forEach(el => el.classList.toggle('selected', isNodeSelected(el.dataset.nodeId)));
        swimlanesContainer.classList.toggle('multi-select', many);
        if (deleteLabelEl) deleteLabelEl.textContent = many ? `Delete ${selectedNodeIds.size}` : 'Delete';
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
          document.querySelectorAll('.connector-path').forEach(p => {
            const isMatch = (p.dataset.edgeId === edgeId);
            p.classList.toggle('selected', isMatch);
            p.setAttribute('marker-end', isMatch ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
          });
          document.querySelectorAll('.edge-label-container').forEach(c => {
            c.classList.toggle('selected', c.dataset.edgeId === edgeId);
          });
        }
      }

      function deleteNode(nodeId) {
        const node = nodeById(nodeId);
        if (isConnector(node)) { joinConnector(node); return; }   // deleting a connector puts the whole arrow back
        chartData.nodes = chartData.nodes.filter(n => n.id !== nodeId);
        chartData.edges = chartData.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        pruneConnectors();   // a pair attached to this step goes with it
        pruneNotes();   // its notes lose the link (a note explaining only this step goes with it)
        clearNodeSelection();
        relayout();
      }

      // Delete several steps as one edit, so one undo brings them all back. Like a single delete, the arrows around
      // the hole go with it (no bridging).
      function deleteNodes(ids) {
        const gone = new Set(ids.filter(id => nodeById(id) && !isConnector(nodeById(id))));
        chartData.nodes = chartData.nodes.filter(n => !gone.has(n.id));
        chartData.edges = chartData.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
        pruneConnectors();   // a pair attached to a deleted step goes with it
        // A selected circle whose pair is still there: the whole arrow comes back, as when it is deleted alone
        ids.forEach(id => { const n = nodeById(id); if (isConnector(n)) joinConnectorData(n); });
        pruneConnectors();
        pruneNotes();
        clearNodeSelection();
        relayout();
      }

      function deleteEdge(edgeId) {
        const before = chartData.nodes.length;
        chartData.edges = chartData.edges.filter(e => e.id !== edgeId);
        pruneConnectors();   // deleting either stub of a split arrow deletes the whole arrow
        selectedEdgeId = null;
        updateStatus(true);
        if (chartData.nodes.length !== before) render(); else renderEdges();
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
        return node;
      }

      function addNodeAt(type, p) {
        const node = makeNode(type, p);
        render();              // draw it where it was dropped first, so relayout can keep it there on screen
        relayout(node.id);
        selectNode(node.id);
        return node;
      }

      // Click (no drag) on a dock shape: drop it at the centre of the view, as before
      document.querySelectorAll('[data-node-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          if (btn.dataset.dragged) { delete btn.dataset.dragged; e.preventDefault(); return; }
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
        edgeGroup.querySelectorAll('.connector-path.insert-target').forEach(p => p.classList.remove('insert-target'));
        const hint = document.getElementById('insert-hint');
        if (!t) { if (hint) hint.style.display = 'none'; return; }
        const path = [...edgeGroup.querySelectorAll('.connector-path')].find(p => p.dataset.edgeId === t.edgeId);
        if (path) path.classList.add('insert-target');
        if (hint) {
          hint.textContent = text;
          hint.style.left = `${t.x}px`;
          hint.style.top = `${t.y}px`;
          hint.style.display = 'block';
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
      function moveRunIntoEdge(ids, edgeId, clientX, clientY, focusId) {
        const run = runOf(ids);
        const edge = chartData.edges.find(x => x.id === edgeId);
        if (!run || !edge || run.set.has(edge.from) || run.set.has(edge.to)) return false;
        const lifted = run.ins.length > 0 || !!run.out;
        const after = run.out ? run.out.to : null;
        const drop = new Set(run.out ? [run.out] : []);
        run.ins.forEach(p => {
          const dup = chartData.edges.some(x => x !== p && !drop.has(x) && x.from === p.from && x.to === after);
          if (after && p.from !== after && !dup) p.to = after; else drop.add(p);
        });
        chartData.edges = chartData.edges.filter(x => !drop.has(x));
        const target = edge.to;
        edge.to = run.entry;
        const second = { id: uid('e'), from: run.exit, to: target, label: run.out ? (run.out.label || '') : (nodeById(run.exit).type === 'decision' ? 'Yes' : '') };
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
          setTimeout(() => moved.classList.remove('just-inserted'), 900);
        });
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
        if (e.button !== 0 || document.body.classList.contains('presentation')) return;
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
        pd.ghost.style.transform = `scale(${scale})`;
        pd.ghost.style.left = `${gx}px`;
        pd.ghost.style.top = `${gy}px`;
      }

      function onPaletteUp(e) {
        const pd = paletteDrag;
        const target = insertTarget;
        const dragged = !!(pd && pd.ghost);
        if (dragged) pd.btn.dataset.dragged = '1';   // swallow the click that may follow on the button
        cancelPaletteDrag();
        if (!dragged || !pd.onCanvas || !pd.placement) return;
        if (target) {
          const node = makeNode(pd.type, pd.placement);
          moveRunIntoEdge([node.id], target.edgeId, e.clientX, e.clientY);
        } else {
          // A shape dropped onto blank canvas stays where it was dropped, even with Auto-Tidy on: it has no
          // arrows yet, so a re-layout would only throw it to the start of the flow. The next step edit (or
          // Tidy) lays it out once it is connected.
          const node = makeNode(pd.type, pd.placement);
          render();
          updateStatus(true);
          selectNode(node.id);
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
          delete chartData.swimlanes;
          updateStatus(true);
          render();
          return;
        }
        const newLane = {                     // no color: the renderer assigns the palette colour for its position
          id: `lane_${Date.now()}`,
          name: `Actor / Role ${chartData.lanes.length + 1}`,
          icon: 'users',
          height: LE.LANE_MIN
        };
        chartData.lanes.push(newLane);
        relayout();
      });

      // --- DIRECTION TOGGLE ---
      // Switches between left-to-right and top-to-bottom ("direction": "TB" in the data, so it is saved with the
      // file and undoable). Node positions mean different things in each, so the switch always re-runs the layout.
      const DIR_ICONS = {
        LR: '<path d="M3 12h18"/><path d="m16 7 5 5-5 5"/>',
        TB: '<path d="M12 3v18"/><path d="m7 16 5 5 5-5"/>'
      };
      function updateDirectionButton() {
        if (!btnDirection) return;
        const next = isTB() ? 'LR' : 'TB';
        const label = next === 'TB' ? 'Vertical' : 'Horizontal';
        btnDirection.querySelector('.btn-label').textContent = label;
        btnDirection.querySelector('svg').innerHTML = DIR_ICONS[next];
        btnDirection.title = next === 'TB' ? 'Switch to a top-to-bottom layout' : 'Switch to a left-to-right layout';
        btnDirection.setAttribute('aria-label', label);
      }
      if (btnDirection) btnDirection.addEventListener('click', () => {
        if (isTB()) delete chartData.direction;
        else chartData.direction = 'TB';
        selectedEdgeId = null;
        // A moved note's offset is in screen terms, which the switch turns sideways: let every note be re-fitted
        notesList().forEach(n => { delete n.pos; });
        layoutDiagram(chartData);
        render();
        updateStatus(true);
        fitView();
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
        try { localStorage.setItem('flowchart-auto-layout', autoLayout ? 'on' : 'off'); } catch (e) {}
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
      const NOTE_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h9"/></svg>';
      const NOTE_ADD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
      const NOTE_DEL_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      const NOTE_LINK_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
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
        chartData.notes.forEach(note => {
          const kept = (note.nodes || []).filter(id => ids.has(id));
          if (kept[0] !== (note.nodes || [])[0]) delete note.pos;   // the anchor changed: let it be re-fitted
          note.nodes = kept;
        });
        chartData.notes = chartData.notes.filter(n => n.nodes.length && (noteTextOf(n) || n.id === editingNoteId));
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
        const live = notesList().filter(n => isLive(n) && linkedIds(n).length);
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
        const labelBoxes = [...edgeLabelsGroup.querySelectorAll('.edge-label-container.has-label')].map(containerBox);
        const segs = [];
        Object.values(lastRoutes).forEach(r => {
          const p = r && r.points;
          if (p) for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
        });
        const segBox = ([x1, y1, x2, y2]) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
        const boxesOf = {};
        live.forEach(n => { boxesOf[n.id] = linkedIds(n).map(id => containerBox(nodeElOf(id))); });
        const placed = live.filter(n => n.pos || noteOffsets[n.id]).map(n => {
          const o = n.pos || noteOffsets[n.id], a = boxesOf[n.id][0];
          return { x: a.x + o.x, y: a.y + o.y, w: noteSizes[n.id].w, h: noteSizes[n.id].h };
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
          if (!anchor || !o) return;
          const a = containerBox(nodeElOf(anchor)), x = a.x + o.x, y = a.y + o.y;
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
      function applyNoteVisibility() {
        if (!notesLayer) return;
        const all = !!chartData.showNotes;
        swimlanesContainer.classList.toggle('notes-on', all);
        [...notesLayer.children, ...noteLeaderGroup.children].forEach(el => {
          const note = noteById(el.dataset.noteId);
          if (!note) return;
          el.classList.toggle('show', all);
          el.classList.toggle('peek', notePeeked(note));
          if (el.classList.contains('flow-note')) el.classList.toggle('selected', note.id === selectedNoteId);
        });
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
        } else {
          b.className = 'note-add';
          b.title = 'Add a note (N)';
          b.setAttribute('aria-label', 'Add a note');
          b.innerHTML = NOTE_ADD_ICON;
          b.addEventListener('click', (e) => { e.stopPropagation(); addNoteTo(node.id); });
        }
        return b;
      }

      function buildNoteCard(note) {
        const card = document.createElement('div');
        card.className = 'flow-note';
        card.dataset.noteId = note.id;
        card.dataset.nodes = (note.nodes || []).join(' ');
        const text = document.createElement('div');
        text.className = 'note-text';
        text.spellcheck = false;
        text.dataset.placeholder = 'Add a note…';
        text.textContent = note.text || '';
        card.appendChild(text);

        const tool = (cls, title, icon) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = cls;
          b.title = title;
          b.setAttribute('aria-label', title);
          b.setAttribute('data-export-skip', '');
          b.innerHTML = icon;
          card.appendChild(b);
          return b;
        };
        const del = tool('note-del', 'Delete note', NOTE_DEL_ICON);
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => { e.stopPropagation(); removeNote(note.id); });
        const link = tool('note-link', 'Link to another step: drag onto it (onto a linked step to unlink; or Shift+click the step)', NOTE_LINK_ICON);
        link.addEventListener('pointerdown', (e) => startNoteLink(e, note.id, card));
        link.addEventListener('click', (e) => e.stopPropagation());

        card.addEventListener('pointerdown', (e) => onNotePointerDown(e, note.id, card));
        card.addEventListener('dblclick', (e) => { e.stopPropagation(); editNote(note.id); });
        card.addEventListener('click', (e) => e.stopPropagation());
        card.addEventListener('mouseenter', () => { if ((note.nodes || []).includes(peekNodeId)) clearTimeout(peekTimer); });
        card.addEventListener('mouseleave', () => { if (peekNodeId) unpeekSoon(peekNodeId); });

        // Plain text only. Enter starts a new line; Ctrl/Cmd+Enter, Esc or clicking away finishes.
        text.addEventListener('paste', (e) => {
          e.preventDefault();
          document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
        });
        text.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
            e.preventDefault();   // a plain line break, not the <div> the browser would wrap the new line in
            document.execCommand('insertLineBreak');
          } else if (e.key === 'Escape' || e.key === 'Enter') {
            // Commit directly too: blur() fires no blur event while the window itself is not focused
            e.preventDefault(); e.stopPropagation(); text.blur(); commitNote(note, text);
          }
        });
        text.addEventListener('input', () => {   // the card grows as it is typed into: keep its leaders attached
          noteSizes[note.id] = { w: card.offsetWidth, h: card.offsetHeight };
          positionNotes();
        });
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
        const value = text.innerText.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (value) note.text = value;
        else {
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
        if (!noteById(id)) return;
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
        const ids = note.nodes || [];
        if (!ids.includes(nodeId)) note.nodes = ids.concat(nodeId);
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
        render();
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
        d.card.style.left = `${d.nx}px`;
        d.card.style.top = `${d.ny}px`;
        drawLeaders(d.id, { x: d.nx, y: d.ny, ...(noteSizes[d.id] || { w: 0, h: 0 }) });
      }
      function endNoteDrag() {
        window.removeEventListener('pointermove', onNoteMove);
        window.removeEventListener('pointerup', onNoteUp);
        window.removeEventListener('pointercancel', cancelNoteDrag);
        const d = noteDrag;
        noteDrag = null;
        if (d) d.card.classList.remove('dragging');
        return d;
      }
      function onNoteUp() {
        const d = endNoteDrag();
        if (!d || !d.moved) return;
        const note = noteById(d.id), anchor = note && linkedIds(note)[0];
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

      // N adds a note to the selected step (or opens the one it has), or opens the selected note
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'n' && e.key !== 'N') return;
        if (e.ctrlKey || e.metaKey || e.altKey || isPresenting()) return;
        const a = document.activeElement;
        if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        if (!selectedNodeId && !selectedNoteId) return;
        e.preventDefault();
        if (selectedNodeId) addNoteTo(selectedNodeId); else editNote(selectedNoteId);
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
          hint.className = 'note-pick-hint';
          hint.setAttribute('role', 'status');
          hint.innerHTML = 'Click a step to add a note · <kbd>Esc</kbd> to cancel';
          document.body.appendChild(hint);
        } else if (!on && hint) hint.remove();
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
          else setNotePicking(!notePicking);
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
          d.ghost.className = 'flow-note note-ghost';
          d.ghost.innerHTML = '<div class="note-text">Note</div>';
          document.body.appendChild(d.ghost);
          document.body.classList.add('palette-dragging');
        }
        // Trails below-right of the cursor, so the step being pointed at stays in view
        d.ghost.style.transform = `scale(${scale})`;
        d.ghost.style.left = `${e.clientX + 12}px`;
        d.ghost.style.top = `${e.clientY + 12}px`;
        d.target = nodeIdAt(e.clientX, e.clientY);
        d.ghost.classList.toggle('off-target', !d.target);
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
        const d = endNoteToolDrag();
        if (!d || !d.ghost) return;
        btnAddNote.dataset.dragged = '1';   // swallow the click that may follow on the tile
        if (d.target) giveNoteTo(d.target);
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
          hint.className = 'note-pick-hint connector-pick-hint';
          hint.setAttribute('role', 'status');
          hint.dataset.exportSkip = '';
          hint.innerHTML = 'Click an arrow to break it into a connector pair · <kbd>Esc</kbd> to cancel';
          document.body.appendChild(hint);
        } else if (!on && hint) hint.remove();
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
        'lanes', 'nodes', 'edges', 'notes', 'layout'];
      const NODE_LAYOUT = ['x', 'y'], LANE_LAYOUT = ['height', 'color'];
      const GENERATED_ID = /^(n|c|e|lane)_\d{12,}(_\d+)?$/;   // uid(): <prefix>_<Date.now()>[_k]
      const SLUG_MAX = 30;

      function slug(text, sep = '_') {
        let s = String(text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
        if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(new RegExp(`${sep}+$`), '');
        return s;
      }

      function renameGeneratedIds(d) {
        const lanes = d.lanes || [], nodes = d.nodes || [], edges = d.edges || [];
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
        (d.notes || []).forEach(note => { if (Array.isArray(note.nodes)) note.nodes = note.nodes.map(r); });
      }

      function orderedKeys(d, keys) {
        const out = {};
        keys.forEach(k => { if (k in d) out[k] = d[k]; });
        Object.keys(d).forEach(k => { if (!(k in out)) out[k] = d[k]; });
        return out;
      }

      function toDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        delete d.layout;
        const lanes = d.lanes || [], nodes = d.nodes || [];
        const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
        // Flow order: x runs along the flow in both directions (the engine has ranked the steps already)
        nodes.sort((a, b) => ((a.x || 0) - (b.x || 0)) || ((laneIndex.get(a.laneId) || 0) - (laneIndex.get(b.laneId) || 0))
          || ((a.y || 0) - (b.y || 0)));
        renameGeneratedIds(d);
        const layout = {};
        [[lanes, LANE_LAYOUT], [nodes, NODE_LAYOUT]].forEach(([items, keys]) => items.forEach(o => {
          const pos = {};
          keys.forEach(k => { if (k in o) { pos[k] = o[k]; delete o[k]; } });
          if (Object.keys(pos).length) layout[o.id] = pos;
        }));
        if (Object.keys(layout).length) d.layout = layout;
        return orderedKeys(d, DISK_KEYS);
      }

      function fromDisk(data) {
        const d = JSON.parse(JSON.stringify(data));
        const layout = d.layout || {};
        delete d.layout;
        [...(d.lanes || []), ...(d.nodes || [])].forEach(o => Object.assign(o, layout[o.id] || {}));
        return d;
      }

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'flowchart',
        defaultTitle: 'Interactive Swimlane Flowchart',
        toDisk,
        fromDisk,
        contentEl: swimlanesContainer,
        report: { node: '.flow-node', label: '.edge-label-container', labelText: '.edge-label-text', nodeText: '.node-label' },
        render,
        isBackground: (el) => el.id === 'swimlanes-container' || el.classList.contains('lane-track') || el.classList.contains('lane-gutter'),
        clearSelection() {
          clearNodeSelection();
          selectedEdgeId = null;
          selectedLaneId = null;
          selectedNoteId = null;
          peekNodeId = null;
          setConnectorPicking(false);   // a click on the canvas cancels waiting for an arrow
          markSelectedLane();
          renderEdges();
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
          if (closeLaneConfirm()) return true;
          const wasConnecting = !!connectingFromNodeId;
          cancelConnecting();
          const wasPicking = notePicking || connectorPicking;
          setNotePicking(false);
          setConnectorPicking(false);
          return cancelNoteLink() || cancelNoteToolDrag() || cancelConnectorToolDrag() || cancelNoteDrag() || cancelPaletteDrag() || wasConnecting || wasPicking;
        },
        onViewChange() { closeLaneConfirm(); pinLaneHeaders(); },
        // Notes on show may sit in the margin outside the lanes: Fit and screenshots take them in (peeked ones
        // are transient and do not count)
        contentOverflow() {
          if (!notesLayer || !chartData.showNotes) return null;
          const W = swimlanesContainer.offsetWidth, H = swimlanesContainer.offsetHeight, PAD = 12;
          const o = { left: 0, top: 0, right: 0, bottom: 0 };
          [...notesLayer.children].forEach(card => {
            const b = containerBox(card);
            if (!b.w) return;
            o.left = Math.max(o.left, PAD - b.x);
            o.top = Math.max(o.top, PAD - b.y);
            o.right = Math.max(o.right, b.x + b.w + PAD - W);
            o.bottom = Math.max(o.bottom, b.y + b.h + PAD - H);
          });
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
