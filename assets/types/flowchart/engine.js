      // --- LAYOUT ENGINE ---
      // JavaScript port of scripts/layout_engine.py (ranking, ordering, compact-step search, scoring).
      // Keep both copies in sync: scripts/check_tidy_parity.py compares their output node by node.
      // The engine always works in flow terms: x runs along the flow (rank by rank) and y runs across the lanes.
      // In a left-to-right diagram that is the screen's x and y. In a top-to-bottom one ("direction": "TB") the
      // renderer draws x downwards and y rightwards, so the same engine lays out a vertical diagram; only the
      // sizes differ, because nodes are wide and short: along the flow a node takes its screen height, across
      // the lane its screen width. NODE_W/NODE_H/DEC_H are a node's extent along/across the flow.
      const LE_PROFILES = {
        LR: {
          COL_WIDTH: 200, TIGHT_STEP: 144, START_X: 56, ROW_HEIGHT: 104,
          NODE_W: 144, MIN_GAP: 32, LABEL_MAX_W: 140, LABEL_STUB: 16, NODE_H: 64, DEC_H: 80, LANE_MIN: 176, TOP_PAD: 36, BOTTOM_PAD: 36, NEAR_MIN: 24, LOOP_ROOM: 72, LOOP_STEP: 16,
          LABEL_ACROSS: false
        },
        TB: {
          COL_WIDTH: 136, TIGHT_STEP: 80, START_X: 56, ROW_HEIGHT: 184,
          NODE_W: 80, MIN_GAP: 32, LABEL_MAX_W: 140, LABEL_STUB: 16, NODE_H: 144, DEC_H: 144, LANE_MIN: 240, TOP_PAD: 32, BOTTOM_PAD: 32, NEAR_MIN: 24, LOOP_ROOM: 72, LOOP_STEP: 16,
          LABEL_ACROSS: true   // an arrow label sits across a vertical arrow, so it needs its height, not its width, of room
        }
      };
      const LE = Object.assign({}, LE_PROFILES.LR);

      // Which side of its lane a same-lane loop-back runs on (a loop-back: an arrow between two nodes of one lane
      // that runs back against the flow). Normally the far side: below the nodes, right of them top-to-bottom.
      // It runs on the near side instead when its source or target already sends an arrow into a farther lane and
      // neither sends one into a nearer lane: that arrow (e.g. a decision's "Yes" down into the next lane) takes
      // the node's far vertex, and a loop leaving there would run along it. The layout (room reserved per side),
      // the renderer's lane sizing and its router all use this one rule, so the room is where the loop is drawn.
      // Returns side(edge) -> 'far' | 'near'.
      function loopSides(nodes, edges, lanes) {
        const li = {}, laneOf = {}, far = {}, near = {};
        lanes.forEach((l, i) => { li[l.id] = i; });
        nodes.forEach(n => { laneOf[n.id] = li[n.laneId]; });
        edges.forEach(e => {
          const a = laneOf[e.from], b = laneOf[e.to];
          if (a === undefined || b === undefined) return;
          if (b > a) far[e.from] = true;
          if (b < a) near[e.from] = true;
        });
        return (e) => ((far[e.from] || far[e.to]) && !(near[e.from] || near[e.to]) ? 'near' : 'far');
      }

      // Room a lane keeps clear on each side for its loop-backs ({ far, near }, 0 where it has none). Loops on one
      // side nest one channel further out per overlapping loop. Shared by the engine and the renderer's lane sizing;
      // xOf gives a node's position along the flow.
      function laneLoopRooms(nodes, edges, lanes, laneId, xOf) {
        const lane = {};
        nodes.forEach(n => { if (n.laneId === laneId) lane[n.id] = true; });
        const side = loopSides(nodes, edges, lanes);
        const spans = { far: [], near: [] };
        edges.forEach(e => {
          if (!lane[e.from] || !lane[e.to] || e.from === e.to) return;
          const a = xOf(e.from), b = xOf(e.to);
          if (b < a - 1) spans[side(e)].push([b, a]);
        });
        const room = (list) => {
          const depth = list.reduce((d, [p0]) => Math.max(d, list.filter(([p, q]) => p <= p0 && p0 <= q).length), 0);
          return depth ? LE.LOOP_ROOM + (depth - 1) * LE.LOOP_STEP : 0;
        };
        return { far: room(spans.far), near: room(spans.near) };
      }
      // Switch LE to the profile for `data.direction` (anything but "TB" is left-to-right)
      function useDirection(data) {
        Object.assign(LE, LE_PROFILES[data && data.direction === 'TB' ? 'TB' : 'LR']);
      }
      // Python-style rounding (half to even) so scores tie-break identically in both engines
      const pyRound = (x) => {
        const f = Math.floor(x), d = x - f;
        if (d < 0.5) return f;
        if (d > 0.5) return f + 1;
        return f % 2 === 0 ? f : f + 1;
      };

      // `room` (optional, from placeConnectors' fallback): { after: {id: px}, before: {id: px} }, the gap a step needs
      // after / before itself along the flow, so a connector fits there. It widens that one column step only.
      function runLayoutEngine(lanes, nodes, edges, room) {
        if (!nodes.length) return;
        const KEY = (a, b) => a + '\u0001' + b;
        const laneIdx = {};
        lanes.forEach((l, i) => { laneIdx[l.id] = i; });
        const nodeMap = {};
        nodes.forEach(n => { nodeMap[n.id] = n; });
        const nodeH = (n) => (n.type === 'decision' ? LE.DEC_H : LE.NODE_H);

        // 1. Back edges: feedback-flagged edges plus DFS-detected loops
        const forced = new Set(edges.filter(e => e.feedback).map(e => KEY(e.from, e.to)));
        const searchAdj = {};
        nodes.forEach(n => { searchAdj[n.id] = []; });
        edges.forEach(e => { if (!forced.has(KEY(e.from, e.to)) && searchAdj[e.from]) searchAdj[e.from].push(e.to); });
        const back = new Set(forced);
        const color = {};
        nodes.forEach(n => { color[n.id] = 0; });
        const dfs = (u) => {
          color[u] = 1;
          (searchAdj[u] || []).forEach(v => {
            if (!(v in color)) return;
            if (color[v] === 1) back.add(KEY(u, v));
            else if (color[v] === 0) dfs(v);
          });
          color[u] = 2;
        };
        nodes.forEach(n => { if (color[n.id] === 0) dfs(n.id); });
        let forwardEdges = edges.filter(e => !back.has(KEY(e.from, e.to)) && nodeMap[e.from] && nodeMap[e.to]);

        const revAdj = {};
        edges.forEach(e => { (revAdj[e.to] = revAdj[e.to] || []).push(e.from); });

        // Longest-path ranks; edges in `zero` span 0 columns
        const ranksWithZero = (zero) => {
          const adj = {}, indeg = {}, ranks = {};
          nodes.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; ranks[n.id] = 0; });
          forwardEdges.forEach(e => { adj[e.from].push(e.to); indeg[e.to] = (indeg[e.to] || 0) + 1; });
          const queue = nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
          if (!queue.length) queue.push(nodes[0].id);
          const seen = new Set();
          while (queue.length) {
            const cur = queue.shift();
            seen.add(cur);
            (adj[cur] || []).forEach(nxt => {
              const step = zero.has(KEY(cur, nxt)) ? 0 : 1;
              ranks[nxt] = Math.max(ranks[nxt], ranks[cur] + step);
              indeg[nxt] -= 1;
              if (indeg[nxt] <= 0 && !seen.has(nxt)) queue.push(nxt);
            });
          }
          nodes.forEach(n => { if (!seen.has(n.id)) ranks[n.id] = 0; });
          return ranks;
        };

        // Loop-closing arrows: if u -> v only pushes v (and everything after it) further right, and v
        // already loops back to u through a back edge, then u -> v is the arrow that closes the loop.
        // Treat it as a back edge too, so adding it does not rearrange the whole diagram.
        {
          const ranks0 = ranksWithZero(new Set());
          const backOut = {};
          back.forEach(k => { const [a, b] = k.split(''); (backOut[a] = backOut[a] || []).push(b); });
          const reaches = (from, to, fwd) => {
            const adj = {};
            fwd.forEach(x => { (adj[x.from] = adj[x.from] || []).push(x.to); });
            const seenR = new Set([from]), stack = [from];
            while (stack.length) {
              const c = stack.pop();
              if (c === to) return true;
              (adj[c] || []).forEach(n => { if (!seenR.has(n)) { seenR.add(n); stack.push(n); } });
            }
            return false;
          };
          forwardEdges.slice().forEach(e => {
            const bo = backOut[e.to];
            if (!bo) return;
            const others = forwardEdges.filter(x => x !== e && x.to === e.to);
            if (!others.length) return;
            const without = Math.max(...others.map(x => ranks0[x.from] + 1));
            if (ranks0[e.from] + 1 <= without) return;
            const rest = forwardEdges.filter(x => x !== e);
            if (!bo.some(w => w === e.from || reaches(w, e.from, rest))) return;
            back.add(KEY(e.from, e.to));
            forwardEdges = rest;
          });
        }

        // Horizontal room each labelled edge needs: label width (capped, then wrapped) plus arrow stubs
        const labelGap = {};
        edges.forEach(e => {
          const t = String(e.label || '').trim();
          if (!t) return;
          const longest = Math.max(...t.split(/\s+/).map(w => w.length));
          // Wraps at LABEL_MAX_W, but a single long word cannot wrap, so it sets the floor
          const w = Math.max(longest * 7.4 + 20, Math.min(t.length * 6.6 + 18, LE.LABEL_MAX_W));
          // Top-to-bottom: the label wraps at LABEL_MAX_W and sits on the vertical arrow, so it needs its height
          const lines = Math.ceil((t.length * 6.6 + 18) / LE.LABEL_MAX_W);
          labelGap[KEY(e.from, e.to)] = (LE.LABEL_ACROSS ? 8 + 17 * Math.min(lines, 3) : w) + 2 * LE.LABEL_STUB;
        });

        // Horizontal step an arrow needs: normal = column width, zero = 0, tight = node width; a labelled
        // arrow also needs room for its label between the two nodes (vertical arrows, step 0, do not)
        const stepOf = (k, zero, tight) => {
          let step = zero.has(k) ? 0 : (tight.has(k) ? LE.TIGHT_STEP : LE.COL_WIDTH);
          if (step > 0 && labelGap[k]) step = Math.max(step, LE.NODE_W + labelGap[k]);
          if (step > 0 && room) {
            const [a, b] = k.split('\u0001');
            step = Math.max(step, LE.NODE_W + (room.after[a] || 0), LE.NODE_W + (room.before[b] || 0));
          }
          return step;
        };

        // Longest-path x offsets (optionally no less than a per-node floor)
        const xPositions = (zero, tight, floor = {}) => {
          const adj = {}, indeg = {}, xs = {};
          nodes.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; xs[n.id] = floor[n.id] || 0; });
          forwardEdges.forEach(e => { adj[e.from].push(e.to); indeg[e.to] = (indeg[e.to] || 0) + 1; });
          const queue = nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
          const seen = new Set();
          while (queue.length) {
            const cur = queue.shift();
            seen.add(cur);
            (adj[cur] || []).forEach(nxt => {
              xs[nxt] = Math.max(xs[nxt], xs[cur] + stepOf(KEY(cur, nxt), zero, tight));
              indeg[nxt] -= 1;
              if (indeg[nxt] <= 0 && !seen.has(nxt)) queue.push(nxt);
            });
          }
          return xs;
        };

        const barycenter = (id, ranks) => {
          const preds = revAdj[id] || [];
          if (!preds.length) return 0;
          let sum = 0, cnt = 0;
          preds.forEach(p => {
            if (!nodeMap[p]) return;
            sum += (laneIdx[nodeMap[p].laneId] || 0) * 100 + (ranks[p] || 0);
            cnt += 1;
          });
          return sum / preds.length;
        };

        // Mean lane index the node's arrows (forward and loop-backs) lead to; its own lane when it has none
        const outLanes = {};
        edges.forEach(e => {
          if (nodeMap[e.from] && nodeMap[e.to] && e.from !== e.to) (outLanes[e.from] = outLanes[e.from] || []).push(laneIdx[nodeMap[e.to].laneId] || 0);
        });
        const successorPull = (id, laneId) => {
          const ls = outLanes[id];
          return ls ? ls.reduce((s, l) => s + l, 0) / ls.length : (laneIdx[laneId] || 0);
        };

        // Steps 3-6: order inside lanes, lane heights, x/y, nudge-to-align
        const placeNodes = (ranks, xs, zero, tight) => {
          const groups = new Map();
          nodes.forEach(n => {
            const r = ranks[n.id] || 0;
            const k = KEY(n.laneId, r);
            if (!groups.has(k)) groups.set(k, { laneId: n.laneId, r, list: [] });
            groups.get(k).list.push(n);
          });
          groups.forEach(g => {
            if (g.list.length > 1) {
              const bc = new Map(g.list.map(n => [n.id, barycenter(n.id, ranks)]));
              // Ties (typically branches of one decision) go by where each node's arrows lead: a node whose
              // successors sit in lanes above (or that has none) takes the upper row, one heading to a lane below
              // the lower row, so its arrow leaves toward its target instead of wrapping around its sibling
              const pl = new Map(g.list.map(n => [n.id, successorPull(n.id, g.laneId)]));
              g.list.sort((a, b) => (Math.abs(bc.get(a.id) - bc.get(b.id)) > 1e-9
                ? bc.get(a.id) - bc.get(b.id) : pl.get(a.id) - pl.get(b.id)));
            }
          });
          const X = {};
          nodes.forEach(n => { X[n.id] = LE.START_X + (xs ? xs[n.id] : (ranks[n.id] || 0) * LE.COL_WIDTH); });
          const sub = {};
          groups.forEach(g => g.list.forEach((n, i) => { sub[n.id] = i; }));

          // One row per lane unless the lane holds a branch. Nodes sharing a column are stacked only when they are
          // branches of the same parent (a fork reads as one); any other node moves right into a free row-0 slot,
          // within its slack only (before its successors' required x), so nothing downstream moves. It may move at
          // most 1.5 columns (an end node, with nothing downstream, may go further) and never onto a straight same-lane arrow or a vertical arrow crossing the lane.
          const fwdOut = {}, fwdIn = {};
          forwardEdges.forEach(e => {
            (fwdOut[e.from] = fwdOut[e.from] || []).push(e.to);
            (fwdIn[e.to] = fwdIn[e.to] || []).push(e.from);
          });
          const siblings = (a, b) => (fwdIn[a.id] || []).some(p => (fwdIn[b.id] || []).includes(p));
          const clear = (xa, xb) => Math.abs(xa - xb) >= LE.NODE_W + LE.MIN_GAP;
          const lastX = Math.max(...nodes.map(n => X[n.id]));
          groups.forEach(g => {
            if (g.list.length < 2) return;
            let next = 1;
            g.list.slice(1).forEach(n => {
              if (!g.list.some(m => m !== n && siblings(m, n))) {
                const succ = fwdOut[n.id] || [];
                const maxX = succ.length
                  ? Math.min(...succ.map(v => X[v] - stepOf(KEY(n.id, v), zero, tight)))
                  : lastX;
                const row0 = nodes.filter(m => m !== n && m.laneId === n.laneId && sub[m.id] === 0);
                const slots = [X[n.id], ...row0.map(m => X[m.id] + LE.COL_WIDTH)]
                  .filter(x => x >= X[n.id] && x <= maxX).sort((a, b) => a - b);
                const li = laneIdx[n.laneId];
                const blocked = (x) => forwardEdges.some(e => {
                  const u = nodeMap[e.from], v = nodeMap[e.to];
                  if (!u || !v || u === n || v === n) return false;
                  if (u.laneId === n.laneId && v.laneId === n.laneId && sub[u.id] === 0 && sub[v.id] === 0) {
                    return x + LE.NODE_W > X[u.id] + LE.NODE_W && x < X[v.id];   // sits on a same-lane arrow
                  }
                  const lu = laneIdx[u.laneId], lv = laneIdx[v.laneId];
                  const cx = X[u.id] + LE.NODE_W / 2;
                  return Math.abs(X[u.id] - X[v.id]) < 1 && Math.min(lu, lv) < li && li < Math.max(lu, lv)
                    && x - 12 < cx && cx < x + LE.NODE_W + 12;                         // sits on a vertical pass-through
                });
                const slot = slots.find(x => (!succ.length || x - X[n.id] <= 1.5 * LE.COL_WIDTH)
                  && row0.every(m => clear(x, X[m.id])) && !blocked(x));
                if (slot !== undefined) { X[n.id] = slot; sub[n.id] = 0; return; }
              }
              sub[n.id] = next++;
            });
          });
          const subrows = {};
          lanes.forEach(l => { subrows[l.id] = 1; });
          nodes.forEach(n => { subrows[n.laneId] = Math.max(subrows[n.laneId] || 1, sub[n.id] + 1); });

          // Every lane is the same size (LANE_MIN) unless it stacks branches across it, with its nodes centred. LANE_MIN
          // leaves room on both sides of a node for the loop-backs and corridor routes that run around the nodes,
          // including on the diagram's outer edge, where there is no neighbouring lane to borrow room from.
          // Same-lane loop-backs run around the nodes on one side of the lane (see loopSides: normally the far side,
          // below them; right of them top-to-bottom), nested one channel further out per overlapping loop, with their
          // labels on the channel. A single-row lane with loops keeps that room (LOOP_ROOM, + LOOP_STEP per extra
          // nesting level) clear on each side that has loops and moves its nodes toward the other side instead of
          // centring them, growing only if that is not enough.
          const loopRooms = id => laneLoopRooms(nodes, edges, lanes, id, nid => X[nid]);

          const lanePos = {};
          let curY = 0;
          lanes.forEach(l => {
            let maxH = LE.NODE_H;
            const inLane = nodes.filter(n => n.laneId === l.id);
            if (inLane.length) maxH = Math.max(...inLane.map(nodeH));
            const rows = subrows[l.id] || 1;
            // In LR mode with visible swimlanes, the pinned .lane-pill sits at y=12..54px; reserve 56px top pad on multi-row lanes so row-0 nodes never collide with the pill when panned
            const topPad = (rows > 1 && !LE.LABEL_ACROSS && lanes.length > 1) ? 56 : LE.TOP_PAD;
            const rooms = loopRooms(l.id);
            const req = rows === 1 && (rooms.far || rooms.near)
              ? (rooms.near || LE.NEAR_MIN) + maxH + (rooms.far || LE.NEAR_MIN)
              : topPad + (rows - 1) * LE.ROW_HEIGHT + maxH + LE.BOTTOM_PAD;
            const inner = Math.max(LE.LANE_MIN, req);
            l.height = inner;
            lanePos[l.id] = { top: curY, h: l.height, inner, maxH, topPad, rooms };
            curY += l.height;
          });

          nodes.forEach(n => {
            const lp = lanePos[n.laneId] || { top: 0, h: LE.LANE_MIN, topPad: LE.TOP_PAD };
            n.x = X[n.id];
            if ((subrows[n.laneId] || 1) === 1) {
              const inner = lp.inner || lp.h;
              const { far, near } = lp.rooms || { far: 0, near: 0 };
              // Centred, or pushed away from each side with loops just enough to leave them their room
              const centre = Math.floor((inner - nodeH(n)) / 8) * 4;
              if (!far && !near) n.y = centre;
              else {
                let blockTop = Math.floor((inner - lp.maxH) / 8) * 4;
                if (far) blockTop = Math.min(blockTop, Math.floor((inner - far - lp.maxH) / 4) * 4);
                if (near) blockTop = Math.max(blockTop, Math.ceil(near / 4) * 4);
                n.y = Math.max(LE.NEAR_MIN, blockTop + Math.floor((lp.maxH - nodeH(n)) / 8) * 4);
              }
            } else {
              n.y = (lp.topPad || LE.TOP_PAD) + sub[n.id] * LE.ROW_HEIGHT;
            }
          });

          // Nudge (<= 35px) so same-lane forward neighbours form a straight horizontal line
          edges.forEach(e => {
            const u = nodeMap[e.from], v = nodeMap[e.to];
            if (!u || !v || u.laneId !== v.laneId || v.x <= u.x) return;
            const lp = lanePos[u.laneId] || { top: 0, h: LE.LANE_MIN, topPad: LE.TOP_PAD };
            const minTop = (lp.topPad || LE.TOP_PAD) > 36 ? 48 : 20;
            const uh = nodeH(u), vh = nodeH(v);
            const uCy = u.y + uh / 2, vCy = v.y + vh / 2;
            const delta = uCy - vCy;
            if (Math.abs(delta) > 0 && Math.abs(delta) <= 35) {
              const targetY = Math.trunc(pyRound((uCy - vh / 2) / 4) * 4);
              if (targetY >= minTop && targetY + vh <= lp.h - 20) {
                const sibs = nodes.filter(s => s !== v && s.laneId === v.laneId && !clear(s.x, v.x));
                const collides = sibs.some(s => Math.max(targetY, s.y) < Math.min(targetY + vh, s.y + nodeH(s)) + 12);
                if (!collides) v.y = targetY;
              }
            }
          });
        };

        // --- Scoring (mirrors verify_collisions + _route_all_edges) ---
        const routeAll = (rects) => {
          const outEdges = new Map();
          edges.forEach(e => {
            if (rects[e.from] && rects[e.to]) {
              if (!outEdges.has(e.from)) outEdges.set(e.from, []);
              outEdges.get(e.from).push(e);
            }
          });
          const R = (id) => { const r = rects[id]; return { x: r[0], y: r[1], w: r[2], h: r[3] }; };
          const hasLeftLoop = new Set();
          edges.forEach(e => {
            if (!rects[e.from] || !rects[e.to]) return;
            const f = R(e.from), t = R(e.to);
            if (t.x + t.w / 2 < f.x + f.w / 2 - 30 && Math.abs((t.y + t.h / 2) - (f.y + f.h / 2)) > 30) hasLeftLoop.add(e.from);
          });

          const ports = {};
          const vertEntry = new Set();
          const loopSide = loopSides(nodes, edges, lanes);
          outEdges.forEach((uOuts, uId) => {
            const f = R(uId);
            const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
            const uNode = nodeMap[uId];
            const fwdOuts = [];
            uOuts.forEach(e => {
              const t = R(e.to);
              const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
              if (tcx < fcx - 30) {
                if (tcy > fcy + 30) ports[e.id] = ['left', 'top'];
                else if (tcy < fcy - 30) ports[e.id] = ['left', 'bottom'];
                else ports[e.id] = loopSide(e) === 'near' ? ['top', 'top'] : ['bottom', 'bottom'];   // U-turn on the loop's side
              } else {
                fwdOuts.push(e);
              }
            });
            let topTaken = false, bottomTaken = false;
            const cyOf = (e) => { const t = R(e.to); return t.y + t.h / 2; };
            const cxOf = (e) => { const t = R(e.to); return t.x + t.w / 2; };
            const upC = fwdOuts.filter(e => cyOf(e) < fcy - 30);
            const downC = fwdOuts.filter(e => cyOf(e) > fcy + 30);
            upC.sort((a, b) => R(a.to).y - R(b.to).y);
            downC.sort((a, b) => R(b.to).y - R(a.to).y);
            const al = (e) => (Math.abs(cxOf(e) - fcx) < 30 ? 0 : 1);
            upC.sort((a, b) => al(a) - al(b));
            downC.sort((a, b) => al(a) - al(b));
            const multi = uNode.type === 'decision' || fwdOuts.length > 1;
            let topId = (multi && upC.length) ? upC[0].id : null;
            let botId = (multi && downC.length) ? downC[0].id : null;
            if (!topId && upC.length && Math.abs(cxOf(upC[0]) - fcx) < 30) topId = upC[0].id;
            if (!botId && downC.length && Math.abs(cxOf(downC[0]) - fcx) < 30) botId = downC[0].id;
            fwdOuts.forEach(e => {
              const t = R(e.to);
              const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
              let fromPort = 'right';
              if (e.id === topId && !topTaken) { fromPort = 'top'; topTaken = true; }
              else if (e.id === botId && !bottomTaken) { fromPort = 'bottom'; bottomTaken = true; }
              let toPort = 'left';
              if (hasLeftLoop.has(e.to)) {
                toPort = tcy < fcy ? 'bottom' : 'top';
              } else if (fromPort === 'right' && fwdOuts.length === 1 && uNode.type !== 'decision'
                  && Math.abs(tcy - fcy) > 30 && (Math.abs(tcx - fcx) < 30 || t.x > fcx + 40)) {
                fromPort = tcy > fcy ? 'bottom' : 'top';
              }
              const vk = e.to + '\u0001' + (tcy > fcy);
              if ((fromPort === 'top' || fromPort === 'bottom') && Math.abs((t.x + t.w / 2) - fcx) < 30) {
                toPort = tcy > fcy ? 'top' : 'bottom';
              } else if (fromPort === 'right' && toPort === 'left' && Math.abs(tcy - fcy) > 30
                  && t.x + t.w / 2 > f.x + f.w + 24 && !vertEntry.has(vk)) {
                const miny = Math.min(fcy, tcy), maxy = Math.max(fcy, tcy);
                let blocked = false;
                for (let k = 0; k < nodes.length; k++) {
                  const o = nodes[k];
                  if (o.id === e.from || o.id === e.to || !rects[o.id]) continue;
                  const or = R(o.id);
                  if (or.x - 3 <= tcx && tcx <= or.x + or.w + 3 && or.y < maxy && or.y + or.h > miny) {
                    blocked = true;
                    break;
                  }
                }
                if (!blocked) {
                  toPort = tcy > fcy ? 'top' : 'bottom';
                  vertEntry.add(vk);
                }
              }
              ports[e.id] = [fromPort, toPort];
            });
          });

          const result = {};
          edges.forEach(e => {
            const p = ports[e.id];
            if (!p) return;
            const [fp, tp] = p;
            const f = R(e.from), t = R(e.to);
            const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
            const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
            const vert = (x) => x === 'top' || x === 'bottom';
            if (fp === 'left' && vert(tp)) {
              const ey = tp === 'top' ? t.y : t.y + t.h;
              const xExit = f.x - 24;
              let by = tp === 'top' ? Math.min(f.y - 20, t.y - 20) : Math.max(f.y + f.h + 20, t.y + t.h + 20);
              by = Math.max(20, by);
              result[e.id] = [[f.x, fcy], [xExit, fcy], [xExit, by], [tcx, by], [tcx, ey]];
            } else if (vert(fp) && vert(tp)) {
              const sy = fp === 'top' ? f.y : f.y + f.h;
              const ey = tp === 'top' ? t.y : t.y + t.h;
              if (tcx < fcx - 30) {
                const gy = fp === 'top' ? Math.min(f.y - 20, t.y - 20) : Math.max(f.y + f.h + 20, t.y + t.h + 20);
                result[e.id] = [[fcx, sy], [fcx, gy], [tcx, gy], [tcx, ey]];
              } else if (Math.abs(fcx - tcx) < 1) {
                result[e.id] = [[fcx, sy], [tcx, ey]];
              } else {
                const my = (sy + ey) / 2;
                result[e.id] = [[fcx, sy], [fcx, my], [tcx, my], [tcx, ey]];
              }
            } else if (fp === 'right' && vert(tp)) {
              const ey = tp === 'top' ? t.y : t.y + t.h;
              result[e.id] = [[f.x + f.w, fcy], [tcx, fcy], [tcx, ey]];
            } else if (vert(fp) && tp === 'left') {
              const sy = fp === 'top' ? f.y : f.y + f.h;
              result[e.id] = [[fcx, sy], [fcx, tcy], [t.x, tcy]];
            } else {
              const sx = f.x + f.w, sy = fcy, ex = t.x, ey = tcy;
              if (Math.abs(sy - ey) < 2) result[e.id] = [[sx, sy], [ex, sy]];
              else {
                const mx = sx + (ex - sx) / 2;
                result[e.id] = [[sx, sy], [mx, sy], [mx, ey], [ex, ey]];
              }
            }
          });
          return result;
        };

        const segCross = (p1, p2, p3, p4) => {
          const v1 = Math.abs(p1[0] - p2[0]) < 1, v2 = Math.abs(p3[0] - p4[0]) < 1;
          const h1 = Math.abs(p1[1] - p2[1]) < 1, h2 = Math.abs(p3[1] - p4[1]) < 1;
          if ((v1 && h2) || (h1 && v2)) {
            let vx, vy1, vy2, hy, hx1, hx2;
            if (v1) {
              vx = p1[0]; vy1 = Math.min(p1[1], p2[1]); vy2 = Math.max(p1[1], p2[1]);
              hy = p3[1]; hx1 = Math.min(p3[0], p4[0]); hx2 = Math.max(p3[0], p4[0]);
            } else {
              vx = p3[0]; vy1 = Math.min(p3[1], p4[1]); vy2 = Math.max(p3[1], p4[1]);
              hy = p1[1]; hx1 = Math.min(p1[0], p2[0]); hx2 = Math.max(p1[0], p2[0]);
            }
            return hx1 + 1 < vx && vx < hx2 - 1 && vy1 + 1 < hy && hy < vy2 - 1;
          }
          const x1 = Math.min(p1[0], p2[0]), y1 = Math.min(p1[1], p2[1]);
          const x2 = Math.max(p1[0], p2[0]), y2 = Math.max(p1[1], p2[1]);
          const x3 = Math.min(p3[0], p4[0]), y3 = Math.min(p3[1], p4[1]);
          const x4 = Math.max(p3[0], p4[0]), y4 = Math.max(p3[1], p4[1]);
          if (v1 && v2) return Math.abs(x1 - x3) < 1 && Math.min(y2, y4) - Math.max(y1, y3) > 1;
          if (h1 && h2) return Math.abs(y1 - y3) < 1 && Math.min(x2, x4) - Math.max(x1, x3) > 1;
          return false;
        };
        const polyCross = (a, b) => {
          for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) {
            if (segCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
          }
          return false;
        };

        const score = () => {
          // lane tops / heights (as in verify_collisions)
          const laneTop = {}, laneH = {};
          let cy = 0;
          lanes.forEach(l => {
            laneTop[l.id] = cy;
            const ys = nodes.filter(n => n.laneId === l.id).map(n => n.y || 0);
            const maxY = ys.length ? Math.max(...ys) : 48;
            laneH[l.id] = Math.max(l.height || LE.LANE_MIN, maxY + LE.DEC_H + 30);
            cy += laneH[l.id];
          });
          let overflows = 0, overlaps = 0, penetrations = 0;
          nodes.forEach(n => {
            if (!(n.laneId in laneIdx)) return;
            const h = nodeH(n);
            if (n.y < 10 || n.y + h > laneH[n.laneId]) overflows += 1;
          });
          for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            if (a.laneId !== b.laneId) continue;
            // Two nodes in one lane must keep MIN_GAP clear between them, not merely avoid overlapping: the compact
            // 'tight'/'zero' steps otherwise let a node land flush against a neighbour in the same row.
            const ox = Math.max(0, Math.min(a.x + LE.NODE_W + LE.MIN_GAP, b.x + LE.NODE_W + LE.MIN_GAP) - Math.max(a.x, b.x));
            const oy = Math.max(0, Math.min(a.y + nodeH(a), b.y + nodeH(b)) - Math.max(a.y, b.y));
            if (ox > 0 && oy > 0) overlaps += 1;
          }
          const rects = {};
          nodes.forEach(n => { rects[n.id] = [n.x, (laneTop[n.laneId] || 0) + n.y, LE.NODE_W, nodeH(n)]; });
          const poly = routeAll(rects);

          edges.forEach(e => {
            const pts = poly[e.id];
            if (!pts) return;
            // A long arrow (3+ columns) is detoured around nodes by the renderer's route search, so the
            // simplified route modelled here crossing a node must not veto an otherwise good alignment.
            const eu = nodeMap[e.from], ev = nodeMap[e.to];
            if (eu && ev && Math.abs(eu.x - ev.x) >= 3 * LE.COL_WIDTH) return;
            // Nodes a route passes through. The renderer re-routes an arrow that its standard route would
            // send through a node, so only count a penetration when no simple alternative route is clear.
            const through = (rt) => {
              let n = 0;
              nodes.forEach(o => {
                if (o.id === e.from || o.id === e.to) return;
                const [ox, oy, ow, oh] = rects[o.id];
                const bx1 = ox + 3, by1 = oy + 3, bx2 = ox + ow - 3, by2 = oy + oh - 3;
                if (bx2 <= bx1 || by2 <= by1) return;
                for (let k = 0; k < rt.length - 1; k++) {
                  const p1 = rt[k], p2 = rt[k + 1];
                  const sx1 = Math.min(p1[0], p2[0]), sx2 = Math.max(p1[0], p2[0]);
                  const sy1 = Math.min(p1[1], p2[1]), sy2 = Math.max(p1[1], p2[1]);
                  if (sx1 < bx2 && sx2 > bx1 && sy1 < by2 && sy2 > by1) {
                    if (Math.abs(p1[0] - p2[0]) < 1) {
                      if (bx1 <= p1[0] && p1[0] <= bx2 && !(sy2 <= by1 || sy1 >= by2)) { n += 1; break; }
                    } else if (Math.abs(p1[1] - p2[1]) < 1) {
                      if (by1 <= p1[1] && p1[1] <= by2 && !(sx2 <= bx1 || sx1 >= bx2)) { n += 1; break; }
                    }
                  }
                }
              });
              return n;
            };
            // Crossings of a route against the other arrows' current routes
            const crossesOf = (rt) => {
              let n = 0;
              edges.forEach(o => {
                const op = poly[o.id];
                if (!op || o === e || o.from === e.from || o.from === e.to || o.to === e.from || o.to === e.to) return;
                if (polyCross(rt, op)) n += 1;
              });
              return n;
            };
            let pen = through(pts);
            if (pen > 0 || crossesOf(pts) > 0) {
              const f = rects[e.from], t = rects[e.to];
              const fcx = f[0] + f[2] / 2, fcy = f[1] + f[3] / 2, tcx = t[0] + t[2] / 2, tcy = t[1] + t[3] / 2;
              const alts = [];
              if (t[0] > f[0] + f[2] + 24) {
                const ey = tcy > fcy ? t[1] : t[1] + t[3];
                alts.push([[f[0] + f[2], fcy], [tcx, fcy], [tcx, ey]]);                 // right, then up/down into top/bottom
                alts.push([[f[0] + f[2], fcy], [t[0] - 20, fcy], [t[0] - 20, tcy], [t[0], tcy]]);   // right, drop in the gap before the target
                alts.push([[fcx, tcy > fcy ? f[1] + f[3] : f[1]], [fcx, tcy], [t[0], tcy]]);        // up/down first, then across
              }
              if (tcx < fcx - 30) {
                // backward arrow: across then into the target's bottom/top, or vertical first into its right side
                const ey = tcy < fcy ? t[1] + t[3] : t[1];
                alts.push([[f[0], fcy], [tcx, fcy], [tcx, ey]]);
                alts.push([[fcx, tcy < fcy ? f[1] : f[1] + f[3]], [fcx, tcy], [t[0] + t[2], tcy]]);
              }
              // Keep whichever route has the fewest penetrations, then crossings (the standard route wins ties)
              let bestRt = pts, bestKey = [pen, crossesOf(pts)];
              alts.forEach(rt => {
                const k = [through(rt), crossesOf(rt)];
                if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) { bestRt = rt; bestKey = k; }
              });
              pen = bestKey[0];
              poly[e.id] = bestRt;
            }
            penetrations += pen;
          });

          const listed = edges.filter(e => poly[e.id]);
          let crossings = 0;
          for (let i = 0; i < listed.length; i++) for (let j = i + 1; j < listed.length; j++) {
            const a = listed[i], b = listed[j];
            if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
            if (polyCross(poly[a.id], poly[b.id])) crossings += 1;
          }
          let bends = 0, length = 0;
          Object.keys(poly).forEach(id => {
            const pts = poly[id];
            bends += Math.max(0, pts.length - 2);
            for (let i = 0; i < pts.length - 1; i++) {
              length += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
            }
          });
          const maxX = Math.max(...nodes.map(n => n.x));
          const columns = pyRound((maxX - LE.START_X) / LE.COL_WIDTH) + 1;
          return [overlaps + penetrations + overflows, crossings, columns, bends, pyRound(length)];
        };
        const keyLess = (a, b) => {
          for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
          return false;
        };

        // --- Choose compact steps for cross-lane arrows ---
        const cands = [];
        forwardEdges.forEach(e => {
          const s = nodeMap[e.from], d = nodeMap[e.to];
          if (!s || !d) return;
          const sl = laneIdx[s.laneId], dl = laneIdx[d.laneId];
          if (sl === undefined || dl === undefined || sl === dl) return;
          if (cands.some(c => c.k === KEY(e.from, e.to))) return;
          cands.push({ k: KEY(e.from, e.to), from: e.from, to: e.to, side: dl < sl ? 'up' : 'down' });
        });

        // Stacking v straight under (or over) u leaves a loop-back that arrives from u's side no way into v's
        // near side (u is in the way), so it would have to wrap around u. Such an arrow keeps its own column.
        const loopBlocked = (c) => [...back].some(k => {
          const [a, b] = k.split('');
          if (b !== c.to || !nodeMap[a]) return false;
          const la = laneIdx[nodeMap[a].laneId], lu = laneIdx[nodeMap[c.from].laneId];
          return c.side === 'down' ? la <= lu : la >= lu;
        });
        // Stacking a decision v straight under (or over) u makes the incoming arrow take v's near vertex. When one
        // branch of v stays in v's lane (it takes the right vertex) and another heads back toward u's side, that
        // branch has no free vertex facing its target and leaves beside the incoming arrow. Unstacked, the
        // incoming arrow enters v's side vertex and frees the near one for that branch.
        const exitBlocked = (c) => {
          const v = nodeMap[c.to];
          if (!v || v.type !== 'decision') return false;
          const lv = laneIdx[v.laneId];
          const outs = forwardEdges.filter(e => e.from === c.to && nodeMap[e.to]);
          const sameLane = outs.some(e => laneIdx[nodeMap[e.to].laneId] === lv);
          const towardU = outs.some(e => e.to !== c.from
            && (c.side === 'down' ? laneIdx[nodeMap[e.to].laneId] < lv : laneIdx[nodeMap[e.to].laneId] > lv));
          return sameLane && towardU;
        };
        const valid = (cfg) => {
          const used = new Set();
          for (const c of cands) {
            if (cfg.get(c.k) === 'zero') {
              const sk = c.from + '\u0001' + c.side;
              if (used.has(sk)) return false;
              used.add(sk);
            }
          }
          return true;
        };
        const cache = new Map();
        const evaluate = (cfg) => {
          const ck = cands.map(c => cfg.get(c.k) || '-').join(',');
          if (cache.has(ck)) return cache.get(ck);
          const zero = new Set(), tight = new Set();
          cfg.forEach((m, k) => { (m === 'zero' ? zero : tight).add(k); });
          const ranks = ranksWithZero(zero);
          // Always pixel-based, so labelled arrows get room for their labels even without cross-lane candidates
          const xs = xPositions(zero, tight);
          placeNodes(ranks, xs, zero, tight);
          const res = { key: score(), ranks, xs, zero, tight };
          cache.set(ck, res);
          return res;
        };

        let bestCfg = new Map();
        let best = evaluate(bestCfg);
        const modes = [null, 'zero', 'tight'];
        if (cands.length && cands.length <= 6) {
          const rec = (i, cfg) => {
            if (i === cands.length) {
              if (valid(cfg)) {
                const res = evaluate(cfg);
                if (keyLess(res.key, best.key)) { best = res; bestCfg = new Map(cfg); }
              }
              return;
            }
            for (const m of modes) {
              if (m) cfg.set(cands[i].k, m);
              rec(i + 1, cfg);
              cfg.delete(cands[i].k);
            }
          };
          rec(0, new Map());
        } else if (cands.length) {
          const seeds = [new Map(), new Map(cands.map(c => [c.k, 'tight']))];
          seeds.forEach(seed => {
            let cfg = new Map(seed);
            if (!valid(cfg)) return;
            let cur = evaluate(cfg);
            let improved = true;
            while (improved) {
              improved = false;
              cands.forEach(c => {
                modes.forEach(m => {
                  if ((cfg.get(c.k) || null) === m) return;
                  const trial = new Map(cfg);
                  if (m) trial.set(c.k, m); else trial.delete(c.k);
                  if (!valid(trial)) return;
                  const res = evaluate(trial);
                  if (keyLess(res.key, cur.key)) { cfg = trial; cur = res; improved = true; }
                });
              });
            }
            if (keyLess(cur.key, best.key)) { best = cur; bestCfg = new Map(cfg); }
          });
        }
        // Undo loop-blocked stacking on the winning layout only (filtering it inside the search would steer the
        // greedy search to a different layout elsewhere). Kept only when it adds no overlap or crossing.
        {
          // The unstacked node goes edge to edge with its source (tight); a full column only if tight is not clean.
          const blocked = cands.filter(c => bestCfg.get(c.k) === 'zero' && (loopBlocked(c) || exitBlocked(c)));
          if (blocked.length) {
            for (const mode of ['tight', null]) {
              const trial = new Map(bestCfg);
              blocked.forEach(c => { if (mode) trial.set(c.k, mode); else trial.delete(c.k); });
              const res = evaluate(trial);
              if (res.key[0] <= best.key[0] && res.key[1] <= best.key[1]) { best = res; bestCfg = trial; break; }
            }
          }
        }
        // Column alignment: nodes in different lanes that land less than half a node apart (labels of different
        // widths push siblings to slightly different x) snap to the right-most of them, so they share one centre
        // line. Only ever moves nodes right, then re-propagates, so every arrow keeps at least its required room.
        let finalXs = best.xs;
        {
          const SNAP = LE.NODE_W / 2;
          const floor = {};
          for (let iter = 0; iter < 8; iter++) {
            const sorted = nodes.map(n => n.id).sort((a, b) => finalXs[a] - finalXs[b]);
            let changed = false;
            let i = 0;
            while (i < sorted.length) {
              let j = i + 1;
              while (j < sorted.length && finalXs[sorted[j]] - finalXs[sorted[i]] < SNAP) j++;
              const group = sorted.slice(i, j);
              const lanesIn = new Set(group.map(id => nodeMap[id].laneId));
              // Same-lane nodes this close can only be stacked sub-rows (a row would overlap), so they align too
              if (group.length > 1 && (lanesIn.size > 1 || group.some(id => finalXs[id] !== finalXs[group[0]]))) {
                const target = Math.max(...group.map(id => finalXs[id]));
                group.forEach(id => { if (finalXs[id] < target - 0.01) { floor[id] = target; changed = true; } });
              }
              i = j;
            }
            if (!changed) break;
            finalXs = xPositions(best.zero, best.tight, floor);
          }
        }
        placeNodes(best.ranks, finalXs, best.zero, best.tight);

        // An end node whose predecessor is two or more lanes away cannot be entered from below/above when
        // another node sits in its column in a lane between them: the arrow would have to wrap around to the
        // node's far side. Nothing is downstream of an end node, so move it just right of the blocker: its left
        // edge lines up with the blocker's right edge (no gap), which still clears its centre column for the arrow.
        // Runs once on the final layout (not inside the search) so it never changes which layout wins.
        {
          const hasOut = new Set(edges.map(e => e.from));   // loop-backs count: only true end nodes move
          const preds = {};
          forwardEdges.forEach(e => { (preds[e.to] = preds[e.to] || []).push(e.from); });
          const SPAN = LE.NODE_W + LE.MIN_GAP;
          nodes.forEach(n => {
            if (hasOut.has(n.id)) return;
            const ln = laneIdx[n.laneId];
            const lps = (preds[n.id] || []).filter(p => nodeMap[p]).map(p => laneIdx[nodeMap[p].laneId]);
            let newX = n.x;
            nodes.forEach(m => {
              if (m === n || Math.abs(m.x - n.x) >= SPAN) return;
              const lm = laneIdx[m.laneId];
              if (lps.some(lp => Math.min(ln, lp) < lm && lm < Math.max(ln, lp))) newX = Math.max(newX, m.x + LE.NODE_W);
            });
            if (newX === n.x) return;
            if (nodes.every(m => m === n || m.laneId !== n.laneId || Math.abs(newX - m.x) >= SPAN)) n.x = newX;
          });
        }
      }

      // Entry point shared by every diagram type: lay out `data` in place (no DOM access).
      // Called by the page's Auto-Tidy button and by scripts/run_engine.mjs.
      function layoutDiagram(data) {
        useDirection(data);
        if (data.swimlanes === false) normalizeSwimlanes(data);
        const lanes = data.lanes || [], nodes = data.nodes || [], edges = data.edges || [];
        const c = collapseConnectors(nodes, edges);
        runLayoutEngine(lanes, c.steps, c.edges);
        if (!c.sats.length && !c.loose.length) return;
        // A connector that fits nowhere widens the column next to its step (the only case where one moves a step),
        // then every connector is placed again on the new layout
        const room = placeConnectors(lanes, c);
        if (room) {
          runLayoutEngine(lanes, c.steps, c.edges, room);
          placeConnectors(lanes, c, true);
        }
        centreLooseConnectors(c.loose);
      }

      // --- ON-PAGE CONNECTORS ---
      // A connector ("type": "connector") is a small lettered circle standing for one end of a long arrow: the flow
      // runs into circle A next to its source and continues out of circle A next to its target. Same letter = one
      // pair: one out-connector (arrows out, none in) and one or more in-connectors (arrows in, none out).
      // The layout must not see them: an out-connector has no incoming arrow, so it would rank as a new start, and
      // each circle would cost a column. So layoutDiagram collapses every pair back into the whole arrow
      // (src -> tgt, with the in-arrow's label and feedback flag), lays that out exactly as without connectors, and
      // places each circle afterwards as a satellite beside the step it is attached to. Connector x/y are the
      // circle's own top-left (CONN.SIZE square), in flow terms like a step's, not a slot corner.
      // GAP: stub length without a label; LABEL_PAD: clear room on each side of a stub's label
      const CONN = { SIZE: 32, GAP: 32, GAP_ACROSS: 20, LABEL_PAD: 16, CLEAR: 16, EDGE: 4, OFF_LINE: 8, CORNER_GAP: 12, CORNER_LEG: 56,
        GAP_TIGHT: 24, LABEL_PAD_TIGHT: 6, CORNER_LEG_TIGHT: 48 };
      const isConnector = (n) => !!n && n.type === 'connector';
      const connectorLetter = (n) => String((n && n.label) || '').trim().toUpperCase();
      // A, B, ... Z without I and O (read as 1 and 0), then AA, AB, ...
      const CONNECTOR_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const isConnectorLetter = (s) => new RegExp(`^[${CONNECTOR_LETTERS}]+$`).test(String(s || ''));
      function nextConnectorLetter(nodes) {
        const used = new Set((nodes || []).filter(isConnector).map(connectorLetter));
        for (let i = 0; ; i++) {
          let s = '', k = i;
          if (k < CONNECTOR_LETTERS.length) s = CONNECTOR_LETTERS[k];
          else { k -= CONNECTOR_LETTERS.length; s = CONNECTOR_LETTERS[Math.floor(k / CONNECTOR_LETTERS.length) % CONNECTOR_LETTERS.length] + CONNECTOR_LETTERS[k % CONNECTOR_LETTERS.length]; }
          if (!used.has(s)) return s;
        }
      }

      // Split the diagram into what the layout sees and the connectors placed around it afterwards.
      //   steps: every node but the satellites; edges: arrows between steps plus one virtual arrow per split arrow
      //   (it takes the in-arrow's place and id, so the layout is the one the whole arrow gets)
      //   sats: { node, anchor, role, stub, other } for each connector with one attached step; `other` is the step at
      //   the far end of its pair (null without a partner)
      //   loose: connectors with arrows both in and out, or none: laid out as ordinary steps (the audit warns)
      function collapseConnectors(nodes, edges) {
        const byId = {};
        nodes.forEach(n => { byId[n.id] = n; });
        const ins = {}, outs = {};
        edges.forEach(e => {
          if (isConnector(byId[e.to])) (ins[e.to] = ins[e.to] || []).push(e);
          if (isConnector(byId[e.from])) (outs[e.from] = outs[e.from] || []).push(e);
        });
        const sats = [], satOf = {}, loose = [];
        nodes.forEach(n => {
          if (!isConnector(n)) return;
          const i = ins[n.id] || [], o = outs[n.id] || [];
          const role = i.length && !o.length ? 'in' : (o.length && !i.length ? 'out' : null);
          const stub = role === 'in' ? i[0] : role === 'out' ? o[0] : null;
          const anchor = stub && byId[role === 'in' ? stub.from : stub.to];
          if (!anchor || isConnector(anchor)) { loose.push(n); return; }
          satOf[n.id] = { node: n, anchor, role, stub, other: null, ids: new Set() };
          sats.push(satOf[n.id]);
        });
        const outOf = {};   // letter -> its out-connector (the first one, if a letter has two: the audit warns)
        sats.forEach(s => { if (s.role === 'out' && !outOf[connectorLetter(s.node)]) outOf[connectorLetter(s.node)] = s; });
        const flat = [];
        edges.forEach(e => {
          const si = satOf[e.to];
          if (si) {
            const so = outOf[connectorLetter(si.node)];
            if (!so) return;
            outs[so.node.id].forEach((o, k) => {
              if (!byId[o.to] || isConnector(byId[o.to])) return;
              const v = { id: k ? `${e.id}~${o.id}` : e.id, from: e.from, to: o.to, label: e.label || '' };
              if (e.feedback) v.feedback = true;
              flat.push(v);
              si.ids.add(v.id); so.ids.add(v.id);
              if (!si.other) si.other = o.to;
              if (!so.other) so.other = e.from;
            });
            return;
          }
          if (satOf[e.from]) return;
          flat.push(e);
        });
        const virtual = new Set();
        sats.forEach(s => s.ids.forEach(id => virtual.add(id)));
        return { steps: nodes.filter(n => !satOf[n.id]), edges: flat, sats, loose, virtual };
      }

      // Auto layout off: steps stay where they are; only the connectors are placed beside them (lane heights as drawn)
      function placeConnectorsInPlace(data) {
        useDirection(data);
        const c = collapseConnectors(data.nodes || [], data.edges || []);
        if (c.sats.length) placeConnectors(data.lanes || [], c, true);
      }

      // A loose connector was laid out in a step's slot: centre its circle there
      function centreLooseConnectors(loose) {
        loose.forEach(n => {
          n.x = (n.x || 0) + Math.round((LE.NODE_W - CONN.SIZE) / 2);
          n.y = (n.y || 0) + Math.round((LE.NODE_H - CONN.SIZE) / 2);
        });
      }

      // Place each satellite beside its step, in that step's lane. Sides, in flow terms: 'after' / 'before' along the
      // flow, 'far' / 'near' across it (toward later / earlier lanes). Tried in order of preference:
      //   - a split forward arrow: the side facing the other end along the flow (after the source, before the
      //     target), then across toward the other end's lane, then the other across side, then the remaining side
      //   - a split loop-back: across first (that is where loops run; along the flow carries the main line), then
      //     after, then before
      // then the same along-the-flow sides moved just off the step's centre line (beside an arrow leaving straight).
      // A side already used by one of the step's own arrows is taken only when no free side fits. A spot fits when it
      // stays inside the lane, keeps CLEAR from every step and connector and does not sit on a straight arrow. When
      // none fits: with `final`, the first candidate is taken anyway; otherwise the column next to the step is widened
      // (returned as `room` for runLayoutEngine) and the caller places every connector again.
      function placeConnectors(lanes, c, final) {
        const S = CONN.SIZE;
        const laneIdx = {}, laneTop = {}, laneH = {};
        let top = 0;
        lanes.forEach((l, i) => { laneIdx[l.id] = i; laneTop[l.id] = top; laneH[l.id] = l.height || LE.LANE_MIN; top += laneH[l.id]; });
        const nodeH = n => (n.type === 'decision' ? LE.DEC_H : LE.NODE_H);
        const box = n => isConnector(n)
          ? { x: n.x || 0, y: (laneTop[n.laneId] || 0) + (n.y || 0), w: S, h: S }
          : { x: n.x || 0, y: (laneTop[n.laneId] || 0) + (n.y || 0), w: LE.NODE_W, h: nodeH(n) };
        const byId = {};
        c.steps.forEach(n => { byId[n.id] = n; });
        const real = c.edges.filter(e => !c.virtual.has(e.id) && byId[e.from] && byId[e.to]);

        // Straight arrows between steps (centres aligned): a connector must not sit on one
        const segs = [];
        real.forEach(e => {
          const a = box(byId[e.from]), b = box(byId[e.to]);
          const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
          if (Math.abs(acy - bcy) < 2) {
            const [l, r] = acx < bcx ? [a, b] : [b, a];
            segs.push({ x: l.x + l.w, y: acy - 1, w: r.x - l.x - l.w, h: 2 });
          } else if (Math.abs(acx - bcx) < 2) {
            const [t, d] = acy < bcy ? [a, b] : [b, a];
            segs.push({ x: acx - 1, y: t.y + t.h, w: 2, h: d.y - t.y - t.h });
          }
        });

        // The side of step `id` an arrow to or from step `o` uses (roughly where the router takes it)
        const sideFor = (id, o, out) => {
          const n = byId[id], m = byId[o];
          const ln = laneIdx[n.laneId], lm = laneIdx[m.laneId];
          const across = lm > ln ? 'far' : 'near';
          if (ln === lm) return (m.x > n.x + 1) === out ? (out ? 'after' : 'before') : 'far';
          if (Math.abs(m.x - n.x) < 30) return across;
          return out ? (m.x > n.x ? 'after' : across) : (m.x < n.x ? 'before' : across);
        };
        const used = {};
        const use = (id, side) => { (used[id] = used[id] || new Set()).add(side); };
        real.forEach(e => {
          if (e.from === e.to) return;
          use(e.from, sideFor(e.from, e.to, true));
          use(e.to, sideFor(e.to, e.from, false));
        });

        // Gap between the step and the circle: room for the stub's label when it has one. The label sits on the
        // stub: along a screen-vertical stub it needs its height, along a horizontal one its width. `compact`: the
        // tight spacing tried only where the comfortable one fits nowhere (before any column is widened).
        const gapFor = (s, alongFlow, compact) => {
          const t = String(s.stub.label || '').trim();
          if (!t) return alongFlow ? (compact ? CONN.GAP_TIGHT : CONN.GAP) : CONN.GAP_ACROSS;
          const w = Math.min(Math.max(40, t.length * 6.6 + 18), LE.LABEL_MAX_W);
          const lines = Math.ceil((t.length * 6.6 + 18) / LE.LABEL_MAX_W);
          const vertical = alongFlow ? LE.LABEL_ACROSS : !LE.LABEL_ACROSS;
          return (vertical ? 24 + 15 * (Math.min(lines, 3) - 1) : w) + 2 * (compact ? CONN.LABEL_PAD_TIGHT : CONN.LABEL_PAD);
        };
        // Top-left of the circle on `side` of box a, `gap` away. `off` ('far' / 'near') moves an along-the-flow spot just
        // off the step's centre line, so it clears an arrow leaving that side straight.
        const spot = (a, side, gap, off) => {
          const cx = a.x + a.w / 2 - S / 2, mid = a.y + a.h / 2;
          const y = off === 'far' ? mid + CONN.OFF_LINE : off === 'near' ? mid - CONN.OFF_LINE - S : mid - S / 2;
          if (side === 'after') return { x: a.x + a.w + gap, y };
          if (side === 'before') return { x: a.x - gap - S, y };
          if (side === 'far') return { x: cx, y: a.y + a.h + gap };
          return { x: cx, y: a.y - gap - S };
        };

        const placed = [];
        // `ownPad`: clearance from the connector's own step (a corner spot sits closer to it than to anything else)
        const fits = (s, p, ownPad = CONN.CLEAR) => {
          const lt = laneTop[s.anchor.laneId] || 0, lh = laneH[s.anchor.laneId] || LE.LANE_MIN;
          if (p.y < lt + CONN.EDGE || p.y + S > lt + lh - CONN.EDGE || p.x < 8) return false;
          const hit = (b, pad) => p.x < b.x + b.w + pad && p.x + S + pad > b.x && p.y < b.y + b.h + pad && p.y + S + pad > b.y;
          return !c.steps.some(n => hit(box(n), n === s.anchor ? ownPad : CONN.CLEAR)) && !placed.some(b => hit(b, CONN.CLEAR)) && !segs.some(g => hit(g, 4));
        };

        let room = null;
        c.sats.forEach(s => {
          const a = box(s.anchor), id = s.anchor.id;
          const other = s.other && byId[s.other];
          const back = other && (s.role === 'in' ? other.x <= s.anchor.x : other.x >= s.anchor.x);
          const lo = other ? laneIdx[other.laneId] : undefined, la = laneIdx[s.anchor.laneId];
          const toward = lo === undefined || lo === la ? ['far', 'near'] : (lo > la ? ['far', 'near'] : ['near', 'far']);
          const facing = s.role === 'in' ? 'after' : 'before', away = s.role === 'in' ? 'before' : 'after';
          const sides = back ? [...toward, facing, away] : [facing, ...toward, away];
          const cands = sides.map(side => ({ side, off: null }));
          // Corner spots: just across the step's edge, moved along the flow toward the other end. The stub leaves
          // the step's top/bottom and turns along the flow into the circle (its label on that leg), all inside the
          // step's own column, so it needs no wider column. Tried before the spots off the centre line.
          toward.forEach(side => cands.push({ side, corner: facing }));
          [facing, away].forEach(side => toward.forEach(off => cands.push({ side, off })));
          const at = (k) => {
            if (k.corner) {
              // Long enough for the stub's label on that leg with CLEAR-ish room on both sides (the router puts it mid-leg)
              const leg = Math.max(k.compact ? CONN.CORNER_LEG_TIGHT : CONN.CORNER_LEG, String(s.stub.label || '').trim() ? gapFor(s, true, k.compact) : 0);
              const x = k.corner === 'after' ? a.x + a.w / 2 + leg : a.x + a.w / 2 - leg - S;
              const y = k.side === 'far' ? a.y + a.h + CONN.CORNER_GAP : a.y - CONN.CORNER_GAP - S;
              return { x: Math.round(x), y: Math.round(y) };
            }
            const along = k.side === 'after' || k.side === 'before';
            const p = spot(a, k.side, gapFor(s, along, k.compact), k.off);
            return { x: Math.round(p.x), y: Math.round(p.y) };
          };
          const ok = (k) => fits(s, at(k), k.corner ? CONN.CORNER_GAP - 2 : CONN.CLEAR);
          const free = (k) => !(used[id] && used[id].has(k.side));
          // Comfortable spacing first (a free side, then any side), then the same spots with tight spacing
          const tight = cands.map(k => ({ ...k, compact: true }));
          let pick = cands.find(k => free(k) && ok(k)) || cands.find(ok) || tight.find(k => free(k) && ok(k)) || tight.find(ok);
          if (!pick) {
            pick = tight[0];
            if (!final) {
              // Widen the column on the preferred side along the flow
              const side = sides.find(x => x === 'after' || x === 'before');
              room = room || { after: {}, before: {} };
              room[side][id] = Math.max(room[side][id] || 0, gapFor(s, true, true) + S + CONN.CLEAR);
            }
          }
          const p = at(pick);
          use(id, pick.side);
          placed.push({ x: p.x, y: p.y, w: S, h: S });
          s.node.laneId = s.anchor.laneId;
          s.node.x = p.x;
          s.node.y = p.y - (laneTop[s.anchor.laneId] || 0);
        });
        return room;
      }

      // No-swimlane mode ("swimlanes": false): the diagram still holds exactly one (hidden) lane, so ranking,
      // routing and dragging work unchanged. Creates it when missing and moves stray nodes onto it.
      function normalizeSwimlanes(data) {
        if (!Array.isArray(data.lanes) || !data.lanes.length) {
          data.lanes = [{ id: 'lane-main', name: 'Process', color: '#e0f2fe', icon: 'users' }];
        }
        const ids = new Set(data.lanes.map(l => l.id));
        (data.nodes || []).forEach(n => { if (!ids.has(n.laneId)) n.laneId = data.lanes[0].id; });
      }
