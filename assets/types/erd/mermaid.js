// ER diagram <-> Mermaid erDiagram (plan: dev/plans/plan-mermaid-input.md, "ERD").
// Plain script, globals only, no DOM, no imports; concatenated after assets/shell/mermaid-flow.js (uses mmdText, mmdQuote,
// mmdSafeId). The flowchart tokenizer does not apply: erDiagram has its own small tokenizer here (helpers start with mmdEr).
//   fromMermaid(text)      -> { data, infos, warnings }   authoring JSON, no positions; infos/warnings start with [INFO] / [WARN]
//   toMermaid(data, opts)  -> string                      opts.palette: 8 hex colours for c1..c8 (adds classDef lines)
//
// Every ERD field survives JSON -> Mermaid -> JSON. Where Mermaid has no place for a fact the writer adds a `%% @...`
// directive, and only when the fact is not already implied (so ordinary files stay short):
//   @childRight 7                       the right-hand table is the child although the cardinalities and keys say otherwise
// The line style is strict: `--` is identifying: true and `..` is identifying: false. The writer writes the effective values
// (the defaults the engine applies when a field is absent) and the reader always sets fromEnd, toEnd and identifying.
// Relationship ids (r1..) and note ids (n1..) are generated on import.

const MMD_ER_LEFT = { one: '||', zeroOrOne: '|o', oneOrMany: '}|', zeroOrMany: '}o' };
const MMD_ER_RIGHT = { one: '||', zeroOrOne: 'o|', oneOrMany: '|{', zeroOrMany: 'o{' };
const MMD_ER_SYM = { '||': 'one', '|o': 'zeroOrOne', 'o|': 'zeroOrOne', '}|': 'oneOrMany', '|{': 'oneOrMany', '}o': 'zeroOrMany', 'o{': 'zeroOrMany' };
const MMD_ER_WORD = {
  'zero or one': 'zeroOrOne', 'one or zero': 'zeroOrOne', 'zero or more': 'zeroOrMany', 'zero or many': 'zeroOrMany', 'many(0)': 'zeroOrMany',
  '0+': 'zeroOrMany', 'many': 'zeroOrMany', 'one or more': 'oneOrMany', 'one or many': 'oneOrMany', 'many(1)': 'oneOrMany', '1+': 'oneOrMany',
  'only one': 'one', 'one': 'one', '1': 'one',
};
const MMD_ER_CARD = '(?:zero or one|one or zero|zero or more|zero or many|one or more|one or many|only one|many\\(0\\)|many\\(1\\)|0\\+|1\\+|many|one|1)';
const MMD_ER_ENT = '("[^"]*"|[\\w\\u0080-\\uFFFF*-]+)(?::::([\\w,-]+))?';
const MMD_ER_MARK = '(\\|\\||\\|o|o\\||\\}\\||\\|\\{|\\}o|o\\{)';
const MMD_ER_REL_SYM = new RegExp('^' + MMD_ER_ENT + '\\s+' + MMD_ER_MARK + '(--|\\.\\.|\\.-|-\\.)' + MMD_ER_MARK + '\\s+' + MMD_ER_ENT + '\\s*(?::\\s*(.*))?$');
const MMD_ER_REL_WORD = new RegExp('^' + MMD_ER_ENT + '\\s+(' + MMD_ER_CARD + ')\\s+(optionally\\s+)?to\\s+(' + MMD_ER_CARD + ')\\s+' + MMD_ER_ENT + '\\s*(?::\\s*(.*))?$', 'i');
const MMD_ER_DECL = new RegExp('^' + MMD_ER_ENT + '(?:\\s*\\[\\s*(?:"([^"]*)"|([^\\]]*?))\\s*\\])?\\s*(?:\\{(.*))?$');
// Words the erDiagram lexer reads as cardinality or header, so an entity with such an id is written quoted
const MMD_ER_QUOTED_IDS = /^(one|many|to|optionally|only|zero|erdiagram)$/i;

// Types and column names: Mermaid allows letters, digits, _ - [ ] ( ) . , * and starts with a letter, _ or *. A space is
// written `-`; any other character (a real `-`, `?`, `*`, a leading digit, ...) is `*hex*`, so the text is lossless.
// `strict` also escapes `,` `[` `]`, for the lists inside a relationship label.
function mmdErEnc(s, strict) {
  s = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ' && i > 0) out += '-';
    else if (/[A-Za-z_À-￿]/.test(ch) || (i > 0 && /[0-9.()]/.test(ch)) || (i > 0 && !strict && /[,[\]]/.test(ch))) out += ch;
    else out += '*' + ch.charCodeAt(0).toString(16).padStart(2, '0') + '*';
  }
  return out;
}

