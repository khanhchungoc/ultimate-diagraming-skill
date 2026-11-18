// Sequence diagram <-> Mermaid. Plain script, no DOM, no imports; concatenated after assets/shell/mermaid-flow.js
// (needs mmdText, mmdSafeId). Mapping: dev/plans/plan-mermaid-input.md, "Sequence". The flowchart tokenizer does not
// apply here: a sequenceDiagram is read line by line by the mmdSeq helpers below.
//
// Positional model: messages are m1.. in text order, and frames and notes hold their message ids by position.
// A note right after a message is `after` it; a note after a frame opening, `else`, `and` or `end` is `before` the next
// message; a note before the first message has no anchor. The writer adds `%% @before` where the plain reading would
// differ (a note before a message that directly follows another message), so JSON -> Mermaid -> JSON is exact.
// A group's label is the first `Note over` inside its `rect`, since Mermaid's rect has no name of its own.

const MMD_SEQ_RESERVED = ['alt', 'else', 'opt', 'loop', 'par', 'and', 'end', 'rect', 'box', 'note', 'participant', 'actor', 'create',
  'destroy', 'activate', 'deactivate', 'autonumber', 'title', 'link', 'links', 'properties', 'details', 'critical', 'option', 'break',
  'as', 'over', 'left', 'right', 'of', 'off', 'sequencediagram', 'acctitle', 'accdescr'];
const MMD_SEQ_COLOURS = ['transparent', 'aqua', 'black', 'blue', 'fuchsia', 'gray', 'grey', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange',
  'purple', 'red', 'silver', 'teal', 'white', 'yellow'];
// Mermaid type -> JSON kind (boundary is the UML name for a screen or front end)
const MMD_SEQ_TYPE_KIND = { database: 'database', queue: 'queue', boundary: 'ui', control: 'system', entity: 'system', collections: 'system' };
const MMD_SEQ_KIND_TYPE = { database: 'database', queue: 'queue', ui: 'boundary' };
// message arrow -> [JSON kind, nearest-arrow note or '']
const MMD_SEQ_ARROWS = {
  '->>': ['sync', ''], '-->>': ['reply', ''], '-)': ['async', ''],
  '->': ['sync', 'a plain line'], '-->': ['reply', 'a dashed plain line'], '-x': ['sync', 'a cross'], '--x': ['reply', 'a dashed cross'],
  '--)': ['async', 'a dashed open arrow'], '<<->>': ['sync', 'a two-way arrow'], '<<-->>': ['reply', 'a dashed two-way arrow'],
};
const MMD_SEQ_ARROW_OF = { sync: '->>', reply: '-->>', async: '-)' };

// Text on one Mermaid line: # and ; escaped, line breaks as `nl` (<br> by default), a literal "<br" kept apart from a break.
function mmdSeqEsc(s, nl) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n')
    .replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;'))
    .replace(/<(?=br\s*\/?>)/gi, '#lt;')
    .replace(/\n/g, nl || '<br>');
}

// "#rrggbb" -> [r, g, b], or null
function mmdSeqHexRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// A CSS colour as written in Mermaid (rgb(), rgba() or #hex) -> [r, g, b], or null
function mmdSeqRgb(css) {
  const t = String(css).trim();
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(t);
  return m ? [+m[1], +m[2], +m[3]] : mmdSeqHexRgb(t);
}

