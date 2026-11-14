// --- PLUGIN INTERFACE ---
      // A diagram type registers itself once with registerDiagramPlugin({...}). The shell never touches
      // type internals; it only calls these members:
      //   id, defaultTitle, contentEl (element sized to fit/pan), report {node,label,labelText,nodeText},
      //   render(), isBackground(el), clearSelection(),
      //   cancelInteraction() -> true if something was cancelled, deleteSelection(anchorEl?)
      //   optional: hasSelection() -> true when deleteSelection() would delete something (shows the dock's Delete)
      //   optional: selectInRect(clientRect, mode, start) and selectAll(): multi-select, see SELECTION BOX
      //   optional: onViewChange() after every pan/zoom (body.exporting is set while an export reads styles)
      //   optional: contentOverflow() -> {left, top, right, bottom}: unscaled px that content reaches past
      //             contentEl's edges, so Fit and screenshots frame it too
      //   optional: toDisk(data) -> a new object to write into the page's data block (the disk format: semantic
      //             fields in a fixed order, positions moved out or dropped); must not mutate data
      //   optional: fromDisk(data) -> the in-memory model read from the data block (inverse of toDisk)
      //             Missing members mean the block holds the in-memory model as is. scripts/disk_format.py
      //             does the same in Python; a generated page saved without edits must come out byte-identical.
      // Touch (see TOUCH): a plugin marks selected items with the class `selected` (and anything else a finger may
      // drag right now with the attribute data-touch-drag). A one-finger touch reaches the plugin only when it lands
      // inside such an element; any other touch pans, and a tap is replayed to the
      // item as a synthetic pointerdown + pointerup, so selecting on pointerdown keeps working.
      // Undo/redo is the shell's job: every updateStatus(true) records a snapshot of chartData, so a plugin
      // gets undo for free as long as it calls updateStatus(true) once per finished edit (not per pointermove).
      // The type's engine.js must define layoutDiagram(data): lay out `data` in place, no DOM access.
      // Shared scope for plugins: chartData, scale/panX/panY, viewport, stage, updateStatus(), fitView().
      let plugin = null;
      function registerDiagramPlugin(p) { plugin = p; }

      // --- STATE ---
      let chartData = { title: "", direction: "LR", lanes: [], nodes: [], edges: [] };
      let fileHandle = null;
      let everSaved = false;
      let hasUnsavedChanges = false;

      // Undo / redo history: JSON snapshots of chartData, taken at each committed edit
      const HISTORY_LIMIT = 100;
      let undoStack = [];
      let redoStack = [];
      let committedJson = null;   // chartData as of the last commit (the state an undo returns to)
      let savedJson = null;       // chartData as of the last load/save (decides the Unsaved badge after undo)
      let pointerHeld = false;    // no undo mid-drag: plugins hold references into chartData while dragging

      // Viewport Pan/Zoom state
      let scale = 1.0;
      let panX = 40;
      let panY = 20;
      let isPanning = false;
      let panStartX = 0;
      let panStartY = 0;


