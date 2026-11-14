      // --- SEQUENCE LAYOUT ENGINE ---
      // Pure JS, no DOM access. Defines layoutDiagram(data) (see assets/shell/shell.js) and is run by the page
      // (Auto-Tidy, edits) and by scripts/run_engine.mjs (--layout). The Python audit in scripts/audit_sequence.py
      // mirrors the text-width constants below; keep SQ.CHAR_W, SQ.DETAIL_CHAR_W and SQ.NUM_W in sync with it.
      //
      // Input:  numbered?, showDetails?,
      //         participants[{id,name,kind}], messages[{id,from,to,label,detail?,kind}] (array order = time order),
      //         fragments[{id,kind,label,from,to,elseAt?|branches?[{at,label}],color?,collapsed?}]
      //           (from/to/elseAt/at are message ids),
      //         notes?[{id,text,over,after?|before?}] (over: a participant id, or two ids to span between them),
      //         rails? (true: a participant with nothing to show outside collapsed frames is a thin rail)
      // Output: participants[].x (center), messages[].y (arrow line), messages[].hidden (inside a collapsed frame),
      //         participants[].rail (true on a rail), fragments[].{x,y,w,h,dividers[{at,y,label}]}, notes[].{x,y,w,h},
      //         layout {width,height}.
      //         A frame or note inside a collapsed frame gets no box. None of this is saved (see toDisk).
      // A file that uses none of the optional fields is laid out exactly as before they existed.
      const SQ = {
        BOX_W: 148, BOX_H: 56, TOP: 24, MARGIN: 56, MIN_GAP: 200,
        FIRST_GAP: 56, ROW: 60, SELF_ROW: 96, ARROW_AT: 30,
        FRAG_TOP: 40, FRAG_STEP_BOTTOM: 28, ELSE_GAP: 32, ROW_BOTTOM_PAD: 8,
        CHAR_W: 7.4, LABEL_PAD: 44, SELF_LOOP: 40, TAIL: 56, FRAG_PAD: 36, FRAG_PAD_STEP: 14, GRID: 4,
        NUM_W: 26,                              // room for the step number before a label ("numbered")
        DETAIL_CHAR_W: 6.4, DETAIL_ROW: 12,     // a message's detail line: smaller text, and the extra row height
        NOTE_W: 184, NOTE_SPAN_PAD: 64, NOTE_CHAR_W: 6.2, NOTE_PAD: 10, NOTE_LINE: 17, NOTE_GAP: 14,
        SUMMARY_ROW: 44,                        // the one row a collapsed frame takes
        RAIL_W: 36, RAIL_H: 80,                 // a rail's width and height
        GAP_CLEAR: 52, RAIL_CLEAR: 24,          // clear space between two boxes (MIN_GAP - BOX_W), and beside a rail
        SUMMARY_W: 236                          // a collapsed frame is at least this wide when rails make the diagram narrow
      };
      const sqTextW = (t) => Math.ceil(String(t == null ? '' : t).length * SQ.CHAR_W);
      const sqGrid = (v) => Math.ceil(v / SQ.GRID) * SQ.GRID;
      // A fragment's further branches as [{at, label}]: "branches", or the short form "elseAt" (one unlabelled branch)
      const sqBranches = (f) => (Array.isArray(f.branches) ? f.branches : f.elseAt === undefined ? [] : [{ at: f.elseAt }]);
      // The participant ids a note sits over: one, or two to span between
      const sqNoteOver = (n) => (Array.isArray(n.over) ? n.over : n.over === undefined ? [] : [n.over]).slice(0, 2);
      // Note text wrapped by character count: explicit line breaks kept, words kept whole unless longer than a line
      function sqWrap(text, maxChars) {
        const lines = [];
        String(text == null ? '' : text).split('\n').forEach((para) => {
          let line = '';
          para.split(/\s+/).filter(Boolean).forEach((word) => {
            while (word.length > maxChars) {
              if (line) { lines.push(line); line = ''; }
              lines.push(word.slice(0, maxChars));
              word = word.slice(maxChars);
            }
            if (!line) line = word;
            else if (line.length + 1 + word.length <= maxChars) line += ' ' + word;
            else { lines.push(line); line = word; }
          });
          lines.push(line);
        });
        return lines;
      }

      function layoutDiagram(data) {
        const ps = data.participants || [], ms = data.messages || [], fs = data.fragments || [], ns = data.notes || [];
        const pIdx = {};
        ps.forEach((p, i) => { pIdx[p.id] = i; });
        const mIdx = {};
        ms.forEach((m, i) => { mIdx[m.id] = i; });
        const showDetails = data.showDetails !== false;
        const detailOf = (m) => (showDetails && m.detail ? String(m.detail) : '');
        // What a message needs sideways: the longer of its label (plus the step number) and its detail
        const msgW = (m) => Math.max(sqTextW(m.label) + (data.numbered ? SQ.NUM_W : 0), Math.ceil(detailOf(m).length * SQ.DETAIL_CHAR_W));

        // 1. Fragments: resolve message ranges, nesting level (0 = innermost) and ordering. Done first: which messages a
        //    collapsed frame hides decides which participants are rails, and so the horizontal layout.
        const frs = fs
          .map((f) => ({ f, a: mIdx[f.from], b: mIdx[f.to], divs: [] }))
          .filter((r) => r.a !== undefined && r.b !== undefined && r.a <= r.b);
        fs.forEach((f) => { delete f.x; delete f.y; delete f.w; delete f.h; delete f.elseY; delete f.dividers; });
        ns.forEach((n) => { delete n.x; delete n.y; delete n.w; delete n.h; });
        const span = (r) => r.b - r.a;
        const outer = (o, i) => o !== i && o.a <= i.a && i.b <= o.b &&
          (span(o) > span(i) || (span(o) === span(i) && frs.indexOf(o) < frs.indexOf(i)));
        const levelOf = (r) => frs.reduce((lv, i) => (outer(r, i) ? Math.max(lv, levelOf(i) + 1) : lv), 0);
        frs.forEach((r) => { r.level = levelOf(r); });
        // A further branch starts at message index e, after the frame's first message and no later than its last
        frs.forEach((r) => {
          const seen = {};
          r.branches = sqBranches(r.f)
            .map((br) => ({ at: br.at, label: br.label || '', e: mIdx[br.at] }))
            .filter((br) => br.e !== undefined && br.e > r.a && br.e <= r.b && !seen[br.e] && (seen[br.e] = true));
        });
        // Collapsed frames: the outermost collapsed frame around a message owns it; frames inside it are not drawn
        const collapsed = frs.filter((r) => r.f.collapsed);
        collapsed.forEach((c) => { c.own = !collapsed.some((o) => outer(o, c)); });
        frs.forEach((r) => { r.hidden = collapsed.some((c) => outer(c, r)); });
        const ownerOf = (k) => collapsed.find((c) => c.own && c.a <= k && k <= c.b);

        // 2. Rails: a participant that has something in the collapsed parts of the diagram and nothing in the rest is
        //    drawn as a thin rail, so collapsing (or focusing on) a phase makes the diagram narrower. A note counts as
        //    drawn when it is placed (see below): before a collapsed frame's first message it is, on any other message
        //    inside the frame it is not. With every frame expanded nothing is hidden, so there are no rails. Only with
        //    "rails": true (Focus sets it): a page saved before rails existed keeps its collapsed frames as they were.
        const noteShown = (n) => {
          const key = n.after !== undefined ? 'after' : n.before !== undefined ? 'before' : null;
          if (!key) return true;
          const k = mIdx[n[key]];
          if (k === undefined) return false;
          const C = ownerOf(k);
          return !C || (key === 'before' && k === C.a);
        };
        const seen = ps.map(() => false), folded = ps.map(() => false);
        ms.forEach((m, k) => {
          const into = ownerOf(k) ? folded : seen;
          [pIdx[m.from], pIdx[m.to]].forEach((i) => { if (i !== undefined) into[i] = true; });
        });
        ns.forEach((n) => sqNoteOver(n).forEach((id) => {
          if (pIdx[id] !== undefined) (noteShown(n) ? seen : folded)[pIdx[id]] = true;
        }));
        const rail = ps.map((p, i) => data.rails === true && folded[i] && !seen[i]);
        if (rail.every(Boolean)) rail.fill(false);   // nothing at all would be left to read
        const anyRail = rail.some(Boolean);
        ps.forEach((p, i) => { if (rail[i]) p.rail = true; else delete p.rail; });
        const half = (i) => (rail[i] ? SQ.RAIL_W : SQ.BOX_W) / 2;

        // 3. Horizontal gaps: every message label must fit between its two lifelines. Without rails, messages hidden in
        //    a collapsed frame still count, so collapsing a frame never moves a lifeline; with rails the diagram is
        //    narrower on purpose, so they do not.
        const gaps = ps.slice(1).map((p, i) => half(i) + half(i + 1) + (rail[i] || rail[i + 1] ? SQ.RAIL_CLEAR : SQ.GAP_CLEAR));
        const need = [];
        ms.forEach((m, k) => {
          const a = pIdx[m.from], b = pIdx[m.to];
          if (a === undefined || b === undefined || (anyRail && ownerOf(k))) return;
          if (a === b) {
            if (a < gaps.length) need.push({ lo: a, hi: a + 1, w: SQ.SELF_LOOP + 12 + msgW(m) + 24 });
          } else {
            need.push({ lo: Math.min(a, b), hi: Math.max(a, b), w: msgW(m) + SQ.LABEL_PAD });
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
        let x = SQ.MARGIN + half(0) + SQ.FRAG_PAD_STEP * 2;
        ps.forEach((p, i) => {
          if (i) x += sqGrid(gaps[i - 1]);
          p.x = Math.round(x);
        });

        // Notes: where each one hangs, and its box (width from what it sits over, height from the wrapped text)
        const floating = [], beforeOf = {}, afterOf = {};
        const noteBox = (n) => {
          const over = sqNoteOver(n).map((id) => ps[pIdx[id]]);
          if (!over.length || over.some((p) => !p)) return null;
          const xs = over.map((p) => p.x);
          const lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
          const w = hi > lo ? hi - lo + 2 * SQ.NOTE_SPAN_PAD : SQ.NOTE_W;
          const lines = sqWrap(n.text, Math.max(4, Math.floor((w - 2 * SQ.NOTE_PAD) / SQ.NOTE_CHAR_W)));
          return { x: Math.round((lo + hi) / 2 - w / 2), w: Math.round(w), h: lines.length * SQ.NOTE_LINE + 2 * SQ.NOTE_PAD };
        };
        ns.forEach((n) => {
          const key = n.after !== undefined ? 'after' : n.before !== undefined ? 'before' : null;
          if (!key) { floating.push(n); return; }
          const k = mIdx[n[key]];
          if (k === undefined) return;   // unknown message: not drawn (the audit reports it)
          const map = key === 'after' ? afterOf : beforeOf;
          (map[k] = map[k] || []).push(n);
        });

        // 3. Vertical positions, inserting space where fragments open, split (a further branch) and close, and a
        //    row for every note.
        let y = SQ.TOP + (anyRail ? SQ.RAIL_H : SQ.BOX_H) + SQ.FIRST_GAP;
        const placeNotes = (list) => (list || []).forEach((n) => {
          const box = noteBox(n);
          if (!box) return;
          n.x = box.x; n.w = box.w; n.h = box.h; n.y = Math.round(y);
          y += box.h + SQ.NOTE_GAP;
        });
        placeNotes(floating);
        ms.forEach((m, k) => {
          const C = ownerOf(k);
          if (!C || k === C.a) {
            // This message opens a row (its own, or the summary row of the collapsed frame it starts)
            frs.filter((r) => !r.hidden && r !== C).forEach((r) => r.branches.filter((br) => br.e === k).forEach((br) => {
              r.divs.push({ at: br.at, y: Math.round(y + 6), label: br.label });
              y += SQ.ELSE_GAP;
            }));
            placeNotes(beforeOf[k]);
            const starting = frs.filter((r) => !r.hidden && r.a === k).sort((u, v) => span(v) - span(u) || frs.indexOf(u) - frs.indexOf(v));
            const y0 = y;
            starting.forEach((r, s) => { r.top = y0 + SQ.FRAG_TOP * s + 8; });
            y += SQ.FRAG_TOP * starting.length;
            if (C) {
              C.rowY = y + SQ.SUMMARY_ROW / 2;
              y += SQ.SUMMARY_ROW;
              C.rowBottom = y - 4;
            } else {
              m.y = y + SQ.ARROW_AT;
              y += (m.from === m.to ? SQ.SELF_ROW : SQ.ROW) + (detailOf(m) ? SQ.DETAIL_ROW : 0);
              placeNotes(afterOf[k]);   // inside every frame the message is in: before any of them closes
            }
          }
          if (C) { m.y = C.rowY; m.hidden = true; } else delete m.hidden;
          const rowBottom = C ? C.rowBottom : y - SQ.ROW_BOTTOM_PAD;
          const ending = frs.filter((r) => !r.hidden && r.b === k).sort((u, v) => span(u) - span(v) || frs.indexOf(v) - frs.indexOf(u));
          ending.forEach((r, e) => { r.bottom = rowBottom + SQ.FRAG_STEP_BOTTOM * e; });
          y += SQ.FRAG_STEP_BOTTOM * ending.length;
        });

        // 4. Fragment boxes: wide enough for every message and note they contain, their tag and their branch
        //    labels, padded by nesting level.
        let maxRight = ps.length ? ps[ps.length - 1].x + half(ps.length - 1) : SQ.MARGIN;
        const noteIn = (n, r) => {
          if (n.x === undefined) return false;
          const k = n.after !== undefined ? mIdx[n.after] : n.before !== undefined ? mIdx[n.before] : undefined;
          return k !== undefined && k <= r.b && (n.after !== undefined ? k >= r.a : k > r.a);
        };
        frs.forEach((r) => {
          if (r.hidden || r.top === undefined || r.bottom === undefined) return;
          let lo = Infinity, hi = -Infinity;
          for (let k = r.a; k <= r.b; k++) {
            const m = ms[k], pa = ps[pIdx[m.from]], pb = ps[pIdx[m.to]];
            if (!pa || !pb) continue;
            lo = Math.min(lo, pa.x, pb.x);
            hi = Math.max(hi, pa.x, pb.x);
            if (m.from === m.to && !(anyRail && ownerOf(k))) hi = Math.max(hi, pa.x + SQ.SELF_LOOP + 12 + msgW(m) + 12);
          }
          if (lo === Infinity) { lo = hi = SQ.MARGIN; }
          const pad = SQ.FRAG_PAD + SQ.FRAG_PAD_STEP * (anyRail && r.f.collapsed ? 0 : r.level);   // a folded frame draws nothing inside
          let left = lo - pad, right = hi + pad;
          const notePad = 8 + SQ.FRAG_PAD_STEP * r.level;
          ns.forEach((n) => {
            if (!noteIn(n, r)) return;
            left = Math.min(left, n.x - notePad);
            right = Math.max(right, n.x + n.w + notePad);
          });
          // The tag of a group shows its label only
          const tagW = (r.f.kind === 'group' ? 0 : sqTextW(r.f.kind)) + sqTextW(r.f.label) + 56;
          const branchW = r.branches.reduce((w, br) => Math.max(w, sqTextW(br.label) + 40), 0);
          r.f.x = Math.round(left);
          r.f.w = Math.round(Math.max(right - left, tagW, branchW, anyRail && r.f.collapsed ? SQ.SUMMARY_W : 0));
          r.f.y = Math.round(r.top);
          r.f.h = Math.round(r.bottom - r.top);
          if (r.divs.length) r.f.dividers = r.divs;
          maxRight = Math.max(maxRight, r.f.x + r.f.w);
        });
        ns.forEach((n) => { if (n.x !== undefined) maxRight = Math.max(maxRight, n.x + n.w); });

        ms.forEach((m) => { m.y = Math.round(m.y); });
        data.layout = { width: Math.round(maxRight + SQ.MARGIN), height: Math.round(y + SQ.TAIL) };
      }
