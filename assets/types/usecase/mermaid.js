// Use case <-> Mermaid. Plain script, no DOM, no imports; concatenated after assets/shell/mermaid-flow.js
// (needs mmdParseFlow, mmdQuote, mmdSafeId). Mapping: dev/plans/plan-mermaid-input.md, "Use case".
// Mermaid has no use case type, so the diagram is a flowchart marked `%% @type usecase`: inside a subgraph is a
// use case, outside is an actor (with no subgraph at all: stadium, circle and ellipse nodes are use cases).

// Returns a function raw id -> unique JSON/Mermaid id. Uniqueness is also enforced here, whatever mmdSafeId does with `used`.
function ucmIdMaker() {
  const used = new Set(), taken = new Set(), map = new Map();
  return raw => {
    raw = String(raw);
    if (!map.has(raw)) {
      let s = mmdSafeId(raw, used);
      const base = s;
      for (let i = 2; taken.has(s); i++) s = base + '_' + i;
      taken.add(s);
      map.set(raw, s);
    }
    return map.get(raw);
  };
}

// "a; b rest" style directive arguments -> [[id, rest], ...]; the first word may be several ids joined by commas.
function ucmItems(args) {
  return String(args || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s);
    return [m[1].split(',').filter(Boolean), m[2].trim()];
  });
}

function ucmList(s) { return s.split(',').map(x => x.trim()).filter(Boolean); }

function fromMermaid(text) { return fromMermaidAst(mmdParseFlow(text)); }