function mmdErDec(s) {
  return String(s).replace(/\*([0-9a-f]{2,6})\*|-/g, (m, h) => (h ? String.fromCodePoint(parseInt(h, 16)) : ' '));
}

function mmdErSlug(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

const mmdErMany = (k) => k === 'oneOrMany' || k === 'zeroOrMany';

// The foreign key column(s) of `child` that point at `parent`: `<role>_<parent>_id`, `<parent>_id` (by id or by name) or, for a
// self-reference, `<role>_id`, where the role is the relationship label. [] when no column fits.
function mmdErDerive(child, parent, label) {
  const role = mmdErSlug(label);
  const names = [mmdErSlug(parent.id), mmdErSlug(parent.name != null ? parent.name : parent.id)].filter(Boolean);
  const want = [];
  if (role) names.forEach((n) => want.push(role + '_' + n + '_id'));
  names.forEach((n) => want.push(n + '_id'));
  if (role && child.id === parent.id) want.push(role + '_id');
  for (const w of want) {
    const c = (child.columns || []).find((x) => x && mmdErSlug(x.name) === w);
    if (c) return [c.name];
  }
  return [];
}

// Which written side is the child (`from`): the side with the many marker; with two equal ends the side that holds the listed
// (or derivable) foreign key columns; otherwise the right-hand table, which is where the writer puts the child.
function mmdErPick(kl, kr, el, er, cols, label) {
  if (mmdErMany(kl) !== mmdErMany(kr)) return mmdErMany(kl) ? 'left' : 'right';
  if (el.id === er.id) return 'right';
  if (cols && cols.length) {
    const has = (e) => cols.every((n) => (e.columns || []).some((c) => c.name === n));
    if (has(el) !== has(er)) return has(el) ? 'left' : 'right';
  }
  const dl = mmdErDerive(el, er, label).length > 0, dr = mmdErDerive(er, el, label).length > 0;
  if (dl !== dr) return dl ? 'left' : 'right';
  return 'right';
}

// The default toEnd the engine applies: one, or zeroOrOne when every foreign key column is nullable
function mmdErDefaultToEnd(rel, child) {
  const names = Array.isArray(rel.columns) ? rel.columns : [];
  return names.length && child && names.every((n) => (child.columns || []).some((c) => c.name === n && c.nullable === true)) ? 'zeroOrOne' : 'one';
}

function mmdErAllPk(rel, child) {
  const names = Array.isArray(rel.columns) ? rel.columns : [];
  return names.length > 0 && !!child && names.every((n) => ((child.columns || []).find((c) => c.name === n) || {}).pk === true);
}

function mmdErIds() {
  const used = new Set(), memo = new Map();
  return (raw) => { raw = String(raw); if (!memo.has(raw)) memo.set(raw, mmdSafeId(raw, used)); return memo.get(raw); };
}

// "1,3, 5" -> [1, 3, 5]
function mmdErNumbers(s) { return (String(s).match(/\d+/g) || []).map(Number); }

// ---------------------------------------------------------------------------------------------------------------- reader

function fromMermaid(text) {
  const infos = [], warnings = [];
  const seen = new Set();
  const infoOnce = (kind, msg) => { if (!seen.has(kind)) { seen.add(kind); infos.push('[INFO] ' + msg); } };
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let li = 0, ln = 0, title = null;

  // Front-matter
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const m = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (m) {
        let v = m[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = mmdText(v.replace(/^"|"$/g, '')); } } else if (v[0] === "'") v = mmdText(v.replace(/^'|'$/g, '')); else v = mmdText(v);
        title = v;
      }
      li++;
    }
    li++;
  }

  const ents = [], byRaw = new Map();      // { raw, alias, classes, attrs: [{ name, type, pk, fk, unique, nullable, note }], line }
  const entity = (raw, cls) => {
    let e = byRaw.get(raw);
    if (!e) { e = { raw, alias: null, classes: [], attrs: [], line: ln }; byRaw.set(raw, e); ents.push(e); }
    if (cls) cls.split(',').forEach((c) => e.classes.push(c));
    return e;
  };
  const unquote = (s) => (s[0] === '"' ? s.slice(1, -1) : s);
  const rels = [], directives = [], classOps = [];
  let headerSeen = false, cur = null;

  // One line of a block: `type name PK, FK "comment"`; a trailing `}` closes the block.
  const attrLine = (s) => {
    let closing = false;
    if (s.endsWith('}')) { closing = true; s = s.slice(0, -1).trim(); }
    if (s && !s.startsWith('%%')) {
      const m = /^(\S+)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(s);
      let tTok = m[1], nTok = m[2], rest = m[3] || '';
      if (nTok === undefined || nTok[0] === '"') { rest = [nTok, rest].filter((x) => x).join(' '); nTok = tTok; tTok = '_'; infoOnce('notype', 'line ' + ln + ': a column without a type reads as a column with no type (Mermaid requires one)'); }
      const col = { name: mmdErDec(nTok) };
      let nullable = false;
      if (tTok.endsWith('?')) { nullable = true; tTok = tTok.slice(0, -1); }
      if (tTok !== '_' && tTok !== '') col.type = mmdErDec(tTok);
      let km;
      while ((km = /^(PK|FK|UK)\b\s*,?\s*/i.exec(rest))) { col[{ PK: 'pk', FK: 'fk', UK: 'unique' }[km[1].toUpperCase()]] = true; rest = rest.slice(km[0].length); }
      if (nullable) col.nullable = true;
      rest = rest.trim();
      if (rest) { const note = mmdText(/^"([\s\S]*)"$/.test(rest) ? rest.slice(1, -1) : rest); if (note) col.note = note; }
      cur.attrs.push(col);
    }
    if (closing) cur = null;
  };

  for (; li < lines.length; li++) {
    ln = li + 1;
    let s = lines[li].trim();
    if (cur) { attrLine(s); continue; }
    if (!s) continue;
    if (s.startsWith('%%')) {
      const m = /^%%\s*@(\w+)\s*(.*)$/.exec(s);
      if (m) directives.push({ key: m[1], args: m[2].trim(), line: ln });
      continue;
    }
    if (!headerSeen) {
      if (!/^erDiagram\b/.test(s)) throw new Error('line ' + ln + ': expected "erDiagram"');
      headerSeen = true;
      continue;
    }
    s = s.replace(/;\s*$/, '');
    let m;
    if (/^direction\s+\w+$/i.test(s)) { infoOnce('direction', 'direction ignored: ER diagrams are laid out by --layout'); continue; }
    if ((m = /^class\s+(\S+)\s+(\S+)$/.exec(s))) { classOps.push({ ids: m[1], classes: m[2], line: ln }); continue; }
    if (/^(classDef|style|accTitle|accDescr|subgraph|end)\b/.test(s)) {
      const kind = s.split(/\s+/)[0];
      if (!(kind === 'classDef' && /^classDef\s+c[1-8]\s/.test(s))) infoOnce('ign:' + kind, 'line ' + ln + ': ' + kind + ' statements are ignored');
      continue;
    }
    if ((m = MMD_ER_REL_SYM.exec(s))) {
      entity(unquote(m[1]), m[2]); entity(unquote(m[6]), m[7]);
      rels.push({ line: ln, left: unquote(m[1]), right: unquote(m[6]), kl: MMD_ER_SYM[m[3]], kr: MMD_ER_SYM[m[5]], solid: m[4] === '--', label: m[8] });
      continue;
    }
    if ((m = MMD_ER_REL_WORD.exec(s))) {
      entity(unquote(m[1]), m[2]); entity(unquote(m[6]), m[7]);
      rels.push({ line: ln, left: unquote(m[1]), right: unquote(m[6]), kl: MMD_ER_WORD[m[3].toLowerCase()], kr: MMD_ER_WORD[m[5].toLowerCase()], solid: !m[4], label: m[8] });
      continue;
    }
    if ((m = MMD_ER_DECL.exec(s))) {
      const e = entity(unquote(m[1]), m[2]);
      const alias = m[3] !== undefined ? m[3] : m[4];
      if (alias !== undefined && mmdText(alias) !== '') e.alias = mmdText(alias);
      if (m[5] !== undefined) { cur = e; attrLine(m[5].trim()); }
      continue;
    }
    warnings.push('[WARN] line ' + ln + ': not understood, skipped: ' + s.slice(0, 60));
  }
  if (!headerSeen) throw new Error('line 1: expected "erDiagram"');
  if (cur) warnings.push('[WARN] the block of "' + cur.raw + '" is not closed with }');

  // Entities
  const idOf = mmdErIds();
  const data = { diagramType: 'erd' };
  const entities = ents.map((e) => {
    const o = { id: idOf(e.raw), name: e.alias != null ? e.alias : e.raw };
    o.columns = e.attrs;
    e.json = o;
    return o;
  });
  const byId = new Map(entities.map((e) => [e.id, e]));
  const lookup = (tok) => { const e = byRaw.get(tok); return e ? e.json : byId.get(tok); };
  const customColor = {};
  const applyClasses = (e, classes) => classes.split(/[\s,]+/).filter(Boolean).forEach((c) => {
    if (/^c[1-8]$/.test(c)) e.color = c.slice(1);
    else if (c === 'collapsed') e.collapsed = true;
    else infoOnce('cls:' + c, 'class "' + c + '" is not used by ER diagrams, ignored');
  });
  ents.forEach((e) => applyClasses(e.json, e.classes.join(',')));
  classOps.forEach((op) => op.ids.split(',').forEach((tok) => {
    const e = lookup(unquote(tok));
    if (e) applyClasses(e, op.classes); else warnings.push('[WARN] line ' + op.line + ': class names unknown table "' + tok + '"');
  }));

  // Directives that change relationships are collected first, then applied by ordinal
  const sets = { childRight: new Set() };
  const colorKey = {}, notes = [];
  directives.forEach((d) => {
    const a = d.args;
    let m;
    switch (d.key) {
      case 'type': break;
      case 'schemaVersion': if (a !== '' && !isNaN(Number(a))) data.schemaVersion = Number(a); break;
      case 'detail': if (a) data.detail = a; break;
      case 'showTypes': data.showTypes = a !== 'false'; break;
      case 'showNotes': data.showNotes = a !== 'false'; break;
      case 'colorKey': if ((m = /^(\S+)\s+([\s\S]+)$/.exec(a))) colorKey[m[1]] = m[2].trim(); break;
      case 'color':
        if ((m = /^(\S+)\s+([\s\S]+)$/.exec(a))) { const e = lookup(m[1]); if (e) customColor[e.id] = m[2].trim(); else warnings.push('[WARN] line ' + d.line + ': @color names unknown table "' + m[1] + '"'); }
        break;
      case 'note': case 'entityNote': {
        if (!(m = /^([^:]+?)\s*:\s*([\s\S]*)$/.exec(a))) { warnings.push('[WARN] line ' + d.line + ': @' + d.key + ' needs "table: text"'); break; }
        const text = mmdText(m[2]);
        const toks = m[1].split(',').map((t) => t.trim()).filter(Boolean);
        const parsed = toks.map((t, i) => {
          const dot = t.indexOf('.');
          return i === 0 && dot > 0 && d.key === 'note' ? { e: lookup(t.slice(0, dot)), col: mmdErDec(t.slice(dot + 1)), tok: t.slice(0, dot) } : { e: lookup(t), tok: t };
        });
        const bad = parsed.find((p) => !p.e);
        if (bad) { warnings.push('[WARN] line ' + d.line + ': @' + d.key + ' names unknown table "' + bad.tok + '"'); break; }
        if (d.key === 'entityNote') parsed[0].e.note = text;
        else {
          const note = { id: 'n' + (notes.length + 1), text, entities: parsed.map((p) => p.e.id) };
          if (parsed[0].col !== undefined) note.column = parsed[0].col;
          notes.push(note);
        }
        break;
      }
      default:
        if (sets[d.key]) mmdErNumbers(a).forEach((n) => sets[d.key].add(n));
        else infoOnce('dir:' + d.key, 'line ' + d.line + ': directive @' + d.key + ' is not used by ER diagrams, ignored');
    }
  });
  entities.forEach((e) => { if (customColor[e.id] !== undefined) e.color = customColor[e.id]; });

  // Relationships
  const relationships = rels.map((r, i) => {
    const n = i + 1;
    const el = lookup(r.left), er = lookup(r.right);
    let label = '', bracket = null;
    if (r.label !== undefined) {
      const t = r.label.trim();
      const inner = t[0] === '"' ? (/^"([\s\S]*?)"\s*$/.exec(t) || [0, t.slice(1)])[1] : t;
      const bm = /^([\s\S]*?)\s*\[([^[\]]*)\]\s*$/.exec(inner);
      label = bm ? bm[1] : inner;
      bracket = bm ? bm[2] : null;
    }
    label = mmdText(label);
    // Bracket: `[cols]`, `[cols -> toCols]`; no names = columns absent, `-` after `->` = an empty toColumns list
    let listL = null, listR = null, absentL = false, emptyR = false;
    if (bracket !== null) {
      const am = /^\s*([\s\S]*?)\s*->\s*([\s\S]*?)\s*$/.exec(bracket);
      const ls = am ? am[1] : bracket.trim();
      const parse = (x) => x.split(/\s*,\s*/).filter(Boolean).map(mmdErDec);
      if (ls === '') absentL = true; else listL = parse(ls);
      if (am) { if (am[2] === '-' || am[2] === '') emptyR = true; else listR = parse(am[2]); }
    }
    let side = sets.childRight.has(n) ? 'right' : mmdErPick(r.kl, r.kr, el, er, listL, label);
    if (!sets.childRight.has(n) && mmdErMany(r.kl) === mmdErMany(r.kr) && el.id !== er.id && side === 'right' && !(listL && listL.length) && !mmdErDerive(er, el, label).length) {
      infos.push('[INFO] line ' + r.line + ': ' + el.id + ' and ' + er.id + ' have equal ends; ' + er.id + ' (right-hand) is taken as the child holding the key');
    }
    const child = side === 'right' ? er : el, parent = side === 'right' ? el : er;
    const fromEnd = side === 'right' ? r.kr : r.kl, toEnd = side === 'right' ? r.kl : r.kr;
    const rel = { id: 'r' + n, from: child.id, to: parent.id };
    if (listL) rel.columns = listL; else if (!absentL) { const d = mmdErDerive(child, parent, label); if (d.length) rel.columns = d; }
    if (listR) rel.toColumns = listR; else if (emptyR) rel.toColumns = [];
    rel.fromEnd = fromEnd; rel.toEnd = toEnd;
    rel.identifying = r.solid;
    if (label) rel.label = label;
    return rel;
  });
  ['childRight'].forEach((k) => {
    sets[k].forEach((n) => { if (n < 1 || n > rels.length) warnings.push('[WARN] @' + k + ' names relationship ' + n + ', but there are ' + rels.length); });
  });

  if (title) data.title = title;
  if (Object.keys(colorKey).length) data.colorKey = colorKey;
  data.entities = entities;
  data.relationships = relationships;
  if (notes.length) data.notes = notes;
  return { data, infos, warnings };
}

