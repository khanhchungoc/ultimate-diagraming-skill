// C4 normaliser for dev/check_mermaid.mjs. The writer shows one level and Mermaid has no place for some fields, so the original
// is brought to what the text can say, then compared strictly with the reader's result:
//   - dropped: layout, canvas, schemaVersion, notes, `async`, `collapsed`, positions and sizes;
//   - a collapsed group, or a system group that is not the open one, is one `system` element (id, name, colour, centre, side),
//     its inside is gone, and a relation that crosses its border is drawn on it (several between the same two ends: one
//     "N relations" line, no technology);
//   - a `container` group reads back as a `system` group (container groups arrive with Level 3);
//   - elements compare sorted by id (the text writes elements, boxes, then frames); groups keep their order;
//   - ids go through `safeId` (given for the original side only), groups first, as the writer does.
const COMPUTED = new Set(['x', 'y', 'w', 'h', 'box', 'points', 'labelBox']);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !COMPUTED.has(k) && !k.startsWith('_')));

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function normalise(data, safeId) {
  // The reader's result already is what the text says: only the element order is brought to the compared form.
  if (!safeId) { const { schemaVersion, ...rest } = data; return { ...rest, elements: [...(data.elements || [])].sort(byId) }; }
  const used = new Set(), map = new Map();
  if (safeId) for (const o of [...(data.groups || []), ...(data.elements || [])]) if (!map.has(o.id)) map.set(o.id, safeId(o.id, used));
  const m = (v) => (typeof v === 'string' && map.has(v) ? map.get(v) : v);
  const groups = (data.groups || []).map(strip), gById = new Map(groups.map((g) => [g.id, g]));
  const up = (g) => { const c = []; for (let x = g; x && !c.includes(x); x = gById.get(x.parent)) c.unshift(x); return c; };
  const open = groups.find((g) => g.kind === 'system' && g.collapsed !== true && !up(g).some((x) => x.collapsed === true));
  const isTile = (g) => g.collapsed === true || (g.kind === 'system' && g !== open);
  const tileOf = (gid) => up(gById.get(gid)).find(isTile);
  const own = (o) => { const r = { ...o }; delete r.collapsed; delete r.async; return r; };

  const out = {};
  for (const [k, v] of Object.entries(data)) if (!['layout', 'canvas', 'schemaVersion', 'notes', 'groups', 'elements', 'relations'].includes(k) && !k.startsWith('_')) out[k] = v;
  const tiles = groups.filter((g) => isTile(g) && !tileOf(g.parent));
  out.groups = groups.filter((g) => !isTile(g) && !tileOf(g.parent)).map((g) => {
    const o = own(g);
    if (o.kind === 'container') o.kind = 'system';
    o.id = m(o.id);
    if (o.parent !== undefined) o.parent = m(o.parent);
    return o;
  });
  out.elements = [
    ...(data.elements || []).filter((e) => !tileOf(e.group)).map((e) => { const o = own(strip(e)); o.id = m(o.id); if (o.group !== undefined) o.group = m(o.group); return o; }),
    ...tiles.map((g) => {
      const o = { id: m(g.id), kind: 'system', name: g.name };
      for (const k of ['color', 'core', 'side']) if (g[k] !== undefined) o[k] = g[k];
      if (g.parent !== undefined) o.group = m(g.parent);
      return o;
    }),
  ].sort(byId);
  const elById = new Map((data.elements || []).map((e) => [e.id, e]));
  const endOf = (id) => { const t = elById.has(id) ? tileOf(elById.get(id).group) : null; return t ? t.id : id; };
  const lines = [], merged = new Map();
  for (const r of data.relations || []) {
    if (!elById.has(r.from) || !elById.has(r.to)) continue;
    const a = endOf(r.from), b = endOf(r.to);
    if (a === b) continue;
    if (a === r.from && b === r.to) { lines.push(own(strip(r))); continue; }
    const key = `${a}\0${b}`;
    if (!merged.has(key)) { const l = { from: a, to: b, rs: [] }; merged.set(key, l); lines.push(l); }
    merged.get(key).rs.push(r);
  }
  out.relations = lines.map((l) => {
    const o = l.rs ? (l.rs.length === 1 ? { from: l.from, to: l.to, label: l.rs[0].label, ...(l.rs[0].tech ? { tech: l.rs[0].tech } : {}) } : { from: l.from, to: l.to, label: `${l.rs.length} relations` }) : l;
    o.from = m(o.from);
    o.to = m(o.to);
    if (o.label === undefined || o.label === '') o.label = ' ';
    return o;
  });
  return out;
}