function fromMermaidAst(ast) {
  const infos = [], warnings = [];
  const sid = ucmIdMaker();

  const seen = new Set();
  (ast.ignored || []).forEach(g => {
    const kind = String(g.text || '').trim().split(/\s+/)[0];
    if (!seen.has(kind)) { seen.add(kind); infos.push('line ' + g.line + ': "' + kind + '" is not used by use case diagrams, ignored'); }
  });
  if (ast.dir === 'TB') infos.push('direction TB ignored: use case diagrams are laid out by --layout');

  // Subjects: top-level subgraphs. A node belongs to its innermost subgraph; a nested one flattens into the top-level subject.
  const subs = ast.subgraphs || [];
  const subById = new Map(subs.map(g => [g.id, g]));
  const topOf = g => { while (g.parent != null && subById.has(g.parent)) g = subById.get(g.parent); return g; };
  const nodeSub = new Map();
  subs.forEach(g => g.nodes.forEach(n => { if (!nodeSub.has(n)) nodeSub.set(n, topOf(g)); }));
  const hasSub = subs.length > 0;
  if (subs.some(g => g.parent != null)) infos.push('nested subgraphs flattened into their top-level subject');

  const nodeById = new Map(ast.nodes.map(n => [n.id, n]));
  const edgesOf = new Map();
  ast.edges.forEach(e => [e.from, e.to].forEach(id => { if (!edgesOf.has(id)) edgesOf.set(id, []); edgesOf.get(id).push(e); }));

  // Notes: a flag-shaped node whose edges are all unlabelled and dotted or headless.
  const isNote = n => n.shape === 'odd' && (edgesOf.get(n.id) || []).every(e => !e.label && (e.stroke === 'dotted' || e.stroke === 'invisible' || (e.head === 'none' && !e.both)));
  const kind = new Map();   // Mermaid id -> 'note' | 'uc' | 'actor'
  ast.nodes.forEach(n => {
    kind.set(n.id, isNote(n) ? 'note' : (hasSub ? nodeSub.has(n.id) : ['stadium', 'circle', 'ellipse'].includes(n.shape)) ? 'uc' : 'actor');
  });

  const data = { diagramType: 'usecase' };
  if (ast.title) {
    let t = String(ast.title);
    if (/^".*"$/.test(t)) { try { t = JSON.parse(t); } catch (e) { /* keep as written */ } }
    data.title = t;
  }

  const subjects = subs.filter(g => g.parent == null).map(g => {
    const o = { id: sid(g.id), name: g.title || g.id };
    if (g.classes.includes('collapsed')) o.collapsed = true;
    return o;
  });
  const subjectOf = new Map(subjects.map((s, i) => [subs.filter(g => g.parent == null)[i].id, s]));
  const byId = new Map();   // JSON id -> actor or use case object
  const actors = [], useCases = [];
  const slot = n => { const c = n.classes.find(x => /^c[1-8]$/.test(x)); return c ? c.slice(1) : null; };
  ast.nodes.forEach(n => {
    const k = kind.get(n.id);
    if (k === 'note') return;
    const o = { id: sid(n.id), name: n.label };
    if (k === 'actor') {
      if (n.classes.includes('system')) o.kind = 'system'; else if (n.classes.includes('time')) o.kind = 'time';
    } else {
      if (hasSub) o.subject = subjectOf.get(nodeSub.get(n.id).id).id;
      if (n.classes.includes('subfunction')) o.level = 'subfunction'; else if (n.classes.includes('summary')) o.level = 'summary';
    }
    if (slot(n)) o.color = slot(n);
    if (n.classes.includes('abstract')) o.abstract = true;
    (k === 'actor' ? actors : useCases).push(o);
    byId.set(o.id, o);
  });
  const isUc = id => kind.get(id) === 'uc';
  const isActor = id => kind.get(id) === 'actor';

  // Edges.
  const links = [];
  const EXT = /^(?:<<|«)?\s*extend\s*(?:\(([^)]*)\))?\s*(?:>>|»)?\s*(?::\s*([\s\S]*))?$/i;
  const INC = /^(?:<<|«)?\s*include\s*(?:>>|»)?$/i;
  ast.edges.forEach(e => {
    const kf = kind.get(e.from), kt = kind.get(e.to);
    if (!kf || !kt) { warnings.push('line ' + e.line + ': edge ends at a subgraph or unknown node, ignored'); return; }
    if (kf === 'note' || kt === 'note' || e.stroke === 'invisible') return;
    const label = String(e.label || '').trim();
    const from = sid(e.from), to = sid(e.to);
    const where = 'line ' + e.line + ': ' + e.from + ' -> ' + e.to;
    let m;
    if (/^is\s+an?$/i.test(label)) {
      if (kf !== kt) warnings.push(where + ' "is a" joins an actor and a use case; use two actors or two use cases');
      else if (byId.get(from).parent) warnings.push(where + ' "is a": ' + e.from + ' already has a parent');
      else byId.get(from).parent = to;
    } else if (INC.test(label) || (m = EXT.exec(label))) {
      const type = m ? 'extend' : 'include';
      if (kf !== 'uc' || kt !== 'uc') { warnings.push(where + ' ' + type + ' joins two use cases'); return; }
      const l = { id: 'l' + (links.length + 1), type, from, to };
      if (m && m[2] && m[2].trim()) l.condition = m[2].trim();
      if (m && m[1] && m[1].trim()) l.extensionPoint = m[1].trim();
      links.push(l);
    } else if (kf === kt) {
      warnings.push(where + ' joins two ' + (kf === 'uc' ? 'use cases' : 'actors') + ' without "include", "extend" or "is a"; label it or remove it');
    } else {
      const l = { id: 'l' + (links.length + 1), type: 'association', from, to };
      if (e.head === 'arrow' && !e.both) l.navigable = true;   // `-->` draws the open arrowhead toward `to`
      links.push(l);
    }
  });

  // Notes.
  const notes = [];
  ast.nodes.forEach(n => {
    if (kind.get(n.id) !== 'note') return;
    const note = { id: sid(n.id), text: n.label, useCases: [], actors: [] };
    (edgesOf.get(n.id) || []).forEach(e => {
      const other = e.from === n.id ? e.to : e.from;
      if (isUc(other)) note.useCases.push(sid(other)); else if (isActor(other)) note.actors.push(sid(other));
    });
    if (!note.useCases.length && !note.actors.length) warnings.push('line ' + n.line + ': note "' + n.id + '" is linked to nothing');
    if (!note.useCases.length) delete note.useCases;
    if (!note.actors.length) delete note.actors;
    notes.push(note);
  });

  // Directives.
  const target = (raw, key, line) => {
    const o = byId.get(sid(raw));
    if (!o || !kind.has(raw)) warnings.push('line ' + line + ': @' + key + ' names unknown id "' + raw + '"');
    return o;
  };
  const colorKey = {};
  ast.directives.forEach(d => {
    const a = String(d.args || '').trim();
    let m;
    switch (d.key) {
      case 'type': if (a && a !== 'usecase') infos.push('line ' + d.line + ': @type ' + a + ' ignored'); break;
      case 'colorKey': if ((m = /^(\S+)\s+(.+)$/.exec(a))) colorKey[m[1]] = m[2].trim(); break;
      case 'showRefs': data.showRefs = true; break;
      case 'showNotes': data.showNotes = true; break;
      case 'schemaVersion': if (!isNaN(Number(a))) data.schemaVersion = Number(a); break;
      case 'refs': case 'points':
        ucmItems(a).forEach(([ids, rest]) => ids.forEach(id => {
          const o = target(id, d.key, d.line);
          if (o && rest) o[d.key === 'refs' ? 'refs' : 'extensionPoints'] = ucmList(rest);
        }));
        break;
      case 'side':
        if ((m = /^(\S+)\s+(left|right)$/i.exec(a))) { const o = target(m[1], 'side', d.line); if (o && kind.get(m[1]) === 'actor') o.side = m[2].toLowerCase(); }
        else warnings.push('line ' + d.line + ': @side needs an id and left or right');
        break;
      case 'size':
        if ((m = /^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(a))) {
          const s = subjectOf.get(m[1]);
          if (s) { if (+m[2] > 0) s.fw = +m[2]; if (+m[3] > 0) s.fh = +m[3]; } else warnings.push('line ' + d.line + ': @size names unknown subject "' + m[1] + '"');
        } else warnings.push('line ' + d.line + ': @size needs a subject, a width and a height');
        break;
      case 'level':
        if ((m = /^(\S+)\s+(user|subfunction|summary)$/i.exec(a))) { const o = target(m[1], 'level', d.line); if (o && kind.get(m[1]) === 'uc') o.level = m[2].toLowerCase(); }
        break;
      case 'note':
        if ((m = /^(\S+?):\s*([\s\S]+)$/.exec(a))) {
          const o = target(m[1], 'note', d.line);
          if (o) notes.push(kind.get(m[1]) === 'uc' ? { id: 'n' + (notes.length + 1), text: m[2].trim(), useCases: [o.id] } : { id: 'n' + (notes.length + 1), text: m[2].trim(), actors: [o.id] });
        }
        break;
      default: infos.push('line ' + d.line + ': unknown directive @' + d.key + ' ignored');
    }
  });

  if (Object.keys(colorKey).length) data.colorKey = colorKey;
  if (subjects.length) data.subjects = subjects;
  data.actors = actors;
  data.useCases = useCases;
  data.links = links;
  if (notes.length) data.notes = notes;
  return { data, infos, warnings };
}

