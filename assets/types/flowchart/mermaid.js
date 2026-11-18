// Mermaid reader and writer for the flowchart type (plan: dev/plans/plan-mermaid-input.md).
// Plain script, globals only; it is concatenated after assets/shell/mermaid-flow.js, which holds the tokenizer.
//   fromMermaid(text)      -> { data, infos, warnings }   authoring JSON, no positions
//   toMermaid(data, opts)  -> string                      opts.palette: 8 hex colours for the slots c1..c8 (adds classDef lines)

const MMD_FLOW_KNOWN_DIRECTIVES = ['type', 'icon', 'color', 'showNotes', 'laneOrder', 'schemaVersion', 'swimlanes'];
const MMD_FLOW_FLAGS = ['isStart', 'isEnd'];
const MMD_FLOW_LAYOUT_KEYS = ['x', 'y', 'height', 'width', 'w', 'h', 'fw', 'fh'];

function fromMermaid(text) {
  return fromMermaidAst(mmdParseFlow(text));
}

function fromMermaidAst(ast) {
  const infos = [], warnings = [];
  const seen = new Set();
  const infoOnce = (kind, msg) => { if (!seen.has(kind)) { seen.add(kind); infos.push(msg); } };

  // Directives: known keys first, then item extras (`%% @key id[,id] value` where an id is a node or lane)
  const dir = { showNotes: false, laneOrder: null, schemaVersion: null, swimlanes: null, icons: {}, colors: {}, extras: [] };
  const sgById = new Map(ast.subgraphs.map((s) => [s.id, s]));
  const nodeIds = new Set(ast.nodes.filter((n) => !sgById.has(n.id)).map((n) => n.id));
  ast.directives.forEach((d) => {
    const sp = d.args.search(/\s/);
    const first = sp < 0 ? d.args : d.args.slice(0, sp), rest = sp < 0 ? '' : d.args.slice(sp).trim();
    if (d.key === 'showNotes') dir.showNotes = d.args !== 'false';
    else if (d.key === 'laneOrder') dir.laneOrder = d.args;
    else if (d.key === 'schemaVersion') dir.schemaVersion = Number(d.args);
    else if (d.key === 'swimlanes') dir.swimlanes = d.args !== 'false';
    else if (d.key === 'color') first.split(',').forEach((id) => { dir.colors[id] = rest; });   // a lane colour that is not a palette slot
    else if (d.key === 'type') { /* the use case switch; nothing to do here */ } else if (d.key === 'icon') first.split(',').forEach((id) => { dir.icons[id] = rest; });
    else if (first && first.split(',').every((id) => nodeIds.has(id) || sgById.has(id))) dir.extras.push({ key: d.key, ids: first.split(','), value: rest });
    else infoOnce('dir:' + d.key, `[INFO] line ${d.line}: directive @${d.key} is not used by flowcharts, ignored`);
  });
  if (ast.dirRaw === 'RL' || ast.dirRaw === 'BT') infos.push(`[INFO] direction ${ast.dirRaw} mapped to ${ast.dir}`);
  const kinds = {};
  ast.ignored.forEach((g) => { const k = g.text.split(/\s/)[0]; (kinds[k] = kinds[k] || []).push(g); });
  Object.keys(kinds).forEach((k) => {
    const onlySlots = k === 'classDef' && kinds[k].every((g) => /^classDef\s+c[1-8]\s/.test(g.text));
    if (!onlySlots) infos.push(`[INFO] line ${kinds[k][0].line}: ${k} statements are ignored (${kinds[k].length})`);
  });

  // Lanes: top-level subgraphs; nested ones flatten into their top-level lane
  const topOf = (sg) => { while (sg.parent) sg = sgById.get(sg.parent); return sg; };
  const nested = ast.subgraphs.filter((s) => s.parent);
  if (nested.length) infos.push(`[INFO] nested subgraphs flattened into their top-level lane: ${nested.map((s) => s.id).join(', ')}`);
  const laneIdOf = (id) => (/^[\w-]+$/.test(id) ? id : mmdSafeId(id));
  const tops = ast.subgraphs.filter((s) => !s.parent);
  // No subgraph: no lanes at all (the engine creates its own lane-main). `%% @swimlanes false` keeps written lanes hidden.
  const swimlanes = tops.length > 0 && dir.swimlanes !== false;
  const lanes = tops.map((s) => {
    const l = { id: laneIdOf(s.id), name: s.title };
    if (dir.icons[s.id]) l.icon = dir.icons[s.id];
    const c = s.classes.map((x) => /^c([1-8])$/.exec(x)).find(Boolean);
    if (c) l.color = c[1];
    else if (dir.colors[s.id]) l.color = dir.colors[s.id];
    return l;
  });
  const laneOfNode = new Map();
  ast.subgraphs.forEach((s) => s.nodes.forEach((id) => laneOfNode.set(id, laneIdOf(topOf(s).id))));

  // Notes: flag-shaped nodes whose every edge is dotted
  const flowNodes = ast.nodes.filter((n) => !sgById.has(n.id));
  const incident = (id) => ast.edges.filter((e) => e.from === id || e.to === id);
  const noteSet = new Set(flowNodes.filter((n) => (n.shape === 'odd' || n.shape === 'flag')
    && incident(n.id).every((e) => e.stroke === 'dotted')).map((n) => n.id));
  const real = flowNodes.filter((n) => !noteSet.has(n.id));
  const realIds = new Set(real.map((n) => n.id));

  const notes = [...noteSet].map((id) => {
    const n = ast.nodes.find((x) => x.id === id);
    const links = [];
    incident(id).forEach((e) => { const o = e.from === id ? e.to : e.from; if (realIds.has(o) && !links.includes(o)) links.push(o); });
    if (!links.length) warnings.push(`[WARN] line ${n.line}: note ${id} is linked to no step`);
    return { id, text: n.label, nodes: links };
  });

  // Flow edges
  const dropped = new Set();
  const flow = ast.edges.filter((e) => {
    if (noteSet.has(e.from) || noteSet.has(e.to)) return false;
    if (sgById.has(e.from) || sgById.has(e.to)) { dropped.add('sub'); return false; }
    if (e.stroke === 'invisible') { dropped.add('invisible'); return false; }
    return true;
  });
  if (dropped.has('sub')) infos.push('[INFO] edges to or from a subgraph are dropped');
  if (dropped.has('invisible')) infos.push('[INFO] invisible links (~~~) are layout hints and are dropped');
  if (flow.some((e) => e.head === 'none' && e.stroke !== 'thick')) infoOnce('headless', '[INFO] links without an arrow head are drawn as arrows');
  if (flow.some((e) => e.stroke === 'dotted')) infoOnce('dotted', '[INFO] dotted links between steps are drawn as arrows');
  if (flow.some((e) => e.head === 'circle' || e.head === 'cross' || e.both)) infoOnce('heads', '[INFO] circle, cross and two-way link ends are drawn as plain arrows');
  const hasOut = new Set(flow.map((e) => e.from));

  const SHAPE_TYPE = { rect: 'task', diamond: 'decision', subroutine: 'subprocess', subproc: 'subprocess', 'lean-r': 'io',
    cylinder: 'database', cyl: 'database', doc: 'document', delay: 'delay', 'sm-circ': 'start', 'fr-circ': 'end', 'f-circ': 'end', 'dbl-circ': 'end' };
  const lenient = {};
  let classIgnored = false;
  const nodes = real.map((n) => {
    let type = SHAPE_TYPE[n.shape];
    if (n.shape === 'stadium') type = n.classes.includes('isStart') ? 'start' : n.classes.includes('isEnd') ? 'end' : hasOut.has(n.id) ? 'start' : 'end';
    else if (n.shape === 'circle' && /^[A-Z]{1,2}$/.test(n.label)) type = 'connector';
    else if (!type) { type = 'task'; (lenient[n.shape] = lenient[n.shape] || []).push(n.id); }
    if (n.classes.some((c) => !MMD_FLOW_FLAGS.includes(c))) classIgnored = true;
    let laneId = laneOfNode.get(n.id);
    if (!laneId && lanes.length) {
      laneId = lanes[0].id;
      warnings.push(`[WARN] line ${n.line}: step ${n.id} is outside every lane; put into lane ${laneId}`);
    }
    return laneId ? { id: n.id, laneId, type, label: n.label } : { id: n.id, type, label: n.label };
  });
  Object.keys(lenient).forEach((s) => infos.push(`[INFO] shape ${s} has no flowchart equivalent: ${lenient[s].join(', ')} read as task`));
  if (classIgnored) infos.push('[INFO] classes on steps are ignored (flowchart steps have no colour)');

  dir.extras.forEach((x) => x.ids.forEach((id) => {
    const target = nodes.find((n) => n.id === id) || lanes.find((l) => l.id === laneIdOf(id));
    if (target && !(x.key in target)) target[x.key] = x.value;
  }));

  const edges = flow.map((e, i) => {
    const o = { id: 'e' + (i + 1), from: e.from, to: e.to, label: e.label };
    if (e.stroke === 'thick') o.feedback = true;
    return o;
  });

  const data = { diagramType: 'flowchart' };
  if (dir.schemaVersion != null && !isNaN(dir.schemaVersion)) data.schemaVersion = dir.schemaVersion;
  if (ast.title) data.title = ast.title;
  if (ast.dir) data.direction = ast.dir;
  if (!swimlanes) data.swimlanes = false;
  if (dir.showNotes) data.showNotes = true;
  if (dir.laneOrder) data.laneOrder = dir.laneOrder;
  data.lanes = lanes;
  data.nodes = nodes;
  data.edges = edges;
  if (notes.length) data.notes = notes;
  return { data, infos, warnings };
}

