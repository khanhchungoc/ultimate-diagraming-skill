// --- GANTT CALENDAR DATE PICKER ---
// Standalone zero-dependency browser IIFE module exposing window.GanttDatePicker.
// Reuses global UTC date helpers (ganttParseDate, ganttFormatDate, ganttAddDays) from engine.js.
(function (global) {
  'use strict';

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var VIEWPORT_PAD = 8;
  var ANCHOR_GAP = 6;

  var activeState = null;
  var attachedInputs = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function getTodayLocalStr() {
    var now = new Date();
    var y = String(now.getFullYear()).padStart(4, '0');
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function normalizeDateStr(val) {
    if (!val || typeof val !== 'string') return '';
    var parsed = ganttParseDate(val);
    return parsed ? ganttFormatDate(parsed) : '';
  }

  function isWithinRange(dateStr, minStr, maxStr) {
    if (!dateStr) return false;
    if (minStr && dateStr < minStr) return false;
    if (maxStr && dateStr > maxStr) return false;
    return true;
  }

  function clampToRange(dateStr, minStr, maxStr) {
    if (minStr && dateStr < minStr) return minStr;
    if (maxStr && dateStr > maxStr) return maxStr;
    return dateStr;
  }

  function daysInMonthUTC(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function shiftMonthClamped(dateStr, deltaMonths) {
    var dt = ganttParseDate(dateStr);
    if (!dt) return dateStr;
    var y = dt.getUTCFullYear();
    var m = dt.getUTCMonth() + deltaMonths;
    var d = dt.getUTCDate();
    var targetFirst = new Date(Date.UTC(y, m, 1));
    var ty = targetFirst.getUTCFullYear();
    var tm = targetFirst.getUTCMonth();
    var maxDay = daysInMonthUTC(ty, tm);
    var clampedDay = Math.min(d, maxDay);
    return ganttFormatDate(new Date(Date.UTC(ty, tm, clampedDay)));
  }

  function restoreFocus(anchorEl) {
    if (anchorEl && typeof anchorEl.focus === 'function' && anchorEl.isConnected) {
      try {
        anchorEl.focus({ preventScroll: true });
      } catch (_err) {
        anchorEl.focus();
      }
    }
  }

  function positionPopover(pop, anchorEl) {
    var vw = global.innerWidth || document.documentElement.clientWidth || 1024;
    var vh = global.innerHeight || document.documentElement.clientHeight || 768;
    var rect = anchorEl && typeof anchorEl.getBoundingClientRect === 'function'
      ? anchorEl.getBoundingClientRect()
      : { left: VIEWPORT_PAD, right: VIEWPORT_PAD, top: VIEWPORT_PAD, bottom: VIEWPORT_PAD, width: 0, height: 0 };

    var popW = pop.offsetWidth || 268;
    var popH = pop.offsetHeight || 300;

    var spaceBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_PAD;
    var spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_PAD;
    var placeAbove = spaceBelow < popH && spaceAbove > spaceBelow;

    var top;
    if (placeAbove) {
      top = Math.max(VIEWPORT_PAD, rect.top - ANCHOR_GAP - popH);
      pop.classList.add('is-above');
    } else {
      top = Math.max(VIEWPORT_PAD, Math.min(rect.bottom + ANCHOR_GAP, vh - VIEWPORT_PAD - popH));
      pop.classList.remove('is-above');
    }

    var left = Math.max(VIEWPORT_PAD, Math.min(rect.left, vw - VIEWPORT_PAD - popW));

    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(left) + 'px';
  }

  function closeInternal(shouldRestoreFocus) {
    if (!activeState) return;
    var st = activeState;
    activeState = null;

    document.removeEventListener('keydown', st.onKeyDown, true);
    document.removeEventListener('pointerdown', st.onPointerDown, true);
    global.removeEventListener('resize', st.onReposition);
    global.removeEventListener('scroll', st.onReposition, true);

    if (st.pop && st.pop.parentNode) {
      st.pop.parentNode.removeChild(st.pop);
    }

    if (shouldRestoreFocus) {
      restoreFocus(st.anchorEl);
    }

    if (st.opts && typeof st.opts.onClose === 'function') {
      st.opts.onClose();
    }
  }

  function close() {
    closeInternal(false);
  }

  function isOpen() {
    return Boolean(activeState && activeState.pop && activeState.pop.isConnected);
  }

  function open(anchorEl, opts) {
    opts = opts || {};
    closeInternal(false);

    var todayStr = getTodayLocalStr();
    var minStr = normalizeDateStr(opts.min);
    var maxStr = normalizeDateStr(opts.max);
    if (minStr && maxStr && minStr > maxStr) {
      maxStr = '';
    }
    var selectedStr = normalizeDateStr(opts.value);

    var initialFocusStr;
    if (selectedStr) {
      initialFocusStr = selectedStr;
    } else if (isWithinRange(todayStr, minStr, maxStr)) {
      initialFocusStr = todayStr;
    } else if (minStr && todayStr < minStr) {
      initialFocusStr = minStr;
    } else if (maxStr && todayStr > maxStr) {
      initialFocusStr = maxStr;
    } else {
      initialFocusStr = todayStr;
    }

    var initDt = ganttParseDate(initialFocusStr) || ganttParseDate(todayStr);
    var viewYear = initDt.getUTCFullYear();
    var viewMonth = initDt.getUTCMonth();
    var focusedDateStr = initialFocusStr;

    var pop = document.createElement('div');
    pop.className = 'gantt-cal-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', opts.title || 'Choose date');

    // Header
    var head = document.createElement('div');
    head.className = 'gantt-cal-head';

    function makeNavBtn(label, ariaLabel, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gantt-cal-nav';
      btn.setAttribute('aria-label', ariaLabel);
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    }

    var titleEl = document.createElement('div');
    titleEl.className = 'gantt-cal-title';
    titleEl.setAttribute('aria-live', 'polite');

    var btnPrevYear = makeNavBtn('«', 'Previous year', function () {
      stepViewMonth(-12, false);
    });
    var btnPrevMonth = makeNavBtn('‹', 'Previous month', function () {
      stepViewMonth(-1, false);
    });
    var btnNextMonth = makeNavBtn('›', 'Next month', function () {
      stepViewMonth(1, false);
    });
    var btnNextYear = makeNavBtn('»', 'Next year', function () {
      stepViewMonth(12, false);
    });

    head.appendChild(btnPrevYear);
    head.appendChild(btnPrevMonth);
    head.appendChild(titleEl);
    head.appendChild(btnNextMonth);
    head.appendChild(btnNextYear);
    pop.appendChild(head);

    // Weekday headers
    var weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'gantt-cal-weekdays';
    weekdaysRow.setAttribute('aria-hidden', 'true');
    for (var w = 0; w < WEEKDAYS.length; w++) {
      var wd = document.createElement('div');
      wd.className = 'gantt-cal-weekday';
      wd.textContent = WEEKDAYS[w];
      weekdaysRow.appendChild(wd);
    }
    pop.appendChild(weekdaysRow);

    // 6x7 day grid
    var grid = document.createElement('div');
    grid.className = 'gantt-cal-grid';
    grid.setAttribute('role', 'grid');
    pop.appendChild(grid);

    // Footer
    var footer = document.createElement('div');
    footer.className = 'gantt-cal-footer';

    var btnToday = document.createElement('button');
    btnToday.type = 'button';
    btnToday.className = 'gantt-cal-today';
    btnToday.textContent = 'Today';
    if (!isWithinRange(todayStr, minStr, maxStr)) {
      btnToday.disabled = true;
    }
    btnToday.addEventListener('click', function () {
      if (!isWithinRange(todayStr, minStr, maxStr)) return;
      selectAndClose(todayStr);
    });
    footer.appendChild(btnToday);

    if (opts.allowClear) {
      var btnClear = document.createElement('button');
      btnClear.type = 'button';
      btnClear.className = 'gantt-cal-clear';
      btnClear.textContent = 'Clear';
      btnClear.addEventListener('click', function () {
        selectAndClose('');
      });
      footer.appendChild(btnClear);
    }
    pop.appendChild(footer);

    function selectAndClose(dateStr) {
      var onSelect = opts.onSelect;
      closeInternal(true);
      if (typeof onSelect === 'function') {
        onSelect(dateStr);
      }
    }

    function focusDayButton(dateStr) {
      var targetBtn = grid.querySelector('.gantt-cal-day[data-date="' + dateStr + '"]');
      if (targetBtn && !targetBtn.disabled) {
        try {
          targetBtn.focus({ preventScroll: true });
        } catch (_err) {
          targetBtn.focus();
        }
      }
    }

    function renderGrid(shouldFocus) {
      titleEl.textContent = MONTH_NAMES[viewMonth] + ' ' + viewYear;
      grid.textContent = '';

      var firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
      var firstStr = ganttFormatDate(firstOfMonth);
      var firstDow = firstOfMonth.getUTCDay();
      var gridStart = ganttAddDays(firstStr, -firstDow);

      // Ensure focusedDateStr falls inside the rendered 42-day grid when roving tabindex is applied
      var gridEnd = ganttAddDays(gridStart, 41);
      var activeTabDate = focusedDateStr;
      if (activeTabDate < gridStart || activeTabDate > gridEnd) {
        activeTabDate = clampToRange(firstStr, minStr, maxStr);
        if (activeTabDate < gridStart || activeTabDate > gridEnd) {
          activeTabDate = firstStr;
        }
      }

      var tabAssigned = false;
      var firstEnabledBtn = null;

      for (var i = 0; i < 42; i++) {
        var dateStr = ganttAddDays(gridStart, i);
        var dt = ganttParseDate(dateStr);
        var dow = dt.getUTCDay();
        var isOutside = dt.getUTCMonth() !== viewMonth;
        var isWeekend = dow === 0 || dow === 6;
        var isToday = dateStr === todayStr;
        var isSelected = Boolean(selectedStr && dateStr === selectedStr);
        var isDisabled = !isWithinRange(dateStr, minStr, maxStr);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gantt-cal-day';
        btn.setAttribute('data-date', dateStr);
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        btn.textContent = String(dt.getUTCDate());

        if (isOutside) btn.classList.add('is-outside');
        if (isWeekend) btn.classList.add('is-weekend');
        if (isToday) btn.classList.add('is-today');
        if (isSelected) btn.classList.add('is-selected');

        if (isDisabled) {
          btn.disabled = true;
          btn.classList.add('is-disabled');
          btn.setAttribute('aria-disabled', 'true');
        } else if (!firstEnabledBtn) {
          firstEnabledBtn = btn;
        }

        if (dateStr === activeTabDate && !isDisabled) {
          btn.tabIndex = 0;
          tabAssigned = true;
        } else {
          btn.tabIndex = -1;
        }

        grid.appendChild(btn);
      }

      if (!tabAssigned && firstEnabledBtn) {
        firstEnabledBtn.tabIndex = 0;
        focusedDateStr = firstEnabledBtn.getAttribute('data-date');
      }

      if (shouldFocus) {
        focusDayButton(focusedDateStr);
      }
    }

    function stepViewMonth(deltaMonths, shouldFocus) {
      var shifted = shiftMonthClamped(focusedDateStr, deltaMonths);
      var dt = ganttParseDate(shifted);
      if (!dt) return;
      viewYear = dt.getUTCFullYear();
      viewMonth = dt.getUTCMonth();
      focusedDateStr = shifted;
      renderGrid(shouldFocus);
    }

    function moveFocusTo(targetDateStr) {
      if (!targetDateStr) return;
      var clamped = clampToRange(targetDateStr, minStr, maxStr);
      var dt = ganttParseDate(clamped);
      if (!dt) return;
      focusedDateStr = clamped;
      viewYear = dt.getUTCFullYear();
      viewMonth = dt.getUTCMonth();
      renderGrid(true);
    }

    grid.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.gantt-cal-day') : null;
      if (!btn || btn.disabled) return;
      var dateStr = btn.getAttribute('data-date');
      if (!dateStr || !isWithinRange(dateStr, minStr, maxStr)) return;
      selectAndClose(dateStr);
    });

    function onKeyDown(e) {
      if (!activeState || activeState.pop !== pop) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeInternal(true);
        return;
      }

      var inGrid = e.target && grid.contains(e.target);
      if (!inGrid) return;

      var dt = ganttParseDate(focusedDateStr);
      if (!dt) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, -1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, -7));
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, 7));
          break;
        case 'PageUp':
          e.preventDefault();
          moveFocusTo(shiftMonthClamped(focusedDateStr, e.shiftKey ? -12 : -1));
          break;
        case 'PageDown':
          e.preventDefault();
          moveFocusTo(shiftMonthClamped(focusedDateStr, e.shiftKey ? 12 : 1));
          break;
        case 'Home':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, -dt.getUTCDay()));
          break;
        case 'End':
          e.preventDefault();
          moveFocusTo(ganttAddDays(focusedDateStr, 6 - dt.getUTCDay()));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (isWithinRange(focusedDateStr, minStr, maxStr)) {
            selectAndClose(focusedDateStr);
          }
          break;
        default:
          break;
      }
    }

    function onPointerDown(e) {
      if (!activeState || activeState.pop !== pop) return;
      var target = e.target;
      if (target && pop.contains(target)) return;
      if (anchorEl && target && (target === anchorEl || (anchorEl.contains && anchorEl.contains(target)))) return;
      closeInternal(false);
    }

    function onReposition() {
      if (!activeState || activeState.pop !== pop) return;
      positionPopover(pop, anchorEl);
    }

    document.body.appendChild(pop);
    renderGrid(false);
    positionPopover(pop, anchorEl);

    activeState = {
      pop: pop,
      anchorEl: anchorEl,
      opts: opts,
      onKeyDown: onKeyDown,
      onPointerDown: onPointerDown,
      onReposition: onReposition
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    global.addEventListener('resize', onReposition);
    global.addEventListener('scroll', onReposition, true);

    focusDayButton(focusedDateStr);
  }

  function resolveBound(bound) {
    if (typeof bound === 'function') return bound() || '';
    if (typeof bound === 'string') return bound;
    return '';
  }

  function attachInput(inputEl, opts) {
    if (!inputEl) return;
    opts = opts || {};

    if (attachedInputs && attachedInputs.has(inputEl)) {
      var prev = attachedInputs.get(inputEl);
      inputEl.removeEventListener('click', prev.onClick);
      inputEl.removeEventListener('keydown', prev.onKeyDown);
    }

    inputEl.type = 'text';
    inputEl.readOnly = true;
    inputEl.placeholder = 'YYYY-MM-DD';
    inputEl.classList.add('gantt-cal-input');
    inputEl.autocomplete = 'off';
    inputEl.inputMode = 'none';

    function openForInput() {
      open(inputEl, {
        value: inputEl.value,
        min: resolveBound(opts.min),
        max: resolveBound(opts.max),
        allowClear: Boolean(opts.allowClear),
        title: opts.title,
        onSelect: function (dateStr) {
          inputEl.value = dateStr;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof opts.onChange === 'function') {
            opts.onChange(dateStr);
          }
        }
      });
    }

    function onClick(e) {
      e.preventDefault();
      openForInput();
    }

    function onKeyDown(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openForInput();
      }
    }

    inputEl.addEventListener('click', onClick);
    inputEl.addEventListener('keydown', onKeyDown);

    if (attachedInputs) {
      attachedInputs.set(inputEl, { onClick: onClick, onKeyDown: onKeyDown });
    }
  }

  global.GanttDatePicker = {
    open: open,
    close: close,
    isOpen: isOpen,
    attachInput: attachInput
  };
})(window);