// Split "<colour> <label>" as Mermaid does for `box` and `rect`: the first word is the colour when it is one.
function mmdSeqSplitColour(rest) {
  const m = /^((?:rgba?|hsla?)\s*\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+)\s*([\s\S]*)$/i.exec(String(rest).trim());
  if (m && (/^(?:rgba?|hsla?)\s*\(/i.test(m[1]) || m[1][0] === '#' || MMD_SEQ_COLOURS.includes(m[1].toLowerCase()))) return { colour: m[1], label: m[2] };
  return { colour: '', label: String(rest).trim() };
}

// The CSS colour the writer draws a palette slot or a custom hex with: translucent, so arrows stay readable
function mmdSeqCss(value, palette) {
  const hex = /^[1-8]$/.test(String(value)) ? (palette && palette[Number(value) - 1]) : String(value);
  const c = hex && mmdSeqHexRgb(hex);
  return c ? 'rgba(' + c.join(', ') + ', 0.25)' : '';   // tokens-ok: Mermaid's own colour syntax for a box or rect, not a page style
}

function fromMermaid(text, opts) {
  opts = opts || {};
  const infos = [], warnings = [];
  const info = (s) => infos.push('[INFO] ' + s);
  const warn = (s) => warnings.push('[WARN] ' + s);
  const once = new Set();
  const infoOnce = (key, s) => { if (!once.has(key)) { once.add(key); info(s); } };
  const palette = Array.isArray(opts.palette) && opts.palette.length ? opts.palette.map(mmdSeqHexRgb) : null;

  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const data = { diagramType: 'sequence' };
  let li = 0;
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {   // front matter: the title
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const m = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (m) {
        let v = m[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ''); } } else if (v[0] === "'") v = v.replace(/^'|'$/g, '');
        data.title = mmdText(v);
      }
      li++;
    }
    li++;
  }

  const parts = [], partById = new Map();
  const msgs = [], frames = [], notes = [], stack = [], boxes = [], globals = [];
  let pending = {}, lastKind = 'none', headerSeen = false, ln = 0, createdNext = null, destroyedNext = null;
  let notesInFrame = 0, droppedFrames = 0, droppedBranches = 0, bars = false, opened = 0;

  const part = (id) => {
    let p = partById.get(id);
    if (!p) { p = { id, name: id }; parts.push(p); partById.set(id, p); }
    return p;
  };
  // Directives that belong to the next message, frame or note are taken here; any other one is reported
  const take = (allowed) => {
    const got = {};
    Object.keys(pending).forEach((k) => {
      if (allowed.includes(k)) got[k] = pending[k]; else warn('line ' + pending[k].line + ': @' + k + ' does not apply to the next statement, ignored');
    });
    pending = {};
    return got;
  };
  const flag = (d) => (/^false$/i.test(String(d.args).trim()) ? false : true);

  function declare(kw, rest, created) {   // participant / actor
    const m = /^(\S+?)\s*(?:@\{([^}]*)\})?\s*(?:\bas\b\s*([\s\S]*))?$/i.exec(rest.trim());
    if (!m) { warn('line ' + ln + ': cannot read the participant "' + rest + '"'); return; }
    const p = part(m[1]);
    if (m[3] !== undefined) p.name = mmdText(m[3]);
    if (/^actor$/i.test(kw)) p.kind = 'actor';
    const t = m[2] && /["']?type["']?\s*:\s*["']?(\w+)/i.exec(m[2]);
    if (t) {
      const k = MMD_SEQ_TYPE_KIND[t[1].toLowerCase()];
      if (k) { p.kind = k; if (k === 'system') infoOnce('type' + t[1], 'participant type "' + t[1] + '" read as a plain service'); } else if (t[1].toLowerCase() !== 'participant') infoOnce('type' + t[1], 'participant type "' + t[1] + '" read as a plain service');
    }
    if (stack.length && stack[stack.length - 1].box) stack[stack.length - 1].box.members.push(p);
    return p;
  }

  function note(side, over, body) {
    const ids = over.split(',').map((s) => s.trim()).filter(Boolean);
    if (side !== 'over') infoOnce('noteside', '"Note left of" and "Note right of" are read as a note over that participant');
    if (ids.length > 2) infoOnce('note3', 'a note over more than two participants keeps the first two');
    ids.slice(0, 2).forEach((id) => part(id));
    const dir = take(['before', 'place']);
    const top = stack[stack.length - 1];
    const n = { text: mmdText(body), over: ids.length > 1 ? ids.slice(0, 2) : ids[0] };
    if (dir.place) {
      const v = Number(String(dir.place.args).trim());
      if (isFinite(v)) { delete n.over; n.place = v; } else warn('line ' + dir.place.line + ': @place needs a number, ignored');
    }
    let mode;
    if (lastKind === 'msg') mode = dir.before ? 'before' : 'after';
    else if (lastKind === 'none') mode = 'free';
    else mode = 'before';
    const entry = { n, mode, at: msgs.length };
    notes.push(entry);
    if (lastKind === 'open' && top) {
      // The first note right after a `rect` opens is the group's label; it is kept as an ordinary note if the rect ends up empty
      if (top.rect && !top.labelEntry) top.labelEntry = entry; else top.early = (top.early || 0) + 1;
    }
    return n;
  }

  function openBlock(kw, rest) {
    const dir = take(['color', 'collapsed']);
    const b = { kind: kw, a: msgs.length, branches: [], line: ln, order: opened++ };
    let label = rest;
    if (kw === 'rect') {
      const sp = mmdSeqSplitColour(rest);
      b.css = sp.colour;
      label = sp.label;
    }
    if (kw === 'critical') { b.kind = 'group'; b.critical = true; infoOnce('critical', '"critical" is read as a group, or as an alt when it has "option" branches'); }
    if (kw === 'rect') { b.kind = 'group'; b.rect = true; }
    b.label = mmdText(label);
    if (dir.color) b.color = String(dir.color.args).trim();
    if (dir.collapsed) b.collapsed = flag(dir.collapsed);
    stack.push(b);
    lastKind = 'open';
  }

  function branch(kw, rest) {
    const b = stack[stack.length - 1];
    if (!b || b.box) { warn('line ' + ln + ': "' + kw + '" outside a frame, ignored'); return; }
    if (b.critical && b.kind === 'group') b.kind = 'alt';   // "option" branches need an alt
    if (b.kind !== 'alt' && b.kind !== 'par') { infoOnce('branch' + b.kind, '"' + kw + '" in a ' + b.kind + ' frame is ignored: only alt and par have branches'); return; }
    b.branches.push({ e: msgs.length, label: mmdText(rest) });
    lastKind = 'else';
  }

  function closeBlock() {
    const top = stack.pop();
    if (!top) { warn('line ' + ln + ': "end" with nothing open, ignored'); return; }
    if (top.box) { boxes.push(top.box); return; }
    lastKind = 'end';
    const b = msgs.length - 1;
    if (b < top.a) { droppedFrames++; return; }   // no message inside: a frame is a range of messages; its notes stay
    notesInFrame += top.early || 0;
    if (top.labelEntry) { top.label = top.labelEntry.n.text; notes.splice(notes.indexOf(top.labelEntry), 1); }
    const seen = new Set();
    const br = [];
    top.branches.forEach((x) => {
      if (x.e > top.a && x.e <= b && !seen.has(x.e)) { seen.add(x.e); br.push({ at: 'm' + (x.e + 1), label: x.label }); } else droppedBranches++;
    });
    const f = { kind: top.kind, label: top.label, from: 'm' + (top.a + 1), to: 'm' + (b + 1), color: top.color, collapsed: top.collapsed, css: top.css, br, order: top.order };
    frames.push(f);
  }

  function message(m) {
    const arrow = MMD_SEQ_ARROWS[m[2]];
    if (arrow[1]) infoOnce('arrow' + m[2], '"' + m[2] + '" (' + arrow[1] + ') is read as ' + MMD_SEQ_ARROW_OF[arrow[0]]);
    if (m[3]) bars = true;
    const from = part(m[1].trim()), to = part(m[4].trim());
    const dir = take(['activate', 'until']);
    const raw = m[5] === undefined ? '' : m[5];
    const cut = /<br\s*\/?>/i.exec(raw);
    const msg = { from: from.id, to: to.id, label: mmdText(cut ? raw.slice(0, cut.index) : raw) };
    if (cut) { const d = mmdText(raw.slice(cut.index + cut[0].length)); if (d) msg.detail = d; }
    if (arrow[0] !== 'sync') msg.kind = arrow[0];
    if (dir.activate && !flag(dir.activate)) msg.activate = false;
    if (dir.until) {
      const k = parseInt(String(dir.until.args).trim(), 10);
      if (k >= 1) msg.until = 'm' + k; else warn('line ' + dir.until.line + ': @until needs a step number, ignored');
    }
    msgs.push(msg);
    const idx = msgs.length - 1;
    if (createdNext) { if (!createdNext.start) createdNext.start = 'm' + (idx + 1); createdNext = null; }
    if (destroyedNext) { destroyedNext.end = 'm' + (idx + 1); destroyedNext = null; }
    lastKind = 'msg';
  }

  const header = /^sequenceDiagram\b/i;
  for (; li < lines.length; li++) {
    ln = li + 1;
    const line = lines[li].trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      const d = /^%%\s*@(\w+)(?:\s+([\s\S]*))?$/.exec(line);
      if (!d) continue;
      const dir = { key: d[1], args: (d[2] || '').trim(), line: ln };
      if (['activate', 'until', 'collapsed', 'before', 'place'].includes(dir.key) || (dir.key === 'color' && !/\s/.test(dir.args))) pending[dir.key] = dir;
      else globals.push(dir);
      continue;
    }
    if (!headerSeen) {
      if (!header.test(line)) throw new Error('line ' + ln + ': expected "sequenceDiagram"');
      headerSeen = true;
      continue;
    }
    // `;` ends a statement as a new line does (but not the one that ends an entity such as #59;)
    const stmts = [];
    let cur = '';
    for (const c of line) {
      if (c === ';' && !/#\w*$/.test(cur)) { stmts.push(cur); cur = ''; } else cur += c;
    }
    stmts.push(cur);
    for (const raw of stmts) {
      const s = raw.trim();
      if (!s) continue;
      let m;
      if ((m = /^(participant|actor)\s+([\s\S]+)$/i.exec(s))) declare(m[1], m[2]);
      else if ((m = /^create\s+(participant|actor)\s+([\s\S]+)$/i.exec(s))) { const p = declare(m[1], m[2]); if (p) createdNext = p; }
      else if ((m = /^destroy\s+(\S+)/i.exec(s))) destroyedNext = part(m[1]);
      else if ((m = /^box(?:\s+([\s\S]*))?$/i.exec(s))) {
        const sp = mmdSeqSplitColour(m[1] || '');
        const dir = take(['color']);
        stack.push({ line: ln, box: { css: sp.colour, label: mmdText(sp.label), members: [], slot: dir.color && /^[1-9]$/.test(dir.color.args.trim()) ? dir.color.args.trim() : '' } });
      } else if (/^end$/i.test(s)) closeBlock();
      else if ((m = /^(alt|opt|loop|par|rect|critical|break)(?:\s+([\s\S]*))?$/i.exec(s))) openBlock(m[1].toLowerCase(), m[2] || '');
      else if ((m = /^(else|and|option)(?:\s+([\s\S]*))?$/i.exec(s))) branch(m[1].toLowerCase(), m[2] || '');
      else if (/^autonumber(?:\s|$)/i.test(s)) {
        if (/^autonumber\s+off\b/i.test(s)) data.numbered = false;
        else { data.numbered = true; if (/^autonumber\s+\S/i.test(s)) infoOnce('autonumber', '"autonumber" start and step are ignored: steps are numbered from 1'); }
      } else if ((m = /^title(?:\s*:\s*|\s+)([\s\S]*)$/i.exec(s))) data.title = mmdText(m[1]);
      else if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:([\s\S]*)$/i.exec(s))) note(m[1].toLowerCase().split(' ')[0], m[2], m[3]);
      else if (/^(activate|deactivate)\s/i.test(s)) bars = true;
      else if (/^(links?|properties|details|acctitle|accdescr)\b/i.test(s)) infoOnce('ign' + s.split(/\s/)[0].toLowerCase(), '"' + s.split(/[\s:]/)[0] + '" is not used by sequence diagrams, ignored');
      else if ((m = /^(.*?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]*?)\s*(?::([\s\S]*))?$/.exec(s)) && m[1] && m[4]) message(m);
      else warn('line ' + ln + ': not understood, skipped: ' + s);
    }
  }
  if (!headerSeen) throw new Error('line 1: expected "sequenceDiagram"');
  while (stack.length) { info('line ' + stack[stack.length - 1].line + ': a frame or box is never closed with "end"; closed at the end'); ln = lines.length; closeBlock(); }
  take([]);

  if (bars) infoOnce('bars', 'activation bars ("+", "-", activate, deactivate) are ignored: bars are computed from the calls and replies; use %% @activate false or %% @until <step> to change one');
  if (notesInFrame) info(notesInFrame + ' note(s) sit inside a frame before its first message; a note is anchored to a message, so they are placed before the frame');
  if (droppedFrames) info(droppedFrames + ' frame(s) with no message inside were dropped: a frame covers a range of messages (their notes are kept)');
  if (droppedBranches) info(droppedBranches + ' else/and branch(es) with no message of their own in the frame were dropped (their notes are kept)');

  // Diagram directives
  const colorKey = {};
  const explicitColor = new Map();
  globals.forEach((d) => {
    const a = d.args;
    let m;
    switch (d.key) {
      case 'schemaVersion': if (a !== '' && !isNaN(Number(a))) data.schemaVersion = Number(a); break;
      case 'colorKey': if ((m = /^(\S+)\s+([\s\S]+)$/.exec(a))) colorKey[m[1]] = mmdText(m[2]); break;
      case 'showDetails': data.showDetails = flag(d); break;
      case 'rails': data.rails = flag(d); break;
      case 'lifespans': data.lifespans = flag(d); break;
      case 'participantOrder': if (a) data.participantOrder = a; break;
      case 'kind':
        if ((m = /^(\S+)\s+(\S+)$/.exec(a)) && partById.has(m[1])) partById.get(m[1]).kind = m[2]; else warn('line ' + d.line + ': @kind needs a known participant and a kind');
        break;
      case 'column':
        if ((m = /^(\S+)\s+(\S+)$/.exec(a)) && partById.has(m[1]) && partById.has(m[2])) partById.get(m[1]).column = m[2]; else warn('line ' + d.line + ': @column needs two known participants');
        break;
      case 'color':
        if ((m = /^(\S+)\s+(\S+)$/.exec(a)) && partById.has(m[1])) explicitColor.set(m[1], m[2]); else warn('line ' + d.line + ': @color needs a known participant and a colour');
        break;
      case 'start': case 'end':
        if ((m = /^(\S+)\s+(\d+)$/.exec(a)) && partById.has(m[1])) partById.get(m[1])[d.key] = 'm' + m[2]; else warn('line ' + d.line + ': @' + d.key + ' needs a known participant and a step number');
        break;
      case 'type': break;
      default: info('line ' + d.line + ': unknown directive @' + d.key + ' ignored');
    }
  });

  // Colours of boxes and rects: a `%% @color` slot before the box, else the palette slot nearest the colour, else the next free slot
  const cssSlot = new Map();
  const taken = new Set(Object.keys(colorKey));
  explicitColor.forEach((v) => { if (/^[1-9]$/.test(v)) taken.add(v); });
  const slotOf = (css) => {
    const k = css.replace(/\s+/g, '').toLowerCase();
    if (cssSlot.has(k)) return cssSlot.get(k);
    const rgb = mmdSeqRgb(css);
    let slot;
    if (rgb && palette) {
      let best = Infinity;
      palette.forEach((c, i) => { if (c) { const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (d < best) { best = d; slot = String(i + 1); } } });
    } else {
      let n = 1;
      while (taken.has(String(n)) && n < 8) n++;
      slot = String(n);
      if (taken.has(slot)) infoOnce('slots', 'more than 8 distinct colours: the last slot is reused');
      taken.add(slot);
    }
    cssSlot.set(k, slot);
    return slot;
  };
  boxes.forEach((bx) => {
    let slot = bx.slot;
    if (!slot && (bx.css || bx.label)) slot = bx.css && bx.css.toLowerCase() !== 'transparent' ? slotOf(bx.css) : slotOf('box:' + bx.label);
    if (!slot) return;
    if (bx.label && !colorKey[slot]) colorKey[slot] = bx.label;
    bx.members.forEach((p) => { if (!explicitColor.has(p.id)) p.color = slot; });
  });
  explicitColor.forEach((v, id) => { partById.get(id).color = v; });

  // Notes get their anchors now that every message is known
  const total = msgs.length;
  const noteOut = notes.map(({ n, mode, at }) => {
    if (mode === 'after' && at > 0) n.after = 'm' + at;
    else if (at > 0 && (mode === 'before' || mode === 'after')) {   // before the first message = no anchor
      if (at < total) n.before = 'm' + (at + 1); else if (total) n.after = 'm' + total;
    }
    return n;
  });

  const fragOut = frames.sort((p, q) => p.order - q.order).map((f, i) => {
    const o = { id: 'f' + (i + 1), kind: f.kind, label: f.label, from: f.from, to: f.to };
    if (f.br.length) {
      if (f.kind === 'alt' && f.br.length === 1 && !f.br[0].label) o.elseAt = f.br[0].at; else o.branches = f.br;
    }
    const css = f.css && f.css.toLowerCase() !== 'transparent' ? f.css : '';
    if (f.color !== undefined) o.color = f.color; else if (css && f.kind === 'group') o.color = slotOf(css);
    if (f.collapsed !== undefined) o.collapsed = f.collapsed;
    return o;
  });

  if (Object.keys(colorKey).length) data.colorKey = colorKey;
  data.participants = parts.map((p) => {
    const o = { id: p.id, name: p.name };
    if (p.kind && p.kind !== 'system') o.kind = p.kind;
    ['color', 'start', 'end', 'column'].forEach((k) => { if (p[k] !== undefined) o[k] = p[k]; });
    return o;
  });
  data.messages = msgs.map((m, i) => Object.assign({ id: 'm' + (i + 1) }, m));
  if (fragOut.length) data.fragments = fragOut;
  if (noteOut.length) data.notes = noteOut.map((n, i) => Object.assign({ id: 'n' + (i + 1) }, n));
  // Steps named by @until, @start and @end must exist
  data.messages.forEach((m) => { if (m.until && Number(m.until.slice(1)) > total) { warn('@until ' + m.until.slice(1) + ' is past the last step (' + total + '), ignored'); delete m.until; } });
  data.participants.forEach((p) => ['start', 'end'].forEach((k) => { if (p[k] && Number(p[k].slice(1)) > total) { warn('@' + k + ' ' + p[k].slice(1) + ' is past the last step (' + total + '), ignored'); delete p[k]; } }));
  const order = ['diagramType', 'schemaVersion', 'title', 'numbered', 'showDetails', 'rails', 'lifespans', 'participantOrder', 'colorKey', 'participants', 'messages', 'fragments', 'notes'];
  const sorted = {};
  order.forEach((k) => { if (k in data) sorted[k] = data[k]; });
  return { data: sorted, infos, warnings };
}

