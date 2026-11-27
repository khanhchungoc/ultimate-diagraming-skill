// Gantt diagram <-> Mermaid. Plain script, no DOM, no imports; concatenated after assets/shell/mermaid-flow.js
// (uses mmdText, mmdSafeId). Spec: dev/plans/plan-gantt.md.

const MMD_GANTT_ZOOMS = ['day', 'week', '2week', 'month', 'quarter', 'year'];
const MMD_GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone', 'vert']);
const MMD_GANTT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MMD_GANTT_COLOR_RE = /^(?:[1-9]|#[0-9a-f]{3,8})$/i;
const MMD_GANTT_DEP_TYPES = { fs: 'fs', 'finish-start': 'fs', ss: 'ss', 'start-start': 'ss' };
const MMD_GANTT_KEYS = [
  'diagramType', 'schemaVersion', 'title', 'zoom', 'showNotes', 'showToday',
  'colorKey', 'holidays', 'markers', 'items', 'dependencies', 'notes', '_holidaysMode',
];

// Deterministic UTC calendar date math (epoch days integer; no local timezone drift, no Date.now()).
function mmdGanttParseDate(s) {
  const m = MMD_GANTT_DATE_RE.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
}

function mmdGanttFormatDate(dayNum) {
  const dt = new Date(dayNum * 86400000);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function mmdGanttAddDays(iso, delta) {
  const day = mmdGanttParseDate(iso);
  if (day === null) return null;
  return mmdGanttFormatDate(day + delta);
}

function mmdGanttParseDuration(token) {
  const m = /^(\d+)\s*([dwh])$/i.exec(String(token == null ? '' : token).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'd') return n;
  if (unit === 'w') return n * 7;
  return n === 0 ? 0 : Math.max(1, Math.ceil(n / 24));
}

function mmdGanttSlug(label, used, prefix) {
  let s = String(label == null ? '' : label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = prefix || 'item';
  else if (/^[0-9]/.test(s)) s = (prefix || 's') + '_' + s;
  else if (prefix) s = prefix + '_' + s;
  return mmdSafeId(s, used);
}

function mmdGanttEscNote(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n');
}

function mmdGanttUnescNote(s) {
  return String(s == null ? '' : s).replace(/\\([\\n])/g, (_, c) => (c === 'n' ? '\n' : '\\'));
}

function mmdGanttEscLabel(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/:/g, '#58;')
    .trim();
}

function fromMermaid(text, opts) {
  opts = opts || {};
  const infos = [], warnings = [];
  const info = (s) => infos.push('[INFO] ' + s);
  const warn = (s) => warnings.push('[WARN] ' + s);
  const once = new Set();
  const infoOnce = (key, s) => { if (!once.has(key)) { once.add(key); info(s); } };

  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let li = 0, ln = 0, headerSeen = false;
  let title = null, schemaVersion = 1, zoom = 'month', showNotes = false, showToday = true;
  let holidaysMode = null;

  // Optional YAML front-matter
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const fm = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (fm) {
        let v = fm[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ''); } }
        else if (v[0] === "'") v = v.replace(/^'|'$/g, '');
        title = mmdText(v);
      }
      li++;
    }
    li++;
  }

  const colorKey = {};
  const holidays = [], holidaySeen = new Set();
  const markers = [], markerIds = new Set();
  const items = [], itemById = new Map(), usedIds = new Set();
  const dependencies = [], depSeen = new Set();
  const notes = [];
  const deferred = []; // directives that reference item IDs, applied after all items are parsed

  let currentSectionId = null;
  let lastTaskEnd = null;
  let pendingSectionId = null;

  function addHoliday(date, end, name, country) {
    const k = date + '|' + end + '|' + name;
    if (holidaySeen.has(k)) return;
    holidaySeen.add(k);
    const h = { date, end, name };
    if (country) h.country = country;
    holidays.push(h);
  }

  function addDep(from, to, type) {
    const k = from + '|' + to + '|' + type;
    if (depSeen.has(k)) return;
    depSeen.add(k);
    dependencies.push({ from, to, type });
  }

  function parseDirective(key, args, line) {
    let m;
    switch (key) {
      case 'schemaVersion': {
        const n = Number(args);
        if (args !== '' && Number.isInteger(n) && n >= 1) schemaVersion = n;
        else warn('line ' + line + ': @schemaVersion needs a positive integer, ignored');
        break;
      }
      case 'zoom': {
        const z = args.toLowerCase();
        if (MMD_GANTT_ZOOMS.includes(z)) zoom = z;
        else warn('line ' + line + ': invalid @zoom "' + args + '", ignored');
        break;
      }
      case 'showNotes':
        showNotes = /^false$/i.test(args) ? false : true;
        break;
      case 'showToday':
        showToday = /^false$/i.test(args) ? false : true;
        break;
      case 'holidays': {
        const low = args.toLowerCase();
        if (low === 'auto' || low === 'none') {
          holidaysMode = low;
        } else {
          const codes = args.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
          if (codes.length && codes.every((c) => /^[A-Z]{2}$/.test(c))) holidaysMode = codes.join(',');
          else warn('line ' + line + ': invalid @holidays "' + args + '", expected auto, none, or country codes');
        }
        break;
      }
      case 'holiday': {
        m = /^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?(?:\s+([\s\S]+))?$/.exec(args);
        if (!m) { warn('line ' + line + ': invalid @holiday "' + args + '"'); break; }
        const sDay = mmdGanttParseDate(m[1]);
        const eIso = m[2] || m[1];
        const eDay = mmdGanttParseDate(eIso);
        if (sDay === null || eDay === null) { warn('line ' + line + ': invalid date in @holiday "' + args + '"'); break; }
        if (eDay < sDay) { warn('line ' + line + ': @holiday end date is before start date'); break; }
        let rawName = (m[3] || 'Holiday').trim();
        let country = '';
        const cm = /^(.*?)\s+\[([A-Z]{2})\]$/.exec(rawName);
        if (cm) { rawName = cm[1].trim(); country = cm[2]; }
        addHoliday(m[1], eIso, mmdText(rawName) || 'Holiday', country);
        break;
      }
      case 'colorKey': {
        if (/^[1-9]\s*:/.test(args)) {
          const entries = args.split(/,\s*(?=[1-9]\s*:)/);
          entries.forEach((entry) => {
            const em = /^([1-9])\s*:\s*([\s\S]+)$/.exec(entry.trim());
            if (em) colorKey[em[1]] = mmdText(em[2]);
            else warn('line ' + line + ': invalid @colorKey entry "' + entry.trim() + '"');
          });
        } else if ((m = /^([1-9])\s+([\s\S]+)$/.exec(args))) {
          colorKey[m[1]] = mmdText(m[2]);
        } else {
          warn('line ' + line + ': invalid @colorKey "' + args + '"');
        }
        break;
      }
      case 'marker': {
        m = /^([\s\S]+?)\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?$/.exec(args);
        if (!m) { warn('line ' + line + ': invalid @marker "' + args + '"'); break; }
        if (mmdGanttParseDate(m[2]) === null) { warn('line ' + line + ': invalid date in @marker "' + m[2] + '"'); break; }
        const label = mmdText(m[1]);
        const mk = { id: mmdGanttSlug(label, markerIds, 'm'), label, date: m[2] };
        if (m[3]) {
          if (MMD_GANTT_COLOR_RE.test(m[3])) mk.color = m[3];
          else warn('line ' + line + ': invalid color "' + m[3] + '" in @marker, ignored');
        }
        markers.push(mk);
        break;
      }
      case 'id': {
        if (/^\S+$/.test(args)) pendingSectionId = args;
        else warn('line ' + line + ': @id needs a single identifier, ignored');
        break;
      }
      case 'parent':
      case 'dep':
      case 'color':
      case 'collapsed':
      case 'note':
        deferred.push({ key, args, line });
        break;
      case 'progress':
      case 'type':
        break;
      default:
        info('line ' + line + ': unknown directive @' + key + ' ignored');
    }
  }

  function parseTaskLine(lineStr) {
    const colonIdx = lineStr.lastIndexOf(':');
    if (colonIdx <= 0) { warn('line ' + ln + ': not understood, skipped: ' + lineStr); return; }
    const label = mmdText(lineStr.slice(0, colonIdx));
    const meta = lineStr.slice(colonIdx + 1);
    const tokens = meta.split(',').map((s) => s.trim()).filter(Boolean);
    if (!tokens.length) { warn('line ' + ln + ': missing task dates for "' + label + '"'); return; }

    const tags = new Set();
    let idx = 0;
    while (idx < tokens.length && MMD_GANTT_TAGS.has(tokens[idx].toLowerCase())) {
      tags.add(tokens[idx].toLowerCase());
      idx++;
    }
    const rest = tokens.slice(idx);
    if (!rest.length || rest.length > 3) {
      warn('line ' + ln + ': cannot parse task metadata for "' + label + '"');
      return;
    }

    const isDate = (t) => MMD_GANTT_DATE_RE.test(t);
    const isAfter = (t) => /^after\s+\S+/i.test(t);
    const isDur = (t) => mmdGanttParseDuration(t) !== null;

    let rawId = null, startSpec = null, endSpec = null;
    if (rest.length === 3) {
      rawId = rest[0];
      startSpec = rest[1];
      endSpec = rest[2];
    } else if (rest.length === 2) {
      if (isDate(rest[0]) || isAfter(rest[0])) {
        startSpec = rest[0];
        endSpec = rest[1];
      } else {
        rawId = rest[0];
        startSpec = rest[1];
        endSpec = null;
      }
    } else {
      if (isDate(rest[0]) || isAfter(rest[0])) {
        startSpec = rest[0];
        endSpec = null;
      } else if (isDur(rest[0])) {
        startSpec = null;
        endSpec = rest[0];
      } else {
        warn('line ' + ln + ': cannot parse task "' + label + '"');
        return;
      }
    }

    let id;
    if (rawId) {
      if (itemById.has(rawId)) {
        warn('line ' + ln + ': duplicate id "' + rawId + '"');
        id = mmdSafeId(rawId, usedIds);
      } else {
        id = rawId;
        usedIds.add(id);
      }
    } else {
      id = mmdGanttSlug(label, usedIds);
    }

    // Resolve start
    let start = null;
    const afterRefs = [];
    if (startSpec === null) {
      if (lastTaskEnd) start = lastTaskEnd;
      else { warn('line ' + ln + ': duration-only task "' + label + '" has no previous task to follow'); return; }
    } else if (isAfter(startSpec)) {
      const refIds = startSpec.replace(/^after\s+/i, '').trim().split(/\s+/).filter(Boolean);
      let latestDay = null;
      refIds.forEach((refId) => {
        const ref = itemById.get(refId);
        if (!ref) {
          warn('line ' + ln + ': unknown task "' + refId + '" in "after"');
          return;
        }
        afterRefs.push(refId);
        const refEnd = ref.end || ref.start;
        const d = refEnd ? mmdGanttParseDate(refEnd) : null;
        if (d !== null && (latestDay === null || d > latestDay)) latestDay = d;
      });
      if (latestDay === null) {
        warn('line ' + ln + ': could not resolve start date from "' + startSpec + '"');
        return;
      }
      start = mmdGanttFormatDate(latestDay);
    } else if (isDate(startSpec)) {
      if (mmdGanttParseDate(startSpec) === null) {
        warn('line ' + ln + ': invalid start date "' + startSpec + '" for "' + label + '"');
        return;
      }
      start = startSpec;
    } else {
      warn('line ' + ln + ': invalid start "' + startSpec + '" for "' + label + '"');
      return;
    }

    // Resolve kind and end
    const isMilestone = tags.has('milestone');
    let end = start;
    if (!isMilestone) {
      if (endSpec === null) {
        end = start;
      } else if (isDate(endSpec)) {
        const sDay = mmdGanttParseDate(start);
        const eDay = mmdGanttParseDate(endSpec);
        if (eDay === null) {
          warn('line ' + ln + ': invalid end date "' + endSpec + '" for "' + label + '"');
          return;
        }
        if (eDay < sDay) warn('line ' + ln + ': end date "' + endSpec + '" is before start date "' + start + '" for "' + label + '"');
        end = endSpec;
      } else if (isDur(endSpec)) {
        const days = mmdGanttParseDuration(endSpec);
        end = mmdGanttAddDays(start, days);
      } else {
        warn('line ' + ln + ': invalid end or duration "' + endSpec + '" for "' + label + '"');
        return;
      }
    }

    const item = {
      id,
      kind: isMilestone ? 'milestone' : 'task',
      label,
    };
    if (currentSectionId) item.parent = currentSectionId;
    item.start = start;
    item.end = end;

    items.push(item);
    itemById.set(id, item);
    lastTaskEnd = end;
    afterRefs.forEach((refId) => addDep(refId, id, 'fs'));
  }

  for (; li < lines.length; li++) {
    ln = li + 1;
    const raw = lines[li].trim();
    if (!raw) continue;
    if (raw.startsWith('%%')) {
      const dm = /^%%\s*@(\w+)(?:\s+([\s\S]*))?$/.exec(raw);
      if (dm) parseDirective(dm[1], (dm[2] || '').trim(), ln);
      continue;
    }
    if (!headerSeen) {
      if (!/^gantt\b/i.test(raw)) throw new Error('line ' + ln + ': expected "gantt"');
      headerSeen = true;
      continue;
    }

    let m;
    if ((m = /^title(?:\s*:\s*|\s+)([\s\S]+)$/i.exec(raw))) {
      title = mmdText(m[1]);
    } else if ((m = /^dateFormat\s+(\S+)$/i.exec(raw))) {
      if (m[1].toUpperCase() !== 'YYYY-MM-DD') {
        infoOnce('datefmt', 'dateFormat "' + m[1] + '" is not YYYY-MM-DD; dates are parsed as YYYY-MM-DD');
      }
    } else if ((m = /^excludes\s+([\s\S]+)$/i.exec(raw))) {
      m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((tok) => {
        if (MMD_GANTT_DATE_RE.test(tok)) {
          if (mmdGanttParseDate(tok) !== null) addHoliday(tok, tok, 'Excluded', '');
          else warn('line ' + ln + ': invalid date "' + tok + '" in excludes');
        } else {
          infoOnce('excludes-kw', 'non-date excludes ("' + tok + '") are not skipped in duration math; weekends are shaded visually');
        }
      });
    } else if ((m = /^section\s+([\s\S]+)$/i.exec(raw))) {
      const label = mmdText(m[1]);
      let secId;
      if (pendingSectionId) {
        if (itemById.has(pendingSectionId)) {
          warn('line ' + ln + ': duplicate id "' + pendingSectionId + '"');
          secId = mmdSafeId(pendingSectionId, usedIds);
        } else {
          secId = pendingSectionId;
          usedIds.add(secId);
        }
        pendingSectionId = null;
      } else {
        secId = mmdGanttSlug(label, usedIds);
      }
      const grp = { id: secId, kind: 'group', label };
      items.push(grp);
      itemById.set(secId, grp);
      currentSectionId = secId;
    } else if (/^(axisFormat|tickInterval|todayMarker|weekday|weekend|includes|accTitle|accDescr|click)\b/i.test(raw)) {
      const kw = raw.split(/[\s:]/)[0];
      infoOnce('ign-' + kw.toLowerCase(), '"' + kw + '" is not used by gantt diagrams, ignored');
    } else if (raw.includes(':')) {
      pendingSectionId = null;
      parseTaskLine(raw);
    } else {
      warn('line ' + ln + ': not understood, skipped: ' + raw);
    }
  }

  if (!headerSeen) throw new Error('line 1: expected "gantt"');

  // Apply deferred item-level directives now that all items exist
  deferred.forEach((d) => {
    const a = d.args;
    let m;
    switch (d.key) {
      case 'parent': {
        m = /^(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @parent needs <id> <parentId>'); break; }
        const child = itemById.get(m[1]);
        if (!child) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @parent'); break; }
        if (m[2].toLowerCase() === 'none' || m[2].toLowerCase() === 'root') {
          delete child.parent;
        } else if (m[1] === m[2]) {
          warn('line ' + d.line + ': item "' + m[1] + '" cannot be its own parent');
        } else if (!itemById.has(m[2])) {
          warn('line ' + d.line + ': unknown parent "' + m[2] + '" in @parent');
        } else {
          child.parent = m[2];
        }
        break;
      }
      case 'dep': {
        m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @dep needs <toId> <fs|ss|finish-start|start-start> <fromId>'); break; }
        const toId = m[1], rawType = m[2].toLowerCase(), fromId = m[3];
        const depType = MMD_GANTT_DEP_TYPES[rawType];
        if (!depType) { warn('line ' + d.line + ': invalid dependency type "' + m[2] + '" in @dep'); break; }
        if (!itemById.has(toId)) { warn('line ' + d.line + ': unknown target "' + toId + '" in @dep'); break; }
        if (!itemById.has(fromId)) { warn('line ' + d.line + ': unknown source "' + fromId + '" in @dep'); break; }
        if (fromId === toId) { warn('line ' + d.line + ': self-dependency on "' + fromId + '" ignored'); break; }
        addDep(fromId, toId, depType);
        break;
      }
      case 'color': {
        m = /^(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @color needs <id> <1..9|#hex>'); break; }
        const it = itemById.get(m[1]);
        if (!it) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @color'); break; }
        if (!MMD_GANTT_COLOR_RE.test(m[2])) { warn('line ' + d.line + ': invalid color "' + m[2] + '" in @color'); break; }
        it.color = m[2];
        break;
      }
      case 'collapsed': {
        m = /^(\S+)(?:\s+(\S+))?$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @collapsed needs <id>'); break; }
        const it = itemById.get(m[1]);
        if (!it) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @collapsed'); break; }
        if (m[2] && /^false$/i.test(m[2])) delete it.collapsed;
        else it.collapsed = true;
        break;
      }
      case 'note': {
        m = /^(\S+)\s+([\s\S]+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @note needs <id> <text>'); break; }
        if (!itemById.has(m[1])) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @note'); break; }
        notes.push({ id: 'n' + (notes.length + 1), text: mmdGanttUnescNote(m[2]), target: m[1] });
        break;
      }
    }
  });

  if (!items.some((it) => it.kind === 'task' || it.kind === 'milestone')) {
    warn('the chart has no tasks or milestones');
  }

  const rawData = {
    diagramType: 'gantt',
    schemaVersion,
    zoom,
    showNotes,
    showToday,
    items,
    dependencies,
  };
  if (title !== null) rawData.title = title;
  if (Object.keys(colorKey).length) rawData.colorKey = colorKey;
  if (holidays.length) rawData.holidays = holidays;
  if (markers.length) rawData.markers = markers;
  if (notes.length) rawData.notes = notes;
  if (holidaysMode !== null) rawData._holidaysMode = holidaysMode;

  const data = {};
  MMD_GANTT_KEYS.forEach((k) => { if (k in rawData) data[k] = rawData[k]; });
  return { data, infos, warnings };
}

function toMermaid(data, opts) {
  opts = opts || {};
  const d = data || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const deps = Array.isArray(d.dependencies) ? d.dependencies : [];
  const holidays = Array.isArray(d.holidays) ? d.holidays : [];
  const markers = Array.isArray(d.markers) ? d.markers : [];
  const notes = Array.isArray(d.notes) ? d.notes : [];
  const ck = d.colorKey && typeof d.colorKey === 'object' ? d.colorKey : {};

  // Assign safe unique IDs for all items
  const used = new Set(), idMap = new Map();
  items.forEach((it) => {
    if (!it || it.id == null) return;
    const raw = String(it.id);
    if (!idMap.has(raw)) idMap.set(raw, mmdSafeId(raw, used));
  });
  const sid = (id) => idMap.get(String(id)) || mmdSafeId(String(id));

  // Precompute fallback rolled-up date bounds for parent tasks that lack explicit start/end
  const childrenOf = new Map();
  items.forEach((it) => {
    if (it && it.parent) {
      if (!childrenOf.has(it.parent)) childrenOf.set(it.parent, []);
      childrenOf.get(it.parent).push(it);
    }
  });
  function effectiveDates(it, seen) {
    if (it.start && it.end) return [it.start, it.end];
    const vis = seen || new Set();
    if (vis.has(it.id)) return [null, null];
    vis.add(it.id);
    let minD = null, maxD = null;
    (childrenOf.get(it.id) || []).forEach((ch) => {
      const [cs, ce] = effectiveDates(ch, vis);
      const sd = cs ? mmdGanttParseDate(cs) : null;
      const ed = ce ? mmdGanttParseDate(ce) : null;
      if (sd !== null && (minD === null || sd < minD)) minD = sd;
      if (ed !== null && (maxD === null || ed > maxD)) maxD = ed;
    });
    if (minD !== null && maxD !== null) return [mmdGanttFormatDate(minD), mmdGanttFormatDate(maxD)];
    return [it.start || null, it.end || it.start || null];
  }

  // Index notes by target so directives sit cleanly under their item
  const notesByTarget = new Map();
  const emittedNotes = new Set();
  notes.forEach((n, i) => {
    if (!n || !n.target) return;
    if (!notesByTarget.has(n.target)) notesByTarget.set(n.target, []);
    notesByTarget.get(n.target).push({ n, i });
  });

  const out = ['gantt'];
  const ind = '    ';
  if (d.title) out.push(ind + 'title ' + String(d.title).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim());
  out.push(ind + 'dateFormat YYYY-MM-DD');
  if (d.schemaVersion != null && d.schemaVersion !== 1) out.push(ind + '%% @schemaVersion ' + d.schemaVersion);
  if (d.zoom && MMD_GANTT_ZOOMS.includes(String(d.zoom).toLowerCase())) out.push(ind + '%% @zoom ' + String(d.zoom).toLowerCase());
  if (d.showNotes === true) out.push(ind + '%% @showNotes true');
  if (d.showToday === false) out.push(ind + '%% @showToday false');
  if (d._holidaysMode) out.push(ind + '%% @holidays ' + d._holidaysMode);

  const ckKeys = Object.keys(ck).filter((k) => /^[1-9]$/.test(k) && ck[k] != null && String(ck[k]).trim() !== '')
    .sort((a, b) => Number(a) - Number(b));
  if (ckKeys.length) {
    out.push(ind + '%% @colorKey ' + ckKeys.map((k) => k + ': ' + String(ck[k]).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim()).join(', '));
  }

  holidays.forEach((h) => {
    if (!h || !h.date) return;
    const span = h.end && h.end !== h.date ? h.date + '..' + h.end : h.date;
    const name = String(h.name || 'Holiday').replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim();
    const cc = h.country && /^[A-Z]{2}$/.test(h.country) ? ' [' + h.country + ']' : '';
    out.push(ind + '%% @holiday ' + span + ' ' + name + cc);
  });

  markers.forEach((mk) => {
    if (!mk || !mk.label || !mk.date) return;
    const label = String(mk.label).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim();
    const col = mk.color != null && mk.color !== '' ? ' ' + mk.color : '';
    out.push(ind + '%% @marker ' + label + ' : ' + mk.date + col);
  });

  // Track slugs as fromMermaid would assign them to know when a section needs `%% @id`
  const simUsed = new Set();
  let currentSectionId = null;

  items.forEach((it) => {
    if (!it || it.id == null) return;
    const id = sid(it.id);

    if (it.kind === 'group') {
      out.push('');
      const autoSlug = mmdGanttSlug(it.label || '', new Set(simUsed));
      if (id !== autoSlug) out.push(ind + '%% @id ' + id);
      simUsed.add(id);
      out.push(ind + 'section ' + String(it.label || id).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim());
      currentSectionId = it.id;
      if (it.parent) out.push(ind + '%% @parent ' + id + ' ' + sid(it.parent));
      if (it.color != null && it.color !== '') out.push(ind + '%% @color ' + id + ' ' + it.color);
      if (it.collapsed === true) out.push(ind + '%% @collapsed ' + id);
    } else {
      simUsed.add(id);
      const label = mmdGanttEscLabel(it.label || id);
      const [start, end] = effectiveDates(it);
      if (it.kind === 'milestone') {
        out.push(ind + label + ' :milestone, ' + id + ', ' + (start || '2026-01-01') + ', 0d');
      } else {
        out.push(ind + label + ' :' + id + ', ' + (start || '2026-01-01') + ', ' + (end || start || '2026-01-01'));
      }
      if (it.parent && it.parent !== currentSectionId) {
        out.push(ind + '%% @parent ' + id + ' ' + sid(it.parent));
      } else if (!it.parent && currentSectionId !== null) {
        out.push(ind + '%% @parent ' + id + ' none');
      }
      if (it.color != null && it.color !== '') out.push(ind + '%% @color ' + id + ' ' + it.color);
      if (it.collapsed === true) out.push(ind + '%% @collapsed ' + id);
    }

    (notesByTarget.get(it.id) || []).forEach(({ n, i }) => {
      emittedNotes.add(i);
      out.push(ind + '%% @note ' + sid(n.target) + ' ' + mmdGanttEscNote(n.text));
    });
  });

  // Emit dependencies in exact array order so round-trips preserve order
  const validDeps = deps.filter((dep) => dep && dep.from && dep.to);
  if (validDeps.length) {
    out.push('');
    validDeps.forEach((dep) => {
      const t = dep.type === 'ss' ? 'ss' : 'fs';
      out.push(ind + '%% @dep ' + sid(dep.to) + ' ' + t + ' ' + sid(dep.from));
    });
  }
  notes.forEach((n, i) => {
    if (emittedNotes.has(i) || !n || !n.target) return;
    out.push(ind + '%% @note ' + sid(n.target) + ' ' + mmdGanttEscNote(n.text));
  });

  return out.join('\n') + '\n';
}