function toMermaid(data, opts) {
  opts = opts || {};
  const used = new Set(), ids = new Map();
  const sid = (kind, raw) => { const k = kind + '\0' + raw; if (!ids.has(k)) ids.set(k, mmdSafeId(raw, used)); return ids.get(k); };
  const lanes = data.lanes || [];
  const nodes = data.nodes || [];
  lanes.forEach((l) => sid('l', l.id));
  nodes.forEach((n) => sid('n', n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (data.edges || []).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const hasOut = new Set(edges.map((e) => e.from));
  const q = mmdQuote;
  const out = [];
  const flags = [];

  if (data.title) out.push('---', 'title: ' + JSON.stringify(String(data.title)), '---');
  out.push('flowchart' + (data.direction === 'LR' || data.direction === 'TB' ? ' ' + data.direction : ''));

  const dirs = [];
  if (data.schemaVersion != null) dirs.push('%% @schemaVersion ' + data.schemaVersion);
  if (data.showNotes) dirs.push('%% @showNotes');
  if (data.laneOrder) dirs.push('%% @laneOrder ' + data.laneOrder);
  if (data.swimlanes === false && lanes.length) dirs.push('%% @swimlanes false');
  lanes.forEach((l) => { if (l.color != null && !/^[1-8]$/.test(String(l.color))) dirs.push(`%% @color ${sid('l', l.id)} ${l.color}`); });
  lanes.forEach((l) => { if (l.icon) dirs.push(`%% @icon ${sid('l', l.id)} ${l.icon}`); });
  const extras = (o, id) => Object.keys(o).forEach((k) => {
    if (['id', 'laneId', 'type', 'label', 'name', 'icon', 'color', 'colorKey'].includes(k) || MMD_FLOW_KNOWN_DIRECTIVES.includes(k)
      || MMD_FLOW_LAYOUT_KEYS.includes(k) || !/^\w+$/.test(k)) return;
    if (typeof o[k] === 'string' && o[k] && !/[\r\n]/.test(o[k])) dirs.push(`%% @${k} ${id} ${o[k]}`);
  });
  lanes.forEach((l) => extras(l, sid('l', l.id)));
  nodes.forEach((n) => extras(n, sid('n', n.id)));
  dirs.forEach((d) => out.push('  ' + d));

  const decl = (n) => {
    const id = sid('n', n.id), L = String(n.label == null ? '' : n.label).trim();
    switch (n.type) {
      case 'start':
        if (L && !hasOut.has(n.id)) flags.push(`class ${id} isStart`);
        return L ? `${id}([${q(L)}])` : `${id}@{ shape: sm-circ }`;
      case 'end':
        if (L && hasOut.has(n.id)) flags.push(`class ${id} isEnd`);
        return L ? `${id}([${q(L)}])` : `${id}@{ shape: fr-circ }`;
      case 'decision': return `${id}{${q(L)}}`;
      case 'subprocess': return `${id}[[${q(L)}]]`;
      case 'io': return `${id}[/${q(L)}/]`;
      case 'database': return `${id}[(${q(L)})]`;
      case 'document': return `${id}@{ shape: doc, label: ${q(L)} }`;
      case 'delay': return `${id}@{ shape: delay, label: ${q(L)} }`;
      case 'connector': return `${id}((${q(L)}))`;
      default: return `${id}[${q(L)}]`;
    }
  };
  const placed = new Set();
  lanes.forEach((l) => {
    out.push(`  subgraph ${sid('l', l.id)}[${q(l.name)}]`);
    nodes.filter((n) => n.laneId === l.id).forEach((n) => { out.push('    ' + decl(n)); placed.add(n.id); });
    out.push('  end');
  });
  nodes.filter((n) => !placed.has(n.id)).forEach((n) => out.push('  ' + decl(n)));

  // Edges, consecutive ones that continue from the previous target are chained
  const link = (e) => (e.feedback ? '==>' : '-->') + (e.label ? `|${q(e.label)}|` : '');
  for (let i = 0; i < edges.length;) {
    let line = `  ${sid('n', edges[i].from)} ${link(edges[i])} ${sid('n', edges[i].to)}`, k = 1;
    while (i + k < edges.length && k < 6 && edges[i + k].from === edges[i + k - 1].to) {
      line += ` ${link(edges[i + k])} ${sid('n', edges[i + k].to)}`;
      k++;
    }
    out.push(line);
    i += k;
  }

  (data.notes || []).forEach((n) => {
    const nid = sid('note', n.id), links = (n.nodes || []).filter((x) => nodeIds.has(x)).map((x) => sid('n', x));
    out.push(`  ${nid}>${q(n.text)}]` + (links.length ? ` -.- ${links.join(' & ')}` : ''));
  });

  const slots = new Set();
  lanes.forEach((l) => { if (/^[1-8]$/.test(String(l.color))) { out.push(`  class ${sid('l', l.id)} c${l.color}`); slots.add(+l.color); } });
  flags.forEach((f) => out.push('  ' + f));
  if (opts.palette) [...slots].sort().forEach((s) => { if (opts.palette[s - 1]) out.push(`  classDef c${s} fill:${opts.palette[s - 1]}`); });
  return out.join('\n') + '\n';
}