function mmdSeqAutoColumns(ps, ms, ns) {
  if (ps.length <= 2 || ps.some((p) => p.id === undefined) || new Set(ps.map((p) => p.id)).size !== ps.length) return null;
  const mIdx = new Map();
  ms.forEach((m, i) => mIdx.set(m.id, i));
  const columns = [], hosts = [], assigned = {};
  ps.forEach((p) => {
    const pid = p.id, events = [];
    ms.forEach((m, i) => { if (m.from === pid || m.to === pid) events.push(i); });
    ns.forEach((n) => {
      const over = Array.isArray(n.over) ? n.over : n.over == null ? [] : [n.over];
      if (!over.includes(pid)) return;
      const key = n.after !== undefined && n.after !== null ? 'after' : n.before !== undefined && n.before !== null ? 'before' : null;
      const at = key ? mIdx.get(n[key]) : (ms.length ? 0 : undefined);
      if (at !== undefined) events.push(at);
    });
    if (!events.length) return;
    const lo = Math.min(...events), hi = Math.max(...events);
    const idx = columns.findIndex((col) => col.every(([olo, ohi]) => Math.max(lo, olo) > Math.min(hi, ohi)));
    if (idx >= 0) { columns[idx].push([lo, hi]); assigned[pid] = hosts[idx]; }
    else { columns.push([[lo, hi]]); hosts.push(pid); }
  });
  return Object.keys(assigned).length >= 2 ? assigned : null;
}

