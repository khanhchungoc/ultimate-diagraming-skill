// --- GANTT LAYOUT ENGINE ---
// Pure JS, no DOM access, no ES module imports. Defines layoutDiagram(data), GANTT_ZOOMS,
// and pure UTC date helpers (ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays).
// Loaded by the page and by scripts/run_engine.mjs with TOKENS in scope and ortho-router.js ahead of it.
// 100% deterministic: never calls Date.now() or new Date() without an explicit UTC date.

const GANTT_ZOOMS = {
  day:     { pxPerDay: 36,  snapDays: 1, showWeekends: true,  label: 'Day' },
  week:    { pxPerDay: 18,  snapDays: 1, showWeekends: true,  label: 'Week' },
  month:   { pxPerDay: 6,   snapDays: 1, showWeekends: false, label: 'Month' },
  quarter: { pxPerDay: 2.4, snapDays: 7, showWeekends: false, label: 'Quarter' },
  year:    { pxPerDay: 1.0, snapDays: 7, showWeekends: false, label: 'Year' }
};

const GANTT_PAD_DAYS = {
  day:     { before: 3,  after: 5 },
  week:    { before: 7,  after: 14 },
  month:   { before: 14, after: 21 },
  quarter: { before: 30, after: 45 },
  year:    { before: 45, after: 60 }
};

const GANTT_FALLBACK_START = '2026-01-01';
const GANTT_FALLBACK_END   = '2026-03-31';

const GANTT_METRICS = {
  ROW_H: 36,
  BAR_H: 22,
  GROUP_BAR_H: 14,
  MILESTONE_SIZE: 14,
  HEADER_H: 52,
  SIDEBAR_W: 260,
  DEP_STUB: 14,
  DEP_RADIUS: 6,
  CHAR_W: (typeof TOKENS !== 'undefined' && TOKENS && TOKENS.font && TOKENS.font.metrics && TOKENS.font.metrics.label) || 7.4
};

const GANTT_MS_PER_DAY = 86400000;

function ganttParseDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  if (typeof input !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function ganttFormatDate(input) {
  const dt = ganttParseDate(input);
  if (!dt) return '';
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function ganttAddDays(dateStr, days) {
  const dt = ganttParseDate(dateStr);
  if (!dt) return '';
  const delta = Math.trunc(Number(days) || 0);
  return ganttFormatDate(new Date(dt.getTime() + delta * GANTT_MS_PER_DAY));
}

function ganttDiffDays(startStr, endStr) {
  const a = ganttParseDate(startStr);
  const b = ganttParseDate(endStr);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / GANTT_MS_PER_DAY);
}

function ganttRound1(n) {
  return Math.round(n * 10) / 10;
}

function ganttRoundPath(points, r) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const radius = typeof r === 'number' ? r : GANTT_METRICS.DEP_RADIUS;
  // Drop duplicate and collinear intermediate points
  const pts = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (pts.length > 0 && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) <= 0.5) continue;
    pts.push(p);
  }
  const clean = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1], b = pts[i + 1];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.5;
  });
  let d = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let i = 1; i < clean.length; i++) {
    const curr = clean[i];
    if (i < clean.length - 1) {
      const prev = clean[i - 1];
      const next = clean[i + 1];
      const vx1 = curr[0] - prev[0], vy1 = curr[1] - prev[1];
      const vx2 = next[0] - curr[0], vy2 = next[1] - curr[1];
      const len1 = Math.hypot(vx1, vy1);
      const len2 = Math.hypot(vx2, vy2);
      if (len1 > 0.5 && len2 > 0.5) {
        const room1 = i === 1 ? len1 : len1 / 2;
        const room2 = i === clean.length - 2 ? len2 : len2 / 2;
        const cr = Math.min(radius, room1, room2);
        const sx = curr[0] - (vx1 / len1) * cr;
        const sy = curr[1] - (vy1 / len1) * cr;
        const ex = curr[0] + (vx2 / len2) * cr;
        const ey = curr[1] + (vy2 / len2) * cr;
        d += ` L ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        continue;
      }
    }
    d += ` L ${curr[0]} ${curr[1]}`;
  }
  return d;
}

function ganttBuildDepPath(points, r) {
  if (typeof buildCurvedPathWithHops === 'function') {
    return buildCurvedPathWithHops(points, [], r);
  }
  return ganttRoundPath(points, r);
}

function layoutDiagram(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const deps = Array.isArray(data.dependencies) ? data.dependencies : [];
  const markers = Array.isArray(data.markers) ? data.markers : [];
  const holidays = Array.isArray(data.holidays) ? data.holidays : [];

  const zoomKey = Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, data.zoom) ? data.zoom : 'month';
  const zoomCfg = GANTT_ZOOMS[zoomKey];
  const padCfg = GANTT_PAD_DAYS[zoomKey];
  const pxPerDay = zoomCfg.pxPerDay;

  // 1. Index items by id and build parent -> children tree (preserving items array order among siblings)
  const itemById = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && it.id && !itemById.has(it.id)) itemById.set(it.id, it);
  }

  // Resolve valid non-cyclic parent for each item
  const validParent = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !it.id) continue;
    const pid = it.parent;
    if (!pid || pid === it.id || !itemById.has(pid)) {
      validParent.set(it.id, null);
      continue;
    }
    // Walk ancestors to guard against parent cycles
    const seen = new Set([it.id]);
    let cur = pid;
    let cyclic = false;
    while (cur && itemById.has(cur)) {
      if (seen.has(cur)) { cyclic = true; break; }
      seen.add(cur);
      cur = itemById.get(cur).parent;
    }
    validParent.set(it.id, cyclic ? null : pid);
  }

  const roots = [];
  const childrenByParent = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !it.id) continue;
    const pid = validParent.get(it.id);
    if (!pid) {
      roots.push(it);
    } else {
      let arr = childrenByParent.get(pid);
      if (!arr) { arr = []; childrenByParent.set(pid, arr); }
      arr.push(it);
    }
  }

  // 2. Depth-first traversal: compute _depth, _hasChildren, _hidden, _row, and bottom-up _start/_end rollup
  let visibleRow = 0;
  const orderedItems = [];

  function visit(it, depth, ancestorCollapsed) {
    const kids = childrenByParent.get(it.id) || [];
    it._depth = depth;
    it._hasChildren = kids.length > 0;
    it._hidden = Boolean(ancestorCollapsed);
    it._row = it._hidden ? -1 : visibleRow++;
    orderedItems.push(it);

    const childHidden = ancestorCollapsed || Boolean(it.collapsed);
    let minStart = null;
    let maxEnd = null;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      visit(child, depth + 1, childHidden);
      if (child._start && (!minStart || child._start < minStart)) minStart = child._start;
      if (child._end && (!maxEnd || child._end > maxEnd)) maxEnd = child._end;
    }

    if (it._hasChildren && minStart && maxEnd) {
      it._start = minStart;
      it._end = maxEnd;
    } else {
      const s = ganttFormatDate(it.start);
      const e = ganttFormatDate(it.end);
      if (it.kind === 'milestone') {
        const d = s || e || null;
        it._start = d;
        it._end = d;
      } else if (s && e) {
        it._start = s;
        it._end = e < s ? s : e;
      } else if (s) {
        it._start = s;
        it._end = s;
      } else if (e) {
        it._start = e;
        it._end = e;
      } else {
        it._start = null;
        it._end = null;
      }
    }
  }

  for (let i = 0; i < roots.length; i++) {
    visit(roots[i], 0, false);
  }

  // 3. Compute padded date range
  let earliest = null;
  let latest = null;
  for (let i = 0; i < orderedItems.length; i++) {
    const it = orderedItems[i];
    if (it._start && (!earliest || it._start < earliest)) earliest = it._start;
    if (it._end && (!latest || it._end > latest)) latest = it._end;
  }
  for (let i = 0; i < markers.length; i++) {
    const d = ganttFormatDate(markers[i] && markers[i].date);
    if (d) {
      if (!earliest || d < earliest) earliest = d;
      if (!latest || d > latest) latest = d;
    }
  }

  let rangeStart, rangeEnd;
  if (!earliest || !latest) {
    rangeStart = GANTT_FALLBACK_START;
    rangeEnd = GANTT_FALLBACK_END;
  } else {
    rangeStart = ganttAddDays(earliest, -padCfg.before);
    rangeEnd = ganttAddDays(latest, padCfg.after);
  }

  const totalDays = Math.max(1, ganttDiffDays(rangeStart, rangeEnd) + 1);
  const timelineWidth = Math.round(totalDays * pxPerDay);
  data._range = {
    start: rangeStart,
    end: rangeEnd,
    totalDays,
    pxPerDay,
    timelineWidth
  };

  const dateToX = (dateStr) => ganttDiffDays(rangeStart, dateStr) * pxPerDay;

  // 4. Compute bar geometry for each item
  const ROW_H = GANTT_METRICS.ROW_H;
  const BAR_H = GANTT_METRICS.BAR_H;
  const GROUP_BAR_H = GANTT_METRICS.GROUP_BAR_H;
  const MS_SIZE = GANTT_METRICS.MILESTONE_SIZE;

  for (let i = 0; i < orderedItems.length; i++) {
    const it = orderedItems[i];
    if (it._hidden || !it._start || !it._end) {
      it._bar = null;
      continue;
    }
    const rowTop = it._row * ROW_H;
    if (it.kind === 'milestone' && !it._hasChildren) {
      const cx = ganttRound1(dateToX(it._start) + pxPerDay / 2);
      const cy = ganttRound1(rowTop + ROW_H / 2);
      it._bar = {
        x: ganttRound1(cx - MS_SIZE / 2),
        y: ganttRound1(cy - MS_SIZE / 2),
        w: MS_SIZE,
        h: MS_SIZE
      };
    } else {
      const spanDays = Math.max(1, ganttDiffDays(it._start, it._end) + 1);
      const h = (it._hasChildren || it.kind === 'group') ? GROUP_BAR_H : BAR_H;
      const x = ganttRound1(dateToX(it._start));
      const w = ganttRound1(spanDays * pxPerDay);
      const y = ganttRound1(rowTop + (ROW_H - h) / 2);
      it._bar = { x, y, w, h };
    }
  }

  // 5. Route dependencies (FS & SS) between visible items
  const DEP_R = GANTT_METRICS.DEP_RADIUS;
  const routedDeps = [];

  // Track which visible items have both incoming left-edge arrows and outgoing SS left-edge arrows
  // so we separate their vertical attachment points cleanly (no overlapping Y-fork on the arrowhead).
  const hasIncomingLeft = new Set();
  const hasOutgoingSs = new Set();
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep || !dep.from || !dep.to || dep.from === dep.to) continue;
    const f = itemById.get(dep.from);
    const t = itemById.get(dep.to);
    if (!f || !t || f._hidden || t._hidden || !f._bar || !t._bar) continue;
    hasIncomingLeft.add(dep.to);
    const rt = String(dep.type || 'fs').toLowerCase();
    if (rt === 'ss' || rt === 'start-start') hasOutgoingSs.add(dep.from);
  }

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep || !dep.from || !dep.to || dep.from === dep.to) continue;
    const fromIt = itemById.get(dep.from);
    const toIt = itemById.get(dep.to);
    if (!fromIt || !toIt || fromIt._hidden || toIt._hidden || !fromIt._bar || !toIt._bar) continue;

    const rawType = String(dep.type || 'fs').toLowerCase();
    const type = (rawType === 'ss' || rawType === 'start-start') ? 'ss' : 'fs';
    const violated = type === 'ss'
      ? Boolean(toIt._start < fromIt._start)
      : Boolean(toIt._start < fromIt._end);

    const fb = fromIt._bar;
    const tb = toIt._bar;
    const fromBothLeft = hasIncomingLeft.has(dep.from) && hasOutgoingSs.has(dep.from);
    const toBothLeft = hasIncomingLeft.has(dep.to) && hasOutgoingSs.has(dep.to);
    const fy = ganttRound1(
      type === 'ss' && fromBothLeft ? fb.y + fb.h * 0.72 : fb.y + fb.h / 2
    );
    const ty = ganttRound1(
      toBothLeft ? tb.y + tb.h * 0.32 : tb.y + tb.h / 2
    );
    let points;

    if (type === 'ss') {
      // 2-bend C-bracket
      const sx = ganttRound1(fb.x);
      const ex = ganttRound1(tb.x);
      const leftX = ganttRound1(Math.min(sx, ex) - 10);
      points = [
        [sx, fy],
        [leftX, fy],
        [leftX, ty],
        [ex, ty]
      ];
    } else {
      const fromRight = ganttRound1(fb.x + fb.w);
      const toLeft = ganttRound1(tb.x);
      const goingDown = ty >= fy;
      const fromIsMilestone = fromIt.kind === 'milestone' && !fromIt._hasChildren;

      const fromEdgeY = fromIsMilestone
        ? ganttRound1(goingDown ? fy + fb.h / 2 : fy - fb.h / 2)
        : ganttRound1(goingDown ? fb.y + fb.h : fb.y);
      const lExitX = fromIsMilestone
        ? ganttRound1(fb.x + fb.w / 2)
        : ganttRound1(
            fb.w <= 12
              ? fb.x + fb.w / 2
              : Math.max(fb.x + 6, Math.min(fromRight - 8, toLeft - 10))
          );

      if (lExitX < toLeft) {
        // 1-bend L-shape exiting bottom/top edge of fromBar (keeps violated dashed styling if overlapping)
        points = [
          [lExitX, fromEdgeY],
          [lExitX, ty],
          [toLeft, ty]
        ];
      } else {
        // Target starts before fromBar's left exit point: compact gutter route
        const exitX = fromIsMilestone
          ? ganttRound1(fb.x + fb.w / 2)
          : ganttRound1(
              fb.w <= 8
                ? fb.x + fb.w / 2
                : Math.max(fb.x + 4, fromRight - 4)
            );
        const gutterY = ganttRound1(goingDown ? fb.y + fb.h + 5 : fb.y - 5);
        const inX = ganttRound1(toLeft - 10);
        points = [
          [exitX, fromEdgeY],
          [exitX, gutterY],
          [inX, gutterY],
          [inX, ty],
          [toLeft, ty]
        ];
      }
    }

    routedDeps.push({
      from: dep.from,
      to: dep.to,
      type,
      violated,
      points,
      path: ganttBuildDepPath(points, DEP_R)
    });
  }
  data._deps = routedDeps;

  // 6. Chart-wide vertical milestone markers
  const routedMarkers = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (!m) continue;
    const d = ganttFormatDate(m.date);
    if (!d) continue;
    routedMarkers.push({
      id: m.id || `m_${i}`,
      label: m.label || '',
      date: d,
      x: ganttRound1(dateToX(d) + pxPerDay / 2),
      color: m.color || ''
    });
  }
  data._markers = routedMarkers;

  // 7. Holidays clipped to _range
  const clippedHolidays = [];
  for (let i = 0; i < holidays.length; i++) {
    const h = holidays[i];
    if (!h) continue;
    const hs = ganttFormatDate(h.date || h.start);
    if (!hs) continue;
    const rawEnd = ganttFormatDate(h.end);
    const he = (rawEnd && rawEnd >= hs) ? rawEnd : hs;
    if (he < rangeStart || hs > rangeEnd) continue;
    const cStart = hs < rangeStart ? rangeStart : hs;
    const cEnd = he > rangeEnd ? rangeEnd : he;
    const spanDays = Math.max(1, ganttDiffDays(cStart, cEnd) + 1);
    clippedHolidays.push({
      start: cStart,
      end: cEnd,
      x: ganttRound1(dateToX(cStart)),
      w: ganttRound1(spanDays * pxPerDay),
      name: h.name || '',
      country: h.country || ''
    });
  }
  data._holidays = clippedHolidays;

  // 8. Canvas dimensions
  const headerHeight = GANTT_METRICS.HEADER_H;
  const sidebarWidth = GANTT_METRICS.SIDEBAR_W;
  const visibleRows = Math.max(1, visibleRow);
  data.canvas = {
    width: sidebarWidth + timelineWidth,
    height: headerHeight + visibleRows * ROW_H,
    rowHeight: ROW_H,
    headerHeight,
    sidebarWidth
  };

  return data;
}
