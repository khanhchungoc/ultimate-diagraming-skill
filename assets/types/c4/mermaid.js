// C4 <-> Mermaid C4 (plan: dev/plans/plan-c4.md, "Mermaid C4"). Plain script, globals only, no DOM, no imports; concatenated
// after assets/shell/mermaid-flow.js (uses mmdText, mmdQuote, mmdSafeId). Mermaid C4 is its own syntax, so this file has its
// own small scanner (helpers start with mmdC4); the flowchart tokenizer does not apply. Mermaid marks C4 experimental.
//   fromMermaid(text)      -> { data, infos, warnings }   authoring JSON, no positions; infos/warnings start with [INFO] / [WARN]
//   toMermaid(data, opts)  -> string
//
// One level is written: C4Context when no system group is open (every one collapsed, or none), else C4Container (C4Component
// when the open level holds components and no containers) for the first open system group; other system groups and every
// collapsed group are one `System` (relations that cross their border are merged onto them). What Mermaid has no place for
// travels as `%% @...` comment lines at the end (Mermaid skips `%%` lines), and only when the fact is set:
//   @icon id name   @color id slot|#hex   @core id   @side id N|S|E|W   @tech id text (kinds with no techn slot)
//   @arrange surround|flow|layers   @showTech   @showNotes   @colorKey slot text
// Lost on export: async, notes, positions, collapsed state, the inside of a collapsed group.

const MMD_C4_FAMILIES = [['Person', 'person'], ['System', 'system'], ['Container', 'container'], ['Component', 'component']];
// statement -> [kind, icon, has a techn slot]; `_Ext` is the external system (an external database or queue keeps its glyph)
const MMD_C4_ELEMS = {};
MMD_C4_FAMILIES.forEach(([fam, kind]) => [['', kind, ''], ['Db', 'database', 'database'], ['Queue', 'queue', 'queue']].forEach(([suf, k, icon]) => {
  if (fam === 'Person' && suf) return;
  const techn = fam === 'Container' || fam === 'Component';
  MMD_C4_ELEMS[fam + suf] = [k, '', techn];
  MMD_C4_ELEMS[fam + suf + '_Ext'] = fam === 'Person' ? [k, '', techn] : ['external', icon, techn];
}));
const MMD_C4_BOUNDS = { Enterprise_Boundary: 'boundary', Boundary: 'boundary', System_Boundary: 'system', Container_Boundary: 'system' };
const MMD_C4_RELS = ['Rel', 'BiRel', 'Rel_U', 'Rel_Up', 'Rel_D', 'Rel_Down', 'Rel_L', 'Rel_Left', 'Rel_R', 'Rel_Right', 'Rel_Back', 'RelIndex'];
const MMD_C4_STYLE = /^(UpdateElementStyle|UpdateRelStyle|UpdateLayoutConfig|Lay_[A-Za-z]+|accTitle|accDescr|sprite|SetPropertyHeader|AddProperty)$/;
const MMD_C4_HEADERS = { C4Context: 1, C4Container: 2, C4Component: 3 };
const MMD_C4_SIDES = ['N', 'S', 'E', 'W'];
const MMD_C4_ARRANGES = ['surround', 'flow', 'layers'];

// One call `Name(arg, "arg", $key="v")` starting at s[i] (just after the "("): { args, named, end } or null when never closed.
function mmdC4Args(s, i) {
  const args = [], named = {};
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (s[i] === ')') return { args, named, end: i + 1 };
    let key = null;
    const km = /^\$([A-Za-z]\w*)\s*=\s*/.exec(s.slice(i));
    if (km) { key = km[1]; i += km[0].length; }
    let v;
    if (s[i] === '"') {
      let j = i + 1;
      v = '';
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && s[j + 1] === '"') j++; v += s[j++]; }
      if (j >= s.length) return null;
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ',' && s[j] !== ')') j++;
      if (j >= s.length) return null;
      v = s.slice(i, j);
      i = j;
    }
    v = mmdText(v);
    if (key) named[key] = v; else args.push(v);
  }
  return null;
}

// Slot names per statement, to merge positional and `$named` arguments.
function mmdC4Slots(name) {
  if (MMD_C4_ELEMS[name]) return MMD_C4_ELEMS[name][2] ? ['alias', 'label', 'techn', 'descr'] : ['alias', 'label', 'descr'];
  if (MMD_C4_BOUNDS[name]) return ['alias', 'label'];
  return name === 'RelIndex' ? ['index', 'from', 'to', 'label', 'techn', 'descr'] : ['from', 'to', 'label', 'techn', 'descr'];
}

