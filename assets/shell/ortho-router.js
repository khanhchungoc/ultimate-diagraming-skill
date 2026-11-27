      // --- SHARED ORTHOGONAL ROUTER ---
      // Pure JS, no DOM: the flowchart's arrow router, for every type that draws orthogonal arrows. A plain script
      // (globals only, no imports), joined into the page ahead of engine.js (ENGINE_JS in layout_engine.py) and loaded
      // ahead of it by scripts/run_engine.mjs and scripts/engine_runner.py. TOKENS is defined by the page or by those scripts.
      //
      // routeEdgesOrthogonal({ chartData, tb, boxes, laneDividers, loopSide, outlineInset, labelMaxW }) -> routes
      //   chartData     { nodes: [{ id, type, laneId? }], edges: [{ id, from, to, label?, feedback? }] }
      //   tb            true when the flow runs top to bottom: boxes are transposed before the search, polylines back after
      //   boxes         { nodeId: { x, y, w, h } } in screen px (a node without a box is skipped, and so are its arrows)
      //   laneDividers  screen offsets (along the flow axis) of the lane borders: a horizontal run on one costs more; [] for none
      //   loopSide      (edge) -> 'far' | 'near': the side a same-lane loop-back U-turns on (flowchart: loopSides())
      //   outlineInset  optional (node, box, side, along) -> px a shaped outline sits inside its box (0 for a plain box)
      //   labelMaxW     widest a wrapped edge label may be
      // Returns { edgeId: { path, points, midX, midY, fromRect, toRect } }; midX/midY is where the label pill goes.
      // Text widths come from TOKENS.font.metrics. Deterministic: the same input gives the same routes.
      // --- PLANAR ORTHOGONAL ROUTING & CHANNEL STAGGERING ENGINE ---
      // Top-to-bottom diagrams are routed in flow terms too: node boxes are transposed (x <-> y) before the route
      // search, so every rule written for a left-to-right flow applies unchanged, and the finished polylines are
      // transposed back before hops and labels are placed on screen (step 6).
      function routeEdgesOrthogonal(model) {
        const { chartData, tb, boxes, laneDividers, loopSide, outlineInset, labelMaxW } = model;
        const FONT_M = TOKENS.font.metrics;
        const rects = {};
        const nodeMap = {};

        chartData.nodes.forEach(n => {
          nodeMap[n.id] = n;
          const r = boxes[n.id];
          if (!r) return;
          const { x, y, w, h } = r;
          rects[n.id] = tb ? { x: y, y: x, w: h, h: w, cx: y + h / 2, cy: x + w / 2 } : { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        });

        // Uniform grid over boxes, so "what lies near here" looks at a few cells instead of every node or arrow.
        // Ids are small integers (an index into the caller's list). Cells span the bounds of `frame` (one node per
        // cell on average) and clamp at its border, so anything outside lands in a border cell: a lookup returns a
        // superset and every caller still runs its exact test. `near` returns distinct ids ascending, so callers that
        // add up penalties or take the first hit visit items in their original order (routes stay byte-identical).
        const makeGrid = (frame) => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const r of frame) {
            x0 = Math.min(x0, r.x, r.x + r.w); x1 = Math.max(x1, r.x, r.x + r.w);
            y0 = Math.min(y0, r.y, r.y + r.h); y1 = Math.max(y1, r.y, r.y + r.h);
          }
          if (![x0, y0, x1, y1].every(Number.isFinite)) { x0 = y0 = 0; x1 = y1 = 1; }   // no usable boxes: one cell
          const cell = Math.max(32, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, frame.length)));
          const cols = Math.min(512, Math.floor((x1 - x0) / cell) + 1), rows = Math.min(512, Math.floor((y1 - y0) / cell) + 1);
          const cells = Array.from({ length: cols * rows }, () => []);
          // Cell range of [a, b] on one axis, clamped; NaN widens to the whole axis
          const lo = (v, o, n) => { const c = Math.floor((v - o) / cell); return c > 0 ? (c < n ? c : n - 1) : 0; };
          const hi = (v, o, n) => { const c = Math.floor((v - o) / cell); return c < n - 1 ? (c > 0 ? c : 0) : n - 1; };
          const seen = [];
          let stamp = 0;
          // The id lists of the cells under a box. The returned array is reused by the next call: read it before then.
          const hit = [];
          const cellsIn = (ax, ay, bx, by) => {
            const c0 = lo(Math.min(ax, bx), x0, cols), c1 = hi(Math.max(ax, bx), x0, cols);
            const r0 = lo(Math.min(ay, by), y0, rows), r1 = hi(Math.max(ay, by), y0, rows);
            hit.length = 0;
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) hit.push(cells[r * cols + c]);
            return hit;
          };
          return {
            cellsIn,
            add: (id, ax, ay, bx, by) => { for (const list of cellsIn(ax, ay, bx, by)) list.push(id); },
            remove: (id, ax, ay, bx, by) => {
              for (const list of cellsIn(ax, ay, bx, by)) { let j = 0; for (const v of list) if (v !== id) list[j++] = v; list.length = j; }
            },
            // distinct ids filed near any of the boxes [ax, ay, bx, by, ...] (grown by pad), ascending, written into `out`
            near: (boxes, pad = 0, out = []) => {
              out.length = 0;
              stamp++;
              for (let k = 0; k < boxes.length; k += 4) {
                for (const list of cellsIn(boxes[k] - pad, boxes[k + 1] - pad, boxes[k + 2] + pad, boxes[k + 3] + pad)) {
                  for (let u = 0; u < list.length; u++) if (seen[list[u]] !== stamp) { seen[list[u]] = stamp; out.push(list[u]); }
                }
              }
              // insertion sort: lookups return a few dozen ids, where it beats Array#sort with a comparator
              if (out.length > 64) return out.sort((a, b) => a - b);
              for (let i = 1; i < out.length; i++) {
                const v = out[i];
                let j = i - 1;
                while (j >= 0 && out[j] > v) { out[j + 1] = out[j]; j--; }
                out[j + 1] = v;
              }
              return out;
            },
          };
        };
        // Segment boxes of a polyline, as `near` takes them
        const segBoxes = (pts) => {
          const out = [];
          for (let i = 0; i < pts.length - 1; i++) out.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          return out;
        };

        // True when an axis-aligned segment keeps 6px clear of every node except `ignore`
        // (route search calls this hundreds of thousands of times per render: grid lookup, any hit wins)
        const rectList = Object.keys(rects).map(id => [id, rects[id]]);
        const rectGrid = makeGrid(rectList.map(([, r]) => r));
        rectList.forEach(([, r], k) => rectGrid.add(k, r.x, r.y, r.x + r.w, r.y + r.h));
        const segmentClear = (x1, y1, x2, y2, ignore) => {
          const minX = Math.min(x1, x2) - 6, maxX = Math.max(x1, x2) + 6;
          const minY = Math.min(y1, y2) - 6, maxY = Math.max(y1, y2) + 6;
          for (const list of rectGrid.cellsIn(minX, minY, maxX, maxY)) {
            for (let u = 0; u < list.length; u++) {
              const r = rectList[list[u]][1];
              if (r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY && !ignore.includes(rectList[list[u]][0])) return false;
            }
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
        // Arrows touching each node, in validEdges order: the per-node passes (5a1-5a3, 5c2) read these instead of every arrow
        const touching = {};
        chartData.nodes.forEach(n => { touching[n.id] = []; });
        validEdges.forEach(e => { touching[e.from].push(e); if (e.to !== e.from) touching[e.to].push(e); });

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
          } else if (fp === 'left' && tp === 'left') {  // left exit, wrap upstream into target's flow-entry port: two bends
            const sx = f.x, sy = f.cy, ex = t.x, ey = t.cy;
            for (const pad of [24, 14, 10]) {
              const gx = Math.min(sx, ex) - pad;
              if (gx < 8) continue;
              const cand = [[sx, sy], [gx, sy], [gx, ey], [ex, ey]];
              if (cand.slice(0, -1).every((p, i) => segmentClear(p[0], p[1], cand[i + 1][0], cand[i + 1][1], ids))) return 2;
            }
            return null;
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
          // If the target is a decision that sends a forward branch back toward this loopback's side, avoid
          // stealing that side vertex so the outgoing branch does not wrap around the back of the diamond.
          const decisionBranchOnSide = !sameRow && nodeMap[e.to] && nodeMap[e.to].type === 'decision'
            && (outEdges[e.to] || []).some(o => rects[o.to] && rects[o.to].cx >= t.cx - 30
              && (dy > 30 ? rects[o.to].cy < t.cy - 30 : rects[o.to].cy > t.cy + 30));
          if (rightEntryFree) {
            if (leftExitFree) cands.push(['left', 'right']);
            if (!sameRow) cands.push([dy < 0 ? 'top' : 'bottom', 'right']);
          }
          if (!sameRow && leftExitFree) {
            if (decisionBranchOnSide) cands.push(['left', 'left']);
            else cands.push(['left', dy < 0 ? 'bottom' : 'top']);
          }
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

          // Unlabelled same-side parallel fork from a non-decision step keeps all branches on the flow exit/entry sides
          // so they share one orthogonal fork bus instead of splitting the furthest branch onto a side port.
          const isParallelFork = (cands) => (!uNode || uNode.type !== 'decision')
            && cands.length >= 2
            && cands.every(e => !(e.label || '').trim() && rects[e.to].x > f.x + f.w + 20);
          const upFork = isParallelFork(upCands);
          const downFork = isParallelFork(downCands);

          // A decision gives each branch its own vertex: a vertex already taken by a loop-back branch
          // is not reused for a forward one (it would leave the diamond's slanted sides, off the vertex)
          const backTaken = new Set(uNode && uNode.type === 'decision'
            ? uOuts.filter(e => !fwdOuts.includes(e)).map(e => edgePorts[e.id] && edgePorts[e.id].fromPort)
            : []);
          let topEdgeId = (!upFork && isMultiOrDecision && upCands.length > 0 && !backTaken.has('top')) ? upCands[0].id : null;
          let bottomEdgeId = (!downFork && isMultiOrDecision && downCands.length > 0 && !backTaken.has('bottom')) ? downCands[0].id : null;
          if (!upFork && !topEdgeId && upCands.length > 0 && !backTaken.has('top') && Math.abs(rects[upCands[0].to].cx - f.cx) < 30) {
            topEdgeId = upCands[0].id;
          }
          if (!downFork && !bottomEdgeId && downCands.length > 0 && !backTaken.has('bottom') && Math.abs(rects[downCands[0].to].cx - f.cx) < 30) {
            bottomEdgeId = downCands[0].id;
          }

          fwdOuts.forEach(e => {
            const t = rects[e.to];
            const inFork = (upFork && upCands.includes(e)) || (downFork && downCands.includes(e));
            let fromPort = 'right';
            if (e.id === topEdgeId) {
              fromPort = 'top';
            } else if (e.id === bottomEdgeId) {
              fromPort = 'bottom';
            }

            let toPort = 'left';
            if (hasLeftLoopback.has(e.to) && fromPort === 'right' && Math.abs(t.cy - f.cy) > 30) {
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (fromPort === 'right' && fwdOuts.length === 1 && uNode && uNode.type !== 'decision') {
              // One step into another lane: leave via top/bottom for a single bend instead of a Z,
              // unless an incoming arrow already enters from that same side and a flow-side exit can single-bend
              const dy = t.cy - f.cy;
              const incomingSameSide = t.cx > f.x + f.w + 24 && (inEdges[uId] || []).some(o => {
                const s = rects[o.from];
                return s && (dy > 0 ? s.cy > f.cy + 30 : s.cy < f.cy - 30);
              });
              if (!incomingSameSide && Math.abs(dy) > 30 && (Math.abs(t.cx - f.cx) < 30 || t.x > f.cx + 40)) {
                const sy = dy > 0 ? f.y + f.h : f.y;
                if (segmentClear(f.cx, sy, f.cx, t.cy, [uId, e.to]) && segmentClear(f.cx, t.cy, t.x, t.cy, [uId, e.to])) {
                  fromPort = dy > 0 ? 'bottom' : 'top';
                }
              }
            }
            if ((fromPort === 'top' || fromPort === 'bottom') && Math.abs(t.cx - f.cx) < 30) {
              // Target sits directly above/below: straight vertical line
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (!inFork && fromPort === 'right' && toPort === 'left' && Math.abs(t.cy - f.cy) > 30 && t.cx > f.x + f.w + 24) {
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
              const decisionBranchOnEnter = nodeMap[e.to] && nodeMap[e.to].type === 'decision'
                && (outEdges[e.to] || []).some(o => rects[o.to]
                  && (enterSide === 'bottom' ? rects[o.to].cy > t.cy + 30 : rects[o.to].cy < t.cy - 30));
              if (!verticalEntryUsed[sideKey] && !cutsSiblingTrunk && !decisionBranchOnEnter
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
        const fromOffY = {};
        const toOffY = {};
        const splitPortAxis = (nid, sides, fromMap, toMap, axis) => {
          // Keep decision arrowheads/tails on the exact diamond vertices in the initial pass;
          // step 5a separates colliding entries/exits onto free vertices, and 5a2 only offsets if they still collide.
          if (nodeMap[nid] && nodeMap[nid].type === 'decision') return;
          sides.forEach(side => {
            const outs = outEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].fromPort === side);
            const ins = inEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].toPort === side);
            if (!outs.length || !ins.length) return;

            const aligned = (a, b) => Math.abs(rects[a][axis] - rects[b][axis]) < 30;
            const opp = axis === 'cx' ? ['top', 'bottom'] : ['left', 'right'];
            const isStraightOut = outs.some(e => aligned(e.to, nid) && opp.includes(edgePorts[e.id].toPort));
            const isStraightIn = ins.some(e => aligned(e.from, nid) && opp.includes(edgePorts[e.id].fromPort));

            const isDecision = nodeMap[nid] && nodeMap[nid].type === 'decision';
            if ((isStraightOut || isDecision) && !isStraightIn) {
              outs.forEach(e => { fromMap[e.id] = 0; });
              const insMean = ins.reduce((s, e) => s + rects[e.from][axis], 0) / ins.length;
              const slotDir = insMean >= rects[nid][axis] ? 1 : -1;
              ins.forEach(e => { toMap[e.id] = slotDir * PORT_SLOT; });
              return;
            } else if (isStraightIn && !isStraightOut) {
              ins.forEach(e => { toMap[e.id] = 0; });
              const outsMean = outs.reduce((s, e) => s + rects[e.to][axis], 0) / outs.length;
              const slotDir = outsMean >= rects[nid][axis] ? 1 : -1;
              outs.forEach(e => { fromMap[e.id] = slotDir * PORT_SLOT; });
              return;
            }

            const mean = (list, key) => list.reduce((s, e) => s + rects[e[key]][axis], 0) / list.length;
            // Put each group on the side facing where its other ends are, to avoid new crossings
            const insFirst = mean(ins, 'from') <= mean(outs, 'to');
            ins.forEach(e => { toMap[e.id] = insFirst ? -PORT_SLOT : PORT_SLOT; });
            outs.forEach(e => { fromMap[e.id] = insFirst ? PORT_SLOT : -PORT_SLOT; });
          });
        };
        Object.keys(rects).forEach(nid => {
          splitPortAxis(nid, ['top', 'bottom'], fromOffX, toOffX, 'cx');
          splitPortAxis(nid, ['left', 'right'], fromOffY, toOffY, 'cy');
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

            // Unlabelled same-source same-direction fork branches share one channel slot so they form a single fork bus
            const forkCounts = new Map();
            const forkKeyOf = (e) => `${e.from}\0${rects[e.to].cy < rects[e.from].cy ? 'u' : 'd'}`;
            ordered.forEach(e => {
              if (!(e.label || '').trim()) forkCounts.set(forkKeyOf(e), (forkCounts.get(forkKeyOf(e)) || 0) + 1);
            });
            const slots = [];
            const forkSlot = new Map();
            ordered.forEach(e => {
              const fk = forkKeyOf(e);
              if (!(e.label || '').trim() && (forkCounts.get(fk) || 0) >= 2) {
                if (!forkSlot.has(fk)) { const s = []; forkSlot.set(fk, s); slots.push(s); }
                forkSlot.get(fk).push(e);
              } else {
                slots.push([e]);
              }
            });

            slots.forEach((slot, idx) => {
              const sx = rects[slot[0].from].x + rects[slot[0].from].w;
              const ex = Math.min(...slot.map(e => rects[e.to].x));
              const gap = ex - sx;
              const frac = (idx + 1) / (slots.length + 1);
              const cx = sx + Math.max(24, Math.min(gap - 24, gap * frac));
              slot.forEach(e => { channelXMap[e.id] = cx; });
            });
          }
        });

        // 5. First pass: build polylines for all edges
        const edgePolylines = {};
        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const f = rects[e.from];
          const t = rects[e.to];
          const offsetY = (toPortOffsetY[e.id] || 0) + (toOffY[e.id] || 0);
          const srcOffY = fromOffY[e.id] || 0;
          let points = [];

          if (p.toPort === 'right') {
            // Backward arrow entering the target's right side
            const ex = t.x + t.w, ey = t.cy + offsetY;
            if (p.fromPort === 'left') {
              const sx = f.x, sy = f.cy + srcOffY;
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
          } else if (p.fromPort === 'left' && p.toPort === 'left') {
            const sx = f.x, sy = f.cy + srcOffY, ex = t.x, ey = t.cy + offsetY;
            let gx = Math.min(sx, ex) - 24;
            for (const pad of [24, 14, 10]) {
              const cand = Math.min(sx, ex) - pad;
              if (cand >= 8 && segmentClear(sx, sy, cand, sy, [e.from, e.to]) && segmentClear(cand, sy, cand, ey, [e.from, e.to]) && segmentClear(cand, ey, ex, ey, [e.from, e.to])) {
                gx = cand;
                break;
              }
            }
            points = [[sx, sy], [gx, sy], [gx, ey], [ex, ey]];
          } else if (p.fromPort === 'left' && (p.toPort === 'top' || p.toPort === 'bottom')) {
            const sx = f.x;
            const sy = f.cy + srcOffY;
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
            const sy = f.cy + srcOffY;
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
            const sy = f.cy + srcOffY;
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
        const relate = (pts, otherPts, skipFirst = false, skipLast = false, skipFirstTrunk = false) => {
          // Every relation needs the two routes within 18px of each other: skip pairs whose boxes are further apart.
          // Only stable (unmutated) polylines are cached; the candidate route is measured fresh.
          const a = bboxOf(otherPts);
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (let i = 0; i < pts.length; i++) {
            const x = pts[i][0], y = pts[i][1];
            if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
          }
          if (x1 > a[2] + 18 || a[0] > x2 + 18 || y1 > a[3] + 18 || a[1] > y2 + 18) return NONE;
          let overlap = 0, near = 0, cross = 0;
          const lastI = pts.length - 2, lastJ = otherPts.length - 2;
          // Plain indexed reads (no destructuring): this loop runs millions of times per render on big diagrams
          for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
            const aV = Math.abs(ax - bx) < 1, aH = Math.abs(ay - by) < 1;
            for (let j = 0; j < otherPts.length - 1; j++) {
              if ((skipFirst && i === 0 && j === 0)
                || (skipFirstTrunk && lastI >= 2 && lastJ >= 2 && i === 1 && j === 1)
                || (skipLast && ((i === lastI && j === lastJ) || (lastI >= 2 && lastJ >= 2 && i === lastI - 1 && j === lastJ - 1)))) continue;
              const cx = otherPts[j][0], cy = otherPts[j][1], dx = otherPts[j + 1][0], dy = otherPts[j + 1][1];
              const cV = Math.abs(cx - dx) < 1, cH = Math.abs(cy - dy) < 1;
              if (aV && cV) {
                const run = Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy));
                if (run > 1) { const gap = Math.abs(ax - cx); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if (aH && cH) {
                const run = Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx));
                if (run > 1) { const gap = Math.abs(ay - cy); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if (aV && cH) {
                if (Math.min(cx, dx) + 1 < ax && ax < Math.max(cx, dx) - 1 && Math.min(ay, by) + 1 < cy && cy < Math.max(ay, by) - 1) cross += 1;
              } else if (aH && cV) {
                if (Math.min(ax, bx) + 1 < cx && cx < Math.max(ax, bx) - 1 && Math.min(cy, dy) + 1 < ay && ay < Math.max(cy, dy) - 1) cross += 1;
              }
            }
          }
          return { overlap, near, cross };
        };
        // Cost model: overlap >> near-parallel > crossing (~1.75 bends) > bend > length
        const COST = { overlap: 20000, near: 2500, cross: 1750, bend: 1000, divider: 1500, nearNode: 600, portClash: 2500, sharedBranch: 1200, entryShare: 2600, backwardExit: 3500, upstreamDetour: 4500, sideOvershoot: 1800 };
        const routeDefects = (pts, ids) => {
          // Penalties independent of other arrows: hugging a lane divider, crowding a node
          let d = 0;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) > 30 && laneDividers.some(y => Math.abs(ay - y) < 8)) d += COST.divider;
            const x1 = Math.min(ax, bx) - 14, x2 = Math.max(ax, bx) + 14, y1 = Math.min(ay, by) - 14, y2 = Math.max(ay, by) + 14;
            let tight = false;
            for (const list of rectGrid.cellsIn(x1, y1, x2, y2)) {
              for (let u = 0; u < list.length && !tight; u++) {
                const r = rectList[list[u]][1];
                tight = r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1 && !ids.includes(rectList[list[u]][0]);
              }
              if (tight) break;
            }
            if (tight) d += COST.nearNode;
          }
          return d;
        };
        // Entries and exits on any side get separate slots in 2b, so portClashes is 0
        const portClashes = () => 0;
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
        // isOther(o): whether arrow o counts against this route (the caller's set of settled arrows)
        const routeCost = (pts, edge, isOther, fp, tp, limit = Infinity) => {
          let len = 0;
          for (let i = 0; i < pts.length - 1; i++) len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
          if ((pts.length - 2) * COST.bend + len >= limit) return Infinity;   // cannot beat the best so far
          const ids = [edge.from, edge.to];
          // Every check up to the arrow scan is pure and each failure gives Infinity, so the cheap ones run first
          // and the node-clearance scan (polyClear) only runs for a route that can still win.
          // A route must not run back through the body of its own source or target node
          if (!ownBodyClear(pts, edge)) return Infinity;
          // Every penalty is non-negative, so once the running cost reaches `limit` this route cannot win: stop
          const fixed = (pts.length - 2) * COST.bend + len;
          let defect = portClashes(edge, fp, tp) * COST.portClash + sharedBranchVertex(edge, fp) * COST.sharedBranch;
          const f = rects[edge.from], t = rects[edge.to];
          if (t.cx >= f.cx - 30) {
            if (nodeMap[edge.from] && nodeMap[edge.from].type === 'decision' && fp === 'left') {
              defect += COST.backwardExit;
            }
            let minX = Infinity;
            for (let i = 0; i < pts.length; i++) if (pts[i][0] < minX) minX = pts[i][0];
            const upLimit = Math.min(f.x, t.x) - 16;
            if (minX < upLimit) defect += COST.upstreamDetour + (upLimit - minX) * 4;
          }
          if (fp !== tp) {
            let minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < pts.length; i++) {
              if (pts[i][1] < minY) minY = pts[i][1];
              if (pts[i][1] > maxY) maxY = pts[i][1];
            }
            const loY = Math.min(f.y, t.y) - 16, hiY = Math.max(f.y + f.h, t.y + t.h) + 16;
            const overY = Math.max(0, loY - minY) + Math.max(0, maxY - hiY);
            if (overY > 0) defect += COST.sideOvershoot + overY * 4;
          }
          if (fixed + defect >= limit) return Infinity;
          if (!polyClear(pts, ids)) return Infinity;
          // Only arrows filed near this route's segments can relate to it (any other adds exactly 0);
          // ascending index keeps validEdges order, so the costs add up in the same order as a full scan
          const near = edgeGrid.near(segBoxes(pts), 0, nearBuf);
          for (let k = 0; k < near.length; k++) {
            const o = validEdges[near[k]];
            if (!isOther(o)) continue;
            const op = edgePorts[o.id];
            const incident = o.from === edge.from || o.to === edge.to || o.from === edge.to || o.to === edge.from;
            const skipFirst = o.from === edge.from && op && op.fromPort === fp;
            const skipLast = o.to === edge.to && op && op.toPort === tp;
            const skipFirstTrunk = skipFirst && !(edge.label || '').trim() && !(o.label || '').trim();
            const r = relate(pts, edgePolylines[o.id], skipFirst, skipLast, skipFirstTrunk);
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
        // Gap centers (+/-22px) between node bands and node clearance edges so tight corridors are never skipped
        const buildCorridors = (loKey, sizeKey, minBound, maxBound) => {
          const ivs = rectList.map(([, r]) => [r[loKey], r[loKey] + r[sizeKey]]).sort((a, b) => a[0] - b[0]);
          const seen = new Set();
          const out = [];
          const push = (v) => {
            const q = Math.round(v / 8);
            if (seen.has(q)) return;
            seen.add(q);
            out.push(v);
          };
          let hi = -Infinity;
          for (const [a, b] of ivs) {
            if (a > hi + 28 && hi > -Infinity) {
              const mid = (hi + a) / 2;
              push(mid); push(mid - 22); push(mid + 22);
            }
            if (b > hi) hi = b;
          }
          for (let k = 0; k < rectList.length; k++) {
            const r = rectList[k][1];
            push(r[loKey] - 16);
            push(r[loKey] + r[sizeKey] + 16);
          }
          push(minBound - 24);
          push(maxBound + 24);
          return out;
        };
        const corridorXs = buildCorridors('x', 'w', bounds.minX, bounds.maxX);
        const corridorYs = buildCorridors('y', 'h', bounds.minY, bounds.maxY);
        const altRoutes = (f, t, deep) => {
          const out = [];
          const SIDES = ['top', 'bottom', 'left', 'right'];
          const horiz = s => s === 'left' || s === 'right';
          SIDES.forEach(fp => SIDES.forEach(tp => {
            const [sx, sy] = anchor(f, fp), [ex, ey] = anchor(t, tp);
            const add = (pts, dev = 0) => out.push({ fp, tp, pts, dev });
            if (horiz(fp) && horiz(tp)) {
              if (fp === tp) {
                const seenG = new Set();
                const tryU = g => {
                  if (fp === 'left' ? g > Math.min(sx, ex) - 12 : g < Math.max(sx, ex) + 12) return;
                  const q = Math.round(g / 8);
                  if (seenG.has(q)) return;
                  seenG.add(q);
                  add([[sx, sy], [g, sy], [g, ey], [ex, ey]]);
                };
                [16, 28, 36, 48].forEach(d => tryU(fp === 'left' ? Math.max(8, Math.min(sx, ex) - d) : Math.max(sx, ex) + d));
                return;
              }
              const dirOk = fp === 'right' ? ex > sx + 28 : ex < sx - 28;
              if (!dirOk) return;
              if (Math.abs(sy - ey) < 6) { add([[sx, sy], [ex, sy]]); return; }
              const lo = Math.min(sx, ex) + 14, hi = Math.max(sx, ex) - 14, mid = (sx + ex) / 2;
              let hasMid = false;
              for (let x = lo; x <= hi; x += 16) {
                if (Math.abs(x - mid) < 4) hasMid = true;
                add([[sx, sy], [x, sy], [x, ey], [ex, ey]], Math.abs(x - mid));
              }
              if (!hasMid && lo <= mid && mid <= hi) add([[sx, sy], [mid, sy], [mid, ey], [ex, ey]], 0);
            } else if (!horiz(fp) && !horiz(tp)) {
              if (fp !== tp) {
                const dirOk = fp === 'bottom' ? ey > sy + 28 : ey < sy - 28;
                if (!dirOk) return;
                if (Math.abs(sx - ex) < 1) { add([[sx, sy], [ex, ey]]); return; }
                const lo = Math.min(sy, ey) + 14, hi = Math.max(sy, ey) - 14, mid = (sy + ey) / 2;
                let hasMid = false;
                for (let y = lo; y <= hi; y += 16) {
                  if (Math.abs(y - mid) < 4) hasMid = true;
                  add([[sx, sy], [sx, y], [ex, y], [ex, ey]], Math.abs(y - mid));
                }
                if (!hasMid && lo <= mid && mid <= hi) add([[sx, sy], [sx, mid], [ex, mid], [ex, ey]], 0);
              } else {
                const seenG = new Set();
                const tryU = g => {
                  if (fp === 'top' ? g > Math.min(sy, ey) - 12 : g < Math.max(sy, ey) + 12) return;
                  const q = Math.round(g / 8);
                  if (seenG.has(q)) return;
                  seenG.add(q);
                  add([[sx, sy], [sx, g], [ex, g], [ex, ey]]);
                };
                [28, 36, 48, 72].forEach(d => tryU(fp === 'top' ? Math.max(8, Math.min(sy, ey) - d) : Math.max(sy, ey) + d));
                if (deep) corridorYs.forEach(tryU);
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
              const STEP = 64;
              if (!horiz(fp)) {
                // vertical exit -> corridor above/below -> sideways to x -> vertical -> horizontal entry
                [16, 20, 36, 56].forEach(d => {
                  const g = fp === 'top' ? sy - d : sy + d;
                  const seenX = new Set();
                  const tryX = x => {
                    const q = Math.round(x / 8);
                    if (seenX.has(q)) return;
                    seenX.add(q);
                    if (tp === 'left' ? x > ex - 14 : x < ex + 14) return;
                    if (Math.abs(x - sx) < 10 || Math.abs(ey - g) < 10) return;
                    add([[sx, sy], [sx, g], [x, g], [x, ey], [ex, ey]], 0);
                  };
                  corridorXs.forEach(tryX);
                  const xLo = Math.min(sx, ex) - 64, xHi = Math.max(sx, ex) + 64;
                  for (let x = xLo; x <= xHi; x += STEP) tryX(x);
                });
              } else {
                // horizontal exit -> out to x -> vertical to corridor g -> across -> vertical entry
                [16, 20, 36, 56].forEach(d => {
                  const x = fp === 'right' ? sx + d : sx - d;
                  const seenG = new Set();
                  const tryG = g => {
                    const q = Math.round(g / 8);
                    if (seenG.has(q)) return;
                    seenG.add(q);
                    if (tp === 'top' ? g > ey - 14 : g < ey + 14) return;
                    if (Math.abs(g - sy) < 10 || Math.abs(ex - x) < 10) return;
                    add([[sx, sy], [x, sy], [x, g], [ex, g], [ex, ey]], 0);
                  };
                  corridorYs.forEach(tryG);
                  const gLo = Math.min(sy, ey) - 64, gHi = Math.max(sy, ey) + 64;
                  for (let g = gLo; g <= gHi; g += STEP) tryG(g);
                });
              }
            }
          }));
          return out;
        };
        // Longest arrows first: they are the most constrained, shorter ones then route around them.
        // Exclude currently obstructed placeholder polylines from `others` so clean edges do not swerve
        // around lines that cut through nodes and are about to be rerouted.
        const edgeClear = {};
        validEdges.forEach(o => {
          const pts = edgePolylines[o.id];
          edgeClear[o.id] = Boolean(pts && polyClear(pts, [o.from, o.to]));
        });
        // Every arrow's segments, filed grown by RELATE_PAD (relate needs two routes within 18px), refiled when rerouted
        const RELATE_PAD = 20;
        const nearBuf = [];   // routeCost's lookup result, reused (routeCost never nests)
        const edgeGrid = makeGrid(rectList.map(([, r]) => r));
        const filed = [];
        const fileEdge = (i, on) => {
          const pts = on ? edgePolylines[validEdges[i].id] : filed[i];
          if (!pts) return;
          const b = segBoxes(pts);
          for (let k = 0; k < b.length; k += 4) {
            (on ? edgeGrid.add : edgeGrid.remove)(i, Math.min(b[k], b[k + 2]) - RELATE_PAD, Math.min(b[k + 1], b[k + 3]) - RELATE_PAD,
              Math.max(b[k], b[k + 2]) + RELATE_PAD, Math.max(b[k + 1], b[k + 3]) + RELATE_PAD);
          }
          filed[i] = on ? pts : undefined;
        };
        validEdges.forEach((o, i) => fileEdge(i, true));
        const manhattan = e => Math.abs(rects[e.from].cx - rects[e.to].cx) + Math.abs(rects[e.from].cy - rects[e.to].cy);
        [...validEdges].sort((a2, b2) => manhattan(b2) - manhattan(a2)).forEach(e => {
          if (e.to === e.from) return;
          const cur = edgePolylines[e.id];
          if (!cur) return;
          const isOther = o => o !== e && Boolean(edgePolylines[o.id]) && edgeClear[o.id];
          // A decision branch that leaves from the top/bottom vertex an incoming arrow already takes gets pushed
          // off the vertex onto the diamond's slanted edge (2b/5a2). That is a cost, not a ban: the branch moves
          // to a free vertex only when that route is clean enough to beat it (a detour that adds a crossing does not).
          const srcIsDecision = nodeMap[e.from] && nodeMap[e.from].type === 'decision';
          const dstIsDecision = nodeMap[e.to] && nodeMap[e.to].type === 'decision';
          const entryVertex = s => srcIsDecision && (s === 'top' || s === 'bottom')
            && (inEdges[e.from] || []).some(o => edgePorts[o.id] && edgePorts[o.id].toPort === s);
          const branchVertex = s => dstIsDecision && (s === 'top' || s === 'bottom' || s === 'right')
            && (outEdges[e.to] || []).some(o => edgePorts[o.id] && edgePorts[o.id].fromPort === s);
          const entryShare = (fp, tp) => (entryVertex(fp) ? COST.entryShare : 0) + (branchVertex(tp) ? COST.entryShare : 0);
          const base = routeCost(cur, e, isOther, edgePorts[e.id].fromPort, edgePorts[e.id].toPort);
          const baseEntryShare = entryShare(edgePorts[e.id].fromPort, edgePorts[e.id].toPort);
          // Already clean (clear of nodes, no overlap/crossing/crowding, on its own vertex): keep it
          if (base !== Infinity && base.defect === 0 && baseEntryShare === 0) return;
          const baseCost = base === Infinity ? Infinity : base.cost + baseEntryShare;
          let best = null;
          // 3-bend corridor routes are only worth searching when the standard route is in real trouble
          const deep = base === Infinity || base.defect + baseEntryShare >= COST.cross;
          altRoutes(rects[e.from], rects[e.to], deep).forEach(c => {
            const r = routeCost(c.pts, e, isOther, c.fp, c.tp, best ? best.cost : baseCost - 250);
            if (r === Infinity) return;
            // Changing sides is a bigger visual change than sliding a channel, so it must earn it
            const sideChange = (c.fp !== edgePorts[e.id].fromPort || c.tp !== edgePorts[e.id].toPort) ? 600 : 0;
            const cost = r.cost + c.dev * 0.3 + sideChange + entryShare(c.fp, c.tp);
            if (!best || cost < best.cost) best = { cost, c };
          });
          // Hysteresis: only switch for a clear win, so near-ties keep the standard route
          if (best && best.cost < baseCost - 250) {
            edgePolylines[e.id] = best.c.pts;
            edgePorts[e.id] = { fromPort: best.c.fp, toPort: best.c.tp };
            edgeClear[e.id] = true;
            validEdges.forEach((o, i) => { if (o.id === e.id) { fileEdge(i, false); fileEdge(i, true); } });
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
              // A decision's outgoing branches each get their own vertex in step 2; incoming fan-in arrows still merge onto one shared arrowhead
              if (role === 'out' && nodeMap[nid] && nodeMap[nid].type === 'decision') return;
              const ends = [];
              touching[nid].forEach(e => {
                const pts = edgePolylines[e.id];
                if (!pts) return;
                const n = pts.length;
                if (role === 'out' && e.from === nid && Math.abs(pts[0][1] - edgeY) < 1 && Math.abs(pts[0][0] - pts[1][0]) < 1)
                  ends.push({ e, a: 0, b: 1, x: pts[0][0], fixed: n < 3, peer: e.to, far: pts[n - 1][0] });
                if (role === 'in' && e.to === nid && Math.abs(pts[n - 1][1] - edgeY) < 1 && Math.abs(pts[n - 1][0] - pts[n - 2][0]) < 1)
                  ends.push({ e, a: n - 1, b: n - 2, x: pts[n - 1][0], fixed: n < 3, peer: e.from, far: pts[0][0] });
              });
              ends.sort((p1, p2) => p1.x - p2.x);
              const clusterGap = role === 'in' ? SPREAD : 10;
              const hasOutOnSide = role === 'in' && touching[nid].some(o => {
                const op = edgePolylines[o.id];
                return op && o.from === nid && Math.abs(op[0][1] - edgeY) < 1 && Math.abs(op[0][0] - op[1][0]) < 1;
              });
              let i = 0;
              while (i < ends.length) {
                let j = i + 1;
                while (j < ends.length && ends[j].x - ends[j - 1].x < clusterGap) j++;
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
                if (role === 'in') {
                  // Fan-in: arrows entering one side of one step share a single trunk (and one arrowhead) and
                  // join where their runs meet it, like a merge on a hand-drawn flowchart. Spreading them 24px
                  // apart drew a doubled line. A straight arrow keeps its line; otherwise centre when the side has no exits.
                  const lo = r.x + 14, hi = r.x + r.w - 14;
                  const cands = fixed.length ? [fixed[0].x]
                    : !hasOutOnSide ? [r.cx, ...cluster.map(c => c.x), base0]
                    : [...cluster.map(c => c.x), base0];
                  const canJoinAt = (jx) => jx >= lo && jx <= hi && movable.every(c => {
                    const pts = edgePolylines[c.e.id];
                    const ids = [c.e.from, c.e.to];
                    return segmentClear(jx, pts[c.a][1], jx, pts[c.b][1], ids)
                      && segmentClear(jx, pts[c.b][1], pts[c.b - 1][0], pts[c.b - 1][1], ids);
                  });
                  const jx = cands.find(canJoinAt);
                  if (jx !== undefined) movable.forEach(c => shiftEnd(c, jx));
                } else if (fixed.length) {
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
            touching[nid].forEach(e => {
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
            if (nodeMap[nid] && nodeMap[nid].type === 'decision') {
              ins.forEach(x => shift(x, insLow ? -SEP : SEP));
            } else {
              ins.forEach(x => shift(x, insLow ? -SHIFT : SHIFT));
              outs.forEach(x => shift(x, insLow ? SHIFT : -SHIFT));
            }
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
            touching[nid].forEach(e => {
              const pts = edgePolylines[e.id];
              if (!pts) return;
              const n = pts.length;
              const add = (role, a, b, peer, far) => {
                const mergeIn = role === 'in';   // fan-in: one trunk per side (5a1)
                const key = role + '|' + (mergeIn ? '*' : peer) + '|' + Math.round(pts[a][0]);
                if (!units.has(key)) units.set(key, { x: pts[a][0], fixed: false, far, ends: [] });
                const u = units.get(key);
                u.ends.push({ pts, a, b });
                // Straight arrows and decision outgoing branches stay at their vertex (never slide onto a slanted side)
                if (n < 3 || (role === 'out' && nodeMap[nid] && nodeMap[nid].type === 'decision')) u.fixed = true;
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

        // 5a4. Arrows into one side of one step that run side by side a few px apart (e.g. a Z-shaped channel
        // beside another arrow's straight leg) are one fan-in: snap the movable run onto the other so they share
        // a single trunk and join, instead of reading as a doubled line. Port-attached first/last legs stay put.
        {
          const NEAR = 18;
          const runs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id], p = edgePorts[e.id];
            if (!pts || pts.length < 3 || !p) return;
            for (let i = 0; i < pts.length - 2; i++) {          // the last leg (into the target) is shared already
              const a = pts[i], b = pts[i + 1];
              const k = Math.abs(a[0] - b[0]) < 1 ? 0 : Math.abs(a[1] - b[1]) < 1 ? 1 : -1;
              if (k < 0) continue;
              runs.push({ e, i, k, pos: a[k], lo: Math.min(a[1 - k], b[1 - k]), hi: Math.max(a[1 - k], b[1 - k]), first: i === 0, to: p.toPort });
            }
          });
          runs.forEach(m => {
            if (m.first) return;                                  // attached to its source: it is the one others join
            const pts = edgePolylines[m.e.id];
            const t = runs.find(o => o.e.to === m.e.to && o.e.id !== m.e.id && o.to === m.to && o.k === m.k &&
              Math.abs(o.pos - m.pos) >= 1 && Math.abs(o.pos - m.pos) < NEAR && Math.min(o.hi, m.hi) - Math.max(o.lo, m.lo) > 24 &&
              (o.first || o.e.id < m.e.id));
            if (!t) return;
            const k = m.k, old = m.pos, ids = [m.e.from, m.e.to];
            pts[m.i][k] = pts[m.i + 1][k] = t.pos;
            // the legs either side must stay clear of other steps and keep their direction
            const legOk = (j) => segmentClear(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], ids);
            const ok = legOk(m.i - 1) && legOk(m.i) && legOk(m.i + 1) &&
              Math.sign(t.pos - pts[m.i - 1][k]) === Math.sign(old - pts[m.i - 1][k]) &&
              Math.sign(pts[m.i + 2][k] - t.pos) === Math.sign(pts[m.i + 2][k] - old);
            if (!ok) pts[m.i][k] = pts[m.i + 1][k] = old;
          });
        }

        // 5a5. Two arrows into one step that leave facing each other along one line (a bottom exit and a top
        // exit of steps stacked in a column, both turning into the same run) read as one straight line between
        // the two sources. Slide the later exit sideways, toward the run it joins, so it meets the other
        // arrow's run at a clear T.
        {
          const SLIDE = 24;
          const ends = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts || pts.length < 3) return;
            [0, 1].forEach(k => {
              if (Math.abs(pts[0][k] - pts[1][k]) < 1 && Math.abs(pts[1][1 - k] - pts[0][1 - k]) > 1) ends.push({ e, pts, k });
            });
          });
          ends.forEach((b, bi) => ends.slice(0, bi).forEach(a => {
            if (a.k !== b.k || a.e.to !== b.e.to || a.e.from === b.e.from) return;
            const k = a.k, m = 1 - k;
            if (Math.abs(a.pts[0][k] - b.pts[0][k]) >= 1) return;
            const da = Math.sign(a.pts[1][m] - a.pts[0][m]), db = Math.sign(b.pts[1][m] - b.pts[0][m]);
            if (da * db >= 0) return;                              // not facing
            const gap = da > 0 ? b.pts[1][m] - a.pts[1][m] : a.pts[1][m] - b.pts[1][m];
            if (gap < 0 || gap > 40 || Math.abs(a.pts[0][m] - b.pts[0][m]) >= 120) return;  // far apart, or overlapping (not this case)
            const dir = Math.sign(b.pts[2][k] - b.pts[1][k]);
            const src = rects[b.e.from], nx = b.pts[0][k] + dir * SLIDE;
            const lo = (k === 0 ? src.x : src.y) + 14, hi = (k === 0 ? src.x + src.w : src.y + src.h) - 14;
            if (!dir || Math.abs(b.pts[2][k] - b.pts[1][k]) < SLIDE + 12 || nx < lo || nx > hi) return;
            b.pts[0][k] = b.pts[1][k] = nx;
          }));
        }

        // 5a6. Fork bends: arrows that leave one point sideways and turn at different x (a Z next to a corridor route)
        // snap to one shared turn, so the fork bends in one place. Skipped when both turn the same way and one is
        // labelled (they would share a trunk and the label could not tell them apart), or when the snap would
        // reverse a leg or cross a step.
        {
          const forks = {};
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (pts && pts.length >= 4 && Math.abs(pts[0][1] - pts[1][1]) < 1 && Math.abs(pts[1][0] - pts[2][0]) < 1 && Math.abs(pts[1][0] - pts[0][0]) > 1) {
              (forks[`${e.from}|${pts[0][0]}|${pts[0][1]}`] = forks[`${e.from}|${pts[0][0]}|${pts[0][1]}`] || []).push(e);
            }
          });
          Object.values(forks).forEach(group => {
            if (group.length < 2) return;
            group.sort((a, b) => edgePolylines[a.id].length - edgePolylines[b.id].length || (a.id < b.id ? -1 : 1));
            const lead = edgePolylines[group[0].id], x = lead[1][0], dirY = Math.sign(lead[2][1] - lead[1][1]);
            group.slice(1).forEach(e => {
              const pts = edgePolylines[e.id], old = pts[1][0];
              if (Math.abs(old - x) < 1) return;
              const sameWay = Math.sign(pts[2][1] - pts[1][1]) === dirY;
              if (sameWay && ((e.label || '').trim() || (group[0].label || '').trim())) return;
              if (Math.sign(x - pts[0][0]) !== Math.sign(old - pts[0][0])) return;
              if (Math.sign(pts[3][0] - x) !== Math.sign(pts[3][0] - old)) return;
              pts[1][0] = pts[2][0] = x;
              if (!polyClear(pts, [e.from, e.to])) pts[1][0] = pts[2][0] = old;
            });
          });
        }

        // 5b. De-overlap: unrelated edges must not share a collinear stretch. Spread interior
        // segments (never the port-attached first/last ones) onto parallel tracks.
        // Edges sharing a source or a target may still merge/fork on purpose.
        const TRACK_GAP = 14;
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
            const k = orient === 'v' ? 0 : 1;
            const applyGap = (gap) => {
              const saved = cl.map(s => [edgePolylines[s.e.id][s.i][k], edgePolylines[s.e.id][s.i + 1][k]]);
              cl.forEach((s, idx) => {
                const shift = (idx - (cl.length - 1) / 2) * gap;
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] += shift;
                pts[s.i + 1][k] += shift;
              });
              if (!cl.every(s => polyClear(edgePolylines[s.e.id], [s.e.from, s.e.to]))) {
                cl.forEach((s, idx) => {
                  const pts = edgePolylines[s.e.id];
                  pts[s.i][k] = saved[idx][0];
                  pts[s.i + 1][k] = saved[idx][1];
                });
                return false;
              }
              return true;
            };
            if (!applyGap(TRACK_GAP)) {
              cl.forEach((s, idx) => {
                const shift = (idx - (cl.length - 1) / 2) * 8;
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] += shift;
                pts[s.i + 1][k] += shift;
              });
            }
          });
        });

        // 5b2. Decision parallel fan spacing: when multiple arrows leave or enter the same side of a
        // decision node and share parallel interior segments within 20px, spread those interior legs
        // apart by 20px (after clearing the vertex stub) so multi-branch fans read cleanly.
        const DECISION_TRACK_GAP = 20;
        ['v', 'h'].forEach(orient => {
          const k = orient === 'v' ? 0 : 1; // fixed axis
          const m = 1 - k;                  // running axis
          const segs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            const p = edgePorts[e.id];
            if (!pts || !p) return;
            const srcDec = nodeMap[e.from] && nodeMap[e.from].type === 'decision';
            const dstDec = nodeMap[e.to] && nodeMap[e.to].type === 'decision';
            if (!srcDec && !dstDec) return;
            for (let i = 1; i < pts.length - 2; i++) {
              const a = pts[i], b = pts[i + 1];
              const isV = Math.abs(a[0] - b[0]) < 1;
              const isH = Math.abs(a[1] - b[1]) < 1;
              if (orient === 'v' ? !isV : !isH) continue;
              segs.push({ e, p, i, pos: a[k], lo: Math.min(a[m], b[m]), hi: Math.max(a[m], b[m]), srcDec, dstDec });
            }
          });
          const sameDecisionSide = (A, B) =>
            (A.srcDec && A.e.from === B.e.from && A.p.fromPort === B.p.fromPort) ||
            (A.dstDec && A.e.to === B.e.to && A.p.toPort === B.p.toPort);
          const parent = segs.map((_, i) => i);
          const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
          for (let a = 0; a < segs.length; a++) {
            for (let b = a + 1; b < segs.length; b++) {
              const A = segs[a], B = segs[b];
              if (A.e.id === B.e.id || !sameDecisionSide(A, B)) continue;
              if (Math.abs(A.pos - B.pos) >= DECISION_TRACK_GAP - 0.5) continue;
              if (Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) <= 2) continue;
              parent[find(a)] = find(b);
            }
          }
          const clusters = {};
          segs.forEach((s, idx) => { (clusters[find(idx)] = clusters[find(idx)] || []).push(s); });
          Object.values(clusters).forEach(cl => {
            if (cl.length < 2) return;
            cl.sort((p, q) => {
              if (Math.abs(p.pos - q.pos) >= 1) return p.pos - q.pos;
              const sharedFrom = p.e.from === q.e.from;
              const nodeP = sharedFrom ? rects[p.e.to] : rects[p.e.from];
              const nodeQ = sharedFrom ? rects[q.e.to] : rects[q.e.from];
              return orient === 'v' ? nodeP.cx - nodeQ.cx : nodeP.cy - nodeQ.cy;
            });
            const meanPos = cl.reduce((sum, s) => sum + s.pos, 0) / cl.length;
            let minBase = -Infinity, maxBase = Infinity;
            cl.forEach((s, idx) => {
              const pts = edgePolylines[s.e.id];
              const off = (idx - (cl.length - 1) / 2) * DECISION_TRACK_GAP;
              const prev = pts[s.i - 1][k], next = pts[s.i + 2][k];
              const old = s.pos;
              const dPrev = Math.sign(old - prev);
              if (dPrev > 0) minBase = Math.max(minBase, prev + 8 - off);
              else if (dPrev < 0) maxBase = Math.min(maxBase, prev - 8 - off);
              const dNext = Math.sign(next - old);
              if (dNext > 0) maxBase = Math.min(maxBase, next - 8 - off);
              else if (dNext < 0) minBase = Math.max(minBase, next + 8 - off);
            });
            const basePos = minBase <= maxBase ? Math.max(minBase, Math.min(maxBase, meanPos)) : meanPos;
            const saved = cl.map(s => [edgePolylines[s.e.id][s.i][k], edgePolylines[s.e.id][s.i + 1][k]]);
            let allValid = true;
            cl.forEach((s, idx) => {
              const pts = edgePolylines[s.e.id];
              const target = basePos + (idx - (cl.length - 1) / 2) * DECISION_TRACK_GAP;
              const prev = pts[s.i - 1][k], next = pts[s.i + 2][k], old = saved[idx][0];
              if ((old !== prev && (Math.sign(target - prev) !== Math.sign(old - prev) || Math.abs(target - prev) < 8)) ||
                  (next !== old && (Math.sign(next - target) !== Math.sign(next - old) || Math.abs(next - target) < 8))) {
                allValid = false;
              }
              pts[s.i][k] = target;
              pts[s.i + 1][k] = target;
            });
            if (!allValid || !cl.every(s => polyClear(edgePolylines[s.e.id], [s.e.from, s.e.to]) && ownBodyClear(edgePolylines[s.e.id], s.e))) {
              cl.forEach((s, idx) => {
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] = saved[idx][0];
                pts[s.i + 1][k] = saved[idx][1];
              });
            }
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
            touching[nid].forEach(o => {
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
            if (!node || !r || !outlineInset) return;
            const vertLeg = Math.abs(pts[a][0] - pts[b][0]) < 1, horizLeg = Math.abs(pts[a][1] - pts[b][1]) < 1;
            let side = null;
            if (vertLeg && Math.abs(pts[a][1] - r.y) < 1) side = 'top';
            else if (vertLeg && Math.abs(pts[a][1] - (r.y + r.h)) < 1) side = 'bottom';
            else if (horizLeg && Math.abs(pts[a][0] - r.x) < 1) side = 'left';
            else if (horizLeg && Math.abs(pts[a][0] - (r.x + r.w)) < 1) side = 'right';
            if (!side) return;
            const ax = (side === 'top' || side === 'bottom') ? 1 : 0;   // the coordinate that moves
            const inset = outlineInset(node, r, side, pts[a][1 - ax]);
            if (inset < 0.5) return;
            const nv = (side === 'top' || side === 'left') ? pts[a][ax] + inset : pts[a][ax] - inset;
            // keep the leg pointing the same way and at least 4px long
            if (Math.abs(pts[b][ax] - nv) >= 4 && Math.sign(pts[b][ax] - nv) === Math.sign(pts[b][ax] - pts[a][ax])) pts[a][ax] = nv;
          };
          snap(e.from, 0, 1);
          snap(e.to, pts.length - 1, pts.length - 2);
        });

        // 5z. A Z with a small jog (out of one side, a short step, into the opposite side) between two steps that nearly line up:
        // one end slides along its own straight edge so the arrow runs level. The end that moves is a plain box, and the other end's
        // height (a diamond's vertex, say) must lie inside it.
        const SLIDES = new Set(['task', 'subprocess', 'document']);
        validEdges.forEach(e => {
          const pts = edgePolylines[e.id];
          if (!pts || pts.length !== 4) return;
          const [a, b, c, d] = pts;
          if (Math.abs(a[1] - b[1]) > 0.5 || Math.abs(b[0] - c[0]) > 0.5 || Math.abs(c[1] - d[1]) > 0.5) return;
          const dy = d[1] - a[1];
          if (Math.abs(dy) < 0.5 || Math.abs(dy) > 28 || Math.abs(d[0] - a[0]) < 30) return;
          const fits = (id, y) => {
            const n = nodeMap[id], r = rects[id];
            if (!n || !r || !SLIDES.has(n.type)) return false;
            const m = n.type === 'document' ? 10 : 6;
            return y > r.y + m && y < r.y + r.h - m;
          };
          if (fits(e.from, d[1])) edgePolylines[e.id] = [[a[0], d[1]], d];
          else if (fits(e.to, a[1])) edgePolylines[e.id] = [a, [d[0], a[1]]];
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
        // Grids in screen coordinates (after 5e): node boxes, the vertical segments, and every arrow's segments
        const nodeGrid = makeGrid(allNodeBoxes);
        allNodeBoxes.forEach((r, k) => nodeGrid.add(k, r.x, r.y, r.x + r.w, r.y + r.h));
        const vertGrid = makeGrid(allNodeBoxes);
        verticalSegments.forEach((v, k) => vertGrid.add(k, v.x, v.yMin, v.x, v.yMax));
        const segGrid = makeGrid(allNodeBoxes);
        const segs = [];   // [validEdges index, start point, end point], filed per arrow in validEdges order
        validEdges.forEach((o, i) => {
          const pts = edgePolylines[o.id];
          if (!pts) return;
          for (let j = 0; j < pts.length - 1; j++) {
            segGrid.add(segs.length, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
            segs.push([i, pts[j], pts[j + 1]]);
          }
        });
        const edgeById = new Map();
        chartData.edges.forEach(ed => { if (!edgeById.has(ed.id)) edgeById.set(ed.id, ed); });   // first match, as find() did

        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const points = edgePolylines[e.id];

          // A hop needs the vertical inside the box of this arrow's points: only those are candidates (in their original order)
          let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
          for (const q of points) { bx1 = Math.min(bx1, q[0]); bx2 = Math.max(bx2, q[0]); by1 = Math.min(by1, q[1]); by2 = Math.max(by2, q[1]); }
          const otherObstacles = vertGrid.near([bx1, by1, bx2, by2], 1).map(k => verticalSegments[k]).filter(obs => {
            if (obs.edgeId === e.id) return false;
            const otherE = edgeById.get(obs.edgeId);
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

          // Lookups for the label search: node boxes, and other arrows' segments, near a box (original order kept)
          const nodesNear = (x1, y1, x2, y2) => nodeGrid.near([x1, y1, x2, y2]).map(k => allNodeBoxes[k]);
          const otherSegsNear = (x1, y1, x2, y2) => segGrid.near([x1, y1, x2, y2])
            .filter(k => validEdges[segs[k][0]].id !== e.id).map(k => segs[k]);

          const labelPos = pickClearLabelPosition(points, p.fromPort, e.label, nodesNear, placedLabels, otherSegsNear, labelMaxW);
          if (e.label && e.label.trim()) {
            // Reserve the box the label is drawn in: one line is estimated generously; a wrapped label is as wide
            // as its wrap width and as tall as its lines (a 28px box let the next label sit on its second line)
            const lw = labelPos.wrapped ? labelPos.w : Math.max(48, e.label.length * FONT_M.edgeLabel + 20);
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

      const ARROWHEAD_LEN = 10;   // the open-chevron arrowhead's length in px (stage.html)

      // nodesNear(x1, y1, x2, y2): node boxes that may touch that box, in the router's node order.
      // otherSegsNear(x1, y1, x2, y2): other arrows' segments [_, start, end] that may touch it, in arrow then segment order.
      // Both may return extra items (every test below is exact); they keep the search off a scan of the whole diagram.
      function pickClearLabelPosition(points, fromPort, labelText, nodesNear, placedLabels, otherSegsNear, labelMaxW) {
        const FONT_M = TOKENS.font.metrics;
        const candidates = [];

        if (points.length === 2) {
          // Centred on the part of the line the arrowhead leaves free, plus staggered spots if a neighbour label sits at mid
          const [a, b] = points, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const free = Math.max(0, len - ARROWHEAD_LEN);
          for (const frac of [0.5, 0.25, 0.78]) {
            const t = (free * frac) / len;
            candidates.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
          }
        } else if (points.length === 3) {
          const p0 = points[0], p1 = points[1], p2 = points[2];
          const seg1Len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
          const free1 = Math.max(0, seg1Len - ARROWHEAD_LEN);
          const seg1Cand = { x: p1[0] + (p2[0] - p1[0]) * (free1 * 0.5 / seg1Len), y: p1[1] + (p2[1] - p1[1]) * (free1 * 0.5 / seg1Len) };
          if (fromPort === 'top' || fromPort === 'bottom') {
            const sign = p1[1] > p0[1] ? 1 : -1;
            const distY = Math.abs(p1[1] - p0[1]);
            candidates.push({
              x: p0[0],
              y: p0[1] + sign * Math.min(34, distY * 0.45)
            });
            candidates.push(seg1Cand);
          } else {
            candidates.push({
              x: (p0[0] + p1[0]) / 2,
              y: p0[1]
            });
            // The second leg too: a short first leg (an arrow into a connector beside its step) has no room
            candidates.push(seg1Cand);
          }
          if (free1 >= 36) {
            for (const frac of [0.24, 0.78]) {
              const t1 = (free1 * frac) / seg1Len;
              candidates.push({ x: p1[0] + (p2[0] - p1[0]) * t1, y: p1[1] + (p2[1] - p1[1]) * t1 });
            }
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
          const seg2Len = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) || 1;
          const t2 = points.length === 4 ? Math.max(0, seg2Len - ARROWHEAD_LEN) * 0.5 / seg2Len : 0.5;
          candidates.push({ x: p2[0] + (p3[0] - p2[0]) * t2, y: p2[1] + (p3[1] - p2[1]) * t2 });
          if (points.length >= 5) {
            const p4 = points[4];
            const seg3Len = Math.hypot(p4[0] - p3[0], p4[1] - p3[1]) || 1;
            const t3 = points.length === 5 ? Math.max(0, seg3Len - ARROWHEAD_LEN) * 0.5 / seg3Len : 0.5;
            candidates.push({ x: p3[0] + (p4[0] - p3[0]) * t3, y: p3[1] + (p4[1] - p3[1]) * t3 });
          }
        }

        // Fallback spots along every long segment, tried after the preferred ones above (middle outwards,
        // 22px clear of corners and clear of the arrowhead on the final leg). Without them a label whose
        // preferred spot sits on a crossing, junction, or node box had nowhere else to go.
        for (let i = 0; i < points.length - 1; i++) {
          const p = points[i], q = points[i + 1];
          const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
          const isLast = i === points.length - 2;
          const endClear = isLast ? Math.max(22, ARROWHEAD_LEN + 8) : 22;
          if (len >= 56) {
            for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
              if (len * t < 22 || len * (1 - t) < endClear) continue;
              candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
            }
          } else if (len >= 34) {
            const t = isLast ? Math.max(0.15, (len - ARROWHEAD_LEN) / 2 / len) : 0.5;
            candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
          }
        }

        // Stretches of this arrow that another arrow runs along (collinear overlap): a label there could
        // belong to either arrow, so it must sit on a part of its own line that only it occupies.
        const sharedStretches = [];
        for (let i = 0; i < points.length - 1; i++) {
          const p = points[i], q = points[i + 1];
          const isV = Math.abs(p[0] - q[0]) < 1, isH = Math.abs(p[1] - q[1]) < 1;
          if (!isV && !isH) continue;
          const k = isV ? 0 : 1, m = 1 - k;                       // k: fixed axis, m: running axis
          const lo = Math.min(p[m], q[m]), hi = Math.max(p[m], q[m]);
          const near = otherSegsNear(Math.min(p[0], q[0]) - 3, Math.min(p[1], q[1]) - 3, Math.max(p[0], q[0]) + 3, Math.max(p[1], q[1]) + 3);
          for (const [, c, d] of near) {
            if (Math.abs(c[k] - d[k]) >= 1 || Math.abs(c[k] - p[k]) >= 2) continue;
            const a0 = Math.max(lo, Math.min(c[m], d[m])), a1 = Math.min(hi, Math.max(c[m], d[m]));
            if (a1 - a0 > 2) sharedStretches.push(isV ? { x: p[0], y: a0, w: 0, h: a1 - a0 } : { x: a0, y: p[1], w: a1 - a0, h: 0 });
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

        // Where every long stretch is shared, a short leg only this arrow uses (about a label tall) is the one
        // place the label belongs to it alone: try its middle, touching the node box (a diamond tip sits inside its box).
        if (sharedStretches.length) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
            if (len >= 26 && len < 56) candidates.push({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, pad: -2 });
          }
        }

        const textLen = labelText ? labelText.trim().length : 0;
        const singleLineWidth = Math.max(40, textLen * FONT_M.edgeWrap + 18);
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
        const wrapAt = Math.min(horizClearance || Infinity, labelMaxW);
        if (singleLineWidth > wrapAt) {
          // Never narrower than the longest word, so words are not split mid-word
          const longestWord = Math.max(0, ...String(labelText || '').trim().split(/\s+/).map(w => w.length));
          const minWordW = Math.max(40, longestWord * FONT_M.label + 20);
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

        // Keep labels clear of the arrowhead tip on the final segment (works in all 4 directions).
        let arrowBox = null;
        if (points.length >= 2) {
          const tip = points[points.length - 1], prev = points[points.length - 2];
          const dx = tip[0] - prev[0], dy = tip[1] - prev[1], segLen = Math.hypot(dx, dy);
          if (segLen > 1) {
            const depth = Math.min(segLen, ARROWHEAD_LEN + 6);
            const ex = tip[0] - (dx / segLen) * depth, ey = tip[1] - (dy / segLen) * depth;
            arrowBox = { x: Math.min(tip[0], ex), y: Math.min(tip[1], ey), w: Math.abs(tip[0] - ex), h: Math.abs(tip[1] - ey) };
          }
        }

        // The first spot that touches nothing wins. When every spot touches something, take the least bad one
        // (a node or another label is far worse than sitting on another arrow) instead of the first.
        let fallback = null;
        for (const cand of candidates) {
          const bx = cand.x - lw / 2;
          const by = cand.y - lh / 2;
          let penalty = 0;

          if (arrowBox && BoxOverlap(bx, by, lw, lh, arrowBox.x, arrowBox.y, arrowBox.w, arrowBox.h, 4)) {
            penalty += 900;
          }
          const hardPad = cand.pad !== undefined ? Math.min(0, cand.pad) : 0;
          const softPad = cand.pad ?? 8;
          // pads reach 8px at most: anything further from the label box adds nothing
          for (const nb of nodesNear(bx - 9, by - 9, bx + lw + 9, by + lh + 9)) {
            if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, hardPad)) {
              const ox = Math.min(bx + lw, nb.x + nb.w + hardPad) - Math.max(bx, nb.x - hardPad);
              const oy = Math.min(by + lh, nb.y + nb.h + hardPad) - Math.max(by, nb.y - hardPad);
              penalty += 4000 + Math.max(0, Math.min(ox, oy)) * 20;
            } else if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, softPad)) {
              penalty += 200;
            }
          }
          for (const pl of placedLabels) {
            if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 0)) {
              const ox = Math.min(bx + lw, pl.x + pl.w) - Math.max(bx, pl.x);
              const oy = Math.min(by + lh, pl.y + pl.h) - Math.max(by, pl.y);
              penalty += 4000 + Math.max(0, Math.min(ox, oy)) * 20;
            } else if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 6)) {
              penalty += 200;
            }
          }
          for (const [, c, d] of otherSegsNear(bx - 7, by - 7, bx + lw + 7, by + lh + 7)) {
            const sx = Math.min(c[0], d[0]);
            const sy = Math.min(c[1], d[1]);
            const sw = Math.abs(d[0] - c[0]);
            const sh = Math.abs(d[1] - c[1]);
            if (BoxOverlap(bx, by, lw, lh, sx, sy, sw, sh, 6)) penalty += 10;
          }
          for (const st of sharedStretches) {
            if (BoxOverlap(bx, by, lw, lh, st.x, st.y, st.w, st.h, 2)) { penalty += 600; break; }
          }
          if (penalty === 0) return { x: cand.x, y: cand.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
          if (!fallback || penalty < fallback.penalty) fallback = { cand, penalty };
        }

        // The size checked here comes back with the spot, so the caller reserves the box the label really takes
        // (a wrapped label is narrower but taller than one line)
        const spot = fallback ? fallback.cand : (candidates[0] || { x: points[0][0], y: points[0][1] });
        return { x: spot.x, y: spot.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
      }