// ---------------------------------------------------------------------------------------------------------------- writer

function toMermaid(data, opts) {
  opts = opts || {};
  const ents = data.entities || [];
  const ids = new Map(), used = new Set();
  ents.forEach((e) => { if (!ids.has(e.id)) ids.set(e.id, mmdSafeId(e.id, used)); });
  const ref = (id) => (MMD_ER_QUOTED_IDS.test(ids.get(id)) ? '"' + ids.get(id) + '"' : ids.get(id));
  const byId = new Map(ents.map((e) => [e.id, e]));
  const quote = (s) => { const t = String(s == null ? '' : s); return t === '' ? '' : mmdQuote(t).slice(1, -1); };
  const slotOf = (e) => (/^[1-8]$/.test(String(e.color)) ? 'c' + e.color : null);

  const out = [];
  if (data.title) out.push('---', 'title: ' + JSON.stringify(String(data.title)), '---');
  if (data.schemaVersion != null) out.push('%% @schemaVersion ' + data.schemaVersion);
  if (typeof data.detail === 'string' && data.detail) out.push('%% @detail ' + data.detail);
  if (data.showTypes === true) out.push('%% @showTypes'); else if (data.showTypes === false) out.push('%% @showTypes false');
  if (data.showNotes === true) out.push('%% @showNotes'); else if (data.showNotes === false) out.push('%% @showNotes false');
  Object.keys(data.colorKey || {}).sort((a, b) => a - b).forEach((k) => out.push('%% @colorKey ' + k + ' ' + data.colorKey[k]));
  out.push('erDiagram');

  ents.forEach((e) => {
    const id = ids.get(e.id);
    const alias = e.name != null && String(e.name) !== id ? '[' + mmdQuote(e.name) + ']' : '';
    out.push('  ' + ref(e.id) + alias + ' {');
    (e.columns || []).forEach((c) => {
      const t = c.type == null || c.type === '' ? '_' : String(c.type) === '_' ? '*5f*' : mmdErEnc(c.type);
      const keys = [c.pk ? 'PK' : '', c.fk ? 'FK' : '', c.unique ? 'UK' : ''].filter(Boolean).join(', ');
      const note = c.note != null && c.note !== '' ? ' "' + quote(c.note) + '"' : '';
      out.push('    ' + t + (c.nullable ? '?' : '') + ' ' + (mmdErEnc(c.name) || '_') + (keys ? ' ' + keys : '') + note);
    });
    out.push('  }');
  });

  const sets = { childRight: [] };
  const kinds = MMD_ER_LEFT;
  let n = 0;
  (data.relationships || []).forEach((r) => {
    const from = byId.get(r.from), to = byId.get(r.to);
    if (!from || !to) return;
    n++;
    const fromEnd = kinds[r.fromEnd] ? r.fromEnd : 'zeroOrMany';
    const toEnd = kinds[r.toEnd] ? r.toEnd : mmdErDefaultToEnd(r, from);
    const text = r.label == null ? '' : String(r.label);
    const J = Array.isArray(r.columns) && r.columns.length ? r.columns.map(String) : null;
    const T = Array.isArray(r.toColumns) ? r.toColumns.map(String) : null;
    const D = mmdErDerive(from, to, text);
    const listOf = (a) => (a.length ? a.map((x) => mmdErEnc(x, true)).join(', ') : '-');
    const same = J && J.length === D.length && J.every((x, i) => x === D[i]);
    const need = J === null ? D.length > 0 : !same;
    let label = quote(text);
    if (need || T || /\]$/.test(text)) {
      label += (label ? ' ' : '') + '[' + (J === null ? '' : listOf(J)) + (T ? ' -> ' + listOf(T) : '') + ']';
    }
    // The reader sees the listed columns only when a bracket names some
    const listed = J && (need || T || /\]$/.test(text)) ? J : null;
    if (mmdErPick(toEnd, fromEnd, to, from, listed, text) !== 'right') sets.childRight.push(n);
    const identifying = r.identifying === true || (r.identifying == null && mmdErAllPk(r, from));
    out.push('  ' + ref(r.to) + ' ' + MMD_ER_LEFT[toEnd] + (identifying ? '--' : '..') + MMD_ER_RIGHT[fromEnd] + ' ' + ref(r.from) + ' : "' + label + '"');
  });

  // `class` lines, one per class: the palette slots, then collapsed
  const byClass = new Map();
  ents.forEach((e) => {
    [slotOf(e), e.collapsed === true ? 'collapsed' : null].filter(Boolean).forEach((c) => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(ids.get(e.id)); });
  });
  // `class` cannot name an id that the lexer reads as a cardinality word (written quoted), so those use `"id":::class`
  [...byClass.keys()].sort().forEach((c) => {
    const plain = byClass.get(c).filter((id) => !MMD_ER_QUOTED_IDS.test(id));
    if (plain.length) out.push('  class ' + plain.join(',') + ' ' + c);
    byClass.get(c).filter((id) => MMD_ER_QUOTED_IDS.test(id)).forEach((id) => out.push('  "' + id + '":::' + c));
  });
  if (opts.palette) {
    const slots = new Set();
    ents.forEach((e) => { if (slotOf(e)) slots.add(+e.color); });
    [...slots].sort((a, b) => a - b).forEach((s) => { if (opts.palette[s - 1]) out.push('  classDef c' + s + ' fill:' + opts.palette[s - 1]); });
  }

  Object.keys(sets).forEach((k) => { if (sets[k].length) out.push('%% @' + k + ' ' + sets[k].join(',')); });
  ents.forEach((e) => { if (e.color != null && e.color !== '' && !slotOf(e)) out.push('%% @color ' + ids.get(e.id) + ' ' + e.color); });
  (data.notes || []).forEach((nt) => {
    const eids = (nt.entities || []).filter((id) => ids.has(id));
    if (!eids.length) return;
    const refs = eids.map((id, i) => ids.get(id) + (i === 0 && nt.column != null ? '.' + mmdErEnc(nt.column, true) : ''));
    out.push('%% @note ' + refs.join(',') + ': ' + quote(nt.text));
  });
  ents.forEach((e) => { if (e.note != null && e.note !== '') out.push('%% @entityNote ' + ids.get(e.id) + ': ' + quote(e.note)); });
  return out.join('\n') + '\n';
}
