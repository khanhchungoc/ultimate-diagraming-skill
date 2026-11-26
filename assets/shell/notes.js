      // --- SHARED NOTES CONTROLLER ---
      // One notes controller every diagram type plugs into (flowchart, usecase, erd, c4, gantt). It owns the typing
      // state, text cleanup, empty-note removal, the fold-into-badge on removal and the click-away-to-finish rule.
      // The type keeps its own cards, layout, selection and visibility, and passes small hooks:
      //
      //   createNotes({
      //     data()            -> the chart data object (notes live in data().notes)
      //     cardOf(id)        -> the note's card element, or null
      //     anchorEl(note)    -> element the card folds into on removal (null folds into nothing).
      //                          Omit it when the type animates removal itself (c4 re-renders with a FLIP).
      //     canEdit()         -> optional; false blocks editing (presentation mode)
      //     openCard(note)    -> select the note, make sure its card exists, return the card (or null: edit is dropped)
      //     afterFocus(card)  -> optional; after the caret is placed (pan the card into view)
      //     beforeRemove(note)-> optional; capture anything the re-render needs; the result arrives as ctx.token
      //     clearSelection(id)-> drop the note from the type's selection if it is selected
      //     render(ctx)       -> re-render. ctx = { note, token, reason: 'text' | 'remove' | 'cleared' | 'same' }
      //                          ('cleared' = an emptied note removed on commit; 'same' = typing ended unchanged)
      //     onChange()        -> mark the diagram as edited (undo step, unsaved state)
      //     restoreSwitch     -> optional; a note given up right after being added puts the Notes switch back
      //   })
      //
      //   controller: begin(note, isNew), edit(id), commit(note, textEl), remove(id, record = true),
      //               editingId(), isEditing(id), list(), byId(id)
      function createNotes(opts) {
        let editing = null;   // the note being typed
        let draft = null;     // { id, isNew, wasOn, before }
        const list = () => { const n = opts.data().notes; return Array.isArray(n) ? n : []; };
        const byId = (id) => list().find((n) => n && n.id === id) || null;
        const textOf = (n) => (n && typeof n.text === 'string' ? n.text.trim() : '');
        const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

        // Call after pushing a new note and before the first render: it counts as live while typed into
        function begin(note, isNew) {
          draft = { id: note.id, isNew: !!isNew, wasOn: opts.data().showNotes === true, before: isNew ? '' : textOf(note) };
          editing = note.id;
        }

        function edit(id) {
          const note = byId(id);
          if (!note || (opts.canEdit && !opts.canEdit())) return;
          const prev = { editing, draft };
          if (editing !== id || !draft) begin(note, false);
          const card = opts.openCard(note);
          const text = card && card.querySelector('.note-text');
          if (!text) { if (!card) ({ editing, draft } = prev); return; }
          text.contentEditable = 'true';
          text.focus();
          const range = document.createRange();
          range.selectNodeContents(text);
          range.collapse(false);   // caret at the end: adding to a note is more common than replacing it
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (opts.afterFocus) opts.afterFocus(card);
        }

        function remove(id, record = true, reason = 'remove') {
          const note = byId(id);
          if (!note) return;
          const card = opts.cardOf(id);
          if (opts.anchorEl && card) motion.foldNote(card, opts.anchorEl(note));   // morph into the badge, never fade
          const token = opts.beforeRemove ? opts.beforeRemove(note) : undefined;
          const data = opts.data();
          data.notes = list().filter((n) => n && n.id !== id);
          if (!data.notes.length) delete data.notes;
          if (editing === id) { editing = null; draft = null; }
          opts.clearSelection(id);
          opts.render({ note, token, reason });
          if (record) opts.onChange();
        }

        function commit(note, textEl) {
          textEl.contentEditable = 'false';
          if (editing !== note.id) return;
          const d = draft;
          editing = null; draft = null;
          const value = clean(textEl.innerText);
          if (!value) {
            if (opts.restoreSwitch && d && d.isNew && !d.wasOn) delete opts.data().showNotes;   // a note given up leaves the switch as it was
            remove(note.id, !(d && d.isNew), 'cleared');
            return;
          }
          if (d && value === d.before) { textEl.textContent = note.text; opts.render({ note, reason: 'same' }); return; }
          note.text = value;
          textEl.textContent = value;
          opts.render({ note, reason: 'text' });
          opts.onChange();
        }

        // A press anywhere else ends the typing (a node press calls preventDefault, which would keep the focus in the note)
        window.addEventListener('pointerdown', (e) => {
          if (!editing) return;
          const card = opts.cardOf(editing);
          if (card && card.contains(e.target)) return;
          const text = card && card.querySelector('.note-text'), note = byId(editing);
          if (text && note) { text.blur(); commit(note, text); }   // no-op if the blur already committed it
        }, true);

        return { begin, edit, commit, remove, list, byId, editingId: () => editing, isEditing: (id) => editing === id };
      }
