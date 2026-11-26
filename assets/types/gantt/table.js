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
    let depPopState = null; // { el, itemId, anchorEl, onDocDown, onDocKey }

    // --- Build static shell inside hostEl ---
    hostEl.textContent = '';
    hostEl.classList.add('gt-view');

    // 1. Top summary bar
    const topbar = el('div', 'gt-topbar');
    const topbarLeft = el('div', 'gt-topbar-left');
    const countBadge = el('span', 'gt-count', '0 items');
    const hintEl = el('span', 'gt-hint', 'Paste from Excel (Ctrl+V) · Tab/Shift+Tab to indent · Click dates for calendar');
    topbarLeft.appendChild(countBadge);
    topbarLeft.appendChild(hintEl);

    const topbarActions = el('div', 'gt-topbar-actions');
    const btnCopyAll = el('button', 'gt-btn');
    btnCopyAll.type = 'button';
    btnCopyAll.id = 'btn-table-copy-all';
    btnCopyAll.appendChild(makeIcon(api, 'clipboard', { size: 14 }, ''));
    btnCopyAll.appendChild(el('span', '', 'Copy CSV/TSV'));
    topbarActions.appendChild(btnCopyAll);

    topbar.appendChild(topbarLeft);
    topbar.appendChild(topbarActions);
    hostEl.appendChild(topbar);

    // 2. Scrollable wrapper with main table + collapsible markers section
    const scrollEl = el('div', 'gt-scroll');

    const table = el('table', 'gantt-sheet');
    table.id = 'gantt-sheet';
    table.setAttribute('role', 'treegrid');
    table.setAttribute('aria-label', 'Roadmap data table');

    const thead = el('thead');
    const headRow = el('tr');

    const thCheck = el('th', 'gt-col-check');
    thCheck.setAttribute('scope', 'col');
    const selectAllCb = el('input', 'gt-checkbox');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'gt-select-all';
    selectAllCb.setAttribute('aria-label', 'Select all rows');
    thCheck.appendChild(selectAllCb);
    headRow.appendChild(thCheck);

    const colDefs = [
      { cls: 'gt-col-num',   label: '#' },
      { cls: 'gt-col-task',  label: 'Task' },
      { cls: 'gt-col-type',  label: 'Type' },
      { cls: 'gt-col-start', label: 'Start' },
      { cls: 'gt-col-end',   label: 'End' },
      { cls: 'gt-col-dur',   label: 'Duration' },
      { cls: 'gt-col-dep',   label: 'Depends on' },
      { cls: 'gt-col-cat',   label: 'Category' },
      { cls: 'gt-col-note',  label: 'Notes' }
    ];
    for (let i = 0; i < colDefs.length; i++) {
      const th = el('th', colDefs[i].cls, colDefs[i].label);
      th.setAttribute('scope', 'col');
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
    addTd.colSpan = 10;
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

    // 3. Collapsible Date Lines section (#gantt-markers-section)
    const markersSection = el('section', 'is-open');
    markersSection.id = 'gantt-markers-section';
    markersSection.setAttribute('aria-label', 'Date Lines');

    const markersHead = el('div', 'gt-markers-head');
    const btnMarkersToggle = el('button');
    btnMarkersToggle.type = 'button';
    btnMarkersToggle.id = 'btn-markers-toggle';
    btnMarkersToggle.setAttribute('aria-expanded', 'true');
    btnMarkersToggle.appendChild(makeIcon(api, 'chevron-down', { size: 13 }, '▾'));
    const markersToggleText = el('span', '', 'Date Lines (0)');
    btnMarkersToggle.appendChild(markersToggleText);

    const btnAddMarkerRow = el('button', 'gt-btn');
    btnAddMarkerRow.type = 'button';
    btnAddMarkerRow.id = 'btn-add-marker-row';
    btnAddMarkerRow.appendChild(makeIcon(api, 'plus', { size: 13 }, '+'));
    btnAddMarkerRow.appendChild(el('span', '', 'Add date line'));

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

    const bulkCatWrap = el('span', 'gt-bulk-cat-wrap');
    const bulkCatSelect = el('select', 'gt-bulk-cat-select');
    bulkCatSelect.setAttribute('aria-label', 'Set category for selected rows');
    bulkCatWrap.appendChild(bulkCatSelect);

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
    bulkBar.appendChild(bulkCatWrap);
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

    function formatDepShorthand(itemId, rowNumById) {
      const incoming = getDepsForItem(itemId);
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

    function formatCategoryLabel(slotVal) {
      if (!slotVal) return '';
      const slots = api.getPaletteSlots() || [];
      for (let i = 0; i < slots.length; i++) {
        if (String(slots[i].slot) === String(slotVal)) {
          return slots[i].label || `Color ${slots[i].slot}`;
        }
      }
      return String(slotVal);
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
        anchorEl.focus();
      }
    }

    function openDatePicker(anchorEl, opts) {
      if (api.isPresenting()) return;
      if (window.GanttDatePicker && typeof window.GanttDatePicker.open === 'function') {
        window.GanttDatePicker.open(anchorEl, opts);
      }
    }

    function openDepPopover(anchorEl, item) {
      if (api.isPresenting()) return;
      closeDepPopover();

      const tree = lastTree;
      const pop = el('div', 'gt-dep-pop');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', `Dependencies for ${item.label || 'task'}`);

      const head = el('div', 'gt-dep-pop-head');
      head.appendChild(el('span', 'gt-dep-pop-title', `Depends on · ${item.label || 'Task'}`));
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
      input.placeholder = 'e.g. 2, 5';
      input.setAttribute('aria-label', 'Predecessor row numbers');
      input.value = formatDepShorthand(item.id, tree.rowNumById);
      const applyBtn = el('button', 'gt-btn gt-btn-primary', 'Apply');
      applyBtn.type = 'button';
      inputRow.appendChild(input);
      inputRow.appendChild(applyBtn);
      pop.appendChild(inputRow);

      const listEl = el('div', 'gt-dep-list');
      pop.appendChild(listEl);

      function syncInputFromModel() {
        input.value = formatDepShorthand(item.id, lastTree.rowNumById);
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

        const candidates = lastTree.orderedAll.filter((m) => m.item.id !== item.id && m.item.kind !== 'group');
        if (candidates.length === 0) {
          listEl.appendChild(el('div', 'gt-dep-empty', 'No other tasks or milestones'));
          return;
        }

        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
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

          cb.addEventListener('change', () => {
            const curDeps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
            if (cb.checked) {
              if (wouldCreateCycle(curDeps, other.id, item.id)) {
                cb.checked = false;
                api.toast('Circular dependency prevented');
                return;
              }
              data.dependencies = curDeps.filter((d) => !(d && d.from === other.id && d.to === item.id));
              data.dependencies.push({ from: other.id, to: item.id, type: 'fs' });
              api.commit('dep');
            } else {
              data.dependencies = curDeps.filter((d) => !(d && d.from === other.id && d.to === item.id));
              api.commit('dep');
            }
            syncInputFromModel();
            renderChecklist();
          });

          row.addEventListener('click', (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
          });

          row.appendChild(cb);
          row.appendChild(numSpan);
          row.appendChild(lblSpan);
          listEl.appendChild(row);
        }
      }

      function applyShorthand() {
        const raw = input.value.trim();
        const data = api.getData();
        const curDeps = Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies = []);
        const baseDeps = curDeps.filter((d) => !(d && d.to === item.id));

        if (!raw) {
          data.dependencies = baseDeps;
          api.commit('dep');
          closeDepPopover();
          return;
        }

        const tokens = raw.split(/[\s,;]+/).filter(Boolean);
        const parsed = [];
        const seenFrom = new Set();

        for (let i = 0; i < tokens.length; i++) {
          const m = /^#?(\d+)\s*(FS|SS)?$/i.exec(tokens[i]);
          if (!m) {
            api.toast(`Invalid dependency "${tokens[i]}" (use row numbers, e.g. 2, 5)`);
            return;
          }
          const num = Number(m[1]);
          const target = lastTree.itemByRowNum.get(num);
          if (!target) {
            api.toast(`Row #${num} not found`);
            return;
          }
          if (target.id === item.id) {
            api.toast('Task cannot depend on itself');
            return;
          }
          if (seenFrom.has(target.id)) continue;
          const testDeps = baseDeps.concat(parsed);
          if (wouldCreateCycle(testDeps, target.id, item.id)) {
            api.toast('Circular dependency prevented');
            return;
          }
          seenFrom.add(target.id);
          parsed.push({ from: target.id, to: item.id, type: 'fs' });
        }

        data.dependencies = baseDeps.concat(parsed);
        api.commit('dep');
        closeDepPopover();
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyShorthand();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDepPopover(true);
        }
      });
      applyBtn.addEventListener('click', applyShorthand);

      renderChecklist();
      document.body.appendChild(pop);

      // Position near anchorEl, clamped to viewport
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
      input.select();
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
      input.value = initialVal || '';
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
        } else if (cellEl.isConnected) {
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
      input.select();
    }

    // --- Copy / Paste for Excel ---
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
          durStr = '0d';
        } else if (meta.start && meta.end) {
          durStr = `${Math.max(1, ganttDiffDays(meta.start, meta.end) + 1)}d`;
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
      const tsv = buildTsvForRows(rowMetas);
      copyTextToClipboard(tsv);
      api.toast(`Copied ${rowMetas.length} ${rowMetas.length === 1 ? 'row' : 'rows'} for Excel`);
    }

    function resolveCategoryFromText(raw) {
      const s = String(raw || '').trim();
      if (!s || /^none$/i.test(s)) return undefined;
      if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
      const slots = api.getPaletteSlots() || [];
      for (let i = 0; i < slots.length; i++) {
        if (String(slots[i].slot) === s) return String(slots[i].slot);
      }
      const lower = s.toLowerCase();
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].label && slots[i].label.toLowerCase() === lower) {
          return String(slots[i].slot);
        }
      }
      return undefined;
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
    btnCopyAll.addEventListener('click', () => {
      copyRows(lastTree.visibleRows);
    });

    selectAllCb.addEventListener('change', () => {
      if (api.isPresenting()) return;
      const next = new Set();
      if (selectAllCb.checked) {
        for (let i = 0; i < lastTree.visibleRows.length; i++) {
          next.add(lastTree.visibleRows[i].item.id);
        }
      }
      api.setSelectedIds(next);
      render();
    });

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

    // Date Lines toggle & add
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
        label: 'New date line',
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
    bulkCatSelect.addEventListener('change', () => {
      if (api.isPresenting()) return;
      const val = bulkCatSelect.value;
      if (val === '__placeholder__') return;
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
      bulkCatSelect.value = '__placeholder__';
      if (changed > 0) api.commit('bulk-color');
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
    function onHostPaste(e) {
      if (api.isPresenting()) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text) return;
      if (text.indexOf('\t') === -1 && text.indexOf('\n') === -1) return;
      e.preventDefault();
      handleExcelPaste(text);
    }

    function onHostCopy(e) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        if (active.selectionStart !== active.selectionEnd) return; // let native text copy work
      }
      const sel = api.getSelectedIds();
      let rows = [];
      if (sel && sel.size > 0) {
        rows = lastTree.visibleRows.filter((m) => sel.has(m.item.id));
      } else if (active && active.closest && active.closest('#gantt-sheet')) {
        const tr = active.closest('tr[data-item-id]');
        if (tr) {
          const id = tr.getAttribute('data-item-id');
          const m = lastTree.metaById.get(id);
          if (m) rows = [m];
        }
      }
      if (rows.length === 0) return;

      const tsv = buildTsvForRows(rows);
      if (e.clipboardData) {
        e.preventDefault();
        e.clipboardData.setData('text/plain', tsv);
        api.toast(`Copied ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} for Excel`);
      }
    }

    hostEl.addEventListener('paste', onHostPaste);
    hostEl.addEventListener('copy', onHostCopy);

    // --- Roving-tabindex spatial keyboard navigation on #gantt-sheet ---
    function getNavigableCellsInRow(tr) {
      return Array.from(tr.querySelectorAll('td[data-gt-cell]')).filter((td) => td.offsetParent !== null);
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
      nextCell.focus({ preventScroll: true });
      nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

      // Enter / F2 activates cell editor or control
      if (e.key === 'Enter' || e.key === 'F2') {
        if (orig !== cell) return; // button/checkbox already handles Enter
        e.preventDefault();
        const col = cell.getAttribute('data-col');
        if (col === 'task') {
          const lbl = cell.querySelector('.gt-label-text');
          if (lbl) lbl.click();
        } else if (col === 'dur') {
          const dur = cell.querySelector('.gt-dur-val');
          if (dur) dur.click();
        } else if (col === 'note') {
          const note = cell.querySelector('.gt-note-preview');
          if (note) note.click();
        } else if (col === 'start' || col === 'end') {
          const btn = cell.querySelector('.gt-date-btn');
          if (btn) btn.click();
        } else if (col === 'dep') {
          const btn = cell.querySelector('.gt-dep-btn');
          if (btn) btn.click();
        } else if (col === 'type' || col === 'cat') {
          const sel = cell.querySelector('select');
          if (sel) sel.focus();
        } else if (col === 'check') {
          const cb = cell.querySelector('input[type="checkbox"]');
          if (cb) cb.click();
        }
      }
    });

    // Update activeCellCoord when clicking into a cell
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
    });

    // --- Render helpers ---
    function buildCategorySelect(currentVal, slots, onChange, disabled) {
      const wrap = el('div', 'gt-cat-wrap');
      const dot = el('span', 'gt-cat-dot' + (currentVal ? '' : ' is-none'));
      if (currentVal) {
        dot.style.background = api.resolveColor(currentVal);
      }
      wrap.appendChild(dot);

      if (disabled) {
        wrap.appendChild(el('span', '', currentVal ? formatCategoryLabel(currentVal) : 'None'));
        return wrap;
      }

      const select = el('select', 'gt-select gt-cat-select');
      select.setAttribute('aria-label', 'Category');
      const noneOpt = el('option', '', 'None');
      noneOpt.value = '';
      select.appendChild(noneOpt);

      let matched = !currentVal;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const opt = el('option', '', s.label || `Color ${s.slot}`);
        opt.value = String(s.slot);
        if (String(s.slot) === String(currentVal)) matched = true;
        select.appendChild(opt);
      }
      if (!matched && currentVal) {
        const customOpt = el('option', '', String(currentVal));
        customOpt.value = String(currentVal);
        select.appendChild(customOpt);
      }
      select.value = currentVal ? String(currentVal) : '';
      select.addEventListener('change', () => onChange(select.value));
      wrap.appendChild(select);
      return wrap;
    }

    function renderBulkBar(selectedIds, slots, presenting) {
      const count = selectedIds ? selectedIds.size : 0;
      bulkBar.hidden = presenting || count === 0;
      if (bulkBar.hidden) return;

      bulkCountEl.textContent = `${count} selected`;

      bulkCatSelect.textContent = '';
      const ph = el('option', '', 'Category...');
      ph.value = '__placeholder__';
      bulkCatSelect.appendChild(ph);
      const noneOpt = el('option', '', 'None');
      noneOpt.value = '';
      bulkCatSelect.appendChild(noneOpt);
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const opt = el('option', '', s.label || `Color ${s.slot}`);
        opt.value = String(s.slot);
        bulkCatSelect.appendChild(opt);
      }
      bulkCatSelect.value = '__placeholder__';
    }

    function renderMarkers(slots, presenting) {
      const markers = api.getMarkers() || [];
      markersToggleText.textContent = `Date Lines (${markers.length})`;
      markersTbody.textContent = '';

      if (markers.length === 0) {
        const tr = el('tr');
        const td = el('td', 'gt-marker-empty', 'No date lines yet');
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
          lblSpan.addEventListener('click', () => {
            startInlineTextEdit(tdLbl, mk.label || '', {
              replaceTarget: lblSpan,
              onSave(val) {
                const cleaned = api.cleanLabel(val, mk.label || 'Date line');
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
          tdDate.appendChild(el('span', 'gt-rolled', mk.date || '—'));
        } else {
          const dateBtn = el('button', 'gt-date-btn' + (mk.date ? '' : ' is-empty'), mk.date || 'Set date');
          dateBtn.type = 'button';
          dateBtn.addEventListener('click', () => {
            openDatePicker(dateBtn, {
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
          tdDate.appendChild(dateBtn);
        }
        tr.appendChild(tdDate);

        // Category
        const tdCat = el('td', 'gt-marker-col-cat');
        tdCat.appendChild(buildCategorySelect(mk.color || '', slots, (val) => {
          if (val) mk.color = val;
          else delete mk.color;
          api.commit('marker-color');
        }, presenting));
        tr.appendChild(tdCat);

        // Delete
        const tdDel = el('td', 'gt-marker-col-del');
        if (!presenting) {
          const delBtn = el('button', 'gt-icon-del');
          delBtn.type = 'button';
          delBtn.title = 'Delete date line';
          delBtn.setAttribute('aria-label', `Delete ${mk.label || 'date line'}`);
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
      const slots = api.getPaletteSlots() || [];

      // Summary count
      const totalCount = tree.orderedAll.length;
      countBadge.textContent = `${totalCount} ${totalCount === 1 ? 'item' : 'items'}`;

      // Update select-all checkbox state
      const visCount = tree.visibleRows.length;
      let selVisCount = 0;
      for (let i = 0; i < visCount; i++) {
        if (selectedIds.has(tree.visibleRows[i].item.id)) selVisCount++;
      }
      selectAllCb.checked = visCount > 0 && selVisCount === visCount;
      selectAllCb.indeterminate = selVisCount > 0 && selVisCount < visCount;

      // Ensure activeCellCoord points to a visible row & visible column if possible
      if (presenting && activeCellCoord.colIdx === 0) {
        activeCellCoord.colIdx = 1;
      }
      if (visCount > 0) {
        const hasActive = activeCellCoord.itemId && tree.visibleRows.some((m) => m.item.id === activeCellCoord.itemId);
        if (!hasActive) {
          activeCellCoord = { itemId: tree.visibleRows[0].item.id, colIdx: 1 };
        }
      }

      tbody.textContent = '';
      const frag = document.createDocumentFragment();

      for (let r = 0; r < visCount; r++) {
        const meta = tree.visibleRows[r];
        const it = meta.item;
        const isGroup = it.kind === 'group';
        const isMilestone = it.kind === 'milestone';
        const isParentWithKids = meta.hasChildren;
        const isSelected = selectedIds.has(it.id);

        const tr = el('tr');
        tr.setAttribute('data-item-id', it.id);
        tr.setAttribute('aria-level', String(meta.depth + 1));
        if (isParentWithKids) {
          tr.setAttribute('aria-expanded', it.collapsed ? 'false' : 'true');
        }
        if (isGroup) tr.classList.add('is-group');
        if (isSelected) tr.classList.add('is-selected');

        function makeCell(colKey, colIdx, cls) {
          const td = el('td', cls);
          td.setAttribute('data-gt-cell', '');
          td.setAttribute('data-col', colKey);
          td.setAttribute('data-col-idx', String(colIdx));
          const isActive = activeCellCoord.itemId === it.id && activeCellCoord.colIdx === colIdx;
          td.tabIndex = isActive ? 0 : -1;
          return td;
        }

        // Col 0: Checkbox
        const tdCheck = makeCell('check', 0, 'gt-col-check');
        if (!presenting) {
          const cb = el('input', 'gt-checkbox');
          cb.type = 'checkbox';
          cb.checked = isSelected;
          cb.setAttribute('aria-label', `Select ${it.label || 'row'}`);
          cb.addEventListener('change', () => {
            const next = new Set(api.getSelectedIds());
            if (cb.checked) next.add(it.id);
            else next.delete(it.id);
            api.setSelectedIds(next);
            render();
          });
          tdCheck.appendChild(cb);
        }
        tr.appendChild(tdCheck);

        // Col 1 (non-navigable or static): # row number
        const tdNum = el('td', 'gt-col-num', String(meta.rowNum));
        tr.appendChild(tdNum);

        // Col 2: Task (indented by depth * 14px, chevron if hasChildren, inline editable label)
        const tdTask = makeCell('task', 1, 'gt-col-task');
        const taskWrap = el('div', 'gt-task-cell');
        taskWrap.style.paddingLeft = `${meta.depth * 14}px`;

        if (isParentWithKids) {
          const chevLabel = it.collapsed ? 'Expand subtasks' : 'Collapse subtasks';
          const chevBtn = api.chevron({ expanded: !it.collapsed, label: chevLabel });
          chevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            it.collapsed = !it.collapsed;
            api.commitSilent();
          });
          taskWrap.appendChild(chevBtn);
        } else {
          taskWrap.appendChild(el('span', 'chevron-spacer'));
        }

        const kindDot = el('span', 'gt-kind-dot' + (isMilestone ? ' is-milestone' : isGroup ? ' is-group' : ''));
        if (it.color || it._color) {
          kindDot.style.background = api.resolveColor(it.color || it._color);
        }
        taskWrap.appendChild(kindDot);

        const lblSpan = el('span', 'gt-label-text', it.label || 'Untitled');
        lblSpan.title = it.label || 'Untitled';
        if (!presenting) {
          const openLabelEdit = () => {
            startInlineTextEdit(tdTask, it.label || '', {
              replaceTarget: lblSpan,
              onSave(val) {
                const cleaned = api.cleanLabel(val, it.label || 'Untitled');
                if (cleaned !== it.label) {
                  it.label = cleaned;
                  api.commit('label');
                }
              }
            });
          };
          lblSpan.addEventListener('click', openLabelEdit);
          lblSpan.addEventListener('dblclick', openLabelEdit);
        }
        taskWrap.appendChild(lblSpan);
        tdTask.appendChild(taskWrap);
        tr.appendChild(tdTask);

        // Col 3: Type (hidden for groups and parent rows; leaves toggle Task <-> Milestone with 1-click icon)
        const tdType = makeCell('type', 2, 'gt-col-type');
        const isGroupOrParent = it.kind === 'group' || isParentWithKids;
        if (!isGroupOrParent) {
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
            typeBtn.title = `${TYPE_LABELS[curKind]} — click to switch to ${TYPE_LABELS[nextKind]}`;
            typeBtn.setAttribute('aria-label', `${TYPE_LABELS[curKind]} (click to switch to ${TYPE_LABELS[nextKind]})`);
            typeBtn.appendChild(makeTypeSvg(curKind));
            typeBtn.addEventListener('click', () => {
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
            });
            tdType.appendChild(typeBtn);
          }
        }
        tr.appendChild(tdType);

        // Col 4: Start
        const tdStart = makeCell('start', 3, 'gt-col-start');
        if (isParentWithKids) {
          const rolled = el('span', 'gt-rolled', meta.start || '—');
          rolled.title = 'Auto-calculated from subtasks';
          tdStart.appendChild(rolled);
        } else if (presenting) {
          tdStart.appendChild(el('span', it.start ? 'gt-rolled' : 'gt-muted-dash', it.start || '—'));
        } else {
          const startBtn = el('button', 'gt-date-btn' + (it.start ? '' : ' is-empty'), it.start || 'Set date');
          startBtn.type = 'button';
          startBtn.setAttribute('data-field', 'start');
          startBtn.addEventListener('click', () => {
            openDatePicker(startBtn, {
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
          });
          tdStart.appendChild(startBtn);
        }
        tr.appendChild(tdStart);

        // Col 5: End
        const tdEnd = makeCell('end', 4, 'gt-col-end');
        if (isMilestone) {
          tdEnd.appendChild(el('span', 'gt-muted-dash', '—'));
        } else if (isParentWithKids) {
          const rolled = el('span', 'gt-rolled', meta.end || '—');
          rolled.title = 'Auto-calculated from subtasks';
          tdEnd.appendChild(rolled);
        } else if (presenting) {
          tdEnd.appendChild(el('span', it.end ? 'gt-rolled' : 'gt-muted-dash', it.end || '—'));
        } else {
          const endBtn = el('button', 'gt-date-btn' + (it.end ? '' : ' is-empty'), it.end || 'Set date');
          endBtn.type = 'button';
          endBtn.setAttribute('data-field', 'end');
          endBtn.addEventListener('click', () => {
            openDatePicker(endBtn, {
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
          });
          tdEnd.appendChild(endBtn);
        }
        tr.appendChild(tdEnd);

        // Col 6: Duration
        const tdDur = makeCell('dur', 5, 'gt-col-dur');
        if (isMilestone) {
          tdDur.appendChild(el('span', 'gt-muted-dash', '0d'));
        } else if (isParentWithKids) {
          const durText = (meta.start && meta.end) ? `${Math.max(1, ganttDiffDays(meta.start, meta.end) + 1)}d*` : '—';
          const rolled = el('span', 'gt-rolled', durText);
          rolled.title = 'Auto-calculated from subtasks';
          tdDur.appendChild(rolled);
        } else {
          const hasDates = Boolean(meta.start && meta.end);
          const days = hasDates ? Math.max(1, ganttDiffDays(meta.start, meta.end) + 1) : null;
          const durStr = days ? `${days}d` : '—';
          if (presenting) {
            tdDur.appendChild(el('span', days ? 'gt-rolled' : 'gt-muted-dash', durStr));
          } else {
            const durSpan = el('span', 'gt-dur-val', durStr);
            durSpan.title = 'Click to edit duration (e.g. 14, 14d, 2w)';
            durSpan.addEventListener('click', () => {
              startInlineTextEdit(tdDur, days ? `${days}d` : '', {
                replaceTarget: durSpan,
                isNum: true,
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
            });
            tdDur.appendChild(durSpan);
          }
        }
        tr.appendChild(tdDur);

        // Col 7: Depends on
        const tdDep = makeCell('dep', 6, 'gt-col-dep');
        const depText = formatDepShorthand(it.id, tree.rowNumById);
        if (presenting) {
          tdDep.appendChild(el('span', depText ? 'gt-rolled' : 'gt-muted-dash', depText || '—'));
        } else {
          const depBtn = el('button', 'gt-dep-btn' + (depText ? '' : ' is-empty'), depText || '—');
          depBtn.type = 'button';
          depBtn.title = depText ? `Depends on: ${depText}` : 'Click to add dependencies';
          depBtn.addEventListener('click', () => openDepPopover(depBtn, it));
          tdDep.appendChild(depBtn);
        }
        tdDep.addEventListener('mouseenter', () => highlightDepRows(it.id));
        tdDep.addEventListener('mouseleave', clearDepRowHighlights);
        tr.appendChild(tdDep);

        // Col 8: Category
        const tdCat = makeCell('cat', 7, 'gt-col-cat');
        tdCat.appendChild(buildCategorySelect(it.color || '', slots, (val) => {
          applyCategoryWithSync(it, val, tree);
          api.commit('color');
        }, presenting));
        tr.appendChild(tdCat);

        // Col 9: Notes
        const tdNote = makeCell('note', 8, 'gt-col-note');
        const noteObj = api.getNoteForItem(it.id);
        const noteText = noteObj && noteObj.text ? noteObj.text : '';
        if (presenting) {
          tdNote.appendChild(el('span', noteText ? 'gt-note-preview' : 'gt-muted-dash', noteText || '—'));
        } else {
          const noteSpan = el('span', 'gt-note-preview' + (noteText ? '' : ' is-empty'), noteText || 'Add note...');
          noteSpan.title = noteText || 'Click to add note';
          noteSpan.addEventListener('click', () => {
            startInlineTextEdit(tdNote, noteText, {
              replaceTarget: noteSpan,
              placeholder: 'Enter note...',
              onSave(val) {
                const next = String(val || '').trim();
                if (next !== noteText) {
                  api.setNoteForItem(it.id, next);
                }
              }
            });
          });
          tdNote.appendChild(noteSpan);
        }
        tr.appendChild(tdNote);

        frag.appendChild(tr);
      }

      tbody.appendChild(frag);

      // Restore cell focus if focus was inside tbody prior to render
      if (wasFocusInTbody && activeCellCoord.itemId) {
        const activeTd = tbody.querySelector('td[data-gt-cell][tabindex="0"]');
        if (activeTd) activeTd.focus({ preventScroll: true });
      }

      renderMarkers(slots, presenting);
      renderBulkBar(selectedIds, slots, presenting);
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

      const tr = tbody.querySelector(`tr[data-item-id="${CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')}"]`);
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
