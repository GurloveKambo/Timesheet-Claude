/* =====================================================
   FIELDSHEET PWA — APP.JS v2
   
   Features:
   - Settings page (name, email, EmailJS keys)
   - Auto-fill employee name from settings
   - Monday-only fortnight start dates
   - Auto-advance to next fortnight after submission
   - Reminder notifications
   - Day type: Work / Annual Leave / Sick / PH / RDO / Other
   - Copy hours + job to all weekdays
   - EmailJS auto-send with PDF attachment
   - Receipt image compression before storage
   - Local save/restore (localStorage)
   ===================================================== */

'use strict';

/* ─────────────────────────────────────────
   APP STATE
   All data lives here while the user works.
   Saved to localStorage on demand.
───────────────────────────────────────── */
let state = {
  employee: {
    name: '',
    fortnightFrom: '',   // ISO date string: "2025-09-01"
    fortnightTo:   '',   // Always 13 days after From
    jobRefType:    'client',
    jobClient:     '',
    jobAddress:    ''
  },
  dailyHours: [],     // [{ date, day, hours, type, jobNote }]
  expenses:   [],     // [{ id, type, amount, date, desc, receiptName, receiptData, receiptType }]
  mileage:    [],     // [{ id, date, from, to, km, rate, total }]
  allowances: []      // [{ id, type, amount, notes }]
};

/* Settings stored separately from submission data */
let settings = {
  name:          '',
  emailTo:       '',
  emailCc:       '',
  ejsPublicKey:  '',
  ejsServiceId:  '',
  ejsTemplateId: '',
  reminders:     true,
  lastSubmittedFortnightEnd: ''  // Used to calculate next fortnight
};

/* ─────────────────────────────────────────
   SERVICE WORKER
───────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => {
      reg.update();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('update-banner').classList.remove('hidden');
          }
        });
      });
    })
    .catch(e => console.warn('SW error:', e));
}

function applyUpdate() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
  }
  window.location.reload();
}

/* ─────────────────────────────────────────
   TAB / STEP NAVIGATION
───────────────────────────────────────── */
function switchTab(btn) {
  const targetId = btn.getAttribute('data-tab');

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(targetId).classList.add('active');
  btn.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function gotoStep(tabId) {
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (btn) switchTab(btn);
}

/* ─────────────────────────────────────────
   FORTNIGHT DATE LOGIC
   Fortnights always start on Monday.
   End date = start + 13 days (Sunday).
───────────────────────────────────────── */

/**
 * When user picks a date, snap it to the nearest Monday.
 * This prevents invalid fortnight starts.
 */
function onFortnightStartChange(input) {
  if (!input.value) return;

  const d = new Date(input.value + 'T00:00:00'); // Local time
  const dow = d.getDay(); // 0=Sun, 1=Mon … 6=Sat

  if (dow !== 1) {
    // Not a Monday — find the nearest Monday
    const diff = dow === 0 ? -6 : 1 - dow; // Sunday goes back 6, others go back to Monday
    d.setDate(d.getDate() + diff);
    input.value = toISODate(d);
    showToast('📅 Snapped to Monday ' + formatDate(input.value), 'success');
  }

  const endDate = new Date(d);
  endDate.setDate(d.getDate() + 13); // +13 = 14 days total (Mon–Sun)

  state.employee.fortnightFrom = input.value;
  state.employee.fortnightTo   = toISODate(endDate);

  // Show the auto-calculated end date
  document.getElementById('fortnight-to-display').textContent =
    formatDate(state.employee.fortnightTo) + ' (Sunday)';

  // Update header badge
  updateHeaderStatus();

  // Rebuild the daily table
  buildDailyTable();
}

/** Returns next fortnight's Monday (14 days after the last end Sunday) */
function getNextFortnightStart(lastEndDate) {
  const d = new Date(lastEndDate + 'T00:00:00');
  d.setDate(d.getDate() + 1); // Monday after last Sunday
  return toISODate(d);
}

/** Converts a Date object to "YYYY-MM-DD" string */
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─────────────────────────────────────────
   JOB REF TYPE TOGGLE
───────────────────────────────────────── */
function setJobRefType(type) {
  state.employee.jobRefType = type;

  document.querySelectorAll('#job-ref-toggle .toggle-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === type);
  });

  document.getElementById('job-client').classList.toggle('hidden', type !== 'client');
  document.getElementById('job-address').classList.toggle('hidden', type !== 'address');
}

/* ─────────────────────────────────────────
   BUILD DAILY TABLE
   Creates one row per day in the fortnight.
───────────────────────────────────────── */
function buildDailyTable() {
  const from = state.employee.fortnightFrom;
  const to   = state.employee.fortnightTo;
  if (!from || !to) return;

  const startDate = new Date(from + 'T00:00:00');
  const endDate   = new Date(to   + 'T00:00:00');
  const dayNames  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const container = document.getElementById('daily-rows-container');
  container.innerHTML = '';

  // Build 14 rows (Mon to Sun × 2)
  const current = new Date(startDate);
  while (current <= endDate) {
    const isoDate  = toISODate(current);
    const dayName  = dayNames[current.getDay()];
    const isWeekend = current.getDay() === 0 || current.getDay() === 6;

    // Try to restore saved data for this row
    const saved = state.dailyHours.find(d => d.date === isoDate) || {};

    const row = document.createElement('div');
    row.className = 'daily-row' + (isWeekend ? ' weekend' : '');
    row.id = 'row-' + isoDate;

    row.innerHTML = `
      <div class="daily-row-header">
        <span class="day-name">${dayName}</span>
        <span class="day-date">${formatDate(isoDate)}</span>
        <div class="day-type-selector" id="type-sel-${isoDate}">
          ${buildTypePills(isoDate, saved.type || (isWeekend ? 'rdo' : 'work'))}
        </div>
      </div>
      <div class="daily-row-body">
        <div class="hours-field-wrap">
          <label>Hours</label>
          <input
            type="number"
            class="hours-input"
            id="hours-${isoDate}"
            data-date="${isoDate}"
            placeholder="0"
            min="0" max="24" step="0.5"
            value="${saved.hours || ''}"
            oninput="onHoursChange('${isoDate}')"
          />
        </div>
        <div class="job-field-wrap">
          <label>Job / Notes</label>
          <input
            type="text"
            class="job-field-input"
            id="job-${isoDate}"
            data-date="${isoDate}"
            placeholder="Job ref or site note (optional)"
            value="${escHtml(saved.jobNote || '')}"
          />
        </div>
      </div>
    `;

    container.appendChild(row);
    current.setDate(current.getDate() + 1);
  }

  document.getElementById('daily-table-card').style.display = 'block';
  updateHoursSummary();
}