// Elements
      const viewport = document.getElementById('viewport');
      const stage = document.getElementById('stage');
      const chartTitleEl = document.getElementById('chart-title');
      const saveStatus = document.getElementById('save-status');
      const btnSave = document.getElementById('btn-save');
      const btnAutoTidy = document.getElementById('btn-auto-tidy');
      const btnZoomIn = document.getElementById('btn-zoom-in');
      const btnZoomOut = document.getElementById('btn-zoom-out');
      const btnZoomReset = document.getElementById('btn-zoom-reset');
      const zoomLevelEl = document.getElementById('zoom-level');
      const btnUndo = document.getElementById('btn-undo');
      const btnRedo = document.getElementById('btn-redo');
      const btnHelp = document.getElementById('btn-help');
      const helpDrawer = document.getElementById('help-drawer');

      let dataReadme = null;   // the data block's "_readme" line (written by scripts/layout_engine.py assemble_page)

      function loadInitialData() {
        try {
          const raw = document.getElementById('diagram-data').textContent.trim();
          if (raw) {
            const disk = JSON.parse(raw);
            // "_readme" is for readers of the file, not the model: keep it aside and write it back first on Save
            if (typeof disk._readme === 'string') dataReadme = disk._readme;
            delete disk._readme;
            chartData = plugin.fromDisk ? plugin.fromDisk(disk) : disk;
          }
        } catch (err) {
          console.error("Failed to parse diagram-data JSON:", err);
        }
        chartTitleEl.textContent = chartData.title || plugin.defaultTitle;

        chartTitleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          chartTitleEl.contentEditable = 'true';
          chartTitleEl.focus();
          const range = document.createRange();
          range.selectNodeContents(chartTitleEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        chartTitleEl.addEventListener('blur', () => {
          chartTitleEl.contentEditable = 'false';
          const val = chartTitleEl.textContent.trim();
          if (val && chartData.title !== val) {
            chartData.title = val;
            document.title = val;
            updateStatus(true);
          }
        });
        chartTitleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            chartTitleEl.blur();
          }
        });

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('present') || urlParams.has('capture')) document.body.classList.add('presentation');
        if (urlParams.has('capture')) document.body.classList.add('capture');
        initTheme();

        plugin.render();
        fitView();
        updateStatus(false);
        committedJson = savedJson = JSON.stringify(chartData);
        updateHistoryButtons();

        requestAnimationFrame(() => {
          fitView();
          // The web font (Google Fonts link in shell.html) loads asynchronously: render again once it is in, so label
          // fitting and edge-label widths are measured with the real glyphs, and only then report or tidy.
          const fontsIn = document.fonts && document.fonts.status !== 'loaded'
            ? document.fonts.ready.then(() => { plugin.render(); fitView(); })
            : Promise.resolve();
          fontsIn.then(() => {
            if (/[?&]report(=|&|$)/.test(window.location.search)) setTimeout(publishRenderReport, 200);
            if (/[?&]tidy(=|&|$)/.test(window.location.search)) publishTidyResult();
          });
        });
      }

      function updateStatus(unsaved) {
        if (unsaved) recordHistory();
        setStatusBadge(unsaved);
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }

      // Green means "this is on disk". A page nobody has saved yet is just "Ready" (neutral).
      function setStatusBadge(unsaved) {
        hasUnsavedChanges = unsaved;
        if (unsaved) {
          saveStatus.textContent = "Unsaved changes";
          saveStatus.className = "badge badge-status unsaved";
        } else if (fileHandle) {
          saveStatus.textContent = "Saved to file";
          saveStatus.className = "badge badge-status saved";
        } else if (everSaved) {
          saveStatus.textContent = "Downloaded";
          saveStatus.className = "badge badge-status saved";
        } else {
          saveStatus.textContent = "Ready";
          saveStatus.className = "badge badge-status";
        }
      }

      // --- UNDO / REDO ---
      function recordHistory() {
        if (committedJson === null) return;          // still loading
        const now = JSON.stringify(chartData);
        if (now === committedJson) return;           // nothing actually changed
        undoStack.push(committedJson);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack = [];
        committedJson = now;
        updateHistoryButtons();
      }

      function restoreSnapshot(json) {
        plugin.cancelInteraction();
        plugin.clearSelection();
        chartData = JSON.parse(json);
        committedJson = json;
        chartTitleEl.textContent = chartData.title || plugin.defaultTitle;
        document.title = chartTitleEl.textContent;
        plugin.render();
        setStatusBadge(json !== savedJson);
        updateHistoryButtons();
      }

      function undo() {
        if (!undoStack.length || pointerHeld) return;
        redoStack.push(committedJson);
        restoreSnapshot(undoStack.pop());
      }

      function redo() {
        if (!redoStack.length || pointerHeld) return;
        undoStack.push(committedJson);
        restoreSnapshot(redoStack.pop());
      }

      function updateHistoryButtons() {
        btnUndo.disabled = !undoStack.length;
        btnRedo.disabled = !redoStack.length;
      }

      btnUndo.addEventListener('click', undo);
      btnRedo.addEventListener('click', redo);
      window.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
      window.addEventListener('pointerup', () => { pointerHeld = false; }, true);
      window.addEventListener('pointercancel', () => { pointerHeld = false; }, true);

      // --- AUTO-TIDY (the type's engine does the layout) ---
      // ?tidy: run the engine on load and publish the laid-out data (used by scripts/engine_runner.py)
      function publishTidyResult() {
        layoutDiagram(chartData);
        const el = document.createElement('script');
        el.id = 'tidy-result';
        el.type = 'application/json';
        el.textContent = JSON.stringify(chartData);
        document.body.appendChild(el);
      }

      // Keep the current zoom and pan so the user stays where they were (Fit/100% is one click away).
      btnAutoTidy.addEventListener('click', () => {
        layoutDiagram(chartData);
        plugin.render();
        updateStatus(true);
      });

      // --- THEME (light / dark) ---
      // Priority: ?theme=dark|light  >  saved choice (localStorage)  >  OS preference
      const btnTheme = document.getElementById('btn-theme');
      function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      }
      // The button shows the theme you would switch TO (stroke icons, same family as the other controls)
      const ICON_SUN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
      const ICON_MOON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
      function applyTheme(theme, persist) {
        document.documentElement.setAttribute('data-theme', theme);
        btnTheme.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
        const next = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        btnTheme.title = next;
        btnTheme.setAttribute('aria-label', next);
        if (persist) { try { localStorage.setItem('flowchart-theme', theme); } catch (e) {} }
        if (plugin) plugin.render();   // type colors may depend on the theme
      }
      function initTheme() {
        let theme = null;
        const q = new URLSearchParams(window.location.search).get('theme');
        if (q === 'dark' || q === 'light') theme = q;
        if (!theme) { try { theme = localStorage.getItem('flowchart-theme'); } catch (e) {} }
        if (theme !== 'dark' && theme !== 'light') {
          theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        }
        applyTheme(theme, false);
      }
      btnTheme.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));

      // --- VIEWPORT PAN & ZOOM & FIT ---
      function updateTransform() {
        stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
        if (plugin && plugin.onViewChange) plugin.onViewChange();   // e.g. keep frozen headers pinned
      }

      // --- RENDER REPORT (only when opened with ?report; used by scripts/render_screenshot.py) ---
      function publishRenderReport() {
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const nodes = [...document.querySelectorAll(plugin.report.node)].map(el => ({ id: el.dataset.nodeId, box: box(el) }));
        const labels = [...document.querySelectorAll(plugin.report.label)]
          .map(el => ({ id: el.dataset.edgeId, text: (el.querySelector(plugin.report.labelText)?.textContent || '').trim(), box: box(el) }))
          .filter(l => l.text);
        const errors = [], warnings = [];
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            if (hit(labels[i].box, labels[j].box)) errors.push(`Edge labels overlap: "${labels[i].text}" (${labels[i].id}) and "${labels[j].text}" (${labels[j].id})`);
          }
          nodes.forEach(n => {
            if (hit(labels[i].box, n.box)) errors.push(`Edge label "${labels[i].text}" (${labels[i].id}) overlaps node ${n.id}`);
          });
        }
        if (plugin.report.nodeText) {
          document.querySelectorAll(plugin.report.nodeText).forEach(el => {
            if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
              const nid = el.closest(plugin.report.node)?.dataset.nodeId || 'node';
              warnings.push(`Node label truncated ("..."): "${el.textContent.trim()}" (${nid}) — shorten to fit 2 lines`);
            }
          });
        }
        document.querySelectorAll('.lane-title').forEach(el => {
          if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
            warnings.push(`Lane title truncated ("..."): "${el.textContent.trim()}" — shorten lane name`);
          }
        });
        const effPx = (sel) => {
          // data-base-px: the designed size of a label a plugin shrank to fit its shape (judged at that size)
          const sizes = [...document.querySelectorAll(sel)].map(el => parseFloat(el.dataset.basePx || getComputedStyle(el).fontSize) * scale);
          return sizes.length ? Math.round(Math.min(...sizes) * 10) / 10 : null;
        };
        const minNodeFontPx = effPx(plugin.report.nodeText);
        const minEdgeFontPx = effPx(plugin.report.labelText);
        const MIN_PX = parseFloat(new URLSearchParams(window.location.search).get('minpx')) || 11;
        const legibility = [];
        if (minNodeFontPx !== null && minNodeFontPx < MIN_PX) legibility.push(`Node text renders at ${minNodeFontPx}px at Fit zoom (${Math.round(scale * 100)}%), below the ${MIN_PX}px minimum.`);
        if (minEdgeFontPx !== null && minEdgeFontPx < MIN_PX) legibility.push(`Edge labels render at ${minEdgeFontPx}px at Fit zoom, below the ${MIN_PX}px minimum.`);
        const report = {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          fitScale: Math.round(scale * 100) / 100,
          nodeCount: nodes.length, labelCount: labels.length,
          minNodeFontPx, minEdgeFontPx, minTextPx: MIN_PX, errors, legibility, warnings,
          natural: (() => { const f = contentFrame(); return { w: f.w, h: f.h }; })()
        };
        const el = document.createElement('script');
        el.id = 'render-report';
        el.type = 'application/json';
        el.textContent = JSON.stringify(report);
        document.body.appendChild(el);
      }

      // What Fit and screenshots frame: contentEl, grown by whatever the plugin says reaches past its edges
      // (plugin.contentOverflow, e.g. flowchart notes in the margin). Unscaled px; x/y <= 0 is the left/top reach.
      function contentFrame() {
        const o = (plugin.contentOverflow && plugin.contentOverflow()) || {};
        const l = o.left || 0, t = o.top || 0;
        return {
          x: -l, y: -t,
          w: (plugin.contentEl.offsetWidth || 1400) + l + (o.right || 0),
          h: (plugin.contentEl.offsetHeight || 800) + t + (o.bottom || 0)
        };
      }

      function fitView() {
        const vpRect = viewport.getBoundingClientRect();
        const frame = contentFrame();
        const currentWidth = frame.w;
        const currentHeight = frame.h;

        // Capture mode: scale to the exact width requested (?capture&w=1600) and pin to the top-left,
        // so the screenshot is the diagram only and does not depend on browser viewport quirks.
        if (document.body.classList.contains('capture')) {
          const reqW = parseFloat(new URLSearchParams(window.location.search).get('w'));
          if (reqW > 0) {
            scale = Math.min(1, reqW / currentWidth);
            panX = -frame.x * scale;
            panY = -frame.y * scale;
            updateTransform();
            return;
          }
        }

        const pad = document.body.classList.contains('capture') ? 0 : 80;
        // The floating dock covers the bottom of the viewport: fit the diagram into the band above it
        // (this matters for tall diagrams, e.g. a top-to-bottom flowchart, whose fit is limited by height)
        const dock = document.querySelector('.dock-area');
        const dockRect = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect() : null;
        const dockBand = dockRect && dockRect.height ? Math.max(0, vpRect.bottom - dockRect.top) : 0;
        const availableWidth = vpRect.width - pad;
        const availableHeight = vpRect.height - dockBand - pad;

        const scaleX = availableWidth / currentWidth;
        const scaleY = availableHeight / currentHeight;

        scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.0);
        const minPan = document.body.classList.contains('capture') ? 0 : 20;
        panX = Math.max(minPan, (vpRect.width - currentWidth * scale) / 2) - frame.x * scale;
        panY = Math.max(minPan, (vpRect.height - dockBand - currentHeight * scale) / 2) - frame.y * scale;

        updateTransform();
      }

      // Middle button only pans, wherever it lands: no node drag, selection or edit sees it
      // Holding Space does the same with the primary button, and makes nodes, edges and lanes unclickable
      let spaceHeld = false;
      const typingInField = () => {
        const a = document.activeElement;
        return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      };
      const setSpaceHeld = (on) => {
        spaceHeld = on;
        document.body.classList.toggle('space-pan', on);
      };
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || typingInField()) return;
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
      }, true);
      window.addEventListener('keyup', (e) => {
        if (e.code !== 'Space') return;
        if (spaceHeld) e.preventDefault();
        setSpaceHeld(false);
      }, true);
      window.addEventListener('blur', () => setSpaceHeld(false));
      // Swallow the click that ends a Space-drag so nothing underneath activates
      viewport.addEventListener('click', (e) => {
        if (spaceHeld) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);

      viewport.addEventListener('pointerdown', (e) => {
        if (!(e.button === 1 || (e.button === 0 && spaceHeld))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        viewport.classList.add('panning');
      }, true);
      viewport.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, true);
      viewport.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }, true);

      viewport.addEventListener('pointerdown', (e) => {
        if (e.target === viewport || e.target.id === 'stage' || plugin.isBackground(e.target)) {
          if (plugin.cancelInteraction()) return;
          if (startMarquee(e)) return;   // Shift + drag draws a selection box instead of panning
          isPanning = true;
          panStartX = e.clientX - panX;
          panStartY = e.clientY - panY;
          viewport.classList.add('panning');
          plugin.clearSelection();
        }
      });

      // --- TOUCH: one finger pans, two fingers pinch-zoom ---
      // The viewport sets touch-action: none, so the browser never takes a gesture over (no page zoom, no
      // pointercancel halfway through a pan). The shell owns every touch except one that lands on an item that is
      // already selected, which goes to the plugin so it can be dragged. A finger that lands on any other item pans
      // like blank canvas, so brushing past a step while panning moves nothing; a tap (no movement) is replayed to
      // the item as a pointerdown/pointerup pair, so it selects exactly as a click does. A tap on blank canvas clears
      // the selection; a pan does not. A second finger turns the gesture into a pinch anchored at the midpoint, and
      // freezes any drag the plugin started. Moves are applied once per animation frame.
      const touches = new Map();     // pointerId -> { x, y }
      let touchGesture = null;       // { kind: 'pan', sx, sy, panX, panY, moved, bg, target, init } | { kind: 'pinch', ... }
      let replayingTap = false;
      const TAP_SLOP = 8;            // px a finger may wander and still be a tap
      let transformQueued = false;
      function scheduleTransform() {
        if (transformQueued) return;
        transformQueued = true;
        requestAnimationFrame(() => { transformQueued = false; updateTransform(); });
      }
      const isBlankCanvas = (el) => el === viewport || el.id === 'stage' || plugin.isBackground(el);
      function startPinch() {
        const [a, b] = [...touches.values()];
        touchGesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale, panX, panY };
      }
      viewport.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' || replayingTap) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (touches.size > 2) return;
          endMarquee();
          isPanning = false;
          plugin.cancelInteraction();
          viewport.classList.add('panning', 'gesturing');
          startPinch();
          return;
        }
        // The browser's touch adjustment snaps a touch's target to the nearest small interactive element (a step's
        // connect port, say), which is how a tap near a step starts an arrow. Use what is really under the finger.
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const target = hit && viewport.contains(hit) ? hit : e.target;
        const bg = isBlankCanvas(target);
        if (!bg && target.closest && target.closest('.selected, [data-touch-drag]')) {   // the plugin drags it
          touchGesture = null;
          if (target !== e.target) { e.stopImmediatePropagation(); replayPress(target, e, false); }
          return;
        }
        e.stopImmediatePropagation();
        touchGesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX, panY, moved: false, bg, target, init: e };
      }, true);
      // Hand a target a press it never saw (and, for a tap, the release): plugins select and drag on pointerdown
      function replayPress(target, init, withUp) {
        const opts = { bubbles: true, cancelable: true, composed: true, pointerId: init.pointerId, pointerType: 'touch',
          isPrimary: true, clientX: init.clientX, clientY: init.clientY, button: 0, buttons: 1,
          shiftKey: init.shiftKey, ctrlKey: init.ctrlKey, metaKey: init.metaKey, altKey: init.altKey };
        replayingTap = true;
        try {
          target.dispatchEvent(new PointerEvent('pointerdown', opts));
          if (withUp) target.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
        } finally { replayingTap = false; }
      }
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = touchGesture;
        if (!g) return;                       // a plugin drag of a selected item
        e.stopPropagation();                  // nothing else follows a finger the shell owns (or a frozen drag)
        if (g.kind === 'pinch') {
          if (touches.size < 2) return;
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ns = Math.min(Math.max(g.scale * d / g.dist, 0.2), 2.5);
          const vp = viewport.getBoundingClientRect();
          // The canvas point that was under the starting midpoint stays under the current midpoint
          panX = (mx - vp.left) - (g.mx - vp.left - g.panX) * (ns / g.scale);
          panY = (my - vp.top) - (g.my - vp.top - g.panY) * (ns / g.scale);
          scale = ns;
          scheduleTransform();
          return;
        }
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        if (!g.moved) { g.moved = true; viewport.classList.add('panning', 'gesturing'); }
        panX = g.panX + dx;
        panY = g.panY + dy;
        scheduleTransform();
      }, true);
      function endTouch(e) {
        if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
        touches.delete(e.pointerId);
        const g = touchGesture;
        if (!g) return;
        if (g.kind === 'pinch') {
          if (touches.size === 1) {           // one finger left: carry on panning with it
            const [rest] = [...touches.values()];
            touchGesture = { kind: 'pan', sx: rest.x, sy: rest.y, panX, panY, moved: true };
          } else if (touches.size === 0) {
            touchGesture = null;
            viewport.classList.remove('panning', 'gesturing');
          }
          return;
        }
        touchGesture = null;
        viewport.classList.remove('panning', 'gesturing');
        if (g.moved || e.type !== 'pointerup' || touches.size) return;
        if (g.bg) {                           // a tap on blank canvas
          if (!plugin.cancelInteraction()) plugin.clearSelection();
          return;
        }
        // A tap on an item: hand it the press it never saw, after this pointerup has finished its own dispatch
        const { target, init } = g;
        setTimeout(() => { if (target.isConnected) replayPress(target, init, true); }, 0);
      }
      window.addEventListener('pointerup', endTouch, true);
      window.addEventListener('pointercancel', endTouch, true);

      // --- SELECTION BOX (opt-in: only for a plugin that defines selectInRect / selectAll) ---
      // Shift + drag on blank canvas draws a box; Ctrl/Cmd + Shift + drag makes it a toggle box. On every move the
      // plugin's selectInRect(rect, mode, start) selects what the box touches, so the selection previews live:
      // rect is in client coordinates, mode is 'replace' or 'toggle', start is true on a box's first call. The
      // selection is not cleared when a box starts. Ctrl/Cmd + A calls selectAll(). Without these members
      // Shift + drag pans and Ctrl/Cmd + A is the browser's own. Both are off in present mode.
      let marquee = null;   // { el, x, y, mode }
      const isTyping = () => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
      function startMarquee(e) {
        if (!e.shiftKey || !plugin.selectInRect || document.body.classList.contains('presentation')) return false;
        e.preventDefault();
        if (isTyping()) document.activeElement.blur();   // commit a label being edited, as any click on the canvas does
        const el = document.createElement('div');
        el.className = 'marquee';
        document.body.appendChild(el);
        marquee = { el, x: e.clientX, y: e.clientY, mode: (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace' };
        moveMarquee(e, true);
        return true;
      }
      function moveMarquee(e, start = false) {
        const left = Math.min(marquee.x, e.clientX), top = Math.min(marquee.y, e.clientY);
        const width = Math.abs(e.clientX - marquee.x), height = Math.abs(e.clientY - marquee.y);
        Object.assign(marquee.el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
        plugin.selectInRect({ left, top, right: left + width, bottom: top + height, width, height }, marquee.mode, start);
      }
      function endMarquee() {
        if (!marquee) return;
        marquee.el.remove();
        marquee = null;
      }
      window.addEventListener('pointermove', (e) => { if (marquee) moveMarquee(e); });
      window.addEventListener('pointerup', endMarquee);
      window.addEventListener('pointercancel', endMarquee);
      window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a' || !plugin.selectAll) return;
        if (isTyping() || document.body.classList.contains('presentation')) return;
        e.preventDefault();
        plugin.selectAll();
      });

      window.addEventListener('pointermove', (e) => {
        if (!isPanning) return;
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        updateTransform();
      });

      window.addEventListener('pointerup', () => {
        isPanning = false;
        viewport.classList.remove('panning');
      });

      const WHEEL_SCROLL = 0.4;   // canvas px per px a mouse wheel notch reports (~40px per notch)
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
        const dX = e.deltaX * unit, dY = e.deltaY * unit;
        const isZoom = e.ctrlKey || e.metaKey;   // Ctrl/Cmd + wheel, and a trackpad pinch (reported as ctrl+wheel)
        if (!isZoom) {
          // The wheel scrolls the canvas: vertically, or sideways with Shift (or a trackpad's horizontal swipe)
          // A mouse wheel notch reports ~100px (or a line/page unit), which moves the canvas too far: scroll it 40%
          // of that. A trackpad sends many small deltas, which stay 1:1 so the canvas follows the fingers.
          const notch = e.deltaMode !== 0 || Math.max(Math.abs(dX), Math.abs(dY)) >= 50;
          const k = notch ? WHEEL_SCROLL : 1;
          const sideways = e.shiftKey && !dX;
          panX -= (sideways ? dY : dX) * k;
          panY -= (sideways ? 0 : dY) * k;
          updateTransform();
          return;
        }
        // Zoom anchored at the cursor. A mouse wheel notch reports ~100px, a pinch a few px per event: the step is
        // proportional to the gesture but capped at 15% per event, so one notch is one gentle step, not a jump to
        // the zoom limit
        const step = Math.sign(dY) * Math.min(Math.abs(dY) * 0.01, 0.14);
        const newScale = Math.min(Math.max(scale * Math.exp(-step), 0.2), 2.5);
        const vp = viewport.getBoundingClientRect();
        const cx = e.clientX - vp.left, cy = e.clientY - vp.top;
        panX = cx - (cx - panX) * (newScale / scale);
        panY = cy - (cy - panY) * (newScale / scale);
        scale = newScale;
        updateTransform();
      }, { passive: false });

      btnZoomIn.addEventListener('click', () => {
        scale = Math.min(scale * 1.15, 2.5);
        updateTransform();
      });
      btnZoomOut.addEventListener('click', () => {
        scale = Math.max(scale * 0.85, 0.2);
        updateTransform();
      });
      btnZoomReset.addEventListener('click', fitView);

      function setHelpOpen(open) {
        helpDrawer.classList.toggle('open', open);
        btnHelp.setAttribute('aria-expanded', String(open));
        if (open) document.getElementById('help-close').focus();
        else if (helpDrawer.contains(document.activeElement)) btnHelp.focus();
      }
      btnHelp.addEventListener('click', () => setHelpOpen(!helpDrawer.classList.contains('open')));
      document.getElementById('help-close').addEventListener('click', () => setHelpOpen(false));

      // --- EXPORT (SVG / PNG) ---
      // The stage is HTML plus SVG, so the export inlines every computed style into a clone and wraps it in a
      // foreignObject. The result is a self-contained SVG, and the PNG is that SVG rasterised.
      const btnExport = document.getElementById('btn-export');
      const exportMenu = document.getElementById('export-menu');
      const TRANSIENT_CLASSES = ['selected', 'hover', 'linked', 'hl-in', 'hl-out', 'multi-selected', 'dragging', 'lane-hover'];
      const SKIP_SELECTOR = '#drag-edge, .snap-guide, #lane-drop-line, #seq-drop-line, [data-export-skip]';
      const EXPORT_SVG_NS = 'http://www.w3.org/2000/svg';
      let defaultStyleCache = null;

      function defaultStyleFor(el) {
        if (!defaultStyleCache) {
          const frame = document.createElement('iframe');
          frame.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px;visibility:hidden';
          document.body.appendChild(frame);
          defaultStyleCache = { frame, doc: frame.contentDocument, map: {} };
          defaultStyleCache.doc.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        }
        const c = defaultStyleCache, key = el.namespaceURI + '|' + el.localName;
        if (!c.map[key]) {
          const probe = c.doc.createElementNS(el.namespaceURI, el.localName);
          (el.namespaceURI === EXPORT_SVG_NS ? c.doc.body.firstChild : c.doc.body).appendChild(probe);
          const cs = c.frame.contentWindow.getComputedStyle(probe), o = {};
          for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
          c.map[key] = o;
        }
        return c.map[key];
      }

      function inlineStyles(src, dst) {
        const cs = getComputedStyle(src), def = defaultStyleFor(src);
        let css = '';
        for (let i = 0; i < cs.length; i++) {
          const prop = cs[i], v = cs.getPropertyValue(prop);
          if (def[prop] !== v) css += prop + ':' + v + ';';
        }
        css = css.replace(/url\("?#arrowhead-(selected|in|out)"?\)/g, 'url("#arrowhead")');
        dst.setAttribute('style', css);
        dst.removeAttribute('class');
        const sk = Array.from(src.children), dk = Array.from(dst.children);
        for (let i = 0; i < sk.length; i++) {
          if (sk[i].matches(SKIP_SELECTOR) || (sk[i].namespaceURI !== EXPORT_SVG_NS && getComputedStyle(sk[i]).display === 'none')) { dk[i].remove(); continue; }
          inlineStyles(sk[i], dk[i]);
        }
      }

      function buildExportSvg() {
        const root = stage.firstElementChild;
        if (!root) throw new Error('Nothing to export');
        // Freeze transitions and drop selection/hover state while computed styles are read
        const frozen = document.createElement('style');
        frozen.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.appendChild(frozen);
        document.body.classList.add('exporting');   // view-dependent styles (frozen headers) reset for the export
        const touched = [];
        TRANSIENT_CLASSES.forEach(cls => stage.querySelectorAll('.' + cls).forEach(el => { el.classList.remove(cls); touched.push([el, cls]); }));
        try {
          const rr = root.getBoundingClientRect(), pad = 24;
          let minX = 0, minY = 0, maxX = rr.width / scale, maxY = rr.height / scale;
          root.querySelectorAll('*').forEach(el => {
            if (el.matches(SKIP_SELECTOR) || el.closest('defs')) return;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) return;
            minX = Math.min(minX, (r.left - rr.left) / scale); minY = Math.min(minY, (r.top - rr.top) / scale);
            maxX = Math.max(maxX, (r.right - rr.left) / scale); maxY = Math.max(maxY, (r.bottom - rr.top) / scale);
          });
          const w = Math.ceil(maxX - minX + pad * 2), h = Math.ceil(maxY - minY + pad * 2);
          const clone = root.cloneNode(true);
          inlineStyles(root, clone);
          clone.style.transform = 'none';
          clone.style.position = 'absolute';
          clone.style.left = (pad - minX) + 'px';
          clone.style.top = (pad - minY) + 'px';
          const wrap = document.createElement('div');
          wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
          wrap.setAttribute('style', 'position:relative;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + getComputedStyle(viewport).backgroundColor);
          wrap.appendChild(clone);
          const xml = new XMLSerializer().serializeToString(wrap);
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + xml + '</foreignObject></svg>';
          return { svg, w, h };
        } finally {
          touched.forEach(([el, cls]) => el.classList.add(cls));
          frozen.remove();
          document.body.classList.remove('exporting');
        }
      }

      function downloadBlob(blob, ext) {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url;
        a.download = ((chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram') + '.' + ext;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      function svgDocument(svg) { return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg; }

      // Rasterise the export SVG at up to 1.5x. The SVG is built synchronously (styles are read now);
      // only the image decode and canvas encode are async. Rejects if the image cannot be produced.
      function exportPngBlob() {
        const { svg, w, h } = buildExportSvg();
        const k = Math.min(1.5, 16000 / Math.max(w, h), Math.sqrt(100e6 / (w * h)));
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
            const ctx = canvas.getContext('2d');
            ctx.scale(k, k);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('image too large')), 'image/png');
          };
          img.onerror = () => reject(new Error('the diagram could not be drawn as an image'));
          // A data: URL keeps the canvas untainted; a blob: URL of a foreignObject SVG taints it in Chromium
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgDocument(svg));
        });
      }

      function exportDiagram(format) {
        try {
          if (format === 'svg') {
            downloadBlob(new Blob([svgDocument(buildExportSvg().svg)], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
            return;
          }
          exportPngBlob().then(b => downloadBlob(b, 'png'), err => alert('PNG export failed: ' + err.message));
        } catch (err) {
          alert('Export failed: ' + err.message);
        }
      }

      // --- COPY TO CLIPBOARD ---
      const canCopyPng = !!(navigator.clipboard && navigator.clipboard.write) && typeof ClipboardItem !== 'undefined';
      let copyFlashTimer = null;

      function flashCopied(what) {
        saveStatus.textContent = 'Copied as ' + what;
        saveStatus.className = 'badge badge-status saved';
        clearTimeout(copyFlashTimer);
        copyFlashTimer = setTimeout(() => setStatusBadge(hasUnsavedChanges), 1500);
      }

      // Must be called straight from the click: the clipboard write has to start inside the user gesture,
      // so the PNG is handed to ClipboardItem as a Promise rather than awaited first (Safari, Chromium).
      function copyDiagram(format) {
        let job;
        try {
          if (!navigator.clipboard) throw new Error('the clipboard is not available in this browser');
          if (format === 'svg') {
            job = navigator.clipboard.writeText(svgDocument(buildExportSvg().svg));
          } else if (format === 'png') {
            if (!canCopyPng) throw new Error('this browser cannot copy images');
            job = navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPngBlob() })]);
          } else {
            throw new Error('unknown format ' + format);
          }
        } catch (err) {
          job = Promise.reject(err);
        }
        job.then(() => flashCopied(format.toUpperCase()),
                 err => alert('Copy failed: ' + (err && err.message || err) + '\nUse Export › Download instead.'));
      }
      document.querySelectorAll('[data-copy="png"]').forEach(el => { el.hidden = !canCopyPng; });
      document.querySelectorAll('[data-copy="svg"]').forEach(el => { el.hidden = !(navigator.clipboard && navigator.clipboard.writeText); });
      // Drop the "Copy" heading when this browser has no copy items to offer
      document.querySelectorAll('[data-copy-label]').forEach(el => { el.hidden = !document.querySelector('[data-copy]:not([hidden])'); });

      function setExportOpen(open) {
        exportMenu.hidden = !open;
        btnExport.setAttribute('aria-expanded', String(open));
      }
      btnExport.addEventListener('click', (e) => { e.stopPropagation(); setExportOpen(exportMenu.hidden); });
      exportMenu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-export], [data-copy]');
        if (!b) return;
        setExportOpen(false);
        if (b.dataset.copy) copyDiagram(b.dataset.copy);
        else exportDiagram(b.dataset.export);
      });
      document.addEventListener('click', () => setExportOpen(false));
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setExportOpen(false); });

      // --- DOCK: layout group, popovers, delete ---
      // Two groups split by a separator: editing controls (type buttons, Delete) | layout controls
      // (type buttons marked data-dock-group="layout", then Tidy).
      document.querySelectorAll('.toolbar-center [data-dock-group="layout"]').forEach(el => btnAutoTidy.before(el));

      // A [data-dock-pop] wrapper opens its .dock-pop bubble on hover (mouse/pen), or on click/tap/keyboard.
      // Its items can be anything; the grid width follows the item count (max 6 columns, then more rows). The bubble
      // may hold one .dock-pop-grid, or several in labelled .dock-pop-section blocks: every grid then takes the
      // column count of the largest, so the sections line up.
      const DOCK_POP_MAX_COLS = 6;
      document.querySelectorAll('[data-dock-pop]').forEach(wrap => {
        const trigger = wrap.querySelector('.dock-pop-trigger');
        const pop = wrap.querySelector('.dock-pop');
        if (!trigger || !pop) return;
        const items = [...pop.querySelectorAll('.dock-pop-grid > *')];
        const grids = [...pop.querySelectorAll('.dock-pop-grid')];
        const largest = Math.max(1, ...grids.map(g => g.children.length));
        const cols = Math.max(1, Math.min(largest, DOCK_POP_MAX_COLS));
        pop.style.setProperty('--pop-cols', cols);
        // Scroll only past 5 rows (60px tiles + 6px gaps ~ the grid's max height)
        grids.forEach(grid => grid.classList.toggle('scrolls', Math.ceil(grid.children.length / cols) > 5));
        items.forEach((el, i) => el.style.setProperty('--i', i));
        let closeTimer = null;
        const isOpen = () => wrap.classList.contains('open');
        // Keep the bubble inside the window: shift it sideways, the tail keeps pointing at the trigger
        function clampToWindow() {
          const t = trigger.getBoundingClientRect(), w = pop.offsetWidth, m = 8;
          const left = t.left + t.width / 2 - w / 2;
          const shift = Math.max(m - left, 0) + Math.min(innerWidth - m - (left + w), 0);
          pop.style.setProperty('--pop-shift', `${Math.round(shift)}px`);
        }
        function setOpen(open) {
          clearTimeout(closeTimer);
          if (open === isOpen()) return;
          if (open) clampToWindow();
          wrap.classList.toggle('open', open);
          trigger.setAttribute('aria-expanded', String(open));
        }
        const closeSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => setOpen(false), 160); };
        wrap.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'touch' || document.body.classList.contains('palette-dragging')) return;
          setOpen(true);
        });
        wrap.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') closeSoon(); });
        // How a click was made: '' for keyboard (detail 0), else the pointer type of the press that caused it
        let lastPointerType = '';
        wrap.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType; });
        const clickKind = (e) => (e.detail === 0 ? '' : (e.pointerType || lastPointerType));
        const isHoverPointer = (k) => k === 'mouse' || k === 'pen';
        // Mouse clicks keep it open (hover already opened it); taps and Enter/Space toggle it
        trigger.addEventListener('click', (e) => setOpen(isHoverPointer(clickKind(e)) ? true : !isOpen()));
        // A mouse user may add several shapes in a row; tap and keyboard picks close the bubble
        pop.addEventListener('click', (e) => {
          const kind = clickKind(e);
          if (!e.target.closest('.dock-pop-grid > *') || isHoverPointer(kind)) return;
          setOpen(false);
          if (!kind) trigger.focus();
        });
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); setOpen(false); trigger.focus(); }
        });
        wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) closeSoon(); });
        document.addEventListener('pointerdown', (e) => { if (isOpen() && !wrap.contains(e.target)) setOpen(false); }, true);
        window.addEventListener('resize', () => { if (isOpen()) clampToWindow(); });
      });

      // Delete: visible only while the plugin reports a deletable selection. Selection lives in the plugin, so
      // re-check after every input event (cheap) and every committed edit (undo/redo, add, delete).
      const btnDelete = document.getElementById('btn-delete-selection');
      let deleteCheckQueued = false;
      function refreshDeleteButton() {
        deleteCheckQueued = false;
        if (!btnDelete || !plugin) return;
        const on = !document.body.classList.contains('presentation') && !!(plugin.hasSelection && plugin.hasSelection());
        if (on === btnDelete.classList.contains('show')) return;
        btnDelete.classList.toggle('show', on);
        btnDelete.setAttribute('aria-hidden', String(!on));
        btnDelete.tabIndex = on ? 0 : -1;
      }
      function queueDeleteRefresh() {
        if (deleteCheckQueued) return;
        deleteCheckQueued = true;
        requestAnimationFrame(refreshDeleteButton);
      }
      ['pointerup', 'click', 'keyup'].forEach(type => window.addEventListener(type, queueDeleteRefresh));
      if (btnDelete) btnDelete.addEventListener('click', () => {
        if (!btnDelete.classList.contains('show')) return;
        plugin.deleteSelection(btnDelete);
        queueDeleteRefresh();
      });

      // --- SAVE MECHANISM (Direct to HTML File) ---
      // Remember the file handle per page URL (IndexedDB) so a reopened diagram
      // can save straight back to its file without showing the folder dialog.
      function handleDb() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('ultimate-diagram', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('handles');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      async function loadStoredHandle() {
        try {
          const db = await handleDb();
          const h = await new Promise((resolve, reject) => {
            const r = db.transaction('handles').objectStore('handles').get(location.href);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
          if (!h) return null;
          const opts = { mode: 'readwrite' };
          if ((await h.queryPermission(opts)) === 'granted') return h;
          if ((await h.requestPermission(opts)) === 'granted') return h;
        } catch (_) {}
        return null;
      }
      async function storeHandle(h) {
        try {
          const db = await handleDb();
          db.transaction('handles', 'readwrite').objectStore('handles').put(h, location.href);
        } catch (_) {}
      }

      // JSON with one line per flat object (a lane, a node, an edge, a layout entry), so the data block reads as a
      // list. A container is flat when its values are scalars or arrays of scalars; the top level always expands.
      // scripts/disk_format.py format_json() writes the same text.
      function formatJson(v, indent = '') {
        const scalar = (x) => x === null || typeof x !== 'object';
        if (scalar(v)) return JSON.stringify(v);
        const isObj = !Array.isArray(v);
        const items = isObj ? Object.entries(v).filter(([, x]) => x !== undefined) : v.map(x => [null, x]);
        if (!items.length) return isObj ? '{}' : '[]';
        const key = (k) => (k === null ? '' : JSON.stringify(k) + ': ');
        const flat = items.every(([, x]) => scalar(x) || (Array.isArray(x) && x.every(scalar)));
        if (indent && flat) {
          const inline = (x) => (scalar(x) ? JSON.stringify(x) : `[${x.map(y => JSON.stringify(y)).join(', ')}]`);
          const body = items.map(([k, x]) => key(k) + inline(x)).join(', ');
          return isObj ? `{ ${body} }` : `[${body}]`;
        }
        const inner = indent + '  ';
        const body = items.map(([k, x]) => inner + key(k) + formatJson(x, inner)).join(',\n');
        return (isObj ? '{' : '[') + '\n' + body + '\n' + indent + (isObj ? '}' : ']');
      }

      // Text for HTML element content (same escaping as Python's html.escape(s, quote=False))
      function escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      // The reading guide on line 2 names the data block's line range ("on lines S-E of this file", "Read lines
      // 1-E", "limit E", "after line E"); recompute it from the text being saved. Only the guide line is
      // rewritten, so this code's own text is never touched. Mirrors stamp_reading_guide() in disk_format.py.
      function stampReadingGuide(html) {
        const g = html.indexOf('<!-- For agents:');
        const o = html.indexOf('<script id="diagram-data" type="application\/json">');
        const e = html.indexOf('<!-- end diagram-' + 'data -->');
        if (g < 0 || o < 0 || e < 0) return html;
        let gEnd = html.indexOf('\n', g);
        if (gEnd < 0) gEnd = html.length;
        const lineOf = (i) => html.slice(0, i).split('\n').length;
        const start = lineOf(o), end = lineOf(e);
        const line = html.slice(g, gEnd)
          .replace(/on lines \d+-\d+ of this file/, `on lines ${start}-${end} of this file`)
          .replace(/(Read lines 1-|limit |after line )\d+/g, (_, p) => p + end);
        return html.slice(0, g) + line + html.slice(gEnd);
      }

      async function saveToFile() {
        chartData.title = chartTitleEl.textContent.trim();
        const disk = plugin.toDisk ? plugin.toDisk(chartData) : { ...chartData };
        delete disk._readme;
        const updatedJson = formatJson(dataReadme === null ? disk : { _readme: dataReadme, ...disk });

        let fullHtml = "";
        try {
          const res = await fetch(window.location.href);
          if (res.ok) {
            fullHtml = await res.text();
          }
        } catch (_) {}

        if (!fullHtml || !fullHtml.includes('id="diagram-data"')) {
          // Rebuild from the live document, keeping the top-level comments (the reading guide on line 2)
          fullHtml = [...document.childNodes].map(n => n.nodeType === Node.DOCUMENT_TYPE_NODE ? '<!DOCTYPE html>'
            : n.nodeType === Node.COMMENT_NODE ? `<!--${n.data}-->` : (n.outerHTML || '')).join('\n');
        }
        // Both patterns spell the full tag with type="application\/json": this file's own source contains
        // these regexes, and with the escaped slash they cannot match their own text. A shorter pattern such
        // as <script id="render-report"[\s\S]*?<\/script> matches this code itself and deletes the rest of
        // the page's main script, so the saved file opens with nothing working.
        fullHtml = fullHtml.replace(/<script id="render-report" type="application\/json">[\s\S]*?<\/script>/, '');

        // A replacement function, not a string: labels may contain $&, $' or $` that a string would expand
        // The page title (<title> and the header's <h1>) follows the diagram title. Both come before the main
        // script, so the first match is the real element; closing tags are spelled <\/...> like the patterns above.
        const pageTitle = escapeHtml(chartData.title || plugin.defaultTitle);
        const replacedHtml = stampReadingGuide(fullHtml
          .replace(
            /(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/,
            (_, open, close) => `${open}\n${updatedJson}\n  ${close}`
          )
          .replace(/(<title>)[\s\S]*?(<\/title>)/, (_, open, close) => `${open}${pageTitle}${close}`)
          .replace(/(<h1 id="chart-title"[^>]*>)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${pageTitle}${close}`));

        document.getElementById('diagram-data').textContent = `\n${updatedJson}\n  `;

        if ('showSaveFilePicker' in window) {
          try {
            if (!fileHandle) fileHandle = await loadStoredHandle();
            if (!fileHandle) {
              // Browsers cannot read a page's own folder, so reuse the current file name
              // (saving over it) and a stable picker id so the dialog reopens in the
              // last folder used for diagrams.
              let currentName = '';
              try {
                currentName = decodeURIComponent(location.pathname.split('/').pop() || '');
              } catch (_) {}
              const suggested = /\.html?$/i.test(currentName)
                ? currentName
                : (chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.html';
              fileHandle = await window.showSaveFilePicker({
                id: 'ultimate-diagram-save',
                suggestedName: suggested,
                types: [{
                  description: 'HTML Diagram File',
                  accept: { 'text/html': ['.html'] }
                }]
              });
              storeHandle(fileHandle);
            }

            const writable = await fileHandle.createWritable();
            await writable.write(replacedHtml);
            await writable.close();

            savedJson = JSON.stringify(chartData);
            everSaved = true;
            updateStatus(false);
            return;
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }

        try {
          const blob = new Blob([replacedHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          savedJson = JSON.stringify(chartData);
          everSaved = true;
          updateStatus(false);
        } catch (err) {
          alert("Save failed: " + err.message);
        }
      }

      btnSave.addEventListener('click', saveToFile);

      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          saveToFile();
        } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
          // Leave text editing (title, labels) to the browser's own undo
          if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT')) return;
          if (document.body.classList.contains('presentation')) return;
          e.preventDefault();
          if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
        } else if (e.key === 'Escape') {
          if (helpDrawer.classList.contains('open')) { setHelpOpen(false); return; }
          plugin.cancelInteraction();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (document.body.classList.contains('presentation')) return;
          if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT')) {
            return;
          }
          plugin.deleteSelection();
        }
      });

