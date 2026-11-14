      // --- ERD LAYOUT ENGINE ---
      // Pure JS, no DOM access. Defines layoutDiagram(data) and routeDiagram(data) (see assets/shell/shell.js) and is run
      // by the page (Auto-Tidy, edits) and by scripts/run_engine.mjs (--layout). The Python audit in scripts/audit_erd.py
      // mirrors the constants below; keep ER in sync with it.
      //
      // Input:  detail? ("all" | "keys" | "names"), showTypes?,
      //         groups?[{id,name,color?}] (array order means nothing on screen),
      //         entities[{id,name,group?,columns?[{name,type?,pk?,fk?,unique?,nullable?,note?}],collapsed?}],
      //         relationships[{id,from,to,columns?,toColumns?,fromEnd?,toEnd?,identifying?,label?}]
      //           (from = the child table that holds the foreign key, to = the parent),
      //         layoutDiagram needs nothing else (any x/y it finds is ignored and replaced); routeDiagram needs the
      //         positions below as well. There is no "direction": a schema has no reading order (a saved one is ignored).
      // Positions (written by layoutDiagram, SAVED by the page/codec in the "layout" map: entities by id, groups by id):
      //         groups[].x / groups[].y   screen position of the group's ORIGIN: the top-left corner of its box (box.x/box.y
      //                                   equal them unless a table sits at a negative group-relative position).
      //         entities[].x / entities[].y
      //                                   - in a group: relative to the group's CONTENT origin, which is
      //                                     (group.x + GROUP_PAD, group.y + GROUP_HEAD + GROUP_PAD / 2) (erGroupOrigin(g));
      //                                     the title tab lives in the GROUP_HEAD strip above the content;
      //                                   - without a group (or an unknown group id): absolute screen coordinates.
      //         The group box is derived: the bounding box of its tables plus GROUP_PAD and the tab, anchored at the origin,
      //         so a group grows when a table is moved inside it. Group origins are saved too because the box cannot be
      //         recovered from group-relative table positions alone.
      // Output (all derived, none of it saved): entities[].box {x,y,w,h} on screen (absolute); groups[].box {x,y,w,h}
      //         (screen rect of the container including its title tab; a group without tables gets a small empty box);
      //         data._loose {x,y,w,h} (bounding rect of the ungrouped tables, absent when there are none; never drawn);
      //         relationships[].points [[x,y],...] (screen, orthogonal; first/last segment horizontal and >= STUB long,
      //         first point on the "from" box edge at its column row, last on the "to" box edge); relationships[].labelBox
      //         {x,y,w,h} when "label" is set; data.canvas {width,height,crossings,length,bends} (length = sum of the
      //         Manhattan segment lengths of all points, bends = points - 2 summed over relationships).
      // layoutDiagram(data): clears stale derived fields, places every table in a grid per group (hub in the centre,
      //         related tables next to it), packs the groups in two dimensions, writes the positions above, then
      //         routeDiagram(data). Deterministic, and it reads structure only (never x/y): laying out its own output
      //         changes nothing.
      // routeDiagram(data): from the saved positions: sizes, group boxes, screen boxes, routes and labels. Never moves an
      //         entity (a group or table without a number gets a default position).
      //
      // Notes on readings of the plan (dev/plans/plan-erd-layout-v2.md):
      //  - The plan says positions are "relative to the group box" while the box is derived from them; resolved by saving
      //    the group origin (groups[].x/y) as described above.
      //  - Placement order inside a group is "most connected to the tables already placed" (ties: degree, authored order),
      //    not plain degree order: it keeps a table's strongest neighbour next to it. Degree still picks the hub.
      //  - Grid shapes: a few candidate cols x rows per group are kept and the packing (step 4) chooses among them with
      //    the aspect/area terms, instead of fixing cols by a formula first. GROUP_ASPECT is the shape score's own target.
      //  - TARGET_ASPECT_LARGE: a schema too big for the view aims below the MAX_ASPECT_LARGE cap, leaving room for routes.
      //  - Empty grid columns and rows (after swaps) are dropped, so a group box always hugs its tables.
      //  - Order and cells use structure only, so "detail" and "collapsed" change sizes (and pixel positions with them)
      //    but not the table-to-cell assignment of a group, except through the shape choice of the packing, which sees sizes.
      //  - A stub may be longer than STUB (up to 3 * CHANNEL_STEP more) where several lines share one row anchor, so their
      //    first vertical runs sit in separate tracks.
      const ER = {
        HEAD_H: 36, ROW_H: 26, MORE_H: 22,          // header strip, one column row, the "+ N more" row (keys detail)
        CHAR_W: 7.4, TYPE_CHAR_W: 6.6,              // name text and the muted type text
        PAD_X: 12, GLYPH_W: 22, TYPE_GAP: 16,       // left padding, key-glyph column, gap between name and type
        MIN_W: 168, MAX_W: 360,                     // entity box width bounds
        LABEL_PAD: 32,                              // a column gap is widened to fit the widest label across it + LABEL_PAD
        CELL_GAP_X: 112, CELL_GAP_Y: 64,             // between grid cells inside a group (X widened to fit labels + LABEL_PAD)
        GROUP_PAD: 32, GROUP_HEAD: 32,              // inner padding of a group box, and its title tab strip (above the content)
        GROUP_GAP: 88,                              // between group boxes
        EMPTY_W: 160, EMPTY_H: 48,                  // content size of a group without tables
        TARGET_ASPECT: 2.0, MIN_ASPECT: 1.0, MAX_ASPECT_LARGE: 1.9, TARGET_ASPECT_LARGE: 1.8,
        VIEW_W: 1760, VIEW_H: 856,                  // the page's Fit area on a 1080p screen (decides "large")
        GROUP_ASPECT: 1.4,                          // aspect a single group's grid aims for (the packing refines it)
        SWAP_PASSES: 6, PERM_MAX: 5, CENTRAL_W: 0.8, EVEN_COLS_PEN: 0.3, CANDIDATES: 3, SHAPES: 4, BEND_W: 40, CROSS_W: 600, FINAL_AREA_W: 3, STARTS: 6, DETOUR: 1, PACK_PASSES: 2,
        ASPECT_W: 5, AREA_W: 12,                 // packing: weight of the aspect and bounding-box area terms
        MARGIN: 40, STUB: 20, CHANNEL_STEP: 8, OBSTACLE_PAD: 12, GRID: 4,
        // Router cost model (engine-only; the audit does not need these)
        BEND: 40, CROSS: 400, OVERLAP: 6, TRUNK: 0.8,   // OVERLAP: extra cost per unit of length run over an earlier line
        LABEL_H: 22, LABEL_X: 16, MIN_TRACK: 6
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
        delete data._loose;
        delete data._band;
      }

      // Group box helpers (shared by layoutDiagram and routeDiagram, so the two always agree)
      const erTabW = (g) => erTextW(erName(g), ER.CHAR_W) + 40;
      function erGroupSize(cw, ch, g) {
        return { w: Math.max(cw + 2 * ER.GROUP_PAD, erTabW(g)), h: ER.GROUP_HEAD + ER.GROUP_PAD / 2 + ch + ER.GROUP_PAD };
      }
      // Screen position of a group's content origin (where its tables' x/y = 0,0 is)
      function erGroupOrigin(g) {
        return { x: (g.x || 0) + ER.GROUP_PAD, y: (g.y || 0) + ER.GROUP_HEAD + ER.GROUP_PAD / 2 };
      }

      // Distance between two grid cells (dx, dy in cells) at the group's pitch: Manhattan, plus a detour charge when the two
      // cells share a row or column but are not neighbours (the line has to go around the tables between them)
      function erCellDist(it, dx, dy) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        let d = ax * it.px + ay * it.py;
        if ((ax >= 2 && ay === 0) || (ay >= 2 && ax === 0)) d += ER.DETOUR * (ax ? it.py : it.px);
        return d;
      }

      function layoutDiagram(data) {
        erClearDerived(data);
        const ents = data.entities || [], rels = data.relationships || [], groups = data.groups || [];
        const n = ents.length, ng = groups.length;
        const idOf = {};
        ents.forEach((e, i) => { idOf[e.id] = i; });
        const gIdx = {};
        groups.forEach((g, i) => { gIdx[g.id] = i; });
        const gOf = ents.map((e) => (e.group !== undefined && gIdx[e.group] !== undefined ? gIdx[e.group] : ng));
        if (!n && !ng) { routeDiagram(data); return; }
        // Cells (shapes, arrangements, group neighbours) are decided on the tables' full-detail size, so that "detail" and
        // "collapsed" never change which cell a table is in; the pixel layout and the final packing use the real sizes.
        const actual = ents.map((e) => erEntitySize(e, data));
        const logical = ents.map((e) => erEntitySize(Object.assign({}, e, { collapsed: false }), { detail: 'all', showTypes: true }));
        let size = logical;

        // 1. Weights: 1 per relationship between two different tables; degree; neighbour lists (ascending index)
        const wm = ents.map(() => ({}));
        rels.forEach((r) => {
          const i = idOf[r.from], j = idOf[r.to];
          if (i === undefined || j === undefined || i === j) return;
          wm[i][j] = (wm[i][j] || 0) + 1;
          wm[j][i] = (wm[j][i] || 0) + 1;
        });
        const adj = wm.map((o) => Object.keys(o).map(Number).sort((a, b) => a - b).map((j) => ({ j, w: o[j] })));
        const deg = adj.map((a) => a.reduce((s, x) => s + x.w, 0));
        const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[(s.length - 1) >> 1] : 0; };

        // Items: one per group, plus the loose (ungrouped) tables as a group of their own without a box
        const items = [];
        for (let k = 0; k <= ng; k++) {
          const tabs = [];
          for (let i = 0; i < n; i++) if (gOf[i] === k) tabs.push(i);
          if (k === ng && !tabs.length) continue;
          const it = { k, tabs, boxed: k < ng, g: groups[k] || null, has: {} };
          tabs.forEach((i) => { it.has[i] = true; });
          it.px = median(tabs.map((i) => size[i].w)) + ER.CELL_GAP_X;
          it.py = median(tabs.map((i) => size[i].h)) + ER.CELL_GAP_Y;
          items.push(it);
        }
        const itemOf = {};
        items.forEach((it, a) => it.tabs.forEach((i) => { itemOf[i] = a; }));
        // Group affinity: aff[a][b] = aff[b][a] = number of relationships between the two groups
        const aff = items.map(() => items.map(() => 0));
        adj.forEach((list, i) => list.forEach((x) => { if (itemOf[i] !== itemOf[x.j]) aff[itemOf[i]][itemOf[x.j]] += x.w; }));

        // 2. Grid shapes: the few best cols x rows per group by aspect, wasted cells and an exact centre
        const shapesOf = (it) => {
          const m = it.tabs.length;
          if (!m) return [{ cols: 0, rows: 0 }];
          const all = [];
          for (let cols = 1; cols <= m; cols++) {
            for (let extra = 0; extra <= 1; extra++) {
              const rows = Math.ceil(m / cols) + extra;
              if (extra && !(cols % 2 === 1 && rows % 2 === 1)) continue;
              const cells = cols * rows, empty = cells - m;
              if (empty > Math.max(1, Math.floor(cells * 0.4))) continue;
              const aspect = (cols * it.px) / (rows * it.py);
              const score = Math.abs(Math.log(aspect / ER.GROUP_ASPECT)) + 1.2 * (empty / cells) - (cols % 2 === 1 && rows % 2 === 1 && m > 2 ? 0.08 : 0) + (m >= 4 && cols % 2 === 0 ? ER.EVEN_COLS_PEN : 0);
              all.push({ cols, rows, score });
            }
          }
          all.sort((p, q) => p.score - q.score || p.cols - q.cols || p.rows - q.rows);
          return all.slice(0, ER.SHAPES);
        };

        // 3. Place inside a group: hub in the centre, then each table at the free cell nearest to its placed neighbours;
        //    then deterministic swap passes. Distances are Manhattan in pixels at the group's cell pitch.
        const greedy = (it, shape, start) => {
          const { cols, rows } = shape, cells = cols * rows;
          const cx = (c) => c % cols, cy = (c) => (c / cols) | 0;
          const mid = ((rows - 1) >> 1) * cols + ((cols - 1) >> 1);
          const dist = (a, b) => erCellDist(it, cx(a) - cx(b), cy(a) - cy(b));
          const cell = new Array(cells).fill(-1), at = {};
          const rest = it.tabs.slice();
          let first = true;
          while (rest.length) {
            const link = (t) => adj[t].reduce((s, x) => (at[x.j] !== undefined ? s + x.w : s), 0);
            let bi = 0;
            for (let q = 1; q < rest.length; q++) {
              const a = rest[q], b = rest[bi];
              const better = first ? (start !== undefined ? (a === start) : deg[a] > deg[b]) : (link(a) > link(b) || (link(a) === link(b) && deg[a] > deg[b]));
              if (better) bi = q;
            }
            const t = rest.splice(bi, 1)[0];
            let best = -1, bc = Infinity, bd = Infinity;
            if (first) best = mid;
            else {
              for (let c = 0; c < cells; c++) {
                if (cell[c] >= 0) continue;
                let cost = 0;
                adj[t].forEach((x) => { if (at[x.j] !== undefined) cost += x.w * dist(c, at[x.j]); });
                const dc = dist(c, mid);
                if (cost < bc - 1e-9 || (Math.abs(cost - bc) <= 1e-9 && dc < bd - 1e-9)) { best = c; bc = cost; bd = dc; }
              }
            }
            cell[best] = t; at[t] = best;
            first = false;
          }
          return cell;
        };
        // pull(t, c): extra cost of table t sitting in cell c (neighbours in other groups); null in the first pass
        const improve = (it, shape, cell, pull) => {
          const { cols } = shape, cells = cell.length;
          const cx = (c) => c % cols, cy = (c) => (c / cols) | 0;
          const at = {};
          cell.forEach((t, c) => { if (t >= 0) at[t] = c; });
          const total = () => {
            let s = 0;
            for (let c = 0; c < cells; c++) {
              const t = cell[c];
              if (t < 0) continue;
              adj[t].forEach((x) => { if (it.has[x.j] && x.j > t) s += x.w * erCellDist(it, cx(c) - cx(at[x.j]), cy(c) - cy(at[x.j])); });
              s += ER.CENTRAL_W * deg[t] * (Math.abs(cx(c) - (cols - 1) / 2) * it.px + Math.abs(cy(c) - (cells / cols - 1) / 2) * it.py);
              if (pull) s += pull(t, c);
            }
            return s;
          };
          for (let pass = 0; pass < ER.SWAP_PASSES; pass++) {
            let changed = false;
            for (let a = 0; a < cells; a++) {
              for (let b = a + 1; b < cells; b++) {
                if (cell[a] < 0 && cell[b] < 0) continue;
                const before = total();
                const ta = cell[a], tb = cell[b];
                cell[a] = tb; cell[b] = ta;
                if (tb >= 0) at[tb] = a;
                if (ta >= 0) at[ta] = b;
                if (total() < before - 1e-9) changed = true;
                else {
                  cell[a] = ta; cell[b] = tb;
                  if (ta >= 0) at[ta] = a;
                  if (tb >= 0) at[tb] = b;
                }
              }
            }
            if (!changed) break;
          }
          return cell;
        };

        const internalCost = (it, shape, cell) => {
          const at = {};
          cell.forEach((t, c) => { if (t >= 0) at[t] = c; });
          let s = 0;
          it.tabs.forEach((t) => { s += ER.CENTRAL_W * deg[t] * (Math.abs((at[t] % shape.cols) - (shape.cols - 1) / 2) * it.px + Math.abs(((at[t] / shape.cols) | 0) - (shape.rows - 1) / 2) * it.py); });
          it.tabs.forEach((t) => adj[t].forEach((x) => { if (it.has[x.j] && x.j > t) s += x.w * erCellDist(it, (at[t] % shape.cols) - (at[x.j] % shape.cols), ((at[t] / shape.cols) | 0) - ((at[x.j] / shape.cols) | 0)); }));
          return s;
        };

        // 5 (first half). Pixel layout of one arrangement: empty columns/rows dropped, widths and heights per column/row,
        //    tables centred in their column and top-aligned in their row. rel[t] = {x, y} relative to the content origin.
        const pixels = (it, shape, cell) => {
          const { cols, rows } = shape;
          if (!it.tabs.length) return { cw: ER.EMPTY_W, ch: ER.EMPTY_H, rel: {} };
          const colOf = {}, rowOf = {};
          cell.forEach((t, c) => { if (t >= 0) { colOf[t] = c % cols; rowOf[t] = (c / cols) | 0; } });
          const usedC = [], usedR = [];
          for (let c = 0; c < cols; c++) if (it.tabs.some((t) => colOf[t] === c)) usedC.push(c);
          for (let r = 0; r < rows; r++) if (it.tabs.some((t) => rowOf[t] === r)) usedR.push(r);
          const colW = {}, rowH = {}, gapAfter = {};
          usedC.forEach((c) => { colW[c] = 0; gapAfter[c] = ER.CELL_GAP_X; });
          usedR.forEach((r) => { rowH[r] = 0; });
          it.tabs.forEach((t) => { colW[colOf[t]] = Math.max(colW[colOf[t]], size[t].w); rowH[rowOf[t]] = Math.max(rowH[rowOf[t]], size[t].h); });
          rels.forEach((r) => {
            if (r.label === undefined || r.label === null || r.label === '') return;
            const a = idOf[r.from], b = idOf[r.to];
            if (a === undefined || b === undefined || !it.has[a] || !it.has[b]) return;
            const need = erTextW(r.label, ER.CHAR_W) + ER.LABEL_X + ER.LABEL_PAD;
            const ca = Math.min(colOf[a], colOf[b]), cb = Math.max(colOf[a], colOf[b]);
            const next = usedC[usedC.indexOf(ca) + 1];
            if (a === b) { if (next !== undefined) gapAfter[ca] = Math.max(gapAfter[ca], need + 2 * ER.STUB + 4 * ER.CHANNEL_STEP); }   // a self-reference's label sits beside its loop
            else if (ca === cb) { if (next !== undefined) gapAfter[ca] = Math.max(gapAfter[ca], need); }   // a C-shaped line beside a column
            else if (next === cb) gapAfter[ca] = Math.max(gapAfter[ca], need);
          });
          // Vertical slack: in one row, a table is moved down so that the row anchors of a relationship between two
          // neighbouring columns line up, and the line runs straight (no bends). The hub's row is the reference.
          const offOf = (t, col) => (size === actual ? erRowOffset(ents[t], col, data)
            : erRowOffset(Object.assign({}, ents[t], { collapsed: false }), col, { detail: 'all', showTypes: true }));
          const dy = {}, touched = {};
          it.tabs.forEach((t) => { dy[t] = 0; });
          const pairs = [];
          rels.forEach((r) => {
            const a = idOf[r.from], b = idOf[r.to];
            if (a === undefined || b === undefined || a === b || !it.has[a] || !it.has[b] || rowOf[a] !== rowOf[b]) return;
            if (Math.abs(usedC.indexOf(colOf[a]) - usedC.indexOf(colOf[b])) !== 1) return;
            pairs.push({ a, b, oa: offOf(a, erFromCol(r, ents[a])), ob: offOf(b, erToCol(r, ents[b])) });
          });
          pairs.sort((p, q) => (deg[q.a] + deg[q.b]) - (deg[p.a] + deg[p.b]));   // stable: the busiest tables fix their row first
          pairs.forEach((p) => {
            const need = (t, off, other, offOther) => dy[other] + offOther - off;   // dy of t so that its anchor meets the other's
            if (!touched[p.a] && !touched[p.b]) {
              if (p.oa < p.ob) dy[p.a] = p.ob - p.oa; else dy[p.b] = p.oa - p.ob;
              touched[p.a] = touched[p.b] = true;
            } else if (touched[p.a] !== touched[p.b]) {
              const t = touched[p.a] ? p.b : p.a, o = touched[p.a] ? p.a : p.b;
              const v = need(t, t === p.a ? p.oa : p.ob, o, o === p.a ? p.oa : p.ob);
              if (v >= 0 && v <= 3 * ER.ROW_H) { dy[t] = v; touched[t] = true; }
            }
          });
          it.tabs.forEach((t) => { if (dy[t] > 3 * ER.ROW_H) dy[t] = 0; rowH[rowOf[t]] = Math.max(rowH[rowOf[t]], dy[t] + size[t].h); });
          const colX = {}, rowY = {};
          let x = 0;
          usedC.forEach((c, k) => { colX[c] = x; x += colW[c] + (k < usedC.length - 1 ? gapAfter[c] : 0); });
          const cw = x;
          let y = 0;
          usedR.forEach((r, k) => { rowY[r] = y; y += rowH[r] + (k < usedR.length - 1 ? ER.CELL_GAP_Y : 0); });
          const ch = y;
          const rel = {};
          it.tabs.forEach((t) => { rel[t] = { x: colX[colOf[t]] + Math.round((colW[colOf[t]] - size[t].w) / 2), y: rowY[rowOf[t]] + dy[t] }; });
          return { cw, ch, rel };
        };
        const rectOf = (it, pix) => (it.boxed ? erGroupSize(pix.cw, pix.ch, it.g) : { w: pix.cw, h: pix.ch });

        // Options per item: shape + arrangement + pixel layout + rect
        items.forEach((it) => {
          it.opts = shapesOf(it).map((shape) => {
            let cell = [];
            if (it.tabs.length) {
              // Several starts (each of the most connected tables as the hub-in-the-centre), the cheapest arrangement wins
              const starts = it.tabs.slice().sort((p, q) => deg[q] - deg[p] || p - q).slice(0, ER.STARTS);
              let bc = Infinity;
              starts.forEach((t0) => {
                const c = improve(it, shape, greedy(it, shape, t0), null);
                const cost = internalCost(it, shape, c);
                if (cost < bc - 1e-9) { bc = cost; cell = c; }
              });
            }
            const pix = pixels(it, shape, cell);
            return { shape, cell, pix, rect: rectOf(it, pix) };
          });
        });

        // 4. Pack the groups: seed group first, then the one with the most weight to those placed; each at the candidate
        //    position (touching a placed rectangle on any side, or aligned to the bounding box) of least cost.
        const totalArea = items.reduce((s, it) => s + it.opts[0].rect.w * it.opts[0].rect.h, 0);
        const large = totalArea > ER.VIEW_W * ER.VIEW_H * 0.6;
        const target = large ? ER.TARGET_ASPECT_LARGE : Math.min(ER.TARGET_ASPECT, Math.max(ER.MIN_ASPECT, ER.TARGET_ASPECT));
        const S = Math.sqrt(totalArea) || 1;
        // aspect: free inside [MIN_ASPECT, target], a penalty per unit of log aspect outside it; area: smaller is better
        const shapeCost = (bw, bh) => {
          const la = Math.log(bw / bh);
          return ER.ASPECT_W * S * Math.max(0, la - Math.log(target), Math.log(ER.MIN_ASPECT * 1.2) - la) + ER.AREA_W * (bw * bh) / S;
        };
        const GAP = ER.GROUP_GAP;
        const rectAt = (p) => ({ x: p.x, y: p.y, w: p.o.rect.w, h: p.o.rect.h });
        const overlaps = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
        const union = (bb, r) => {
          if (!bb) return { x: r.x, y: r.y, w: r.w, h: r.h };
          const x = Math.min(bb.x, r.x), y = Math.min(bb.y, r.y);
          return { x, y, w: Math.max(bb.x + bb.w, r.x + r.w) - x, h: Math.max(bb.y + bb.h, r.y + r.h) - y };
        };
        // optOf[a] = candidate options of item a; returns {pos: [{x,y,o}], cost}
        const pack = (optOf, seed, order) => {
          const pos = items.map(() => null);
          const done = [];
          let bb = null;
          const left = items.map((_, a) => a);
          while (left.length) {
            let a = order ? order[done.length] : seed;
            if (done.length && !order) {
              let bw = -1, bs = -1;
              left.forEach((q) => {
                const w = done.reduce((s, d) => s + aff[q][d], 0), sz = items[q].tabs.length;
                if (w > bw || (w === bw && sz > bs)) { a = q; bw = w; bs = sz; }
              });
            }
            left.splice(left.indexOf(a), 1);
            let best = null;
            optOf[a].forEach((o) => {
              const w = o.rect.w, h = o.rect.h;
              const cands = [];
              if (!done.length) cands.push([0, 0]);
              done.forEach((q) => {
                const P = rectAt(pos[q]);
                [P.y, P.y + P.h - h, Math.round(P.y + (P.h - h) / 2), bb.y, bb.y + bb.h - h].forEach((y) => { cands.push([P.x + P.w + GAP, y], [P.x - GAP - w, y]); });
                [P.x, P.x + P.w - w, Math.round(P.x + (P.w - w) / 2), bb.x, bb.x + bb.w - w].forEach((x) => { cands.push([x, P.y + P.h + GAP], [x, P.y - GAP - h]); });
              });
              cands.forEach((c) => {
                const r = { x: c[0], y: c[1], w, h };
                if (done.some((q) => overlaps(r, rectAt(pos[q])))) return;
                const u = union(bb, r);
                let cost = shapeCost(u.w, u.h);
                done.forEach((q) => {
                  if (!aff[a][q]) return;
                  const P = rectAt(pos[q]);
                  cost += aff[a][q] * (Math.abs(r.x + w / 2 - (P.x + P.w / 2)) + Math.abs(r.y + h / 2 - (P.y + P.h / 2)));
                });
                if (!best || cost < best.cost - 1e-9) best = { cost, x: r.x, y: r.y, o };
              });
            });
            pos[a] = { x: best.x, y: best.y, o: best.o };
            done.push(a);
            bb = union(bb, rectAt(pos[a]));
          }
          let cost = shapeCost(bb.w, bb.h);
          for (let a = 0; a < items.length; a++) {
            for (let b = a + 1; b < items.length; b++) {
              if (!aff[a][b]) continue;
              const A = rectAt(pos[a]), B = rectAt(pos[b]);
              cost += aff[a][b] * (Math.abs(A.x + A.w / 2 - B.x - B.w / 2) + Math.abs(A.y + A.h / 2 - B.y - B.h / 2));
            }
          }
          return { pos, cost };
        };
        // Orders: the affinity order from each seed; with few groups (full) every order, so a hub group can end up in the middle
        const packAll = (optOf, full) => {
          const all = items.map((_, seed) => pack(optOf, seed));
          if (full && items.length >= 3 && items.length <= ER.PERM_MAX) {
            const perm = (rest, acc) => {
              if (!rest.length) { all.push(pack(optOf, acc[0], acc)); return; }
              rest.forEach((q, i) => perm(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat(q)));
            };
            perm(items.map((_, a) => a), []);
          }
          all.sort((p, q) => p.cost - q.cost);   // stable: ties keep seed order
          return all;
        };
        const packBest = (optOf) => packAll(optOf)[0];
        const originOf = (it, P) => ({ x: P.x + (it.boxed ? ER.GROUP_PAD : 0), y: P.y + (it.boxed ? ER.GROUP_HEAD + ER.GROUP_PAD / 2 : 0) });
        // Centre of every table in a packing
        const centres = (pk) => {
          const c = {};
          items.forEach((it, a) => {
            const P = pk.pos[a], o = originOf(it, P);
            it.tabs.forEach((t) => { c[t] = { x: o.x + P.o.pix.rel[t].x + size[t].w / 2, y: o.y + P.o.pix.rel[t].y + size[t].h / 2 }; });
          });
          return c;
        };
        // The estimate used to compare packings: relationship lengths between table centres plus the shape terms
        const estimate = (pk) => {
          const c = centres(pk);
          let s = 0;
          adj.forEach((list, i) => list.forEach((x) => { if (x.j > i) s += x.w * (Math.abs(c[i].x - c[x.j].x) + Math.abs(c[i].y - c[x.j].y)); }));
          let bb = null;
          items.forEach((_, a) => { bb = union(bb, rectAt(pk.pos[a])); });
          return s + shapeCost(bb.w, bb.h);
        };

        // Candidate arrangements (shapes + cells per group), in order of preference; the best of them by the routed result wins
        const pool = [];
        const addPool = (pk) => {
          const sig = JSON.stringify(pk.pos.map((p) => [p.o.shape.cols, p.o.cell]));
          if (!pool.some((q) => q.sig === sig)) pool.push({ pk, sig });
        };
        // Coordinate descent on the shape of each group (positions re-packed each time), by the estimate
        const descend = (pk) => {
          let best = pk, est = estimate(pk);
          for (let iter = 0; iter < 2; iter++) {
            let improved = false;
            items.forEach((it, a) => {
              it.opts.forEach((o) => {
                if (o === best.pos[a].o) return;
                const r = packBest(items.map((q, b) => (b === a ? [o] : [best.pos[b].o])));
                const e = estimate(r);
                if (e < est - 1e-9) { est = e; best = r; improved = true; }
              });
            });
            if (!improved) break;
          }
          return best;
        };
        const first = packAll(items.map((it) => it.opts), true);
        const seeds = [descend(first[0]), first[0], first[1]].filter(Boolean);
        seeds.forEach((f) => {
          addPool(f);
          let cur = f;
          for (let round = 0; round < ER.PACK_PASSES; round++) {
            // Second swap pass, other groups fixed: neighbours in other groups pull towards the side facing them
            const c = centres(cur);
            const fixed = items.map((it, a) => {
              const o = cur.pos[a].o;
              if (!it.tabs.length) return [o];
              const org = originOf(it, cur.pos[a]);
              const { cols } = o.shape;
              const pull = (t, cc) => {
                const X = org.x + ((cc % cols) + 0.5) * it.px - ER.CELL_GAP_X / 2, Y = org.y + (((cc / cols) | 0) + 0.5) * it.py - ER.CELL_GAP_Y / 2;
                let s = 0;
                adj[t].forEach((x) => { if (!it.has[x.j]) s += x.w * (Math.abs(X - c[x.j].x) + Math.abs(Y - c[x.j].y)); });
                return s;
              };
              const cell = improve(it, o.shape, o.cell.slice(), pull);
              const pix = pixels(it, o.shape, cell);
              return [{ shape: o.shape, cell, pix, rect: rectOf(it, pix) }];
            });
            cur = packBest(fixed);
            addPool(cur);
          }
        });

        // Gravity: slide groups left, then up, into holes left by the packing, while the estimate does not get worse
        const compact = (pk) => {
          const pos = pk.pos.map((p) => ({ x: p.x, y: p.y, o: p.o }));
          let est = estimate({ pos });
          for (let iter = 0; iter < 3; iter++) {
            let moved = false;
            items.forEach((_, a) => {
              [0, 1].forEach((axis) => {
                const R = rectAt(pos[a]);
                let lim = Infinity;
                items.forEach((_, q) => { lim = Math.min(lim, axis ? pos[q].y : pos[q].x); });
                items.forEach((_, q) => {
                  if (q === a) return;
                  const B = rectAt(pos[q]);
                  if (axis === 0 && R.y < B.y + B.h + GAP && B.y < R.y + R.h + GAP && B.x + B.w <= R.x) lim = Math.max(lim, B.x + B.w + GAP);
                  if (axis === 1 && R.x < B.x + B.w + GAP && B.x < R.x + R.w + GAP && B.y + B.h <= R.y) lim = Math.max(lim, B.y + B.h + GAP);
                });
                const cur0 = axis ? R.y : R.x;
                if (lim >= cur0) return;
                const old = axis ? pos[a].y : pos[a].x;
                if (axis) pos[a].y = lim; else pos[a].x = lim;
                const e2 = estimate({ pos });
                if (e2 <= est + 1e-9) { est = e2; moved = true; }
                else if (axis) pos[a].y = old; else pos[a].x = old;
              });
            });
            if (!moved) break;
          }
          return { pos, cost: pk.cost };
        };

        // Final stage per candidate: pack with the real sizes and the arrangements fixed, gravity, write, route; keep the
        // candidate with the best routed result (length, bends, crossings, canvas shape). Time: one route per candidate.
        const K = n <= 40 ? ER.CANDIDATES : n <= 80 ? 2 : 1;
        const writePk = (pk) => {
          let mx = Infinity, my = Infinity;
          items.forEach((_, a) => { mx = Math.min(mx, pk.pos[a].x); my = Math.min(my, pk.pos[a].y); });
          items.forEach((it, a) => {
            const P = pk.pos[a], x0 = Math.round(P.x - mx + ER.MARGIN), y0 = Math.round(P.y - my + ER.MARGIN);
            if (it.boxed) { it.g.x = x0; it.g.y = y0; }
            it.tabs.forEach((t) => {
              const r = P.o.pix.rel[t];
              ents[t].x = it.boxed ? r.x : x0 + r.x;
              ents[t].y = it.boxed ? r.y : y0 + r.y;
            });
          });
        };
        // Pack with the arrangements of a candidate fixed, at the current `size`: gravity included
        const finalPack = (cand) => {
          const fixed = items.map((it, a) => {
            const o = cand.pk.pos[a].o;
            const pix = pixels(it, o.shape, o.cell);
            return [{ shape: o.shape, cell: o.cell, pix, rect: rectOf(it, pix) }];
          });
          return compact(packBest(fixed));
        };
        // Which candidate arrangement wins is decided on the full-detail view (so "detail" and "collapsed" never change
        // a cell): pack, write and route each of the best K by estimate with the reference sizes, score the routed result
        const finals = pool.map((cand) => ({ cand, pk: finalPack(cand) }));
        finals.forEach((f) => { f.est = estimate(f.pk); });
        finals.sort((p, q) => p.est - q.est);
        const keep = { detail: data.detail, showTypes: data.showTypes, hadDetail: 'detail' in data, hadTypes: 'showTypes' in data };
        const collapsed = ents.map((e) => e.collapsed);
        data.detail = 'all'; data.showTypes = true;
        ents.forEach((e) => { if (e.collapsed !== undefined) e.collapsed = false; });
        let best = null;
        finals.slice(0, K).forEach((f) => {
          writePk(f.pk);
          routeDiagram(data);
          const c = data.canvas;
          const score = c.length + ER.BEND_W * c.bends + ER.CROSS_W * c.crossings + ER.FINAL_AREA_W * c.width * c.height / S;
          if (!best || score < best.score - 1e-9) best = { score, f };
        });
        if (keep.hadDetail) data.detail = keep.detail; else delete data.detail;
        if (keep.hadTypes) data.showTypes = keep.showTypes; else delete data.showTypes;
        ents.forEach((e, i) => { if (collapsed[i] !== undefined) e.collapsed = collapsed[i]; });
        // The winner again with the real sizes, written and routed for good
        size = actual;
        writePk(finalPack(best.f.cand));
        routeDiagram(data);
      }

      // Number of crossings between the routes (arrays of points). Two routes that run side by side on one track
      // (collinear overlap) cross only if the track forces them to swap sides: they arrive on opposite sides of
      // each other at one end of the shared run and leave on the opposite sides at the other end. A bend that
      // merely joins a track, or two lines that leave a shared stub in the same direction, is not a crossing.
      function erCountCrossings(routes0) {
        // Coordinate compression: every crossing or shared run sits on coordinates that are vertices of the routes, so
        // the topology is the same on the grid of distinct x and y values (a unit step = the next distinct value)
        const xv = [], yv = [];
        routes0.forEach((pts) => (pts || []).forEach((p) => { xv.push(p[0]); yv.push(p[1]); }));
        const uniq = (a) => a.sort((p, q) => p - q).filter((v, i, r) => !i || v !== r[i - 1]);
        const ux = uniq(xv), uy = uniq(yv);
        const xr = new Map(), yr = new Map();
        ux.forEach((v, i) => xr.set(v, i)); uy.forEach((v, i) => yr.set(v, i));
        const routes = routes0.map((pts) => (pts || []).map((p) => [xr.get(p[0]), yr.get(p[1])]));
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
        const gIdx = {};
        groups.forEach((g, i) => { gIdx[g.id] = i; });
        const idOf = {};
        ents.forEach((e, i) => { idOf[e.id] = i; });
        const gOf = ents.map((e) => (e.group !== undefined && gIdx[e.group] !== undefined ? gIdx[e.group] : -1));
        const size = ents.map((e) => erEntitySize(e, data));
        // Defaults for a position that is missing (a table or group that was never laid out); nothing is ever moved
        groups.forEach((g) => { if (typeof g.x !== 'number') g.x = ER.MARGIN; if (typeof g.y !== 'number') g.y = ER.MARGIN; });
        // Whole pixels only: the router's grid search assumes integer coordinates and does not terminate on fractional
        // ones (a hand-edited or dragged position). Rounding here guards every caller (page, --layout, --verify).
        groups.forEach((g) => { if (Number.isFinite(g.x)) g.x = Math.round(g.x); if (Number.isFinite(g.y)) g.y = Math.round(g.y); });
        ents.forEach((e) => { if (Number.isFinite(e.x)) e.x = Math.round(e.x); if (Number.isFinite(e.y)) e.y = Math.round(e.y); });
        ents.forEach((e, i) => {
          if (typeof e.x !== 'number') e.x = gOf[i] < 0 ? ER.MARGIN : 0;
          if (typeof e.y !== 'number') e.y = gOf[i] < 0 ? ER.MARGIN : 0;
        });
        const boxes = ents.map((e, i) => {
          const s = size[i];
          if (gOf[i] < 0) return { x: e.x, y: e.y, w: s.w, h: s.h };
          const o = erGroupOrigin(groups[gOf[i]]);
          return { x: o.x + e.x, y: o.y + e.y, w: s.w, h: s.h };
        });
        ents.forEach((e, i) => { e.box = boxes[i]; });
        // Group boxes: the bounding box of the group's tables plus padding and the tab, anchored at the group origin
        groups.forEach((g, k) => {
          let minX = 0, minY = 0, maxR = 0, maxB = 0, any = false;
          ents.forEach((e, i) => {
            if (gOf[i] !== k) return;
            any = true;
            minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
            maxR = Math.max(maxR, e.x + size[i].w); maxB = Math.max(maxB, e.y + size[i].h);
          });
          const sz = erGroupSize(any ? maxR - minX : ER.EMPTY_W, any ? maxB - minY : ER.EMPTY_H, g);
          g.box = { x: g.x + minX, y: g.y + minY, w: sz.w, h: sz.h };
        });
        let lx1 = Infinity, ly1 = Infinity, lx2 = -Infinity, ly2 = -Infinity;
        boxes.forEach((b, i) => {
          if (gOf[i] >= 0) return;
          lx1 = Math.min(lx1, b.x); ly1 = Math.min(ly1, b.y); lx2 = Math.max(lx2, b.x + b.w); ly2 = Math.max(ly2, b.y + b.h);
        });
        if (lx1 !== Infinity) data._loose = { x: lx1, y: ly1, w: lx2 - lx1, h: ly2 - ly1 };

        // ---- anchors ----
        const P = ER.OBSTACLE_PAD;
        let maxRight = 0, trackLeft = 0;
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
        {
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
        // Tracks closer than MIN_TRACK would run as one visible line with a tiny jog between them: keep the first of
        // such a cluster, but never drop a required value (anchor rows, stub ends, loops)
        const need = new Set();
        infos.forEach((inf) => {
          need.add('y' + Math.round(inf.fy)); need.add('y' + Math.round(inf.ty));
          if (inf.self) { need.add('x' + Math.round(inf.lx)); need.add('x' + Math.round(inf.ax + ER.STUB)); } else { need.add('x' + Math.round(inf.sx)); need.add('x' + Math.round(inf.ex)); }
        });
        const thin = (set, tag) => {
          const v = Array.from(set).map(Math.round).sort((p, q) => p - q).filter((x, i, a) => !i || x !== a[i - 1]);
          const out = [];
          v.forEach((x) => {
            const must = need.has(tag + x);
            if (out.length && x - out[out.length - 1] < ER.MIN_TRACK) {
              if (!must) return;
              if (!need.has(tag + out[out.length - 1])) out.pop();
            }
            out.push(x);
          });
          return out;
        };
        const xs = thin(xset, 'x');
        const ys = thin(yset, 'y');
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
          // Candidates: every segment of the route, several places along it. Score: a table or label under it is
          // (almost) forbidden, a foreign line under it is costly, then prefer long segments and the middle.
          const foreignHits = (c) => {
            let n = 0;
            infos.forEach((o) => {
              if (o === inf || !o.points) return;
              for (let k = 1; k < o.points.length; k++) {
                const x1 = Math.min(o.points[k][0], o.points[k - 1][0]), x2 = Math.max(o.points[k][0], o.points[k - 1][0]);
                const y1 = Math.min(o.points[k][1], o.points[k - 1][1]), y2 = Math.max(o.points[k][1], o.points[k - 1][1]);
                if (x1 < c.x + c.w && x2 > c.x && y1 <= c.y + c.h && y2 >= c.y) n++;
              }
            });
            return n;
          };
          let chosen = null, bestScore = Infinity;
          longest.forEach(({ s }, rank) => {
            [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9].forEach((t) => {
              const c = at(s, t);
              let score = Math.abs(t - 0.5) * 10 + rank * 5 + (s.len < w ? 50 : 0);
              score += 1e6 * (boxes.filter((b) => hit(c, b)).length + placed.filter((q) => hit(c, q)).length);
              if (score >= bestScore) return;
              score += 1000 * foreignHits(c);
              if (score < bestScore - 1e-9) { bestScore = score; chosen = c; }
            });
          });
          r.labelBox = chosen;
          placed.push(r.labelBox);
        });

        // ---- canvas, crossings, length, bends ----
        let right = maxRight, bottom = 0;
        boxes.forEach((b) => { right = Math.max(right, b.x + b.w); bottom = Math.max(bottom, b.y + b.h); });
        groups.forEach((g) => { right = Math.max(right, g.box.x + g.box.w); bottom = Math.max(bottom, g.box.y + g.box.h); });
        infos.forEach((inf) => (inf.points || []).forEach((p) => { right = Math.max(right, p[0] + P); bottom = Math.max(bottom, p[1] + P); }));
        rels.forEach((r) => { if (r.labelBox) { right = Math.max(right, r.labelBox.x + r.labelBox.w); bottom = Math.max(bottom, r.labelBox.y + r.labelBox.h); } });
        let length = 0, bends = 0;
        infos.forEach((inf) => {
          const pts = inf.points || [];
          for (let k = 1; k < pts.length; k++) length += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
          bends += Math.max(0, pts.length - 2);
        });
        const crossings = erCountCrossings(infos.map((inf) => inf.points || []));
        data.canvas = { width: Math.round(right + ER.MARGIN), height: Math.round(bottom + ER.MARGIN), crossings, length, bends };
      }