/** Build the day-type pill buttons for one row */
function buildTypePills(isoDate, activeType) {
  const types = [
    { val: 'work',   label: 'Work'   },
    { val: 'annual', label: 'AL'     },
    { val: 'sick',   label: 'Sick'   },
    { val: 'ph',     label: 'PH'     },
    { val: 'rdo',    label: 'RDO'    },
    { val: 'other',  label: 'Other'  }
  ];
  return types.map(t => `
    <button
      class="day-type-pill${t.val === activeType ? ' active' : ''}"
      data-type="${t.val}"
      onclick="setDayType('${isoDate}', '${t.val}', this)"
      title="${getDayTypeLabel(t.val)}"
    >${t.label}</button>
  `).join('');
}

function getDayTypeLabel(val) {
  const map = {
    work: 'Ordinary Work Hours', annual: 'Annual Leave', sick: 'Sick Leave',
    ph: 'Public Holiday', rdo: 'RDO / Day Off', other: 'Other'
  };
  return map[val] || val;
}

/** Called when user taps a day-type pill */
function setDayType(isoDate, type, pillEl) {
  // Update pill UI
  pillEl.closest('.day-type-selector')
        .querySelectorAll('.day-type-pill')
        .forEach(p => p.classList.remove('active'));
  pillEl.classList.add('active');

  // If switching to a non-work type, pre-fill 7.6 hours if empty
  const hoursInput = document.getElementById('hours-' + isoDate);
  if (['annual','sick','ph'].includes(type) && !hoursInput.value) {
    hoursInput.value = '7.6';
  }
  // If switching to RDO/Other, clear hours
  if (['rdo'].includes(type)) {
    hoursInput.value = '';
  }

  updateHoursSummary();
  updateRowHighlight(isoDate);
}

/** Called when hours value changes */
function onHoursChange(isoDate) {
  updateHoursSummary();
  updateRowHighlight(isoDate);
}

/** Highlight a row green if it has hours entered */
function updateRowHighlight(isoDate) {
  const row = document.getElementById('row-' + isoDate);
  const val = parseFloat(document.getElementById('hours-' + isoDate)?.value) || 0;
  if (row) row.classList.toggle('has-hours', val > 0);
}

/* ─────────────────────────────────────────
   COPY TOOLS
───────────────────────────────────────── */

/** Apply hours + pay category to all weekday rows */
function copyToAllWeekdays() {
  const hrs = document.getElementById('copy-hours-val').value;
  const cat = document.getElementById('copy-cat-val').value;

  if (!hrs || parseFloat(hrs) <= 0) {
    showToast('Enter hours to copy first', 'error');
    return;
  }

  let count = 0;
  document.querySelectorAll('.daily-row:not(.weekend)').forEach(row => {
    const isoDate = row.id.replace('row-', '');
    const hoursInput = document.getElementById('hours-' + isoDate);
    if (hoursInput) {
      hoursInput.value = hrs;
      // Activate the correct pill
      const pill = row.querySelector(`.day-type-pill[data-type="${cat}"]`);
      if (pill) {
        row.querySelectorAll('.day-type-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      }
      updateRowHighlight(isoDate);
      count++;
    }
  });

  updateHoursSummary();
  showToast(`✅ Applied to ${count} weekdays`, 'success');
}

/** Copy a job reference to all row job fields */
function copyJobToAll() {
  const val = document.getElementById('copy-job-val').value.trim();
  if (!val) { showToast('Enter a job reference to copy first', 'error'); return; }

  let count = 0;
  document.querySelectorAll('.job-field-input').forEach(input => {
    input.value = val;
    count++;
  });
  showToast(`✅ Job copied to ${count} rows`, 'success');
}

/* ─────────────────────────────────────────
   HOURS SUMMARY BAR
───────────────────────────────────────── */
function updateHoursSummary() {
  const totals = { work: 0, annual: 0, sick: 0, ph: 0, rdo: 0, other: 0 };
  let totalHrs = 0;

  // Loop every row and read its current hours + active type
  document.querySelectorAll('.daily-row').forEach(row => {
    const isoDate = row.id.replace('row-', '');
    const hrs  = parseFloat(document.getElementById('hours-' + isoDate)?.value) || 0;
    const pill = row.querySelector('.day-type-pill.active');
    const type = pill?.dataset.type || 'work';
    if (hrs > 0) {
      totals[type] = (totals[type] || 0) + hrs;
      totalHrs += hrs;
    }
  });

  const el = document.getElementById('hours-summary');
  if (!el) return;

  const items = [
    { key: 'total',  label: 'Total',   val: totalHrs,       cls: 'amber'  },
    { key: 'work',   label: 'Work',    val: totals.work,    cls: ''       },
    { key: 'annual', label: 'Ann. Lv', val: totals.annual,  cls: 'green'  },
    { key: 'sick',   label: 'Sick',    val: totals.sick,    cls: 'red'    },
    { key: 'ph',     label: 'PH',      val: totals.ph,      cls: 'yellow' },
    { key: 'other',  label: 'Other',   val: (totals.rdo + totals.other), cls: 'purple' }
  ].filter(i => i.key === 'total' || i.val > 0);

  el.innerHTML = items.map(i => `
    <div class="summary-item">
      <span class="summary-label">${i.label}</span>
      <span class="summary-val ${i.cls}">${i.val.toFixed(1)}</span>
    </div>
  `).join('');
}

/* ─────────────────────────────────────────
   RECEIPT COMPRESSION
   Shrinks photos before storing them.
   Large photos → small JPEGs → fast PDF generation.
───────────────────────────────────────── */

/**
 * Compress an image file using the Canvas API.
 * Canvas can draw an image and re-export it at reduced quality.
 * maxWidth: resize if wider than this (pixels)
 * quality: 0–1 JPEG quality
 */
function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    // Only compress actual images (not PDFs)
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => resolve({ data: e.target.result, type: file.type, originalSize: file.size, compressedSize: file.size });
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // Free memory

      // Calculate new dimensions keeping aspect ratio
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxWidth) {
        h = Math.round(h * maxWidth / w);
        w = maxWidth;
      }

      // Draw to canvas at reduced size
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // Export as JPEG (smaller than PNG)
      const compressedData = canvas.toDataURL('image/jpeg', quality);

      // Calculate sizes for user feedback
      const originalSize   = file.size;
      const compressedSize = Math.round((compressedData.length * 3) / 4); // Approx bytes from base64

      resolve({
        data:            compressedData,
        type:            'image/jpeg',
        originalSize,
        compressedSize
      });
    };

    img.onerror = () => reject(new Error('Could not load image'));
    img.src = objectUrl;
  });
}

