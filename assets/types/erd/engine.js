      // --- ERD LAYOUT ENGINE ---
      // Pure JS, no DOM access. Defines layoutDiagram(data) and routeDiagram(data) (see assets/shell/shell.js) and is run
      // by the page (Auto-Tidy, edits) and by scripts/run_engine.mjs (--layout). The Python audit in scripts/audit_erd.py
      // mirrors the constants below; keep ER in sync with it.
      //
      // Input:  direction? ("LR" default | "TB"), detail? ("all" | "keys" | "names"), showTypes?,
      //         groups?[{id,name,color?}] (array order = band order),
      //         entities[{id,name,group?,columns?[{name,type?,pk?,fk?,unique?,nullable?,note?}],collapsed?}],
      //         relationships[{id,from,to,columns?,toColumns?,fromEnd?,toEnd?,identifying?,label?}]
      //           (from = the child table that holds the foreign key, to = the parent),
      //         layoutDiagram needs nothing else; routeDiagram needs entities[].x/y as well.
      // Output (all derived, none of it saved): entities[].x/y in FLOW terms, as flowchart nodes (x runs along the
      //         flow from the start of the band track, y runs across the band from the band's edge: top edge in LR, left
      //         edge in TB); entities[].box {x,y,w,h} on screen; groups[].box {x,y,w,h} (the band; with no groups
      //         data._band is the one implicit band, without a header); relationships[].points [[x,y],...] (screen,
      //         orthogonal; first/last segment horizontal and >= STUB long, first point on the "from" box edge at its
      //         column row, last on the "to" box edge); relationships[].labelBox {x,y,w,h} when "label" is set;
      //         data.canvas {width,height,crossings}.
      // layoutDiagram(data): clears stale derived fields, ranks, orders and places every entity, then routeDiagram(data).
      //         Deterministic, and it reads structure only (never x/y): laying out its own output changes nothing.
      // routeDiagram(data): from the current x/y: sizes, band rects, screen boxes, routes and labels. Never moves an
      //         entity, except to push a negative y back into its band.
      //
      // Notes on readings of the plan:
      //  - Ranking: a table with no parent (a root) that has children is pulled right to sit one rank before its nearest
      //    child (ER.PULL_ROOTS); the plan's strict longest-path rank would draw a long line from a lookup table
      //    sitting at rank 0 to a child several ranks away. Parents still come first.
      //  - Order within a (band, rank) uses positions normalised by list length, not pixel sizes, so "detail" and
      //    "collapsed" never change rank or order (only sizes).
      //  - In TB the gap between tables stacked across a band is STACK_GAP + 2*STUB: stubs are horizontal and run
      //    sideways in both directions, so two neighbours need room for both.
      //  - A stub may be longer than STUB (up to 3 * CHANNEL_STEP more) where several lines share one row anchor, so their
      //    first vertical runs sit in separate tracks.
      const ER = {
        HEAD_H: 36, ROW_H: 26, MORE_H: 22,          // header strip, one column row, the "+ N more" row (keys detail)
        CHAR_W: 7.4, TYPE_CHAR_W: 6.6,              // name text and the muted type text
        PAD_X: 12, GLYPH_W: 22, TYPE_GAP: 16,       // left padding, key-glyph column, gap between name and type
        MIN_W: 168, MAX_W: 360,                     // entity box width bounds
        RANK_GAP: 112, LABEL_PAD: 32,               // min gap between ranks; widened to fit the widest label crossing it + LABEL_PAD
        STACK_GAP: 40,                              // gap between entities stacked in one rank of one band
        BAND_HEAD: 48, BAND_PAD: 28, BAND_MIN: 140, // band header (name pill column / row), inner padding, min thickness
        MARGIN: 40, STUB: 20, CHANNEL_STEP: 8, OBSTACLE_PAD: 12, GRID: 4,
        // Router cost model and layout tuning (engine-only; the audit does not need these)
        BEND: 40, CROSS: 400, OVERLAP: 6, TRUNK: 0.8,   // OVERLAP: extra cost per unit of length run over an earlier line
         LABEL_H: 22, LABEL_X: 16, SWEEPS: 4, PLACE_PASSES: 6, PULL_ROOTS: true
      };
      const erGrid = (v) => Math.ceil(v / ER.GRID) * ER.GRID;
      const erTextW = (t, cw) => Math.ceil(String(t == null ? '' : t).length * cw);
      const erName = (e) => (e.name !== undefined && e.name !== null ? e.name : e.id);

      // Which columns an entity shows at the current detail: { cols: [{col, index}], more: N }
      function erVisibleColumns(entity, data) {
        const all = entity.columns || [];
        if (entity.collapsed === true || data.detail === 'names') return { cols: [], more: 0 };
        if (data.detail === 'keys') {
          const cols = [];
          all.forEach((col, index) => { if (col.pk || col.fk) cols.push({ col, index }); });
          return { cols, more: all.length - cols.length };
        }
        return { cols: all.map((col, index) => ({ col, index })), more: 0 };
      }

      // On-screen size of an entity: { w, h }
      function erEntitySize(entity, data) {
        const vis = erVisibleColumns(entity, data);
        const showTypes = data.showTypes !== false;
        let nameW = 0, typeW = 0;
        vis.cols.forEach(({ col }) => {
          nameW = Math.max(nameW, erTextW(col.name, ER.CHAR_W));
          typeW = Math.max(typeW, Math.ceil((String(col.type == null ? '' : col.type).length + (col.nullable ? 2 : 0)) * ER.TYPE_CHAR_W));
        });
        const rows = vis.cols.length
          ? ER.PAD_X + ER.GLYPH_W + nameW + (showTypes ? ER.TYPE_GAP + typeW : 0) + ER.PAD_X : 0;
        const head = erTextW(erName(entity), ER.CHAR_W) + 2 * ER.PAD_X + 24;
        const w = erGrid(Math.min(ER.MAX_W, Math.max(ER.MIN_W, head, rows)));
        return { w, h: ER.HEAD_H + vis.cols.length * ER.ROW_H + (vis.more ? ER.MORE_H : 0) };
      }

      // The two ends of a relationship with the defaults applied
      function erRelEnds(rel, data) {
        let toEnd = rel.toEnd;
        if (!toEnd) {
          toEnd = 'one';
          const from = (data.entities || []).find((e) => e.id === rel.from);
          const names = Array.isArray(rel.columns) ? rel.columns : [];
          if (from && names.length && names.every((n) => (from.columns || []).some((c) => c.name === n && c.nullable === true))) toEnd = 'zeroOrOne';
        }
        return { fromEnd: rel.fromEnd || 'zeroOrMany', toEnd };
      }

      // Offset of a column row's centre from the top of its entity box (the header centre when it is hidden or null)
      function erRowOffset(entity, columnName, data) {
        const vis = erVisibleColumns(entity, data);
        const at = columnName == null ? -1 : vis.cols.findIndex((v) => v.col.name === columnName);
        return at < 0 ? ER.HEAD_H / 2 : ER.HEAD_H + at * ER.ROW_H + ER.ROW_H / 2;
      }

      // Screen y of a column's row centre, or the header centre when the column is hidden
      function erRowAnchorY(entity, columnName, data) {
        return (entity.box ? entity.box.y : 0) + erRowOffset(entity, columnName, data);
      }

      // The column a relationship leaves its child at (first of "columns" that exists) and enters its parent at
      // ("toColumns", else the first PK row); null = the header
      function erFromCol(rel, from) {
        const have = (n) => (from.columns || []).some((c) => c.name === n);
        return (Array.isArray(rel.columns) ? rel.columns : []).find(have) || null;
      }
      function erToCol(rel, to) {
        const cols = to.columns || [];
        const named = (Array.isArray(rel.toColumns) ? rel.toColumns : []).find((n) => cols.some((c) => c.name === n));
        if (named) return named;
        const pk = cols.find((c) => c.pk);
        return pk ? pk.name : null;
      }

      function erClearDerived(data) {
        (data.entities || []).forEach((e) => { delete e.box; });
        (data.groups || []).forEach((g) => { delete g.box; });
        (data.relationships || []).forEach((r) => { delete r.points; delete r.labelBox; });
        delete data.canvas;
        delete data._band;
      }

      // Stable isotonic regression (equal weights): the non-decreasing sequence closest to u
      function erIsotonic(u) {
        const blocks = [];
        u.forEach((v) => {
          blocks.push({ s: v, n: 1 });
          while (blocks.length > 1) {
            const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
            if (a.s / a.n <= b.s / b.n) break;
            blocks.pop();
            a.s += b.s; a.n += b.n;
          }
        });
        const out = [];
        blocks.forEach((b) => { for (let i = 0; i < b.n; i++) out.push(b.s / b.n); });
        return out;
      }

      function layoutDiagram(data) {
        erClearDerived(data);
        const ents = data.entities || [], rels = data.relationships || [], groups = data.groups || [];
        const TB = data.direction === 'TB';
        const n = ents.length;
        const idOf = {};
        ents.forEach((e, i) => { idOf[e.id] = i; });
        const gIdx = {};
        groups.forEach((g, i) => { gIdx[g.id] = i; });
        const nb = Math.max(1, groups.length);
        const bandOf = ents.map((e) => (e.group !== undefined && gIdx[e.group] !== undefined ? gIdx[e.group] : 0));
        if (!n) { routeDiagram(data); return; }

        // 1. Rank. Edges run parent -> child (to -> from); self-references are ignored; an edge that closes a cycle in a
        //    DFS (authored order) is a feedback edge and does not constrain the rank (it is routed around).
        const links = [];   // {c: child index, p: parent index}
        rels.forEach((r) => {
          const c = idOf[r.from], p = idOf[r.to];
          if (c !== undefined && p !== undefined && c !== p) links.push({ c, p });
        });
        const kids = ents.map(() => []);
        links.forEach((l, k) => kids[l.p].push(k));
        const state = ents.map(() => 0), back = links.map(() => false);
        const dfs = (u) => {
          state[u] = 1;
          kids[u].forEach((k) => {
            const v = links[k].c;
            if (state[v] === 1) back[k] = true;
            else if (state[v] === 0) dfs(v);
          });
          state[u] = 2;
        };
        for (let i = 0; i < n; i++) if (state[i] === 0) dfs(i);
        const parents = ents.map(() => []), children = ents.map(() => []);
        links.forEach((l, k) => { if (!back[k]) { parents[l.c].push(l.p); children[l.p].push(l.c); } });
        const rank = ents.map(() => -1);
        const rankOf = (i) => {
          if (rank[i] >= 0) return rank[i];
          rank[i] = parents[i].reduce((m, p) => Math.max(m, rankOf(p) + 1), 0);
          return rank[i];
        };
        for (let i = 0; i < n; i++) rankOf(i);
        if (ER.PULL_ROOTS) {
          for (let i = 0; i < n; i++) {
            if (!parents[i].length && children[i].length) rank[i] = Math.max(rank[i], Math.min.apply(null, children[i].map((c) => rank[c])) - 1);
          }
        }
        const linked = ents.map(() => false);
        links.forEach((l) => { linked[l.c] = true; linked[l.p] = true; });
        const R = rank.reduce((m, r) => Math.max(m, r), 0) + 1;

        // 2/3. Order within (band, rank): authored order (unconnected tables last), then barycentre sweeps on positions
        //      normalised by list length (band index + fraction), keeping the arrangement with the fewest estimated crossings.
        const lists = [];
        for (let b = 0; b < nb; b++) { lists.push([]); for (let r = 0; r < R; r++) lists[b].push([]); }
        for (let i = 0; i < n; i++) if (linked[i]) lists[bandOf[i]][rank[i]].push(i);
        for (let i = 0; i < n; i++) if (!linked[i]) lists[bandOf[i]][rank[i]].push(i);
        const nbrs = ents.map(() => []);
        links.forEach((l) => { nbrs[l.c].push(l.p); nbrs[l.p].push(l.c); });
        const pos = ents.map(() => 0);
        const setPos = () => lists.forEach((byRank, b) => byRank.forEach((list) => list.forEach((i, k) => { pos[i] = b + (k + 0.5) / list.length; })));
        const ccw = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const estimate = () => {
          setPos();
          let total = 0;
          for (let a = 0; a < links.length; a++) {
            for (let b = a + 1; b < links.length; b++) {
              const A = links[a], B = links[b];
              if (A.c === B.c || A.c === B.p || A.p === B.c || A.p === B.p) continue;
              const d1 = ccw(rank[A.p], pos[A.p], rank[A.c], pos[A.c], rank[B.p], pos[B.p]);
              const d2 = ccw(rank[A.p], pos[A.p], rank[A.c], pos[A.c], rank[B.c], pos[B.c]);
              const d3 = ccw(rank[B.p], pos[B.p], rank[B.c], pos[B.c], rank[A.p], pos[A.p]);
              const d4 = ccw(rank[B.p], pos[B.p], rank[B.c], pos[B.c], rank[A.c], pos[A.c]);
              if (d1 * d2 < 0 && d3 * d4 < 0) total++;
            }
          }
          return total;
        };
        let best = estimate();
        let bestLists = lists.map((byRank) => byRank.map((l) => l.slice()));
        const sweep = (down) => {
          setPos();
          const rs = [];
          for (let r = 0; r < R; r++) rs.push(r);
          if (!down) rs.reverse();
          rs.forEach((r) => {
            lists.forEach((byRank) => {
              const list = byRank[r];
              const val = (i) => {
                if (!linked[i]) return Infinity;
                const ns = nbrs[i].filter((j) => (down ? rank[j] < r : rank[j] > r));
                return ns.length ? ns.reduce((s, j) => s + pos[j], 0) / ns.length : pos[i];
              };
              const keyed = list.map((i, k) => ({ i, k, v: val(i) }));
              keyed.sort((a, b) => (a.v === b.v ? a.k - b.k : a.v < b.v ? -1 : 1));
              keyed.forEach((e, k) => { list[k] = e.i; });
            });
            setPos();
          });
        };
        for (let s = 0; s < ER.SWEEPS; s++) {
          sweep(s % 2 === 0);
          const est = estimate();
          if (est < best) { best = est; bestLists = lists.map((byRank) => byRank.map((l) => l.slice())); }
        }
        for (let b = 0; b < nb; b++) for (let r = 0; r < R; r++) lists[b][r] = bestLists[b][r];

        // 4. Place. Along the flow: rank starts, gaps widened for labels (left to right only: a label sits across the line
        //    top to bottom). Across: stacked, then pulled towards the row anchors of their neighbours.
        const size = ents.map((e) => erEntitySize(e, data));
        const along = (i) => (TB ? size[i].h : size[i].w);
        const across = (i) => (TB ? size[i].w : size[i].h);
        const gapNeed = [];
        for (let r = 0; r < R; r++) gapNeed.push(ER.RANK_GAP);
        if (!TB) {
          rels.forEach((r) => {
            const c = idOf[r.from], p = idOf[r.to];
            if (c === undefined || p === undefined || r.label === undefined || r.label === '') return;
            const w = erTextW(r.label, ER.CHAR_W) + ER.LABEL_X + ER.LABEL_PAD;
            if (c === p) { gapNeed[rank[c]] = Math.max(gapNeed[rank[c]], w + 2 * ER.STUB + 4 * ER.CHANNEL_STEP); return; }   // a self-reference's label sits beside its loop
            for (let k = Math.min(rank[c], rank[p]); k < Math.max(rank[c], rank[p]); k++) gapNeed[k] = Math.max(gapNeed[k], w);
          });
        }
        const rankLen = [];
        for (let r = 0; r < R; r++) rankLen.push(0);
        for (let i = 0; i < n; i++) rankLen[rank[i]] = Math.max(rankLen[rank[i]], along(i));
        const rankStart = [];
        let at = ER.MARGIN;
        for (let r = 0; r < R; r++) { rankStart.push(Math.round(at)); at += rankLen[r] + gapNeed[r]; }
        const stackGap = TB ? ER.STACK_GAP + 2 * ER.STUB : ER.STACK_GAP;
        const y = ents.map(() => 0);
        lists.forEach((byRank) => byRank.forEach((list) => {
          let cur = ER.BAND_PAD;
          list.forEach((i) => { y[i] = cur; cur += across(i) + stackGap; });
        }));
        const links2 = rels.map((r) => {
          const c = idOf[r.from], p = idOf[r.to];
          if (c === undefined || p === undefined || c === p) return null;
          return { c, p, oc: TB ? size[c].w / 2 : erRowOffset(ents[c], erFromCol(r, ents[c]), data), op: TB ? size[p].w / 2 : erRowOffset(ents[p], erToCol(r, ents[p]), data) };
        }).filter(Boolean);
        const nl = ents.map(() => []);
        links2.forEach((l) => { nl[l.c].push({ j: l.p, mine: l.oc, theirs: l.op }); nl[l.p].push({ j: l.c, mine: l.op, theirs: l.oc }); });
        const settle = () => {
          for (let b = 0; b < nb; b++) {
            let lo = Infinity;
            for (let i = 0; i < n; i++) if (bandOf[i] === b) lo = Math.min(lo, y[i]);
            if (lo !== Infinity) for (let i = 0; i < n; i++) if (bandOf[i] === b) y[i] -= lo - ER.BAND_PAD;
          }
        };
        for (let pass = 0; pass < ER.PLACE_PASSES; pass++) {
          settle();
          [true, false].forEach((down) => {
            const thick = [];
            for (let b = 0; b < nb; b++) {
              let end = 0;
              for (let i = 0; i < n; i++) if (bandOf[i] === b) end = Math.max(end, y[i] + across(i));
              thick.push(Math.max(ER.BAND_MIN, end + ER.BAND_PAD));
            }
            const top = [];
            thick.reduce((s, t, b) => { top[b] = s; return s + t; }, 0);
            const rs = [];
            for (let r = 0; r < R; r++) rs.push(r);
            if (!down) rs.reverse();
            rs.forEach((r) => {
              for (let b = 0; b < nb; b++) {
                const list = lists[b][r];
                if (!list.length) continue;
                const want = list.map((i) => {
                  // Only neighbours in the same band pull (a pull towards another band would only grow this one)
                  const use = nl[i].filter((e) => bandOf[e.j] === b && (down ? rank[e.j] < r : rank[e.j] > r));
                  if (!use.length) return y[i];
                  return use.reduce((s, e) => s + y[e.j] + e.theirs - e.mine, 0) / use.length;
                });
                const offs = [];
                let o = 0;
                list.forEach((i) => { offs.push(o); o += across(i) + stackGap; });
                const fit = erIsotonic(want.map((v, k) => v - offs[k]));
                list.forEach((i, k) => { y[i] = Math.round(Math.max(ER.BAND_PAD, fit[k])) + offs[k]; });
              }
            });
          });
        }
        settle();
        ents.forEach((e, i) => { e.x = rankStart[rank[i]]; e.y = Math.round(y[i]); });
        routeDiagram(data);
      }

      // Number of crossings between the routes (arrays of points). Two routes that run side by side on one track
      // (collinear overlap) cross only if the track forces them to swap sides: they arrive on opposite sides of
      // each other at one end of the shared run and leave on the opposite sides at the other end. A bend that
      // merely joins a track, or two lines that leave a shared stub in the same direction, is not a crossing.
      function erCountCrossings(routes) {
        const steps = routes.map((pts) => {
          const out = [];
          for (let k = 1; k < (pts || []).length; k++) {
            const a = pts[k - 1], b = pts[k], dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
            if (!out.length) out.push([a[0], a[1]]);
            let x = a[0], y = a[1];
            while (x !== b[0] || y !== b[1]) { x += dx; y += dy; out.push([x, y]); }
          }
          return out;
        });
        const key = (p) => (p[0] + 100000) * 1000003 + (p[1] + 100000);
        const maps = steps.map((st) => { const m = new Map(); st.forEach((p, i) => m.set(key(p), i)); return m; });
        const dir = (p, q) => [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])];
        const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        const di = (d) => DIRS.findIndex((v) => v[0] === d[0] && v[1] === d[1]);
        const between = (i, j, k) => { const a = (k - i + 4) % 4, b = (j - i + 4) % 4; return a > 0 && a < b; };
        let total = 0;
        for (let a = 0; a < steps.length; a++) {
          for (let b = a + 1; b < steps.length; b++) {
            const A = steps[a], B = steps[b], mb = maps[b];
            if (A.length < 2 || B.length < 2) continue;
            const at = A.map((p) => { const j = mb.get(key(p)); return j === undefined ? -1 : j; });
            const shareEdge = A.map((p, i) => i < A.length - 1 && at[i] >= 0 && at[i + 1] >= 0 && Math.abs(at[i] - at[i + 1]) === 1);
            for (let i = 0; i < A.length; i++) {
              if (at[i] < 0) continue;
              const inRun = shareEdge[i] || (i > 0 && shareEdge[i - 1]);
              if (inRun) {
                if (!shareEdge[i] || (i > 0 && shareEdge[i - 1])) continue;   // handle a run once, from its start
                let q = i;
                while (q < A.length - 1 && shareEdge[q]) q++;
                const t = dir(A[i], A[i + 1]);
                const side = (ray) => (ray ? Math.sign(t[0] * ray[1] - t[1] * ray[0]) : 0);
                const bp = at[i], bq = at[q], fwd = bp < bq;
                const rA_P = i > 0 ? dir(A[i], A[i - 1]) : null, rA_Q = q < A.length - 1 ? dir(A[q], A[q + 1]) : null;
                const rB_P = fwd ? (bp > 0 ? dir(B[bp], B[bp - 1]) : null) : (bp < B.length - 1 ? dir(B[bp], B[bp + 1]) : null);
                const rB_Q = fwd ? (bq < B.length - 1 ? dir(B[bq], B[bq + 1]) : null) : (bq > 0 ? dir(B[bq], B[bq - 1]) : null);
                const sAP = side(rA_P), sBP = side(rB_P), sAQ = side(rA_Q), sBQ = side(rB_Q);
                if (sAP * sBP === -1 && sAQ * sBQ === -1 && sAP !== sAQ) total++;
                i = q;
              } else if (i > 0 && i < A.length - 1 && at[i] > 0 && at[i] < B.length - 1) {
                const a1 = di(dir(A[i], A[i - 1])), a2 = di(dir(A[i], A[i + 1]));
                const b1 = di(dir(B[at[i]], B[at[i] - 1])), b2 = di(dir(B[at[i]], B[at[i] + 1]));
                if (new Set([a1, a2, b1, b2]).size === 4 && between(a1, a2, b1) !== between(a1, a2, b2)) total++;
              }
            }
          }
        }
        return total;
      }

      // Orthogonal routes between column rows, on the sparse grid of box edges, channels and stubs. See header.
      function routeDiagram(data) {
        erClearDerived(data);
        const ents = data.entities || [], rels = data.relationships || [], groups = data.groups || [];
        const TB = data.direction === 'TB';
        const hasGroups = groups.length > 0;
        const nb = hasGroups ? groups.length : 1;
        const gIdx = {};
        groups.forEach((g, i) => { gIdx[g.id] = i; });
        const idOf = {};
        ents.forEach((e, i) => { idOf[e.id] = i; });
        const bandOf = ents.map((e) => (e.group !== undefined && gIdx[e.group] !== undefined ? gIdx[e.group] : 0));
        const head = hasGroups ? ER.BAND_HEAD : 0;
        const size = ents.map((e) => erEntitySize(e, data));
        ents.forEach((e) => {
          if (typeof e.y !== 'number' || e.y < 0) e.y = ER.BAND_PAD;
          if (typeof e.x !== 'number') e.x = ER.MARGIN;
        });
        const across = (i) => (TB ? size[i].w : size[i].h);
        const thick = [], start = [];
        let acc = 0;
        for (let b = 0; b < nb; b++) {
          let end = 0;
          ents.forEach((e, i) => { if (bandOf[i] === b) end = Math.max(end, e.y + across(i)); });
          thick.push(Math.max(ER.BAND_MIN, end + ER.BAND_PAD));
          start.push(acc);
          acc += thick[b];
        }
        const boxes = ents.map((e, i) => {
          const s = size[i];
          return TB ? { x: start[bandOf[i]] + e.y, y: head + e.x, w: s.w, h: s.h } : { x: head + e.x, y: start[bandOf[i]] + e.y, w: s.w, h: s.h };
        });
        ents.forEach((e, i) => { e.box = boxes[i]; });

        // ---- anchors ----
        const P = ER.OBSTACLE_PAD;
        let maxRight = head, trackLeft = head;
        boxes.forEach((b) => { maxRight = Math.max(maxRight, b.x + b.w); });
        const infos = [];
        rels.forEach((r, ri) => {
          const fi = idOf[r.from], ti = idOf[r.to];
          if (fi === undefined || ti === undefined) return;
          const fcol = erFromCol(r, ents[fi]);
          const tcol = erToCol(r, ents[ti]);
          infos.push({ r, ri, fi, ti, self: fi === ti, fy: erRowAnchorY(ents[fi], fcol, data), ty: erRowAnchorY(ents[ti], tcol, data) });
        });
        // Free space beside a pair of boxes on one side (the clearance to the nearest other box in their vertical span)
        const clearance = (inf, side) => {
          const a = boxes[inf.fi], b = boxes[inf.ti];
          const lo = Math.min(a.y, b.y), hi = Math.max(a.y + a.h, b.y + b.h);
          const edge = side > 0 ? Math.max(a.x + a.w, b.x + b.w) : Math.min(a.x, b.x);
          let free = side > 0 ? maxRight + ER.MARGIN - edge : edge - trackLeft;
          boxes.forEach((o, k) => {
            if (k === inf.fi || k === inf.ti || o.y >= hi || o.y + o.h <= lo) return;
            if (side > 0 && o.x >= edge) free = Math.min(free, o.x - edge);
            if (side < 0 && o.x + o.w <= edge) free = Math.min(free, edge - o.x - o.w);
          });
          return free;
        };
        infos.forEach((inf) => {
          if (inf.self) { inf.sf = 1; inf.st = 1; return; }
          const a = boxes[inf.fi], b = boxes[inf.ti];
          const ac = a.x + a.w / 2, bc = b.x + b.w / 2;
          if (bc > a.x + a.w && ac < b.x) { inf.sf = 1; inf.st = -1; }
          else if (bc < a.x && ac > b.x + b.w) { inf.sf = -1; inf.st = 1; }
          else {
            const side = clearance(inf, -1) > clearance(inf, 1) ? -1 : 1;
            inf.sf = side; inf.st = side;
          }
        });
        infos.forEach((inf) => {
          const a = boxes[inf.fi], b = boxes[inf.ti];
          inf.ax = inf.sf > 0 ? a.x + a.w : a.x;
          inf.bx = inf.st > 0 ? b.x + b.w : b.x;
          if (inf.self && inf.fy === inf.ty) { inf.fy -= 6; inf.ty += 6; }
          inf.len = inf.self ? 0 : Math.abs(inf.ax - inf.bx) + Math.abs(inf.fy - inf.ty);
        });
        const order = infos.slice().sort((p, q) => p.len - q.len || p.ri - q.ri);
        // Stub lengths: lines sharing one row anchor get staggered stubs
        const shared = {}, trunkOf = {};
        let trunkCount = 0;
        order.forEach((inf) => {
          if (inf.self) return;
          const kf = inf.fi + '|' + inf.sf + '|' + inf.fy, kt = inf.ti + '|' + inf.st + '|' + inf.ty;
          const nf = shared[kf] || 0;
          shared[kf] = nf + 1;
          shared[kt] = (shared[kt] || 0) + 1;
          if (trunkOf[kt] === undefined) trunkOf[kt] = trunkCount++;
          inf.gid = trunkOf[kt] + 1;
          inf.lf = ER.STUB + (nf % 4) * ER.CHANNEL_STEP;
          inf.lt = ER.STUB;   // lines into one parent row share one trunk (see TRUNK); stub ends are ordered below
          inf.sx = inf.ax + inf.sf * inf.lf;
          inf.ex = inf.bx + inf.st * inf.lt;
        });
        // Trunk order: in one column of boxes (left to right, same left edge), a parent higher up gets its trunk further
        // out than the stub ends of the parents below it on the same side, so its trunk never cuts their stubs.
        if (!TB) {
          const tgt = new Map();
          order.forEach((inf) => { if (!inf.self) tgt.set(inf.ti + '|' + inf.st, { ti: inf.ti, st: inf.st }); });
          const byCol = new Map();
          tgt.forEach((t) => { const k = boxes[t.ti].x + '|' + t.st; if (!byCol.has(k)) byCol.set(k, []); byCol.get(k).push(t); });
          const endOf = new Map();
          byCol.forEach((list) => {
            list.sort((p, q) => boxes[q.ti].y - boxes[p.ti].y || p.ti - q.ti);
            let far = null;
            list.forEach((t) => {
              const b = boxes[t.ti], edge = t.st > 0 ? b.x + b.w : b.x;
              let end = edge + t.st * ER.STUB;
              if (far !== null) end = t.st > 0 ? Math.max(end, far + ER.CHANNEL_STEP) : Math.min(end, far - ER.CHANNEL_STEP);
              far = end;
              endOf.set(t.ti + '|' + t.st, Math.min(Math.abs(end - edge), 120));
            });
          });
          order.forEach((inf) => {
            if (inf.self) return;
            inf.lt = endOf.get(inf.ti + '|' + inf.st);
            inf.ex = inf.bx + inf.st * inf.lt;
          });
        }
        const loopCount = {};
        infos.forEach((inf) => {
          if (!inf.self) return;
          const k = loopCount[inf.fi] || 0;
          loopCount[inf.fi] = k + 1;
          inf.lx = inf.ax + 2 * ER.STUB + k * 2 * ER.CHANNEL_STEP;
        });

        // ---- grid ----
        const xset = new Set(), yset = new Set();
        const steps = [0, 1, 2];
        boxes.forEach((b) => {
          steps.forEach((k) => {
            xset.add(b.x - P - k * ER.CHANNEL_STEP); xset.add(b.x + b.w + P + k * ER.CHANNEL_STEP);
            yset.add(b.y - P - k * ER.CHANNEL_STEP); yset.add(b.y + b.h + P + k * ER.CHANNEL_STEP);
          });
        });
        // Channels: in each gap between the merged projections of the boxes, tracks around the middle
        const channels = (set, lo, hi) => {
          const iv = boxes.map((b) => [lo(b) - P, hi(b) + P]).sort((p, q) => p[0] - q[0]);
          const merged = [];
          iv.forEach((v) => {
            if (merged.length && v[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], v[1]);
            else merged.push([v[0], v[1]]);
          });
          for (let k = 1; k < merged.length; k++) {
            const a = merged[k - 1][1], b = merged[k][0], mid = Math.round((a + b) / 2);
            for (let t = -4; t <= 4; t++) {
              const v = mid + t * ER.CHANNEL_STEP;
              if (v > a + 2 && v < b - 2) set.add(v);
            }
          }
        };
        channels(xset, (b) => b.x, (b) => b.x + b.w);
        channels(yset, (b) => b.y, (b) => b.y + b.h);
        infos.forEach((inf) => {
          yset.add(inf.fy); yset.add(inf.ty);
          if (inf.self) { xset.add(inf.lx); xset.add(inf.ax + ER.STUB); } else { xset.add(inf.sx); xset.add(inf.ex); }
        });
        const xs = Array.from(xset).map(Math.round).sort((p, q) => p - q).filter((v, i, a) => !i || v !== a[i - 1]);
        const ys = Array.from(yset).map(Math.round).sort((p, q) => p - q).filter((v, i, a) => !i || v !== a[i - 1]);
        const NX = xs.length, NY = ys.length, N = NX * NY;
        const xi = new Map(), yi = new Map();
        xs.forEach((v, i) => xi.set(v, i));
        ys.forEach((v, i) => yi.set(v, i));
        const lower = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
        const blocked = new Uint8Array(N), hBlock = new Uint8Array(N), vBlock = new Uint8Array(N);
        boxes.forEach((b) => {
          const L = b.x - P, Rr = b.x + b.w + P, T = b.y - P, B = b.y + b.h + P;
          const ixA = lower(xs, L + 0.5), ixB = lower(xs, Rr - 0.5) - 1;
          const iyA = lower(ys, T + 0.5), iyB = lower(ys, B - 0.5) - 1;
          for (let iy = iyA; iy <= iyB; iy++) {
            for (let ix = ixA; ix <= ixB; ix++) blocked[iy * NX + ix] = 1;
            for (let ix = Math.max(0, ixA - 1); ix <= ixB; ix++) hBlock[iy * NX + ix] = 1;
          }
          for (let ix = ixA; ix <= ixB; ix++) {
            for (let iy = Math.max(0, iyA - 1); iy <= iyB; iy++) vBlock[iy * NX + ix] = 1;
          }
        });
        const usedH = new Int16Array(N), usedV = new Int16Array(N);   // 0 free, trunk id + 1 of the first user, -1 shared by several trunks
        const own = (cur, gid) => (cur === 0 || cur === gid ? gid : -1);
        const markSeg = (x1, y1, x2, y2, gid) => {
          if (y1 === y2) {
            const iy = yi.get(y1);
            if (iy === undefined) return;
            for (let ix = lower(xs, Math.min(x1, x2)); ix < NX - 1 && xs[ix + 1] <= Math.max(x1, x2); ix++) usedH[iy * NX + ix] = own(usedH[iy * NX + ix], gid);
          } else if (x1 === x2) {
            const ix = xi.get(x1);
            if (ix === undefined) return;
            for (let iy = lower(ys, Math.min(y1, y2)); iy < NY - 1 && ys[iy + 1] <= Math.max(y1, y2); iy++) usedV[iy * NX + ix] = own(usedV[iy * NX + ix], gid);
          }
        };
        const mark = (pts, gid) => { for (let k = 1; k < pts.length; k++) markSeg(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], gid); };

        // ---- routes ----
        const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
        const dist = new Float64Array(N * 4), parent = new Int32Array(N * 4);
        const astar = (sx, sy, sdir, gx, gy, gdir, gid) => {
          const s0 = yi.get(sy) * NX + xi.get(sx), goal = yi.get(gy) * NX + xi.get(gx);
          if (blocked[s0] || blocked[goal]) return null;
          dist.fill(Infinity); parent.fill(-1);
          let seq = 0;
          const hq = [];   // heap of [f, seq, g, state]
          const push = (f, g, s) => {
            hq.push([f, seq++, g, s]);
            let i = hq.length - 1;
            while (i > 0) {
              const p = (i - 1) >> 1;
              if (hq[p][0] < hq[i][0] || (hq[p][0] === hq[i][0] && hq[p][1] < hq[i][1])) break;
              const t = hq[p]; hq[p] = hq[i]; hq[i] = t; i = p;
            }
          };
          const pop = () => {
            const top = hq[0], last = hq.pop();
            if (hq.length) {
              hq[0] = last;
              let i = 0;
              for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                const less = (a, b) => hq[a][0] < hq[b][0] || (hq[a][0] === hq[b][0] && hq[a][1] < hq[b][1]);
                if (l < hq.length && less(l, m)) m = l;
                if (r < hq.length && less(r, m)) m = r;
                if (m === i) break;
                const t = hq[m]; hq[m] = hq[i]; hq[i] = t; i = m;
              }
            }
            return top;
          };
          const heur = (node) => ER.TRUNK * (Math.abs(xs[node % NX] - gx) + Math.abs(ys[(node / NX) | 0] - gy));
          const st0 = s0 * 4 + sdir;
          dist[st0] = 0;
          push(heur(s0), 0, st0);
          while (hq.length) {
            const [, , g, s] = pop();
            if (g > dist[s]) continue;
            const u = (s / 4) | 0, d = s & 3;
            if (u === goal) {
              const nodes = [];
              for (let c = s; c >= 0; c = parent[c]) nodes.push((c / 4) | 0);
              nodes.reverse();
              return nodes;
            }
            const ux = u % NX, uy = (u / NX) | 0;
            for (let nd = 0; nd < 4; nd++) {
              if (nd === ((d + 2) & 3)) continue;
              let v, used;
              if (nd === 0) { if (ux >= NX - 1 || hBlock[u]) continue; v = u + 1; used = usedH[u]; }
              else if (nd === 2) { if (ux <= 0 || hBlock[u - 1]) continue; v = u - 1; used = usedH[u - 1]; }
              else if (nd === 1) { if (uy >= NY - 1 || vBlock[u]) continue; v = u + NX; used = usedV[u]; }
              else { if (uy <= 0 || vBlock[u - NX]) continue; v = u - NX; used = usedV[u - NX]; }
              if (blocked[v] || (v === goal && nd === ((gdir + 2) & 3))) continue;   // never arrive from the box's side
              const len = DX[nd] ? Math.abs(xs[v % NX] - xs[ux]) : Math.abs(ys[(v / NX) | 0] - ys[uy]);
              let c = g + len;
              if (used === gid) c -= (1 - ER.TRUNK) * len;   // running along a line into the same parent row: a trunk
              else if (used) c += ER.OVERLAP * len;
              if (nd !== d) c += ER.BEND;
              else {
                const perp = DX[nd] ? [usedV[u], uy > 0 ? usedV[u - NX] : 0] : [usedH[u], ux > 0 ? usedH[u - 1] : 0];
                if (perp.some((o) => o !== 0 && o !== gid)) c += ER.CROSS;
              }
              if (v === goal && nd !== gdir) c += ER.BEND;
              const sv = v * 4 + nd;
              if (c < dist[sv]) { dist[sv] = c; parent[sv] = s; push(c + heur(v), c, sv); }
            }
          }
          return null;
        };
        const simplify = (pts) => {
          const out = [];
          pts.forEach((p) => {
            if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) return;
            out.push([p[0], p[1]]);
          });
          for (let k = out.length - 2; k > 0; k--) {
            const a = out[k - 1], b = out[k], c = out[k + 1];
            if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(k, 1);
          }
          return out;
        };
        // Pre-mark every stub and loop, so other lines see them as crossings
        order.forEach((inf) => {
          if (inf.self) return;
          markSeg(inf.ax, inf.fy, inf.sx, inf.fy, inf.gid);
          markSeg(inf.bx, inf.ty, inf.ex, inf.ty, inf.gid);
        });
        infos.forEach((inf) => {
          if (!inf.self) return;
          inf.points = [[inf.ax, inf.fy], [inf.lx, inf.fy], [inf.lx, inf.ty], [inf.ax, inf.ty]];
          mark(inf.points, 1000 + inf.ri);
        });
        order.forEach((inf) => {
          if (inf.self) return;
          const sdir = inf.sf > 0 ? 0 : 2, gdir = inf.st > 0 ? 2 : 0;
          const path = astar(inf.sx, inf.fy, sdir, inf.ex, inf.ty, gdir, inf.gid);
          let pts;
          if (path) {
            pts = [[inf.ax, inf.fy]].concat(path.map((u) => [xs[u % NX], ys[(u / NX) | 0]]), [[inf.bx, inf.ty]]);
            mark(pts.slice(1, -1), inf.gid);
          } else {
            const mx = Math.round((inf.sx + inf.ex) / 2);
            pts = [[inf.ax, inf.fy], [inf.sx, inf.fy], [mx, inf.fy], [mx, inf.ty], [inf.ex, inf.ty], [inf.bx, inf.ty]];
          }
          inf.points = simplify(pts);
        });
        infos.forEach((inf) => { inf.r.points = inf.points; });

        // ---- labels ----
        const placed = [];
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        infos.forEach((inf) => {
          const r = inf.r;
          if (r.label === undefined || r.label === null || r.label === '' || !inf.points) return;
          const w = erTextW(r.label, ER.CHAR_W) + ER.LABEL_X, h = ER.LABEL_H;
          const pts = inf.points;
          if (inf.self) {   // beside the loop, on its outer side
            r.labelBox = { x: inf.lx + 8, y: Math.round((inf.fy + inf.ty) / 2 - h / 2), w, h };
            placed.push(r.labelBox);
            return;
          }
          const segs = [];
          for (let k = 1; k < pts.length; k++) segs.push({ a: pts[k - 1], b: pts[k], len: Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]) });
          const longest = segs.map((s, k) => ({ s, k })).sort((p, q) => q.s.len - p.s.len || p.k - q.k);
          const at = (s, t) => {
            const cx = s.a[0] + (s.b[0] - s.a[0]) * t, cy = s.a[1] + (s.b[1] - s.a[1]) * t;
            return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
          };
          const fits = (c) => !boxes.some((b) => hit(c, b)) && !placed.some((p) => hit(c, p));
          let chosen = null;
          [0.5, 0.35, 0.65, 0.2, 0.8].some((t) => longest.some(({ s }) => {
            const c = at(s, t);
            if (fits(c)) { chosen = c; return true; }
            return false;
          }));
          r.labelBox = chosen || at(longest[0].s, 0.5);
          placed.push(r.labelBox);
        });

        // ---- canvas, bands, crossings ----
        let right = maxRight, bottom = 0;
        boxes.forEach((b) => { right = Math.max(right, b.x + b.w); bottom = Math.max(bottom, b.y + b.h); });
        infos.forEach((inf) => (inf.points || []).forEach((p) => { right = Math.max(right, p[0] + P); bottom = Math.max(bottom, p[1] + P); }));
        rels.forEach((r) => { if (r.labelBox) { right = Math.max(right, r.labelBox.x + r.labelBox.w); bottom = Math.max(bottom, r.labelBox.y + r.labelBox.h); } });
        let width, height;
        if (TB) { width = acc; height = Math.round(bottom + ER.MARGIN); }
        else { width = Math.round(right + ER.MARGIN); height = acc; }
        if (hasGroups) {
          groups.forEach((g, b) => { g.box = TB ? { x: start[b], y: 0, w: thick[b], h: height } : { x: 0, y: start[b], w: width, h: thick[b] }; });
        } else {
          data._band = { x: 0, y: 0, w: width, h: height };
        }
        const crossings = erCountCrossings(infos.map((inf) => inf.points || []));
        data.canvas = { width, height, crossings };
      }