function toMermaid(data, opts) {
  opts = opts || {};
  const sid = ucmIdMaker();
  const subjects = data.subjects || [], actors = data.actors || [], useCases = data.useCases || [];
  subjects.forEach(s => sid(s.id));
  actors.forEach(a => sid(a.id));
  useCases.forEach(u => sid(u.id));
  const allIds = new Set([...subjects, ...actors, ...useCases].map(x => x.id));
  const q = s => mmdQuote(String(s == null ? '' : s));
  const slotOf = x => (/^[1-8]$/.test(String(x.color)) ? 'c' + x.color : null);
  const classesOf = (x, isUc) => [slotOf(x),
    isUc ? (x.level === 'subfunction' || x.level === 'summary' ? x.level : null) : (x.kind === 'system' || x.kind === 'time' ? x.kind : null),
    x.abstract ? 'abstract' : null].filter(Boolean);

  const out = [];
  if (data.title) out.push('---', 'title: ' + (/[:#"'\[\]{}&*!|>%@`,]|^[\s?-]|\s$/.test(data.title) ? JSON.stringify(String(data.title)) : data.title), '---');
  out.push('%% @type usecase');
  if (data.schemaVersion != null) out.push('%% @schemaVersion ' + data.schemaVersion);
  Object.keys(data.colorKey || {}).sort((a, b) => a - b).forEach(k => out.push('%% @colorKey ' + k + ' ' + data.colorKey[k]));
  if (data.showRefs) out.push('%% @showRefs');
  if (data.showNotes) out.push('%% @showNotes');
  out.push('flowchart LR');

  const multi = []; // [id, classes] of nodes that need `class` lines
  const node = (x, isUc, ind) => {
    const id = sid(x.id), cl = classesOf(x, isUc);
    if (cl.length > 1) multi.push([id, cl]);
    return ind + id + (isUc ? '([' : '[') + q(x.name) + (isUc ? '])' : ']') + (cl.length === 1 ? ':::' + cl[0] : '');
  };
  actors.forEach(a => out.push(node(a, false, '  ')));
  if (subjects.length) {
    subjects.forEach((s, i) => {
      out.push('  subgraph ' + sid(s.id) + '[' + q(s.name) + ']');
      // With one subject, a use case that names none sits in it; with several, one that names none goes to the first.
      useCases.filter(u => (u.subject && subjects.some(x => x.id === u.subject) ? u.subject : subjects[0].id) === s.id).forEach(u => out.push(node(u, true, '    ')));
      out.push('  end');
      if (s.collapsed) multi.push([sid(s.id), ['collapsed']]);
    });
  } else useCases.forEach(u => out.push(node(u, true, '  ')));

  [actors, useCases].forEach(list => list.forEach(x => { if (x.parent && [...actors, ...useCases].some(y => y.id === x.parent)) out.push('  ' + sid(x.id) + ' -->|is a| ' + sid(x.parent)); }));
  const known = new Set([...actors, ...useCases].map(x => x.id));
  (data.links || []).forEach(l => {
    if (!known.has(l.from) || !known.has(l.to)) return;
    const a = sid(l.from), b = sid(l.to);
    if (l.type === 'include') out.push('  ' + a + ' -.->|include| ' + b);
    else if (l.type === 'extend') out.push('  ' + a + ' -.->|' + q('extend' + (l.extensionPoint ? ' (' + l.extensionPoint + ')' : '') + (l.condition ? ': ' + l.condition : '')) + '| ' + b);
    else out.push('  ' + a + (l.navigable ? ' --> ' : ' --- ') + b);
  });
  (data.notes || []).forEach(n => {
    const ends = [...(n.useCases || []), ...(n.actors || [])].filter(id => known.has(id)).map(sid);
    out.push('  ' + sid(allIds.has(n.id) ? 'note_' + n.id : n.id) + '>' + q(n.text) + ']' + (ends.length ? ' -.- ' + ends.join(' & ') : ''));
  });

  // `:::` takes one class and is not allowed on a subgraph, so the rest go through `class` lines, one per class.
  const byClass = new Map();
  multi.forEach(([id, cl]) => cl.forEach(c => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(id); }));
  byClass.forEach((ids, c) => out.push('  class ' + ids.join(',') + ' ' + c));

  const list = (key, id, arr) => { if (arr && arr.length) out.push('%% @' + key + ' ' + sid(id) + ' ' + arr.join(', ')); };
  useCases.forEach(u => { list('refs', u.id, u.refs); list('points', u.id, u.extensionPoints); });
  actors.forEach(a => { if (a.side === 'left' || a.side === 'right') out.push('%% @side ' + sid(a.id) + ' ' + a.side); });
  subjects.forEach(s => { if (s.fw || s.fh) out.push('%% @size ' + sid(s.id) + ' ' + (s.fw || 0) + ' ' + (s.fh || 0)); });

  if (opts.palette) {
    const slots = new Set();
    [...actors, ...useCases].forEach(x => { if (slotOf(x)) slots.add(+x.color); });
    [...slots].sort((a, b) => a - b).forEach(n => { if (opts.palette[n - 1]) out.push('  classDef c' + n + ' fill:' + opts.palette[n - 1]); });
  }
  return out.join('\n') + '\n';
}
