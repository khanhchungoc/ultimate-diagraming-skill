// --- GANTT DIAGRAM PLUGIN ---
// Renders chartData (diagramType "gantt") laid out by assets/types/gantt/engine.js.
// Split-pane workspace: resizable left task tree + scrollable right calendar timeline with sticky two-tier header.
// Reuses GANTT_ZOOMS, GANTT_METRICS, ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays from engine.js (SSOT).
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const ZOOM_ORDER = ['day', 'week', 'month', 'quarter', 'year'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LABEL_MAX = 120;
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 480;

  // --- DOM REFERENCES ---
  const root = document.getElementById('gantt-root');
  const sidebar = document.getElementById('gantt-sidebar');
  const treeEl = document.getElementById('gantt-tree');
  const splitter = document.getElementById('gantt-splitter');
  const timeline = document.getElementById('gantt-timeline');
  const headerEl = document.getElementById('gantt-header');
  const headerTop = document.getElementById('gantt-header-top');
  const headerBottom = document.getElementById('gantt-header-bottom');
  const headerMarkers = document.getElementById('gantt-header-markers');
  const bodyEl = document.getElementById('gantt-body');
  const gridEl = document.getElementById('gantt-grid');
  const markersEl = document.getElementById('gantt-markers');
  const todayEl = document.getElementById('gantt-today');
  const depsEl = document.getElementById('gantt-deps');
  const barsEl = document.getElementById('gantt-bars');
  const marqueeEl = document.getElementById('gantt-marquee');
  const notesEl = document.getElementById('gantt-notes');
  const dragTipEl = document.getElementById('gantt-drag-tip');
  const legendWrap = document.getElementById('gantt-legend-wrap');
  const colorKeyHost = document.getElementById('gantt-color-key');
  const btnLegend = document.getElementById('btn-legend');

  const btnAdd = document.getElementById('btn-add');
  const addPop = document.getElementById('gantt-add-pop');
  const btnAddTask = document.getElementById('btn-add-task');
  const btnAddSubtask = document.getElementById('btn-add-subtask');
  const btnAddMilestone = document.getElementById('btn-add-milestone');
  const btnAddMarker = document.getElementById('btn-add-marker');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnAddInline = document.getElementById('btn-add-inline');
  const btnToggleAll = document.getElementById('btn-toggle-all');
  const btnNotes = document.getElementById('btn-notes');
  const btnDeps = document.getElementById('btn-deps');
  const btnWeekends = document.getElementById('btn-weekends');
  const btnToday = document.getElementById('btn-today');
  const btnHolidays = document.getElementById('btn-holidays');
  const holidaysPop = document.getElementById('gantt-holidays-pop');
  const holidaysList = document.getElementById('gantt-holidays-list');
  const holDateInput = document.getElementById('gantt-hol-date');
  const holEndInput = document.getElementById('gantt-hol-end');
  const holNameInput = document.getElementById('gantt-hol-name');
  const holAddBtn = document.getElementById('gantt-hol-add');
  const holCloseBtn = document.getElementById('gantt-hol-close');
  const zoomPills = document.getElementById('gantt-zoom-pills');
  const viewWrap = document.getElementById('gantt-view-wrap');
  const btnViewFilter = document.getElementById('btn-view-filter');
  const viewLabelEl = document.getElementById('gantt-view-label');
  const viewPop = document.getElementById('gantt-view-pop');
  const filterBarEl = document.getElementById('gantt-filter-bar');
  const stickyPhaseEl = document.getElementById('gantt-sticky-phase');
  const offscreenEl = document.getElementById('gantt-offscreen');
  const inViewHintEl = document.getElementById('gantt-inview-hint');
  const inViewHintTextEl = document.getElementById('gantt-inview-hint-text');
  const btnInViewHintApply = document.getElementById('btn-inview-hint-apply');
  const btnInViewHintDismiss = document.getElementById('btn-inview-hint-dismiss');
  const emptyFilterEl = document.getElementById('gantt-empty-filter');
  const modeSwitchEl = document.getElementById('gantt-mode-switch');
  const tableViewEl = document.getElementById('gantt-table-view');

  const EXTEND_DAYS = { day: 90, week: 180, month: 180, quarter: 365, year: 365 };
  const VIEW_LABELS = {
    active: 'Active & Upcoming',
    'in-view': 'In View',
    all: 'All Tasks'
  };

  function initialViewMode() {
    const param = new URLSearchParams(window.location.search).get('view');
    if (param === 'all' || param === 'active' || param === 'in-view') return { mode: param, explicit: true };
    return { mode: 'active', explicit: false };
  }
  const _initView = initialViewMode();

  function initialDisplayMode() {
    const param = new URLSearchParams(window.location.search).get('mode');
    return param === 'table' ? 'table' : 'timeline';
  }

  // --- STATE ---
  let displayMode = initialDisplayMode(); // 'timeline' | 'table'
  let tableCtrl = null;            // GanttTable controller instance
  let selItems = new Set();        // selected item IDs (tasks, groups, milestones)
  let lastSelItemId = null;        // anchor for Shift+click range selection
  let selMarkerId = null;          // selected chart-wide vertical marker ID
  let selDepKey = null;            // selected dependency key `${from}|${to}|${type}`
  let selNoteId = null;            // selected note ID
  const noteCtl = createNotes({    // the note currently open for typing
    data: () => chartData,
    cardOf: (id) => els.notes.get(id),
    anchorEl: (n) => {
      const bar = els.bars.get(n.target);
      return (bar && bar.querySelector(':scope > .note-badge')) || bar || els.rows.get(n.target) || null;
    },
    canEdit: () => !presenting(),
    openCard: (n) => els.notes.get(n.id),
    clearSelection: (id) => { if (selNoteId === id) selNoteId = null; },
    render: ({ reason }) => { if (reason !== 'same') render(); },
    onChange: () => updateStatus(true),
  });
  let peekNoteItemId = null;       // item ID whose note is being peeked on hover/click
  let hoveredItemId = null;        // item ID currently hovered for dependency chain spotlight
  let hoveredRowId = null;         // item ID currently hovered for synchronized row highlight
  let showDeps = true;             // whether dependency arrows layer is visible
  let legendOpen = false;          // whether #gantt-color-key popover is open (closed by default)
  let legendPinned = false;        // whether legend was explicitly pinned open via click/keyboard
  let viewMode = _initView.mode;   // 'active' | 'in-view' | 'all'
  let viewModeExplicit = _initView.explicit;
  let colorFilter = null;          // active legend color slot filter, or null
  let focusChainId = null;         // isolated dependency-chain seed item ID, or null
  let inViewHintDismissed = false; // dismissed In View hint for this session
  let scrollOverlaysRaf = 0;       // rAF token for sticky phase, offscreen pills, and hint
  let inViewDebounceTimer = null;  // debounce timer for horizontal scroll in In View mode
  let lastInViewWindowKey = '';    // tracks visible date range to avoid redundant In View re-renders
  let connectState = null;         // { fromId, type: 'fs' | 'ss', pointerDrag?: boolean }
  let activeDrag = null;           // active bar/resize/marker/marquee/splitter/row drag state
  let actionBarEl = null;          // floating ui.actionBar element
  let floatingPop = null;          // active sub-popover (dates, shift, etc.)
  let floatingPopPrevFocus = null; // element focused before opening floatingPop
  let holidaysPrevFocus = null;    // element focused before opening holidaysPop
  let sidebarWidth = GANTT_METRICS.SIDEBAR_W;
  let renderedDepsSvg = null;      // SVG element inside or equal to #gantt-deps
  let isSyncingScroll = false;
  let didInitialScroll = false;
  let isExtendingTimeline = false;
  let ghostBarEl = null;
  let ghostRowId = null;

  const els = {
    rows: new Map(),               // itemId -> sidebar row element
    rowBgs: new Map(),             // itemId -> timeline row background element
    bars: new Map(),               // itemId -> bar/milestone element
    markers: new Map(),            // markerId -> { line, flag }
    deps: new Map(),               // depKey -> { g, path, hit }
    notes: new Map()               // noteId -> note card element
  };

  // --- MODEL HELPERS ---
  const presenting = () => document.body.classList.contains('presentation');
  const itemsList = () => (Array.isArray(chartData.items) ? chartData.items : []);
  const depsList = () => (Array.isArray(chartData.dependencies) ? chartData.dependencies : []);
  const markersList = () => (Array.isArray(chartData.markers) ? chartData.markers : []);
  const holidaysListData = () => (Array.isArray(chartData.holidays) ? chartData.holidays : []);
  const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
  const itemById = (id) => itemsList().find((it) => it && it.id === id) || null;
  const markerById = (id) => markersList().find((m) => m && m.id === id) || null;
  const noteById = (id) => notesList().find((n) => n && n.id === id) || null;
  const noteForTarget = (targetId) => notesList().find((n) => n && n.target === targetId) || null;
  const depKeyOf = (d) => `${d.from}|${d.to}|${d.type === 'ss' ? 'ss' : 'fs'}`;
  const currentZoom = () => (Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, chartData.zoom) ? chartData.zoom : 'month');
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };

  function htmlEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
    }
    return el;
  }

  function newId(prefix) {
    const used = new Set([
      ...itemsList().map((o) => o && o.id),
      ...markersList().map((o) => o && o.id),
      ...notesList().map((o) => o && o.id)
    ]);
    const base = `${prefix}_${Date.now()}`;
    let id = base;
    let k = 2;
    while (used.has(id)) id = `${base}_${k++}`;
    return id;
  }

  function cleanLabel(v, fallback) {
    const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
    return t || fallback;
  }

  // Client-side Today date: supports ?today=YYYY-MM-DD for deterministic screenshots & E2E tests.
  function getTodayStr() {
    const param = new URLSearchParams(window.location.search).get('today');
    if (param) {
      const parsed = ganttFormatDate(param);
      if (parsed) return parsed;
    }
    const now = new Date();
    const y = String(now.getFullYear()).padStart(4, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getTimeState(item, todayStr) {
    if (!item || !item._start || !item._end || !todayStr) return 'upcoming';
    if (item._end < todayStr) return 'past';
    if (item._start <= todayStr && todayStr <= item._end) return 'active';
    return 'upcoming';
  }

  function formatShortDate(iso) {
    const dt = ganttParseDate(iso);
    if (!dt) return iso || '';
    return `${MONTH_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }

  function formatDateRange(startIso, endIso) {
    if (!startIso) return '';
    if (!endIso || startIso === endIso) return formatShortDate(startIso);
    return `${formatShortDate(startIso)} – ${formatShortDate(endIso)}`;
  }

  function formatBarTip(it) {
    if (!it || !it._start) return '';
    const endIso = it._end || it._start;
    const days = Math.max(1, ganttDiffDays(it._start, endIso) + 1);
    return `${formatDateRange(it._start, endIso)} · ${days}d`;
  }

  function effectiveColor(it) {
    const seen = new Set();
    let cur = it;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.color) return cur.color;
      cur = cur.parent ? itemById(cur.parent) : null;
    }
    return it && it.kind === 'milestone' ? '4' : '1';
  }

  const showWeekendsPref = () => chartData.showWeekends !== false;
  const showWeekendsActive = (zoomKey) => {
    const z = zoomKey || currentZoom();
    return showWeekendsPref() && Boolean(GANTT_ZOOMS[z] && GANTT_ZOOMS[z].showWeekends);
  };

  function dateFromClientX(clientX) {
    const range = chartData._range;
    if (!range || !bodyEl) return getTodayStr();
    const rect = bodyEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const snapDays = (GANTT_ZOOMS[currentZoom()] || GANTT_ZOOMS.month).snapDays;
    const rawDays = x / range.pxPerDay;
    const snapped = Math.round(rawDays / snapDays) * snapDays;
    return ganttAddDays(range.start, snapped);
  }

  function itemFromClientY(clientY) {
    if (!bodyEl) return null;
    const rect = bodyEl.getBoundingClientRect();
    const y = clientY - rect.top;
    if (y < 0) return null;
    const rowIdx = Math.floor(y / GANTT_METRICS.ROW_H);
    const vis = visibleItems();
    return (rowIdx >= 0 && rowIdx < vis.length) ? vis[rowIdx] : null;
  }

  function hideGhostBar() {
    if (ghostBarEl) {
      ghostBarEl.remove();
      ghostBarEl = null;
    }
    ghostRowId = null;
  }

  function showGhostBar(it, startDate, endDate, customLabel) {
    const range = chartData._range;
    if (!range || !barsEl || !it || typeof it._row !== 'number' || it._row < 0) return;
    const s = startDate <= endDate ? startDate : endDate;
    const e = startDate <= endDate ? endDate : startDate;
    const spanDays = Math.max(1, ganttDiffDays(s, e) + 1);
    const x = ganttDiffDays(range.start, s) * range.pxPerDay;
    const w = Math.max(range.pxPerDay, spanDays * range.pxPerDay);
    const h = GANTT_METRICS.BAR_H;
    const y = it._row * GANTT_METRICS.ROW_H + (GANTT_METRICS.ROW_H - h) / 2;
    if (!ghostBarEl) {
      ghostBarEl = htmlEl('div', 'gantt-ghost-bar');
      ghostBarEl.setAttribute('data-export-skip', '');
      barsEl.appendChild(ghostBarEl);
    }
    ghostRowId = it.id;
    ghostBarEl.style.left = `${x}px`;
    ghostBarEl.style.top = `${y}px`;
    ghostBarEl.style.width = `${w}px`;
    ghostBarEl.style.height = `${h}px`;
    ghostBarEl.textContent = customLabel || `${formatDateRange(s, e)} · ${spanDays}d`;
  }

  // ISO week number (UTC)
  function isoWeekNumber(dt) {
    const tmp = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  function visibleItems() {
    return itemsList()
      .filter((it) => it && !it._hidden && typeof it._row === 'number' && it._row >= 0)
      .sort((a, b) => a._row - b._row);
  }

  function getDescendants(parentId) {
    const out = [];
    const byParent = new Map();
    itemsList().forEach((it) => {
      if (!it || !it.parent) return;
      if (!byParent.has(it.parent)) byParent.set(it.parent, []);
      byParent.get(it.parent).push(it);
    });
    const seen = new Set([parentId]);
    const walk = (pid) => {
      (byParent.get(pid) || []).forEach((ch) => {
        if (seen.has(ch.id)) return;
        seen.add(ch.id);
        out.push(ch);
        walk(ch.id);
      });
    };
    walk(parentId);
    return out;
  }

  function isAncestor(ancestorId, nodeId) {
    if (!ancestorId || !nodeId) return false;
    if (ancestorId === nodeId) return true;
    const seen = new Set([nodeId]);
    let cur = itemById(nodeId);
    while (cur && cur.parent) {
      if (cur.parent === ancestorId) return true;
      if (seen.has(cur.parent)) break;
      seen.add(cur.parent);
      cur = itemById(cur.parent);
    }
    return false;
  }

  function wouldCreateDepCycle(fromId, toId, ignoreDep) {
    if (fromId === toId) return true;
    const adj = new Map();
    depsList().forEach((d) => {
      if (!d || d === ignoreDep || !d.from || !d.to) return;
      if (!adj.has(d.from)) adj.set(d.from, []);
      adj.get(d.from).push(d.to);
    });
    const stack = [toId];
    const visited = new Set([toId]);
    while (stack.length) {
      const cur = stack.pop();
      if (cur === fromId) return true;
      (adj.get(cur) || []).forEach((nxt) => {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      });
    }
    return false;
  }

  function collectMovableLeaves(ids) {
    const leafMap = new Map();
    ids.forEach((id) => {
      const it = itemById(id);
      if (!it) return;
      if (it._hasChildren || it.kind === 'group') {
        getDescendants(it.id).forEach((ch) => {
          if (!ch._hasChildren && ch.kind !== 'group' && (ch.start || ch._start)) {
            leafMap.set(ch.id, ch);
          }
        });
      } else if (it.start || it._start) {
        leafMap.set(it.id, it);
      }
    });
    return [...leafMap.values()];
  }

  // --- VIEW & BIG-PLAN FILTERING ---
  function getVisibleDateWindow() {
    const range = chartData._range;
    if (!timeline || !range || !range.pxPerDay) return null;
    const width = timeline.clientWidth || 800;
    const startDays = Math.floor(timeline.scrollLeft / range.pxPerDay);
    const endDays = Math.ceil((timeline.scrollLeft + width) / range.pxPerDay);
    return {
      start: ganttAddDays(range.start, startDays),
      end: ganttAddDays(range.start, endDays)
    };
  }

  function computeConnectedItemIds(seedId) {
    const visited = new Set([seedId]);
    const queue = [seedId];
    const allDeps = depsList();
    while (queue.length) {
      const cur = queue.shift();
      for (let i = 0; i < allDeps.length; i++) {
        const d = allDeps[i];
        if (!d || !d.from || !d.to) continue;
        if (d.from === cur && !visited.has(d.to)) {
          visited.add(d.to);
          queue.push(d.to);
        } else if (d.to === cur && !visited.has(d.from)) {
          visited.add(d.from);
          queue.push(d.from);
        }
      }
    }
    return visited;
  }

  function addWithAncestors(id, targetSet) {
    let cur = id;
    const guard = new Set();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      targetSet.add(cur);
      const it = itemById(cur);
      cur = it ? it.parent : null;
    }
  }

  function computeFilterIds() {
    const allItems = itemsList();
    if (!allItems.length) return null;

    if (focusChainId) {
      if (!itemById(focusChainId)) {
        focusChainId = null;
      } else {
        const keep = new Set();
        computeConnectedItemIds(focusChainId).forEach((id) => addWithAncestors(id, keep));
        return keep;
      }
    }

    const todayStr = getTodayStr();
    if (viewMode === 'active' && !viewModeExplicit) {
      const scheduledLeaves = allItems.filter((it) => it && !it._hasChildren && it.kind !== 'group' && it._end);
      const anyActiveOrUpcoming = scheduledLeaves.some((it) => it._end >= todayStr);
      if (scheduledLeaves.length > 0 && !anyActiveOrUpcoming) {
        viewMode = 'all';
      }
    }

    if (viewMode === 'all' && !colorFilter) return null;

    const win = viewMode === 'in-view' ? getVisibleDateWindow() : null;
    if (viewMode === 'in-view' && win) {
      lastInViewWindowKey = `${win.start}|${win.end}`;
    }

    const keep = new Set();
    for (let i = 0; i < allItems.length; i++) {
      const it = allItems[i];
      if (!it || !it.id) continue;
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      if (isParent) {
        // Keep empty groups only in 'all' mode when matching colorFilter
        if (!it._hasChildren && viewMode === 'all' && (!colorFilter || effectiveColor(it) === colorFilter)) {
          addWithAncestors(it.id, keep);
        }
        continue;
      }
      if (colorFilter && effectiveColor(it) !== colorFilter) continue;

      let timeMatch = true;
      if (viewMode === 'active') {
        timeMatch = !it._end || it._end >= todayStr;
      } else if (viewMode === 'in-view') {
        timeMatch = Boolean(win && it._start && it._end && it._start <= win.end && it._end >= win.start);
      }
      if (timeMatch) addWithAncestors(it.id, keep);
    }
    return keep;
  }

  // --- LAYOUT & RENDERING ---
  function applyLayout(preserveFilter = false) {
    if (preserveFilter) {
      layoutDiagram(chartData);
      return;
    }
    if (viewMode === 'all' && !colorFilter && !focusChainId) {
      chartData._filterIds = null;
      layoutDiagram(chartData);
      return;
    }
    chartData._filterIds = null;
    layoutDiagram(chartData);
    const filterIds = computeFilterIds();
    chartData._filterIds = filterIds;
    if (filterIds) layoutDiagram(chartData);
  }

  function applySidebarWidth(w) {
    sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
    if (sidebar) sidebar.style.width = `${sidebarWidth}px`;
    if (root) root.style.setProperty('--gantt-sidebar-w', `${sidebarWidth}px`);
    if (splitter) {
      splitter.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
      splitter.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
      splitter.setAttribute('aria-valuenow', String(sidebarWidth));
      splitter.setAttribute('aria-valuetext', `${sidebarWidth} pixels`);
    }
  }

  function ensureDepsSvg() {
    if (!depsEl) return null;
    if (depsEl.tagName && depsEl.tagName.toLowerCase() === 'svg') {
      renderedDepsSvg = depsEl;
    } else {
      let s = depsEl.querySelector('svg');
      if (!s) {
        s = svgEl('svg', { class: 'gantt-deps-svg' });
        depsEl.appendChild(s);
      }
      renderedDepsSvg = s;
    }
    return renderedDepsSvg;
  }

  // --- KEYED RENDER HELPERS ---
  // Render reuses elements instead of rebuilding a layer: items are kept by id in `els`, update in place and are rebuilt
  // only when their shape changes (see *Shape below), so element identity survives a render and the FLIP morphs that read
  // it keep working. Events are delegated once per layer (wireLayerEvents), never attached per element per render.

  // Put `nodes` into `parent` in this order starting at `cursor` (default: the first child), moving only the ones out of
  // place. Returns the node after the last placed one (the first leftover).
  function placeInOrder(parent, nodes, cursor) {
    let at = cursor === undefined ? parent.firstChild : cursor;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n === at) at = at.nextSibling;
      else parent.insertBefore(n, at);
    }
    return at;
  }

  function removeFrom(node) {
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
  }

  // Drop the entries of `map` not seen this render, with their elements.
  function dropUnseen(map, seen, removeFn) {
    map.forEach((v, k) => {
      if (seen.has(k)) return;
      if (removeFn) removeFn(v); else v.remove();
      map.delete(k);
    });
  }

  function setStyle(el, prop, val) {
    if (el.style[prop] !== val) el.style[prop] = val;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setTip(el, tip) {
    if (el.dataset.tip !== tip) el.dataset.tip = tip;
    if (el.title !== tip) el.title = tip;
  }

  // Elements without listeners or identity (header ticks, weekend / holiday bands, gridlines) are pooled by position.
  function pooled(pool, i, make) {
    return pool[i] || (pool[i] = make());
  }

  function trimPool(pool, n) {
    while (pool.length > n) pool.pop().remove();
  }

  const tickPools = new Map();     // header container -> its tick elements in order

  function renderHeader(range, zoomKey, fullW) {
    if (!headerTop || !headerBottom || !headerEl) return;
    const used = new Map([[headerTop, 0], [headerBottom, 0]]);
    const finishTicks = () => {
      used.forEach((n, container) => trimPool(tickPools.get(container) || [], n));
    };

    const pxPerDay = range.pxPerDay;
    const totalW = fullW || range.timelineWidth;
    headerEl.style.width = `${totalW}px`;
    headerTop.style.width = `${totalW}px`;
    headerBottom.style.width = `${totalW}px`;
    if (headerMarkers) headerMarkers.style.width = `${totalW}px`;

    const startDt = ganttParseDate(range.start);
    const endDt = ganttParseDate(range.end);
    if (!startDt || !endDt) {
      finishTicks();
      return;
    }

    const gridLines = [];

    // One tick at the next position of `container`; a day tick (two spans) and a text tick never share an element.
    function nextTick(container, isDay) {
      let pool = tickPools.get(container);
      if (!pool) { pool = []; tickPools.set(container, pool); }
      const i = used.get(container);
      used.set(container, i + 1);
      let cell = pool[i];
      if (cell && (cell.childElementCount === 2) !== isDay) {
        cell.remove();
        pool.splice(i, 1);
        cell = null;
      }
      if (!cell) {
        cell = htmlEl('div', '');
        if (isDay) cell.append(htmlEl('span', 'gantt-day-num'), htmlEl('span', 'gantt-day-dow'));
        container.insertBefore(cell, pool[i] || null);
        pool.splice(i, 0, cell);
      }
      return cell;
    }

    function addTick(container, left, width, text, extraCls) {
      const cell = nextTick(container, false);
      const cls = `gantt-tick${extraCls ? ' ' + extraCls : ''}`;
      if (cell.className !== cls) cell.className = cls;
      setStyle(cell, 'left', `${left}px`);
      setStyle(cell, 'width', `${width}px`);
      setText(cell, text);
    }

    // Helper: iterate calendar months covering [startDt, endDt]
    function forEachMonth(cb) {
      let y = startDt.getUTCFullYear();
      let m = startDt.getUTCMonth();
      const endY = endDt.getUTCFullYear();
      const endM = endDt.getUTCMonth();
      while (y < endY || (y === endY && m <= endM)) {
        const mStart = new Date(Date.UTC(y, m, 1));
        const mEnd = new Date(Date.UTC(y, m + 1, 0));
        const cStart = mStart < startDt ? startDt : mStart;
        const cEnd = mEnd > endDt ? endDt : mEnd;
        const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
        const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
        cb({ y, m, left, width: days * pxPerDay });
        m++;
        if (m > 11) { m = 0; y++; }
      }
    }

    // Helper: iterate calendar years covering [startDt, endDt]
    function forEachYear(cb) {
      const startY = startDt.getUTCFullYear();
      const endY = endDt.getUTCFullYear();
      for (let y = startY; y <= endY; y++) {
        const yStart = new Date(Date.UTC(y, 0, 1));
        const yEnd = new Date(Date.UTC(y, 11, 31));
        const cStart = yStart < startDt ? startDt : yStart;
        const cEnd = yEnd > endDt ? endDt : yEnd;
        const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
        const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
        cb({ y, left, width: days * pxPerDay });
      }
    }

    if (zoomKey === 'day') {
      const showWknd = showWeekendsActive(zoomKey);
      forEachMonth(({ y, m, left, width }) => {
        addTick(headerTop, left, width, `${MONTH_LONG[m]} ${y}`, 'gantt-tick-top');
      });
      for (let i = 0; i < range.totalDays; i++) {
        const iso = ganttAddDays(range.start, i);
        const dt = ganttParseDate(iso);
        const dow = dt.getUTCDay();
        const isWknd = dow === 0 || dow === 6;
        const left = i * pxPerDay;
        const cell = nextTick(headerBottom, true);
        const cls = `gantt-tick gantt-tick-bot is-day${isWknd && showWknd ? ' is-weekend' : ''}`;
        if (cell.className !== cls) cell.className = cls;
        setStyle(cell, 'left', `${left}px`);
        setStyle(cell, 'width', `${pxPerDay}px`);
        setText(cell.firstChild, String(dt.getUTCDate()));
        setText(cell.lastChild, WEEKDAY_SHORT[dow]);
        gridLines.push({ x: left, major: dt.getUTCDate() === 1 });
      }
    } else if (zoomKey === 'week') {
      forEachMonth(({ y, m, left, width }) => {
        addTick(headerTop, left, width, `${MONTH_LONG[m]} ${y}`, 'gantt-tick-top');
      });
      // Align week ticks to Mondays
      let curIso = range.start;
      const startDow = startDt.getUTCDay();
      const backToMon = startDow === 0 ? 6 : startDow - 1;
      curIso = ganttAddDays(range.start, -backToMon);
      while (curIso <= range.end) {
        const wkEnd = ganttAddDays(curIso, 6);
        const cStart = curIso < range.start ? range.start : curIso;
        const cEnd = wkEnd > range.end ? range.end : wkEnd;
        const left = ganttDiffDays(range.start, cStart) * pxPerDay;
        const days = ganttDiffDays(cStart, cEnd) + 1;
        const dt = ganttParseDate(curIso);
        const wkNum = isoWeekNumber(dt);
        const lbl = `W${wkNum} · ${MONTH_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
        addTick(headerBottom, left, days * pxPerDay, lbl, 'gantt-tick-bot');
        if (left > 0) gridLines.push({ x: left, major: dt.getUTCDate() <= 7 });
        curIso = ganttAddDays(curIso, 7);
      }
    } else if (zoomKey === 'month') {
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      forEachMonth(({ m, left, width }) => {
        addTick(headerBottom, left, width, MONTH_SHORT[m], 'gantt-tick-bot');
        gridLines.push({ x: left, major: m === 0 });
      });
    } else if (zoomKey === 'quarter') {
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      for (let y = startDt.getUTCFullYear(); y <= endDt.getUTCFullYear(); y++) {
        for (let q = 0; q < 4; q++) {
          const qStart = new Date(Date.UTC(y, q * 3, 1));
          const qEnd = new Date(Date.UTC(y, q * 3 + 3, 0));
          if (qEnd < startDt || qStart > endDt) continue;
          const cStart = qStart < startDt ? startDt : qStart;
          const cEnd = qEnd > endDt ? endDt : qEnd;
          const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
          const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
          addTick(headerBottom, left, days * pxPerDay, `Q${q + 1}`, 'gantt-tick-bot');
          gridLines.push({ x: left, major: q === 0 });
        }
      }
    } else {
      // year
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      for (let y = startDt.getUTCFullYear(); y <= endDt.getUTCFullYear(); y++) {
        for (let h = 0; h < 2; h++) {
          const hStart = new Date(Date.UTC(y, h * 6, 1));
          const hEnd = new Date(Date.UTC(y, h * 6 + 6, 0));
          if (hEnd < startDt || hStart > endDt) continue;
          const cStart = hStart < startDt ? startDt : hStart;
          const cEnd = hEnd > endDt ? endDt : hEnd;
          const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
          const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
          addTick(headerBottom, left, days * pxPerDay, `H${h + 1}`, 'gantt-tick-bot');
          gridLines.push({ x: left, major: h === 0 });
        }
      }
    }

    finishTicks();
    return gridLines;
  }

  const gridPools = { weekend: [], holiday: [], line: [] };

  function renderGrid(range, zoomKey, visItems, gridLines, fullW) {
    if (!gridEl) return;
    if (headerMarkers) {
      headerMarkers.querySelectorAll('.gantt-holiday-flag').forEach((n) => n.remove());
    }
    const rowH = GANTT_METRICS.ROW_H;
    const totalH = Math.max(1, visItems.length) * rowH;
    const totalW = fullW || range.timelineWidth;
    gridEl.style.width = `${totalW}px`;
    gridEl.style.height = `${totalH}px`;
    const order = [];

    // Horizontal row stripes (keyed by item id; hover / schedule-drag events are delegated in wireLayerEvents)
    const seen = new Set();
    visItems.forEach((it, idx) => {
      const isUnscheduledLeaf = !it._bar && it.kind !== 'group' && !it._hasChildren;
      let rowBg = els.rowBgs.get(it.id);
      if (!rowBg) {
        rowBg = htmlEl('div', 'gantt-row-bg');
        rowBg.dataset.rowId = it.id;
        els.rowBgs.set(it.id, rowBg);
      }
      rowBg.classList.toggle('is-alt', idx % 2 === 1);
      rowBg.classList.toggle('is-selected', selItems.has(it.id));
      rowBg.classList.toggle('is-hovered', hoveredRowId === it.id);
      rowBg.classList.toggle('is-unscheduled', isUnscheduledLeaf);
      setStyle(rowBg, 'top', `${idx * rowH}px`);
      setStyle(rowBg, 'height', `${rowH}px`);
      setStyle(rowBg, 'width', `${totalW}px`);
      seen.add(it.id);
      order.push(rowBg);
    });
    dropUnseen(els.rowBgs, seen);

    // Weekend bands (Day / Week only, when showWeekends is enabled)
    let nWeekend = 0;
    if (showWeekendsActive(zoomKey)) {
      const pxPerDay = range.pxPerDay;
      for (let i = 0; i < range.totalDays; i++) {
        const iso = ganttAddDays(range.start, i);
        const dt = ganttParseDate(iso);
        const dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) {
          const band = pooled(gridPools.weekend, nWeekend++, () => htmlEl('div', 'gantt-weekend'));
          setStyle(band, 'left', `${i * pxPerDay}px`);
          setStyle(band, 'width', `${pxPerDay}px`);
          setStyle(band, 'height', `${totalH}px`);
          order.push(band);
        }
      }
    }
    trimPool(gridPools.weekend, nWeekend);

    // Holiday bands
    const holidays = chartData._holidays || [];
    holidays.forEach((h, i) => {
      const band = pooled(gridPools.holiday, i, () => htmlEl('div', 'gantt-holiday'));
      setStyle(band, 'left', `${h.x}px`);
      setStyle(band, 'width', `${Math.max(2, h.w)}px`);
      setStyle(band, 'height', `${totalH}px`);
      const tip = h.country ? `${h.name || 'Holiday'} (${h.country}) · ${formatDateRange(h.start, h.end)}` : `${h.name || 'Holiday'} · ${formatDateRange(h.start, h.end)}`;
      setTip(band, tip);
      order.push(band);
    });
    trimPool(gridPools.holiday, holidays.length);

    // Vertical gridlines
    const lines = gridLines || [];
    lines.forEach((gl, i) => {
      const line = pooled(gridPools.line, i, () => htmlEl('div', 'gantt-gridline'));
      line.classList.toggle('is-major', Boolean(gl.major));
      setStyle(line, 'left', `${gl.x}px`);
      setStyle(line, 'height', `${totalH}px`);
      order.push(line);
    });
    trimPool(gridPools.line, lines.length);

    removeFrom(placeInOrder(gridEl, order));
  }

  // A sidebar row is rebuilt only when this changes; everything else is patched in place.
  function treeRowShape(it, edit) {
    return `${edit ? 1 : 0}|${it._hasChildren || it.kind === 'group' ? 1 : 0}|${it.kind || 'task'}`;
  }

  function buildTreeRow(it, edit) {
    const row = htmlEl('div', 'gantt-tree-row');
    row.dataset.itemId = it.id;
    row.dataset.kind = it.kind || 'task';
    row.setAttribute('role', 'treeitem');
    const isParent = Boolean(it._hasChildren || it.kind === 'group');
    if (isParent) row.classList.add('is-parent');
    if (edit) {
      row.draggable = false; // pointer-based row drag
      const grip = htmlEl('span', 'gantt-row-grip', '⋮');
      grip.setAttribute('aria-hidden', 'true');
      grip.setAttribute('data-export-skip', '');
      row.appendChild(grip);
    }

    // Collapse/expand chevron (its rotation follows aria-expanded, patched in renderSidebar)
    if (isParent) {
      row.appendChild(ui.chevron({ expanded: !it.collapsed, label: '' }));
    } else {
      row.appendChild(htmlEl('span', 'chevron-spacer'));
    }

    // Kind indicator dot / diamond
    row.appendChild(htmlEl('span', `gantt-tree-dot is-${it.kind || 'task'}`));

    // Label
    row.appendChild(htmlEl('span', 'gantt-tree-label'));

    // Quick + subtask button on hover
    if (edit && it.kind !== 'milestone') {
      const addBtn = htmlEl('button', 'gantt-row-add');
      addBtn.type = 'button';
      addBtn.setAttribute('data-export-skip', '');
      addBtn.innerHTML = ui.icon('plus', { size: 'xs', bold: true });
      row.appendChild(addBtn);
    }
    return row;
  }

  function renderSidebar(visItems) {
    if (!treeEl) return;
    const rowH = GANTT_METRICS.ROW_H;
    const edit = !presenting();
    const order = [];
    const seen = new Set();

    visItems.forEach((it, idx) => {
      const shape = treeRowShape(it, edit);
      let row = els.rows.get(it.id);
      if (!row || row._shape !== shape) {
        if (row) row.remove();
        row = buildTreeRow(it, edit);
        row._shape = shape;
        els.rows.set(it.id, row);
      }
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      const name = it.label || it.id;
      row.classList.toggle('is-alt', idx % 2 === 1);
      row.classList.toggle('selected', selItems.has(it.id));
      row.classList.toggle('is-hovered', hoveredRowId === it.id);
      row.setAttribute('aria-level', String((it._depth || 0) + 1));
      row.setAttribute('aria-selected', String(selItems.has(it.id)));
      if (isParent) row.setAttribute('aria-expanded', String(!it.collapsed));
      setStyle(row, 'height', `${rowH}px`);
      setStyle(row, 'paddingLeft', `${6 + (it._depth || 0) * 14}px`);

      const chev = row.querySelector(':scope > .chevron');
      if (chev) {
        const chevLabel = it.collapsed ? `Expand ${name}` : `Collapse ${name}`;
        chev.setAttribute('aria-expanded', String(!it.collapsed));
        if (chev.title !== chevLabel) chev.title = chevLabel;
        chev.setAttribute('aria-label', chevLabel);
      }
      setSwatch(row.querySelector(':scope > .gantt-tree-dot'), effectiveColor(it));
      const lbl = row.querySelector(':scope > .gantt-tree-label');
      if (!lbl.isContentEditable) setText(lbl, name);
      setTip(lbl, name);
      const addBtn = row.querySelector(':scope > .gantt-row-add');
      if (addBtn) {
        const addTitle = `Add subtask under ${name}`;
        if (addBtn.title !== addTitle) addBtn.title = addTitle;
        addBtn.setAttribute('aria-label', addTitle);
      }
      seen.add(it.id);
      order.push(row);
    });
    dropUnseen(els.rows, seen);
    removeFrom(placeInOrder(treeEl, order));
  }

  function makeNoteBadge() {
    const badge = htmlEl('button', 'note-badge');
    badge.type = 'button';
    badge.setAttribute('data-export-skip', '');
    badge.innerHTML = ui.icon('note-lines', { size: 'xs', bold: true });
    return badge;
  }

  function makePorts(host) {
    const portL = ui.port('left');
    portL.dataset.port = 'ss';
    portL.title = 'Drag to connect (Start-to-Start)';
    const portR = ui.port('right');
    portR.dataset.port = 'fs';
    portR.title = 'Drag to connect (Finish-to-Start)';
    host.append(portL, portR);
  }

  // 'milestone' | 'group' | 'task', plus edit handles and the note badge: a change rebuilds that one bar.
  function barKind(it) {
    if (it.kind === 'milestone' && !it._hasChildren) return 'milestone';
    return (it._hasChildren || it.kind === 'group') ? 'group' : 'task';
  }

  function buildBar(it, kind, edit, hasNote) {
    if (kind === 'milestone') {
      const ms = htmlEl('div', 'gantt-milestone');
      ms.dataset.itemId = it.id;
      ms.dataset.nodeId = it.id;
      ms.dataset.kind = 'milestone';
      ms.appendChild(htmlEl('div', 'gantt-ms-diamond'));
      ms.appendChild(htmlEl('span', 'gantt-ms-label'));
      if (hasNote) {
        ms.classList.add('has-note');
        ms.appendChild(makeNoteBadge());
      }
      if (edit) {
        ms.setAttribute('data-touch-drag', '1');
        makePorts(ms);
      }
      return ms;
    }

    // Task bar or Parent summary bar (never render task text inside bars; sidebar is frozen)
    const isParent = kind === 'group';
    const bar = htmlEl('div', isParent ? 'gantt-bar gantt-summary' : 'gantt-bar');
    if (!isParent) bar.dataset.item = '';   // a summary bar is a bracket, not a box: it keeps its own states
    bar.dataset.itemId = it.id;
    bar.dataset.nodeId = it.id;
    bar.dataset.kind = kind;
    if (hasNote) {
      bar.classList.add('has-note');
      bar.appendChild(makeNoteBadge());
    }
    if (edit && !isParent) {
      bar.setAttribute('data-touch-drag', '1');
      const resL = htmlEl('span', 'gantt-resize gantt-resize-l');
      resL.title = 'Resize start date';
      resL.setAttribute('data-export-skip', '');
      const resR = htmlEl('span', 'gantt-resize gantt-resize-r');
      resR.title = 'Resize end date';
      resR.setAttribute('data-export-skip', '');
      bar.append(resL, resR);
    }
    if (edit) makePorts(bar);
    return bar;
  }

  // Geometry, time state and tooltip of one bar; shared by render and drag frames. Skips the writes when nothing moved.
  function patchBarGeometry(el, it, todayStr) {
    const b = it._bar;
    const timeState = getTimeState(it, todayStr);
    const geomKey = `${b.x}|${b.y}|${b.w}|${b.h}|${it._start}|${it._end}|${timeState}|${it.label}`;
    if (el._geomKey === geomKey) return;
    el._geomKey = geomKey;
    const isMs = el.classList.contains('gantt-milestone');
    el.dataset.timeState = timeState;
    setStyle(el, 'left', `${b.x}px`);
    setStyle(el, 'top', `${b.y}px`);
    setStyle(el, 'width', `${isMs ? b.w : Math.max(4, b.w)}px`);
    setStyle(el, 'height', `${b.h}px`);
    setTip(el, isMs ? `${it.label || it.id} · ${formatShortDate(it._start)}` : formatBarTip(it));
  }

  function renderBars(visItems, todayStr) {
    if (!barsEl) return;
    hideGhostBar();
    const edit = !presenting();
    const hasOutFs = new Set();
    (chartData._deps || []).forEach((d) => {
      if (d && d.from && d.type !== 'ss') hasOutFs.add(d.from);
    });
    const noteByTarget = new Map();
    notesList().forEach((n) => { if (n && !noteByTarget.has(n.target)) noteByTarget.set(n.target, n); });
    const order = [];
    const seen = new Set();

    visItems.forEach((it) => {
      if (!it._bar) return;
      const kind = barKind(it);
      const note = noteByTarget.get(it.id) || null;
      const shape = `${kind}|${edit ? 1 : 0}|${note ? 1 : 0}`;
      let el = els.bars.get(it.id);
      if (!el || el._shape !== shape) {
        if (el) el.remove();
        el = buildBar(it, kind, edit, Boolean(note));
        el._shape = shape;
        els.bars.set(it.id, el);
      }
      patchBarGeometry(el, it, todayStr);
      setSwatch(el, effectiveColor(it));
      el.classList.toggle('selected', selItems.has(it.id));
      if (kind === 'milestone') setText(el.querySelector(':scope > .gantt-ms-label'), it.label || it.id);
      else el.classList.toggle('has-out-dep', hasOutFs.has(it.id));
      if (note) {
        const badge = el.querySelector(':scope > .note-badge');
        badge.setAttribute('aria-label', `Note: ${note.text || ''}`);
        const noteTitle = note.text || 'Note';
        if (badge.title !== noteTitle) badge.title = noteTitle;
      }
      seen.add(it.id);
      order.push(el);
    });
    dropUnseen(els.bars, seen);
    removeFrom(placeInOrder(barsEl, order));
  }

  function patchMarker(rec, m) {
    setStyle(rec.line, 'left', `${m.x}px`);
    setStyle(rec.flag, 'left', `${m.x}px`);
    setText(rec.flag, m.date ? `${m.label || 'Milestone'} · ${formatShortDate(m.date)}` : (m.label || 'Milestone'));
  }

  function renderMarkers(visItems) {
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    const lines = [];
    const flags = [];
    const seen = new Set();

    (chartData._markers || []).forEach((m) => {
      let rec = els.markers.get(m.id);
      if (!rec) {
        const line = htmlEl('div', 'gantt-marker-line');
        line.dataset.markerId = m.id;
        const flag = htmlEl('div', 'gantt-marker-flag');
        flag.dataset.markerId = m.id;
        rec = { line, flag };
        els.markers.set(m.id, rec);
      }
      const { line, flag } = rec;
      patchMarker(rec, m);
      setStyle(line, 'height', `${totalH}px`);
      setSwatch(line, m.color || '4');
      setSwatch(flag, m.color || '4');
      line.classList.toggle('selected', selMarkerId === m.id);
      flag.classList.toggle('selected', selMarkerId === m.id);
      const tip = `${m.label || 'Milestone'} · ${formatShortDate(m.date)}`;
      if (flag.dataset.tip !== tip) flag.dataset.tip = tip;
      seen.add(m.id);
      lines.push(line);
      flags.push(flag);
    });
    dropUnseen(els.markers, seen, (rec) => { rec.line.remove(); rec.flag.remove(); });
    if (markersEl) removeFrom(placeInOrder(markersEl, lines));
    if (headerMarkers) placeInOrder(headerMarkers, flags);
  }

  function renderToday(range, visItems, todayStr) {
    if (todayEl) todayEl.textContent = '';
    if (headerMarkers) {
      headerMarkers.querySelectorAll('.gantt-today-pill').forEach((n) => n.remove());
    }
    if (chartData.showToday === false || !todayStr || !range) return;
    if (todayStr < range.start || todayStr > range.end) return;

    const x = Math.round((ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay * 10) / 10;
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;

    if (todayEl) {
      const line = htmlEl('div', 'gantt-today-line');
      line.style.left = `${x}px`;
      line.style.height = `${totalH}px`;
      line.dataset.today = todayStr;
      todayEl.appendChild(line);
    }
    if (headerMarkers) {
      const pill = htmlEl('div', 'gantt-today-pill', `Today · ${formatShortDate(todayStr)}`);
      pill.style.left = `${x}px`;
      pill.title = `Today · ${todayStr}`;
      headerMarkers.appendChild(pill);
    }
  }

  let depsDefs = null;               // arrowhead <defs>, built once
  const depEls = new Map();          // `${depKey}#${n}` -> { g, path, hit, title, d, violated, sel } (n: duplicate count)
  const depKeyByEl = new WeakMap();  // dependency <g> -> its depKey (pointer delegation)

  // Keyed in place like the bars. `live` (drag frames) skips the chain spotlight unless an arrow changed state.
  function renderDependencies(range, visItems, live) {
    const svg = ensureDepsSvg();
    if (!svg) return;
    els.deps.clear();

    const totalW = range.timelineWidth;
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    if (svg.getAttribute('width') !== String(totalW)) svg.setAttribute('width', String(totalW));
    if (svg.getAttribute('height') !== String(totalH)) svg.setAttribute('height', String(totalH));
    const vb = `0 0 ${totalW} ${totalH}`;
    if (svg.getAttribute('viewBox') !== vb) svg.setAttribute('viewBox', vb);
    setStyle(svg, 'width', `${totalW}px`);
    setStyle(svg, 'height', `${totalH}px`);

    // Arrowhead defs
    if (!depsDefs) {
      depsDefs = svgEl('defs');
      [
        ['gantt-arr', 'gantt-arr-fill'],
        ['gantt-arr-warn', 'gantt-arr-warn-fill'],
        ['gantt-arr-sel', 'gantt-arr-sel-fill']
      ].forEach(([id, cls]) => {
        const mk = svgEl('marker', {
          id,
          viewBox: '0 0 10 10',
          refX: '8.5',
          refY: '5',
          markerWidth: '7',
          markerHeight: '7',
          orient: 'auto-start-reverse'
        });
        mk.appendChild(svgEl('path', { d: 'M 1 1.5 L 9 5 L 1 8.5 z', class: cls }));
        depsDefs.appendChild(mk);
      });
    }

    const order = [depsDefs];
    const seen = new Set();
    const dupCount = new Map();
    let changed = false;
    (chartData._deps || []).forEach((dep) => {
      const key = depKeyOf(dep);
      const n = dupCount.get(key) || 0;
      dupCount.set(key, n + 1);
      const slot = `${key}#${n}`;
      const isSel = selDepKey === key;
      let rec = depEls.get(slot);
      if (!rec) {
        const g = svgEl('g', { class: 'gantt-dep-group', 'data-from': dep.from, 'data-to': dep.to, 'data-dep-type': dep.type });
        const title = svgEl('title');
        const hit = svgEl('path', { class: 'gantt-dep-hit', fill: 'none', stroke: 'transparent', 'stroke-width': '12' });
        const path = svgEl('path', { class: 'gantt-dep-path', fill: 'none' });
        g.append(title, hit, path);
        depKeyByEl.set(g, key);
        rec = { g, path, hit, title, d: null, violated: null, sel: null };
        depEls.set(slot, rec);
        changed = true;
      }
      if (rec.d !== dep.path) {
        rec.d = dep.path;
        rec.hit.setAttribute('d', dep.path);
        rec.path.setAttribute('d', dep.path);
      }
      if (rec.violated !== Boolean(dep.violated) || rec.sel !== isSel) {
        if (rec.violated !== Boolean(dep.violated)) changed = true;
        rec.violated = Boolean(dep.violated);
        rec.sel = isSel;
        rec.g.classList.toggle('violated', rec.violated);
        rec.g.classList.toggle('selected', isSel);
        rec.path.classList.toggle('violated', rec.violated);
        rec.path.classList.toggle('selected', isSel);
        rec.title.textContent = dep.violated
          ? (dep.type === 'ss' ? 'Starts before prerequisite starts' : 'Starts before prerequisite ends')
          : `${dep.type.toUpperCase()} dependency`;
        rec.path.setAttribute('marker-end', isSel ? 'url(#gantt-arr-sel)' : dep.violated ? 'url(#gantt-arr-warn)' : 'url(#gantt-arr)');
      }
      seen.add(slot);
      order.push(rec.g);
      els.deps.set(key, rec);
    });
    dropUnseen(depEls, seen, (rec) => rec.g.remove());
    placeInOrder(svg, order);

    if (depsEl) depsEl.classList.toggle('is-dense', (chartData._deps || []).length > 12);
    syncDepsVisibility();
    if (!live || changed) syncDepSpotlight();
  }

  function syncDepsVisibility() {
    if (depsEl) depsEl.classList.toggle('is-hidden', !showDeps);
    if (btnDeps) {
      btnDeps.setAttribute('aria-checked', String(showDeps));
      btnDeps.title = showDeps ? 'Hide dependency arrows' : 'Show dependency arrows';
    }
  }

  function computeConnectedDepKeys(seedIds) {
    const chain = new Set();
    if (!seedIds || !seedIds.length) return chain;
    const deps = chartData._deps || [];
    if (!deps.length) return chain;
    const outMap = new Map();
    const inMap = new Map();
    deps.forEach((d) => {
      if (!d || !d.from || !d.to) return;
      if (!outMap.has(d.from)) outMap.set(d.from, []);
      outMap.get(d.from).push(d);
      if (!inMap.has(d.to)) inMap.set(d.to, []);
      inMap.get(d.to).push(d);
    });

    const visitedUp = new Set(seedIds);
    const upQueue = [...seedIds];
    while (upQueue.length) {
      const cur = upQueue.pop();
      (inMap.get(cur) || []).forEach((d) => {
        chain.add(depKeyOf(d));
        if (!visitedUp.has(d.from)) {
          visitedUp.add(d.from);
          upQueue.push(d.from);
        }
      });
    }

    const visitedDown = new Set(seedIds);
    const downQueue = [...seedIds];
    while (downQueue.length) {
      const cur = downQueue.pop();
      (outMap.get(cur) || []).forEach((d) => {
        chain.add(depKeyOf(d));
        if (!visitedDown.has(d.to)) {
          visitedDown.add(d.to);
          downQueue.push(d.to);
        }
      });
    }
    return chain;
  }

  function syncDepSpotlight() {
    if (!depsEl) return;
    const seeds = hoveredItemId ? [hoveredItemId] : [...selItems];
    const hasFocus = seeds.length > 0;
    const chainKeys = hasFocus ? computeConnectedDepKeys(seeds) : new Set();
    depsEl.classList.toggle('has-focus', hasFocus);

    const depByKey = new Map();
    (chartData._deps || []).forEach((d) => {
      if (d) depByKey.set(depKeyOf(d), d);
    });

    els.deps.forEach((rec, key) => {
      const isChain = hasFocus && chainKeys.has(key);
      const isSel = selDepKey === key;
      rec.path.classList.toggle('is-chain', isChain);
      const dep = depByKey.get(key);
      const url = (dep && dep.violated)
        ? 'url(#gantt-arr-warn)'
        : (isSel || isChain) ? 'url(#gantt-arr-sel)' : 'url(#gantt-arr)';
      rec.path.setAttribute('marker-end', url);
    });
  }

  function toggleLegendPop(force, pin) {
    if (!colorKeyHost) return;
    const show = typeof force === 'boolean' ? force : !legendOpen;
    legendOpen = show;
    if (!show) legendPinned = false;
    else if (typeof pin === 'boolean') legendPinned = pin;
    colorKeyHost.hidden = !show;
    if (btnLegend) btnLegend.setAttribute('aria-expanded', String(show));
  }

  function renderColorKey() {
    if (!colorKeyHost) return;
    colorKeyHost.textContent = '';
    const usedSet = new Set();
    itemsList().forEach((it) => { if (it && it.color) usedSet.add(colorSlot(it.color)); });
    markersList().forEach((m) => { if (m && m.color) usedSet.add(colorSlot(m.color)); });
    if (chartData.colorKey) {
      Object.keys(chartData.colorKey).forEach((k) => { if (chartData.colorKey[k]) usedSet.add(colorSlot(k)); });
    }
    const used = [...usedSet].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
    const hasOverlap = (chartData._deps || []).some((d) => d && d.violated);
    if (!used.length && !hasOverlap) {
      legendOpen = false;
      legendPinned = false;
      colorKeyHost.hidden = true;
      if (btnLegend) {
        btnLegend.hidden = true;
        btnLegend.classList.remove('is-filtered');
        btnLegend.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    let box = used.length ? ui.colorKey(used, chartData.colorKey || {}, { prompts: !presenting() }) : null;
    if (!box && !hasOverlap) {
      legendOpen = false;
      legendPinned = false;
      colorKeyHost.hidden = true;
      if (btnLegend) {
        btnLegend.hidden = true;
        btnLegend.classList.remove('is-filtered');
        btnLegend.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    if (!box) {
      box = htmlEl('div', 'color-key');
    }
    if (hasOverlap) {
      const ov = htmlEl('span', 'gantt-key-overlap');
      ov.title = 'A dependent task starts before its prerequisite finishes';
      const dash = htmlEl('span', 'gantt-key-overlap-line');
      dash.setAttribute('aria-hidden', 'true');
      ov.append(dash, htmlEl('span', 'gantt-key-overlap-text', 'Schedule overlap'));
      box.appendChild(ov);
    }
    if (btnLegend) {
      btnLegend.hidden = false;
      btnLegend.classList.toggle('is-filtered', Boolean(colorFilter));
      btnLegend.setAttribute('aria-expanded', String(legendOpen));
    }
    colorKeyHost.hidden = !legendOpen;
    colorKeyHost.appendChild(box);
    box.querySelectorAll('.color-key-item').forEach((itemEl) => {
      const lbl = itemEl.querySelector('.color-key-label');
      const slot = lbl ? lbl.dataset.color : '';
      if (!slot) return;
      itemEl.dataset.color = slot;
      itemEl.tabIndex = 0;
      itemEl.setAttribute('role', 'button');
      itemEl.setAttribute('aria-pressed', String(colorFilter === slot));
      itemEl.title = presenting() ? 'Click to filter by stream' : 'Click to filter · Double-click label to rename';
      itemEl.classList.toggle('is-filter-active', colorFilter === slot);
      itemEl.classList.toggle('is-filter-dim', Boolean(colorFilter && colorFilter !== slot));
      itemEl.addEventListener('click', (e) => {
        if (lbl && lbl.isContentEditable) return;
        e.stopPropagation();
        toggleColorFilter(slot);
      });
      itemEl.addEventListener('keydown', (e) => {
        if (lbl && lbl.isContentEditable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggleColorFilter(slot);
        }
      });
      if (!presenting() && lbl) {
        lbl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          editColorKeySlot(slot, lbl);
        });
      }
    });
  }

  function editColorKeySlot(slot, lbl) {
    if (presenting() || !slot || !lbl) return;
    legendPinned = true;
    lbl.contentEditable = 'true';
    lbl.focus();
    const finish = () => {
      lbl.contentEditable = 'false';
      const val = lbl.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!chartData.colorKey) chartData.colorKey = {};
      const prev = chartData.colorKey[slot] || '';
      if (val === prev) { renderColorKey(); return; }
      if (val) chartData.colorKey[slot] = val;
      else delete chartData.colorKey[slot];
      if (!Object.keys(chartData.colorKey).length) delete chartData.colorKey;
      renderColorKey();
      updateStatus(true);
    };
    lbl.addEventListener('blur', finish, { once: true });
    lbl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') lbl.textContent = (chartData.colorKey && chartData.colorKey[slot]) || '';
        lbl.blur();
      }
    });
  }

  // --- NOTES ---
  function isNoteVisible(n) {
    if (!n || !n.target) return false;
    const it = itemById(n.target);
    if (!it || it._hidden || !it._bar) return false;
    if (n.id === noteCtl.editingId()) return true;
    if (chartData.showNotes === true && n.text && n.text.trim()) return true;
    if (peekNoteItemId === n.target && n.text && n.text.trim()) return true;
    return false;
  }

  function renderNotes() {
    if (!notesEl) return;
    notesEl.textContent = '';
    els.notes.clear();
    const edit = !presenting();
    const live = notesList().filter(isNoteVisible);
    if (selNoteId && !live.some((n) => n.id === selNoteId)) selNoteId = null;

    live.forEach((n) => {
      const it = itemById(n.target);
      if (!it || !it._bar) return;
      const { card, text } = ui.noteCard(n, edit ? {
        onDelete: () => removeNote(n.id),
        onCommit: (el) => commitNote(n, el)
      } : {});
      card.classList.add('show');
      if (selNoteId === n.id) card.classList.add('selected');
      card.setAttribute('role', 'note');
      card.setAttribute('aria-label', `Note on ${it.label || it.id}: ${n.text || 'empty'}`);

      // Position beside/below bar in #gantt-body coordinates
      const b = it._bar;
      const x = Math.max(8, Math.min((chartData._range ? chartData._range.timelineWidth : 600) - 220, b.x + b.w + 12));
      const y = Math.max(4, b.y + b.h + 4);
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;

      if (edit) {
        text.addEventListener('blur', () => commitNote(n, text));
        card.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.isContentEditable) return;
          e.stopPropagation();
          selectNote(n.id);
        });
        card.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          editNote(n.id);
        });
      }

      notesEl.appendChild(card);
      els.notes.set(n.id, card);
    });
  }

  function updateNotesButton() {
    if (!btnNotes) return;
    const count = notesList().filter((n) => n && n.text && n.text.trim()).length;
    const on = chartData.showNotes === true;
    btnNotes.setAttribute('aria-checked', String(on));
    btnNotes.disabled = !count && !on;
    const c = btnNotes.querySelector('.btn-count');
    if (c) {
      c.textContent = count ? String(count) : '';
      c.hidden = !count;
    }
    btnNotes.title = !count ? 'No notes yet' : on ? 'Hide all notes' : 'Show all notes';
  }

  function toggleShowNotes() {
    chartData.showNotes = chartData.showNotes !== true;
    if (!chartData.showNotes) peekNoteItemId = null;
    renderNotes();
    updateNotesButton();
    if (!presenting()) updateStatus(true);
  }

  function selectNote(id) {
    selItems.clear();
    selMarkerId = null;
    selDepKey = null;
    selNoteId = id;
    syncSelectionUi();
  }

  function peekOrEditNote(itemId) {
    const n = noteForTarget(itemId);
    if (!n) return;
    if (presenting()) {
      peekNoteItemId = peekNoteItemId === itemId ? null : itemId;
      renderNotes();
      return;
    }
    peekNoteItemId = itemId;
    renderNotes();
    editNote(n.id);
  }

  function addOrEditNoteForTarget(itemId) {
    if (presenting()) return;
    const it = itemById(itemId);
    if (!it) {
      ui.toast('Select a task or milestone first to add a note');
      return;
    }
    const existing = noteForTarget(it.id);
    if (existing) {
      peekNoteItemId = it.id;
      renderNotes();
      editNote(existing.id);
      return;
    }
    if (!Array.isArray(chartData.notes)) chartData.notes = [];
    const note = { id: newId('n'), text: '', target: it.id };
    chartData.notes.push(note);
    noteCtl.begin(note, true);
    peekNoteItemId = it.id;
    render();
    editNote(note.id);
  }

  function editNote(id) { noteCtl.edit(id); }
  function commitNote(n, textEl) { noteCtl.commit(n, textEl); }
  function removeNote(id, pushUndo = true) { noteCtl.remove(id, pushUndo); }

  function setHoveredRow(id) {
    const next = id || null;
    if (hoveredRowId === next) return;
    if (hoveredRowId) {
      const prevRow = els.rows.get(hoveredRowId);
      const prevBg = els.rowBgs.get(hoveredRowId);
      if (prevRow) prevRow.classList.remove('is-hovered');
      if (prevBg) prevBg.classList.remove('is-hovered');
    }
    hoveredRowId = next;
    if (hoveredRowId) {
      const nextRow = els.rows.get(hoveredRowId);
      const nextBg = els.rowBgs.get(hoveredRowId);
      if (nextRow) nextRow.classList.add('is-hovered');
      if (nextBg) nextBg.classList.add('is-hovered');
    }
  }

  function onItemHover(itemId, entering) {
    if (entering) {
      hoveredItemId = itemId;
      setHoveredRow(itemId);
    } else {
      if (hoveredItemId === itemId) hoveredItemId = null;
      if (hoveredRowId === itemId) setHoveredRow(null);
    }
    syncDepSpotlight();

    if (chartData.showNotes === true || noteCtl.editingId()) return;
    if (entering && noteForTarget(itemId)) {
      if (peekNoteItemId !== itemId) {
        peekNoteItemId = itemId;
        renderNotes();
      }
    } else if (!entering && peekNoteItemId === itemId && !selItems.has(itemId)) {
      peekNoteItemId = null;
      renderNotes();
    }
  }

  function syncZoomPills(zoomKey) {
    const host = zoomPills || document.getElementById('gantt-zoom-pills');
    if (!host) return;
    host.querySelectorAll('[data-zoom-set]').forEach((btn) => {
      const active = btn.dataset.zoomSet === zoomKey;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });
  }

  function syncWeekendsButton() {
    const btn = btnWeekends || document.getElementById('btn-weekends');
    if (!btn) return;
    const pref = showWeekendsPref();
    const supported = Boolean(GANTT_ZOOMS[currentZoom()] && GANTT_ZOOMS[currentZoom()].showWeekends);
    btn.setAttribute('aria-checked', String(pref));
    btn.classList.toggle('is-dimmed', !supported);
    btn.title = supported
      ? (pref ? 'Hide weekend shading' : 'Show weekend shading')
      : 'Weekends show in Day and Week views';
  }

  function parentItems() {
    return itemsList().filter((it) => it && (it._hasChildren || it.kind === 'group'));
  }

  function syncToggleAllButton() {
    const btn = btnToggleAll || document.getElementById('btn-toggle-all');
    if (!btn) return;
    const parents = parentItems();
    btn.disabled = parents.length === 0;
    const anyExpanded = parents.some((it) => !it.collapsed);
    const label = anyExpanded ? 'Collapse all' : 'Expand all';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(anyExpanded));
    btn.innerHTML = ui.icon(anyExpanded ? 'chevron-up' : 'chevron-down', { size: 'xs', bold: true });
  }

  // --- BIG-PLAN UX: VIEW FILTER, MORPH, STICKY PHASE, OFF-SCREEN PILLS & IN-VIEW HINT ---
  function syncViewFilterUi() {
    if (viewLabelEl) viewLabelEl.textContent = VIEW_LABELS[viewMode] || VIEW_LABELS.active;
    if (btnViewFilter) {
      btnViewFilter.classList.toggle('is-filtered', viewMode !== 'all' || Boolean(focusChainId));
    }
    if (viewPop) {
      viewPop.querySelectorAll('[data-view-mode]').forEach((opt) => {
        const active = opt.dataset.viewMode === viewMode;
        opt.setAttribute('aria-checked', String(active));
      });
    }
    if (root) root.dataset.view = viewMode;
  }

  function renderFilterBar(visItems) {
    if (!filterBarEl) return;
    const allLeaves = itemsList().filter((it) => it && !it._hasChildren && it.kind !== 'group');
    const visLeaves = visItems.filter((it) => it && !it._hasChildren && it.kind !== 'group');
    const hiddenCount = Math.max(0, allLeaves.length - visLeaves.length);

    let msg = '';
    if (focusChainId) {
      const seed = itemById(focusChainId);
      msg = `Chain: ${seed ? (seed.label || seed.id) : focusChainId} (${visLeaves.length})`;
    } else if (colorFilter) {
      const streamName = (chartData.colorKey && chartData.colorKey[colorFilter]) || `Stream ${colorFilter}`;
      msg = `${streamName} · ${visLeaves.length} of ${allLeaves.length}`;
    } else if (viewMode === 'in-view') {
      msg = `In View · ${visLeaves.length} of ${allLeaves.length} tasks`;
    } else if (viewMode === 'active' && hiddenCount > 0) {
      msg = `${hiddenCount} past ${hiddenCount === 1 ? 'task' : 'tasks'} hidden`;
    }

    if (!msg) {
      filterBarEl.hidden = true;
      filterBarEl.textContent = '';
      return;
    }

    filterBarEl.hidden = false;
    filterBarEl.textContent = '';
    const txt = htmlEl('span', 'gantt-filter-bar-text', msg);
    txt.title = msg;
    const resetBtn = htmlEl('button', 'gantt-filter-bar-reset', focusChainId ? 'Exit' : 'Show all');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (focusChainId) toggleFocusChain(null);
      else resetAllFilters();
    });
    filterBarEl.append(txt, resetBtn);
  }

  function renderEmptyFilterState(visItems) {
    if (!emptyFilterEl) return;
    const hasItems = itemsList().length > 0;
    const isEmpty = hasItems && visItems.length === 0;
    emptyFilterEl.hidden = !isEmpty;
    if (!isEmpty) {
      emptyFilterEl.textContent = '';
      return;
    }
    emptyFilterEl.textContent = '';
    const title = viewMode === 'in-view'
      ? 'No tasks in this date window'
      : colorFilter
        ? 'No matching tasks in this stream'
        : 'No active or upcoming tasks';
    emptyFilterEl.appendChild(htmlEl('div', 'gantt-empty-filter-title', title));
    const actions = htmlEl('div', 'gantt-empty-filter-actions');
    const btnAll = htmlEl('button', 'btn btn-primary', 'Show All Tasks');
    btnAll.type = 'button';
    btnAll.addEventListener('click', () => resetAllFilters());
    actions.appendChild(btnAll);
    if (viewMode === 'in-view') {
      const btnT = htmlEl('button', 'btn', 'Jump to Today');
      btnT.type = 'button';
      btnT.addEventListener('click', () => jumpToToday());
      actions.appendChild(btnT);
    }
    emptyFilterEl.appendChild(actions);
  }

  // Elements are reused across renders, so a FLIP still in flight on one would skew the box read after the render;
  // drop it first (a rebuilt element never had one). CSS transitions / animations are left alone.
  function settleMorph(el) {
    if (!el.getAnimations) return;
    el.getAnimations().forEach((a) => {
      if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return;
      if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return;
      a.cancel();
    });
  }

  function captureLayoutRects() {
    const bars = new Map();
    els.bars.forEach((el, id) => { bars.set(id, el.getBoundingClientRect()); });
    const rows = new Map();
    els.rows.forEach((el, id) => { rows.set(id, el.getBoundingClientRect()); });
    return { bars, rows };
  }

  function playLayoutMorph(oldRects) {
    if (!motion.enabled() || !oldRects) return;
    const dur = motion.dur('dur-base', 200);
    const easing = motion.curve('curve-out');
    const animateMap = (domMap, prevMap) => {
      if (!prevMap || !prevMap.size) return;
      domMap.forEach((el, id) => {
        const prev = prevMap.get(id);
        if (!prev) return;
        settleMorph(el);
        const next = el.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) < 0.5) return;
        motion.anim(el, [
          { transform: `translateY(${dy}px)` },
          { transform: 'none' }
        ], { duration: dur, easing });
      });
    };
    animateMap(els.bars, oldRects.bars);
    animateMap(els.rows, oldRects.rows);
  }

  function setViewMode(nextMode, opts = {}) {
    if (!Object.prototype.hasOwnProperty.call(VIEW_LABELS, nextMode)) return;
    const prevMode = viewMode;
    viewMode = nextMode;
    viewModeExplicit = true;
    if (nextMode === 'in-view') inViewHintDismissed = false;
    if (focusChainId) focusChainId = null;
    if (prevMode === nextMode && !opts.force) {
      syncViewFilterUi();
      return;
    }
    const oldRects = (opts.animate !== false && motion.enabled()) ? captureLayoutRects() : null;
    render();
    if (oldRects) playLayoutMorph(oldRects);
  }

  function toggleColorFilter(slot) {
    const next = colorFilter === slot ? null : slot;
    colorFilter = next;
    const oldRects = motion.enabled() ? captureLayoutRects() : null;
    render();
    if (oldRects) playLayoutMorph(oldRects);
  }

  function toggleFocusChain(itemId) {
    const next = (!itemId || focusChainId === itemId) ? null : itemId;
    focusChainId = next;
    const oldRects = motion.enabled() ? captureLayoutRects() : null;
    render();
    if (oldRects) playLayoutMorph(oldRects);
    if (next) {
      const it = itemById(next);
      if (it) ui.toast(`Focused dependency chain for ${it.label || it.id}`);
    }
  }

  function resetAllFilters() {
    focusChainId = null;
    colorFilter = null;
    viewMode = 'all';
    viewModeExplicit = true;
    const oldRects = motion.enabled() ? captureLayoutRects() : null;
    render();
    if (oldRects) playLayoutMorph(oldRects);
  }

  function scrollBarHorizontallyIntoView(it) {
    if (!timeline || !it || !it._bar) return;
    const targetLeft = Math.max(0, Math.round(it._bar.x + it._bar.w / 2 - timeline.clientWidth / 2));
    suppressExtendUntil = performance.now() + 700;
    timeline.scrollTo({
      left: targetLeft,
      behavior: motion.enabled() ? 'smooth' : 'auto'
    });
  }

  function updateStickyPhase() {
    if (!stickyPhaseEl || !timeline) return;
    const scrollTop = timeline.scrollTop || 0;
    const rowH = GANTT_METRICS.ROW_H;
    if (scrollTop < rowH * 0.5) {
      stickyPhaseEl.hidden = true;
      return;
    }
    const vis = visibleItems();
    if (!vis.length) {
      stickyPhaseEl.hidden = true;
      return;
    }
    const topIdx = Math.min(vis.length - 1, Math.max(0, Math.floor(scrollTop / rowH)));
    const topItem = vis[topIdx];
    if (!topItem || !topItem.parent) {
      stickyPhaseEl.hidden = true;
      return;
    }
    // Walk up ancestor chain to build breadcrumb and find highest scrolled-past phase
    const ancestors = [];
    let cur = itemById(topItem.parent);
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      if (!cur._hidden && typeof cur._row === 'number' && cur._row * rowH < scrollTop) {
        ancestors.unshift(cur);
      }
      cur = cur.parent ? itemById(cur.parent) : null;
    }
    if (!ancestors.length) {
      stickyPhaseEl.hidden = true;
      return;
    }
    const target = ancestors[ancestors.length - 1];
    const breadcrumb = ancestors.map((a) => a.label || a.id).join(' › ');
    const col = effectiveColor(target);
    let dot = stickyPhaseEl.querySelector('.gantt-sticky-phase-dot');
    let lbl = stickyPhaseEl.querySelector('.gantt-sticky-phase-label');
    if (!dot || !lbl) {
      stickyPhaseEl.textContent = '';
      dot = htmlEl('span', 'gantt-sticky-phase-dot');
      lbl = htmlEl('span', 'gantt-sticky-phase-label', breadcrumb);
      const cue = htmlEl('span', 'gantt-sticky-phase-cue', '↑');
      stickyPhaseEl.append(dot, lbl, cue);
    } else if (lbl.textContent !== breadcrumb) {
      lbl.textContent = breadcrumb;
    }
    stickyPhaseEl.dataset.targetId = target.id;
    dot.style.background = col ? `var(--sw-${col}-line, var(--primary))` : '';
    stickyPhaseEl.hidden = false;
  }

  function renderOffscreenPills() {
    if (!offscreenEl || !timeline || !chartData._range) return;
    offscreenEl.textContent = '';
    const viewW = timeline.clientWidth;
    if (!viewW) return;
    const headerH = headerEl ? headerEl.offsetHeight : 58;
    const viewH = Math.max(0, timeline.clientHeight - headerH);
    const scrollLeft = timeline.scrollLeft;
    const scrollTop = timeline.scrollTop;
    const rowH = GANTT_METRICS.ROW_H;
    const vis = visibleItems();
    const frag = document.createDocumentFragment();

    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      if (!it || !it._bar) continue;
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      if (isParent) continue;
      const rowTop = it._row * rowH;
      if (rowTop + rowH < scrollTop || rowTop > scrollTop + viewH) continue;
      const b = it._bar;
      const barLeft = b.x;
      const barRight = b.x + Math.max(4, b.w);
      const isLeft = barRight < scrollLeft + 4;
      const isRight = barLeft > scrollLeft + viewW - 4;
      if (!isLeft && !isRight) continue;

      const pill = htmlEl('button', `gantt-offscreen-pill ${isLeft ? 'is-left' : 'is-right'}`);
      pill.type = 'button';
      pill.dataset.itemId = it.id;
      const dateStr = formatShortDate(it._start);
      pill.title = `Jump to ${it.label || it.id} (${formatDateRange(it._start, it._end)})`;
      pill.setAttribute('aria-label', `Jump to ${it.label || it.id}`);
      pill.style.top = `${Math.round(rowTop + (rowH - 24) / 2)}px`;
      if (isLeft) {
        pill.style.left = `${Math.round(scrollLeft + 8)}px`;
      } else {
        pill.style.left = `${Math.round(scrollLeft + viewW - 8)}px`;
        pill.style.transform = 'translateX(-100%)';
      }
      const dot = htmlEl('span', 'gantt-offscreen-dot');
      const col = effectiveColor(it);
      dot.style.background = col ? `var(--sw-${col}-line, var(--primary))` : 'var(--primary)';
      const txt = htmlEl('span', '', isLeft ? `← ${dateStr}` : `${dateStr} →`);
      if (isLeft) pill.append(txt, dot);
      else pill.append(dot, txt);
      pill.addEventListener('pointerdown', (e) => e.stopPropagation());
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        selectSingleItem(it.id);
        scrollBarHorizontallyIntoView(it);
      });
      frag.appendChild(pill);
    }
    offscreenEl.appendChild(frag);
  }

  function updateInViewHint() {
    if (!inViewHintEl || !inViewHintTextEl) return;
    if (viewMode === 'in-view' || focusChainId || inViewHintDismissed || !timeline || !chartData._range) {
      inViewHintEl.hidden = true;
      return;
    }
    const win = getVisibleDateWindow();
    if (!win) {
      inViewHintEl.hidden = true;
      return;
    }
    const headerH = headerEl ? headerEl.offsetHeight : 58;
    const viewH = Math.max(0, timeline.clientHeight - headerH);
    const visTop = timeline.scrollTop;
    const visBot = visTop + viewH;
    const rowH = GANTT_METRICS.ROW_H;
    const vis = visibleItems();
    const allItems = itemsList();
    let inWindowCount = 0;
    let offVertCount = 0;
    const inViewKeep = new Set();

    for (let i = 0; i < allItems.length; i++) {
      const it = allItems[i];
      if (!it || it._hasChildren || it.kind === 'group') continue;
      if (!it._start || !it._end) continue;
      if (it._start <= win.end && it._end >= win.start) {
        addWithAncestors(it.id, inViewKeep);
      }
    }

    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      if (!it || !it._bar || it._hasChildren || it.kind === 'group') continue;
      if (!it._start || !it._end) continue;
      if (it._start <= win.end && it._end >= win.start) {
        inWindowCount++;
        const rowTop = it._row * rowH;
        if (rowTop + rowH <= visTop + 4 || rowTop >= visBot - 4) {
          offVertCount++;
        }
      }
    }

    if (offVertCount >= 1 && inWindowCount >= 2 && inViewKeep.size < vis.length - 1) {
      inViewHintTextEl.textContent = `${offVertCount} ${offVertCount === 1 ? 'task' : 'tasks'} in this timeframe ${offVertCount === 1 ? 'is' : 'are'} off-screen`;
      inViewHintEl.hidden = false;
    } else {
      inViewHintEl.hidden = true;
    }
  }

  function scheduleScrollOverlays() {
    if (scrollOverlaysRaf) return;
    scrollOverlaysRaf = requestAnimationFrame(() => {
      scrollOverlaysRaf = 0;
      updateStickyPhase();
      renderOffscreenPills();
      updateInViewHint();
    });
  }

  function scheduleInViewRefresh() {
    if (viewMode !== 'in-view' || focusChainId || activeDrag) return;
    clearTimeout(inViewDebounceTimer);
    inViewDebounceTimer = setTimeout(() => {
      inViewDebounceTimer = null;
      if (viewMode !== 'in-view' || focusChainId || activeDrag) return;
      const win = getVisibleDateWindow();
      if (!win) return;
      const key = `${win.start}|${win.end}`;
      if (key === lastInViewWindowKey) return;
      const oldRects = motion.enabled() ? captureLayoutRects() : null;
      render();
      if (oldRects) playLayoutMorph(oldRects);
    }, 220);
  }

  function syncDisplayModeUi() {
    if (root) root.dataset.mode = displayMode;
    document.body.dataset.ganttMode = displayMode;
    if (tableViewEl) tableViewEl.hidden = displayMode !== 'table';
    if (modeSwitchEl) {
      modeSwitchEl.querySelectorAll('[data-gantt-mode]').forEach((btn) => {
        const active = btn.dataset.ganttMode === displayMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  function setDisplayMode(nextMode) {
    const mode = nextMode === 'table' ? 'table' : 'timeline';
    if (mode === displayMode) return;
    removeActionBar();
    if (window.GanttDatePicker) window.GanttDatePicker.close();
    displayMode = mode;
    syncDisplayModeUi();
    render();
  }

  // --- MAIN RENDER ---
  function render() {
    applyLayout();
    syncDisplayModeUi();
    if (displayMode === 'table') {
      if (tableCtrl && typeof tableCtrl.render === 'function') tableCtrl.render();
      renderHolidaysList();
      if (typeof showZoom === 'function') showZoom();
      return;
    }
    const range = chartData._range;
    const zoomKey = currentZoom();
    if (root) root.dataset.zoom = zoomKey;
    const visItems = visibleItems();
    const todayStr = getTodayStr();
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    const fullW = Math.max(range.timelineWidth, (timeline && timeline.clientWidth) || 0);

    applySidebarWidth(sidebarWidth);

    if (bodyEl) {
      bodyEl.style.width = `${fullW}px`;
      bodyEl.style.height = `${totalH}px`;
    }
    if (barsEl) {
      barsEl.style.width = `${fullW}px`;
      barsEl.style.height = `${totalH}px`;
    }
    if (markersEl) {
      markersEl.style.width = `${fullW}px`;
      markersEl.style.height = `${totalH}px`;
    }
    if (todayEl) {
      todayEl.style.width = `${fullW}px`;
      todayEl.style.height = `${totalH}px`;
    }
    if (notesEl) {
      notesEl.style.width = `${fullW}px`;
      notesEl.style.height = `${totalH}px`;
    }

    const gridLines = renderHeader(range, zoomKey, fullW);
    renderGrid(range, zoomKey, visItems, gridLines, fullW);
    renderSidebar(visItems);
    renderBars(visItems, todayStr);
    renderMarkers(visItems);
    renderToday(range, visItems, todayStr);
    renderDependencies(range, visItems);
    renderNotes();
    renderColorKey();
    updateNotesButton();
    syncWeekendsButton();
    syncToggleAllButton();
    syncViewFilterUi();
    renderFilterBar(visItems);
    renderEmptyFilterState(visItems);
    renderHolidaysList();
    syncSelectionUi();
    syncZoomPills(zoomKey);
    if (typeof showZoom === 'function') showZoom();

    if (!didInitialScroll && timeline && range) {
      didInitialScroll = true;
      let targetLeft = 0;
      if (viewMode === 'active' && todayStr >= range.start && todayStr <= range.end) {
        const todayX = (ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay;
        targetLeft = Math.max(0, Math.round(todayX - timeline.clientWidth * 0.35));
      } else {
        let earliestVis = null;
        for (let i = 0; i < visItems.length; i++) {
          const s = visItems[i]._start;
          if (s && (!earliestVis || s < earliestVis)) earliestVis = s;
        }
        const anchorDate = earliestVis || range.contentStart || range.start;
        const anchorX = ganttDiffDays(range.start, anchorDate) * range.pxPerDay;
        targetLeft = Math.max(0, Math.round(anchorX - 48));
      }
      isExtendingTimeline = true;
      timeline.scrollLeft = targetLeft;
      requestAnimationFrame(() => {
        isExtendingTimeline = false;
        if (viewMode === 'in-view') render();
        else scheduleScrollOverlays();
      });
    } else {
      scheduleScrollOverlays();
    }
  }

  // Drag frame: re-runs the (pure, linear) layout, then writes only the bars, markers and arrows whose geometry changed
  // (the moved bars, their parents' summary bars and the arrows touching them). A full render follows on drop.
  function updateLiveGeometry() {
    applyLayout(true);
    const range = chartData._range;
    const visItems = visibleItems();
    const todayStr = getTodayStr();
    visItems.forEach((it) => {
      const el = els.bars.get(it.id);
      if (el && it._bar) patchBarGeometry(el, it, todayStr);
    });
    (chartData._markers || []).forEach((m) => {
      const rec = els.markers.get(m.id);
      if (rec) patchMarker(rec, m);
    });
    renderDependencies(range, visItems, true);
  }

  // --- DRAG TOOLTIP ---
  function showDragTip(clientX, clientY, text) {
    if (!dragTipEl) return;
    dragTipEl.textContent = text;
    dragTipEl.hidden = false;
    dragTipEl.style.left = `${clientX + 14}px`;
    dragTipEl.style.top = `${clientY - 28}px`;
  }

  function hideDragTip() {
    if (!dragTipEl) return;
    dragTipEl.hidden = true;
  }

  // --- SELECTION & ACTION BAR ---
  function clearSelection() {
    selItems.clear();
    lastSelItemId = null;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (chartData.showNotes !== true) peekNoteItemId = null;
    closeFloatingPop();
    syncSelectionUi();
    renderNotes();
  }

  function hasSelection() {
    return !presenting() && (selItems.size > 0 || !!selMarkerId || !!selDepKey || !!selNoteId);
  }

  function selectSingleItem(id) {
    selItems.clear();
    selItems.add(id);
    lastSelItemId = id;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (chartData.showNotes !== true && noteForTarget(id)) peekNoteItemId = id;
    syncSelectionUi();
    renderNotes();
  }

  function toggleItemSelection(id) {
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (selItems.has(id)) selItems.delete(id);
    else selItems.add(id);
    lastSelItemId = id;
    syncSelectionUi();
  }

  function selectItemRange(toId) {
    const vis = visibleItems();
    const toIdx = vis.findIndex((it) => it.id === toId);
    if (toIdx < 0) return;
    const fromIdx = lastSelItemId ? vis.findIndex((it) => it.id === lastSelItemId) : toIdx;
    const lo = Math.min(fromIdx < 0 ? toIdx : fromIdx, toIdx);
    const hi = Math.max(fromIdx < 0 ? toIdx : fromIdx, toIdx);
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    selItems.clear();
    for (let i = lo; i <= hi; i++) selItems.add(vis[i].id);
    syncSelectionUi();
  }

  function selectMarker(id) {
    selItems.clear();
    selDepKey = null;
    selNoteId = null;
    selMarkerId = id;
    syncSelectionUi();
  }

  function selectDependency(key) {
    selItems.clear();
    selMarkerId = null;
    selNoteId = null;
    selDepKey = key;
    syncSelectionUi();
  }

  function selectAll() {
    if (presenting()) return;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    selItems.clear();
    visibleItems().forEach((it) => selItems.add(it.id));
    syncSelectionUi();
  }

  function syncSelectionUi() {
    els.rows.forEach((row, id) => row.classList.toggle('selected', selItems.has(id)));
    els.bars.forEach((bar, id) => {
      bar.classList.toggle('selected', selItems.has(id));
      bar.classList.toggle('multi-selected', selItems.size > 1 && selItems.has(id));
    });
    els.rowBgs.forEach((bg, id) => bg.classList.toggle('is-selected', selItems.has(id)));
    els.markers.forEach((rec, id) => {
      const on = selMarkerId === id;
      rec.line.classList.toggle('selected', on);
      rec.flag.classList.toggle('selected', on);
    });
    const violatedByKey = new Map();
    (chartData._deps || []).forEach((d) => { if (d && !violatedByKey.has(depKeyOf(d))) violatedByKey.set(depKeyOf(d), d); });
    els.deps.forEach((rec, key) => {
      const on = selDepKey === key;
      rec.sel = on;
      rec.g.classList.toggle('selected', on);
      rec.path.classList.toggle('selected', on);
      const dep = violatedByKey.get(key);
      const url = on ? 'url(#gantt-arr-sel)' : (dep && dep.violated) ? 'url(#gantt-arr-warn)' : 'url(#gantt-arr)';
      rec.path.setAttribute('marker-end', url);
    });
    syncDepSpotlight();
    els.notes.forEach((card, id) => card.classList.toggle('selected', selNoteId === id));
    renderActionBar();
    if (typeof updateDeleteButton === 'function') updateDeleteButton();
  }

  function closeFloatingPop(restoreFocus = false) {
    const prev = floatingPopPrevFocus;
    floatingPopPrevFocus = null;
    if (floatingPop) {
      floatingPop.remove();
      floatingPop = null;
    }
    if (restoreFocus && prev && typeof prev.focus === 'function' && prev.isConnected) {
      try { prev.focus({ preventScroll: true }); } catch (_) { prev.focus(); }
    }
  }

  function removeActionBar() {
    closeFloatingPop();
    if (actionBarEl) {
      actionBarEl.remove();
      actionBarEl = null;
    }
  }

  function positionActionBar(anchorEl) {
    if (!actionBarEl || !anchorEl) return;
    const ar = anchorEl.getBoundingClientRect();
    const br = actionBarEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = ar.left + ar.width / 2 - br.width / 2;
    left = Math.max(12, Math.min(vw - br.width - 12, left));
    let top = ar.top - br.height - 10;
    if (top < 56) top = Math.min(vh - br.height - 70, ar.bottom + 10);
    actionBarEl.style.position = 'fixed';
    actionBarEl.style.left = `${Math.round(left)}px`;
    actionBarEl.style.top = `${Math.round(top)}px`;
    actionBarEl.style.zIndex = '60';
  }

  function openMiniPop(anchor, buildFn, opts) {
    closeFloatingPop();
    floatingPopPrevFocus = document.activeElement;
    const pop = htmlEl('div', 'gantt-mini-pop');
    pop.setAttribute('role', 'dialog');
    if (opts && opts.ariaLabel) pop.setAttribute('aria-label', opts.ariaLabel);
    pop.setAttribute('data-export-skip', '');
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    buildFn(pop);
    document.body.appendChild(pop);
    floatingPop = pop;
    const ar = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - pr.width - 12, ar.left));
    let top = ar.bottom + 8;
    if (top + pr.height > window.innerHeight - 12) top = Math.max(12, ar.top - pr.height - 8);
    pop.style.position = 'fixed';
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.zIndex = '70';
  }

  function renderActionBar() {
    removeActionBar();
    if (presenting() || activeDrag) return;

    let anchor = null;
    const bar = ui.actionBar('actionbar gantt-actionbar', 'Selection actions');
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    const pickColor = (current, onPick) => swatchPicker(current || '', onPick, { triggerClass: 'ab-btn', btnClass: 'ab-swatch', act: 'color' });

    if (selMarkerId) {
      const m = markerById(selMarkerId);
      const rec = els.markers.get(selMarkerId);
      if (!m || !rec) return;
      anchor = rec.flag;

      const btnDate = ui.abButton('ab-btn', 'date', ui.icon('calendar', { size: 'sm' }), `Date: ${m.date}`);
      btnDate.addEventListener('click', () => openMarkerDatePop(btnDate, m));

      const swatches = pickColor(m.color, (slot) => {
        if (slot) m.color = slot; else delete m.color;
        render();
        updateStatus(true);
      });

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete marker');
      btnDel.addEventListener('click', () => deleteSelection());

      bar.append(btnDate, ui.abSep('ab-sep'), swatches, ui.abSep('ab-sep'), btnDel);
    } else if (selDepKey) {
      const dep = depsList().find((d) => depKeyOf(d) === selDepKey);
      const rec = els.deps.get(selDepKey);
      if (!dep || !rec) return;
      anchor = rec.path;

      const curType = dep.type === 'ss' ? 'ss' : 'fs';
      const typeLabel = curType === 'fs' ? 'After finish (FS)' : 'Same start (SS)';
      const nextLabel = curType === 'fs' ? 'Same start (SS)' : 'After finish (FS)';
      const btnType = ui.abButton('ab-btn', 'toggle-type', typeLabel, `Switch to ${nextLabel}`);
      btnType.addEventListener('click', () => {
        dep.type = curType === 'fs' ? 'ss' : 'fs';
        selDepKey = depKeyOf(dep);
        render();
        updateStatus(true);
      });

      const btnRev = ui.abButton('ab-btn', 'reverse', ui.icon('reverse', { size: 'sm' }), 'Reverse dependency');
      btnRev.addEventListener('click', () => {
        if (wouldCreateDepCycle(dep.to, dep.from, dep)) {
          ui.toast('Cannot reverse: would create a dependency cycle');
          return;
        }
        const tmp = dep.from;
        dep.from = dep.to;
        dep.to = tmp;
        selDepKey = depKeyOf(dep);
        render();
        updateStatus(true);
      });

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete dependency');
      btnDel.addEventListener('click', () => deleteSelection());

      bar.append(btnType, btnRev, ui.abSep('ab-sep'), btnDel);
    } else if (selItems.size === 1) {
      const id = [...selItems][0];
      const it = itemById(id);
      if (!it) return;
      anchor = els.bars.get(id) || els.rows.get(id);
      if (!anchor) return;
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      const isMilestone = it.kind === 'milestone' && !it._hasChildren;

      if (!isParent) {
        const btnDates = ui.abButton('ab-btn', 'dates', ui.icon('calendar', { size: 'sm' }), isMilestone ? 'Set date' : 'Set dates');
        btnDates.addEventListener('click', () => openItemDatesPop(btnDates, it, isMilestone));
        bar.append(btnDates, ui.abSep('ab-sep'));
      }

      const swatches = pickColor(effectiveColor(it), (slot) => {
        if (slot) it.color = slot; else delete it.color;
        render();
        updateStatus(true);
      });
      bar.append(swatches, ui.abSep('ab-sep'));

      if (!isMilestone) {
        const btnSub = ui.abButton('ab-btn', 'subtask', ui.icon('plus', { size: 'sm' }), 'Add subtask');
        btnSub.addEventListener('click', () => addSubtask(id));
        bar.append(btnSub);
      }

      const btnConn = ui.abButton('ab-btn', 'connect', ui.icon('link', { size: 'sm' }), 'Connect dependency');
      btnConn.addEventListener('click', () => startClickConnect(id));
      bar.append(btnConn);

      const hasDeps = depsList().some((d) => d && (d.from === id || d.to === id));
      if (hasDeps || focusChainId === id) {
        const isFocused = focusChainId === id;
        const btnFocus = ui.abButton(
          `ab-btn${isFocused ? ' is-active' : ''}`,
          'focus-chain',
          ui.icon('focus', { size: 'sm' }),
          isFocused ? 'Exit focus chain' : 'Focus dependency chain'
        );
        btnFocus.addEventListener('click', () => toggleFocusChain(id));
        bar.append(btnFocus);
      }

      const btnNote = ui.abButton('ab-btn', 'note', ui.icon('note', { size: 'sm' }), noteForTarget(id) ? 'Edit note' : 'Add note');
      btnNote.addEventListener('click', () => addOrEditNoteForTarget(id));
      bar.append(btnNote, ui.abSep('ab-sep'));

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete');
      btnDel.addEventListener('click', () => deleteSelection(btnDel));
      bar.append(btnDel);
    } else if (selItems.size > 1) {
      const ids = [...selItems];
      anchor = els.bars.get(ids[0]) || els.rows.get(ids[0]);
      if (!anchor) return;

      const countLbl = htmlEl('span', 'gantt-ab-count', `${ids.length} selected`);
      bar.append(countLbl, ui.abSep('ab-sep'));

      const firstColor = (itemById(ids[0]) || {}).color || '';
      const sameColor = ids.every((id) => ((itemById(id) || {}).color || '') === firstColor) ? firstColor : '';
      const swatches = pickColor(sameColor, (slot) => {
        ids.forEach((id) => {
          const it = itemById(id);
          if (!it) return;
          if (slot) it.color = slot; else delete it.color;
        });
        render();
        updateStatus(true);
      });
      bar.append(swatches, ui.abSep('ab-sep'));

      const btnShift = ui.abButton('ab-btn', 'shift', ui.icon('calendar', { size: 'sm' }), 'Shift dates (± days)');
      btnShift.addEventListener('click', () => openShiftDatesPop(btnShift, ids));
      bar.append(btnShift, ui.abSep('ab-sep'));

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete selected');
      btnDel.addEventListener('click', () => deleteSelection(btnDel));
      bar.append(btnDel);
    } else {
      return;
    }

    document.body.appendChild(bar);
    actionBarEl = bar;
    positionActionBar(anchor);
  }

  // --- POPOVERS FOR ACTION BAR ---
  function openItemDatesPop(anchor, it, isMilestone) {
    openMiniPop(anchor, (pop) => {
      const row1 = htmlEl('label', 'gantt-pop-field');
      row1.append(htmlEl('span', 'gantt-pop-lbl', isMilestone ? 'Date' : 'Start'));
      const inStart = htmlEl('input', 'gantt-pop-input');
      inStart.type = 'date';
      inStart.value = it.start || it._start || getTodayStr();
      row1.append(inStart);
      pop.append(row1);

      let inEnd = null;
      if (!isMilestone) {
        const row2 = htmlEl('label', 'gantt-pop-field');
        row2.append(htmlEl('span', 'gantt-pop-lbl', 'End'));
        inEnd = htmlEl('input', 'gantt-pop-input');
        inEnd.type = 'date';
        inEnd.value = it.end || it._end || inStart.value;
        row2.append(inEnd);
        pop.append(row2);
      }

      if (window.GanttDatePicker && typeof window.GanttDatePicker.attachInput === 'function') {
        window.GanttDatePicker.attachInput(inStart, {
          onChange: (val) => {
            if (inEnd && val && inEnd.value && inEnd.value < val) inEnd.value = val;
          }
        });
        if (inEnd) {
          window.GanttDatePicker.attachInput(inEnd, {
            min: () => ganttFormatDate(inStart.value) || ''
          });
        }
      }

      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Apply');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        const s = ganttFormatDate(inStart.value);
        if (!s) { ui.toast('Invalid start date'); return; }
        if (isMilestone) {
          it.start = s;
          it.end = s;
        } else {
          const e = ganttFormatDate(inEnd.value);
          if (!e) { ui.toast('Invalid end date'); return; }
          it.start = s;
          it.end = e < s ? s : e;
        }
        closeFloatingPop();
        render();
        updateStatus(true);
      });
      pop.append(apply);
      inStart.focus();
    }, { ariaLabel: isMilestone ? 'Edit milestone date' : 'Edit task dates' });
  }

  function openShiftDatesPop(anchor, ids) {
    openMiniPop(anchor, (pop) => {
      const row = htmlEl('label', 'gantt-pop-field');
      row.append(htmlEl('span', 'gantt-pop-lbl', 'Shift days'));
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'number';
      input.value = '7';
      input.step = '1';
      row.append(input);

      const btns = htmlEl('div', 'gantt-pop-actions');
      const back = htmlEl('button', 'btn', '← Earlier');
      back.type = 'button';
      const fwd = htmlEl('button', 'btn', 'Later →');
      fwd.type = 'button';
      const doShift = (sign) => {
        const n = Math.abs(Math.trunc(Number(input.value) || 0)) * sign;
        if (!n) return;
        const leaves = collectMovableLeaves(ids);
        leaves.forEach((it) => {
          const s = it.start || it._start;
          const e = it.end || it._end || s;
          it.start = ganttAddDays(s, n);
          it.end = it.kind === 'milestone' ? it.start : ganttAddDays(e, n);
        });
        closeFloatingPop();
        render();
        updateStatus(true);
      };
      back.addEventListener('click', () => doShift(-1));
      fwd.addEventListener('click', () => doShift(1));
      btns.append(back, fwd);
      pop.append(row, btns);
      input.focus();
      input.select();
    }, { ariaLabel: 'Shift dates' });
  }

  function openMarkerRenamePop(anchor, m) {
    openMiniPop(anchor, (pop) => {
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'text';
      input.maxLength = LABEL_MAX;
      input.value = m.label || '';
      input.setAttribute('aria-label', 'Date line name');
      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Save');
      apply.type = 'button';
      const save = () => {
        m.label = cleanLabel(input.value, 'Milestone');
        closeFloatingPop();
        render();
        updateStatus(true);
      };
      apply.addEventListener('click', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFloatingPop(true); }
      });
      pop.append(input, apply);
      input.focus();
      input.select();
    }, { ariaLabel: 'Rename date line' });
  }

  function openMarkerDatePop(anchor, m) {
    openMiniPop(anchor, (pop) => {
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'date';
      input.value = m.date || getTodayStr();
      input.setAttribute('aria-label', 'Date line date');
      if (window.GanttDatePicker && typeof window.GanttDatePicker.attachInput === 'function') {
        window.GanttDatePicker.attachInput(input);
      }
      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Save');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        const d = ganttFormatDate(input.value);
        if (!d) { ui.toast('Invalid date'); return; }
        m.date = d;
        closeFloatingPop();
        render();
        updateStatus(true);
      });
      pop.append(input, apply);
      input.focus();
    }, { ariaLabel: 'Edit date line date' });
  }

  // --- INLINE RENAME ---
  function startInlineRename(itemId, labelEl) {
    const it = itemById(itemId);
    if (!it || presenting()) return;
    const target = labelEl || (els.rows.get(itemId) && els.rows.get(itemId).querySelector('.gantt-tree-label'));
    if (!target) return;
    const orig = it.label || it.id;
    target.contentEditable = 'true';
    target.classList.add('is-editing');
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let done = false;
    const finish = (cancel) => {
      if (done) return;
      done = true;
      target.removeEventListener('keydown', onKey);
      target.contentEditable = 'false';
      target.classList.remove('is-editing');
      const next = cancel ? orig : cleanLabel(target.textContent, orig);
      target.textContent = next;
      if (next !== orig) {
        it.label = next;
        render();
        updateStatus(true);
      }
    };
    // The label element is reused across renders, so this edit's key handler goes with it
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); target.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
    };
    target.addEventListener('blur', () => finish(false), { once: true });
    target.addEventListener('keydown', onKey);
  }

  // --- COLLAPSE / EXPAND ---
  function toggleCollapse(itemId) {
    const it = itemById(itemId);
    if (!it) return;
    if (it.collapsed) delete it.collapsed;
    else it.collapsed = true;
    render();
    if (!presenting()) updateStatus(true);
  }

  function toggleCollapseAll() {
    const parents = parentItems();
    if (!parents.length) return;
    const anyExpanded = parents.some((it) => !it.collapsed);
    parents.forEach((it) => {
      if (anyExpanded) it.collapsed = true;
      else delete it.collapsed;
    });
    render();
    if (!presenting()) updateStatus(true);
  }

  // --- ADD / DELETE ---
  function defaultNewDates(parentId) {
    const todayStr = getTodayStr();
    const p = parentId ? itemById(parentId) : null;
    if (p && p._start) {
      const s = (viewMode === 'active' && p._start < todayStr) ? todayStr : p._start;
      return { start: s, end: ganttAddDays(s, 13) };
    }
    const selId = selItems.size ? [...selItems][0] : null;
    const selIt = selId ? itemById(selId) : null;
    if (selIt && selIt._end) {
      let s = ganttAddDays(selIt._end, 1);
      if (viewMode === 'active' && s < todayStr) s = todayStr;
      return { start: s, end: ganttAddDays(s, 13) };
    }
    if (viewMode === 'in-view') {
      const win = getVisibleDateWindow();
      if (win && win.start) {
        const s = (todayStr >= win.start && todayStr <= win.end) ? todayStr : ganttAddDays(win.start, 3);
        return { start: s, end: ganttAddDays(s, 13) };
      }
    }
    let base = (chartData._range && (chartData._range.contentStart || chartData._range.start))
      ? ganttAddDays(chartData._range.contentStart || chartData._range.start, 7)
      : todayStr;
    if (viewMode === 'active' && base < todayStr) base = todayStr;
    return { start: base, end: ganttAddDays(base, 13) };
  }

  function addTask(parentId, opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.items)) chartData.items = [];
    const o = opts || {};
    const def = defaultNewDates(parentId);
    const start = o.start || def.start;
    const end = o.end || (o.start ? ganttAddDays(o.start, 13) : def.end);
    const it = { id: newId('t'), kind: 'task', label: 'New task', start, end };
    if (colorFilter && !parentId) it.color = colorFilter;
    if (parentId) {
      const p = itemById(parentId);
      if (p) {
        it.parent = p.id;
        if (p.kind === 'task') p.kind = 'group';
        if (p.collapsed) delete p.collapsed;
      }
    }
    chartData.items.push(it);
    selectSingleItem(it.id);
    render();
    updateStatus(true);
    if (displayMode === 'table' && tableCtrl) {
      tableCtrl.focusItem(it.id);
    } else {
      const row = els.rows.get(it.id);
      if (row) startInlineRename(it.id, row.querySelector('.gantt-tree-label'));
    }
  }

  function addSubtask(parentId, opts) {
    const pid = parentId || (selItems.size === 1 ? [...selItems][0] : null);
    const p = pid ? itemById(pid) : null;
    if (p && p.kind === 'milestone') {
      ui.toast('Milestones cannot have subtasks');
      return;
    }
    addTask(p ? p.id : null, opts);
  }

  function addMilestone(opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.items)) chartData.items = [];
    const o = opts || {};
    const pid = o.parentId !== undefined ? o.parentId : (selItems.size === 1 ? [...selItems][0] : null);
    const p = pid ? itemById(pid) : null;
    const d = o.date || ((p && p._end) ? p._end : defaultNewDates(null).start);
    const it = { id: newId('t'), kind: 'milestone', label: 'Milestone', start: d, end: d };
    if (p && p.kind !== 'milestone') {
      it.parent = p.id;
      if (p.collapsed) delete p.collapsed;
    }
    chartData.items.push(it);
    selectSingleItem(it.id);
    render();
    updateStatus(true);
    if (displayMode === 'table' && tableCtrl) {
      tableCtrl.focusItem(it.id);
    } else {
      const row = els.rows.get(it.id);
      if (row) startInlineRename(it.id, row.querySelector('.gantt-tree-label'));
    }
  }

  function addVerticalMarker(opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.markers)) chartData.markers = [];
    const o = opts || {};
    const range = chartData._range;
    const midDate = o.date || (range
      ? ganttAddDays(range.contentStart || range.start, Math.floor(Math.min(range.totalDays, 60) / 2))
      : getTodayStr());
    const m = { id: newId('m'), label: 'Milestone', date: midDate, color: '4' };
    chartData.markers.push(m);
    selectMarker(m.id);
    render();
    updateStatus(true);
  }

  function deleteSelection() {
    if (presenting()) return;
    if (selNoteId) {
      removeNote(selNoteId, true);
      return;
    }
    if (selMarkerId) {
      chartData.markers = markersList().filter((m) => m && m.id !== selMarkerId);
      if (!chartData.markers.length) delete chartData.markers;
      selMarkerId = null;
      render();
      updateStatus(true);
      return;
    }
    if (selDepKey) {
      chartData.dependencies = depsList().filter((d) => depKeyOf(d) !== selDepKey);
      selDepKey = null;
      render();
      updateStatus(true);
      return;
    }
    if (!selItems.size) return;

    const toRemove = new Set(selItems);
    selItems.forEach((id) => {
      getDescendants(id).forEach((ch) => toRemove.add(ch.id));
    });
    chartData.items = itemsList().filter((it) => it && !toRemove.has(it.id));
    chartData.dependencies = depsList().filter((d) => d && !toRemove.has(d.from) && !toRemove.has(d.to));
    if (Array.isArray(chartData.notes)) {
      chartData.notes = chartData.notes.filter((n) => n && !toRemove.has(n.target));
      if (!chartData.notes.length) delete chartData.notes;
    }
    selItems.clear();
    lastSelItemId = null;
    render();
    updateStatus(true);
  }

  // --- POINTER INTERACTIONS: BAR DRAG, RESIZE, MULTI-SELECT MOVE ---
  function onBarPointerDown(e, it) {
    if (e.button !== 0) return;
    e.stopPropagation();

    // If we are in click-to-connect mode, finish connection
    if (connectState && !connectState.pointerDrag) {
      finishConnection(connectState.fromId, it.id, connectState.type);
      connectState = null;
      if (root) root.classList.remove('is-connecting');
      return;
    }

    if (e.shiftKey) {
      selectItemRange(it.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(it.id);
      return;
    }
    if (!selItems.has(it.id)) {
      selectSingleItem(it.id);
    }

    if (presenting()) return;

    const leaves = collectMovableLeaves(selItems.has(it.id) ? [...selItems] : [it.id]);
    if (!leaves.length) return;

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origDates = leaves.map((leaf) => ({
      item: leaf,
      start: leaf.start || leaf._start,
      end: leaf.end || leaf._end || leaf.start || leaf._start
    }));

    activeDrag = {
      kind: 'move',
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origDates,
      primary: it,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'move') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 4) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
        if (root) root.classList.add('is-dragging');
      }
      const rawDays = dx / activeDrag.pxPerDay;
      const snapped = Math.round(rawDays / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        if (activeDrag.tipText) showDragTip(ev.clientX, ev.clientY, activeDrag.tipText);
        return;
      }
      activeDrag.lastDelta = snapped;
      activeDrag.origDates.forEach(({ item, start, end }) => {
        item.start = ganttAddDays(start, snapped);
        item.end = item.kind === 'milestone' ? item.start : ganttAddDays(end, snapped);
      });
      updateLiveGeometry();
      const tip = activeDrag.origDates.length > 1
        ? `${activeDrag.origDates.length} tasks · ${snapped >= 0 ? '+' : ''}${snapped}d`
        : formatDateRange(activeDrag.primary._start, activeDrag.primary._end);
      activeDrag.tipText = tip;
      showDragTip(ev.clientX, ev.clientY, tip);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (root) root.classList.remove('is-dragging');
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onResizePointerDown(e, it, edge) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    selectSingleItem(it.id);

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origStart = it.start || it._start;
    const origEnd = it.end || it._end || origStart;

    activeDrag = {
      kind: 'resize',
      edge,
      item: it,
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origStart,
      origEnd,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'resize') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 3) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
        if (root) root.classList.add('is-dragging');
      }
      const rawDays = dx / activeDrag.pxPerDay;
      const snapped = Math.round(rawDays / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        if (activeDrag.tipText) showDragTip(ev.clientX, ev.clientY, activeDrag.tipText);
        return;
      }
      activeDrag.lastDelta = snapped;
      if (edge === 'start') {
        const nextStart = ganttAddDays(origStart, snapped);
        it.start = nextStart > origEnd ? origEnd : nextStart;
      } else {
        const nextEnd = ganttAddDays(origEnd, snapped);
        it.end = nextEnd < origStart ? origStart : nextEnd;
      }
      updateLiveGeometry();
      const tip = formatDateRange(it._start, it._end);
      activeDrag.tipText = tip;
      showDragTip(ev.clientX, ev.clientY, tip);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (root) root.classList.remove('is-dragging');
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- VERTICAL MARKER DRAG ---
  function onMarkerPointerDown(e, markerId) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    selectMarker(markerId);
    const m = markerById(markerId);
    if (!m) return;

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origDate = m.date;

    activeDrag = {
      kind: 'marker',
      marker: m,
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origDate,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'marker') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 3) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
      }
      const snapped = Math.round((dx / activeDrag.pxPerDay) / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        showDragTip(ev.clientX, ev.clientY, `${m.label || 'Marker'} · ${formatShortDate(m.date)}`);
        return;
      }
      activeDrag.lastDelta = snapped;
      m.date = ganttAddDays(origDate, snapped);
      updateLiveGeometry();
      showDragTip(ev.clientX, ev.clientY, `${m.label || 'Marker'} · ${formatShortDate(m.date)}`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- DEPENDENCY CONNECTION (DRAG FROM PORT OR CLICK CONNECT) ---
  function startClickConnect(fromId) {
    connectState = { fromId, type: 'fs', pointerDrag: false };
    removeActionBar();
    if (root) root.classList.add('is-connecting');
    ui.toast('Click a target task or milestone to connect (Esc to cancel)');
  }

  function finishConnection(fromId, toId, type) {
    if (!fromId || !toId) return;
    if (fromId === toId) {
      ui.toast('Cannot connect an item to itself');
      return;
    }
    const depType = type === 'ss' ? 'ss' : 'fs';
    if (depsList().some((d) => d && d.from === fromId && d.to === toId && (d.type === 'ss' ? 'ss' : 'fs') === depType)) {
      ui.toast('That dependency already exists');
      return;
    }
    if (wouldCreateDepCycle(fromId, toId)) {
      ui.toast('Cannot connect: would create a dependency cycle');
      return;
    }
    if (!Array.isArray(chartData.dependencies)) chartData.dependencies = [];
    chartData.dependencies.push({ from: fromId, to: toId, type: depType });
    render();
    updateStatus(true);
  }

  function onPortPointerDown(e, fromId, depType) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    const svg = ensureDepsSvg();
    const fromIt = itemById(fromId);
    if (!svg || !fromIt || !fromIt._bar) return;

    removeActionBar();
    connectState = { fromId, type: depType, pointerDrag: true };
    const fb = fromIt._bar;
    const sx = depType === 'ss' ? fb.x : fb.x + fb.w;
    const sy = fb.y + fb.h / 2;
    const modeLabel = depType === 'ss' ? 'Same start' : 'After finish';
    let hoveredTargetEl = null;

    const clearDepTarget = () => {
      if (hoveredTargetEl) {
        hoveredTargetEl.classList.remove('is-dep-target');
        hoveredTargetEl = null;
      }
    };

    const preview = svgEl('path', {
      class: 'gantt-dep-preview',
      fill: 'none',
      d: `M ${sx} ${sy} L ${sx} ${sy}`
    });
    svg.appendChild(preview);
    showDragTip(e.clientX, e.clientY, modeLabel);

    const onMove = (ev) => {
      const bodyRect = bodyEl.getBoundingClientRect();
      const tx = ev.clientX - bodyRect.left;
      const ty = ev.clientY - bodyRect.top;
      const mx = Math.round((sx + tx) / 2);
      preview.setAttribute('d', `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`);

      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetEl = hitEl && hitEl.closest('.gantt-bar, .gantt-milestone');
      if (targetEl && targetEl.dataset.itemId && targetEl.dataset.itemId !== fromId) {
        if (hoveredTargetEl !== targetEl) {
          clearDepTarget();
          hoveredTargetEl = targetEl;
          hoveredTargetEl.classList.add('is-dep-target');
        }
      } else {
        clearDepTarget();
      }
      showDragTip(ev.clientX, ev.clientY, modeLabel);
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      preview.remove();
      clearDepTarget();
      hideDragTip();
      const st = connectState;
      connectState = null;
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetBar = hitEl && (hitEl.closest('.gantt-bar, .gantt-milestone') || hitEl.closest('[data-item-id]'));
      if (st && targetBar && targetBar.dataset.itemId) {
        finishConnection(st.fromId, targetBar.dataset.itemId, st.type);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- MARQUEE SELECTION & EMPTY GRID PAN ---
  if (bodyEl) {
    bodyEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.gantt-bar, .gantt-milestone, .gantt-marker-line, .gantt-dep-group, .note')) return;

      if (connectState) {
        cancelInteraction();
        return;
      }

      // Shift+drag draws selection marquee
      if (e.shiftKey && !presenting() && marqueeEl) {
        e.preventDefault();
        const bodyRect = bodyEl.getBoundingClientRect();
        const startX = e.clientX - bodyRect.left;
        const startY = e.clientY - bodyRect.top;
        marqueeEl.hidden = false;
        marqueeEl.style.left = `${startX}px`;
        marqueeEl.style.top = `${startY}px`;
        marqueeEl.style.width = '0px';
        marqueeEl.style.height = '0px';

        // Cache bar rects once on pointerdown
        const barBoxes = [];
        els.bars.forEach((el, id) => {
          const it = itemById(id);
          if (it && it._bar) barBoxes.push({ id, b: it._bar });
        });

        activeDrag = { kind: 'marquee' };

        const onMove = (ev) => {
          const curX = ev.clientX - bodyRect.left;
          const curY = ev.clientY - bodyRect.top;
          const x = Math.min(startX, curX);
          const y = Math.min(startY, curY);
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          marqueeEl.style.left = `${x}px`;
          marqueeEl.style.top = `${y}px`;
          marqueeEl.style.width = `${w}px`;
          marqueeEl.style.height = `${h}px`;

          selItems.clear();
          selMarkerId = null;
          selDepKey = null;
          selNoteId = null;
          barBoxes.forEach(({ id, b }) => {
            if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) {
              selItems.add(id);
            }
          });
          syncSelectionUi();
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          marqueeEl.hidden = true;
          activeDrag = null;
          syncSelectionUi();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return;
      }

      // Click/drag on empty grid: clear selection, drag pans timeline horizontally
      clearSelection();
      if (!timeline) return;
      const startX = e.clientX;
      const startScroll = timeline.scrollLeft;
      const onMove = (ev) => {
        timeline.scrollLeft = startScroll - (ev.clientX - startX);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // --- DELEGATED LAYER EVENTS ---
  // One listener per layer dispatching by data-* id (elements are reused across renders, so nothing is bound per
  // element). Enter / leave do not bubble: they are caught in the capture phase and matched on e.target itself.
  const rowElAt = (t) => {
    const row = t && t.closest ? t.closest('.gantt-tree-row') : null;
    return row && els.rows.get(row.dataset.itemId) === row ? row : null;
  };
  const rowBgAt = (t) => {
    const bg = t && t.closest ? t.closest('.gantt-row-bg') : null;
    return bg && els.rowBgs.get(bg.dataset.rowId) === bg ? bg : null;
  };
  const barElAt = (t) => {
    const el = t && t.closest ? t.closest('.gantt-bar, .gantt-milestone') : null;
    return el && els.bars.get(el.dataset.itemId) === el ? el : null;
  };
  const markerRecAt = (t, cls) => {
    const el = t && t.closest ? t.closest(cls) : null;
    const rec = el ? els.markers.get(el.dataset.markerId) : null;
    return rec && (rec.line === el || rec.flag === el) ? el : null;
  };

  // Drag across an unscheduled leaf's empty row to give it dates (click: a week from there).
  function onScheduleRowPointerDown(e, it) {
    if (e.button !== 0 || e.shiftKey || activeDrag || connectState) return;
    e.stopPropagation();
    const anchorDate = dateFromClientX(e.clientX);
    const startX = e.clientX;
    let endDate = anchorDate;
    let dragged = false;
    activeDrag = { kind: 'schedule', item: it };
    removeActionBar();
    showGhostBar(it, anchorDate, it.kind === 'milestone' ? anchorDate : ganttAddDays(anchorDate, 6), `+ Schedule · ${formatShortDate(anchorDate)}`);

    const onMove = (ev) => {
      if (!dragged && Math.abs(ev.clientX - startX) > 4) dragged = true;
      if (!dragged) return;
      endDate = dateFromClientX(ev.clientX);
      const s = anchorDate <= endDate ? anchorDate : endDate;
      const en = it.kind === 'milestone' ? s : (anchorDate <= endDate ? endDate : anchorDate);
      showGhostBar(it, s, en);
      const days = Math.max(1, ganttDiffDays(s, en) + 1);
      showDragTip(ev.clientX, ev.clientY, `${formatDateRange(s, en)} · ${days}d`);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      activeDrag = null;
      hideGhostBar();
      hideDragTip();
      if (ev.type === 'pointerup') {
        if (dragged) {
          const s = anchorDate <= endDate ? anchorDate : endDate;
          const en = anchorDate <= endDate ? endDate : anchorDate;
          it.start = s;
          it.end = it.kind === 'milestone' ? s : en;
        } else {
          it.start = anchorDate;
          it.end = it.kind === 'milestone' ? anchorDate : ganttAddDays(anchorDate, 6);
        }
        selectSingleItem(it.id);
        render();
        updateStatus(true);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function wireLayerEvents() {
    if (gridEl) {
      gridEl.addEventListener('pointerenter', (e) => {
        const bg = rowBgAt(e.target);
        if (bg === e.target) setHoveredRow(bg.dataset.rowId);
      }, true);
      gridEl.addEventListener('pointerleave', (e) => {
        const bg = rowBgAt(e.target);
        if (bg !== e.target) return;
        const id = bg.dataset.rowId;
        if (hoveredRowId === id) setHoveredRow(null);
        if (!activeDrag && ghostRowId === id) hideGhostBar();
      }, true);
      const unscheduledAt = (e) => {
        const bg = rowBgAt(e.target);
        if (!bg || !bg.classList.contains('is-unscheduled') || presenting()) return null;
        return itemById(bg.dataset.rowId);
      };
      gridEl.addEventListener('pointermove', (ev) => {
        if (activeDrag || connectState) return;
        const it = unscheduledAt(ev);
        if (!it) return;
        const d = dateFromClientX(ev.clientX);
        const previewEnd = it.kind === 'milestone' ? d : ganttAddDays(d, 6);
        showGhostBar(it, d, previewEnd, `+ Schedule · ${formatShortDate(d)}`);
      });
      gridEl.addEventListener('pointerdown', (e) => {
        const it = unscheduledAt(e);
        if (it) onScheduleRowPointerDown(e, it);
      });
    }

    if (treeEl) {
      treeEl.addEventListener('pointerdown', (e) => {
        const row = rowElAt(e.target);
        if (!row) return;
        if (e.target.closest('.chevron, .gantt-row-add')) { e.stopPropagation(); return; }
        const it = itemById(row.dataset.itemId);
        if (it) onSidebarRowPointerDown(e, it);
      });
      treeEl.addEventListener('click', (e) => {
        const row = rowElAt(e.target);
        if (!row) return;
        if (e.target.closest('.chevron')) {
          e.stopPropagation();
          toggleCollapse(row.dataset.itemId);
        } else if (e.target.closest('.gantt-row-add')) {
          e.stopPropagation();
          addSubtask(row.dataset.itemId);
        }
      });
      treeEl.addEventListener('dblclick', (e) => {
        const row = rowElAt(e.target);
        if (!row || presenting()) return;
        e.stopPropagation();
        startInlineRename(row.dataset.itemId, row.querySelector(':scope > .gantt-tree-label'));
      });
      treeEl.addEventListener('pointerenter', (e) => {
        const row = rowElAt(e.target);
        if (row === e.target) onItemHover(row.dataset.itemId, true);
      }, true);
      treeEl.addEventListener('pointerleave', (e) => {
        const row = rowElAt(e.target);
        if (row === e.target) onItemHover(row.dataset.itemId, false);
      }, true);
    }

    if (barsEl) {
      barsEl.addEventListener('pointerdown', (e) => {
        const el = barElAt(e.target);
        const it = el ? itemById(el.dataset.itemId) : null;
        if (!it) return;
        if (e.target.closest('.note-badge')) { e.stopPropagation(); return; }
        const res = e.target.closest('.gantt-resize');
        if (res) onResizePointerDown(e, it, res.classList.contains('gantt-resize-l') ? 'start' : 'end');
        if (e.cancelBubble) return;   // the resize handle took it
        const port = e.target.closest('.port[data-port]');
        if (port) onPortPointerDown(e, it.id, port.dataset.port);
        if (e.cancelBubble) return;   // the port took it
        onBarPointerDown(e, it);
      });
      barsEl.addEventListener('click', (e) => {
        const el = barElAt(e.target);
        if (!el || !e.target.closest('.note-badge')) return;
        e.stopPropagation();
        peekOrEditNote(el.dataset.itemId);
      });
      barsEl.addEventListener('dblclick', (e) => {
        const el = barElAt(e.target);
        if (!el || presenting()) return;
        e.stopPropagation();
        const id = el.dataset.itemId;
        const row = els.rows.get(id);
        const lbl = row ? row.querySelector(':scope > .gantt-tree-label') : null;
        startInlineRename(id, lbl || (el.classList.contains('gantt-milestone') ? el.querySelector(':scope > .gantt-ms-label') : null));
      });
      barsEl.addEventListener('pointerenter', (e) => {
        const el = barElAt(e.target);
        if (el === e.target) onItemHover(el.dataset.itemId, true);
      }, true);
      barsEl.addEventListener('pointerleave', (e) => {
        const el = barElAt(e.target);
        if (el === e.target) onItemHover(el.dataset.itemId, false);
      }, true);
    }

    if (markersEl) {
      markersEl.addEventListener('pointerdown', (e) => {
        const line = markerRecAt(e.target, '.gantt-marker-line');
        if (line && !presenting()) onMarkerPointerDown(e, line.dataset.markerId);
      });
    }
    if (headerMarkers) {
      headerMarkers.addEventListener('pointerdown', (e) => {
        const flag = markerRecAt(e.target, '.gantt-marker-flag');
        if (flag && !presenting()) onMarkerPointerDown(e, flag.dataset.markerId);
      });
      headerMarkers.addEventListener('dblclick', (e) => {
        const flag = markerRecAt(e.target, '.gantt-marker-flag');
        if (!flag || presenting()) return;
        e.stopPropagation();
        const raw = markerById(flag.dataset.markerId);
        if (raw) openMarkerRenamePop(flag, raw);
      });
    }

    const svg = ensureDepsSvg();
    if (svg) {
      svg.addEventListener('pointerdown', (e) => {
        const g = e.target && e.target.closest ? e.target.closest('.gantt-dep-group') : null;
        const key = g ? depKeyByEl.get(g) : null;
        if (!key || e.button !== 0 || presenting()) return;
        e.stopPropagation();
        selectDependency(key);
      });
    }
  }
  wireLayerEvents();

  // --- SIDEBAR ROW DRAG (REORDER / REPARENT) ---
  function onSidebarRowPointerDown(e, it) {
    if (e.button !== 0) return;
    if (e.target.closest('button') || e.target.isContentEditable) return;
    e.stopPropagation();

    if (e.shiftKey) { selectItemRange(it.id); return; }
    if (e.ctrlKey || e.metaKey) { toggleItemSelection(it.id); return; }
    selectSingleItem(it.id);
    if (presenting()) return;

    const startY = e.clientY;
    let dragging = false;
    let dropTarget = null;
    let dropMode = null; // 'before' | 'after' | 'inside'

    const clearDropIndicators = () => {
      els.rows.forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-inside', 'is-row-dragging'));
    };

    const onMove = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 6) return;
      if (!dragging) {
        dragging = true;
        removeActionBar();
        const srcRow = els.rows.get(it.id);
        if (srcRow) srcRow.classList.add('is-row-dragging');
      }
      clearDropIndicators();
      const srcRow = els.rows.get(it.id);
      if (srcRow) srcRow.classList.add('is-row-dragging');

      dropTarget = null;
      dropMode = null;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetRow = hit && hit.closest('.gantt-tree-row');
      if (!targetRow) return;
      const tid = targetRow.dataset.itemId;
      if (!tid || tid === it.id || isAncestor(it.id, tid)) return;

      const r = targetRow.getBoundingClientRect();
      const rel = (ev.clientY - r.top) / Math.max(1, r.height);
      const targetItem = itemById(tid);
      if (rel < 0.28) {
        dropMode = 'before';
        targetRow.classList.add('drop-before');
      } else if (rel > 0.72) {
        dropMode = 'after';
        targetRow.classList.add('drop-after');
      } else if (targetItem && targetItem.kind !== 'milestone') {
        dropMode = 'inside';
        targetRow.classList.add('drop-inside');
      } else {
        dropMode = 'after';
        targetRow.classList.add('drop-after');
      }
      dropTarget = tid;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearDropIndicators();
      if (dragging && dropTarget && dropMode) {
        reorderOrReparent(it.id, dropTarget, dropMode);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function reorderOrReparent(sourceId, targetId, mode) {
    if (sourceId === targetId || isAncestor(sourceId, targetId)) return;
    const src = itemById(sourceId);
    const tgt = itemById(targetId);
    if (!src || !tgt) return;

    const list = itemsList();
    const srcIdx = list.indexOf(src);
    if (srcIdx < 0) return;

    if (mode === 'inside') {
      if (tgt.kind === 'milestone') return;
      src.parent = tgt.id;
      if (tgt.collapsed) delete tgt.collapsed;
    } else {
      if (tgt.parent) src.parent = tgt.parent;
      else delete src.parent;
    }

    list.splice(srcIdx, 1);
    const newTgtIdx = list.indexOf(tgt);
    if (mode === 'before') list.splice(newTgtIdx, 0, src);
    else list.splice(newTgtIdx + 1, 0, src);

    render();
    updateStatus(true);
  }

  function siblingIndices(itemId) {
    const list = itemsList();
    const it = itemById(itemId);
    if (!it) return { indices: [], pos: -1 };
    const pid = it.parent || '';
    const indices = [];
    list.forEach((x, idx) => {
      if (x && (x.parent || '') === pid) indices.push(idx);
    });
    const pos = indices.findIndex((idx) => list[idx] === it);
    return { indices, pos };
  }

  function moveItemSibling(itemId, delta) {
    if (presenting()) return;
    const list = itemsList();
    const { indices, pos } = siblingIndices(itemId);
    const nextPos = pos + delta;
    if (pos < 0 || nextPos < 0 || nextPos >= indices.length) return;
    const a = indices[pos];
    const b = indices[nextPos];
    const tmp = list[a];
    list[a] = list[b];
    list[b] = tmp;
    render();
    updateStatus(true);
  }

  // --- SIDEBAR SPLITTER DRAG & DOUBLE-CLICK AUTO-FIT ---
  function autoFitSidebarWidth() {
    if (!treeEl) return;
    let maxW = 200;
    treeEl.querySelectorAll('.gantt-tree-row').forEach((row) => {
      const lbl = row.querySelector('.gantt-tree-label');
      if (!lbl) return;
      const needed = Math.ceil((lbl.offsetLeft || 44) + lbl.scrollWidth + 36);
      if (needed > maxW) maxW = needed;
    });
    applySidebarWidth(Math.max(200, Math.min(480, maxW)));
  }

  if (splitter) {
    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = sidebarWidth;
      splitter.classList.add('is-dragging');

      const onMove = (ev) => {
        applySidebarWidth(startW + (ev.clientX - startX));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        splitter.classList.remove('is-dragging');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const next = e.key === 'ArrowLeft' ? sidebarWidth - step
        : e.key === 'ArrowRight' ? sidebarWidth + step
        : e.key === 'Home' ? SIDEBAR_MIN
        : e.key === 'End' ? SIDEBAR_MAX : null;
      if (next == null) return;
      e.preventDefault();
      applySidebarWidth(next);
    });
    splitter.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      autoFitSidebarWidth();
    });
  }

  // --- SCROLL SYNCHRONIZATION & AUTO-EXTENDING TIMELINE ---
  let suppressExtendUntil = 0;
  function maybeExtendTimeline() {
    if (isExtendingTimeline || activeDrag || !timeline || !chartData._range) return;
    if (performance.now() < suppressExtendUntil) return;
    if (timeline.scrollWidth <= timeline.clientWidth) return;
    const range = chartData._range;
    const step = EXTEND_DAYS[currentZoom()] || 180;

    if (timeline.scrollLeft < 120) {
      const oldStart = range.start;
      const baseStart = (chartData._extraStart && chartData._extraStart < oldStart) ? chartData._extraStart : oldStart;
      chartData._extraStart = ganttAddDays(baseStart, -step);
      isExtendingTimeline = true;
      const prevScrollLeft = timeline.scrollLeft;
      const prevScrollTop = timeline.scrollTop;
      render();
      const newStart = chartData._range ? chartData._range.start : oldStart;
      const addedDays = ganttDiffDays(newStart, oldStart);
      const deltaPx = addedDays > 0 ? Math.round(addedDays * chartData._range.pxPerDay) : 0;
      isSyncingScroll = true;
      timeline.scrollLeft = prevScrollLeft + deltaPx;
      timeline.scrollTop = prevScrollTop;
      if (treeEl) treeEl.scrollTop = prevScrollTop;
      isSyncingScroll = false;
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    } else if (timeline.scrollLeft + timeline.clientWidth > timeline.scrollWidth - 120) {
      const oldEnd = range.end;
      const baseEnd = (chartData._extraEnd && chartData._extraEnd > oldEnd) ? chartData._extraEnd : oldEnd;
      chartData._extraEnd = ganttAddDays(baseEnd, step);
      isExtendingTimeline = true;
      const prevScrollLeft = timeline.scrollLeft;
      const prevScrollTop = timeline.scrollTop;
      render();
      isSyncingScroll = true;
      timeline.scrollLeft = prevScrollLeft;
      timeline.scrollTop = prevScrollTop;
      if (treeEl) treeEl.scrollTop = prevScrollTop;
      isSyncingScroll = false;
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    }
  }

  let expectedTreeScrollTop = null;
  let expectedTimelineScrollTop = null;
  if (timeline && treeEl) {
    timeline.addEventListener('scroll', () => {
      if (expectedTimelineScrollTop !== null && timeline.scrollTop === expectedTimelineScrollTop) {
        expectedTimelineScrollTop = null;
      } else if (!isSyncingScroll) {
        isSyncingScroll = true;
        if (treeEl.scrollTop !== timeline.scrollTop) {
          treeEl.scrollTop = timeline.scrollTop;
          expectedTreeScrollTop = treeEl.scrollTop;
        }
        if (actionBarEl) removeActionBar();
        isSyncingScroll = false;
      }
      maybeExtendTimeline();
      scheduleScrollOverlays();
      scheduleInViewRefresh();
    }, { passive: true });

    treeEl.addEventListener('scroll', () => {
      if (expectedTreeScrollTop !== null && treeEl.scrollTop === expectedTreeScrollTop) {
        expectedTreeScrollTop = null;
        return;
      }
      if (isSyncingScroll) return;
      isSyncingScroll = true;
      if (timeline.scrollTop !== treeEl.scrollTop) {
        timeline.scrollTop = treeEl.scrollTop;
        expectedTimelineScrollTop = timeline.scrollTop;
      }
      if (actionBarEl) removeActionBar();
      isSyncingScroll = false;
      scheduleScrollOverlays();
    }, { passive: true });
  }
  window.addEventListener('resize', scheduleScrollOverlays, { passive: true });

  // --- ZOOM CONTROLLER & MORPH TRANSITION ("morph, not fade") ---
  function captureBarRects() {
    const map = new Map();
    els.bars.forEach((el, id) => {
      map.set(id, el.getBoundingClientRect());
    });
    return map;
  }

  function playZoomMorph(oldRects) {
    if (!motion.enabled() || !oldRects || !oldRects.size) return;
    const dur = motion.dur('dur-base', 200);
    const easing = motion.curve('curve-out');
    els.bars.forEach((el, id) => {
      const prev = oldRects.get(id);
      if (!prev) return;
      settleMorph(el);
      const next = el.getBoundingClientRect();
      if (!next.width || !next.height) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      const sx = prev.width / next.width;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01) return;
      motion.anim(el, [
        { transformOrigin: 'left center', transform: `translate(${dx}px, ${dy}px) scaleX(${sx})` },
        { transformOrigin: 'left center', transform: 'none' }
      ], { duration: dur, easing });
    });
  }

  function setZoomPreset(nextZoom) {
    if (!Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, nextZoom)) return;
    const prevZoom = currentZoom();
    if (prevZoom === nextZoom) return;

    // 1. Anchor viewport center date before changing zoom
    const prevRange = chartData._range;
    let centerDate = null;
    if (timeline && prevRange) {
      const centerPx = timeline.scrollLeft + timeline.clientWidth / 2;
      const dayOffset = Math.round(centerPx / prevRange.pxPerDay);
      centerDate = ganttAddDays(prevRange.start, dayOffset);
    }

    // 2. Capture old bar rects for FLIP morph
    const oldRects = motion.enabled() ? captureBarRects() : null;

    // 3. Apply new zoom & re-render
    chartData.zoom = nextZoom;
    render();

    // 4. Restore scroll position to keep centerDate anchored
    if (timeline && centerDate && chartData._range) {
      const newCenterPx = ganttDiffDays(chartData._range.start, centerDate) * chartData._range.pxPerDay;
      isExtendingTimeline = true;
      timeline.scrollTo({ left: Math.max(0, Math.round(newCenterPx - timeline.clientWidth / 2)), behavior: 'instant' });
      requestAnimationFrame(() => {
        isExtendingTimeline = false;
        if (viewMode === 'in-view') render();
        else scheduleScrollOverlays();
      });
    }

    // 5. Morph bars from old rects to new rects
    if (oldRects) playZoomMorph(oldRects);
    if (!presenting()) updateStatus(true);
  }

  const zoomController = {
    zoomIn() {
      const idx = ZOOM_ORDER.indexOf(currentZoom());
      if (idx > 0) setZoomPreset(ZOOM_ORDER[idx - 1]);
    },
    zoomOut() {
      const idx = ZOOM_ORDER.indexOf(currentZoom());
      if (idx >= 0 && idx < ZOOM_ORDER.length - 1) setZoomPreset(ZOOM_ORDER[idx + 1]);
    },
    reset(animate) {
      // Pick the finest zoom preset where the roadmap content fits inside the visible timeline width
      const availW = (timeline && timeline.clientWidth) ? timeline.clientWidth - 24 : 900;
      const range = chartData._range;
      const contentDays = (range && range.contentStart && range.contentEnd)
        ? Math.max(1, ganttDiffDays(range.contentStart, range.contentEnd) + 14)
        : (range ? range.totalDays : 90);
      let chosen = 'month';
      if (contentDays > 0) {
        chosen = 'year';
        for (let i = 0; i < ZOOM_ORDER.length; i++) {
          const z = ZOOM_ORDER[i];
          if (contentDays * GANTT_ZOOMS[z].pxPerDay <= availW) {
            chosen = z;
            break;
          }
        }
      }
      const scrollToContent = () => {
        if (!timeline || !chartData._range) return;
        const r = chartData._range;
        const anchorDate = r.contentStart || r.start;
        const anchorX = ganttDiffDays(r.start, anchorDate) * r.pxPerDay;
        const left = Math.max(0, Math.round(anchorX - 48));
        isExtendingTimeline = true;
        timeline.scrollTo({ left, top: 0, behavior: (animate && motion.enabled()) ? 'smooth' : 'auto' });
        requestAnimationFrame(() => { isExtendingTimeline = false; });
      };
      if (chosen !== currentZoom()) {
        const oldRects = (animate && motion.enabled()) ? captureBarRects() : null;
        chartData.zoom = chosen;
        render();
        scrollToContent();
        if (oldRects) playZoomMorph(oldRects);
      } else {
        scrollToContent();
      }
    },
    getLabel() {
      return (GANTT_ZOOMS[currentZoom()] || GANTT_ZOOMS.month).label;
    }
  };

  // --- JUMP TO TODAY (smart horizontal + vertical scroll to active work) ---
  function jumpToToday() {
    if (!timeline || !chartData._range) return;
    const todayStr = getTodayStr();
    const range = chartData._range;
    const x = (ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay;
    const targetLeft = Math.max(0, Math.round(x - timeline.clientWidth / 2));

    // Also bring active work into vertical view if none is currently visible
    const vis = visibleItems();
    const headerH = headerEl ? headerEl.offsetHeight : 58;
    const viewH = Math.max(0, timeline.clientHeight - headerH);
    const visTop = timeline.scrollTop;
    const visBot = visTop + viewH;
    const rowH = GANTT_METRICS.ROW_H;
    const activeLeaves = vis.filter((it) => it && !it._hasChildren && it.kind !== 'group' && getTimeState(it, todayStr) === 'active');
    const candidates = activeLeaves.length
      ? activeLeaves
      : vis.filter((it) => it && !it._hasChildren && it.kind !== 'group' && getTimeState(it, todayStr) === 'upcoming');
    const anyVisibleVert = candidates.some((it) => {
      const y = it._row * rowH;
      return y + rowH > visTop + 4 && y < visBot - 4;
    });
    const scrollOpts = {
      left: targetLeft,
      behavior: motion.enabled() ? 'smooth' : 'auto'
    };
    if (candidates.length && !anyVisibleVert) {
      const firstY = candidates[0]._row * rowH;
      scrollOpts.top = Math.max(0, Math.round(firstY - Math.min(rowH * 2, viewH * 0.25)));
    }

    suppressExtendUntil = performance.now() + 700;
    timeline.scrollTo(scrollOpts);
    if (todayStr < range.start || todayStr > range.end) {
      ui.toast(`Today (${todayStr}) is outside the current roadmap range`);
    }
    if (viewMode === 'in-view') {
      scheduleInViewRefresh();
    }
  }

  // --- HOLIDAYS POPOVER ---
  function renderHolidaysList() {
    if (!holidaysList) return;
    holidaysList.textContent = '';
    const list = holidaysListData();
    if (!list.length) {
      holidaysList.appendChild(htmlEl('div', 'gantt-hol-empty', 'No holidays configured.'));
      return;
    }
    const edit = !presenting();
    list.forEach((h, idx) => {
      const row = htmlEl('div', 'gantt-hol-row');
      const info = htmlEl('div', 'gantt-hol-info');
      const span = h.end && h.end !== h.date ? `${h.date} .. ${h.end}` : h.date;
      info.append(
        htmlEl('span', 'gantt-hol-date', span),
        htmlEl('span', 'gantt-hol-name', h.country ? `${h.name || 'Holiday'} (${h.country})` : (h.name || 'Holiday'))
      );
      row.appendChild(info);
      if (edit) {
        const del = htmlEl('button', 'gantt-hol-del btn-danger-hover');
        del.type = 'button';
        del.title = 'Remove holiday';
        del.setAttribute('aria-label', `Remove ${h.name || h.date}`);
        del.innerHTML = ui.icon('close', { size: 'xs', bold: true });
        del.addEventListener('click', () => {
          chartData.holidays.splice(idx, 1);
          if (!chartData.holidays.length) delete chartData.holidays;
          render();
          updateStatus(true);
        });
        row.appendChild(del);
      }
      holidaysList.appendChild(row);
    });
  }

  function toggleHolidaysPop(force, restoreFocus = false) {
    if (!holidaysPop) return;
    const show = typeof force === 'boolean' ? force : holidaysPop.hidden;
    if (show) holidaysPrevFocus = document.activeElement;
    holidaysPop.hidden = !show;
    if (btnHolidays) btnHolidays.setAttribute('aria-expanded', String(show));
    if (show) renderHolidaysList();
    else if (restoreFocus) {
      const prev = holidaysPrevFocus || btnHolidays;
      holidaysPrevFocus = null;
      if (prev && typeof prev.focus === 'function' && prev.isConnected) {
        try { prev.focus({ preventScroll: true }); } catch (_) { prev.focus(); }
      }
    } else {
      holidaysPrevFocus = null;
    }
  }

  if (btnHolidays) {
    btnHolidays.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHolidaysPop();
    });
  }
  if (holCloseBtn) {
    holCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHolidaysPop(false, true);
    });
  }
  if (holAddBtn) {
    holAddBtn.addEventListener('click', () => {
      if (presenting()) return;
      const start = holDateInput ? ganttFormatDate(holDateInput.value) : '';
      if (!start) { ui.toast('Pick a valid holiday start date'); return; }
      const endInput = holEndInput || document.getElementById('gantt-hol-end');
      const rawEnd = endInput && endInput.value ? ganttFormatDate(endInput.value) : '';
      if (endInput && endInput.value && !rawEnd) { ui.toast('Pick a valid holiday end date'); return; }
      const end = rawEnd || start;
      if (end < start) { ui.toast('End date must be on or after start date'); return; }
      const name = cleanLabel(holNameInput ? holNameInput.value : '', 'Holiday');
      if (!Array.isArray(chartData.holidays)) chartData.holidays = [];
      if (chartData.holidays.some((h) => h && h.date === start && (h.end || h.date) === end && h.name === name)) {
        ui.toast('Holiday already listed');
        return;
      }
      chartData.holidays.push({ date: start, end, name });
      chartData.holidays.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (holDateInput) holDateInput.value = '';
      if (endInput) endInput.value = '';
      if (holNameInput) holNameInput.value = '';
      render();
      updateStatus(true);
    });
  }
  if (window.GanttDatePicker && typeof window.GanttDatePicker.attachInput === 'function') {
    if (holDateInput) {
      window.GanttDatePicker.attachInput(holDateInput, {
        allowClear: true,
        onChange: (val) => {
          if (holEndInput && val && holEndInput.value && holEndInput.value < val) holEndInput.value = val;
        }
      });
    }
    if (holEndInput) {
      window.GanttDatePicker.attachInput(holEndInput, {
        allowClear: true,
        min: () => (holDateInput ? ganttFormatDate(holDateInput.value) : '') || ''
      });
    }
  }

  if (modeSwitchEl) {
    modeSwitchEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-gantt-mode]') : null;
      if (!btn) return;
      setDisplayMode(btn.dataset.ganttMode);
    });
  }

  // --- TOOLBAR BUTTON WIRING (+ DRAG-FROM-ADD TILES) ---
  function wireAddTileDrag(btn, kind, label, onClickFn) {
    if (!btn) return;
    let suppressClick = false;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || presenting()) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost = null;

      const isOverTimeline = (cx, cy) => {
        if (!timeline) return false;
        const r = timeline.getBoundingClientRect();
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };

      const onMove = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 6) return;
        if (!dragging) {
          dragging = true;
          const wrap = addPop && addPop.closest('[data-dock-pop]');
          if (wrap) wrap.classList.remove('open');
          if (btnAdd) btnAdd.setAttribute('aria-expanded', 'false');
          document.body.classList.add('palette-dragging');
          ghost = htmlEl('div', 'gantt-add-ghost', label);
          ghost.setAttribute('data-export-skip', '');
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY - 14}px`;
        if (isOverTimeline(ev.clientX, ev.clientY)) {
          const dropDate = dateFromClientX(ev.clientX);
          const rowItem = itemFromClientY(ev.clientY);
          ghost.textContent = `${label} · ${formatShortDate(dropDate)}`;
          setHoveredRow(rowItem ? rowItem.id : null);
        } else {
          ghost.textContent = label;
          setHoveredRow(null);
        }
      };

      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (ghost) { ghost.remove(); ghost = null; }
        document.body.classList.remove('palette-dragging');
        setHoveredRow(null);
        if (!dragging) return;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        if (ev.type !== 'pointerup' || !isOverTimeline(ev.clientX, ev.clientY)) return;
        const dropDate = dateFromClientX(ev.clientX);
        const rowItem = itemFromClientY(ev.clientY);
        if (kind === 'task') {
          const parentId = (rowItem && (rowItem._hasChildren || rowItem.kind === 'group'))
            ? rowItem.id
            : (rowItem && rowItem.parent ? rowItem.parent : null);
          addTask(parentId, { start: dropDate, end: ganttAddDays(dropDate, 13) });
        } else if (kind === 'subtask') {
          const parentId = (rowItem && rowItem.kind !== 'milestone')
            ? rowItem.id
            : (selItems.size === 1 ? [...selItems][0] : null);
          addSubtask(parentId, { start: dropDate, end: ganttAddDays(dropDate, 13) });
        } else if (kind === 'milestone') {
          const parentId = (rowItem && rowItem.kind !== 'milestone') ? rowItem.id : null;
          addMilestone({ date: dropDate, parentId });
        } else if (kind === 'marker') {
          addVerticalMarker({ date: dropDate });
        } else if (kind === 'note') {
          const targetId = rowItem ? rowItem.id : (selItems.size ? [...selItems][0] : null);
          addOrEditNoteForTarget(targetId);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    btn.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      onClickFn();
    });
  }

  wireAddTileDrag(btnAddTask, 'task', 'Task', () => addTask(null));
  wireAddTileDrag(btnAddSubtask, 'subtask', 'Subtask', () => addSubtask(null));
  wireAddTileDrag(btnAddMilestone, 'milestone', 'Milestone', () => addMilestone());
  wireAddTileDrag(btnAddMarker, 'marker', 'Date Line', () => addVerticalMarker());
  wireAddTileDrag(btnAddNote, 'note', 'Note', () => {
    const targetId = selItems.size ? [...selItems][0] : null;
    addOrEditNoteForTarget(targetId);
  });

  if (btnAddInline) btnAddInline.addEventListener('click', () => addTask(null));
  if (btnToggleAll) btnToggleAll.addEventListener('click', () => toggleCollapseAll());
  if (btnNotes) btnNotes.addEventListener('click', () => toggleShowNotes());
  if (btnDeps) {
    btnDeps.addEventListener('click', () => {
      showDeps = !showDeps;
      syncDepsVisibility();
    });
  }
  if (btnWeekends) {
    btnWeekends.addEventListener('click', () => {
      if (chartData.showWeekends === false) delete chartData.showWeekends;
      else chartData.showWeekends = false;
      if (!GANTT_ZOOMS[currentZoom()].showWeekends) {
        ui.toast('Weekends show in Day and Week views');
      }
      render();
      if (!presenting()) updateStatus(true);
    });
  }
  if (legendWrap) {
    legendWrap.addEventListener('mouseenter', () => {
      if (!legendOpen) toggleLegendPop(true, false);
    });
    legendWrap.addEventListener('mouseleave', () => {
      if (!legendPinned && legendOpen) toggleLegendPop(false, false);
    });
  }
  if (btnLegend) {
    btnLegend.addEventListener('click', (e) => {
      e.stopPropagation();
      if (legendOpen && legendPinned) toggleLegendPop(false, false);
      else toggleLegendPop(true, true);
    });
  }
  if (btnToday) btnToday.addEventListener('click', () => jumpToToday());
  if (viewPop) {
    const viewMenu = viewPop.querySelector('.gantt-view-menu');
    const viewOpts = () => [...viewPop.querySelectorAll('.gantt-view-opt')];
    const closeViewPop = (restoreFocus) => {
      if (viewWrap) viewWrap.classList.remove('open');
      if (btnViewFilter) {
        btnViewFilter.setAttribute('aria-expanded', 'false');
        if (restoreFocus) btnViewFilter.focus();
      }
    };
    viewPop.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-view-mode]');
      if (!opt || !viewPop.contains(opt)) return;
      const mode = opt.dataset.viewMode;
      const fromKeyboard = e.detail === 0;
      if (mode) setViewMode(mode);
      closeViewPop(fromKeyboard);
    });
    if (btnViewFilter) {
      btnViewFilter.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (viewWrap && !viewWrap.classList.contains('open')) {
            viewWrap.classList.add('open');
            btnViewFilter.setAttribute('aria-expanded', 'true');
          }
          const first = viewOpts()[0];
          if (first) first.focus({ preventScroll: true });
        }
      });
    }
    if (viewMenu && !('focusGroup' in HTMLElement.prototype)) {
      viewMenu.setAttribute('role', 'menu');
      viewMenu.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const items = viewOpts();
        const idx = items.indexOf(document.activeElement);
        if (idx < 0 || !items.length) return;
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 :
          (idx + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        e.preventDefault();
        e.stopImmediatePropagation();
        items[next].focus({ preventScroll: true });
      }, true);
    }
  }
  if (stickyPhaseEl) {
    stickyPhaseEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = stickyPhaseEl.dataset.targetId;
      const target = targetId ? itemById(targetId) : null;
      if (!target || target._hidden || typeof target._row !== 'number' || !timeline) return;
      timeline.scrollTo({
        top: Math.max(0, target._row * GANTT_METRICS.ROW_H),
        behavior: motion.enabled() ? 'smooth' : 'auto'
      });
    });
  }
  if (btnInViewHintApply) {
    btnInViewHintApply.addEventListener('click', (e) => {
      e.stopPropagation();
      setViewMode('in-view');
    });
  }
  if (btnInViewHintDismiss) {
    btnInViewHintDismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      inViewHintDismissed = true;
      if (inViewHintEl) inViewHintEl.hidden = true;
    });
  }
  if (zoomPills) {
    const zoomDock = document.querySelector('.toolbar-zoom');
    if (zoomDock) {
      const sep = zoomDock.querySelector('.dock-sep');
      if (sep) sep.after(zoomPills);
      else zoomDock.appendChild(zoomPills);
    }
    zoomPills.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zoom-set]');
      if (!btn || !zoomPills.contains(btn)) return;
      const preset = btn.dataset.zoomSet;
      if (preset) setZoomPreset(preset);
    });
  }
  if (treeEl) treeEl.addEventListener('pointerleave', () => setHoveredRow(null));
  if (bodyEl) {
    bodyEl.addEventListener('pointerleave', () => {
      setHoveredRow(null);
      if (!activeDrag) hideGhostBar();
    });
  }

  // Keyboard shortcuts: F2 inline rename, Alt+ArrowUp / Alt+ArrowDown reorder siblings
  window.addEventListener('keydown', (e) => {
    if (presenting() || isTyping()) return;
    if (e.key === 'F2') {
      if (selItems.size === 1) {
        e.preventDefault();
        const id = [...selItems][0];
        const row = els.rows.get(id);
        startInlineRename(id, row ? row.querySelector('.gantt-tree-label') : null);
      } else if (selMarkerId) {
        const m = markerById(selMarkerId);
        const rec = els.markers.get(selMarkerId);
        if (m && rec && rec.flag) {
          e.preventDefault();
          openMarkerRenamePop(rec.flag, m);
        }
      }
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selItems.size === 1) {
      e.preventDefault();
      moveItemSibling([...selItems][0], e.key === 'ArrowUp' ? -1 : 1);
    }
  });

  // Close popovers / commit note on outside click
  window.addEventListener('pointerdown', (e) => {
    const inCalPop = Boolean(e.target && e.target.closest && e.target.closest('.gantt-cal-pop'));
    if (!inCalPop && floatingPop && !floatingPop.contains(e.target) && (!actionBarEl || !actionBarEl.contains(e.target))) {
      closeFloatingPop();
    }
    if (!inCalPop && holidaysPop && !holidaysPop.hidden && !holidaysPop.contains(e.target) && (!btnHolidays || !btnHolidays.contains(e.target))) {
      toggleHolidaysPop(false);
    }
    if (colorKeyHost && !colorKeyHost.hidden && !colorKeyHost.contains(e.target) && (!btnLegend || !btnLegend.contains(e.target))) {
      toggleLegendPop(false, false);
    }
  }, true);

  function cancelInteraction() {
    let cancelled = false;
    if (connectState) {
      connectState = null;
      if (root) root.classList.remove('is-connecting');
      cancelled = true;
    }
    if (window.GanttDatePicker && window.GanttDatePicker.isOpen()) {
      window.GanttDatePicker.close();
      cancelled = true;
    }
    if (floatingPop) {
      closeFloatingPop(true);
      cancelled = true;
    }
    if (holidaysPop && !holidaysPop.hidden) {
      toggleHolidaysPop(false, true);
      cancelled = true;
    }
    if (colorKeyHost && !colorKeyHost.hidden) {
      toggleLegendPop(false);
      cancelled = true;
    }
    if (focusChainId) {
      toggleFocusChain(null);
      cancelled = true;
    }
    return cancelled;
  }

  // --- SEARCH ---
  function searchItems() {
    const out = [];
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    visibleItems().forEach((it) => {
      const el = els.bars.get(it.id) || els.rows.get(it.id);
      const text = clean(it.label || it.id);
      if (el && text) out.push({ id: `item:${it.id}`, text, el });
    });
    (chartData._markers || []).forEach((m) => {
      const rec = els.markers.get(m.id);
      const text = clean(m.label || m.date);
      if (rec && rec.flag && text) out.push({ id: `marker:${m.id}`, text, el: rec.flag });
    });
    notesList().forEach((n) => {
      const card = els.notes.get(n.id);
      const host = card || els.bars.get(n.target) || els.rows.get(n.target);
      const text = clean(n.text);
      if (host && text) out.push({ id: `note:${n.id}`, text, el: host });
    });
    return out;
  }

  function focusSearchItem(item) {
    const el = item && item.el ? item.el : item;
    if (!el || !el.getBoundingClientRect) return;
    const smooth = motion.enabled() ? 'smooth' : 'auto';
    if (timeline && timeline.contains(el)) {
      const tr = timeline.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const targetLeft = Math.max(0, Math.round(timeline.scrollLeft + (er.left - tr.left) + er.width / 2 - timeline.clientWidth / 2));
      const targetTop = Math.max(0, Math.round(timeline.scrollTop + (er.top - tr.top) + er.height / 2 - timeline.clientHeight / 2));
      timeline.scrollTo({ left: targetLeft, top: targetTop, behavior: smooth });
      return;
    }
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: smooth });
    }
  }

  // Reveal current search match inside #gantt-timeline after shell.js updates .search-current
  function scheduleSearchReveal() {
    requestAnimationFrame(() => {
      const cur = root && root.querySelector('.search-current');
      if (cur) focusSearchItem(cur);
    });
  }
  const searchInputEl = document.getElementById('search-input');
  const searchPrevEl = document.getElementById('search-prev');
  const searchNextEl = document.getElementById('search-next');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', scheduleSearchReveal);
    searchInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') scheduleSearchReveal(); });
  }
  if (searchPrevEl) searchPrevEl.addEventListener('click', scheduleSearchReveal);
  if (searchNextEl) searchNextEl.addEventListener('click', scheduleSearchReveal);

  // --- STANDALONE SVG EXPORT ---
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || (fallback || '');
  }

  function swatchColors(slotOrHex) {
    const slot = colorSlot(slotOrHex || '1');
    const defPal = paletteOf('1') || { slot: '1', hex: cssVar('--primary') };
    const w = paletteOf(slot);
    if (w) {
      return {
        fill: cssVar(`--sw-${w.slot}-fill`, w.hex || defPal.hex),
        border: cssVar(`--sw-${w.slot}-border`, w.hex || defPal.hex),
        text: cssVar(`--sw-${w.slot}-text`, cssVar('--text')),
        solid: w.hex || defPal.hex
      };
    }
    const hex = typeof slotOrHex === 'string' && /^#[0-9a-f]{3,8}$/i.test(slotOrHex) ? slotOrHex : defPal.hex;
    return { fill: hex, border: hex, text: cssVar('--text'), solid: hex };
  }

  function exportSvg() {
    applyLayout();
    const range = chartData._range;
    const vis = visibleItems();
    const rowH = GANTT_METRICS.ROW_H;
    const headerH = GANTT_METRICS.HEADER_H;
    const sideW = sidebarWidth;
    const w = sideW + range.timelineWidth;
    const bodyH = Math.max(1, vis.length) * rowH;
    const h = headerH + bodyH;
    const todayStr = getTodayStr();

    const bg = cssVar('--bg') || 'transparent';
    const surface = cssVar('--surface') || bg;
    const border = cssVar('--border') || 'currentColor';
    const textCol = cssVar('--text') || 'currentColor';
    const muted = cssVar('--muted') || textCol;
    const primary = cssVar('--primary') || textCol;
    const danger = cssVar('--danger') || primary;
    const font = cssVar('--font-sans', 'system-ui, sans-serif');

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="font-family:${escXml(font)}">`);
    parts.push(`<defs>` +
      `<marker id="exp-arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${escXml(muted)}"/></marker>` +
      `<marker id="exp-arr-w" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${escXml(danger)}"/></marker>` +
      `</defs>`);
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${escXml(bg)}"/>`);

    // Sidebar & header backgrounds
    parts.push(`<rect x="0" y="0" width="${sideW}" height="${h}" fill="${escXml(surface)}"/>`);
    parts.push(`<rect x="0" y="0" width="${w}" height="${headerH}" fill="${escXml(surface)}"/>`);
    parts.push(`<line x1="0" y1="${headerH}" x2="${w}" y2="${headerH}" stroke="${escXml(border)}" stroke-width="1"/>`);
    parts.push(`<line x1="${sideW}" y1="0" x2="${sideW}" y2="${h}" stroke="${escXml(border)}" stroke-width="1"/>`);
    parts.push(`<text x="12" y="${Math.round(headerH / 2 + 4)}" font-size="14" font-weight="600" fill="${escXml(textCol)}">Tasks</text>`);

    // Header ticks (read from rendered DOM if available)
    if (headerTop) {
      headerTop.querySelectorAll('.gantt-tick').forEach((t) => {
        const lx = sideW + (parseFloat(t.style.left) || 0);
        const tw = parseFloat(t.style.width) || 0;
        parts.push(`<line x1="${lx}" y1="0" x2="${lx}" y2="${headerH / 2}" stroke="${escXml(border)}" stroke-width="1"/>`);
        if (tw > 20) {
          parts.push(`<text x="${lx + 6}" y="17" font-size="13" font-weight="600" fill="${escXml(textCol)}">${escXml(t.textContent)}</text>`);
        }
      });
    }
    if (headerBottom) {
      headerBottom.querySelectorAll('.gantt-tick').forEach((t) => {
        const lx = sideW + (parseFloat(t.style.left) || 0);
        const tw = parseFloat(t.style.width) || 0;
        parts.push(`<line x1="${lx}" y1="${headerH / 2}" x2="${lx}" y2="${h}" stroke="${escXml(border)}" stroke-width="1" stroke-opacity="0.55"/>`);
        if (tw > 14) {
          const numEl = t.querySelector('.gantt-day-num');
          const dowEl = t.querySelector('.gantt-day-dow');
          const tickText = (numEl && dowEl) ? `${numEl.textContent} ${dowEl.textContent}` : t.textContent;
          parts.push(`<text x="${lx + 4}" y="${headerH - 8}" font-size="12" fill="${escXml(muted)}">${escXml(tickText)}</text>`);
        }
      });
    }

    // Holidays
    (chartData._holidays || []).forEach((hl) => {
      parts.push(`<rect x="${sideW + hl.x}" y="${headerH}" width="${Math.max(2, hl.w)}" height="${bodyH}" fill="${escXml(danger)}" fill-opacity="0.08"/>`);
    });

    // Rows + sidebar labels + bars
    vis.forEach((it, idx) => {
      const y = headerH + idx * rowH;
      if (idx % 2 === 1) {
        parts.push(`<rect x="${sideW}" y="${y}" width="${range.timelineWidth}" height="${rowH}" fill="${escXml(surface)}" fill-opacity="0.5"/>`);
      }
      parts.push(`<line x1="0" y1="${y + rowH}" x2="${w}" y2="${y + rowH}" stroke="${escXml(border)}" stroke-width="0.5"/>`);
      const padL = 8 + (it._depth || 0) * 14;
      const weight = (it._hasChildren || it.kind === 'group') ? '600' : '400';
      parts.push(`<text x="${padL}" y="${y + Math.round(rowH / 2 + 4)}" font-size="14" font-weight="${weight}" fill="${escXml(textCol)}">${escXml(it.label || it.id)}</text>`);

      if (!it._bar) return;
      const b = it._bar;
      const bx = sideW + b.x;
      const by = headerH + b.y;
      const c = swatchColors(effectiveColor(it));

      if (it.kind === 'milestone' && !it._hasChildren) {
        const cx = bx + b.w / 2;
        const cy = by + b.h / 2;
        const r = b.w / 2;
        parts.push(`<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${escXml(c.solid)}" stroke="${escXml(c.border)}" stroke-width="1.5"/>`);
        parts.push(`<text x="${bx + b.w + 8}" y="${cy + 4}" font-size="13" font-weight="500" fill="${escXml(textCol)}">${escXml(it.label || it.id)}</text>`);
      } else if (it._hasChildren || it.kind === 'group') {
        parts.push(`<rect x="${bx}" y="${by}" width="${Math.max(4, b.w)}" height="${b.h}" rx="4" fill="${escXml(c.border)}" fill-opacity="0.85"/>`);
      } else {
        parts.push(`<rect x="${bx}" y="${by}" width="${Math.max(4, b.w)}" height="${b.h}" rx="5" fill="${escXml(c.fill)}" stroke="${escXml(c.border)}" stroke-width="1.2"/>`);
      }
    });

    // Dependencies
    parts.push(`<g transform="translate(${sideW}, ${headerH})">`);
    (chartData._deps || []).forEach((dep) => {
      const stroke = dep.violated ? danger : muted;
      const dash = dep.violated ? ' stroke-dasharray="4 3"' : '';
      const mk = dep.violated ? 'url(#exp-arr-w)' : 'url(#exp-arr)';
      parts.push(`<path d="${escXml(dep.path)}" fill="none" stroke="${escXml(stroke)}" stroke-width="1.5"${dash} marker-end="${mk}"/>`);
    });
    parts.push(`</g>`);

    // Vertical markers
    (chartData._markers || []).forEach((m) => {
      const mx = sideW + m.x;
      const c = swatchColors(m.color || '4');
      parts.push(`<line x1="${mx}" y1="${headerH}" x2="${mx}" y2="${h}" stroke="${escXml(c.solid)}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      parts.push(`<text x="${mx + 4}" y="${headerH - 4}" font-size="12" font-weight="600" fill="${escXml(c.solid)}">${escXml(m.label || m.date)}</text>`);
    });

    // Today line
    if (chartData.showToday !== false && todayStr >= range.start && todayStr <= range.end) {
      const tx = sideW + (ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay;
      parts.push(`<line x1="${tx}" y1="${headerH}" x2="${tx}" y2="${h}" stroke="${escXml(primary)}" stroke-width="2"/>`);
    }

    parts.push(`</svg>`);
    return { svg: parts.join(''), w, h };
  }

  // --- DISK FORMAT (mirrors gantt_to_disk / gantt_from_disk in scripts/disk_format.py) ---
  const GANTT_KEYS = [
    'diagramType', 'schemaVersion', 'title', 'zoom', 'showNotes', 'showToday', 'showWeekends',
    'colorKey', 'holidays', 'markers', 'items', 'dependencies', 'notes'
  ];
  const GENERATED_ID = /^(n|c|e|lane|t|m)_\d{12,}(_\d+)?$/;
  const SLUG_MAX = 30;

  function slug(text) {
    let s = String(text == null ? '' : text).toLowerCase().replace(/đ/g, 'd')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/_+$/, '');
    return s;
  }

  function renameGanttIds(d) {
    const items = d.items || [];
    const markers = d.markers || [];
    const notes = d.notes || [];
    const used = new Set([...items, ...markers, ...notes]
      .filter((o) => o && typeof o === 'object' && o.id != null)
      .map((o) => o.id));
    const rename = new Map();

    const take = (base) => {
      let id = base;
      let k = 2;
      while (used.has(id)) id = `${base}_${k++}`;
      used.add(id);
      return id;
    };
    const isGen = (o) => GENERATED_ID.test(String(o.id == null ? '' : o.id));

    [[items, 'task'], [markers, 'marker']].forEach(([group, fallback]) => {
      group.forEach((o) => {
        if (o && typeof o === 'object' && isGen(o)) {
          rename.set(o.id, take(slug(o.label) || fallback));
        }
      });
    });

    let count = 1;
    notes.forEach((o) => {
      if (!o || typeof o !== 'object' || !isGen(o)) return;
      while (used.has(`n${count}`)) count++;
      rename.set(o.id, take(`n${count}`));
    });

    if (!rename.size) return;
    const r = (id) => (rename.has(id) ? rename.get(id) : id);
    [...items, ...markers, ...notes].forEach((o) => {
      if (o && typeof o === 'object' && 'id' in o) o.id = r(o.id);
    });
    items.forEach((o) => {
      if (o && typeof o === 'object' && 'parent' in o) o.parent = r(o.parent);
    });
    (d.dependencies || []).forEach((dep) => {
      if (!dep || typeof dep !== 'object') return;
      if ('from' in dep) dep.from = r(dep.from);
      if ('to' in dep) dep.to = r(dep.to);
    });
    notes.forEach((n) => {
      if (n && typeof n === 'object' && 'target' in n) n.target = r(n.target);
    });
  }

  function toDisk(data) {
    const d = JSON.parse(JSON.stringify(data));
    Object.keys(d).forEach((k) => {
      if (k === 'layout' || k === 'canvas' || (k[0] === '_' && k !== '_readme')) delete d[k];
    });
    d.schemaVersion = 1;
    slotColors(d, 'items', 'markers');
    ['items', 'dependencies', 'markers', 'holidays', 'notes'].forEach((listKey) => {
      (d[listKey] || []).forEach((o) => {
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach((k) => { if (k[0] === '_') delete o[k]; });
      });
    });
    renameGanttIds(d);
    const out = {};
    GANTT_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
    Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
    return out;
  }

  function fromDisk(data) {
    didInitialScroll = false;
    const d = JSON.parse(JSON.stringify(data));
    delete d.layout;
    slotColors(d, 'items', 'markers');
    return d;
  }

  // --- TABLE VIEW CONTROLLER ---
  if (tableViewEl && window.GanttTable && typeof window.GanttTable.create === 'function') {
    tableCtrl = window.GanttTable.create(tableViewEl, {
      getData: () => chartData,
      getAllItems: () => itemsList(),
      getVisibleItems: () => visibleItems(),
      getMarkers: () => markersList(),
      getDeps: () => depsList(),
      getNotes: () => notesList(),
      getColorKey: () => (chartData && chartData.colorKey) || {},
      getSelectedIds: () => selItems,
      setSelectedIds: (nextSet) => {
        selItems = nextSet instanceof Set ? new Set(nextSet) : new Set(nextSet || []);
        selMarkerId = null;
        selDepKey = null;
        selNoteId = null;
      },
      isPresenting: () => presenting(),
      commit: () => {
        render();
        updateStatus(true);
      },
      commitSilent: () => {
        render();
      },
      newId: (prefix) => newId(prefix),
      getTodayStr: () => getTodayStr(),
      cleanLabel: (val, fallback) => cleanLabel(val, fallback),
      getNoteForItem: (id) => notesList().find((n) => n && n.target === id) || null,
      setNoteForItem: (id, text) => {
        const trimmed = String(text == null ? '' : text).trim();
        if (!Array.isArray(chartData.notes)) chartData.notes = [];
        const existing = chartData.notes.find((n) => n && n.target === id);
        if (!trimmed) {
          if (existing) {
            chartData.notes = chartData.notes.filter((n) => n !== existing);
            if (!chartData.notes.length) delete chartData.notes;
          }
        } else if (existing) {
          existing.text = trimmed;
        } else {
          chartData.notes.push({ id: newId('n'), text: trimmed, target: id });
        }
        render();
        updateStatus(true);
      },
      getPaletteSlots: () => {
        const ck = (chartData && chartData.colorKey) || {};
        const out = [];
        for (let i = 1; i <= 9; i++) {
          const slot = String(i);
          const sw = swatchColors(slot);
          const lbl = (ck[slot] && String(ck[slot]).trim()) || `Color ${slot}`;
          out.push({ slot, label: lbl, color: sw.solid || sw.border || sw.fill });
        }
        return out;
      },
      resolveColor: (slot) => {
        const sw = swatchColors(slot || '1');
        return sw.solid || sw.border || sw.fill;
      },
      toast: (msg) => ui.toast(msg),
      icon: (name, opts) => ui.iconEl(name, opts),
      chevron: (o) => ui.chevron(o)
    });
  }

  // --- REGISTER WITH THE SHELL ---
  registerDiagramPlugin({
    id: 'gantt',
    defaultTitle: 'Interactive Gantt Roadmap',
    customViewport: true,
    zoomController,
    contentEl: root || document.getElementById('stage'),
    report: {
      node: '.gantt-bar, .gantt-milestone',
      label: '.gantt-dep-group',
      labelText: '.gantt-dep-label',
      nodeText: '.gantt-ms-label'
    },
    render,
    applyLayout,
    toDisk,
    fromDisk,
    toMermaid,
    fromMermaid,
    exportSvg,
    hasSelection,
    clearSelection,
    deleteSelection,
    cancelInteraction,
    selectAll,
    isBackground: (el) => !el || el === root || el === timeline || el === bodyEl || el === gridEl || (el.classList && el.classList.contains('gantt-row-bg')),
    searchItems,
    getSearchItems: searchItems,
    focusSearchItem
  });
})();