function fromMermaid(text) {
  const infos = [], warnings = [];
  const info = (line, msg) => infos.push('[INFO] line ' + line + ': ' + msg);
  const warn = (line, msg) => warnings.push('[WARN] line ' + line + ': ' + msg);
  const lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r?\n/);
  const data = { diagramType: 'c4', schemaVersion: 1 };
  const groups = [], elements = [], relations = [], hints = [];
  const ids = new Map();                 // alias -> { o, group: bool }
  const stack = [];                      // open boundary groups
  const seenKinds = new Set();
  let pending = null, header = '', title = '', inFront = false;
  let ext = 0;

  lines.forEach((raw, n) => {
    const ln = n + 1;
    let s = raw.trim();
    if (!s) return;
    if (!header && ln === 1 + lines.findIndex(l => l.trim()) && s === '---') { inFront = true; return; }
    if (inFront) {
      if (s === '---') inFront = false;
      else { const m = /^title:\s*(.*)$/.exec(s); if (m) title = m[1].replace(/^(["'])([\s\S]*)\1$/, '$2'); }
      return;
    }
    if (s.startsWith('%%')) {
      const m = /^%%\s*@(\w+)\s*(.*)$/.exec(s);
      if (m) hints.push({ line: ln, key: m[1], arg: m[2].trim() });
      return;
    }
    if (!header) {
      const m = /^(C4[A-Za-z]*)\b/.exec(s);
      if (!m) throw new Error('line ' + ln + ': this is not a Mermaid C4 diagram: it must start with C4Context, C4Container or C4Component, not "' + s.split(/\s+/)[0] + '"');
      if (!MMD_C4_HEADERS[m[1]]) throw new Error(m[1] + ' is not supported: this tool reads C4Context, C4Container and C4Component (Dynamic and Deployment views are not part of the model)');
      header = m[1];
      return;
    }
    while (s) {
      let m;
      if (s.startsWith('%%')) return;
      if (s[0] === '}') { if (stack.length) stack.pop(); else warn(ln, 'a "}" closes nothing, ignored'); s = s.slice(1).trim(); continue; }
      if (s[0] === '{') {
        if (pending) { stack.push(pending); pending = null; } else warn(ln, 'a "{" opens no boundary, ignored');
        s = s.slice(1).trim();
        continue;
      }
      if ((m = /^title\b[ \t]*(.*)$/.exec(s))) { title = m[1].replace(/^"([\s\S]*)"$/, '$1'); return; }
      if (!(m = /^([A-Za-z_]\w*)\s*\(/.exec(s))) { warn(ln, 'not understood, ignored: ' + s); return; }
      const name = m[1], call = mmdC4Args(s, m[0].length);
      if (!call) { warn(ln, name + '( is not closed, ignored'); return; }
      s = s.slice(call.end).trim();
      const slots = mmdC4Slots(name), a = {};
      call.args.forEach((v, i) => { if (slots[i]) a[slots[i]] = v; });
      Object.keys(call.named).forEach(k => { if (slots.includes(k)) a[k] = call.named[k]; });
      if (MMD_C4_STYLE.test(name)) {
        if (!seenKinds.has(name)) { seenKinds.add(name); info(ln, name + ' is not used: styling and layout come from the page, ignored'); }
      } else if (MMD_C4_ELEMS[name] || MMD_C4_BOUNDS[name]) {
        const group = !!MMD_C4_BOUNDS[name];
        if (!a.alias || ids.has(a.alias)) { warn(ln, (a.alias ? 'duplicate id "' + a.alias + '"' : name + ' has no id') + ', ignored'); if (group) pending = { skip: true }; continue; }
        const parent = stack.length ? stack[stack.length - 1] : null;
        if (group) {
          const g = { id: a.alias, name: a.label || a.alias, kind: MMD_C4_BOUNDS[name] };
          if (name === 'Container_Boundary') info(ln, 'Container_Boundary read as a system group (container groups arrive with Level 3)');
          if (parent && !parent.skip) g.parent = parent.id;
          groups.push(g); ids.set(a.alias, { o: g, group: true });
          pending = g;
        } else {
          const [kind, icon] = MMD_C4_ELEMS[name];
          const e = { id: a.alias, kind, name: a.label || a.alias };
          if (a.descr) e.description = a.descr;
          if (a.techn) e.tech = a.techn;
          if (icon) e.icon = icon;
          if (name === 'Person_Ext' && !ext++) info(ln, 'Person_Ext read as a person (an external person has no kind of its own)');
          if (parent && !parent.skip) e.group = parent.id;
          elements.push(e); ids.set(a.alias, { o: e, group: false });
        }
      } else if (MMD_C4_RELS.includes(name)) {
        if ((name === 'RelIndex' || name === 'BiRel') && !seenKinds.has(name)) info(ln, name + ' read as ' + (name === 'BiRel' ? 'two relations, one each way' : 'a plain relation'));
        seenKinds.add(name);
        const ends = [ids.get(a.from), ids.get(a.to)];
        if (!a.from || !a.to || ends.some(x => !x || x.group)) { warn(ln, name + ' joins "' + a.from + '" and "' + a.to + '": both must be elements declared before it, ignored'); continue; }
        if (a.from === a.to) { warn(ln, name + ' joins "' + a.from + '" to itself, ignored'); continue; }
        const r = { from: a.from, to: a.to, label: a.label || ' ' };
        if (a.techn) r.tech = a.techn;
        relations.push(r);
        if (name === 'BiRel') relations.push({ ...r, from: a.to, to: a.from });
      } else warn(ln, name + ' is not a C4 statement this tool reads, ignored');
    }
  });
  if (!header) throw new Error('this is not a Mermaid C4 diagram: it must start with C4Context, C4Container or C4Component');
  if (stack.length || pending) warnings.push('[WARN] a boundary is never closed with "}"');

  const target = (h, raw) => { const t = ids.get(raw.split(/\s+/)[0]); if (!t) warn(h.line, '@' + h.key + ' names unknown id "' + raw.split(/\s+/)[0] + '"'); return t && t.o; };
  const colorKey = {};
  hints.forEach(h => {
    let m = /^(\S+)\s*([\s\S]*)$/.exec(h.arg) || [];
    switch (h.key) {
      case 'arrange': if (MMD_C4_ARRANGES.includes(h.arg)) data.arrange = h.arg; else warn(h.line, '@arrange needs surround, flow or layers'); break;
      case 'showTech': data.showTech = true; break;
      case 'showNotes': data.showNotes = true; break;
      case 'colorKey': if ((m = /^(\d)\s+(.+)$/.exec(h.arg))) colorKey[m[1]] = m[2].trim(); break;
      case 'icon': case 'tech': { const o = m[2] && target(h, h.arg); if (o) o[h.key === 'tech' ? 'tech' : 'icon'] = m[2].trim(); break; }
      case 'core': { const o = h.arg && target(h, h.arg); if (o) o.core = true; break; }
      case 'side': { const o = h.arg && target(h, h.arg); if (o) { if (MMD_C4_SIDES.includes(m[2].trim())) o.side = m[2].trim(); else warn(h.line, '@side needs N, S, E or W'); } break; }
      case 'color': {
        const o = m[2] && target(h, h.arg), v = (m[2] || '').trim();
        if (o) { if (/^[1-9]$|^#[0-9a-f]{3,8}$/i.test(v)) o.color = v; else warn(h.line, '@color needs a slot 1 to 9 or a #hex'); }
        break;
      }
      default: info(h.line, 'unknown directive @' + h.key + ' ignored');
    }
  });

  if (title) data.title = title;
  if (Object.keys(colorKey).length) data.colorKey = colorKey;
  data.groups = groups;
  data.elements = elements;
  data.relations = relations;
  if (!elements.length) warnings.push('[WARN] the diagram has no elements');
  return { data, infos, warnings };
}

function toMermaid(data, opts) {
  opts = opts || {};
  const groups = data.groups || [], elements = data.elements || [], relations = data.relations || [];
  const used = new Set(), idMap = new Map();
  const sid = raw => { raw = String(raw); if (!idMap.has(raw)) idMap.set(raw, mmdSafeId(raw, used)); return idMap.get(raw); };
  groups.forEach(g => sid(g.id));
  elements.forEach(e => sid(e.id));
  const gById = new Map(groups.map(g => [g.id, g]));
  const chain = id => { const c = []; for (let g = gById.get(id); g && !c.includes(g); g = gById.get(g.parent)) c.unshift(g); return c; };   // root first
  const isTile = g => g.collapsed === true;

  // The open group: the first system group that is expanded and has no collapsed ancestor. Every other system group is one box.
  const open = groups.find(g => g.kind === 'system' && !isTile(g) && !chain(g.id).some(isTile));
  const tile = g => isTile(g) || (g.kind === 'system' && g !== open);
  const tileOf = gid => chain(gid).find(tile);                 // the outermost box that hides a group's inside
  const shown = elements.filter(e => !tileOf(e.group));
  const hasKind = k => shown.some(e => e.kind === k);
  const level = !open ? 'C4Context' : hasKind('component') && !hasKind('container') ? 'C4Component' : 'C4Container';
  const fam = { C4Context: 'System', C4Container: 'Container', C4Component: 'Component' }[level];

  const q = s => mmdQuote(String(s == null ? '' : s));
  const qa = s => (s ? q(s) : '""');
  const out = [level];
  if (data.title) out.push('  title ' + String(data.title).replace(/\s*\n\s*/g, ' '));
  const hints = [];
  const hintsOf = (o, withIcon) => {
    const id = sid(o.id);
    if (o.color != null && o.color !== '') hints.push('%% @color ' + id + ' ' + o.color);
    if (withIcon && o.icon) hints.push('%% @icon ' + id + ' ' + o.icon);
    if (o.core === true) hints.push('%% @core ' + id);
    if (MMD_C4_SIDES.includes(o.side)) hints.push('%% @side ' + id + ' ' + o.side);
  };
  const call = (name, ...args) => {
    while (args.length > 2 && args[args.length - 1] === '""') args.pop();
    return name + '(' + args.join(', ') + ')';
  };

  const element = (e, ind) => {
    const stmt = { person: 'Person', system: 'System', external: 'System_Ext', container: 'Container', component: 'Component',
      database: fam + 'Db', queue: fam + 'Queue' }[e.kind] || 'System';
    const techn = MMD_C4_ELEMS[stmt][2];
    out.push(ind + call(stmt, sid(e.id), q(e.name), ...(techn ? [qa(e.tech), qa(e.description)] : [qa(e.description)])));
    if (e.tech && !techn) hints.push('%% @tech ' + sid(e.id) + ' ' + String(e.tech).replace(/\s*\n\s*/g, ' '));
    hintsOf(e, true);
  };
  const box = (g, ind) => { out.push(ind + call('System', sid(g.id), q(g.name))); hintsOf(g, false); };
  const bucket = (list, key) => { const m = new Map(); list.forEach(o => { const k = o[key] || null; if (!m.has(k)) m.set(k, []); m.get(k).push(o); }); return m; };
  const elemsIn = bucket(elements, 'group'), groupsIn = bucket(groups, 'parent');
  const members = (gid, ind) => {
    (elemsIn.get(gid) || []).forEach(e => element(e, ind));
    const kids = groupsIn.get(gid) || [];
    kids.filter(tile).forEach(g => box(g, ind));   // boxes read back as elements, so they follow the elements
    kids.filter(g => !tile(g)).forEach(g => {
      const kw = g.kind === 'system' ? 'System_Boundary' : g.kind === 'container' ? 'Container_Boundary' : g.parent ? 'Boundary' : 'Enterprise_Boundary';
      out.push(ind + call(kw, sid(g.id), q(g.name)) + ' {');
      hintsOf(g, false);
      members(g.id, ind + '  ');
      out.push(ind + '}');
    });
  };
  members(null, '  ');

  // A relation that crosses a box is drawn on the box; several between the same two ends become one counted line.
  const byId = new Map(elements.map(e => [e.id, e]));
  const endOf = id => { const t = tileOf(byId.get(id).group); return t ? t.id : id; };
  const known = byId, lines = [], merged = new Map();
  relations.forEach(r => {
    if (!known.has(r.from) || !known.has(r.to)) return;
    const a = endOf(r.from), b = endOf(r.to);
    if (a === b) return;
    if (a === r.from && b === r.to) { lines.push({ a, b, label: r.label, tech: r.tech }); return; }
    const key = a + '\0' + b;
    if (!merged.has(key)) { const m = { a, b, rs: [] }; merged.set(key, m); lines.push(m); }
    merged.get(key).rs.push(r);
  });
  lines.forEach(l => {
    const one = l.rs ? (l.rs.length === 1 ? l.rs[0] : { label: l.rs.length + ' relations' }) : l;
    out.push('  ' + call('Rel', sid(l.a), sid(l.b), q(one.label), ...(one.tech ? [q(one.tech)] : [])));
  });

  if (data.arrange) out.push('%% @arrange ' + data.arrange);
  if (data.showTech) out.push('%% @showTech');
  if (data.showNotes) out.push('%% @showNotes');
  Object.keys(data.colorKey || {}).sort((a, b) => a - b).forEach(k => out.push('%% @colorKey ' + k + ' ' + String(data.colorKey[k]).replace(/\s*\n\s*/g, ' ')));
  out.push(...hints);
  return out.join('\n') + '\n';
}
