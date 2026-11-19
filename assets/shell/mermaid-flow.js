// Mermaid flowchart-family tokenizer, shared by the flowchart and use case importers (plan: dev/plans/plan-mermaid-input.md).
// Plain script: globals only, no DOM, no imports (it is concatenated with the type's mermaid.js).
//
// mmdParseFlow(text) returns the AST described in the plan ("mmdParseFlow(text) result"), with one additive field:
//   dirRaw: the direction word as written in the header ('TD', 'RL', ...) or null, so a caller can say that RL/BT were mapped.
// `ignored` entries are { line, text } with text starting with the statement keyword (style, classDef, click, ...).
// `shape` names: the bracket forms give rect, round, stadium, subroutine, cylinder, circle, dbl-circ, odd, diamond, hex,
// lean-r, lean-l, trap-b, trap-t. `@{ shape: x }` gives the canonical v11 name, with these exceptions where the plan
// gives no name: rectangle aliases -> rect, rounded -> round, pill/terminal -> stadium, hexagon/prepare -> hex,
// decision/question -> diamond, db/database/cylinder -> cyl, framed-rectangle/subprocess/fr-rect -> subproc; any other name
// is passed through lower-cased.
// A node that is only referenced gets shape 'rect' with label = id. The circ shapes (sm-circ, fr-circ, f-circ, dbl-circ)
// get an empty label when none is written.

const MMD_RESERVED = ['end', 'graph', 'subgraph', 'flowchart', 'style', 'class', 'classdef', 'linkstyle', 'click', 'default',
  'direction', 'call', 'href', 'interpolate', 'acctitle', 'accdescr',
  // sequenceDiagram keywords: Mermaid cannot parse them as participant ids, and every type shares one id rule
  'alt', 'else', 'opt', 'loop', 'par', 'and', 'rect', 'box', 'note', 'participant', 'actor', 'create', 'destroy', 'activate',
  'deactivate', 'autonumber', 'title', 'link', 'links', 'properties', 'details', 'critical', 'option', 'break', 'as', 'over', 'left',
  'right', 'of', 'off', 'sequencediagram'];

