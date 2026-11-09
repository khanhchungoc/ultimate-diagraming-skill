      const NODE_WIDTH = 168;
      const NODE_HEIGHT = 56;
      const DECISION_WIDTH = 168;
      const DECISION_HEIGHT = 64;
      const LANE_MIN_HEIGHT = 160;
      const LANE_BOTTOM_PAD = 48;

      // --- STATE & INITIALIZATION ---

      let selectedNodeId = null;
      let selectedEdgeId = null;

      // Node Drag state
      let draggingNode = null;
      let dragMoved = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartGlobalX = 0;
      let dragStartGlobalY = 0;

      // Edge Connecting state
      let connectingFromNodeId = null;
      let connectingFromPort = null;
      let connectingStartPoint = null;

// Elements
      const swimlanesContainer = document.getElementById('swimlanes-container');
      const lanesRoot = document.getElementById('lanes-root');
      const edgeGroup = document.getElementById('edge-group');
      const edgeLabelsGroup = document.getElementById('edge-labels-group');
      const dragEdge = document.getElementById('drag-edge');
      const btnAddStep = document.getElementById('btn-add-step');
      const btnAddDecision = document.getElementById('btn-add-decision');
      const btnAddLane = document.getElementById('btn-add-lane');
      const connectingBanner = document.getElementById('connecting-banner');
      const connectingText = document.getElementById('connecting-text');
      const btnCancelConnecting = document.getElementById('btn-cancel-connecting');

      // --- RENDERING ---
      function render() {
        const maxX = chartData.nodes.reduce((m, n) => Math.max(m, (n.x || 0) + NODE_WIDTH + 48), 1200);
        swimlanesContainer.style.minWidth = `${maxX + 224}px`;

        renderLanes(maxX);
        renderNodes();
        renderEdges();
      }

      function renderLanes(trackWidth) {
        lanesRoot.innerHTML = '';
        chartData.lanes.forEach((lane, index) => {
          // Dynamically calculate required lane height from nodes in this lane
          const laneNodes = chartData.nodes.filter(n => n.laneId === lane.id);
          const maxNodeBottom = laneNodes.reduce((m, n) => {
            const nh = (n.type === 'decision') ? DECISION_HEIGHT : NODE_HEIGHT;
            return Math.max(m, (n.y || 48) + nh);
          }, 100);
          const computedHeight = Math.max(LANE_MIN_HEIGHT, maxNodeBottom + LANE_BOTTOM_PAD); // derived from nodes only, so lanes shrink back
          lane.height = computedHeight;

          const laneEl = document.createElement('div');
          laneEl.className = 'swimlane';
          laneEl.dataset.laneId = lane.id;
          laneEl.dataset.laneIndex = index;
          laneEl.style.minHeight = `${computedHeight}px`;
          laneEl.style.height = `${computedHeight}px`;

          const header = document.createElement('div');
          header.className = 'lane-header';
          header.draggable = !document.body.classList.contains('presentation');
          header.title = 'Drag to reorder swimlane';
          if (lane.color) {
            header.style.borderLeft = `6px solid ${lane.color}`;
            header.style.background = colorWithAlpha(lane.color, themeAlpha('--lane-tint-header'));
          }

          // Header title with double-click edit
          const title = document.createElement('div');
          title.className = 'lane-title';
          title.contentEditable = 'false';
          title.spellcheck = false;
          title.textContent = lane.name;
          title.title = "Double-click to rename swimlane";

          title.addEventListener('dblclick', (e) => {
            e.stopPropagation();
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
            if (lane.name !== title.textContent.trim()) {
              lane.name = title.textContent.trim();
              updateStatus(true);
            }
          });
          title.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              title.blur();
            }
          });
          header.appendChild(title);

          // Drag the header to reorder; a blue line shows where the lane will land
          header.addEventListener('dragstart', (e) => {
            laneDragFrom = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            laneEl.classList.add('lane-dragging');
          });
          header.addEventListener('dragend', endLaneDrag);

          const track = document.createElement('div');
          track.className = 'lane-track';
          track.dataset.laneId = lane.id;
          track.style.minWidth = `${trackWidth}px`;
          if (lane.color) track.style.background = colorWithAlpha(lane.color, themeAlpha('--lane-tint-track'));

          laneEl.appendChild(header);
          laneEl.appendChild(track);
          lanesRoot.appendChild(laneEl);
        });
      }

      // --- Lane drag & drop helpers ---
      let laneDragFrom = -1;
      const laneDropLine = document.getElementById('lane-drop-line');

      function themeAlpha(name) {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0.3;
      }

      function colorWithAlpha(color, alpha) {
        const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
        if (!m) return color;
        let hex = m[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
      }

      function laneInsertIndexAt(clientY) {
        const lanes = [...lanesRoot.children];
        for (let i = 0; i < lanes.length; i++) {
          const r = lanes[i].getBoundingClientRect();
          if (clientY < r.top + r.height / 2) return i;
        }
        return lanes.length;
      }

      function showLaneDropLine(insertIdx) {
        const lanes = [...lanesRoot.children];
        if (!lanes.length) return;
        const y = insertIdx < lanes.length
          ? lanes[insertIdx].offsetTop
          : lanes[lanes.length - 1].offsetTop + lanes[lanes.length - 1].offsetHeight;
        laneDropLine.style.top = `${y - 2}px`;
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
        showLaneDropLine(laneInsertIndexAt(e.clientY));
      });
      swimlanesContainer.addEventListener('dragleave', (e) => {
        if (laneDragFrom >= 0 && !swimlanesContainer.contains(e.relatedTarget)) laneDropLine.style.display = 'none';
      });
      swimlanesContainer.addEventListener('drop', (e) => {
        if (laneDragFrom < 0) return;
        e.preventDefault();
        const from = laneDragFrom;
        const insertIdx = laneInsertIndexAt(e.clientY);
        const to = insertIdx > from ? insertIdx - 1 : insertIdx;
        endLaneDrag();
        if (to !== from) {
          const [moved] = chartData.lanes.splice(from, 1);
          chartData.lanes.splice(to, 0, moved);
          updateStatus(true);
          render();
        }
      });

      function renderNodes() {
        document.querySelectorAll('.flow-node').forEach(el => el.remove());

        chartData.nodes.forEach(node => {
          const laneTrack = document.querySelector(`.lane-track[data-lane-id="${node.laneId}"]`);
          if (!laneTrack) return;

          const isDecision = node.type === 'decision';
          const nodeEl = document.createElement('div');
          nodeEl.className = `flow-node type-${node.type}` + (node.type === 'end' && node.outcome ? ` outcome-${node.outcome}` : '');
          nodeEl.id = `node-${node.id}`;
          nodeEl.dataset.nodeId = node.id;
          nodeEl.style.left = `${node.x || 80}px`;
          nodeEl.style.top = `${node.y || 53}px`;
          if (node.id === selectedNodeId) nodeEl.classList.add('selected');

          // Decision diamond shape SVG
          if (isDecision) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'decision-diamond-svg');
            svg.setAttribute('viewBox', '0 0 168 64');
            svg.setAttribute('preserveAspectRatio', 'none');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', '84,2 166,32 84,62 2,32');
            poly.setAttribute('class', 'diamond-poly');
            svg.appendChild(poly);
            nodeEl.appendChild(svg);
          }

          // Text content with double-click edit
          const label = document.createElement('div');
          label.className = 'node-label';
          label.contentEditable = 'false';
          label.spellcheck = false;
          label.title = 'Double-click to edit text';
          label.textContent = node.label;

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
            if (node.label !== label.textContent.trim()) {
              node.label = label.textContent.trim();
              updateStatus(true);
            }
          });
          label.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              label.blur();
            }
          });
          nodeEl.appendChild(label);

          // Delete button
          const delBtn = document.createElement('div');
          delBtn.className = 'node-delete-btn';
          delBtn.textContent = '×';
          delBtn.title = 'Delete Node';
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(node.id);
          });
          nodeEl.appendChild(delBtn);

          // 4 Anchor Ports
          ['top', 'right', 'bottom', 'left'].forEach(pos => {
            const port = document.createElement('div');
            port.className = `port port-${pos}`;
            port.dataset.port = pos;
            port.dataset.nodeId = node.id;
            port.title = `Click or drag to connect`;
            port.addEventListener('pointerdown', (e) => handlePortPointerDown(e, node.id, pos));
            nodeEl.appendChild(port);
          });

          nodeEl.addEventListener('pointerdown', (e) => handleNodePointerDown(e, node));
          laneTrack.appendChild(nodeEl);
        });
      }

      // --- PLANAR ORTHOGONAL ROUTING & CHANNEL STAGGERING ENGINE ---
      function computeAllEdgeRoutes() {
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const rects = {};
        const nodeMap = {};

        chartData.nodes.forEach(n => {
          nodeMap[n.id] = n;
          const el = document.getElementById(`node-${n.id}`);
          if (!el) return;
          const r = el.getBoundingClientRect();
          const x = (r.left - stageRect.left) / scale;
          const y = (r.top - stageRect.top) / scale;
          const w = r.width / scale;
          const h = r.height / scale;
          rects[n.id] = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        });

        // True when an axis-aligned segment keeps 6px clear of every node except `ignore`
        const segmentClear = (x1, y1, x2, y2, ignore) => {
          const minX = Math.min(x1, x2) - 6, maxX = Math.max(x1, x2) + 6;
          const minY = Math.min(y1, y2) - 6, maxY = Math.max(y1, y2) + 6;
          return !Object.keys(rects).some(id => {
            if (ignore.includes(id)) return false;
            const r = rects[id];
            return r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY;
          });
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

        // 1. Identify nodes that have a leftward loopback leaving their 'left' port
        const hasLeftLoopback = new Set();
        validEdges.forEach(e => {
          const f = rects[e.from];
          const t = rects[e.to];
          if (t.cx < f.cx - 30 && Math.abs(t.cy - f.cy) > 30) {
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
              if (t.cy > f.cy + 30) {
                edgePorts[e.id] = { fromPort: 'left', toPort: 'top' };
              } else if (t.cy < f.cy - 30) {
                edgePorts[e.id] = { fromPort: 'left', toPort: 'bottom' };
              } else {
                edgePorts[e.id] = { fromPort: 'bottom', toPort: 'bottom' };
              }
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

          const topEdgeId = (isMultiOrDecision && upCands.length > 0) ? upCands[0].id : null;
          const bottomEdgeId = (isMultiOrDecision && downCands.length > 0) ? downCands[0].id : null;

          fwdOuts.forEach(e => {
            const t = rects[e.to];
            let fromPort = 'right';
            if (e.id === topEdgeId) {
              fromPort = 'top';
            } else if (e.id === bottomEdgeId) {
              fromPort = 'bottom';
            }

            let toPort = 'left';
            if (hasLeftLoopback.has(e.to)) {
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (fromPort === 'right' && fwdOuts.length === 1 && uNode && uNode.type !== 'decision') {
              // One step into another lane: leave via top/bottom for a single bend instead of a Z
              const dy = t.cy - f.cy;
              if (Math.abs(dy) > 30 && t.x > f.cx + 40) {
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
              if (!verticalEntryUsed[sideKey]
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
            const meanX = (list, key) => list.reduce((s, e) => s + rects[e[key]].cx, 0) / list.length;
            // Put each group on the side facing where its other ends are, to avoid new crossings
            const insFirst = meanX(ins, 'from') <= meanX(outs, 'to');
            ins.forEach(e => { toOffX[e.id] = insFirst ? -PORT_SLOT : PORT_SLOT; });
            outs.forEach(e => { fromOffX[e.id] = insFirst ? PORT_SLOT : -PORT_SLOT; });
          });
        });

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

          if (p.fromPort === 'left' && (p.toPort === 'top' || p.toPort === 'bottom')) {
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
              const gutterY = Math.max(sy, ey) + 36;
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
            if (otherE && (otherE.from === e.from || otherE.to === e.to)) return false;
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
            const lw = Math.max(48, e.label.length * 7 + 20);
            placedLabels.push({ x: labelPos.x - lw / 2, y: labelPos.y - 14, w: lw, h: 28 });
          }

          routes[e.id] = {
            path: d,
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

            const hops = [];
            verticalObstacles.forEach(obs => {
              const vx = obs.x;
              if (vx > minX + 18 && vx < maxX - 18 && y > obs.yMin + 8 && y < obs.yMax - 8) {
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

        // Render rounded quarter-arc corners (r=8) and semicircular hops (r=6)
        let d = `M ${expanded[0][0]} ${expanded[0][1]}`;
        for (let i = 1; i < expanded.length; i++) {
          const item = expanded[i];
          if (item.isHop) {
            const hx = item.x;
            const hy = item.y;
            const dir = item.dir;
            const hopR = 6;
            d += ` L ${(hx - hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            d += ` A ${hopR} ${hopR} 0 0 1 ${(hx + hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            continue;
          }

          const prev = expanded[i - 1];
          const next = (i < expanded.length - 1 && !expanded[i + 1].isHop) ? expanded[i + 1] : null;

          if (next) {
            const pPrev = prev.isHop ? [prev.x + 6 * prev.dir, prev.y] : prev;
            const pCurr = item;
            const pNext = next;

            const vIn = [pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]];
            const vOut = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];
            const lenIn = Math.hypot(vIn[0], vIn[1]);
            const lenOut = Math.hypot(vOut[0], vOut[1]);

            if (lenIn >= 8 && lenOut >= 8) {
              const curR = Math.min(r, lenIn / 2, lenOut / 2);
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
              y: p1[1]
            });
          }
          candidates.push({ x: (p0[0] + p1[0]) / 2, y: p0[1] });
          candidates.push({ x: (p2[0] + p3[0]) / 2, y: p2[1] });
        }

        const textLen = labelText ? labelText.trim().length : 0;
        const singleLineWidth = Math.max(40, textLen * 7.2 + 18);
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
        if (horizClearance && singleLineWidth > horizClearance) {
          // Never narrower than the longest word, so words are not split mid-word
          const longestWord = Math.max(0, ...String(labelText || '').trim().split(/\s+/).map(w => w.length));
          const minWordW = Math.max(66, longestWord * 7.6 + 20);
          lw = Math.max(minWordW, Math.min(singleLineWidth, horizClearance));
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

        for (const cand of candidates) {
          const bx = cand.x - lw / 2;
          const by = cand.y - lh / 2;
          let collides = false;

          for (const nb of nodeBoxes) {
            if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, 8)) {
              collides = true;
              break;
            }
          }
          if (!collides) {
            for (const pl of placedLabels) {
              if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 6)) {
                collides = true;
                break;
              }
            }
          }
          if (!collides && otherPolylines) {
            for (const poly of otherPolylines) {
              for (let i = 0; i < poly.length - 1; i++) {
                const sx = Math.min(poly[i][0], poly[i + 1][0]);
                const sy = Math.min(poly[i][1], poly[i + 1][1]);
                const sw = Math.abs(poly[i + 1][0] - poly[i][0]);
                const sh = Math.abs(poly[i + 1][1] - poly[i][1]);
                if (BoxOverlap(bx, by, lw, lh, sx, sy, sw, sh, 6)) {
                  collides = true;
                  break;
                }
              }
              if (collides) break;
            }
          }
          if (!collides) {
            return cand;
          }
        }

        return candidates[0] || { x: points[0][0], y: points[0][1] };
      }

      function renderEdges() {
        edgeGroup.innerHTML = '';
        edgeLabelsGroup.innerHTML = '';

        const routes = computeAllEdgeRoutes();

        chartData.edges.forEach(edge => {
          const pathD = routes[edge.id];
          if (!pathD || !pathD.path) return;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD.path);
          path.setAttribute('class', edge.id === selectedEdgeId ? 'connector-path selected' : 'connector-path');
          path.dataset.edgeId = edge.id;
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
              const longestWordW = Math.max(0, ...String(edge.label || '').trim().split(/\s+/).map(w => w.length)) * 7.6 + 20;
              const maxLabelW = Math.max(66, longestWordW, Math.min(220, horizGap - 6));
              labelContainer.style.maxWidth = `${maxLabelW}px`;
            } else {
              labelContainer.style.maxWidth = '180px';
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
            labelText.title = 'Double-click to edit condition';
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

            if (isSelected) {
              // Separate from the label so it reads as "delete the arrow", not "clear the label"
              const delEdgeBtn = document.createElement('div');
              delEdgeBtn.className = 'edge-delete-btn';
              delEdgeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>';
              delEdgeBtn.setAttribute('aria-label', 'Delete arrow');
              delEdgeBtn.title = 'Delete this arrow (Delete key)';
              // Sit on the arrow itself, as near its middle as possible without covering the label pill
              const lw = labelContainer.offsetWidth / 2 + 18, lh = labelContainer.offsetHeight / 2 + 18;
              const total = path.getTotalLength();
              // Clearance > 0 means the 28px button is fully outside the label box (plus a small gap)
              const clearance = (pt) => Math.max(Math.abs(pt.x - pathD.midX) - lw, Math.abs(pt.y - pathD.midY) - lh);
              let spot = null, best = -Infinity;
              const steps = [];
              for (let i = 0; i <= 90; i++) steps.push(0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.01);
              for (const f of steps) {          // nearest to the middle first
                const pt = path.getPointAtLength(total * Math.min(0.95, Math.max(0.05, f)));
                const c = clearance(pt);
                if (c > 0) { spot = pt; break; }
                if (c > best) { best = c; spot = pt; }
              }
              delEdgeBtn.style.left = `${spot.x}px`;
              delEdgeBtn.style.top = `${spot.y}px`;
              delEdgeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
              delEdgeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteEdge(edge.id);
              });
              edgeLabelsGroup.appendChild(delEdgeBtn);
            }

            labelContainer.addEventListener('click', (e) => {
              e.stopPropagation();
              selectEdge(edge.id, false);
              // The "+" placeholder starts typing on a single click
              if (labelContainer.classList.contains('empty-placeholder') && labelText.contentEditable !== 'true') {
                labelContainer.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
              }
            });

            [path, hit].forEach(el => {
              el.addEventListener('mouseenter', () => {
                labelContainer.classList.add('hover-visible');
                path.classList.add('hover');
              });
              el.addEventListener('mouseleave', () => {
                path.classList.remove('hover');
                if (edge.id !== selectedEdgeId && !labelText.matches(':focus')) {
                  labelContainer.classList.remove('hover-visible');
                }
              });
            });
          }
        });
      }

      // --- NODE DRAG INTERACTION ---
      function handleNodePointerDown(e, node) {
        if (e.target.classList.contains('port') || e.target.classList.contains('node-delete-btn') || e.target.isContentEditable) {
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
        selectNode(node.id);
        draggingNode = node;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const nodeEl = document.getElementById(`node-${node.id}`);
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const nRect = nodeEl.getBoundingClientRect();

        // Global X is measured from the lane track, so the lane header width is excluded
        const trackEl = nodeEl.parentElement;
        const trackLeft = trackEl ? trackEl.getBoundingClientRect().left : stageRect.left;
        dragMoved = false;
        dragStartGlobalX = (nRect.left - trackLeft) / scale;
        dragStartGlobalY = (nRect.top - stageRect.top) / scale;

        window.addEventListener('pointermove', onDragNodeMove);
        window.addEventListener('pointerup', onDragNodeUp);
      }

      function onDragNodeMove(e) {
        if (!draggingNode) return;
        if (!dragMoved && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < 4) return;
        dragMoved = true;
        const dx = (e.clientX - dragStartX) / scale;
        const dy = (e.clientY - dragStartY) / scale;

        const nodeEl = document.getElementById(`node-${draggingNode.id}`);
        const isDecision = draggingNode.type === 'decision';
        const nh = isDecision ? DECISION_HEIGHT : NODE_HEIGHT;

        const currGlobalX = dragStartGlobalX + dx;
        const currGlobalY = dragStartGlobalY + dy;

        // Locate target swimlane containing the center of the dragged node
        const nodeCenterY = currGlobalY + nh / 2;
        let targetLane = chartData.lanes[0];
        let targetLaneTop = 0;
        let cumulativeY = 0;

        for (let i = 0; i < chartData.lanes.length; i++) {
          const lane = chartData.lanes[i];
          const lh = lane.height || LANE_MIN_HEIGHT;
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

        // Align to 4px grid, then snap to other nodes' and lane centers when close
        let gridX = Math.max(16, Math.round(currGlobalX / 4) * 4);
        let gridY = Math.round(currGlobalY / 4) * 4;
        const snap = computeSnap(draggingNode, nodeEl.offsetWidth || NODE_WIDTH, nh, currGlobalX, currGlobalY);
        if (snap.x !== null) gridX = Math.max(16, Math.round(snap.x));
        if (snap.y !== null) gridY = Math.round(snap.y);
        const localX = gridX;
        const localY = Math.max(12, gridY - targetLaneTop);
        showSnapGuides(snap, localX, targetLaneTop + localY);

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

        nodeEl.style.left = `${localX}px`;
        nodeEl.style.top = `${localY}px`;

        // Highlight active target swimlane
        document.querySelectorAll('.lane-track').forEach(t => {
          if (t.dataset.laneId === targetLane.id) {
            t.classList.add('drag-hover-lane');
          } else {
            t.classList.remove('drag-hover-lane');
          }
        });

        renderEdges();
      }

      // --- SNAP-TO-ALIGNMENT HELPERS ---
      const SNAP_THRESHOLD = 6; // px (unscaled diagram units)

      function laneTopOf(laneId) {
        let top = 0;
        for (const lane of chartData.lanes) {
          if (lane.id === laneId) return top;
          top += lane.height || LANE_MIN_HEIGHT;
        }
        return top;
      }

      // Returns {x, y} snapped top-left (global coords, null = no snap) plus guide positions
      function computeSnap(dragNode, w, h, gx, gy) {
        let bestX = null, bestY = null; // {delta, pos}
        const mine = {
          x: [gx, gx + w / 2, gx + w],
          y: [gy, gy + h / 2, gy + h]
        };
        chartData.nodes.forEach(n => {
          if (n.id === dragNode.id) return;
          const el = document.getElementById(`node-${n.id}`);
          const nw = el ? el.offsetWidth : NODE_WIDTH;
          const nhh = n.type === 'decision' ? DECISION_HEIGHT : NODE_HEIGHT;
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
          const lh = lane.height || LANE_MIN_HEIGHT;
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

      function showSnapGuides(snap) {
        const vGuide = getSnapGuide('snap-guide-v', 'snap-guide-v');
        const hGuide = getSnapGuide('snap-guide-h', 'snap-guide-h');
        const firstTrack = document.querySelector('.lane-track');
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const trackOffset = firstTrack ? (firstTrack.getBoundingClientRect().left - stageRect.left) / scale : 0;
        if (snap.guideX !== null) {
          vGuide.style.left = `${trackOffset + snap.guideX}px`;
          vGuide.style.display = 'block';
        } else vGuide.style.display = 'none';
        if (snap.guideY !== null) {
          hGuide.style.top = `${snap.guideY}px`;
          hGuide.style.display = 'block';
        } else hGuide.style.display = 'none';
      }

      function hideSnapGuides() {
        document.querySelectorAll('.snap-guide').forEach(g => g.style.display = 'none');
      }

      function onDragNodeUp() {
        hideSnapGuides();
        document.querySelectorAll('.lane-track').forEach(t => t.classList.remove('drag-hover-lane'));
        if (draggingNode) {
          draggingNode = null;
          if (dragMoved) {
            updateStatus(true);
            render();
          }
          dragMoved = false;
        }
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

        const fromNode = chartData.nodes.find(n => n.id === nodeId);
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

        connectingBanner.classList.add('active');
        connectingText.textContent = `Connecting from "${fromNode ? fromNode.label : nodeId}"... Click target node or release over it.`;

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

        const dist = Math.hypot(
          ev.clientX - (connectingStartPoint.sx * scale + swimlanesContainer.getBoundingClientRect().left),
          ev.clientY - (connectingStartPoint.sy * scale + swimlanesContainer.getBoundingClientRect().top)
        );
        if (dist > 25) {
          cancelConnecting();
        }
      }

      function createConnection(fromId, toId) {
        const existing = chartData.edges.find(e => e.from === fromId && e.to === toId);
        if (existing) return;

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
        connectingBanner.classList.remove('active');
        document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('connect-target'));

        window.removeEventListener('pointermove', onConnectingMove);
        window.removeEventListener('pointerup', onConnectingPointerUp);
      }

      btnCancelConnecting.addEventListener('click', cancelConnecting);

      // --- SELECTION & DELETION ---
      function selectNode(nodeId) {
        selectedNodeId = nodeId;
        selectedEdgeId = null;
        document.querySelectorAll('.flow-node').forEach(el => el.classList.toggle('selected', el.dataset.nodeId === nodeId));
        document.querySelectorAll('.connector-path').forEach(p => p.classList.remove('selected'));
        document.querySelectorAll('.edge-label-container').forEach(c => c.classList.remove('selected'));
      }

      function selectEdge(edgeId, reRender = true) {
        selectedEdgeId = edgeId;
        selectedNodeId = null;
        document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('selected'));
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
        chartData.nodes = chartData.nodes.filter(n => n.id !== nodeId);
        chartData.edges = chartData.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        selectedNodeId = null;
        updateStatus(true);
        render();
      }

      function deleteEdge(edgeId) {
        chartData.edges = chartData.edges.filter(e => e.id !== edgeId);
        selectedEdgeId = null;
        updateStatus(true);
        renderEdges();
      }

      // --- ADD ELEMENTS ---
      // Place a new node at the center of the visible viewport (lane + local coords)
      function viewportCenterPlacement(nw, nh) {
        const vp = viewport.getBoundingClientRect();
        const cx = vp.left + vp.width / 2;
        const cy = vp.top + vp.height / 2;
        const stageRect = swimlanesContainer.getBoundingClientRect();
        const track = document.querySelector('.lane-track');
        const trackLeft = track ? track.getBoundingClientRect().left : stageRect.left;
        const gx = (cx - trackLeft) / scale;
        const gy = (cy - stageRect.top) / scale;
        let top = 0, lane = chartData.lanes[0];
        for (let i = 0; i < chartData.lanes.length; i++) {
          const l = chartData.lanes[i];
          const lh = l.height || LANE_MIN_HEIGHT;
          lane = l;
          if (gy < top + lh) break;
          if (i < chartData.lanes.length - 1) top += lh;
        }
        return {
          laneId: lane ? lane.id : "lane-1",
          x: Math.max(16, Math.round((gx - nw / 2) / 4) * 4),
          y: Math.max(12, Math.round((gy - top - nh / 2) / 4) * 4)
        };
      }

      btnAddStep.addEventListener('click', () => {
        const p = viewportCenterPlacement(NODE_WIDTH, NODE_HEIGHT);
        const newNode = {
          id: `n_${Date.now()}`,
          laneId: p.laneId,
          type: "task",
          label: "New Step",
          x: p.x,
          y: p.y
        };
        chartData.nodes.push(newNode);
        updateStatus(true);
        render();
        selectNode(newNode.id);
      });

      btnAddDecision.addEventListener('click', () => {
        const p = viewportCenterPlacement(NODE_WIDTH, DECISION_HEIGHT);
        const newNode = {
          id: `n_${Date.now()}`,
          laneId: p.laneId,
          type: "decision",
          label: "Decision?",
          x: p.x,
          y: p.y
        };
        chartData.nodes.push(newNode);
        updateStatus(true);
        render();
        selectNode(newNode.id);
      });

      btnAddLane.addEventListener('click', () => {
        const colors = ["#e0f2fe", "#fef3c7", "#dcfce7", "#fee2e2", "#f3e8ff", "#ffedd5"];
        const nextColor = colors[chartData.lanes.length % colors.length];
        const newLane = {
          id: `lane_${Date.now()}`,
          name: `Actor / Role ${chartData.lanes.length + 1}`,
          color: nextColor,
          height: LANE_MIN_HEIGHT
        };
        chartData.lanes.push(newLane);
        updateStatus(true);
        render();
      });

      // --- REGISTER WITH THE SHELL ---
      registerDiagramPlugin({
        id: 'flowchart',
        defaultTitle: 'Interactive Swimlane Flowchart',
        contentEl: swimlanesContainer,
        report: { node: '.flow-node', label: '.edge-label-container', labelText: '.edge-label-text', nodeText: '.node-label' },
        render,
        isBackground: (el) => el.id === 'swimlanes-container' || el.classList.contains('lane-track'),
        clearSelection() {
          selectedNodeId = null;
          selectedEdgeId = null;
          document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('selected'));
          renderEdges();
        },
        cancelInteraction() {
          const wasConnecting = !!connectingFromNodeId;
          cancelConnecting();
          return wasConnecting;
        },
        deleteSelection() {
          if (selectedNodeId) deleteNode(selectedNodeId);
          else if (selectedEdgeId) deleteEdge(selectedEdgeId);
        }
      });