function toMermaid(data, opts) {
  opts = opts || {};
  const palette = Array.isArray(opts.palette) ? opts.palette : null;
  const ps = data.participants || [], ms = data.messages || [], fs = data.fragments || [], ns = data.notes || [];
  const out = [];

  // Ids: mmdSafeId, then away from the words Mermaid reads as statements
  const used = new Set(), sid = new Map();
  ps.forEach((p) => {
    if (sid.has(p.id)) return;
    let s = mmdSafeId(p.id, used);
    if (MMD_SEQ_RESERVED.includes(s.toLowerCase())) { used.delete(s); s += '_'; while (used.has(s)) s += '_'; used.add(s); }
    sid.set(p.id, s);
  });
  const pid = (id) => sid.get(id) || mmdSafeId(String(id));
  const mIdx = new Map();
  ms.forEach((m, i) => { if (!mIdx.has(m.id)) mIdx.set(m.id, i); });
  const step = (id) => (mIdx.has(id) ? mIdx.get(id) + 1 : null);
  const flag = (key, v) => (v === undefined || v === null ? null : '%% @' + key + (v ? '' : ' false'));
  const same = (v) => v !== undefined && v !== null && v !== '';

  // Frames: only those that name real messages and nest properly (the outer one wins over one that crosses it)
  const frames = fs.map((f, n) => ({ f, n, a: mIdx.get(f.from), b: mIdx.get(f.to) })).filter((r) => r.a !== undefined && r.b !== undefined && r.a <= r.b)
    .sort((p, q) => p.a - q.a || (q.b - q.a) - (p.b - p.a) || p.n - q.n);
  const open = [];
  const nested = frames.filter((r) => {
    while (open.length && open[open.length - 1].b < r.a) open.pop();
    if (open.length && r.b > open[open.length - 1].b) return false;
    open.push(r);
    return true;
  });
  nested.forEach((r) => {
    const f = r.f;
    const list = Array.isArray(f.branches) ? f.branches : f.elseAt === undefined ? [] : [{ at: f.elseAt }];
    const seen = new Set();
    r.br = f.kind === 'alt' || f.kind === 'par' ? list.map((x) => ({ e: mIdx.get(x.at), label: x.label || '' }))
      .filter((x) => x.e !== undefined && x.e > r.a && x.e <= r.b && !seen.has(x.e) && seen.add(x.e)).sort((p, q) => p.e - q.e) : [];
  });

  // Participants that Mermaid creates and destroys itself: the ones its rules allow (`create` goes before the first message
  // to the participant, `destroy` before a message of it), and at the end of the list, so declaration order is kept
  const firstUse = (id) => ms.findIndex((m) => m.from === id || m.to === id);
  const createIdx = new Map(), destroyIdx = new Map();
  const tail = [];
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i], s = same(p.start) ? mIdx.get(p.start) : undefined;
    if (s === undefined || ms[s].to !== p.id || firstUse(p.id) !== s || (tail.length && s >= tail[0].s)) break;
    tail.unshift({ p, s });
  }
  tail.forEach(({ p, s }) => createIdx.set(p.id, s));
  ps.forEach((p) => {
    const e = same(p.end) ? mIdx.get(p.end) : undefined;
    if (e !== undefined && (ms[e].from === p.id || ms[e].to === p.id) && ![...destroyIdx].some(([, v]) => v === e)) destroyIdx.set(p.id, e);
  });

  const text = (s) => mmdSeqEsc(s);
  const ind = (n) => '  '.repeat(n);
  const decl = (p, kw) => {
    const id = pid(p.id), type = MMD_SEQ_KIND_TYPE[p.kind];
    const alias = p.name === id ? '' : ' as ' + text(p.name).trimEnd();
    if (p.kind === 'actor') return (kw ? 'create ' : '') + 'actor ' + id + alias;
    return (kw ? 'create ' : '') + 'participant ' + id + (type ? '@{ "type": "' + type + '" }' : '') + alias;
  };

  if (data.title) out.push('---', 'title: ' + (/[:#"'\[\]{}&*!|>%@`,]|^[\s?-]|\s$/.test(data.title) ? JSON.stringify(String(data.title)) : data.title), '---');
  out.push('sequenceDiagram');
  const top = (s) => out.push(ind(1) + s);
  if (data.schemaVersion != null) top('%% @schemaVersion ' + data.schemaVersion);
  const ck = data.colorKey || {};
  Object.keys(ck).sort((a, b) => a - b).forEach((k) => top('%% @colorKey ' + k + ' ' + text(ck[k])));
  const stripAutoCols = data.lifespans === true && !ps.some((p) => p.start != null || p.end != null) && (() => {
    const cols = ps.filter((p) => same(p.column));
    if (cols.length < 2) return false;
    const auto = mmdSeqAutoColumns(ps, ms, ns);
    return !!auto && cols.length === Object.keys(auto).length && cols.every((p) => auto[p.id] === p.column);
  })();
  [flag('showDetails', data.showDetails), data.participantOrder ? '%% @participantOrder ' + data.participantOrder : null,
    flag('rails', data.rails), stripAutoCols ? null : flag('lifespans', data.lifespans)].forEach((s) => { if (s) top(s); });
  if (data.numbered === true) top('autonumber'); else if (data.numbered === false) top('autonumber off');

  // Participants. A run of neighbours with one colour slot that the colour key names becomes a box; any other colour is a directive.
  const slotOf = (p) => (/^[1-9]$/.test(String(p.color)) ? String(p.color) : null);
  const keyLabelOk = (s) => {
    const label = ck[s];
    if (typeof label !== 'string' || !label || label !== label.trim() || Object.keys(ck).filter((k) => ck[k] === label).length !== 1) return false;
    return mmdText(text(label)) === label && (mmdSeqCss(s, palette) || !mmdSeqSplitColour(text(label)).colour);
  };
  const boxed = (p) => !createIdx.has(p.id) && slotOf(p) && keyLabelOk(slotOf(p));
  const tops = ps.filter((p) => !createIdx.has(p.id));
  const extra = [];
  for (let i = 0; i < tops.length;) {
    const s = slotOf(tops[i]);
    if (boxed(tops[i])) {
      let j = i;
      while (j < tops.length && slotOf(tops[j]) === s) j++;
      const css = mmdSeqCss(s, palette);
      top('%% @color ' + s);
      top('box ' + (css ? css + ' ' : '') + text(ck[s]));
      for (let k = i; k < j; k++) top(ind(1) + decl(tops[k]));
      top('end');
      i = j;
    } else { top(decl(tops[i])); i++; }
  }
  ps.forEach((p) => {
    const k = p.kind;
    if (k && !['system', 'actor', 'ui', 'database', 'queue'].includes(k)) extra.push('%% @kind ' + pid(p.id) + ' ' + k);
    if (p.color != null && p.color !== '' && !boxed(p)) extra.push('%% @color ' + pid(p.id) + ' ' + p.color);
    if (!stripAutoCols && same(p.column) && sid.has(p.column)) extra.push('%% @column ' + pid(p.id) + ' ' + pid(p.column));
    if (same(p.start) && !createIdx.has(p.id) && step(p.start)) extra.push('%% @start ' + pid(p.id) + ' ' + step(p.start));
    if (same(p.end) && !destroyIdx.has(p.id) && step(p.end)) extra.push('%% @end ' + pid(p.id) + ' ' + step(p.end));
  });
  extra.forEach(top);

  // Notes by slot: before a message (free notes first) and after it
  const noteSlots = { before: new Map(), after: new Map() };
  const noteLines = ns.map((n) => {
    const over = (Array.isArray(n.over) ? n.over : n.over == null ? [] : [n.over]).slice(0, 2);
    let at = over.length ? over : null, place = null;
    if (!over.length && typeof n.place === 'number' && ps.length) {
      place = n.place;
      at = [ps[Math.round(Math.max(0, Math.min(ps.length - 1, n.place)))].id];
    }
    if (!at || at.some((id) => !sid.has(id))) return null;
    const kind = n.after != null ? 'after' : n.before != null ? 'before' : 'free';
    const k = kind === 'free' ? 0 : mIdx.get(n[kind]);
    if (k === undefined || k === null) return null;
    return { n, kind, k, place, text: 'Note over ' + at.map(pid).join(',') + ': ' + text(n.text) };
  }).filter(Boolean);
  noteLines.forEach((r) => {
    const map = r.kind === 'after' ? noteSlots.after : noteSlots.before;
    if (!map.has(r.k)) map.set(r.k, []);
    map.get(r.k).push(r);
  });

  // The body, message by message
  let depth = 0, prev = 'none';
  const line = (s) => out.push(ind(depth + 1) + s);
  const emitNote = (r) => {
    if (r.place !== null) line('%% @place ' + r.place);
    if (r.kind === 'before' && prev === 'msg') line('%% @before');
    line(r.text);
  };
  const stack = [];
  ms.forEach((m, k) => {
    // `else` / `and` of the frame that is open and innermost
    const t = stack[stack.length - 1];
    if (t) t.br.filter((x) => x.e === k).forEach((x) => { depth--; line(((t.f.kind === 'par' ? 'and ' : 'else ') + text(x.label)).trimEnd()); depth++; prev = 'else'; });
    (noteSlots.before.get(k) || []).forEach(emitNote);
    nested.filter((r) => r.a === k).forEach((r) => {
      const f = r.f, label = text(f.label || '');
      if (same(f.color) && String(f.color) !== '') line('%% @color ' + f.color);
      if (f.collapsed !== undefined) line(flag('collapsed', f.collapsed));
      if (f.kind === 'group') {
        const css = same(f.color) ? mmdSeqCss(f.color, palette) : '';
        line('rect' + (css ? ' ' + css : ''));
        // The name is the first line inside the rect: a note over every lifeline (first to last participant), read back as the name
        if (label && ps.length) out.push(ind(depth + 2) + 'Note over ' + pid(ps[0].id) + (ps.length > 1 ? ',' + pid(ps[ps.length - 1].id) : '') + ': ' + label);
      } else line((['alt', 'opt', 'loop', 'par', 'break'].includes(f.kind) ? f.kind : 'opt') + (label ? ' ' + label : ''));
      stack.push(r);
      depth++;
      prev = 'open';
    });
    if (m.activate === false) line('%% @activate false');
    if (same(m.until) && step(m.until)) line('%% @until ' + step(m.until));
    ps.forEach((p) => {
      if (createIdx.get(p.id) === k) line(decl(p, true));
      if (destroyIdx.get(p.id) === k) line('destroy ' + pid(p.id));
    });
    const label = mmdSeqEsc(m.label, '#10;'), detail = same(m.detail) ? mmdSeqEsc(m.detail, '#10;') : '';
    line(pid(m.from) + MMD_SEQ_ARROW_OF[m.kind || 'sync'] + pid(m.to) + ':' + (label || detail ? ' ' + label + (detail ? '<br>' + detail : '') : ''));
    prev = 'msg';
    (noteSlots.after.get(k) || []).forEach(emitNote);
    while (stack.length && stack[stack.length - 1].b === k) { stack.pop(); depth--; line('end'); prev = 'end'; }
  });
  if (!ms.length) (noteSlots.before.get(0) || []).forEach(emitNote);
  return out.join('\n') + '\n';
}
