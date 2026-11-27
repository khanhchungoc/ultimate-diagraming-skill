// --- GANTT EXCEL-LIKE TABLE VIEW ---
// Plain browser IIFE (zero external dependencies, no ES module imports).
// Exposes window.GanttTable.create(hostEl, api) -> { render(), focusItem(id), destroy() }.
// Reuses ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays from engine.js
// and window.GanttDatePicker.open(anchorEl, opts).
(function () {
  'use strict';

  const MONTH_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  const TYPE_LABELS = {
    group: 'Group',
    task: 'Task',
    milestone: 'Milestone'
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function makeIcon(api, name, opts, fallbackText) {
    if (api && typeof api.icon === 'function') {
      try {
        const svg = api.icon(name, opts);
        if (svg) return svg;
      } catch (_) {
        // fall through to text fallback
      }
    }
    return el('span', '', fallbackText || '');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function expandTwoDigitYear(yy) {
    return yy >= 70 ? 1900 + yy : 2000 + yy;
  }

  function buildIsoIfValid(y, m, d) {
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (y < 100) y = expandTwoDigitYear(y);
    const iso = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
    return ganttFormatDate(iso) || null;
  }

  // Flexible date parser for Excel / Google Sheets paste.
  function parseFlexDate(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;

    // YYYY-MM-DD or YYYY/MM/DD (1- or 2-digit month/day)
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
    if (m) return buildIsoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));

    // M/D/YYYY, MM/DD/YYYY, M/D/YY, M-D-YYYY
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
    if (m) return buildIsoIfValid(Number(m[3]), Number(m[1]), Number(m[2]));

    // Mon DD, YYYY or Month DD YYYY
    m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+|\s+)(\d{2}|\d{4})$/.exec(s);
    if (m) {
      const mo = MONTH_MAP[m[1].toLowerCase()];
      if (mo) return buildIsoIfValid(Number(m[3]), mo, Number(m[2]));
    }

    // DD Mon YYYY or DD-Mon-YYYY or DD-Mon-YY
    m = /^(\d{1,2})[\s-]+([A-Za-z]+)\.?[\s-]+(\d{2}|\d{4})$/.exec(s);
    if (m) {
      const mo = MONTH_MAP[m[2].toLowerCase()];
      if (mo) return buildIsoIfValid(Number(m[3]), mo, Number(m[1]));
    }

    return null;
  }

  // Parse duration input like "14", "14d", "2w", "10 days", "2.5 weeks" -> positive integer days or null.
  function parseDurationDays(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const m = /^(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks)?$/i.exec(s);
    if (!m) return null;
    const num = Number(m[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    const unit = (m[2] || 'd').toLowerCase();
    const days = unit.startsWith('w') ? Math.round(num * 7) : Math.round(num);
    return Math.max(1, days);
  }

  function sanitizeTsvCell(val) {
    return String(val == null ? '' : val).replace(/[\t\r\n]+/g, ' ').trim();
  }

  // Parse TSV/plain clipboard text into rows of strings.
  function parseTsvRows(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = line.split('\t').map((c) => {
        const t = c.trim();
        if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
          return t.slice(1, -1).replace(/""/g, '"').trim();
        }
        return t;
      });
      rows.push(cells);
    }
    return rows;
  }

  // Check if adding edge fromId -> toId would create a cycle in deps.
  function wouldCreateCycle(deps, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return true;
    const adj = new Map();
    for (let i = 0; i < deps.length; i++) {
      const d = deps[i];
      if (!d || !d.from || !d.to) continue;
      let list = adj.get(d.from);
      if (!list) { list = []; adj.set(d.from, list); }
      list.push(d.to);
    }
    const visited = new Set([toId]);
    const queue = [toId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const nexts = adj.get(cur) || [];
      for (let i = 0; i < nexts.length; i++) {
        const nxt = nexts[i];
        if (nxt === fromId) return true;
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return false;
  }

  // Build ordered tree rows from raw items, respecting ONLY collapsed state (not timeline view filters).
  function buildTreeModel(allItems) {
    const items = Array.isArray(allItems) ? allItems : [];
    const byId = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.id && !byId.has(it.id)) byId.set(it.id, it);
    }

    // Resolve valid non-cyclic parents
    const validParent = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || !it.id) continue;
      const pid = it.parent;
      if (!pid || pid === it.id || !byId.has(pid)) {
        validParent.set(it.id, null);
        continue;
      }
      const seen = new Set([it.id]);
      let cur = pid;
      let cyclic = false;
      while (cur && byId.has(cur)) {
        if (seen.has(cur)) { cyclic = true; break; }
        seen.add(cur);
        cur = byId.get(cur).parent;
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

    const orderedAll = [];
    const visibleRows = [];
    const metaById = new Map();
    const rowNumById = new Map();
    const itemByRowNum = new Map();

    function visit(it, depth, ancestorCollapsed) {
      const kids = childrenByParent.get(it.id) || [];
      const hasChildren = kids.length > 0;
      const rowNum = orderedAll.length + 1;
      const meta = {
        item: it,
        depth,
        hasChildren,
        hidden: Boolean(ancestorCollapsed),
        rowNum,
        start: null,
        end: null,
        children: kids
      };
      orderedAll.push(meta);
      metaById.set(it.id, meta);
      rowNumById.set(it.id, rowNum);
      itemByRowNum.set(rowNum, it);
      if (!ancestorCollapsed) visibleRows.push(meta);

      const childHidden = ancestorCollapsed || Boolean(it.collapsed);
      let minStart = null;
      let maxEnd = null;
      for (let i = 0; i < kids.length; i++) {
        const childMeta = visit(kids[i], depth + 1, childHidden);
        if (childMeta.start && (!minStart || childMeta.start < minStart)) minStart = childMeta.start;
        if (childMeta.end && (!maxEnd || childMeta.end > maxEnd)) maxEnd = childMeta.end;
      }

      if (hasChildren && minStart && maxEnd) {
        meta.start = minStart;
        meta.end = maxEnd;
      } else {
        const s = ganttFormatDate(it.start);
        const e = ganttFormatDate(it.end);
        if (it.kind === 'milestone') {
          const d = s || e || null;
          meta.start = d;
          meta.end = d;
        } else if (s && e) {
          meta.start = s;
          meta.end = e < s ? s : e;
        } else if (s) {
          meta.start = s;
          meta.end = s;
        } else if (e) {
          meta.start = e;
          meta.end = e;
        } else {
          meta.start = null;
          meta.end = null;
        }
      }
      return meta;
    }

    for (let i = 0; i < roots.length; i++) {
      visit(roots[i], 0, false);
    }

    return {
      orderedAll,
      visibleRows,
      byId,
      metaById,
      rowNumById,
      itemByRowNum,
      childrenByParent,
      validParent
    };
  }

  function isDescendant(validParentMap, candidateId, ancestorId) {
    let cur = candidateId;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === ancestorId) return true;
      seen.add(cur);
      cur = validParentMap.get(cur) || null;
    }
    return false;
  }

  function create(hostEl, api) {
    if (!hostEl) throw new Error('GanttTable.create requires hostEl');

    let destroyed = false;
    let markersOpen = true;
    let lastTree = buildTreeModel([]);
    let activeCellCoord = { itemId: null, colIdx: 1 };
    let lastAnchorIdx = -1;
    let cellClipboard = null; // { col, value, text }
    let depPopState = null; // { el, itemId, anchorEl, onDocDown, onDocKey }
    let catPopState = null; // { el, anchorEl, onDocDown, onDocKey }
    let stickyTargetId = null;
    let stickyRafId = 0;
    const rowRecs = new Map();   // itemId -> { tr, shape } (keyed sheet rows, reused across renders)
    let metaById = new Map();    // itemId -> visible row meta of the last render (delegated events read it)

    // --- Build static shell inside hostEl ---
    hostEl.textContent = '';
    hostEl.classList.add('gt-view');

    // 1. Sticky parent breadcrumb bar (shown when scrolling inside a parent phase/group)
    const stickyPhaseEl = el('button', 'gt-sticky-phase');
    stickyPhaseEl.id = 'gt-sticky-phase';
    stickyPhaseEl.type = 'button';
    stickyPhaseEl.hidden = true;
    stickyPhaseEl.setAttribute('aria-label', 'Jump to parent phase');
    hostEl.appendChild(stickyPhaseEl);

    // 2. Scrollable wrapper with main table + collapsible milestones section
    const scrollEl = el('div', 'gt-scroll');

    const table = el('table', 'gantt-sheet');
    table.id = 'gantt-sheet';
    table.setAttribute('role', 'treegrid');
    table.setAttribute('aria-label', 'Roadmap data table');

    const thead = el('thead');
    const headRow = el('tr');

    const colDefs = [
      { key: 'num',   cls: 'gt-col-num',   label: '#' },
      { key: 'task',  cls: 'gt-col-task',  label: 'Task' },
      { key: 'type',  cls: 'gt-col-type',  label: 'Type' },
      { key: 'start', cls: 'gt-col-start', label: 'Start' },
      { key: 'end',   cls: 'gt-col-end',   label: 'End' },
      { key: 'dur',   cls: 'gt-col-dur',   label: 'Duration' },
      { key: 'dep',   cls: 'gt-col-dep',   label: 'Depends on' },
      { key: 'cat',   cls: 'gt-col-cat',   label: 'Category' },
      { key: 'note',  cls: 'gt-col-note',  label: 'Notes' }
    ];
    let thNum = null;
    for (let i = 0; i < colDefs.length; i++) {
      const th = el('th', colDefs[i].cls, colDefs[i].label);
      th.setAttribute('scope', 'col');
      th.setAttribute('data-col', colDefs[i].key);
      if (colDefs[i].key === 'num') {
        thNum = th;
        th.title = 'Click to select or deselect all rows';
        th.setAttribute('role', 'button');
        th.setAttribute('aria-label', 'Select all rows');
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    table.appendChild(tbody);

    const tfoot = el('tfoot');
    const addRow = el('tr');
    addRow.id = 'gantt-sheet-add-row';
    const addTd = el('td');
    addTd.colSpan = 9;
    const quickAddInput = el('input');
    quickAddInput.id = 'gantt-sheet-quick-add';
    quickAddInput.type = 'text';
    quickAddInput.placeholder = 'Type a new task and press Enter...';
    quickAddInput.setAttribute('aria-label', 'Add new task');
    addTd.appendChild(quickAddInput);
    addRow.appendChild(addTd);
    tfoot.appendChild(addRow);
    table.appendChild(tfoot);

    scrollEl.appendChild(table);

    // 3. Collapsible Milestones section (#gantt-markers-section)
    const markersSection = el('section', 'is-open');
    markersSection.id = 'gantt-markers-section';
    markersSection.setAttribute('aria-label', 'Milestones');

    const markersHead = el('div', 'gt-markers-head');
    const btnMarkersToggle = el('button');
    btnMarkersToggle.type = 'button';
    btnMarkersToggle.id = 'btn-markers-toggle';
    btnMarkersToggle.setAttribute('aria-expanded', 'true');
    btnMarkersToggle.appendChild(makeIcon(api, 'chevron-down', { size: 13 }, '▾'));
    const markersToggleText = el('span', '', 'Milestones (0)');
    btnMarkersToggle.appendChild(markersToggleText);

    const btnAddMarkerRow = el('button', 'gt-btn');
    btnAddMarkerRow.type = 'button';
    btnAddMarkerRow.id = 'btn-add-marker-row';
    btnAddMarkerRow.appendChild(makeIcon(api, 'plus', { size: 13 }, '+'));
    btnAddMarkerRow.appendChild(el('span', '', 'Add milestone'));

    markersHead.appendChild(btnMarkersToggle);
    markersHead.appendChild(btnAddMarkerRow);
    markersSection.appendChild(markersHead);

    const markersBody = el('div', 'gt-markers-body');
    const markersTable = el('table', 'gantt-markers-table');
    markersTable.id = 'gantt-markers-table';
    const mThead = el('thead');
    const mHeadTr = el('tr');
    const mCols = [
      { cls: '', label: 'Label' },
      { cls: 'gt-marker-col-date', label: 'Date' },
      { cls: 'gt-marker-col-cat', label: 'Category' },
      { cls: 'gt-marker-col-del', label: '' }
    ];
    for (let i = 0; i < mCols.length; i++) {
      const th = el('th', mCols[i].cls, mCols[i].label);
      th.setAttribute('scope', 'col');
      mHeadTr.appendChild(th);
    }
    mThead.appendChild(mHeadTr);
    markersTable.appendChild(mThead);
    const markersTbody = el('tbody');
    markersTable.appendChild(markersTbody);
    markersBody.appendChild(markersTable);
    markersSection.appendChild(markersBody);

    scrollEl.appendChild(markersSection);
    hostEl.appendChild(scrollEl);

    // 4. Floating Bulk Action Bar (#gantt-table-bulkbar)
    const bulkBar = el('div');
    bulkBar.id = 'gantt-table-bulkbar';
    bulkBar.setAttribute('role', 'toolbar');
    bulkBar.setAttribute('aria-label', 'Bulk actions');
    bulkBar.hidden = true;

    function makeIndentSvg(isOutdent) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const lines = isOutdent
        ? [
            ['line', { x1: '21', y1: '6', x2: '11', y2: '6' }],
            ['line', { x1: '21', y1: '12', x2: '11', y2: '12' }],
            ['line', { x1: '21', y1: '18', x2: '11', y2: '18' }],
            ['polyline', { points: '7 8 3 12 7 16' }]
          ]
        : [
            ['line', { x1: '21', y1: '6', x2: '11', y2: '6' }],
            ['line', { x1: '21', y1: '12', x2: '11', y2: '12' }],
            ['line', { x1: '21', y1: '18', x2: '11', y2: '18' }],
            ['polyline', { points: '3 8 7 12 3 16' }]
          ];
      for (let i = 0; i < lines.length; i++) {
        const node = document.createElementNS(NS, lines[i][0]);
        const attrs = lines[i][1];
        Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
        svg.appendChild(node);
      }
      return svg;
    }

    const bulkCountEl = el('span', 'gt-bulk-count', '0 selected');

    const bulkCatBtn = el('button', 'gt-cat-btn gt-bulk-cat-btn');
    bulkCatBtn.type = 'button';
    bulkCatBtn.setAttribute('aria-label', 'Set category for selected rows');
    bulkCatBtn.setAttribute('aria-haspopup', 'listbox');
    bulkCatBtn.appendChild(el('span', 'gt-cat-label', 'Category...'));
    bulkCatBtn.appendChild(makeIcon(api, 'chevron-down', { size: 12 }, '▾'));

    const btnBulkIndent = el('button', 'gt-btn gt-btn-icon');
    btnBulkIndent.type = 'button';
    btnBulkIndent.title = 'Indent (Tab)';
    btnBulkIndent.setAttribute('aria-label', 'Indent');
    btnBulkIndent.appendChild(makeIndentSvg(false));

    const btnBulkOutdent = el('button', 'gt-btn gt-btn-icon');
    btnBulkOutdent.type = 'button';
    btnBulkOutdent.title = 'Outdent (Shift+Tab)';
    btnBulkOutdent.setAttribute('aria-label', 'Outdent');
    btnBulkOutdent.appendChild(makeIndentSvg(true));

    const btnBulkCopy = el('button', 'gt-btn', 'Copy');
    btnBulkCopy.type = 'button';
    const btnBulkDelete = el('button', 'gt-btn gt-btn-danger', 'Delete');
    btnBulkDelete.type = 'button';
    const btnBulkClear = el('button', 'gt-btn gt-btn-ghost', 'Clear');
    btnBulkClear.type = 'button';

    bulkBar.appendChild(bulkCountEl);
    bulkBar.appendChild(el('span', 'gt-bulk-sep'));
    bulkBar.appendChild(bulkCatBtn);
    bulkBar.appendChild(el('span', 'gt-bulk-sep'));
    bulkBar.appendChild(btnBulkIndent);
    bulkBar.appendChild(btnBulkOutdent);
    bulkBar.appendChild(btnBulkCopy);
    bulkBar.appendChild(btnBulkDelete);
    bulkBar.appendChild(btnBulkClear);

    hostEl.appendChild(bulkBar);

    function makeTypeSvg(kind) {
      if (kind === 'milestone') {
        return makeIcon(api, 'flag', { size: 15 }, '⚑');
      }
      return makeIcon(api, 'clipboard', { size: 15 }, 'T');
    }

    function effectiveCat(itemId, tree) {
      let curId = itemId;
      const seen = new Set();
      while (curId && !seen.has(curId)) {
        seen.add(curId);
        const it = tree.byId.get(curId);
        if (it && it.color) return String(it.color);
        curId = tree.validParent.get(curId) || null;
      }
      return '';
    }

    function collectDescendants(itemId, tree) {
      const out = [];
      function walk(pid) {
        const m = tree.metaById.get(pid);
        if (!m || !m.children.length) return;
        for (let i = 0; i < m.children.length; i++) {
          const ch = m.children[i];
          out.push(ch);
          walk(ch.id);
        }
      }
      walk(itemId);
      return out;
    }

    function applyCategoryWithSync(item, nextVal, tree) {
      const val = nextVal ? String(nextVal) : '';
      const descendants = collectDescendants(item.id, tree);

      // Downward: if all subtasks currently share the same effective category, update them together
      if (descendants.length > 0) {
        const distinct = new Set();
        for (let i = 0; i < descendants.length; i++) {
          distinct.add(effectiveCat(descendants[i].id, tree));
        }
        if (distinct.size <= 1) {
          for (let i = 0; i < descendants.length; i++) {
            if (val) descendants[i].color = val;
            else delete descendants[i].color;
          }
        }
      }

      if (val) item.color = val;
      else delete item.color;

      // Upward: if all siblings under parent now share the same category, update parent too
      let pid = tree.validParent.get(item.id) || null;
      while (pid) {
        const pMeta = tree.metaById.get(pid);
        if (!pMeta || !pMeta.children.length) break;
        let allSame = true;
        for (let i = 0; i < pMeta.children.length; i++) {
          const ch = pMeta.children[i];
          const chCat = ch.color ? String(ch.color) : effectiveCat(ch.id, tree);
          if (chCat !== val) {
            allSame = false;
            break;
          }
        }
        if (!allSame) break;
        if (val) pMeta.item.color = val;
        else delete pMeta.item.color;
        pid = tree.validParent.get(pid) || null;
      }
    }

    function clearDepRowHighlights() {
      const rows = tbody.querySelectorAll('tr.is-dep-self, tr.is-dep-pred, tr.is-dep-succ');
      for (let i = 0; i < rows.length; i++) {
        rows[i].classList.remove('is-dep-self', 'is-dep-pred', 'is-dep-succ');
      }
    }

    function highlightDepRows(itemId) {
      clearDepRowHighlights();
      if (!itemId) return;
      const deps = api.getDeps() || [];
      const preds = new Set();
      const succs = new Set();
      for (let i = 0; i < deps.length; i++) {
        const d = deps[i];
        if (!d) continue;
        if (d.to === itemId && d.from) preds.add(d.from);
        if (d.from === itemId && d.to) succs.add(d.to);
      }
      if (preds.size === 0 && succs.size === 0) return;
      const rows = tbody.querySelectorAll('tr[data-item-id]');
      for (let i = 0; i < rows.length; i++) {
        const id = rows[i].getAttribute('data-item-id');
        if (id === itemId) rows[i].classList.add('is-dep-self');
        if (preds.has(id)) rows[i].classList.add('is-dep-pred');
        if (succs.has(id)) rows[i].classList.add('is-dep-succ');
      }
    }

    // --- Helper functions ---
    function getDepsForItem(itemId) {
      const deps = api.getDeps() || [];
      const out = [];
      for (let i = 0; i < deps.length; i++) {
        const d = deps[i];
        if (d && d.to === itemId) out.push(d);
      }
      return out;
    }

    function formatDepShorthand(itemId, rowNumById, incomingDeps) {
      const incoming = incomingDeps || getDepsForItem(itemId);
      const parts = [];
      const seen = new Set();
      for (let i = 0; i < incoming.length; i++) {
        const d = incoming[i];
        const num = rowNumById.get(d.from);
        if (num && !seen.has(num)) {
          seen.add(num);
          parts.push(String(num));
        }
      }
      return parts.join(', ');
    }

    function getActiveCategories() {
      if (typeof api.getCategories === 'function') {
        return api.getCategories() || [];
      }
      const ck = (api.getColorKey && api.getColorKey()) || {};
      const used = new Set();
      Object.keys(ck).forEach((k) => {
        if (ck[k] && String(ck[k]).trim()) used.add(String(k));
      });
      (api.getAllItems() || []).forEach((it) => {
        if (it && it.color) used.add(String(it.color));
      });
      (api.getMarkers() || []).forEach((mk) => {
        if (mk && mk.color) used.add(String(mk.color));
      });
      const allSlots = api.getPaletteSlots() || [];
      const out = [];
      const seen = new Set();
      for (let i = 0; i < allSlots.length; i++) {
        const s = allSlots[i];
        const slotStr = String(s.slot);
        if (used.has(slotStr)) {
          out.push({ slot: slotStr, label: s.label || `Color ${slotStr}`, color: s.color || api.resolveColor(slotStr) });
          seen.add(slotStr);
        }
      }
      used.forEach((u) => {
        if (!seen.has(u)) {
          out.push({ slot: u, label: String(ck[u] || u), color: api.resolveColor(u) });
        }
      });
      return out;
    }

    function addCategoryByName(name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return null;
      if (typeof api.addCategory === 'function') {
        return api.addCategory(trimmed);
      }
      const existing = getActiveCategories();
      const lower = trimmed.toLowerCase();
      for (let i = 0; i < existing.length; i++) {
        if (existing[i].label && existing[i].label.toLowerCase() === lower) {
          return existing[i];
        }
      }
      const data = api.getData();
      if (!data.colorKey || typeof data.colorKey !== 'object') data.colorKey = {};
      const usedSlots = new Set(existing.map((c) => String(c.slot)));
      let chosen = null;
      for (let i = 1; i <= 9; i++) {
        if (!usedSlots.has(String(i))) { chosen = String(i); break; }
      }
      if (!chosen) chosen = String((existing.length % 9) + 1);
      data.colorKey[chosen] = trimmed;
      return { slot: chosen, label: trimmed, color: api.resolveColor(chosen) };
    }

    function nextCycledSlotColor() {
      const existing = getActiveCategories();
      const usedSlots = new Set(existing.map((c) => String(c.slot)));
      let chosen = null;
      for (let i = 1; i <= 9; i++) {
        if (!usedSlots.has(String(i))) { chosen = String(i); break; }
      }
      if (!chosen) chosen = String((existing.length % 9) + 1);
      return api.resolveColor(chosen);
    }

    function formatCategoryLabel(slotVal) {
      if (!slotVal) return '';
      const active = getActiveCategories();
      for (let i = 0; i < active.length; i++) {
        if (String(active[i].slot) === String(slotVal)) {
          return active[i].label || `Color ${active[i].slot}`;
        }
      }
      const slots = api.getPaletteSlots() || [];
      for (let i = 0; i < slots.length; i++) {
        if (String(slots[i].slot) === String(slotVal)) {
          return slots[i].label || `Color ${slots[i].slot}`;
        }
      }
      return String(slotVal);
    }

    function positionPopoverNear(pop, anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + popRect.width > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - popRect.width - 12);
      }
      if (top + popRect.height > window.innerHeight - 12) {
        top = Math.max(12, rect.top - popRect.height - 4);
      }
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }

    function closeCatPopover(restoreFocus = false) {
      if (!catPopState) return;
      const anchorEl = catPopState.anchorEl;
      document.removeEventListener('pointerdown', catPopState.onDocDown, true);
      document.removeEventListener('keydown', catPopState.onDocKey, true);
      if (catPopState.el && catPopState.el.parentNode) {
        catPopState.el.parentNode.removeChild(catPopState.el);
      }
      catPopState = null;
      if (restoreFocus && anchorEl && typeof anchorEl.focus === 'function' && anchorEl.isConnected) {
        anchorEl.focus({ preventScroll: true });
      }
    }

    function closeDepPopover(restoreFocus = false) {
      if (!depPopState) return;
      const anchorEl = depPopState.anchorEl;
      document.removeEventListener('pointerdown', depPopState.onDocDown, true);
      document.removeEventListener('keydown', depPopState.onDocKey, true);
      if (depPopState.el && depPopState.el.parentNode) {
        depPopState.el.parentNode.removeChild(depPopState.el);
      }
      depPopState = null;
      if (restoreFocus && anchorEl && typeof anchorEl.focus === 'function' && anchorEl.isConnected) {
        anchorEl.focus({ preventScroll: true });
      }
    }

    function openDatePicker(anchorEl, opts) {
      if (api.isPresenting()) return;
      closeCatPopover();
      closeDepPopover();
      if (window.GanttDatePicker && typeof window.GanttDatePicker.open === 'function') {
        window.GanttDatePicker.open(anchorEl, opts);
      }
    }

    function openCategoryPopover(anchorEl, currentVal, onSelect) {
      if (api.isPresenting()) return;
      closeCatPopover();
      closeDepPopover();

      const pop = el('div', 'gt-cat-pop');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Select category');

      const input = el('input', 'gt-cat-input');
      input.type = 'text';
      input.placeholder = 'Search or add category...';
      input.setAttribute('aria-label', 'Search or add category');
      pop.appendChild(input);

      const listEl = el('div', 'gt-cat-list');
      listEl.setAttribute('role', 'listbox');
      pop.appendChild(listEl);

      let options = [];
      let activeIdx = 0;

      function pickOption(opt) {
        if (!opt) return;
        let nextSlot = opt.value;
        if (opt.isAdd) {
          const created = addCategoryByName(opt.addName);
          if (!created) return;
          nextSlot = String(created.slot);
        }
        closeCatPopover(true);
        if (typeof onSelect === 'function') onSelect(nextSlot);
      }

      function syncActiveHighlight() {
        const btns = listEl.querySelectorAll('.gt-cat-item');
        for (let i = 0; i < btns.length; i++) {
          const active = i === activeIdx;
          btns[i].classList.toggle('is-active', active);
          btns[i].setAttribute('aria-selected', active ? 'true' : 'false');
          if (active) btns[i].scrollIntoView({ block: 'nearest' });
        }
      }

      function renderList() {
        listEl.textContent = '';
        const query = input.value.trim();
        const lower = query.toLowerCase();
        const cats = getActiveCategories();
        options = [];

        if (!lower || 'none'.includes(lower)) {
          options.push({
            value: '',
            label: 'None',
            color: null,
            isNone: true,
            selected: !currentVal
          });
        }

        let exactMatch = false;
        for (let i = 0; i < cats.length; i++) {
          const c = cats[i];
          const lbl = c.label || `Color ${c.slot}`;
          if (lbl.toLowerCase() === lower) exactMatch = true;
          if (!lower || lbl.toLowerCase().includes(lower) || String(c.slot).toLowerCase() === lower) {
            options.push({
              value: String(c.slot),
              label: lbl,
              color: c.color || api.resolveColor(c.slot),
              selected: String(c.slot) === String(currentVal)
            });
          }
        }

        if (query && !exactMatch && lower !== 'none') {
          options.push({
            value: '__add__',
            isAdd: true,
            addName: query,
            label: `+ Add "${query}"`,
            color: nextCycledSlotColor(),
            selected: false
          });
        }

        if (options.length === 0) {
          listEl.appendChild(el('div', 'gt-cat-empty', 'No matching categories'));
          activeIdx = -1;
          return;
        }

        activeIdx = Math.max(0, Math.min(activeIdx, options.length - 1));
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          const btn = el('button', 'gt-cat-item' + (opt.isAdd ? ' is-add' : '') + (opt.selected ? ' is-selected' : ''));
          btn.type = 'button';
          btn.setAttribute('role', 'option');

          const dot = el('span', 'gt-cat-dot' + (opt.isNone ? ' is-none' : ''));
          if (opt.color) dot.style.background = opt.color;
          btn.appendChild(dot);

          const lbl = el('span', 'gt-cat-item-label', opt.label);
          btn.appendChild(lbl);

          if (opt.selected) {
            const chk = el('span', 'gt-cat-check');
            chk.appendChild(makeIcon(api, 'check', { size: 13 }, '✓'));
            btn.appendChild(chk);
          }

          btn.addEventListener('pointerenter', () => {
            activeIdx = i;
            syncActiveHighlight();
          });
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pickOption(opt);
          });
          listEl.appendChild(btn);
        }
        syncActiveHighlight();
      }

      input.addEventListener('input', () => {
        activeIdx = 0;
        renderList();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (options.length > 0) {
            activeIdx = (activeIdx + 1) % options.length;
            syncActiveHighlight();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (options.length > 0) {
            activeIdx = (activeIdx - 1 + options.length) % options.length;
            syncActiveHighlight();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (options.length > 0) {
            pickOption(options[activeIdx >= 0 ? activeIdx : 0]);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeCatPopover(true);
        }
      });

      renderList();
      document.body.appendChild(pop);
      positionPopoverNear(pop, anchorEl);

      const onDocDown = (e) => {
        if (!pop.contains(e.target) && !anchorEl.contains(e.target)) {
          closeCatPopover();
        }
      };
      const onDocKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeCatPopover(true);
        }
      };
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onDocKey, true);

      catPopState = { el: pop, anchorEl, onDocDown, onDocKey };
      input.focus();
    }

    function isDepShorthandQuery(raw) {
      return /^#?\d+(\s*(FS|SS))?([\s,;]+#?\d+(\s*(FS|SS))?)*$/i.test(raw);
    }

    function applyDepShorthandForItem(item, raw) {
      const data = api.getData();
      const curDeps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
      const baseDeps = curDeps.filter((d) => !(d && d.to === item.id));

      const trimmed = String(raw || '').trim();
      if (!trimmed || trimmed === '-') {
        data.dependencies = baseDeps;
        api.commit('dep');
        return true;
      }

      const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
      const parsed = [];
      const seenFrom = new Set();

      for (let i = 0; i < tokens.length; i++) {
        const m = /^#?(\d+)\s*(FS|SS)?$/i.exec(tokens[i]);
        if (!m) {
          api.toast(`Invalid dependency "${tokens[i]}" (use row numbers, e.g. 2, 5)`);
          return false;
        }
        const num = Number(m[1]);
        const target = lastTree.itemByRowNum.get(num);
        if (!target) {
          api.toast(`Row #${num} not found`);
          return false;
        }
        if (target.id === item.id) {
          api.toast('Task cannot depend on itself');
          return false;
        }
        if (seenFrom.has(target.id)) continue;
        const testDeps = baseDeps.concat(parsed);
        if (wouldCreateCycle(testDeps, target.id, item.id)) {
          api.toast('Circular dependency prevented');
          return false;
        }
        seenFrom.add(target.id);
        parsed.push({ from: target.id, to: item.id, type: 'fs' });
      }

      data.dependencies = baseDeps.concat(parsed);
      api.commit('dep');
      return true;
    }

    function openDepPopover(anchorEl, item) {
      if (api.isPresenting()) return;
      closeDepPopover();
      closeCatPopover();

      const pop = el('div', 'gt-dep-pop');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', `Dependencies for ${item.label || 'task'}`);

      const head = el('div', 'gt-dep-pop-head');
      head.appendChild(el('span', 'gt-dep-pop-title', `Depends on - ${item.label || 'Task'}`));
      const closeBtn = el('button', 'gt-btn gt-btn-ghost');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.appendChild(makeIcon(api, 'close', { size: 12 }, '×'));
      closeBtn.addEventListener('click', () => closeDepPopover(true));
      head.appendChild(closeBtn);
      pop.appendChild(head);

      const inputRow = el('div', 'gt-dep-input-row');
      const input = el('input', 'gt-dep-input');
      input.type = 'text';
      input.placeholder = 'Search tasks or enter row # (e.g. 2, 5)...';
      input.setAttribute('aria-label', 'Search predecessor tasks or enter row numbers');
      const applyBtn = el('button', 'gt-btn gt-btn-primary', 'Apply');
      applyBtn.type = 'button';
      inputRow.appendChild(input);
      inputRow.appendChild(applyBtn);
      pop.appendChild(inputRow);

      const listEl = el('div', 'gt-dep-list');
      pop.appendChild(listEl);

      let filteredRows = [];
      let activeIdx = 0;

      function toggleCandidate(other) {
        const data = api.getData();
        const curDeps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
        const hasDep = curDeps.some((d) => d && d.from === other.id && d.to === item.id);
        if (!hasDep) {
          if (wouldCreateCycle(curDeps, other.id, item.id)) {
            api.toast('Circular dependency prevented');
            return;
          }
          data.dependencies = curDeps.filter((d) => !(d && d.from === other.id && d.to === item.id));
          data.dependencies.push({ from: other.id, to: item.id, type: 'fs' });
        } else {
          data.dependencies = curDeps.filter((d) => !(d && d.from === other.id && d.to === item.id));
        }
        api.commit('dep');
        renderChecklist();
      }

      function syncDepActiveHighlight() {
        const rows = listEl.querySelectorAll('.gt-dep-item');
        for (let i = 0; i < rows.length; i++) {
          const active = i === activeIdx;
          rows[i].classList.toggle('is-active', active);
          if (active) rows[i].scrollIntoView({ block: 'nearest' });
        }
      }

      function renderChecklist() {
        listEl.textContent = '';
        const data = api.getData();
        const deps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
        const incomingByFrom = new Map();
        for (let i = 0; i < deps.length; i++) {
          const d = deps[i];
          if (d && d.to === item.id) incomingByFrom.set(d.from, d);
        }

        const query = input.value.trim();
        const lower = query.toLowerCase();
        const numTokens = isDepShorthandQuery(query)
          ? new Set(query.split(/[\s,;]+/).map((t) => t.replace(/^#/, '').replace(/(FS|SS)$/i, '')).filter(Boolean))
          : null;

        const allCandidates = lastTree.orderedAll.filter((m) => m.item.id !== item.id && !m.hasChildren);
        filteredRows = allCandidates.filter((cand) => {
          if (!lower) return true;
          const lbl = (cand.item.label || 'Untitled').toLowerCase();
          const numStr = String(cand.rowNum);
          if (numTokens) return numTokens.has(numStr) || numStr.includes(lower.replace(/^#/, ''));
          return lbl.includes(lower) || numStr.includes(lower.replace(/^#/, '')) || `#${numStr}`.includes(lower);
        });

        if (allCandidates.length === 0) {
          listEl.appendChild(el('div', 'gt-dep-empty', 'No other tasks or milestones'));
          activeIdx = -1;
          return;
        }
        if (filteredRows.length === 0) {
          listEl.appendChild(el('div', 'gt-dep-empty', 'No matching tasks'));
          activeIdx = -1;
          return;
        }

        activeIdx = Math.max(0, Math.min(activeIdx, filteredRows.length - 1));

        for (let i = 0; i < filteredRows.length; i++) {
          const cand = filteredRows[i];
          const other = cand.item;
          const existing = incomingByFrom.get(other.id) || null;

          const row = el('div', 'gt-dep-item');
          const cb = el('input', 'gt-checkbox');
          cb.type = 'checkbox';
          cb.checked = Boolean(existing);
          cb.setAttribute('aria-label', `#${cand.rowNum} ${other.label || 'Untitled'}`);

          const numSpan = el('span', 'gt-dep-item-num', `#${cand.rowNum}`);
          const lblSpan = el('span', 'gt-dep-item-label', other.label || 'Untitled');
          lblSpan.title = other.label || 'Untitled';

          cb.addEventListener('change', () => toggleCandidate(other));
          row.addEventListener('pointerenter', () => {
            activeIdx = i;
            syncDepActiveHighlight();
          });
          row.addEventListener('click', (e) => {
            if (e.target === cb) return;
            toggleCandidate(other);
          });

          row.appendChild(cb);
          row.appendChild(numSpan);
          row.appendChild(lblSpan);
          listEl.appendChild(row);
        }
        syncDepActiveHighlight();
      }

      function handleSubmit() {
        const raw = input.value.trim();
        if (!raw) {
          closeDepPopover(true);
          return;
        }
        if (isDepShorthandQuery(raw)) {
          if (applyDepShorthandForItem(item, raw)) closeDepPopover(true);
          return;
        }
        if (filteredRows.length > 0) {
          const targetCand = filteredRows[activeIdx >= 0 ? activeIdx : 0];
          if (targetCand) toggleCandidate(targetCand.item);
        }
      }

      input.addEventListener('input', () => {
        activeIdx = 0;
        renderChecklist();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (filteredRows.length > 0) {
            activeIdx = (activeIdx + 1) % filteredRows.length;
            syncDepActiveHighlight();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (filteredRows.length > 0) {
            activeIdx = (activeIdx - 1 + filteredRows.length) % filteredRows.length;
            syncDepActiveHighlight();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDepPopover(true);
        }
      });
      applyBtn.addEventListener('click', handleSubmit);

      renderChecklist();
      document.body.appendChild(pop);
      positionPopoverNear(pop, anchorEl);

      const onDocDown = (e) => {
        if (!pop.contains(e.target) && !anchorEl.contains(e.target)) {
          closeDepPopover();
        }
      };
      const onDocKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDepPopover(true);
        }
      };
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onDocKey, true);

      depPopState = { el: pop, itemId: item.id, anchorEl, onDocDown, onDocKey };
      input.focus();
    }

    // --- Indent / Outdent helpers ---
    function indentItem(itemId, commitAfter) {
      if (api.isPresenting()) return false;
      const tree = buildTreeModel(api.getAllItems());
      const idx = tree.visibleRows.findIndex((m) => m.item.id === itemId);
      if (idx <= 0) return false;
      const cur = tree.visibleRows[idx].item;
      const prev = tree.visibleRows[idx - 1].item;
      if (!prev || prev.kind === 'milestone') return false;
      if (cur.parent === prev.id) return false;
      if (isDescendant(tree.validParent, prev.id, cur.id)) return false;

      cur.parent = prev.id;
      if (prev.kind !== 'group') prev.kind = 'group';
      prev.collapsed = false;
      if (commitAfter) api.commit('indent');
      return true;
    }

    function outdentItem(itemId, commitAfter) {
      if (api.isPresenting()) return false;
      const tree = buildTreeModel(api.getAllItems());
      const cur = tree.byId.get(itemId);
      if (!cur || !cur.parent) return false;
      const parentItem = tree.byId.get(cur.parent);
      const grandParentId = parentItem && parentItem.parent ? parentItem.parent : null;
      if (grandParentId) {
        cur.parent = grandParentId;
      } else {
        delete cur.parent;
      }
      if (commitAfter) api.commit('outdent');
      return true;
    }

    // --- Inline editors ---
    function startInlineTextEdit(cellEl, initialVal, opts) {
      if (api.isPresenting()) return;
      if (cellEl.querySelector('.gt-inline-input')) return;

      const input = el('input', 'gt-inline-input' + (opts && opts.isNum ? ' is-num' : ''));
      input.type = 'text';
      const hasSeed = Boolean(opts && opts.seedKey);
      input.value = hasSeed ? opts.seedKey : (initialVal || '');
      if (opts && opts.placeholder) input.placeholder = opts.placeholder;

      const targetChild = (opts && opts.replaceTarget) || cellEl;
      const prevDisplay = targetChild.style.display;
      targetChild.style.display = 'none';
      targetChild.parentNode.insertBefore(input, targetChild.nextSibling);

      let done = false;
      function finish(save) {
        if (done) return;
        done = true;
        const val = input.value;
        if (input.parentNode) input.parentNode.removeChild(input);
        targetChild.style.display = prevDisplay;
        if (save && opts && typeof opts.onSave === 'function') {
          opts.onSave(val);
        }
        if (cellEl.isConnected) {
          cellEl.focus({ preventScroll: true });
        }
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));

      input.focus();
      if (hasSeed) {
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (_) { /* ignore */ }
      } else {
        input.select();
      }
    }

    // --- Copy / Paste for Excel & Single Cells ---
    function buildTsvForRows(rowMetas) {
      const header = ['Task', 'Type', 'Start', 'End', 'Duration', 'Depends on', 'Category', 'Notes'].join('\t');
      const lines = [header];
      for (let i = 0; i < rowMetas.length; i++) {
        const meta = rowMetas[i];
        const it = meta.item;
        const indent = meta.depth > 0 ? '  '.repeat(meta.depth) : '';
        const typeStr = TYPE_LABELS[it.kind] || 'Task';
        const startStr = meta.hasChildren ? (meta.start || '') : (ganttFormatDate(it.start) || '');
        const endStr = it.kind === 'milestone'
          ? ''
          : (meta.hasChildren ? (meta.end || '') : (ganttFormatDate(it.end) || ''));
        let durStr = '';
        if (it.kind === 'milestone') {
          durStr = '-';
        } else if (meta.start && meta.end) {
          const days = Math.max(0, ganttDiffDays(meta.start, meta.end) + 1);
          durStr = days > 0 ? `${days}d` : '-';
        }
        const depStr = formatDepShorthand(it.id, lastTree.rowNumById);
        const catStr = formatCategoryLabel(it.color);
        const noteObj = api.getNoteForItem(it.id);
        const noteStr = noteObj && noteObj.text ? noteObj.text : '';

        lines.push([
          sanitizeTsvCell(indent + (it.label || '')),
          sanitizeTsvCell(typeStr),
          sanitizeTsvCell(startStr),
          sanitizeTsvCell(endStr),
          sanitizeTsvCell(durStr),
          sanitizeTsvCell(depStr),
          sanitizeTsvCell(catStr),
          sanitizeTsvCell(noteStr)
        ].join('\t'));
      }
      return lines.join('\n');
    }

    function copyTextToClipboard(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      }
      fallbackCopy(text);
      return Promise.resolve();
    }

    function fallbackCopy(text) {
      const ta = el('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      document.body.removeChild(ta);
    }

    function copyRows(rowMetas) {
      if (!rowMetas || rowMetas.length === 0) {
        api.toast('No rows to copy');
        return;
      }
      cellClipboard = null;
      const tsv = buildTsvForRows(rowMetas);
      copyTextToClipboard(tsv);
      api.toast(`Copied ${rowMetas.length} ${rowMetas.length === 1 ? 'row' : 'rows'} for Excel`);
    }

    function resolveCategoryFromText(raw) {
      const s = String(raw || '').trim();
      if (!s || s === '-' || /^none$/i.test(s)) return undefined;
      if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
      const lower = s.toLowerCase();
      const active = getActiveCategories();
      for (let i = 0; i < active.length; i++) {
        if (String(active[i].slot) === s) return String(active[i].slot);
        if (active[i].label && active[i].label.toLowerCase() === lower) return String(active[i].slot);
      }
      const slots = api.getPaletteSlots() || [];
      for (let i = 0; i < slots.length; i++) {
        if (String(slots[i].slot) === s) return String(slots[i].slot);
      }
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].label && slots[i].label.toLowerCase() === lower) {
          return String(slots[i].slot);
        }
      }
      return undefined;
    }

    function getCellCopyPayload(meta, col) {
      const it = meta.item;
      if (col === 'task') {
        const val = it.label || '';
        return { col, value: val, text: val };
      }
      if (col === 'type') {
        const k = meta.hasChildren ? 'group' : (it.kind === 'milestone' ? 'milestone' : 'task');
        return { col, value: k, text: TYPE_LABELS[k] || 'Task' };
      }
      if (col === 'start') {
        const val = meta.hasChildren ? (meta.start || '') : (ganttFormatDate(it.start) || '');
        return { col, value: val, text: val };
      }
      if (col === 'end') {
        const val = it.kind === 'milestone'
          ? ''
          : (meta.hasChildren ? (meta.end || '') : (ganttFormatDate(it.end) || ''));
        return { col, value: val, text: val };
      }
      if (col === 'dur') {
        if (it.kind === 'milestone') return { col, value: 0, text: '-' };
        const days = (meta.start && meta.end) ? Math.max(1, ganttDiffDays(meta.start, meta.end) + 1) : null;
        return { col, value: days, text: days ? `${days}d` : '' };
      }
      if (col === 'dep') {
        const ids = getDepsForItem(it.id).map((d) => d.from);
        const text = formatDepShorthand(it.id, lastTree.rowNumById);
        return { col, value: ids, text };
      }
      if (col === 'cat') {
        const slot = it.color ? String(it.color) : '';
        return { col, value: slot, text: formatCategoryLabel(slot) };
      }
      if (col === 'note') {
        const noteObj = api.getNoteForItem(it.id);
        const text = noteObj && noteObj.text ? noteObj.text : '';
        return { col, value: text, text };
      }
      return null;
    }

    function applyCellPaste(meta, col, rawText, internalClip) {
      const it = meta.item;
      const trimmed = String(rawText == null ? '' : rawText).trim();
      const useInternal = Boolean(internalClip && internalClip.col === col && internalClip.text === rawText);

      if (col === 'task') {
        const cleaned = api.cleanLabel(trimmed, '');
        if (!cleaned) return false;
        if (cleaned !== it.label) {
          it.label = cleaned;
          api.commit('label');
        }
        return true;
      }

      if (col === 'type') {
        if (meta.hasChildren) return false;
        const lower = (useInternal ? String(internalClip.value || '') : trimmed).toLowerCase();
        let nextKind = null;
        if (lower === 'milestone' || lower === 'ms') nextKind = 'milestone';
        else if (lower === 'task') nextKind = 'task';
        else if (lower === 'group' || lower === 'phase') nextKind = 'group';
        if (!nextKind) return false;
        it.kind = nextKind;
        if (nextKind === 'milestone') {
          const s = ganttFormatDate(it.start) || meta.start || api.getTodayStr();
          it.start = s;
          it.end = s;
        } else {
          const s = ganttFormatDate(it.start) || meta.start;
          if (s && (!it.end || it.end === s)) {
            it.start = s;
            it.end = ganttAddDays(s, 6);
          }
        }
        api.commit('kind');
        return true;
      }

      if (col === 'start') {
        if (meta.hasChildren) return false;
        if (!trimmed || trimmed === '-') {
          delete it.start;
          if (it.kind === 'milestone') delete it.end;
          api.commit('start');
          return true;
        }
        const parsed = parseFlexDate(trimmed);
        if (!parsed) {
          api.toast('Invalid date');
          return false;
        }
        it.start = parsed;
        if (it.kind === 'milestone') it.end = parsed;
        else if (it.end && parsed > it.end) it.end = parsed;
        api.commit('start');
        return true;
      }

      if (col === 'end') {
        if (meta.hasChildren || it.kind === 'milestone') return false;
        if (!trimmed || trimmed === '-') {
          delete it.end;
          api.commit('end');
          return true;
        }
        const parsed = parseFlexDate(trimmed);
        if (!parsed) {
          api.toast('Invalid date');
          return false;
        }
        it.end = parsed;
        if (!it.start || parsed < it.start) it.start = parsed;
        api.commit('end');
        return true;
      }

      if (col === 'dur') {
        if (meta.hasChildren || it.kind === 'milestone') return false;
        const days = parseDurationDays(trimmed);
        if (!days) return false;
        const baseStart = ganttFormatDate(it.start) || api.getTodayStr();
        it.start = baseStart;
        it.end = ganttAddDays(baseStart, Math.max(1, days) - 1);
        api.commit('duration');
        return true;
      }

      if (col === 'cat') {
        let nextVal = '';
        if (useInternal) {
          nextVal = internalClip.value ? String(internalClip.value) : '';
        } else if (!trimmed || trimmed === '-' || /^none$/i.test(trimmed)) {
          nextVal = '';
        } else {
          const resolved = resolveCategoryFromText(trimmed);
          if (resolved) {
            nextVal = resolved;
          } else {
            const created = addCategoryByName(trimmed);
            nextVal = created ? String(created.slot) : '';
          }
        }
        applyCategoryWithSync(it, nextVal, lastTree);
        api.commit('color');
        return true;
      }

      if (col === 'dep') {
        if (useInternal && Array.isArray(internalClip.value)) {
          const data = api.getData();
          const curDeps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
          const baseDeps = curDeps.filter((d) => !(d && d.to === it.id));
          const parsed = [];
          for (let i = 0; i < internalClip.value.length; i++) {
            const fromId = internalClip.value[i];
            if (!fromId || fromId === it.id || !lastTree.byId.has(fromId)) continue;
            if (wouldCreateCycle(baseDeps.concat(parsed), fromId, it.id)) {
              api.toast('Circular dependency prevented');
              continue;
            }
            parsed.push({ from: fromId, to: it.id, type: 'fs' });
          }
          data.dependencies = baseDeps.concat(parsed);
          api.commit('dep');
          return true;
        }
        return applyDepShorthandForItem(it, trimmed);
      }

      if (col === 'note') {
        api.setNoteForItem(it.id, trimmed);
        return true;
      }

      return false;
    }

    function handleExcelPaste(text) {
      if (api.isPresenting()) return false;
      const rows = parseTsvRows(text);
      if (rows.length === 0) return false;

      let startIdx = 0;
      let colMap = null;
      const firstRow = rows[0];
      const firstCell = (firstRow[0] || '').trim();

      if (/^(#|task|name|item|title)$/i.test(firstCell)) {
        startIdx = 1;
        colMap = {};
        for (let c = 0; c < firstRow.length; c++) {
          const h = (firstRow[c] || '').trim();
          if (/^(#|no\.?|row|id)$/i.test(h)) colMap.num = c;
          else if (/^(task|name|item|title|label|deliverable|workstream)$/i.test(h) && colMap.task === undefined) colMap.task = c;
          else if (/^(type|kind)$/i.test(h)) colMap.type = c;
          else if (/^(start|start\s*date|begin|from)$/i.test(h)) colMap.start = c;
          else if (/^(end|end\s*date|finish|due|to)$/i.test(h)) colMap.end = c;
          else if (/^(dur|duration|days|length)$/i.test(h)) colMap.duration = c;
          else if (/^(dep|deps|depends(\s*on)?|predecessor(s)?)$/i.test(h)) colMap.dep = c;
          else if (/^(cat|category|color|team|track|stream|owner)$/i.test(h)) colMap.category = c;
          else if (/^(note|notes|comment|comments|description|desc)$/i.test(h)) colMap.notes = c;
        }
      } else {
        // Positional fallback: [Task, Start, End, Duration, Category, Notes], skipping numeric row index col if present
        const hasIndexCol = firstRow.length >= 2 && /^\d+$/.test(firstCell);
        const offset = hasIndexCol ? 1 : 0;
        colMap = {
          task: offset,
          start: offset + 1,
          end: offset + 2,
          duration: offset + 3,
          category: offset + 4,
          notes: offset + 5
        };
      }

      const data = api.getData();
      if (!Array.isArray(data.items)) data.items = [];
      if (!Array.isArray(data.notes)) data.notes = [];

      let added = 0;
      for (let r = startIdx; r < rows.length; r++) {
        const cols = rows[r];
        const rawTask = colMap.task !== undefined ? (cols[colMap.task] || '') : (cols[0] || '');
        const label = api.cleanLabel(rawTask, '');
        if (!label) continue;

        let kind = 'task';
        if (colMap.type !== undefined && cols[colMap.type]) {
          const t = cols[colMap.type].trim().toLowerCase();
          if (t === 'group' || t === 'phase' || t === 'summary') kind = 'group';
          else if (t === 'milestone' || t === 'ms') kind = 'milestone';
        }

        let start = colMap.start !== undefined ? parseFlexDate(cols[colMap.start]) : null;
        let end = colMap.end !== undefined ? parseFlexDate(cols[colMap.end]) : null;
        const durDays = colMap.duration !== undefined ? parseDurationDays(cols[colMap.duration]) : null;

        if (kind === 'milestone') {
          const d = start || end;
          start = d;
          end = d;
        } else {
          if (start && !end && durDays) {
            end = ganttAddDays(start, Math.max(1, durDays) - 1);
          } else if (!start && end && durDays) {
            start = ganttAddDays(end, -(Math.max(1, durDays) - 1));
          } else if (start && !end) {
            end = start;
          } else if (start && end && end < start) {
            end = start;
          }
        }

        const item = {
          id: api.newId('t'),
          kind,
          label
        };
        if (start) item.start = start;
        if (end) item.end = end;

        if (colMap.category !== undefined && cols[colMap.category]) {
          const color = resolveCategoryFromText(cols[colMap.category]);
          if (color) item.color = color;
        }

        data.items.push(item);
        added++;

        if (colMap.notes !== undefined && cols[colMap.notes]) {
          const noteText = String(cols[colMap.notes]).trim();
          if (noteText) {
            data.notes.push({
              id: api.newId('n'),
              text: noteText,
              target: item.id
            });
          }
        }
      }

      if (added > 0) {
        api.commit('paste');
        api.toast(`Pasted ${added} ${added === 1 ? 'row' : 'rows'}`);
      }
      return added > 0;
    }

    // --- Event wiring ---
    if (thNum) {
      thNum.addEventListener('click', () => {
        if (api.isPresenting()) return;
        const vis = lastTree.visibleRows;
        if (vis.length === 0) return;
        const cur = api.getSelectedIds() || new Set();
        let allSelected = true;
        for (let i = 0; i < vis.length; i++) {
          if (!cur.has(vis[i].item.id)) { allSelected = false; break; }
        }
        const next = new Set();
        if (!allSelected) {
          for (let i = 0; i < vis.length; i++) next.add(vis[i].item.id);
        }
        api.setSelectedIds(next);
        render();
      });
    }

    // Quick-add row
    quickAddInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (api.isPresenting()) return;
      const val = quickAddInput.value.trim();
      if (!val) return;
      e.preventDefault();

      const data = api.getData();
      if (!Array.isArray(data.items)) data.items = [];

      const today = api.getTodayStr();
      let start = today;
      for (let i = data.items.length - 1; i >= 0; i--) {
        const it = data.items[i];
        const s = it && (ganttFormatDate(it.start) || ganttFormatDate(it._start));
        if (s) { start = s; break; }
      }
      const end = ganttAddDays(start, 13);

      const newItem = {
        id: api.newId('t'),
        kind: 'task',
        label: api.cleanLabel(val, 'New task'),
        start,
        end
      };
      data.items.push(newItem);
      quickAddInput.value = '';
      api.commit('add');
      quickAddInput.focus();
    });

    // Milestones toggle & add
    btnMarkersToggle.addEventListener('click', () => {
      markersOpen = !markersOpen;
      markersSection.classList.toggle('is-open', markersOpen);
      btnMarkersToggle.setAttribute('aria-expanded', markersOpen ? 'true' : 'false');
      markersBody.hidden = !markersOpen;
    });

    btnAddMarkerRow.addEventListener('click', () => {
      if (api.isPresenting()) return;
      const data = api.getData();
      if (!Array.isArray(data.markers)) data.markers = [];
      data.markers.push({
        id: api.newId('m'),
        label: 'New milestone',
        date: api.getTodayStr(),
        color: '4'
      });
      markersOpen = true;
      markersSection.classList.add('is-open');
      btnMarkersToggle.setAttribute('aria-expanded', 'true');
      markersBody.hidden = false;
      api.commit('add-marker');
    });

    // Bulk actions
    bulkCatBtn.addEventListener('click', (e) => {
      if (api.isPresenting()) return;
      e.stopPropagation();
      openCategoryPopover(bulkCatBtn, '', (val) => {
        const sel = api.getSelectedIds();
        const all = api.getAllItems();
        const tree = buildTreeModel(all);
        let changed = 0;
        for (let i = 0; i < all.length; i++) {
          const it = all[i];
          if (it && sel.has(it.id)) {
            applyCategoryWithSync(it, val, tree);
            changed++;
          }
        }
        if (changed > 0) api.commit('bulk-color');
      });
    });

    btnBulkIndent.addEventListener('click', () => {
      if (api.isPresenting()) return;
      const sel = api.getSelectedIds();
      let any = false;
      for (let i = 0; i < lastTree.visibleRows.length; i++) {
        const id = lastTree.visibleRows[i].item.id;
        if (sel.has(id)) {
          if (indentItem(id, false)) any = true;
        }
      }
      if (any) api.commit('bulk-indent');
    });

    btnBulkOutdent.addEventListener('click', () => {
      if (api.isPresenting()) return;
      const sel = api.getSelectedIds();
      let any = false;
      for (let i = lastTree.visibleRows.length - 1; i >= 0; i--) {
        const id = lastTree.visibleRows[i].item.id;
        if (sel.has(id)) {
          if (outdentItem(id, false)) any = true;
        }
      }
      if (any) api.commit('bulk-outdent');
    });

    btnBulkCopy.addEventListener('click', () => {
      const sel = api.getSelectedIds();
      const rows = lastTree.visibleRows.filter((m) => sel.has(m.item.id));
      copyRows(rows);
    });

    btnBulkDelete.addEventListener('click', () => {
      if (api.isPresenting()) return;
      const sel = api.getSelectedIds();
      if (!sel || sel.size === 0) return;

      const data = api.getData();
      const byId = new Map();
      (data.items || []).forEach((it) => { if (it && it.id) byId.set(it.id, it); });

      // Reparent surviving children of deleted items to nearest surviving ancestor
      (data.items || []).forEach((it) => {
        if (!it || sel.has(it.id)) return;
        let p = it.parent;
        const seen = new Set();
        while (p && sel.has(p) && !seen.has(p)) {
          seen.add(p);
          const pObj = byId.get(p);
          p = pObj ? pObj.parent : null;
        }
        if (p && !sel.has(p) && byId.has(p)) it.parent = p;
        else delete it.parent;
      });

      const count = sel.size;
      data.items = (data.items || []).filter((it) => it && !sel.has(it.id));
      if (Array.isArray(data.dependencies)) {
        data.dependencies = data.dependencies.filter((d) => d && !sel.has(d.from) && !sel.has(d.to));
      }
      if (Array.isArray(data.notes)) {
        data.notes = data.notes.filter((n) => n && !sel.has(n.target));
      }
      api.setSelectedIds(new Set());
      api.commit('bulk-delete');
      api.toast(`Deleted ${count} ${count === 1 ? 'item' : 'items'}`);
    });

    btnBulkClear.addEventListener('click', () => {
      api.setSelectedIds(new Set());
      render();
    });

    // Clipboard paste & copy on hostEl
    function getActiveCellElement() {
      if (!activeCellCoord.itemId) return null;
      const rec = rowRecs.get(activeCellCoord.itemId);
      if (!rec || !rec.tr.isConnected) return null;
      return rec.tr.querySelector(`td[data-gt-cell][data-col-idx="${activeCellCoord.colIdx}"]`);
    }

    function onHostPaste(e) {
      if (api.isPresenting()) return;
      const active = document.activeElement;
      const isTextInput = Boolean(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (text === null || text === undefined) return;

      if (text.indexOf('\t') !== -1 || text.indexOf('\n') !== -1) {
        if (isTextInput && active.closest('.gt-inline-input, .gt-cat-pop, .gt-dep-pop')) return;
        e.preventDefault();
        handleExcelPaste(text);
        return;
      }

      if (isTextInput) return;
      const td = getActiveCellElement();
      if (!td) return;
      const meta = metaById.get(activeCellCoord.itemId);
      if (!meta) return;
      const col = td.getAttribute('data-col');
      if (!col) return;
      e.preventDefault();
      applyCellPaste(meta, col, text, cellClipboard);
    }

    function onHostCopy(e) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return; // let native text copy work
      }
      const sel = api.getSelectedIds();
      if (sel && sel.size > 1) {
        const rows = lastTree.visibleRows.filter((m) => sel.has(m.item.id));
        if (rows.length === 0) return;
        cellClipboard = null;
        const tsv = buildTsvForRows(rows);
        if (e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData('text/plain', tsv);
          api.toast(`Copied ${rows.length} rows for Excel`);
        }
        return;
      }

      const td = getActiveCellElement();
      if (td && activeCellCoord.itemId) {
        const meta = metaById.get(activeCellCoord.itemId);
        const col = td.getAttribute('data-col');
        if (meta && col) {
          const payload = getCellCopyPayload(meta, col);
          if (payload && e.clipboardData) {
            e.preventDefault();
            cellClipboard = payload;
            e.clipboardData.setData('text/plain', payload.text);
            td.classList.add('is-copied');
            setTimeout(() => td.classList.remove('is-copied'), 450);
            return;
          }
        }
      }

      if (sel && sel.size === 1) {
        const rows = lastTree.visibleRows.filter((m) => sel.has(m.item.id));
        if (rows.length === 0) return;
        cellClipboard = null;
        const tsv = buildTsvForRows(rows);
        if (e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData('text/plain', tsv);
          api.toast('Copied 1 row for Excel');
        }
      }
    }

    hostEl.addEventListener('paste', onHostPaste);
    hostEl.addEventListener('copy', onHostCopy);

    // --- Roving-tabindex spatial keyboard navigation on #gantt-sheet ---
    function getNavigableCellsInRow(tr) {
      return Array.from(tr.querySelectorAll('td[data-gt-cell]')).filter((td) => td.offsetParent !== null);
    }

    function syncActiveCellClass(nextCell) {
      const prevActive = tbody.querySelectorAll('td[data-gt-cell].is-active-cell');
      for (let i = 0; i < prevActive.length; i++) {
        if (prevActive[i] !== nextCell) prevActive[i].classList.remove('is-active-cell');
      }
      if (nextCell) nextCell.classList.add('is-active-cell');
    }

    function setRovingFocus(nextCell) {
      if (!nextCell) return;
      const prev = tbody.querySelector('td[data-gt-cell][tabindex="0"]');
      if (prev && prev !== nextCell) prev.tabIndex = -1;
      nextCell.tabIndex = 0;
      const tr = nextCell.closest('tr[data-item-id]');
      activeCellCoord = {
        itemId: tr ? tr.getAttribute('data-item-id') : null,
        colIdx: Number(nextCell.getAttribute('data-col-idx')) || 1
      };
      syncActiveCellClass(nextCell);
      nextCell.focus({ preventScroll: true });
      nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // --- Delegated sheet events (rows are reused across renders, so nothing is bound per cell) ---
    function rowMetaAt(target) {
      const tr = target && target.closest ? target.closest('tr[data-item-id]') : null;
      if (!tr || tr.parentNode !== tbody) return null;
      const meta = metaById.get(tr.getAttribute('data-item-id'));
      return meta && rowRecs.get(meta.item.id) && rowRecs.get(meta.item.id).tr === tr ? meta : null;
    }

    function openLabelEdit(tdTask, lblSpan, it, seedKey) {
      if (!lblSpan) return;
      startInlineTextEdit(tdTask, it.label || '', {
        replaceTarget: lblSpan,
        seedKey,
        onSave(val) {
          const cleaned = api.cleanLabel(val, it.label || 'Untitled');
          if (cleaned !== it.label) {
            it.label = cleaned;
            api.commit('label');
          }
        }
      });
    }

    function toggleKind(it, meta) {
      if (meta && meta.hasChildren) return;
      const curKind = it.kind === 'milestone' ? 'milestone' : 'task';
      const nextKind = curKind === 'milestone' ? 'task' : 'milestone';
      it.kind = nextKind;
      if (nextKind === 'milestone') {
        const s = ganttFormatDate(it.start) || (meta && meta.start) || api.getTodayStr();
        it.start = s;
        it.end = s;
      } else {
        const s = ganttFormatDate(it.start) || (meta && meta.start);
        if (s && (!it.end || it.end === s)) {
          it.start = s;
          it.end = ganttAddDays(s, 6);
        }
      }
      api.commit('kind');
    }

    function openStartPicker(anchorEl, it) {
      openDatePicker(anchorEl, {
        value: it.start || api.getTodayStr(),
        allowClear: true,
        onSelect(val) {
          if (!val) {
            delete it.start;
            if (it.kind === 'milestone') delete it.end;
          } else {
            it.start = val;
            if (it.kind === 'milestone') {
              it.end = val;
            } else if (it.end && val > it.end) {
              it.end = val;
            }
          }
          api.commit('start');
        }
      });
    }

    function openEndPicker(anchorEl, it) {
      openDatePicker(anchorEl, {
        value: it.end || it.start || api.getTodayStr(),
        min: it.start || undefined,
        allowClear: true,
        onSelect(val) {
          if (!val) {
            delete it.end;
          } else {
            it.end = val;
            if (!it.start || val < it.start) it.start = val;
          }
          api.commit('end');
        }
      });
    }

    function openDateTextEdit(tdDate, it, field, seedKey) {
      const wrap = tdDate.querySelector('.gt-date-cell');
      if (!wrap) return;
      const curVal = field === 'start' ? (ganttFormatDate(it.start) || '') : (ganttFormatDate(it.end) || '');
      startInlineTextEdit(tdDate, curVal, {
        replaceTarget: wrap,
        isNum: true,
        seedKey,
        placeholder: 'YYYY-MM-DD',
        onSave(val) {
          const trimmed = String(val || '').trim();
          if (!trimmed || trimmed === '-') {
            if (field === 'start') {
              delete it.start;
              if (it.kind === 'milestone') delete it.end;
            } else {
              delete it.end;
            }
            api.commit(field);
            return;
          }
          const parsed = parseFlexDate(trimmed);
          if (!parsed) {
            api.toast('Invalid date (use YYYY-MM-DD)');
            return;
          }
          if (field === 'start') {
            it.start = parsed;
            if (it.kind === 'milestone') it.end = parsed;
            else if (it.end && parsed > it.end) it.end = parsed;
          } else {
            it.end = parsed;
            if (!it.start || parsed < it.start) it.start = parsed;
          }
          api.commit(field);
        }
      });
    }

    function openDurationEdit(tdDur, durSpan, it, meta, seedKey) {
      if (!durSpan) return;
      const days = (meta.start && meta.end) ? Math.max(1, ganttDiffDays(meta.start, meta.end) + 1) : null;
      startInlineTextEdit(tdDur, days ? `${days}d` : '', {
        replaceTarget: durSpan,
        isNum: true,
        seedKey,
        placeholder: 'e.g. 14d or 2w',
        onSave(val) {
          const parsedDays = parseDurationDays(val);
          if (!parsedDays) return;
          const baseStart = ganttFormatDate(it.start) || api.getTodayStr();
          it.start = baseStart;
          it.end = ganttAddDays(baseStart, Math.max(1, parsedDays) - 1);
          api.commit('duration');
        }
      });
    }

    function openNoteEdit(tdNote, noteSpan, it, seedKey) {
      if (!noteSpan) return;
      const noteObj = api.getNoteForItem(it.id);
      const noteText = noteObj && noteObj.text ? noteObj.text : '';
      startInlineTextEdit(tdNote, noteText, {
        replaceTarget: noteSpan,
        seedKey,
        placeholder: 'Enter note...',
        onSave(val) {
          const next = String(val || '').trim();
          if (next !== noteText) {
            api.setNoteForItem(it.id, next);
          }
        }
      });
    }

    function activateCellEdit(cell, meta, seedKey) {
      if (!cell || !meta || api.isPresenting()) return;
      const it = meta.item;
      const col = cell.getAttribute('data-col');
      if (col === 'task') {
        openLabelEdit(cell, cell.querySelector('.gt-label-text'), it, seedKey);
      } else if (col === 'type') {
        if (!meta.hasChildren && !seedKey) toggleKind(it, meta);
      } else if (col === 'start') {
        if (!meta.hasChildren) openDateTextEdit(cell, it, 'start', seedKey);
      } else if (col === 'end') {
        if (!meta.hasChildren && it.kind !== 'milestone') openDateTextEdit(cell, it, 'end', seedKey);
      } else if (col === 'dur') {
        if (!meta.hasChildren && it.kind !== 'milestone') {
          openDurationEdit(cell, cell.querySelector('.gt-dur-val'), it, meta, seedKey);
        }
      } else if (col === 'dep') {
        if (!seedKey) openDepPopover(cell.querySelector('.gt-dep-btn') || cell, it);
      } else if (col === 'cat') {
        if (!seedKey) {
          const anchor = cell.querySelector('.gt-cat-btn') || cell;
          openCategoryPopover(anchor, it.color || '', (val) => {
            applyCategoryWithSync(it, val, lastTree);
            api.commit('color');
          });
        }
      } else if (col === 'note') {
        openNoteEdit(cell, cell.querySelector('.gt-note-preview'), it, seedKey);
      }
    }

    table.addEventListener('keydown', (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      const orig = path[0];
      if (!orig) return;

      const isEditableOrig = (orig.matches && orig.matches(':read-write')) || orig.tagName === 'SELECT';
      const cell = orig.closest ? orig.closest('td[data-gt-cell]') : null;

      // Tab / Shift+Tab on Task cell to indent / outdent (only when not editing text)
      if (e.key === 'Tab' && cell && cell.getAttribute('data-col') === 'task' && !isEditableOrig && !api.isPresenting()) {
        const tr = cell.closest('tr[data-item-id]');
        const itemId = tr ? tr.getAttribute('data-item-id') : null;
        if (itemId) {
          e.preventDefault();
          activeCellCoord = { itemId, colIdx: Number(cell.getAttribute('data-col-idx')) || 1 };
          if (e.shiftKey) outdentItem(itemId, true);
          else indentItem(itemId, true);
        }
        return;
      }

      if (isEditableOrig) return;
      if (!cell) return;

      // Arrow keys: spatial navigation (only preventDefault when adjacent cell exists!)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const rows = Array.from(tbody.querySelectorAll('tr[data-item-id]'));
        const curTr = cell.closest('tr[data-item-id]');
        const rIdx = rows.indexOf(curTr);
        if (rIdx === -1) return;
        const rowCells = getNavigableCellsInRow(curTr);
        const cIdx = rowCells.indexOf(cell);
        if (cIdx === -1) return;

        let targetCell = null;
        if (e.key === 'ArrowLeft') {
          if (cIdx > 0) targetCell = rowCells[cIdx - 1];
        } else if (e.key === 'ArrowRight') {
          if (cIdx < rowCells.length - 1) targetCell = rowCells[cIdx + 1];
        } else if (e.key === 'ArrowUp') {
          if (rIdx > 0) {
            const upCells = getNavigableCellsInRow(rows[rIdx - 1]);
            targetCell = upCells[Math.min(cIdx, upCells.length - 1)] || null;
          }
        } else if (e.key === 'ArrowDown') {
          if (rIdx < rows.length - 1) {
            const dnCells = getNavigableCellsInRow(rows[rIdx + 1]);
            targetCell = dnCells[Math.min(cIdx, dnCells.length - 1)] || null;
          }
        }

        if (targetCell) {
          e.preventDefault();
          setRovingFocus(targetCell);
        }
        return;
      }

      const meta = rowMetaAt(cell);
      if (!meta || api.isPresenting()) return;

      // Enter / F2 activates cell editor or control
      if (e.key === 'Enter' || e.key === 'F2') {
        if (orig !== cell && orig.closest && orig.closest('.chevron, .gt-date-cal-btn')) return;
        e.preventDefault();
        activateCellEdit(cell, meta);
        return;
      }

      // Printable character starts inline edit on text/date/dur cells
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const col = cell.getAttribute('data-col');
        if (col === 'task' || col === 'note') {
          e.preventDefault();
          activateCellEdit(cell, meta, e.key);
        } else if ((col === 'start' || col === 'end') && /[0-9a-zA-Z]/.test(e.key)) {
          e.preventDefault();
          activateCellEdit(cell, meta, e.key);
        } else if (col === 'dur' && /[0-9]/.test(e.key)) {
          e.preventDefault();
          activateCellEdit(cell, meta, e.key);
        }
      }
    });

    // Update activeCellCoord when focusing into a cell
    tbody.addEventListener('focusin', (e) => {
      const cell = e.target && e.target.closest ? e.target.closest('td[data-gt-cell]') : null;
      if (!cell) return;
      const prev = tbody.querySelector('td[data-gt-cell][tabindex="0"]');
      if (prev && prev !== cell) prev.tabIndex = -1;
      cell.tabIndex = 0;
      const tr = cell.closest('tr[data-item-id]');
      activeCellCoord = {
        itemId: tr ? tr.getAttribute('data-item-id') : null,
        colIdx: Number(cell.getAttribute('data-col-idx')) || 1
      };
      syncActiveCellClass(cell);
    });

    // Single-click: # column multi-select, chevron collapse, calendar icon, or cell selection/focus
    tbody.addEventListener('click', (e) => {
      const meta = rowMetaAt(e.target);
      if (!meta) return;
      const it = meta.item;
      const t = e.target;

      // Collapse chevron acts immediately
      if (meta.hasChildren && t.closest('.gt-task-cell > .chevron, .gt-chevron')) {
        e.stopPropagation();
        it.collapsed = !it.collapsed;
        api.commitSilent();
        return;
      }

      if (api.isPresenting()) return;

      // Row number (#) column: Click / Ctrl+Click / Shift+Click / Shift+Ctrl+Click selection
      const tdNum = t.closest('td.gt-col-num');
      if (tdNum) {
        e.preventDefault();
        const vis = lastTree.visibleRows;
        const idx = vis.findIndex((m) => m.item.id === it.id);
        if (idx === -1) return;
        const isMod = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;
        let nextSel = new Set(api.getSelectedIds());

        if (isShift && isMod) {
          const anchor = (lastAnchorIdx >= 0 && lastAnchorIdx < vis.length) ? lastAnchorIdx : idx;
          const lo = Math.min(anchor, idx);
          const hi = Math.max(anchor, idx);
          for (let i = lo; i <= hi; i++) nextSel.add(vis[i].item.id);
        } else if (isShift) {
          const anchor = (lastAnchorIdx >= 0 && lastAnchorIdx < vis.length) ? lastAnchorIdx : idx;
          const lo = Math.min(anchor, idx);
          const hi = Math.max(anchor, idx);
          nextSel = new Set();
          for (let i = lo; i <= hi; i++) nextSel.add(vis[i].item.id);
        } else if (isMod) {
          if (nextSel.has(it.id)) nextSel.delete(it.id);
          else nextSel.add(it.id);
          lastAnchorIdx = idx;
        } else {
          nextSel = new Set([it.id]);
          lastAnchorIdx = idx;
        }

        api.setSelectedIds(nextSel);
        render();
        return;
      }

      const td = t.closest('td[data-gt-cell]');
      if (!td) return;

      // Explicit calendar icon button opens date picker directly
      const calBtn = t.closest('.gt-date-cal-btn');
      if (calBtn) {
        e.stopPropagation();
        setRovingFocus(td);
        const field = calBtn.getAttribute('data-field');
        if (field === 'start') openStartPicker(calBtn, it);
        else if (field === 'end') openEndPicker(calBtn, it);
        return;
      }

      // Single-click on any cell selects/focuses it without entering edit mode
      if (!t.closest('.gt-inline-input')) {
        setRovingFocus(td);
      }
    });

    // Double-click on any cell enters edit mode
    tbody.addEventListener('dblclick', (e) => {
      if (api.isPresenting()) return;
      const t = e.target;
      if (t.closest('.chevron, .gt-chevron, .gt-date-cal-btn, .gt-row-grip, .gt-inline-input')) return;
      const meta = rowMetaAt(t);
      if (!meta) return;
      const td = t.closest('td[data-gt-cell]');
      if (!td) return;
      setRovingFocus(td);
      activateCellEdit(td, meta);
    });

    // Dependency hover row highlights
    tbody.addEventListener('mouseenter', (e) => {
      const td = e.target;
      if (!td.matches || !td.matches('td.gt-col-dep')) return;
      const meta = rowMetaAt(td);
      if (meta) highlightDepRows(meta.item.id);
    }, true);
    tbody.addEventListener('mouseleave', (e) => {
      const td = e.target;
      if (td.matches && td.matches('td.gt-col-dep') && rowMetaAt(td)) clearDepRowHighlights();
    }, true);

    // Column + row hover crosshair highlight (O(1) delegated)
    table.addEventListener('pointerover', (e) => {
      const cell = e.target && e.target.closest ? e.target.closest('td[data-col], th[data-col]') : null;
      const col = cell ? cell.getAttribute('data-col') : '';
      if (col) {
        if (table.dataset.hoverCol !== col) table.dataset.hoverCol = col;
      } else if (table.dataset.hoverCol) {
        delete table.dataset.hoverCol;
      }
    });
    table.addEventListener('pointerleave', () => {
      if (table.dataset.hoverCol) delete table.dataset.hoverCol;
    });

    // --- Drag-and-drop row reorder & indent/outdent ---
    let dragCleanup = null;
    tbody.addEventListener('pointerdown', (e) => {
      if (api.isPresenting() || e.button !== 0) return;
      const grip = e.target && e.target.closest ? e.target.closest('.gt-row-grip') : null;
      if (!grip) return;
      const meta = rowMetaAt(grip);
      if (!meta) return;

      e.preventDefault();
      e.stopPropagation();

      const srcId = meta.item.id;
      const srcRec = rowRecs.get(srcId);
      const srcTr = srcRec ? srcRec.tr : null;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let dropState = null; // { targetId, mode, explicitParentId }
      let dropLineEl = null;
      let dropBadgeEl = null;
      let insideTr = null;

      function clearDropVisuals() {
        if (insideTr) {
          insideTr.classList.remove('is-drop-inside');
          insideTr = null;
        }
        if (dropLineEl) dropLineEl.hidden = true;
        if (dropBadgeEl) dropBadgeEl.hidden = true;
      }

      function computeDrop(clientX, clientY) {
        const rows = lastTree.visibleRows;
        if (rows.length === 0) return null;

        let hitIdx = -1;
        let hitRect = null;
        for (let i = 0; i < rows.length; i++) {
          const rec = rowRecs.get(rows[i].item.id);
          if (!rec || !rec.tr.isConnected) continue;
          const r = rec.tr.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            hitIdx = i;
            hitRect = r;
            break;
          }
          if (i === 0 && clientY < r.top) {
            hitIdx = 0;
            hitRect = r;
            break;
          }
          if (i === rows.length - 1 && clientY > r.bottom) {
            hitIdx = i;
            hitRect = r;
            break;
          }
        }
        if (hitIdx === -1 || !hitRect) return null;

        const tgtMeta = rows[hitIdx];
        const tgtId = tgtMeta.item.id;
        if (tgtId === srcId || isDescendant(lastTree.validParent, tgtId, srcId)) {
          return null;
        }

        const relY = Math.max(0, Math.min(1, (clientY - hitRect.top) / Math.max(1, hitRect.height)));
        const dx = clientX - startX;
        const canBeParent = tgtMeta.item.kind !== 'milestone';

        let mode;
        if (relY < 0.35) mode = 'before';
        else if (relY > 0.65) mode = 'after';
        else mode = canBeParent ? 'inside' : (relY < 0.5 ? 'before' : 'after');

        let explicitParentId;
        let visualDepth = tgtMeta.depth;
        let badgeText = '';

        if (dx > 24) {
          // Horizontal right drag -> Indent
          if (mode === 'inside' && canBeParent) {
            explicitParentId = tgtId;
            visualDepth = tgtMeta.depth + 1;
            badgeText = `Indent under ${tgtMeta.item.label || 'task'}`;
          } else if (mode === 'after' && canBeParent) {
            mode = 'inside';
            explicitParentId = tgtId;
            visualDepth = tgtMeta.depth + 1;
            badgeText = `Indent under ${tgtMeta.item.label || 'task'}`;
          } else if (mode === 'before' && hitIdx > 0) {
            const prevMeta = rows[hitIdx - 1];
            const prevId = prevMeta.item.id;
            if (prevId !== srcId && !isDescendant(lastTree.validParent, prevId, srcId) && prevMeta.item.kind !== 'milestone') {
              explicitParentId = prevId;
              visualDepth = prevMeta.depth + 1;
              badgeText = `Indent under ${prevMeta.item.label || 'task'}`;
            }
          }
        } else if (dx < -24) {
          // Horizontal left drag -> Outdent up a level
          const tgtParent = lastTree.validParent.get(tgtId) || null;
          const grandParent = tgtParent ? (lastTree.validParent.get(tgtParent) || null) : null;
          explicitParentId = grandParent;
          mode = relY < 0.5 ? 'before' : 'after';
          visualDepth = Math.max(0, tgtMeta.depth - 1);
          badgeText = 'Outdent';
        }

        if (!badgeText) {
          if (mode === 'inside') {
            visualDepth = tgtMeta.depth + 1;
            badgeText = `Indent under ${tgtMeta.item.label || 'task'}`;
          } else if (mode === 'before') {
            badgeText = `Move before ${tgtMeta.item.label || 'task'}`;
          } else {
            badgeText = `Move after ${tgtMeta.item.label || 'task'}`;
          }
        }

        return {
          targetId: tgtId,
          targetTr: rowRecs.get(tgtId).tr,
          rect: hitRect,
          mode,
          explicitParentId,
          visualDepth,
          badgeText
        };
      }

      function onMove(ev) {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          started = true;
          closeCatPopover();
          closeDepPopover();
          if (srcTr) srcTr.classList.add('is-dragging');
          document.body.classList.add('gt-dragging');

          dropLineEl = el('div', 'gt-drop-line');
          dropLineEl.hidden = true;
          document.body.appendChild(dropLineEl);

          dropBadgeEl = el('div', 'gt-drop-badge');
          dropBadgeEl.hidden = true;
          document.body.appendChild(dropBadgeEl);
        }

        const next = computeDrop(ev.clientX, ev.clientY);
        dropState = next;
        clearDropVisuals();

        if (!next) return;

        if (next.mode === 'inside') {
          insideTr = next.targetTr;
          insideTr.classList.add('is-drop-inside');
        } else {
          const tableRect = table.getBoundingClientRect();
          const y = next.mode === 'before' ? next.rect.top : next.rect.bottom;
          const leftOffset = tableRect.left + 44 + next.visualDepth * 14;
          dropLineEl.style.setProperty('--drop-depth', `${next.visualDepth}`);
          dropLineEl.style.top = `${Math.round(y - 1)}px`;
          dropLineEl.style.left = `${Math.round(leftOffset)}px`;
          dropLineEl.style.width = `${Math.max(80, Math.round(tableRect.right - leftOffset))}px`;
          dropLineEl.hidden = false;
        }

        dropBadgeEl.textContent = next.badgeText;
        dropBadgeEl.style.left = `${Math.min(window.innerWidth - 220, Math.max(12, Math.round(ev.clientX + 14)))}px`;
        dropBadgeEl.style.top = `${Math.min(window.innerHeight - 36, Math.max(12, Math.round(ev.clientY - 14)))}px`;
        dropBadgeEl.hidden = false;
      }

      function finishDrag(commit) {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onCancel, true);
        dragCleanup = null;

        if (srcTr) srcTr.classList.remove('is-dragging');
        document.body.classList.remove('gt-dragging');
        clearDropVisuals();
        if (dropLineEl && dropLineEl.parentNode) dropLineEl.parentNode.removeChild(dropLineEl);
        if (dropBadgeEl && dropBadgeEl.parentNode) dropBadgeEl.parentNode.removeChild(dropBadgeEl);

        if (commit && started && dropState) {
          if (typeof api.reorderOrReparent === 'function') {
            api.reorderOrReparent(srcId, dropState.targetId, dropState.mode, dropState.explicitParentId);
          } else if (dropState.mode === 'inside') {
            const it = lastTree.byId.get(srcId);
            const tgt = lastTree.byId.get(dropState.targetId);
            if (it && tgt && tgt.kind !== 'milestone') {
              it.parent = tgt.id;
              if (tgt.kind !== 'group') tgt.kind = 'group';
              tgt.collapsed = false;
              api.commit('reorder');
            }
          }
        }
      }

      function onUp() { finishDrag(true); }
      function onCancel() { finishDrag(false); }

      dragCleanup = () => finishDrag(false);
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onCancel, true);
    });

    // --- Sticky parent phase breadcrumb bar on vertical scroll ---
    function updateStickyPhase() {
      stickyRafId = 0;
      if (destroyed) return;
      const rows = lastTree.visibleRows;
      if (rows.length === 0 || scrollEl.scrollTop <= 2) {
        stickyPhaseEl.hidden = true;
        stickyTargetId = null;
        return;
      }

      const theadH = thead.offsetHeight || 36;
      stickyPhaseEl.style.top = `${theadH}px`;
      const scrollRect = scrollEl.getBoundingClientRect();
      const cutoffY = scrollRect.top + theadH;

      let firstVisibleMeta = null;
      for (let i = 0; i < rows.length; i++) {
        const rec = rowRecs.get(rows[i].item.id);
        if (!rec || !rec.tr.isConnected) continue;
        const r = rec.tr.getBoundingClientRect();
        if (r.bottom > cutoffY + 4) {
          firstVisibleMeta = rows[i];
          break;
        }
      }

      if (!firstVisibleMeta) {
        stickyPhaseEl.hidden = true;
        stickyTargetId = null;
        return;
      }

      // Collect scrolled-past ancestors (outermost to innermost)
      const ancestors = [];
      let pid = lastTree.validParent.get(firstVisibleMeta.item.id) || null;
      const seen = new Set();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        const pRec = rowRecs.get(pid);
        const pMeta = lastTree.metaById.get(pid);
        if (pRec && pRec.tr.isConnected && pMeta) {
          const pRect = pRec.tr.getBoundingClientRect();
          if (pRect.top < cutoffY - 2) {
            ancestors.unshift(pMeta);
          }
        }
        pid = lastTree.validParent.get(pid) || null;
      }

      if (ancestors.length === 0) {
        stickyPhaseEl.hidden = true;
        stickyTargetId = null;
        return;
      }

      const deepest = ancestors[ancestors.length - 1];
      stickyTargetId = deepest.item.id;

      stickyPhaseEl.textContent = '';
      const dot = el('span', 'gt-sticky-dot');
      const col = deepest.item.color || deepest.item._color;
      if (col) dot.style.background = api.resolveColor(col);
      stickyPhaseEl.appendChild(dot);

      const crumbText = ancestors.map((a) => a.item.label || 'Untitled').join(' / ');
      stickyPhaseEl.appendChild(el('span', 'gt-sticky-label', crumbText));
      stickyPhaseEl.appendChild(el('span', 'gt-sticky-cue', '↑'));
      stickyPhaseEl.title = `Scroll back to ${deepest.item.label || 'parent'}`;
      stickyPhaseEl.hidden = false;
    }

    function scheduleStickyPhaseUpdate() {
      if (stickyRafId || destroyed) return;
      stickyRafId = requestAnimationFrame(updateStickyPhase);
    }

    scrollEl.addEventListener('scroll', scheduleStickyPhaseUpdate, { passive: true });
    stickyPhaseEl.addEventListener('click', () => {
      if (!stickyTargetId) return;
      const rec = rowRecs.get(stickyTargetId);
      if (!rec || !rec.tr.isConnected) return;
      const theadH = thead.offsetHeight || 36;
      const trTop = rec.tr.offsetTop;
      scrollEl.scrollTo({ top: Math.max(0, trTop - theadH - 4), behavior: 'smooth' });
    });

    // --- Render helpers ---
    function buildCategoryButton(currentVal, presenting) {
      const label = currentVal ? formatCategoryLabel(currentVal) : '-';
      if (presenting) {
        const wrap = el('div', 'gt-cat-readonly');
        const dot = el('span', 'gt-cat-dot' + (currentVal ? '' : ' is-none'));
        if (currentVal) dot.style.background = api.resolveColor(currentVal);
        wrap.appendChild(dot);
        wrap.appendChild(el('span', 'gt-cat-label' + (currentVal ? '' : ' is-empty'), label));
        return wrap;
      }

      const btn = el('button', 'gt-cat-btn' + (currentVal ? '' : ' is-empty'));
      btn.type = 'button';
      btn.setAttribute('aria-label', currentVal ? `Category: ${label}` : 'Set category');
      btn.setAttribute('aria-haspopup', 'listbox');

      const dot = el('span', 'gt-cat-dot' + (currentVal ? '' : ' is-none'));
      if (currentVal) dot.style.background = api.resolveColor(currentVal);
      btn.appendChild(dot);

      const lbl = el('span', 'gt-cat-label', label);
      lbl.title = currentVal ? label : 'Double-click to set category';
      btn.appendChild(lbl);

      const caret = el('span', 'gt-cat-caret');
      caret.appendChild(makeIcon(api, 'chevron-down', { size: 12 }, '▾'));
      btn.appendChild(caret);

      return btn;
    }

    function renderBulkBar(selectedIds, presenting) {
      const count = selectedIds ? selectedIds.size : 0;
      bulkBar.hidden = presenting || count === 0;
      if (bulkBar.hidden) return;
      bulkCountEl.textContent = `${count} selected`;
    }

    function renderMarkers(presenting) {
      const markers = api.getMarkers() || [];
      markersToggleText.textContent = `Milestones (${markers.length})`;
      markersTbody.textContent = '';

      if (markers.length === 0) {
        const tr = el('tr');
        const td = el('td', 'gt-marker-empty', 'No milestones yet');
        td.colSpan = presenting ? 3 : 4;
        tr.appendChild(td);
        markersTbody.appendChild(tr);
        return;
      }

      for (let i = 0; i < markers.length; i++) {
        const mk = markers[i];
        if (!mk) continue;
        const tr = el('tr');
        tr.setAttribute('data-marker-id', mk.id || '');

        // Label
        const tdLbl = el('td');
        const lblSpan = el('span', 'gt-label-text', mk.label || 'Untitled');
        if (!presenting) {
          lblSpan.addEventListener('dblclick', () => {
            startInlineTextEdit(tdLbl, mk.label || '', {
              replaceTarget: lblSpan,
              onSave(val) {
                const cleaned = api.cleanLabel(val, mk.label || 'Milestone');
                if (cleaned !== mk.label) {
                  mk.label = cleaned;
                  api.commit('marker-label');
                }
              }
            });
          });
        }
        tdLbl.appendChild(lblSpan);
        tr.appendChild(tdLbl);

        // Date
        const tdDate = el('td', 'gt-marker-col-date');
        if (presenting) {
          tdDate.appendChild(el('span', 'gt-rolled', mk.date || '-'));
        } else {
          const dateWrap = el('div', 'gt-date-cell');
          const dateVal = el('span', 'gt-date-val' + (mk.date ? '' : ' is-empty'), mk.date || '-');
          const calBtn = el('button', 'gt-date-cal-btn');
          calBtn.type = 'button';
          calBtn.title = 'Pick date';
          calBtn.setAttribute('aria-label', 'Pick milestone date');
          calBtn.appendChild(makeIcon(api, 'calendar', { size: 13 }, ''));
          calBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDatePicker(calBtn, {
              value: mk.date || api.getTodayStr(),
              allowClear: false,
              onSelect(val) {
                if (val && val !== mk.date) {
                  mk.date = val;
                  api.commit('marker-date');
                }
              }
            });
          });
          dateWrap.addEventListener('dblclick', (e) => {
            if (e.target.closest('.gt-date-cal-btn')) return;
            startInlineTextEdit(tdDate, mk.date || '', {
              replaceTarget: dateWrap,
              isNum: true,
              placeholder: 'YYYY-MM-DD',
              onSave(val) {
                const parsed = parseFlexDate(val);
                if (parsed && parsed !== mk.date) {
                  mk.date = parsed;
                  api.commit('marker-date');
                }
              }
            });
          });
          dateWrap.appendChild(dateVal);
          dateWrap.appendChild(calBtn);
          tdDate.appendChild(dateWrap);
        }
        tr.appendChild(tdDate);

        // Category
        const tdCat = el('td', 'gt-marker-col-cat');
        const catEl = buildCategoryButton(mk.color || '', presenting);
        if (!presenting) {
          catEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openCategoryPopover(catEl, mk.color || '', (val) => {
              if (val) mk.color = val;
              else delete mk.color;
              api.commit('marker-color');
            });
          });
        }
        tdCat.appendChild(catEl);
        tr.appendChild(tdCat);

        // Delete
        const tdDel = el('td', 'gt-marker-col-del');
        if (!presenting) {
          const delBtn = el('button', 'gt-icon-del');
          delBtn.type = 'button';
          delBtn.title = 'Delete milestone';
          delBtn.setAttribute('aria-label', `Delete ${mk.label || 'milestone'}`);
          delBtn.appendChild(makeIcon(api, 'trash', { size: 14 }, '×'));
          delBtn.addEventListener('click', () => {
            const data = api.getData();
            data.markers = (data.markers || []).filter((m) => m && m.id !== mk.id);
            api.commit('delete-marker');
          });
          tdDel.appendChild(delBtn);
        }
        tr.appendChild(tdDel);

        markersTbody.appendChild(tr);
      }
    }

    // One sheet row, without listeners (tbody events are delegated) and without selection / roving tabindex, which
    // render() patches in place. It is rebuilt only when rowShape() changes, otherwise the element is reused.
    function buildRow(meta, presenting, depText, noteText) {
      const it = meta.item;
      const isGroup = it.kind === 'group';
      const isMilestone = it.kind === 'milestone';
      const isParentWithKids = meta.hasChildren;

      const tr = el('tr');
      tr.setAttribute('data-item-id', it.id);
      tr.setAttribute('aria-level', String(meta.depth + 1));
      if (isParentWithKids) {
        tr.setAttribute('aria-expanded', it.collapsed ? 'false' : 'true');
      }
      if (isGroup || isParentWithKids) tr.classList.add('is-group');

      function makeCell(colKey, colIdx, cls) {
        const td = el('td', cls);
        td.setAttribute('data-gt-cell', '');
        td.setAttribute('data-col', colKey);
        td.setAttribute('data-col-idx', String(colIdx));
        const isActive = activeCellCoord.itemId === it.id && activeCellCoord.colIdx === colIdx;
        td.tabIndex = isActive ? 0 : -1;
        if (isActive) td.classList.add('is-active-cell');
        return td;
      }

      // Col 0: # row number (click / Ctrl+click / Shift+click to select rows)
      const tdNum = el('td', 'gt-col-num', String(meta.rowNum));
      tdNum.setAttribute('data-col', 'num');
      if (!presenting) tdNum.title = 'Click to select row (Ctrl/Shift for multi-select)';
      tr.appendChild(tdNum);

      // Col 1: Task (drag grip + indented by depth * 14px + chevron if hasChildren + double-click inline editable label)
      const tdTask = makeCell('task', 1, 'gt-col-task');
      const taskWrap = el('div', 'gt-task-cell');

      if (!presenting) {
        const grip = el('span', 'gt-row-grip');
        grip.title = 'Drag to reorder, indent, or outdent';
        grip.setAttribute('aria-hidden', 'true');
        grip.appendChild(makeIcon(api, 'grip', { size: 13 }, '⋮⋮'));
        taskWrap.appendChild(grip);
      }

      const indentBox = el('div', 'gt-task-indent');
      indentBox.style.paddingLeft = `${meta.depth * 14}px`;

      if (isParentWithKids) {
        const chevLabel = it.collapsed ? 'Expand subtasks' : 'Collapse subtasks';
        const chevBtn = api.chevron({ expanded: !it.collapsed, label: chevLabel });
        indentBox.appendChild(chevBtn);
      } else {
        indentBox.appendChild(el('span', 'chevron-spacer'));
      }

      const kindDot = el('span', 'gt-kind-dot' + (isMilestone ? ' is-milestone' : isParentWithKids ? ' is-group' : ''));
      if (it.color || it._color) {
        kindDot.style.background = api.resolveColor(it.color || it._color);
      }
      indentBox.appendChild(kindDot);

      const lblSpan = el('span', 'gt-label-text', it.label || 'Untitled');
      lblSpan.title = it.label || 'Untitled';
      indentBox.appendChild(lblSpan);
      taskWrap.appendChild(indentBox);
      tdTask.appendChild(taskWrap);
      tr.appendChild(tdTask);

      // Col 2: Type (only hidden when item actually has children; all childless items can switch Task <-> Milestone)
      const tdType = makeCell('type', 2, 'gt-col-type');
      if (!isParentWithKids) {
        const curKind = it.kind === 'milestone' ? 'milestone' : 'task';
        if (presenting) {
          const iconWrap = el('span', 'gt-type-icon' + (curKind === 'milestone' ? ' is-milestone' : ''));
          iconWrap.title = TYPE_LABELS[curKind];
          iconWrap.setAttribute('aria-label', TYPE_LABELS[curKind]);
          iconWrap.appendChild(makeTypeSvg(curKind));
          tdType.appendChild(iconWrap);
        } else {
          const nextKind = curKind === 'milestone' ? 'task' : 'milestone';
          const typeBtn = el('button', 'gt-type-btn' + (curKind === 'milestone' ? ' is-milestone' : ''));
          typeBtn.type = 'button';
          typeBtn.setAttribute('data-kind', curKind);
          typeBtn.title = `${TYPE_LABELS[curKind]} - double-click to switch to ${TYPE_LABELS[nextKind]}`;
          typeBtn.setAttribute('aria-label', `${TYPE_LABELS[curKind]} (double-click to switch to ${TYPE_LABELS[nextKind]})`);
          typeBtn.appendChild(makeTypeSvg(curKind));
          tdType.appendChild(typeBtn);
        }
      }
      tr.appendChild(tdType);

      // Col 3: Start (double-click to type date, or click calendar icon)
      const tdStart = makeCell('start', 3, 'gt-col-start');
      if (isParentWithKids) {
        const rolled = el('span', 'gt-rolled', meta.start || '-');
        rolled.title = 'Auto-calculated from subtasks';
        tdStart.appendChild(rolled);
      } else if (presenting) {
        tdStart.appendChild(el('span', it.start ? 'gt-rolled' : 'gt-muted-dash', it.start || '-'));
      } else {
        const dateCell = el('div', 'gt-date-cell');
        const valSpan = el('span', 'gt-date-val' + (it.start ? '' : ' is-empty'), it.start || '-');
        valSpan.title = 'Double-click to type date';
        const calBtn = el('button', 'gt-date-cal-btn');
        calBtn.type = 'button';
        calBtn.setAttribute('data-field', 'start');
        calBtn.title = 'Open calendar';
        calBtn.setAttribute('aria-label', 'Pick start date');
        calBtn.appendChild(makeIcon(api, 'calendar', { size: 13 }, ''));
        dateCell.appendChild(valSpan);
        dateCell.appendChild(calBtn);
        tdStart.appendChild(dateCell);
      }
      tr.appendChild(tdStart);

      // Col 4: End (double-click to type date, or click calendar icon)
      const tdEnd = makeCell('end', 4, 'gt-col-end');
      if (isMilestone) {
        tdEnd.appendChild(el('span', 'gt-muted-dash', '-'));
      } else if (isParentWithKids) {
        const rolled = el('span', 'gt-rolled', meta.end || '-');
        rolled.title = 'Auto-calculated from subtasks';
        tdEnd.appendChild(rolled);
      } else if (presenting) {
        tdEnd.appendChild(el('span', it.end ? 'gt-rolled' : 'gt-muted-dash', it.end || '-'));
      } else {
        const dateCell = el('div', 'gt-date-cell');
        const valSpan = el('span', 'gt-date-val' + (it.end ? '' : ' is-empty'), it.end || '-');
        valSpan.title = 'Double-click to type date';
        const calBtn = el('button', 'gt-date-cal-btn');
        calBtn.type = 'button';
        calBtn.setAttribute('data-field', 'end');
        calBtn.title = 'Open calendar';
        calBtn.setAttribute('aria-label', 'Pick end date');
        calBtn.appendChild(makeIcon(api, 'calendar', { size: 13 }, ''));
        dateCell.appendChild(valSpan);
        dateCell.appendChild(calBtn);
        tdEnd.appendChild(dateCell);
      }
      tr.appendChild(tdEnd);

      // Col 5: Duration (shows '-' for milestones and 0d durations)
      const tdDur = makeCell('dur', 5, 'gt-col-dur');
      if (isMilestone) {
        tdDur.appendChild(el('span', 'gt-muted-dash', '-'));
      } else if (isParentWithKids) {
        const days = (meta.start && meta.end) ? Math.max(0, ganttDiffDays(meta.start, meta.end) + 1) : 0;
        const durText = days > 0 ? `${days}d*` : '-';
        const rolled = el('span', 'gt-rolled', durText);
        rolled.title = 'Auto-calculated from subtasks';
        tdDur.appendChild(rolled);
      } else {
        const hasDates = Boolean(meta.start && meta.end);
        const days = hasDates ? Math.max(0, ganttDiffDays(meta.start, meta.end) + 1) : 0;
        const durStr = days > 0 ? `${days}d` : '-';
        if (presenting) {
          tdDur.appendChild(el('span', days > 0 ? 'gt-rolled' : 'gt-muted-dash', durStr));
        } else {
          const durSpan = el('span', 'gt-dur-val' + (days > 0 ? '' : ' is-empty'), durStr);
          durSpan.title = 'Double-click to edit duration (e.g. 14, 14d, 2w)';
          tdDur.appendChild(durSpan);
        }
      }
      tr.appendChild(tdDur);

      // Col 6: Depends on
      const tdDep = makeCell('dep', 6, 'gt-col-dep');
      if (presenting) {
        tdDep.appendChild(el('span', depText ? 'gt-rolled' : 'gt-muted-dash', depText || '-'));
      } else {
        const depBtn = el('button', 'gt-dep-btn' + (depText ? '' : ' is-empty'), depText || '-');
        depBtn.type = 'button';
        depBtn.title = depText ? `Depends on: ${depText}` : 'Double-click to add dependencies';
        tdDep.appendChild(depBtn);
      }
      tr.appendChild(tdDep);

      // Col 7: Category (design-system typeahead trigger button)
      const tdCat = makeCell('cat', 7, 'gt-col-cat');
      tdCat.appendChild(buildCategoryButton(it.color || '', presenting));
      tr.appendChild(tdCat);

      // Col 8: Notes
      const tdNote = makeCell('note', 8, 'gt-col-note');
      if (presenting) {
        tdNote.appendChild(el('span', noteText ? 'gt-note-preview' : 'gt-muted-dash', noteText || '-'));
      } else {
        const noteSpan = el('span', 'gt-note-preview' + (noteText ? '' : ' is-empty'), noteText || 'Add note...');
        noteSpan.title = noteText || 'Double-click to add note';
        tdNote.appendChild(noteSpan);
      }
      tr.appendChild(tdNote);

      return tr;
    }

    function rowShape(meta, presenting, catsKey, depText, noteText) {
      const it = meta.item;
      return JSON.stringify([presenting, meta.depth, meta.rowNum, meta.hasChildren, meta.start, meta.end, it.kind, it.label,
        it.start, it.end, Boolean(it.collapsed), it.color || '', it.color || it._color ? api.resolveColor(it.color || it._color) : '',
        depText, noteText, catsKey]);
    }

    // --- Main render() ---
    function render() {
      if (destroyed) return;
      const presenting = Boolean(api.isPresenting());
      hostEl.classList.toggle('is-presenting', presenting);

      // Remember if focus was inside tbody so we can restore it cleanly
      const wasFocusInTbody = document.activeElement && tbody.contains(document.activeElement);

      const allItems = api.getAllItems() || [];
      const tree = buildTreeModel(allItems);
      lastTree = tree;

      const selectedIds = api.getSelectedIds() || new Set();
      const cats = getActiveCategories();

      // Update # header selection indicator
      const visCount = tree.visibleRows.length;
      let selVisCount = 0;
      for (let i = 0; i < visCount; i++) {
        if (selectedIds.has(tree.visibleRows[i].item.id)) selVisCount++;
      }
      if (thNum) {
        thNum.classList.toggle('is-all-selected', visCount > 0 && selVisCount === visCount);
        thNum.classList.toggle('is-some-selected', selVisCount > 0 && selVisCount < visCount);
      }

      // Ensure activeCellCoord points to a visible row & valid column
      if (activeCellCoord.colIdx < 1 || activeCellCoord.colIdx > 8) {
        activeCellCoord.colIdx = 1;
      }
      if (visCount > 0) {
        const hasActive = activeCellCoord.itemId && tree.visibleRows.some((m) => m.item.id === activeCellCoord.itemId);
        if (!hasActive) {
          activeCellCoord = { itemId: tree.visibleRows[0].item.id, colIdx: 1 };
        }
      }

      // Keyed rows: reuse each row whose shape is unchanged, rebuild the rest, then put them in order
      clearDepRowHighlights();
      const catsKey = cats.map((c) => `${c.slot}:${c.label || ''}`).join(',');
      const incomingByTo = new Map();
      (api.getDeps() || []).forEach((d) => {
        if (!d || !d.to) return;
        if (!incomingByTo.has(d.to)) incomingByTo.set(d.to, []);
        incomingByTo.get(d.to).push(d);
      });
      const order = [];
      const seen = new Set();
      metaById = new Map();
      for (let r = 0; r < visCount; r++) {
        const meta = tree.visibleRows[r];
        const it = meta.item;
        metaById.set(it.id, meta);
        const depText = formatDepShorthand(it.id, tree.rowNumById, incomingByTo.get(it.id) || []);
        const noteObj = api.getNoteForItem(it.id);
        const noteText = noteObj && noteObj.text ? noteObj.text : '';
        const shape = rowShape(meta, presenting, catsKey, depText, noteText);
        let rec = rowRecs.get(it.id);
        if (!rec || rec.shape !== shape) {
          rec = { tr: buildRow(meta, presenting, depText, noteText), shape };
          rowRecs.set(it.id, rec);
        }
        const isSelected = selectedIds.has(it.id);
        rec.tr.classList.toggle('is-selected', isSelected);
        seen.add(it.id);
        order.push(rec.tr);
      }
      rowRecs.forEach((rec, id) => {
        if (!seen.has(id)) { rec.tr.remove(); rowRecs.delete(id); }
      });
      let at = tbody.firstChild;
      for (let i = 0; i < order.length; i++) {
        if (order[i] === at) at = at.nextSibling;
        else tbody.insertBefore(order[i], at);
      }
      while (at) { const next = at.nextSibling; at.remove(); at = next; }

      // Roving tabindex & active cell ring: exactly the active cell is 0
      const activeRec = activeCellCoord.itemId ? rowRecs.get(activeCellCoord.itemId) : null;
      const activeTd = activeRec ? activeRec.tr.querySelector(`td[data-gt-cell][data-col-idx="${activeCellCoord.colIdx}"]`) : null;
      tbody.querySelectorAll('td[data-gt-cell][tabindex="0"]').forEach((td) => { if (td !== activeTd) td.tabIndex = -1; });
      if (activeTd) activeTd.tabIndex = 0;
      syncActiveCellClass(activeTd);

      // Restore cell focus if focus was inside tbody prior to render
      if (wasFocusInTbody && activeTd) {
        activeTd.focus({ preventScroll: true });
      }

      renderMarkers(presenting);
      renderBulkBar(selectedIds, presenting);
      scheduleStickyPhaseUpdate();
    }

    function focusItem(id) {
      if (destroyed || !id) return;
      // Expand any collapsed ancestors so the item is visible
      const tree = buildTreeModel(api.getAllItems());
      let cur = tree.validParent.get(id);
      let expanded = false;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const pObj = tree.byId.get(cur);
        if (pObj && pObj.collapsed) {
          pObj.collapsed = false;
          expanded = true;
        }
        cur = tree.validParent.get(cur);
      }
      if (expanded) api.commitSilent();
      else render();

      const rec = rowRecs.get(id);
      const tr = rec && rec.tr.isConnected ? rec.tr : null;
      if (!tr) return;
      tr.scrollIntoView({ block: 'center', inline: 'nearest' });
      tr.classList.add('is-flash');
      setTimeout(() => tr.classList.remove('is-flash'), 900);

      const taskCell = tr.querySelector('td[data-gt-cell][data-col="task"]');
      if (taskCell) setRovingFocus(taskCell);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      closeDepPopover();
      closeCatPopover();
      if (dragCleanup) dragCleanup();
      if (stickyRafId) cancelAnimationFrame(stickyRafId);
      scrollEl.removeEventListener('scroll', scheduleStickyPhaseUpdate);
      hostEl.removeEventListener('paste', onHostPaste);
      hostEl.removeEventListener('copy', onHostCopy);
      hostEl.textContent = '';
    }

    return {
      render,
      focusItem,
      destroy
    };
  }

  window.GanttTable = {
    create
  };
})();
