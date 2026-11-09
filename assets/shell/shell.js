// --- PLUGIN INTERFACE ---
      // A diagram type registers itself once with registerDiagramPlugin({...}). The shell never touches
      // type internals; it only calls these members:
      //   id, defaultTitle, contentEl (element sized to fit/pan), report {node,label,labelText,nodeText},
      //   render(), isBackground(el), clearSelection(),
      //   cancelInteraction() -> true if something was cancelled, deleteSelection()
      // The type's engine.js must define layoutDiagram(data): lay out `data` in place, no DOM access.
      // Shared scope for plugins: chartData, scale/panX/panY, viewport, stage, updateStatus(), fitView().
      let plugin = null;
      function registerDiagramPlugin(p) { plugin = p; }

      // --- STATE ---
      let chartData = { title: "", direction: "LR", lanes: [], nodes: [], edges: [] };
      let fileHandle = null;
      let hasUnsavedChanges = false;

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

        requestAnimationFrame(() => {
          fitView();
          if (/[?&]report(=|&|$)/.test(window.location.search)) setTimeout(publishRenderReport, 200);
          if (/[?&]tidy(=|&|$)/.test(window.location.search)) publishTidyResult();
        });
      }

      function updateStatus(unsaved) {
        hasUnsavedChanges = unsaved;
        if (unsaved) {
          saveStatus.textContent = "Unsaved Changes";
          saveStatus.className = "badge badge-status unsaved";
        } else {
          saveStatus.textContent = fileHandle ? "Saved to File" : "Ready";
          saveStatus.className = "badge badge-status saved";
        }
      }

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
      function applyTheme(theme, persist) {
        document.documentElement.setAttribute('data-theme', theme);
        btnTheme.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
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
        if (minNodeFontPx !== null && minNodeFontPx < MIN_PX) legibility.push(`Node text renders at ${minNodeFontPx}px at Fit zoom (${Math.round(scale * 100)}%), below the ${MIN_PX}px minimum. Reduce columns/nodes or split the diagram.`);
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
        const availableWidth = vpRect.width - pad;
        const availableHeight = vpRect.height - pad;

        const scaleX = availableWidth / currentWidth;
        const scaleY = availableHeight / currentHeight;

        scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.0);
        const minPan = document.body.classList.contains('capture') ? 0 : 20;
        panX = Math.max(minPan, (vpRect.width - currentWidth * scale) / 2);
        panY = Math.max(minPan, (vpRect.height - currentHeight * scale) / 2);

        updateTransform();
      }

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

      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
        const dX = e.deltaX * unit, dY = e.deltaY * unit;
        const isPinch = e.ctrlKey || e.metaKey;
        const isTrackpadScroll = !isPinch && e.deltaMode === 0 && (Math.abs(dX) > 0 || !Number.isInteger(dY) || Math.abs(dY) < 50);
        if (isTrackpadScroll) {
          // Two-finger scroll pans the diagram
          panX -= dX;
          panY -= dY;
          updateTransform();
          return;
        }
        // Pinch (ctrl+wheel) and mouse wheel zoom proportionally to the gesture, anchored at the cursor
        const factor = isPinch ? Math.exp(-dY * 0.01) : Math.exp(-Math.sign(dY) * Math.min(Math.abs(dY), 100) * 0.0015);
        const newScale = Math.min(Math.max(scale * factor, 0.2), 2.5);
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

      btnHelp.addEventListener('click', () => {
        helpDrawer.classList.toggle('open');
      });

      // --- SAVE MECHANISM (Direct to HTML File) ---
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
            if (!fileHandle) {
              const suggested = (chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.html';
              fileHandle = await window.showSaveFilePicker({
                suggestedName: suggested,
                types: [{
                  description: 'HTML Diagram File',
                  accept: { 'text/html': ['.html'] }
                }]
              });
            }

            const writable = await fileHandle.createWritable();
            await writable.write(replacedHtml);
            await writable.close();

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
        } else if (e.key === 'Escape') {
          plugin.cancelInteraction();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (document.body.classList.contains('presentation')) return;
          if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT')) {
            return;
          }
          plugin.deleteSelection();
        }
      });