/** Called when user selects a receipt file — shows compression preview */
async function onReceiptSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const label = document.getElementById('receipt-label');
  const hint  = document.getElementById('receipt-size-hint');

  document.getElementById('receipt-upload-text').textContent = '⏳ Processing…';

  try {
    const result = await compressImage(file);
    const savedPct = file.type.startsWith('image/')
      ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
      : 0;

    document.getElementById('receipt-upload-text').textContent = `✅ ${file.name}`;
    label.classList.add('has-file');

    if (savedPct > 5) {
      hint.textContent = `Original: ${formatBytes(result.originalSize)} → Compressed: ${formatBytes(result.compressedSize)} (saved ${savedPct}%)`;
    } else {
      hint.textContent = `File size: ${formatBytes(result.originalSize)}`;
    }
  } catch (e) {
    document.getElementById('receipt-upload-text').textContent = `📎 ${file.name}`;
    hint.textContent = '';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ─────────────────────────────────────────
   EXPENSES
───────────────────────────────────────── */
async function addExpense() {
  const type    = document.getElementById('exp-type').value;
  const amount  = document.getElementById('exp-amount').value;
  const date    = document.getElementById('exp-date').value;
  const desc    = document.getElementById('exp-desc').value.trim();
  const file    = document.getElementById('exp-receipt').files[0];

  if (!type)                          { showToast('Select an expense type', 'error'); return; }
  if (!amount || parseFloat(amount) <= 0) { showToast('Enter a valid amount', 'error'); return; }
  if (!date)                          { showToast('Select a date', 'error'); return; }
  if (!file)                          { showToast('⚠️ Receipt photo is required', 'error'); return; }

  // Show loading state on button
  const btn = document.querySelector('#expense-form .btn--primary');
  btn.textContent = '⏳ Processing receipt…';
  btn.disabled = true;

  try {
    const compressed = await compressImage(file);

    state.expenses.push({
      id:          Date.now(),
      type, amount: parseFloat(amount), date, desc,
      receiptName: file.name,
      receiptData: compressed.data,
      receiptType: compressed.type
    });

    renderExpenses();
    clearExpenseForm();
    showToast('✅ Expense added', 'success');
  } catch (e) {
    showToast('Could not process receipt: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Add Expense';
    btn.disabled = false;
  }
}

function renderExpenses() {
  const el = document.getElementById('expense-list');
  if (!state.expenses.length) {
    el.innerHTML = '<div class="empty-state">No expenses added yet</div>';
    return;
  }
  el.innerHTML = state.expenses.map((e, i) => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-type">${e.type}</div>
        <div class="item-meta">${formatDate(e.date)}${e.desc ? ' · ' + escHtml(e.desc) : ''}</div>
        <div class="item-receipt">📎 ${escHtml(e.receiptName)}</div>
      </div>
      <div class="item-side">
        <div class="item-amount">$${e.amount.toFixed(2)}</div>
        <button class="item-remove" onclick="removeExpense(${i})" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

function removeExpense(i) { state.expenses.splice(i, 1); renderExpenses(); }

function clearExpenseForm() {
  ['exp-type','exp-amount','exp-date','exp-desc'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('exp-receipt').value = '';
  document.getElementById('receipt-upload-text').textContent = 'Tap to take photo or choose file';
  document.getElementById('receipt-label').classList.remove('has-file');
  document.getElementById('receipt-size-hint').textContent = '';
  // Reset date to today
  document.getElementById('exp-date').value = toISODate(new Date());
}

/* ─────────────────────────────────────────
   MILEAGE
───────────────────────────────────────── */
function calcMileageTotal() {
  const km   = parseFloat(document.getElementById('mil-km').value)   || 0;
  const rate = parseFloat(document.getElementById('mil-rate').value) || 0;
  document.getElementById('mil-total').textContent = '$' + (km * rate).toFixed(2);
}

function addMileage() {
  const date = document.getElementById('mil-date').value;
  const from = document.getElementById('mil-from').value.trim();
  const to   = document.getElementById('mil-to').value.trim();
  const km   = parseFloat(document.getElementById('mil-km').value);
  const rate = parseFloat(document.getElementById('mil-rate').value) || 0;

  if (!date) { showToast('Select a date', 'error'); return; }
  if (!from) { showToast('Enter a From location', 'error'); return; }
  if (!to)   { showToast('Enter a To location', 'error'); return; }
  if (!km || km <= 0) { showToast('Enter a valid distance', 'error'); return; }

  state.mileage.push({ id: Date.now(), date, from, to, km, rate, total: km * rate });
  renderMileage();
  clearMileageForm();
  showToast('✅ Trip added', 'success');
}

function renderMileage() {
  const el = document.getElementById('mileage-list');
  if (!state.mileage.length) {
    el.innerHTML = '<div class="empty-state">No trips added yet</div>';
    return;
  }
  el.innerHTML = state.mileage.map((m, i) => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-type">${escHtml(m.from)} → ${escHtml(m.to)}</div>
        <div class="item-meta">${formatDate(m.date)} · ${m.km} km @ $${m.rate.toFixed(2)}/km</div>
      </div>
      <div class="item-side">
        <div class="item-amount">$${m.total.toFixed(2)}</div>
        <button class="item-remove" onclick="removeMileage(${i})" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

function removeMileage(i) { state.mileage.splice(i, 1); renderMileage(); }

function clearMileageForm() {
  document.getElementById('mil-date').value = toISODate(new Date());
  document.getElementById('mil-from').value = '';
  document.getElementById('mil-to').value   = '';
  document.getElementById('mil-km').value   = '';
  document.getElementById('mil-rate').value = '0.88';
  document.getElementById('mil-total').textContent = '$0.00';
}

/* ─────────────────────────────────────────
   ALLOWANCES
───────────────────────────────────────── */
function addAllowance() {
  const type   = document.getElementById('all-type').value;
  const amount = parseFloat(document.getElementById('all-amount').value);
  const notes  = document.getElementById('all-notes').value.trim();

  if (!type)               { showToast('Select an allowance type', 'error'); return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  state.allowances.push({ id: Date.now(), type, amount, notes });
  renderAllowances();
  clearAllowanceForm();
  showToast('✅ Allowance added', 'success');
}

function renderAllowances() {
  const el = document.getElementById('allowance-list');
  if (!state.allowances.length) {
    el.innerHTML = '<div class="empty-state">No allowances added yet</div>';
    return;
  }
  el.innerHTML = state.allowances.map((a, i) => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-type">${a.type}</div>
        <div class="item-meta">${a.notes ? escHtml(a.notes) : 'No notes'}</div>
      </div>
      <div class="item-side">
        <div class="item-amount">$${a.amount.toFixed(2)}</div>
        <button class="item-remove" onclick="removeAllowance(${i})" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

function removeAllowance(i) { state.allowances.splice(i, 1); renderAllowances(); }

function clearAllowanceForm() {
  document.getElementById('all-type').value   = '';
  document.getElementById('all-amount').value = '';
  document.getElementById('all-notes').value  = '';
}

/* ─────────────────────────────────────────
   COLLECT FORM DATA
   Reads all inputs into state before saving/submitting.
───────────────────────────────────────── */
function collectFormData() {
  state.employee.name          = document.getElementById('employee-name').value.trim();
  state.employee.fortnightFrom = document.getElementById('fortnight-from').value;
  state.employee.jobRefType    = document.querySelector('#job-ref-toggle .toggle-opt.active')?.dataset.val || 'client';
  state.employee.jobClient     = document.getElementById('job-client').value.trim();
  state.employee.jobAddress    = document.getElementById('job-address').value.trim();

  // Read daily rows
  state.dailyHours = [];
  document.querySelectorAll('.daily-row').forEach(row => {
    const isoDate = row.id.replace('row-', '');
    const hours   = parseFloat(document.getElementById('hours-' + isoDate)?.value) || 0;
    const pill    = row.querySelector('.day-type-pill.active');
    const type    = pill?.dataset.type || 'work';
    const jobNote = document.getElementById('job-' + isoDate)?.value || '';
    const dayName = row.querySelector('.day-name')?.textContent || '';

    state.dailyHours.push({ date: isoDate, day: dayName, hours, type, jobNote });
  });
}

/* ─────────────────────────────────────────
   BUILD REVIEW SCREEN
───────────────────────────────────────── */
function buildReview() {
  collectFormData();

  const expTotal = state.expenses.reduce((s, e) => s + e.amount, 0);
  const milTotal = state.mileage.reduce((s, m) => s + m.total, 0);
  const allTotal = state.allowances.reduce((s, a) => s + a.amount, 0);
  const grandTotal = expTotal + milTotal + allTotal;

  // Hours breakdown
  const hByType = {};
  let totalHrs = 0;
  state.dailyHours.forEach(d => {
    if (d.hours > 0) {
      hByType[d.type] = (hByType[d.type] || 0) + d.hours;
      totalHrs += d.hours;
    }
  });

  const jobRef = state.employee.jobRefType === 'client'
    ? state.employee.jobClient : state.employee.jobAddress;

  let html = `
    <div class="review-section">
      <div class="review-section-title">Employee</div>
      <div class="review-row"><span class="review-key">Name</span><span class="review-val">${escHtml(state.employee.name) || '—'}</span></div>
      <div class="review-row"><span class="review-key">Fortnight</span><span class="review-val">${formatDate(state.employee.fortnightFrom)} → ${formatDate(state.employee.fortnightTo)}</span></div>
      <div class="review-row"><span class="review-key">Job Ref</span><span class="review-val">${escHtml(jobRef) || '—'}</span></div>
    </div>

    <div class="review-section">
      <div class="review-section-title">Hours — ${totalHrs.toFixed(1)} hrs total</div>
      ${Object.entries(hByType).map(([k, v]) => `
        <div class="review-row">
          <span class="review-key">${getDayTypeLabel(k)}</span>
          <span class="review-val">${v.toFixed(1)} hrs</span>
        </div>`).join('')}
    </div>`;

  if (state.expenses.length) html += `
    <div class="review-section">
      <div class="review-section-title">Expenses</div>
      ${state.expenses.map(e => `
        <div class="review-row">
          <span class="review-key">${e.type}</span>
          <span class="review-val">$${e.amount.toFixed(2)}</span>
        </div>`).join('')}
      <div class="review-row"><span class="review-key"><strong>Subtotal</strong></span><span class="review-val"><strong>$${expTotal.toFixed(2)}</strong></span></div>
    </div>`;

  if (state.mileage.length) html += `
    <div class="review-section">
      <div class="review-section-title">Mileage</div>
      ${state.mileage.map(m => `
        <div class="review-row">
          <span class="review-key">${escHtml(m.from)} → ${escHtml(m.to)}</span>
          <span class="review-val">$${m.total.toFixed(2)}</span>
        </div>`).join('')}
      <div class="review-row"><span class="review-key"><strong>Subtotal</strong></span><span class="review-val"><strong>$${milTotal.toFixed(2)}</strong></span></div>
    </div>`;

  if (state.allowances.length) html += `
    <div class="review-section">
      <div class="review-section-title">Allowances</div>
      ${state.allowances.map(a => `
        <div class="review-row">
          <span class="review-key">${a.type}</span>
          <span class="review-val">$${a.amount.toFixed(2)}</span>
        </div>`).join('')}
      <div class="review-row"><span class="review-key"><strong>Subtotal</strong></span><span class="review-val"><strong>$${allTotal.toFixed(2)}</strong></span></div>
    </div>`;

  html += `<div class="review-total-bar">
    <span class="review-total-label">💰 Grand Total</span>
    <span class="review-total-amount">$${grandTotal.toFixed(2)}</span>
  </div>`;

  document.getElementById('review-content').innerHTML = html;

  // Show/hide EmailJS vs manual submit options
  const hasEJS = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;
  document.getElementById('emailjs-method').style.display = hasEJS ? 'block' : 'none';
  document.getElementById('emailjs-to-display').textContent = settings.emailTo || '—';

  document.getElementById('submit-note-emailjs').style.display = hasEJS ? 'block' : 'none';
  document.getElementById('submit-note-manual').style.display  = hasEJS ? 'none'  : 'block';

  // Pre-fill email fields from settings
  document.getElementById('email-to').value = settings.emailTo || '';
  document.getElementById('email-cc').value = settings.emailCc || '';

  // Hide manual email form if EmailJS is set up
  document.getElementById('mailto-method').style.display = hasEJS ? 'none' : 'block';
}

/* ─────────────────────────────────────────
   VALIDATE
───────────────────────────────────────── */
function validate() {
  collectFormData();
  if (!state.employee.name) {
    showToast('⚠️ Enter employee name', 'error'); gotoStep('tab-timesheet'); return false;
  }
  if (!state.employee.fortnightFrom) {
    showToast('⚠️ Select fortnight start date', 'error'); gotoStep('tab-timesheet'); return false;
  }
  const jobRef = state.employee.jobRefType === 'client'
    ? state.employee.jobClient : state.employee.jobAddress;
  if (!jobRef) {
    showToast('⚠️ Enter a job reference', 'error'); gotoStep('tab-timesheet'); return false;
  }
  const hasEJS = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;
  if (!hasEJS) {
    const emailTo = document.getElementById('email-to').value;
    if (!emailTo || !emailTo.includes('@')) {
      showToast('⚠️ Enter a valid email address', 'error'); gotoStep('tab-review'); return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────
   SUBMIT FORM
───────────────────────────────────────── */
async function submitForm() {
  if (!validate()) return;

  showLoading('Generating PDF…');

  try {
    const pdfBlob    = await generatePDF();
    const filename   = generateFilename();
    const hasEJS     = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;

    if (hasEJS) {
      // ── Auto-send via EmailJS ──
      setLoadingText('Sending email…');
      await sendViaEmailJS(pdfBlob, filename);
      hideLoading();
      onSubmitSuccess(filename, true);
    } else {
      // ── Manual mailto fallback ──
      hideLoading();
      downloadFile(pdfBlob, filename, 'application/pdf');
      setTimeout(() => openEmailClient(filename), 800);
      onSubmitSuccess(filename, false);
    }

    // Save submission record
    settings.lastSubmittedFortnightEnd = state.employee.fortnightTo;
    saveSettings(true); // silent save
    cleanupOldData();

  } catch (err) {
    hideLoading();
    console.error('Submit error:', err);
    showToast('❌ ' + err.message, 'error');
  }
}

function onSubmitSuccess(filename, wasAutoSent) {
  const msg = wasAutoSent
    ? 'Your timesheet was sent automatically to ' + settings.emailTo
    : 'PDF downloaded. Please attach it in your email app and send.';

  document.getElementById('success-msg').textContent = msg;

  // Show next fortnight info
  const nextStart = getNextFortnightStart(state.employee.fortnightTo);
  const nextEnd   = new Date(nextStart + 'T00:00:00');
  nextEnd.setDate(nextEnd.getDate() + 13);
  const nextEndStr = toISODate(nextEnd);

  document.getElementById('success-next-info').innerHTML = `
    <strong>Next fortnight:</strong><br/>
    ${formatDate(nextStart)} → ${formatDate(nextEndStr)}<br/>
    <span style="font-size:11px;color:#666">Tap below to start it now</span>
  `;

  document.getElementById('success-overlay').classList.remove('hidden');

  // Schedule a reminder for the next fortnight (fires when app is reopened)
  if (settings.reminders) {
    scheduleReminder(nextStart, nextEndStr);
  }
}

/* ─────────────────────────────────────────
   EMAILJS INTEGRATION
   Sends email with PDF as base64 attachment.
   
   EMAILJS TEMPLATE SETUP:
   In your EmailJS template, use these variables:
   {{to_email}}     — recipient
   {{cc_email}}     — CC
   {{subject}}      — email subject
   {{employee_name}}
   {{fortnight}}    — date range
   {{total_hours}}
   {{grand_total}}
   {{pdf_name}}     — filename
   {{pdf_data}}     — base64 PDF (use in attachment field)
   {{message}}      — summary body text
───────────────────────────────────────── */
async function sendViaEmailJS(pdfBlob, filename) {
  // Convert blob to base64 string
  const pdfBase64 = await blobToBase64(pdfBlob);

  const totalHrs  = state.dailyHours.reduce((s, d) => s + d.hours, 0);
  const expTotal  = state.expenses.reduce((s, e) => s + e.amount, 0);
  const milTotal  = state.mileage.reduce((s, m) => s + m.total, 0);
  const allTotal  = state.allowances.reduce((s, a) => s + a.amount, 0);
  const grandTotal = expTotal + milTotal + allTotal;

  const emailTo = settings.emailTo || document.getElementById('email-to').value;
  const emailCc = settings.emailCc || document.getElementById('email-cc').value;

  // Initialise EmailJS with your public key
  emailjs.init(settings.ejsPublicKey);

  const templateParams = {
    to_email:      emailTo,
    cc_email:      emailCc,
    subject:       `Timesheet & Expenses — ${state.employee.name} — ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`,
    employee_name: state.employee.name,
    fortnight:     `${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`,
    total_hours:   totalHrs.toFixed(1),
    grand_total:   '$' + grandTotal.toFixed(2),
    pdf_name:      filename,
    pdf_data:      pdfBase64,
    message: `Timesheet submission for ${state.employee.name}.
Fortnight: ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}
Total Hours: ${totalHrs.toFixed(1)}
Expenses: $${expTotal.toFixed(2)}
Mileage: $${milTotal.toFixed(2)}
Allowances: $${allTotal.toFixed(2)}
Grand Total: $${grandTotal.toFixed(2)}`
  };

  const result = await emailjs.send(
    settings.ejsServiceId,
    settings.ejsTemplateId,
    templateParams
  );

  if (result.status !== 200) {
    throw new Error('EmailJS returned status ' + result.status);
  }
}

/** Converts a Blob to a base64 data string */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]); // Strip the data:...;base64, prefix
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ─────────────────────────────────────────
   PDF GENERATION
───────────────────────────────────────── */
async function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210;
  const M = 14; // margin
  let y = M;

  // Helpers
  const txt = (text, x, sz = 10, style = 'normal', col = [15, 31, 53]) => {
    doc.setFontSize(sz); doc.setFont('helvetica', style); doc.setTextColor(...col);
    doc.text(String(text ?? ''), x, y);
  };

  const hline = (col = [210, 220, 230]) => {
    doc.setDrawColor(...col); doc.line(M, y, W - M, y); y += 4;
  };

  const sp = (n = 5) => { y += n; };

  const checkPage = () => {
    if (y > 272) { doc.addPage(); y = M; }
  };

  const sectionHeader = (label) => {
    checkPage();
    doc.setFillColor(26, 58, 92);
    doc.rect(M, y - 4, W - M * 2, 8, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text(label.toUpperCase(), M + 3, y);
    y += 7;
  };

  // ── COVER HEADER ──
  doc.setFillColor(15, 31, 53);
  doc.rect(0, 0, W, 32, 'F');
  // Amber accent bar
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 32, W, 3, 'F');

  doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
  doc.text('FIELDSHEET', M, 14);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(138, 173, 204);
  doc.text('Timesheet & Expense Submission', M, 22);
  doc.text('Generated: ' + new Date().toLocaleString('en-AU'), W - M, 22, { align: 'right' });

  y = 44;

  // ── EMPLOYEE SUMMARY BOX ──
  doc.setFillColor(240, 244, 248);
  doc.roundedRect(M, y - 4, W - M * 2, 32, 3, 3, 'F');

  const jobRef = state.employee.jobRefType === 'client'
    ? state.employee.jobClient : state.employee.jobAddress;

  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 31, 53);
  doc.text(state.employee.name || 'Unknown', M + 4, y + 4);

  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(74, 90, 110);
  doc.text(`Fortnight: ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`, M + 4, y + 12);
  doc.text(`Job Reference: ${jobRef || '—'}`, M + 4, y + 19);

  // Quick summary numbers on the right
  const totalHrs  = state.dailyHours.reduce((s, d) => s + d.hours, 0);
  const expTotal  = state.expenses.reduce((s, e) => s + e.amount, 0);
  const milTotal  = state.mileage.reduce((s, m) => s + m.total, 0);
  const allTotal  = state.allowances.reduce((s, a) => s + a.amount, 0);
  const grandTotal = expTotal + milTotal + allTotal;

  doc.setFontSize(9); doc.setTextColor(74, 90, 110);
  doc.text(`Total Hours: ${totalHrs.toFixed(1)}`, W - M - 4, y + 4, { align: 'right' });
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(245, 158, 11);
  doc.text('$' + grandTotal.toFixed(2), W - M - 4, y + 16, { align: 'right' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(74, 90, 110);
  doc.text('Grand Total', W - M - 4, y + 22, { align: 'right' });

  y += 38;

  // ── DAILY HOURS TABLE ──
  sectionHeader('Daily Hours');

  // Table column headers
  doc.setFillColor(230, 236, 244);
  doc.rect(M, y - 3, W - M * 2, 7, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 90, 110);
  doc.text('Day',       M + 2, y + 1);
  doc.text('Date',      M + 16, y + 1);
  doc.text('Type',      M + 50, y + 1);
  doc.text('Hours',     M + 90, y + 1);
  doc.text('Job / Note', M + 110, y + 1);
  y += 10;

  state.dailyHours.forEach((d, i) => {
    checkPage();
    if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 4, W - M * 2, 7, 'F'); }
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 31, 53);
    doc.text(d.day,                  M + 2,  y);
    doc.text(formatDate(d.date),     M + 16, y);
    doc.text(getDayTypeLabel(d.type), M + 50, y);
    doc.text(d.hours > 0 ? String(d.hours) : '—', M + 90, y);
    doc.text((d.jobNote || '').substring(0, 40), M + 110, y);
    y += 7;
  });

  // Totals by type
  const typeMap = {};
  state.dailyHours.forEach(d => {
    if (d.hours > 0) typeMap[d.type] = (typeMap[d.type] || 0) + d.hours;
  });

  sp(2);
  doc.setFillColor(15, 31, 53);
  doc.rect(M, y - 3, W - M * 2, 8, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
  doc.text('TOTAL HOURS', M + 2, y + 2);
  doc.text(totalHrs.toFixed(1), M + 90, y + 2);

  if (Object.keys(typeMap).length > 1) {
    const breakdown = Object.entries(typeMap)
      .map(([k,v]) => `${getDayTypeLabel(k)}: ${v.toFixed(1)}`)
      .join('  ·  ');
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(breakdown, M + 110, y + 2);
  }
  y += 12;

  // ── EXPENSES ──
  if (state.expenses.length) {
    sectionHeader('Expenses');

    state.expenses.forEach((e, i) => {
      checkPage();
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 4, W - M * 2, 13, 'F'); }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 31, 53);
      doc.text(e.type, M + 2, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(74, 90, 110);
      doc.text(formatDate(e.date) + (e.desc ? '  ·  ' + e.desc : ''), M + 2, y + 5);
      doc.setFontSize(8); doc.setTextColor(22, 163, 74);
      doc.text('Receipt attached: ' + e.receiptName, M + 2, y + 9);
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 31, 53);
      doc.text('$' + e.amount.toFixed(2), W - M - 2, y, { align: 'right' });
      y += 15;
    });

    checkPage();
    doc.setFillColor(15, 31, 53);
    doc.rect(M, y - 3, W - M * 2, 8, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text('EXPENSES TOTAL', M + 2, y + 2);
    doc.text('$' + expTotal.toFixed(2), W - M - 2, y + 2, { align: 'right' });
    y += 12;
  }

  // ── MILEAGE ──
  if (state.mileage.length) {
    sectionHeader('Mileage');

    state.mileage.forEach((m, i) => {
      checkPage();
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 3, W - M * 2, 8, 'F'); }
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 31, 53);
      doc.text(formatDate(m.date), M + 2, y);
      doc.text(`${m.from} → ${m.to}`, M + 24, y);
      doc.text(`${m.km} km @ $${m.rate.toFixed(2)}`, M + 120, y);
      doc.setFont('helvetica', 'bold');
      doc.text('$' + m.total.toFixed(2), W - M - 2, y, { align: 'right' });
      y += 8;
    });

    checkPage();
    doc.setFillColor(15, 31, 53);
    doc.rect(M, y - 3, W - M * 2, 8, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text('MILEAGE TOTAL', M + 2, y + 2);
    doc.text('$' + milTotal.toFixed(2), W - M - 2, y + 2, { align: 'right' });
    y += 12;
  }

  // ── ALLOWANCES ──
  if (state.allowances.length) {
    sectionHeader('Allowances');

    state.allowances.forEach((a, i) => {
      checkPage();
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 3, W - M * 2, 8, 'F'); }
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 31, 53);
      doc.text(a.type, M + 2, y);
      if (a.notes) doc.text(a.notes, M + 70, y);
      doc.setFont('helvetica', 'bold');
      doc.text('$' + a.amount.toFixed(2), W - M - 2, y, { align: 'right' });
      y += 8;
    });

    checkPage();
    doc.setFillColor(15, 31, 53);
    doc.rect(M, y - 3, W - M * 2, 8, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text('ALLOWANCES TOTAL', M + 2, y + 2);
    doc.text('$' + allTotal.toFixed(2), W - M - 2, y + 2, { align: 'right' });
    y += 12;
  }

  // ── GRAND TOTAL ──
  checkPage();
  sp(4);
  doc.setFillColor(245, 158, 11);
  doc.rect(M, y - 5, W - M * 2, 14, 'F');
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 31, 53);
  doc.text('GRAND TOTAL', M + 3, y + 4);
  doc.text('$' + grandTotal.toFixed(2), W - M - 3, y + 4, { align: 'right' });
  y += 18;

  // ── RECEIPT IMAGES (one per page) ──
  for (const exp of state.expenses) {
    if (exp.receiptData && exp.receiptType?.startsWith('image/')) {
      doc.addPage();
      y = M;

      doc.setFillColor(15, 31, 53);
      doc.rect(0, 0, W, 18, 'F');
      doc.setFillColor(245, 158, 11);
      doc.rect(0, 18, W, 2, 'F');
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
      doc.text(`RECEIPT: ${exp.type}  ·  ${formatDate(exp.date)}  ·  $${exp.amount.toFixed(2)}`, M, 12);

      y = 26;
      try {
        const fmt = exp.receiptType.includes('png') ? 'PNG' : 'JPEG';
        doc.addImage(exp.receiptData, fmt, M, y, W - M * 2, 210);
      } catch (e) {
        doc.setTextColor(180, 0, 0); doc.setFontSize(10);
        doc.text('Could not embed: ' + exp.receiptName, M, y + 10);
      }
    }
  }

  // ── PAGE FOOTERS ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(150, 150, 150);
    doc.text(
      `Page ${p} of ${pages}  ·  ${state.employee.name}  ·  ${formatDate(state.employee.fortnightFrom)} – ${formatDate(state.employee.fortnightTo)}  ·  FieldSheet`,
      W / 2, 292, { align: 'center' }
    );
  }

  return doc.output('blob');
}

function generateFilename() {
  const name = (state.employee.name || 'Employee').replace(/\s+/g, '_');
  const from = state.employee.fortnightFrom.replace(/-/g, '');
  const to   = state.employee.fortnightTo.replace(/-/g, '');
  return `FieldSheet_${name}_${from}-${to}.pdf`;
}

/* ─────────────────────────────────────────
   MANUAL EMAIL (MAILTO FALLBACK)
───────────────────────────────────────── */
function openEmailClient(filename) {
  const emailTo = document.getElementById('email-to').value;
  const emailCc = document.getElementById('email-cc').value;
  const name    = state.employee.name || 'Employee';

  const totalHrs   = state.dailyHours.reduce((s, d) => s + d.hours, 0);
  const expTotal   = state.expenses.reduce((s, e) => s + e.amount, 0);
  const milTotal   = state.mileage.reduce((s, m) => s + m.total, 0);
  const allTotal   = state.allowances.reduce((s, a) => s + a.amount, 0);
  const grandTotal = expTotal + milTotal + allTotal;

  const subject = encodeURIComponent(
    `Timesheet & Expenses — ${name} — ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`
  );
  const body = encodeURIComponent(
`Hi,

Please find attached my timesheet submission.

Employee:     ${name}
Fortnight:    ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}
Total Hours:  ${totalHrs.toFixed(1)} hrs
Expenses:     $${expTotal.toFixed(2)}
Mileage:      $${milTotal.toFixed(2)}
Allowances:   $${allTotal.toFixed(2)}
TOTAL:        $${grandTotal.toFixed(2)}

⚠️ Please attach the file: ${filename}

Regards,
${name}`
  );

  let url = `mailto:${emailTo}?subject=${subject}&body=${body}`;
  if (emailCc) url += `&cc=${encodeURIComponent(emailCc)}`;
  window.location.href = url;
}

/* ─────────────────────────────────────────
   DOWNLOAD FILE
───────────────────────────────────────── */
function downloadFile(blob, filename, mime) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

/* ─────────────────────────────────────────
   START NEW SUBMISSION
───────────────────────────────────────── */
function startNewSubmission() {
  // Work out next fortnight dates
  const nextStart = settings.lastSubmittedFortnightEnd
    ? getNextFortnightStart(settings.lastSubmittedFortnightEnd)
    : '';

  // Reset state
  state = {
    employee: {
      name:          settings.name || '',
      fortnightFrom: nextStart,
      fortnightTo:   '',
      jobRefType:    'client',
      jobClient:     '',
      jobAddress:    ''
    },
    dailyHours: [],
    expenses:   [],
    mileage:    [],
    allowances: []
  };

  // Reset form
  document.getElementById('employee-name').value  = settings.name || '';
  document.getElementById('fortnight-from').value = nextStart;
  document.getElementById('job-client').value     = '';
  document.getElementById('job-address').value    = '';
  document.getElementById('daily-rows-container').innerHTML = '';
  document.getElementById('daily-table-card').style.display = 'none';

  // If we have a next start date, auto-build the table
  if (nextStart) {
    const endDate = new Date(nextStart + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 13);
    state.employee.fortnightTo = toISODate(endDate);
    document.getElementById('fortnight-to-display').textContent =
      formatDate(state.employee.fortnightTo) + ' (Sunday)';
    buildDailyTable();
    showToast(`📅 Next fortnight loaded: ${formatDate(nextStart)}`, 'success');
  } else {
    document.getElementById('fortnight-to-display').textContent = '— select a start date —';
  }

  renderExpenses();
  renderMileage();
  renderAllowances();

  document.getElementById('success-overlay').classList.add('hidden');
  gotoStep('tab-timesheet');
  window.scrollTo({ top: 0 });
  updateHeaderStatus();
}

/* ─────────────────────────────────────────
   REMINDERS
   We store when the next reminder should fire.
   Each time the app opens, we check if it's due.
───────────────────────────────────────── */
function scheduleReminder(nextStart, nextEnd) {
  // Store the upcoming fortnight end date
  // We remind from the Thursday before it ends (3 days before Sunday)
  const endDate = new Date(nextEnd + 'T00:00:00');
  const reminderDate = new Date(endDate);
  reminderDate.setDate(endDate.getDate() - 2); // Thursday

  localStorage.setItem('fieldsheet_reminder', JSON.stringify({
    fortnightStart: nextStart,
    fortnightEnd:   nextEnd,
    remindFrom:     toISODate(reminderDate)
  }));
}

function checkReminder() {
  if (!settings.reminders) return;

  const stored = localStorage.getItem('fieldsheet_reminder');
  if (!stored) return;

  try {
    const rem  = JSON.parse(stored);
    const today = toISODate(new Date());

    // Show reminder if today is on or after the remind-from date
    // and before (or on) the fortnight end
    if (today >= rem.remindFrom && today <= rem.fortnightEnd) {
      const daysLeft = Math.round(
        (new Date(rem.fortnightEnd + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24)
      );
      const text = daysLeft <= 0
        ? `⏰ Timesheet due today! ${formatDate(rem.fortnightEnd)}`
        : `⏰ Timesheet due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${formatDate(rem.fortnightStart)} fortnight`;

      document.getElementById('reminder-text').textContent = text;
      document.getElementById('reminder-banner').classList.remove('hidden');
    }
  } catch (e) {
    console.warn('Reminder check failed:', e);
  }
}

function dismissReminder() {
  document.getElementById('reminder-banner').classList.add('hidden');
  // Don't remove from storage — show again next time until they submit
}

/* ─────────────────────────────────────────
   SAVE / LOAD PROGRESS
───────────────────────────────────────── */
function saveProgress() {
  collectFormData();
  try {
    localStorage.setItem('fieldsheet_draft', JSON.stringify({
      state,
      emailTo: document.getElementById('email-to').value,
      emailCc: document.getElementById('email-cc').value,
      savedAt: new Date().toISOString()
    }));
    showToast('✅ Draft saved', 'success');
  } catch (e) {
    showToast('⚠️ Could not save — storage full?', 'error');
  }
}

function loadSavedProgress() {
  try {
    const raw = localStorage.getItem('fieldsheet_draft');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data?.state) return;

    state = data.state;

    // Restore form fields
    document.getElementById('employee-name').value  = state.employee.name || '';
    document.getElementById('fortnight-from').value = state.employee.fortnightFrom || '';
    document.getElementById('job-client').value     = state.employee.jobClient || '';
    document.getElementById('job-address').value    = state.employee.jobAddress || '';
    if (data.emailTo) document.getElementById('email-to').value = data.emailTo;
    if (data.emailCc) document.getElementById('email-cc').value = data.emailCc;

    setJobRefType(state.employee.jobRefType || 'client');

    if (state.employee.fortnightFrom && state.employee.fortnightTo) {
      document.getElementById('fortnight-to-display').textContent =
        formatDate(state.employee.fortnightTo) + ' (Sunday)';
      buildDailyTable();
    }

    renderExpenses();
    renderMileage();
    renderAllowances();
    updateHeaderStatus();

    const when = new Date(data.savedAt).toLocaleString('en-AU', { timeStyle: 'short', dateStyle: 'short' });
    showToast(`📂 Draft restored (${when})`, 'success');
  } catch (e) {
    console.warn('Load draft failed:', e);
  }
}

function cleanupOldData() {
  localStorage.removeItem('fieldsheet_draft');
}

/* ─────────────────────────────────────────
   SETTINGS — OPEN / CLOSE / SAVE / LOAD
───────────────────────────────────────── */
function openSettings() {
  // Populate fields from stored settings
  document.getElementById('settings-name').value         = settings.name || '';
  document.getElementById('settings-email-to').value     = settings.emailTo || '';
  document.getElementById('settings-email-cc').value     = settings.emailCc || '';
  document.getElementById('settings-ejs-key').value      = settings.ejsPublicKey || '';
  document.getElementById('settings-ejs-service').value  = settings.ejsServiceId || '';
  document.getElementById('settings-ejs-template').value = settings.ejsTemplateId || '';
  document.getElementById('settings-reminders').checked  = settings.reminders !== false;

  updateEmailJSStatus();

  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('settings-drawer').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-drawer').classList.remove('open');
  setTimeout(() => document.getElementById('settings-overlay').classList.add('hidden'), 300);
}

function saveSettings(silent = false) {
  settings.name          = document.getElementById('settings-name')?.value.trim()  || settings.name;
  settings.emailTo       = document.getElementById('settings-email-to')?.value.trim() || settings.emailTo;
  settings.emailCc       = document.getElementById('settings-email-cc')?.value.trim() || settings.emailCc;
  settings.ejsPublicKey  = document.getElementById('settings-ejs-key')?.value.trim() || settings.ejsPublicKey;
  settings.ejsServiceId  = document.getElementById('settings-ejs-service')?.value.trim() || settings.ejsServiceId;
  settings.ejsTemplateId = document.getElementById('settings-ejs-template')?.value.trim() || settings.ejsTemplateId;
  settings.reminders     = document.getElementById('settings-reminders')?.checked ?? settings.reminders;

  localStorage.setItem('fieldsheet_settings', JSON.stringify(settings));

  // Auto-fill employee name if not already set
  const nameField = document.getElementById('employee-name');
  if (settings.name && !nameField.value) {
    nameField.value = settings.name;
  }

  updateEmailJSStatus();
  updateHeaderStatus();

  if (!silent) {
    closeSettings();
    showToast('✅ Settings saved', 'success');
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('fieldsheet_settings');
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Could not load settings:', e);
  }
}

function updateEmailJSStatus() {
  const el = document.getElementById('emailjs-status');
  if (!el) return;
  const key = document.getElementById('settings-ejs-key')?.value.trim();
  const svc = document.getElementById('settings-ejs-service')?.value.trim();
  const tpl = document.getElementById('settings-ejs-template')?.value.trim();

  if (key && svc && tpl) {
    el.className = 'emailjs-status ok';
    el.textContent = '✅ EmailJS configured — emails will be sent automatically';
  } else if (key || svc || tpl) {
    el.className = 'emailjs-status missing';
    el.textContent = '⚠️ Partially configured — fill in all three fields to enable auto-send';
  } else {
    el.className = 'emailjs-status';
    el.style.display = 'none';
  }
}

/* ─────────────────────────────────────────
   HEADER STATUS
───────────────────────────────────────── */
function updateHeaderStatus() {
  const name = settings.name || state.employee.name;
  const greet = name ? `Hello, ${name.split(' ')[0]}` : 'Ready to submit';
  document.getElementById('greeting-text').textContent = greet;

  const badge = document.getElementById('fortnight-badge');
  if (state.employee.fortnightFrom && state.employee.fortnightTo) {
    badge.textContent = `${formatDate(state.employee.fortnightFrom)} – ${formatDate(state.employee.fortnightTo)}`;
  } else {
    badge.textContent = '';
  }
}

/* ─────────────────────────────────────────
   LOADING OVERLAY
───────────────────────────────────────── */
function showLoading(text = 'Please wait…') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function setLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

/* ─────────────────────────────────────────
   TOAST MESSAGES
───────────────────────────────────────── */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */

/** Format "2025-09-01" → "01/09/2025" */
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Escape HTML special chars to prevent XSS when inserting user text into HTML */
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────
   INITIALISE
───────────────────────────────────────── */
function init() {
  loadSettings();

  // Auto-fill employee name from settings
  const nameField = document.getElementById('employee-name');
  if (settings.name && !nameField.value) nameField.value = settings.name;

  // Pre-fill email from settings
  if (settings.emailTo) document.getElementById('email-to').value = settings.emailTo;
  if (settings.emailCc) document.getElementById('email-cc').value = settings.emailCc;

  // Set default dates for forms
  const today = toISODate(new Date());
  document.getElementById('exp-date').value = today;
  document.getElementById('mil-date').value = today;

  // Load any saved draft
  loadSavedProgress();

  // Check if a reminder should be shown
  checkReminder();

  // Update header
  updateHeaderStatus();

  // Render empty lists (shows "nothing added" placeholder)
  renderExpenses();
  renderMileage();
  renderAllowances();

  // First-time user: open settings if no name saved
  if (!settings.name && !settings.emailTo) {
    setTimeout(() => {
      showToast('👋 Welcome! Set your name in Settings first', 'success');
    }, 800);
  }

  console.log('FieldSheet v2 ready ✅');
}

document.addEventListener('DOMContentLoaded', init);
