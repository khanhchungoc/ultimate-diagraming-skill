// Sequence normaliser for dev/check_mermaid.mjs. Both sides are brought to one form before they are compared:
//   - message ids are positional on import, so ids are replaced by m1.. on both sides and every reference follows;
//   - participant ids go through `safeId` on the original side (the writer sanitises them), and every reference follows;
//   - fragment and note ids are dropped, and the two lists are compared in text order (a frame by where it opens, a note by the slot
//     it sits in; ties keep the authored order), because Mermaid has no other order;
//   - a fragment's branches are one list: the short form elseAt is one unlabelled branch;
//   - defaults are explicit (message kind sync, participant kind system, branch label "", no fragments or notes).
// Positions and the engine's computed fields are dropped. Everything else is compared as it is.
const COMPUTED = new Set(['x', 'y', 'w', 'h', 'layout', 'rail', 'top', 'bottom', 'hidden', 'elseY', 'dividers']);

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !COMPUTED.has(k)));

export function normalise(data, safeId, base) { // eslint-disable-line no-unused-vars
  const used = new Set(), pmap = new Map(), mmap = new Map();
  (data.participants || []).forEach((p) => { if (!pmap.has(p.id)) pmap.set(p.id, safeId ? safeId(p.id, used) : p.id); });
  (data.messages || []).forEach((m, i) => { if (!mmap.has(m.id)) mmap.set(m.id, `m${i + 1}`); });
  const P = (v) => (typeof v === 'string' && pmap.has(v) ? pmap.get(v) : v);
  const M = (v) => (typeof v === 'string' && mmap.has(v) ? mmap.get(v) : v);
  const at = (v) => (typeof v === 'string' && mmap.has(v) ? Number(mmap.get(v).slice(1)) : Infinity);

  const out = {};
  for (const [k, v] of Object.entries(strip(data))) if (!['participants', 'messages', 'fragments', 'notes'].includes(k)) out[k] = v;

  out.participants = (data.participants || []).map((p) => {
    const o = strip(p);
    o.id = P(p.id);
    if (o.kind === undefined) o.kind = 'system';
    ['start', 'end'].forEach((k) => { if (o[k] !== undefined) o[k] = M(o[k]); });
    if (o.column !== undefined) o.column = P(o.column);
    return o;
  });

  out.messages = (data.messages || []).map((m) => {
    const o = strip(m);
    o.id = mmap.get(m.id);
    o.from = P(m.from);
    o.to = P(m.to);
    if (o.kind === undefined) o.kind = 'sync';
    if (o.detail === '') delete o.detail;
    if (o.until !== undefined) o.until = M(o.until);
    return o;
  });

  out.fragments = (data.fragments || []).map((f, i) => {
    const o = strip(f);
    delete o.id;
    delete o.elseAt;
    o.from = M(f.from);
    o.to = M(f.to);
    const list = Array.isArray(f.branches) ? f.branches : f.elseAt === undefined ? [] : [{ at: f.elseAt }];
    if (list.length) o.branches = list.map((b) => ({ at: M(b.at), label: b.label || '' })); else delete o.branches;
    return { o, i };
  }).sort((p, q) => at(p.o.from) - at(q.o.from) || at(q.o.to) - at(p.o.to) || p.i - q.i).map((r) => r.o);

  out.notes = (data.notes || []).map((n, i) => {
    const o = strip(n);
    delete o.id;
    if (Array.isArray(o.over)) o.over = o.over.length === 1 ? P(o.over[0]) : o.over.map(P); else if (o.over !== undefined) o.over = P(o.over);
    // The slot a note sits in: above the first message (no anchor), before a message, after a message
    let key = [-1, 0];
    if (n.after != null) { key = [at(n.after), 1]; o.after = M(n.after); delete o.before; } else if (n.before != null) { key = [at(n.before), 0]; o.before = M(n.before); }
    return { o, i, key };
  }).sort((p, q) => p.key[0] - q.key[0] || p.key[1] - q.key[1] || p.i - q.i).map((r) => r.o);
  return out;
}