// Unescape label text: <br> to newline, then entities (#quot; #35; #59; #NNN;). One pass for the entities, so #35;quot; stays text.
function mmdText(s) {
  let t = String(s == null ? '' : s).trim();
  if (/^`[\s\S]*`$/.test(t)) t = t.slice(1, -1);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  const named = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' };
  t = t.replace(/#(quot|amp|lt|gt|nbsp|\d+);/g, (m, k) => (k in named ? named[k] : String.fromCodePoint(+k)));
  return t.trim();
}

// Escape and quote a label for Mermaid. An empty label becomes a space, because Mermaid rejects "".
function mmdQuote(s) {
  const map = { '#': '#35;', '"': '#quot;', ';': '#59;', '`': '#96;' };
  const t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[#";`]/g, (c) => map[c]).replace(/\n/g, '<br>');
  return '"' + (t === '' ? ' ' : t) + '"';
}

// A Mermaid-safe id. `used` (a Set, optional) makes the result unique and records it.
function mmdSafeId(id, used) {
  let s = String(id == null ? '' : id).replace(/[^A-Za-z0-9_]+/g, '_') || 'n';
  if (/^[0-9]/.test(s)) s = 'n_' + s;
  while (MMD_RESERVED.includes(s.toLowerCase())) s += '_';
  if (used) {
    let u = s, k = 2;
    while (used.has(u)) u = s + '_' + k++;
    used.add(u);
    s = u;
  }
  return s;
}

const MMD_SHAPE_ALIASES = {
  rect: 'rect', rectangle: 'rect', proc: 'rect', process: 'rect', task: 'rect',
  rounded: 'round', event: 'round', stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  diamond: 'diamond', decision: 'diamond', question: 'diamond',
  doc: 'doc', document: 'doc', delay: 'delay',
  'sm-circ': 'sm-circ', 'small-circle': 'sm-circ', start: 'sm-circ',
  'fr-circ': 'fr-circ', 'framed-circle': 'fr-circ', stop: 'fr-circ',
  'f-circ': 'f-circ', 'filled-circle': 'f-circ', 'dbl-circ': 'dbl-circ', 'double-circle': 'dbl-circ',
  subproc: 'subproc', subprocess: 'subproc', 'fr-rect': 'subproc', 'framed-rectangle': 'subproc',
  cyl: 'cyl', cylinder: 'cyl', db: 'cyl', database: 'cyl', circle: 'circle', circ: 'circle',
  hex: 'hex', hexagon: 'hex', prepare: 'hex', 'lean-r': 'lean-r', 'lean-right': 'lean-r', 'in-out': 'lean-r',
  'lean-l': 'lean-l', 'lean-left': 'lean-l', 'out-in': 'lean-l', 'trap-b': 'trap-b', 'trapezoid-bottom': 'trap-b',
  priority: 'trap-b', 'trap-t': 'trap-t', 'trapezoid-top': 'trap-t', manual: 'trap-t',
};

// Bracket openers, longest first: [opener, family, closers [[closer, shape], ...]]. family = the bracket counted for nesting.
const MMD_OPENERS = [
  ['(((', '(', [[')))', 'dbl-circ']]],
  ['((', '(', [['))', 'circle']]],
  ['([', '(', [['])', 'stadium']]],
  ['(', '(', [[')', 'round']]],
  ['[[', '[', [[']]', 'subroutine']]],
  ['[(', '(', [[')]', 'cylinder']]],
  ['[/', '[', [['/]', 'lean-r'], ['\\]', 'trap-b']]],
  ['[\\', '[', [['\\]', 'lean-l'], ['/]', 'trap-t']]],
  ['[', '[', [[']', 'rect']]],
  ['{{', '{', [['}}', 'hex']]],
  ['{', '{', [['}', 'diamond']]],
  ['>', '[', [[']', 'odd']]],
];
const MMD_CLOSE_OF = { '(': ')', '[': ']', '{': '}' };
const MMD_ID = /[A-Za-z0-9_\u0080-￿]+(?:-(?=[A-Za-z0-9_\u0080-￿])[A-Za-z0-9_\u0080-￿]*)*/y;

// Split a line into statements at `;`, outside quotes and not when the `;` ends an entity such as #59;
function mmdSplitStatements(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    if (c === ';' && !q && !/#\w+$/.test(cur)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function mmdParseFlow(text) {
  const ast = { title: null, dir: null, dirRaw: null, directives: [], nodes: [], edges: [], subgraphs: [], ignored: [] };
  const nodeById = new Map(), sgById = new Map(), sgOf = new Map(), classOps = [];
  const stack = [];
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let li = 0, headerSeen = false, ln = 0;
  const fail = (msg) => { throw new Error(`line ${ln}: ${msg}`); };

  // Front-matter
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const m = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (m) {
        let v = m[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ''); } } else if (v[0] === "'") v = v.replace(/^'|'$/g, '');
        ast.title = mmdText(v);
      }
      li++;
    }
    li++;
  }

  function addNode(id, decl, classes) {
    let n = nodeById.get(id);
    if (!n) {
      n = { id, label: id, shape: 'rect', classes: [], line: ln, declared: false };
      nodeById.set(id, n);
      ast.nodes.push(n);
    }
    if (decl && !n.declared) { n.label = decl.label; n.shape = decl.shape; n.declared = true; }
    (classes || []).forEach((c) => { if (!n.classes.includes(c)) n.classes.push(c); });
    if (stack.length && !sgOf.has(id)) {
      const sg = stack[stack.length - 1];
      sgOf.set(id, sg.id);
      sg.nodes.push(id);
    }
    return id;
  }

  // Parse one node (id, then a shape or @{ } block, then :::classes) from s at i. Returns [id, next index].
  function parseNode(s, i) {
    while (s[i] === ' ') i++;
    MMD_ID.lastIndex = i;
    const m = MMD_ID.exec(s);
    if (!m) fail(`cannot read a node id near "${s.slice(i, i + 20)}"`);
    const id = m[0];
    i += id.length;
    let decl = null;
    if (s.startsWith('@{', i)) {
      let j = i + 2, q = false;
      while (j < s.length && (q || s[j] !== '}')) { if (s[j] === '"') q = !q; j++; }
      if (j >= s.length) fail('unterminated @{ }');
      const body = s.slice(i + 2, j);
      i = j + 1;
      const props = {};
      let part = '', pq = false;
      const flush = () => {
        const k = part.indexOf(':');
        if (k > 0) {
          let v = part.slice(k + 1).trim();
          if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
          props[part.slice(0, k).trim().replace(/^"|"$/g, '')] = v;
        }
        part = '';
      };
      for (const c of body) { if (c === '"') pq = !pq; if (c === ',' && !pq) flush(); else part += c; }
      flush();
      const sname = String(props.shape || 'rect').toLowerCase();
      const shape = MMD_SHAPE_ALIASES[sname] || sname;
      const circ = ['sm-circ', 'fr-circ', 'f-circ', 'dbl-circ'].includes(shape);
      decl = { shape, label: 'label' in props ? mmdText(props.label) : (circ ? '' : id) };
    } else {
      for (const [open, fam, closers] of MMD_OPENERS) {
        if (!s.startsWith(open, i)) continue;
        let j = i + open.length;
        while (s[j] === ' ') j++;
        const tryClose = (k) => closers.find(([c]) => s.startsWith(c, k));
        let label = null, hit = null, end = 0;
        if (s[j] === '"') {
          const e = s.indexOf('"', j + 1);
          if (e > 0) {
            let k = e + 1;
            while (s[k] === ' ') k++;
            hit = tryClose(k);
            if (hit) { label = s.slice(j + 1, e); end = k + hit[0].length; }
          }
        }
        if (!hit) {
          const closeCh = MMD_CLOSE_OF[fam];
          let depth = 0, k = j;
          for (; k < s.length; k++) {
            if (depth === 0 && (hit = tryClose(k))) break;
            if (s[k] === fam) depth++; else if (s[k] === closeCh && depth > 0) depth--;
          }
          if (!hit) fail(`missing "${closers[0][0]}" for node ${id}`);
          label = s.slice(j, k);
          end = k + hit[0].length;
        }
        decl = { shape: hit[1], label: mmdText(label) };
        i = end;
        break;
      }
    }
    const classes = [];
    while (s.startsWith(':::', i)) {
      const m2 = /^[\w-]+/.exec(s.slice(i + 3));
      if (!m2) fail('empty class after :::');
      classes.push(m2[0]);
      i += 3 + m2[0].length;
    }
    return [addNode(id, decl, classes), i];
  }

  function parseLink(s, i) {
    let r = s.slice(i), m, id = null;
    if ((m = /^[A-Za-z0-9_]+@(?=[-=.~<ox])/.exec(r))) { id = m[0].slice(0, -1); r = r.slice(m[0].length); }
    let start = '';
    if ((m = /^([<ox])(?=[-=])/.exec(r))) { start = m[1]; r = r.slice(1); }
    let stroke, head = '', label = null;
    const take = (n) => { r = r.slice(n); };
    const textForm = (open, endRe, str) => {
      take(open);
      const e = endRe.exec(r);
      if (!e) fail('unterminated edge text');
      label = r.slice(0, e.index).trim().replace(/^"([\s\S]*)"$/, '$1');
      head = e[0].slice(-1);
      if (!'>ox'.includes(head)) head = '';
      take(e.index + e[0].length);
      stroke = str;
    };
    if ((m = /^~{3,}/.exec(r))) { stroke = 'invisible'; take(m[0].length); } else if (/^==\s/.test(r)) textForm(2, /={2,}[>ox]?/, 'thick');
    else if (/^-\.\s/.test(r)) textForm(2, /\.+-[>ox]?/, 'dotted');
    else if (/^--\s/.test(r)) textForm(2, /-{2,}[>ox]?/, 'normal');
    else if ((m = /^={2,}([>ox]?)/.exec(r))) { stroke = 'thick'; head = m[1]; take(m[0].length); } else if ((m = /^-\.+-([>ox]?)/.exec(r))) { stroke = 'dotted'; head = m[1]; take(m[0].length); } else if ((m = /^-{2,}([>ox]?)/.exec(r))) { stroke = 'normal'; head = m[1]; take(m[0].length); } else return null;
    if ((m = /^\s*\|/.exec(r))) {
      take(m[0].length);
      let e;
      if (/^\s*"/.test(r)) { const q = r.indexOf('"'); const q2 = r.indexOf('"', q + 1); e = r.indexOf('|', q2 + 1); label = r.slice(q + 1, q2); } else { e = r.indexOf('|'); label = r.slice(0, e); }
      if (e < 0) fail('unterminated |edge text|');
      take(e + 1);
    }
    const heads = { '>': 'arrow', o: 'circle', x: 'cross', '': 'none' };
    return { link: { label: label == null ? '' : mmdText(label), stroke, head: heads[head], both: start !== '', id }, next: s.length - r.length };
  }

  function parseChain(s) {
    let i = 0, prev = null;
    for (;;) {
      const group = [];
      for (;;) {
        const [id, j] = parseNode(s, i);
        group.push(id);
        i = j;
        while (s[i] === ' ') i++;
        if (s[i] === '&') { i++; continue; }
        break;
      }
      if (prev) prev.links.forEach((lk) => prev.group.forEach((a) => group.forEach((b) => ast.edges.push({ from: a, to: b, label: lk.label, stroke: lk.stroke, head: lk.head, both: lk.both, line: ln }))));
      if (i >= s.length) return;
      const res = parseLink(s, i);
      if (!res) fail(`cannot read "${s.slice(i, i + 20)}"`);
      i = res.next;
      prev = { group, links: [res.link] };
    }
  }

  // A repeated id under another parent is a separate subgraph (the same lane inside a `sub_` block); `sub` names the
  // top-level `sub_` block a subgraph sits in (flowcharts), else null.
  const sgScoped = new Map();
  function parseSubgraph(rest) {
    let id, title, m;
    if ((m = /^([^\s\[\]"]+)\s*\[([\s\S]*)\]$/.exec(rest))) { id = m[1]; title = m[2].trim().replace(/^"([\s\S]*)"$/, '$1'); } else if ((m = /^"([\s\S]*)"$/.exec(rest))) { id = title = m[1]; } else { id = title = rest; }
    title = mmdText(title);
    const top = stack.length ? stack[stack.length - 1] : null, parent = top ? top.id : null;
    const key = parent + '>' + id;
    const known = sgScoped.get(key) || (sgById.has(id) && sgById.get(id).parent === parent ? sgById.get(id) : null);
    if (known) { stack.push(known); return; }
    const sg = { id, title, parent, sub: !top && /^sub_/.test(id) ? id : (top ? top.sub : null), nodes: [], classes: [], line: ln };
    sgScoped.set(key, sg);
    if (!sgById.has(id)) sgById.set(id, sg);
    ast.subgraphs.push(sg);
    stack.push(sg);
  }

  function statement(s) {
    let m;
    if ((m = /^subgraph(?:\s+([\s\S]*))?$/.exec(s))) return parseSubgraph((m[1] || '').trim());
    if (s === 'end') { stack.pop(); return; }
    if (/^direction\s+\w+$/.test(s)) return;
    if ((m = /^class\s+(\S+)\s+(\S+)$/.exec(s))) { classOps.push([m[1].split(','), m[2].split(',')]); return; }
    if ((m = /^(classDef|style|linkStyle|click|accTitle|accDescr|href|call)\b/.exec(s))) { ast.ignored.push({ line: ln, text: s }); return; }
    parseChain(s);
  }

  let inAcc = false;
  for (; li < lines.length; li++) {
    ln = li + 1;
    const raw = lines[li].trim();
    if (inAcc) { if (raw.includes('}')) inAcc = false; continue; }
    if (!raw) continue;
    if (raw.startsWith('%%')) {
      const m = /^%%\s*@(\w+)\s*(.*)$/.exec(raw);
      if (m) ast.directives.push({ key: m[1], args: m[2].trim(), line: ln });
      continue;
    }
    if (/^accDescr\s*\{/.test(raw) && !raw.includes('}')) { inAcc = true; ast.ignored.push({ line: ln, text: raw }); continue; }
    let stmts = mmdSplitStatements(raw);
    if (!headerSeen) {
      const m = /^(?:flowchart|graph)(?:-elk)?(?:\s+(LR|RL|TB|TD|BT))?\s*(.*)$/.exec(stmts[0]);
      if (!m) fail('expected "flowchart" or "graph"');
      headerSeen = true;
      if (m[1]) { ast.dirRaw = m[1]; ast.dir = { LR: 'LR', RL: 'LR', TB: 'TB', TD: 'TB', BT: 'TB' }[m[1]]; }
      stmts = (m[2] ? [m[2]] : []).concat(stmts.slice(1));
    }
    stmts.forEach(statement);
  }
  if (!headerSeen) { ln = 1; fail('expected "flowchart" or "graph"'); }

  classOps.forEach(([ids, cls]) => ids.forEach((id) => {
    const target = nodeById.get(id) || sgById.get(id);
    if (target) cls.forEach((c) => { if (!target.classes.includes(c)) target.classes.push(c); });
  }));
  ast.nodes.forEach((n) => delete n.declared);
  return ast;
}
