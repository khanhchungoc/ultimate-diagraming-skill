// ERD normaliser for dev/check_mermaid.mjs. Compares everything the Mermaid round trip must keep. fromEnd, toEnd and identifying
// are made explicit first (an absent value equals the effective value the engine uses), and an empty relationship `columns`
// list equals an absent one; every other field compares as written. Ignored, as the plan allows: positions, the layout map
// and other engine output, `direction`, relationship and note ids (generated on import, compared as ordered lists), and the
// ids of tables, which go through the writer's id sanitiser (`safeId`, given for the original side only). Empty lists are made
// explicit: no tables, relationships, notes or columns.
const TOP_DROP = new Set(['layout', 'canvas', 'direction', '_band', '_loose']);
const ENTITY_DROP = new Set(['x', 'y', 'box']);
const REL_DROP = new Set(['id', 'curve', 'points', 'labelBox']);

export function normalise(data, safeId) {
  const used = new Set();
  const map = new Map();
  if (safeId) for (const e of data.entities || []) if (e && typeof e.id === 'string' && !map.has(e.id)) map.set(e.id, safeId(e.id, used));
  const m = (v) => (typeof v === 'string' && map.has(v) ? map.get(v) : v);
  const pick = (o, drop, fn) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k)).map(([k, v]) => [k, fn ? fn(k, v) : v]));
  const out = {};
  for (const [k, v] of Object.entries(data)) if (!TOP_DROP.has(k)) out[k] = v;
  out.entities = (data.entities || []).map((e) => {
    const o = pick(e, ENTITY_DROP, (k, v) => (k === 'id' ? m(v) : v));
    if (o.columns === undefined) o.columns = [];
    return o;
  });
  const byId = new Map((data.entities || []).map((e) => [e && e.id, e]));
  out.relationships = (data.relationships || []).map((r) => {
    const names = Array.isArray(r.columns) ? r.columns : [];
    const cols = ((byId.get(r.from) || {}).columns || []);
    const col = (n) => cols.find((c) => c && c.name === n) || {};
    const o = pick(r, REL_DROP, (k, v) => (k === 'from' || k === 'to' ? m(v) : v));
    if (!names.length) delete o.columns;
    o.fromEnd = r.fromEnd || 'zeroOrMany';
    o.toEnd = r.toEnd || (names.length && names.every((n) => col(n).nullable === true) ? 'zeroOrOne' : 'one');
    o.identifying = r.identifying == null ? names.length > 0 && names.every((n) => col(n).pk === true) : r.identifying;
    return o;
  });
  out.notes = (data.notes || []).map((n) => pick(n, new Set(['id']), (k, v) => (k === 'entities' && Array.isArray(v) ? v.map(m) : v)));
  return out;
}
