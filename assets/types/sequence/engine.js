      // --- SEQUENCE LAYOUT ENGINE ---
      // Pure JS, no DOM access. Defines layoutDiagram(data) (see assets/shell/shell.js) and is run by the page
      // (Auto-Tidy, edits) and by scripts/run_engine.mjs (--layout). The Python audit in scripts/audit_sequence.py
      // mirrors the text-width constant below; keep SQ.CHAR_W in sync with it.
      //
      // Input:  participants[{id,name,kind}], messages[{id,from,to,label,kind}] (array order = time order),
      //         fragments[{id,kind,label,from,to,elseAt?}] (from/to/elseAt are message ids)
      // Output: participants[].x (center), messages[].y (arrow line), fragments[].{x,y,w,h,elseY},
      //         layout {width,height}
      const SQ = {
        BOX_W: 148, BOX_H: 56, TOP: 24, MARGIN: 56, MIN_GAP: 200,
        FIRST_GAP: 56, ROW: 60, SELF_ROW: 96, ARROW_AT: 30,
        FRAG_TOP: 40, FRAG_STEP_BOTTOM: 28, ELSE_GAP: 32, ROW_BOTTOM_PAD: 8,
        CHAR_W: 7.4, LABEL_PAD: 44, SELF_LOOP: 40, TAIL: 56, FRAG_PAD: 36, FRAG_PAD_STEP: 14, GRID: 4
      };
      const sqTextW = (t) => Math.ceil(String(t == null ? '' : t).length * SQ.CHAR_W);
      const sqGrid = (v) => Math.ceil(v / SQ.GRID) * SQ.GRID;

      function layoutDiagram(data) {
        const ps = data.participants || [], ms = data.messages || [], fs = data.fragments || [];
        const pIdx = {};
        ps.forEach((p, i) => { pIdx[p.id] = i; });
        const mIdx = {};
        ms.forEach((m, i) => { mIdx[m.id] = i; });

        // 1. Horizontal gaps: every message label must fit between its two lifelines.
        const gaps = ps.slice(1).map(() => SQ.MIN_GAP);
        const need = [];
        ms.forEach((m) => {
          const a = pIdx[m.from], b = pIdx[m.to];
          if (a === undefined || b === undefined) return;
          if (a === b) {
            if (a < gaps.length) need.push({ lo: a, hi: a + 1, w: SQ.SELF_LOOP + 12 + sqTextW(m.label) + 24 });
          } else {
            need.push({ lo: Math.min(a, b), hi: Math.max(a, b), w: sqTextW(m.label) + SQ.LABEL_PAD });
          }
        });
        need.sort((u, v) => (u.hi - u.lo) - (v.hi - v.lo));
        need.forEach((n) => {
          let sum = 0;
          for (let i = n.lo; i < n.hi; i++) sum += gaps[i];
          if (sum < n.w) {
            const add = (n.w - sum) / (n.hi - n.lo);
            for (let i = n.lo; i < n.hi; i++) gaps[i] += add;
          }
        });
        let x = SQ.MARGIN + SQ.BOX_W / 2 + SQ.FRAG_PAD_STEP * 2;
        ps.forEach((p, i) => {
          if (i) x += sqGrid(gaps[i - 1]);
          p.x = Math.round(x);
        });

        // 2. Fragments: resolve message ranges, nesting level (0 = innermost) and ordering.
        const frs = fs
          .map((f) => ({ f, a: mIdx[f.from], b: mIdx[f.to], e: f.elseAt === undefined ? undefined : mIdx[f.elseAt] }))
          .filter((r) => r.a !== undefined && r.b !== undefined && r.a <= r.b);
        fs.forEach((f) => { delete f.x; delete f.y; delete f.w; delete f.h; delete f.elseY; });
        const span = (r) => r.b - r.a;
        const outer = (o, i) => o !== i && o.a <= i.a && i.b <= o.b &&
          (span(o) > span(i) || (span(o) === span(i) && frs.indexOf(o) < frs.indexOf(i)));
        const levelOf = (r) => frs.reduce((lv, i) => (outer(r, i) ? Math.max(lv, levelOf(i) + 1) : lv), 0);
        frs.forEach((r) => { r.level = levelOf(r); });

        // 3. Vertical positions, inserting space where fragments open, split (else) and close.
        let y = SQ.TOP + SQ.BOX_H + SQ.FIRST_GAP;
        ms.forEach((m, k) => {
          const starting = frs.filter((r) => r.a === k).sort((u, v) => span(v) - span(u) || frs.indexOf(u) - frs.indexOf(v));
          const y0 = y;
          starting.forEach((r, s) => { r.top = y0 + SQ.FRAG_TOP * s + 8; });
          y += SQ.FRAG_TOP * starting.length;
          frs.filter((r) => r.e === k && r.e > r.a && r.e <= r.b).forEach((r) => { r.elseY = y + 6; y += SQ.ELSE_GAP; });
          const self = m.from === m.to;
          const step = self ? SQ.SELF_ROW : SQ.ROW;
          m.y = y + SQ.ARROW_AT;
          const rowBottom = y + step - SQ.ROW_BOTTOM_PAD;
          const ending = frs.filter((r) => r.b === k).sort((u, v) => span(u) - span(v) || frs.indexOf(v) - frs.indexOf(u));
          ending.forEach((r, e) => { r.bottom = rowBottom + SQ.FRAG_STEP_BOTTOM * e; });
          y += step + SQ.FRAG_STEP_BOTTOM * ending.length;
        });

        // 4. Fragment boxes: wide enough for every message they contain (and their tag), padded by nesting level.
        let maxRight = ps.length ? ps[ps.length - 1].x + SQ.BOX_W / 2 : SQ.MARGIN;
        frs.forEach((r) => {
          let lo = Infinity, hi = -Infinity;
          for (let k = r.a; k <= r.b; k++) {
            const m = ms[k], pa = ps[pIdx[m.from]], pb = ps[pIdx[m.to]];
            if (!pa || !pb) continue;
            lo = Math.min(lo, pa.x, pb.x);
            hi = Math.max(hi, pa.x, pb.x);
            if (m.from === m.to) hi = Math.max(hi, pa.x + SQ.SELF_LOOP + 12 + sqTextW(m.label) + 12);
          }
          if (lo === Infinity) { lo = hi = SQ.MARGIN; }
          const pad = SQ.FRAG_PAD + SQ.FRAG_PAD_STEP * r.level;
          const tagW = sqTextW(r.f.kind) + sqTextW(r.f.label) + 56;
          r.f.x = Math.round(lo - pad);
          r.f.w = Math.round(Math.max(hi - lo + 2 * pad, tagW));
          r.f.y = Math.round(r.top);
          r.f.h = Math.round(r.bottom - r.top);
          if (r.elseY !== undefined) r.f.elseY = Math.round(r.elseY);
          maxRight = Math.max(maxRight, r.f.x + r.f.w);
        });

        ms.forEach((m) => { m.y = Math.round(m.y); });
        data.layout = { width: Math.round(maxRight + SQ.MARGIN), height: Math.round(y + SQ.TAIL) };
      }
