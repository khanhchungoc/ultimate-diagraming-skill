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

      // Room a lane keeps clear on its far side for its loop-backs: arrows between two of its own nodes that run
      // back against the flow. They nest one channel further out per overlapping loop. 0 when it has none.
      // Shared by the engine and the renderer's lane sizing; xOf gives a node's position along the flow.
      function laneLoopRoom(nodes, edges, laneId, xOf) {
        const lane = {};
        nodes.forEach(n => { if (n.laneId === laneId) lane[n.id] = true; });
        const spans = [];
        edges.forEach(e => {
          if (!lane[e.from] || !lane[e.to] || e.from === e.to) return;
          const a = xOf(e.from), b = xOf(e.to);
          if (b < a - 1) spans.push([b, a]);
        });
        const depth = spans.reduce((d, [p0]) => Math.max(d, spans.filter(([p, q]) => p <= p0 && p0 <= q).length), 0);
        return depth ? LE.LOOP_ROOM + (depth - 1) * LE.LOOP_STEP : 0;
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

      function runLayoutEngine(lanes, nodes, edges) {
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
          const step = zero.has(k) ? 0 : (tight.has(k) ? LE.TIGHT_STEP : LE.COL_WIDTH);
          return (step > 0 && labelGap[k]) ? Math.max(step, LE.NODE_W + labelGap[k]) : step;
        };

        // Longest-path x offsets
        const xPositions = (zero, tight) => {
          const adj = {}, indeg = {}, xs = {};
          nodes.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; xs[n.id] = 0; });
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
              g.list.sort((a, b) => bc.get(a.id) - bc.get(b.id));
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
          // An end node whose predecessor is two or more lanes away cannot be entered from below/above when
          // another node sits in its column in a lane between them: the arrow would have to wrap around to the
          // node's far side. Nothing is downstream of an end node, so move it just right of the blocker.
          nodes.forEach(n => {
            if ((fwdOut[n.id] || []).length) return;
            const ln = laneIdx[n.laneId];
            const lps = (fwdIn[n.id] || []).filter(p => nodeMap[p]).map(p => laneIdx[nodeMap[p].laneId]);
            let newX = X[n.id];
            nodes.forEach(m => {
              if (m === n || Math.abs(X[m.id] - X[n.id]) >= LE.NODE_W + LE.MIN_GAP) return;
              const lm = laneIdx[m.laneId];
              if (lps.some(lp => Math.min(ln, lp) < lm && lm < Math.max(ln, lp))) newX = Math.max(newX, X[m.id] + LE.NODE_W + LE.MIN_GAP);
            });
            if (newX === X[n.id]) return;
            const sameLane = nodes.filter(m => m !== n && m.laneId === n.laneId);
            if (sameLane.every(m => clear(newX, X[m.id]))) X[n.id] = newX;
          });

          const subrows = {};
          lanes.forEach(l => { subrows[l.id] = 1; });
          nodes.forEach(n => { subrows[n.laneId] = Math.max(subrows[n.laneId] || 1, sub[n.id] + 1); });

          // Every lane is the same size (LANE_MIN) unless it stacks branches across it, with its nodes centred. LANE_MIN
          // leaves room on both sides of a node for the loop-backs and corridor routes that run around the nodes,
          // including on the diagram's outer edge, where there is no neighbouring lane to borrow room from.
          // Same-lane loop-backs run around the nodes on the lane's far side (below them; right of them top-to-bottom),
          // nested one channel further out per overlapping loop, with their labels on the channel. A single-row lane
          // with loops keeps that room (LOOP_ROOM, + LOOP_STEP per extra nesting level) clear on its far side and
          // moves its nodes toward the near side instead of centring them, growing only if that is not enough.
          const loopRoom = id => laneLoopRoom(nodes, edges, id, nid => X[nid]);

          const lanePos = {};
          let curY = 0;
          lanes.forEach(l => {
            let maxH = LE.NODE_H;
            const inLane = nodes.filter(n => n.laneId === l.id);
            if (inLane.length) maxH = Math.max(...inLane.map(nodeH));
            const rows = subrows[l.id] || 1;
            const req = rows === 1 && loopRoom(l.id)
              ? LE.NEAR_MIN + maxH + loopRoom(l.id)
              : LE.TOP_PAD + (rows - 1) * LE.ROW_HEIGHT + maxH + LE.BOTTOM_PAD;
            const inner = Math.max(LE.LANE_MIN, req);
            l.height = inner;
            lanePos[l.id] = { top: curY, h: l.height, inner, maxH };
            curY += l.height;
          });

          nodes.forEach(n => {
            const lp = lanePos[n.laneId] || { top: 0, h: LE.LANE_MIN };
            n.x = X[n.id];
            if ((subrows[n.laneId] || 1) === 1) {
              const inner = lp.inner || lp.h;
              const room = loopRoom(n.laneId);
              // Centred, or pulled toward the near side just enough to leave the loops their room
              const centre = Math.floor((inner - nodeH(n)) / 8) * 4;
              const blockTop = room ? Math.min(Math.floor((inner - lp.maxH) / 8) * 4, Math.floor((inner - room - lp.maxH) / 4) * 4) : null;
              n.y = room ? Math.max(LE.NEAR_MIN, blockTop + Math.floor((lp.maxH - nodeH(n)) / 8) * 4) : centre;
            } else {
              n.y = LE.TOP_PAD + sub[n.id] * LE.ROW_HEIGHT;
            }
          });

          // Nudge (<= 35px) so same-lane forward neighbours form a straight horizontal line
          edges.forEach(e => {
            const u = nodeMap[e.from], v = nodeMap[e.to];
            if (!u || !v || u.laneId !== v.laneId || v.x <= u.x) return;
            const lp = lanePos[u.laneId] || { top: 0, h: LE.LANE_MIN };
            const uh = nodeH(u), vh = nodeH(v);
            const uCy = u.y + uh / 2, vCy = v.y + vh / 2;
            const delta = uCy - vCy;
            if (Math.abs(delta) > 0 && Math.abs(delta) <= 35) {
              const targetY = Math.trunc(pyRound((uCy - vh / 2) / 4) * 4);
              if (targetY >= 20 && targetY + vh <= lp.h - 20) {
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
                else ports[e.id] = ['bottom', 'bottom'];
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
          cands.push({ k: KEY(e.from, e.to), from: e.from, side: dl < sl ? 'up' : 'down' });
        });

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
        placeNodes(best.ranks, best.xs, best.zero, best.tight);
      }

      // Entry point shared by every diagram type: lay out `data` in place (no DOM access).
      // Called by the page's Auto-Tidy button and by scripts/run_engine.mjs.
      function layoutDiagram(data) {
        useDirection(data);
        if (data.swimlanes === false) normalizeSwimlanes(data);
        runLayoutEngine(data.lanes || [], data.nodes || [], data.edges || []);
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
