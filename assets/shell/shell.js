// --- PLUGIN INTERFACE ---
      // A diagram type registers itself once with registerDiagramPlugin({...}). The shell never touches
      // type internals; it only calls these members:
      //   id, defaultTitle, contentEl (element sized to fit/pan), report {node,label,labelText,nodeText},
      //   render(), isBackground(el), clearSelection(),
      //   cancelInteraction() -> true if something was cancelled, deleteSelection()
      //   optional: onViewChange() after every pan/zoom (body.exporting is set while an export reads styles)
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

      function loadInitialData() {
        try {
          const raw = document.getElementById('diagram-data').textContent.trim();
          if (raw) {
            chartData = JSON.parse(raw);
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
          if (/[?&]report(=|&|$)/.test(window.location.search)) setTimeout(publishRenderReport, 200);
          if (/[?&]tidy(=|&|$)/.test(window.location.search)) publishTidyResult();
        });
      }

      function updateStatus(unsaved) {
        if (unsaved) recordHistory();
        setStatusBadge(unsaved);
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

      btnAutoTidy.addEventListener('click', () => {
        layoutDiagram(chartData);
        plugin.render();
        updateStatus(true);
        fitView();
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
        const effPx = (sel) => {
          const sizes = [...document.querySelectorAll(sel)].map(el => parseFloat(getComputedStyle(el).fontSize) * scale);
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
          natural: { w: plugin.contentEl.offsetWidth, h: plugin.contentEl.offsetHeight }
        };
        const el = document.createElement('script');
        el.id = 'render-report';
        el.type = 'application/json';
        el.textContent = JSON.stringify(report);
        document.body.appendChild(el);
      }

      function fitView() {
        const vpRect = viewport.getBoundingClientRect();
        const currentWidth = plugin.contentEl.offsetWidth || 1400;
        const currentHeight = plugin.contentEl.offsetHeight || 800;

        // Capture mode: scale to the exact width requested (?capture&w=1600) and pin to the top-left,
        // so the screenshot is the diagram only and does not depend on browser viewport quirks.
        if (document.body.classList.contains('capture')) {
          const reqW = parseFloat(new URLSearchParams(window.location.search).get('w'));
          if (reqW > 0) {
            scale = Math.min(1, reqW / currentWidth);
            panX = 0;
            panY = 0;
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
        panX = Math.max(minPan, (vpRect.width - currentWidth * scale) / 2);
        panY = Math.max(minPan, (vpRect.height - dockBand - currentHeight * scale) / 2);

        updateTransform();
      }

      // Middle button only pans, wherever it lands: no node drag, selection or edit sees it
      viewport.addEventListener('pointerdown', (e) => {
        if (e.button !== 1) return;
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
          isPanning = true;
          panStartX = e.clientX - panX;
          panStartY = e.clientY - panY;
          viewport.classList.add('panning');
          plugin.clearSelection();
        }
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

      function exportDiagram(format) {
        try {
          const { svg, w, h } = buildExportSvg();
          const svgText = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
          const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
          if (format === 'svg') { downloadBlob(svgBlob, 'svg'); return; }
          const k = Math.min(2, 16000 / Math.max(w, h), Math.sqrt(100e6 / (w * h)));
          const img = new Image();
          // A data: URL keeps the canvas untainted; a blob: URL of a foreignObject SVG taints it in Chromium
          const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
            const ctx = canvas.getContext('2d');
            ctx.scale(k, k);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(b => b ? downloadBlob(b, 'png') : alert('PNG export failed: image too large'), 'image/png');
          };
          img.onerror = () => alert('PNG export failed');
          img.src = url;
        } catch (err) {
          alert('Export failed: ' + err.message);
        }
      }

      function setExportOpen(open) {
        exportMenu.hidden = !open;
        btnExport.setAttribute('aria-expanded', String(open));
      }
      btnExport.addEventListener('click', (e) => { e.stopPropagation(); setExportOpen(exportMenu.hidden); });
      exportMenu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-export]');
        if (!b) return;
        setExportOpen(false);
        exportDiagram(b.dataset.export);
      });
      document.addEventListener('click', () => setExportOpen(false));
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setExportOpen(false); });

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

      async function saveToFile() {
        chartData.title = chartTitleEl.textContent.trim();
        const updatedJson = JSON.stringify(chartData, null, 2);

        let fullHtml = "";
        try {
          const res = await fetch(window.location.href);
          if (res.ok) {
            fullHtml = await res.text();
          }
        } catch (_) {}

        if (!fullHtml || !fullHtml.includes('id="diagram-data"')) {
          fullHtml = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
        }
        fullHtml = fullHtml.replace(/<script id="render-report"[\s\S]*?<\/script>/, '');

        const replacedHtml = fullHtml.replace(
          /(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/,
          `$1\n${updatedJson}\n  $2`
        );

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

