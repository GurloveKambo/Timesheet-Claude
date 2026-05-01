/* =====================================================
VB BUILT — FIELDSHEET  |  app.js  v4

Bug fixes in this version:

1. Receipts stored in IndexedDB (not localStorage)
   — localStorage silently truncates large base64 images
   — IndexedDB handles files of any size reliably
1. PDF saving on iPhone — uses jsPDF’s built-in .save()
   which triggers iOS “Save to Files” sheet correctly
1. PDF sharing — uses Web Share API (navigator.share)
   which is the ONLY way to share files from a browser
   on iOS. Falls back to download link on Android/desktop.
1. “Done” button added to success screen
1. Last submitted timesheet stored and viewable/editable
   ===================================================== */

‘use strict’;

/* ─────────────────────────────────────────────────────
INDEXEDDB SETUP
We use IndexedDB (the browser’s built-in mini database)
to store large data like receipt images and full
submission history. localStorage has a ~5MB limit and
silently fails with large files — IndexedDB has no
practical limit.
───────────────────────────────────────────────────── */
const DB_NAME    = ‘fieldsheet_db’;
const DB_VERSION = 1;
let db = null; // Will hold our database connection

/**

- Opens (or creates) the IndexedDB database.
- Returns a Promise that resolves once the DB is ready.
  */
  function openDB() {
  return new Promise((resolve, reject) => {
  if (db) { resolve(db); return; } // Already open
  
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  
  // Runs when the database is first created or upgraded
  req.onupgradeneeded = e => {
  const database = e.target.result;
  // “drafts” store: holds the current in-progress form data
  if (!database.objectStoreNames.contains(‘drafts’)) {
  database.createObjectStore(‘drafts’, { keyPath: ‘id’ });
  }
  // “submissions” store: holds the last completed submission
  if (!database.objectStoreNames.contains(‘submissions’)) {
  database.createObjectStore(‘submissions’, { keyPath: ‘id’ });
  }
  };
  
  req.onsuccess = e => { db = e.target.result; resolve(db); };
  req.onerror   = e => reject(e.target.error);
  });
  }

/** Write a value to a store */
function dbPut(storeName, value) {
return openDB().then(database => new Promise((resolve, reject) => {
const tx  = database.transaction(storeName, ‘readwrite’);
const req = tx.objectStore(storeName).put(value);
req.onsuccess = () => resolve();
req.onerror   = e  => reject(e.target.error);
}));
}

/** Read a value from a store by key */
function dbGet(storeName, key) {
return openDB().then(database => new Promise((resolve, reject) => {
const tx  = database.transaction(storeName, ‘readonly’);
const req = tx.objectStore(storeName).get(key);
req.onsuccess = e => resolve(e.target.result);
req.onerror   = e => reject(e.target.error);
}));
}

/** Delete a value from a store by key */
function dbDelete(storeName, key) {
return openDB().then(database => new Promise((resolve, reject) => {
const tx  = database.transaction(storeName, ‘readwrite’);
const req = tx.objectStore(storeName).delete(key);
req.onsuccess = () => resolve();
req.onerror   = e  => reject(e.target.error);
}));
}

/* ─────────────────────────────────────────────────────
APP STATE
───────────────────────────────────────────────────── */
let state = {
employee: {
name:          ‘’,
fortnightFrom: ‘’,
fortnightTo:   ‘’
},
dailyHours:  [],
expenses:    [],  // receipts stored as base64 inside each expense object
mileage:     [],
allowances:  []
};

let settings = {
name:          ‘’,
emailTo:       ‘’,
emailCc:       ‘’,
ejsPublicKey:  ‘’,
ejsServiceId:  ‘’,
ejsTemplateId: ‘’,
reminders:     true,
lastSubmittedFortnightEnd: ‘’
};

/* ─────────────────────────────────────────────────────
TOP-CHROME HEIGHT → CONTENT MARGIN
───────────────────────────────────────────────────── */
function setContentMargin() {
const chrome  = document.getElementById(‘top-chrome’);
const content = document.getElementById(‘app-content’);
if (chrome && content) {
content.style.marginTop = chrome.offsetHeight + ‘px’;
}
}

/* ─────────────────────────────────────────────────────
SERVICE WORKER
───────────────────────────────────────────────────── */
if (‘serviceWorker’ in navigator) {
navigator.serviceWorker.register(‘sw.js’)
.then(reg => {
reg.update();
reg.addEventListener(‘updatefound’, () => {
const nw = reg.installing;
nw.addEventListener(‘statechange’, () => {
if (nw.state === ‘installed’ && navigator.serviceWorker.controller) {
document.getElementById(‘update-banner’).classList.remove(‘hidden’);
setTimeout(setContentMargin, 50);
}
});
});
})
.catch(e => console.warn(‘SW:’, e));
}

function applyUpdate() {
if (navigator.serviceWorker.controller) {
navigator.serviceWorker.controller.postMessage({ action: ‘skipWaiting’ });
}
window.location.reload();
}

/* ─────────────────────────────────────────────────────
TAB NAVIGATION
───────────────────────────────────────────────────── */
function switchTab(btn) {
const targetId = btn.getAttribute(‘data-tab’);
document.querySelectorAll(’.tab-panel’).forEach(p => p.classList.remove(‘active’));
document.querySelectorAll(’.step-btn’).forEach(b => b.classList.remove(‘active’));
document.getElementById(targetId).classList.add(‘active’);
btn.classList.add(‘active’);
window.scrollTo({ top: 0, behavior: ‘smooth’ });
}

function gotoStep(tabId) {
const btn = document.querySelector(`[data-tab="${tabId}"]`);
if (btn) switchTab(btn);
}

/* ─────────────────────────────────────────────────────
FORTNIGHT DATE LOGIC
───────────────────────────────────────────────────── */
function onFortnightStartChange(input) {
if (!input.value) return;
const d   = parseLocalDate(input.value);
const dow = d.getDay();

if (dow !== 1) {
const diff = dow === 0 ? -6 : 1 - dow;
d.setDate(d.getDate() + diff);
input.value = toISO(d);
showToast(’📅 Snapped to Monday ’ + fmtDate(input.value), ‘success’);
}

const end = new Date(d);
end.setDate(d.getDate() + 13);

state.employee.fortnightFrom = input.value;
state.employee.fortnightTo   = toISO(end);

document.getElementById(‘fortnight-to-display’).textContent =
fmtDate(state.employee.fortnightTo) + ’ (Sunday)’;

updateHeaderStatus();
buildDailyTable();
}

function getNextFortnightStart(lastEndISO) {
const d = parseLocalDate(lastEndISO);
d.setDate(d.getDate() + 1);
return toISO(d);
}

/* ─────────────────────────────────────────────────────
BUILD DAILY TABLE
───────────────────────────────────────────────────── */
function buildDailyTable() {
const from = state.employee.fortnightFrom;
const to   = state.employee.fortnightTo;
if (!from || !to) return;

const DAY_NAMES = [‘Sun’,‘Mon’,‘Tue’,‘Wed’,‘Thu’,‘Fri’,‘Sat’];
const container = document.getElementById(‘daily-rows-container’);
container.innerHTML = ‘’;

const cur = parseLocalDate(from);
const end = parseLocalDate(to);

while (cur <= end) {
const iso       = toISO(cur);
const dayName   = DAY_NAMES[cur.getDay()];
const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
const saved     = state.dailyHours.find(d => d.date === iso) || {};
const type      = saved.type || (isWeekend ? ‘rdo’ : ‘work’);

```
const row = document.createElement('div');
row.className = 'day-row' + (isWeekend ? ' weekend' : '');
row.id = 'row-' + iso;

row.innerHTML = `
  <div class="day-row-top">
    <span class="day-name">${dayName}</span>
    <span class="day-date">${fmtDate(iso)}</span>
    ${isWeekend ? '<span class="day-weekend-tag">Weekend</span>' : ''}
  </div>
  <div class="day-row-inputs">
    <select class="day-select" id="type-${iso}" data-type="${type}" data-date="${iso}"
            onchange="onTypeChange('${iso}', this)">
      <option value="work"   ${type==='work'   ?'selected':''}>Work</option>
      <option value="annual" ${type==='annual' ?'selected':''}>Annual Leave</option>
      <option value="sick"   ${type==='sick'   ?'selected':''}>Sick Leave</option>
      <option value="ph"     ${type==='ph'     ?'selected':''}>Public Holiday</option>
      <option value="rdo"    ${type==='rdo'    ?'selected':''}>RDO / Day Off</option>
      <option value="other"  ${type==='other'  ?'selected':''}>Other</option>
    </select>
    <input type="number" class="day-hours" id="hours-${iso}" data-date="${iso}"
           placeholder="0" min="0" max="24" step="0.5" inputmode="decimal"
           value="${saved.hours > 0 ? saved.hours : ''}"
           oninput="onHoursChange('${iso}')" />
    <input type="text" class="day-notes" id="notes-${iso}" data-date="${iso}"
           placeholder="Job / notes"
           value="${escHtml(saved.jobNote || '')}" />
  </div>`;

container.appendChild(row);

// Apply colour immediately
const sel = row.querySelector('.day-select');
sel.dataset.type = type;

if (saved.hours > 0) row.classList.add('has-hours');
cur.setDate(cur.getDate() + 1);
```

}

document.getElementById(‘daily-table-card’).style.display = ‘block’;
updateHoursSummary();
setTimeout(setContentMargin, 50);
}

function onTypeChange(iso, sel) {
const type = sel.value;
sel.dataset.type = type;
const hoursInput = document.getElementById(‘hours-’ + iso);
if ([‘annual’,‘sick’,‘ph’].includes(type) && !hoursInput.value) {
hoursInput.value = ‘7.6’;
document.getElementById(‘row-’ + iso).classList.add(‘has-hours’);
}
if (type === ‘rdo’) {
hoursInput.value = ‘’;
document.getElementById(‘row-’ + iso).classList.remove(‘has-hours’);
}
updateHoursSummary();
}

function onHoursChange(iso) {
const val = parseFloat(document.getElementById(‘hours-’ + iso)?.value) || 0;
const row = document.getElementById(‘row-’ + iso);
if (row) row.classList.toggle(‘has-hours’, val > 0);
updateHoursSummary();
}

function updateHoursSummary() {
const totals = { work:0, annual:0, sick:0, ph:0, rdo:0, other:0 };
let total = 0;
document.querySelectorAll(’.day-row’).forEach(row => {
const iso  = row.id.replace(‘row-’, ‘’);
const hrs  = parseFloat(document.getElementById(‘hours-’ + iso)?.value) || 0;
const type = document.getElementById(‘type-’  + iso)?.value || ‘work’;
if (hrs > 0) { totals[type] = (totals[type]||0) + hrs; total += hrs; }
});

const el = document.getElementById(‘hours-summary’);
if (!el) return;

const items = [
{ label:‘Total’,   val: total,                      cls:‘c-amber’  },
{ label:‘Work’,    val: totals.work,                cls:’’         },
{ label:‘Ann. Lv’, val: totals.annual,              cls:‘c-green’  },
{ label:‘Sick’,    val: totals.sick,                cls:‘c-red’    },
{ label:‘PH’,      val: totals.ph,                  cls:‘c-yellow’ },
{ label:‘Other’,   val: totals.rdo + totals.other,  cls:‘c-purple’ }
].filter(i => i.label === ‘Total’ || i.val > 0);

el.innerHTML = items.map(i => ` <div class="hrs-item"> <span class="hrs-label">${i.label}</span> <span class="hrs-val ${i.cls}">${i.val.toFixed(1)}</span> </div>`).join(’’);
}

/* ─────────────────────────────────────────────────────
QUICK-FILL TOOLS
───────────────────────────────────────────────────── */
function copyToAllWeekdays() {
const hrs = document.getElementById(‘copy-hours-val’).value;
const cat = document.getElementById(‘copy-cat-val’).value;
if (!hrs || parseFloat(hrs) <= 0) { showToast(‘Enter hours first’, ‘error’); return; }

let count = 0;
document.querySelectorAll(’.day-row:not(.weekend)’).forEach(row => {
const iso = row.id.replace(‘row-’, ‘’);
const hI  = document.getElementById(‘hours-’ + iso);
const tS  = document.getElementById(‘type-’  + iso);
if (hI) { hI.value = hrs; row.classList.add(‘has-hours’); count++; }
if (tS) { tS.value = cat; tS.dataset.type = cat; }
});
updateHoursSummary();
showToast(`✅ Applied to ${count} weekdays`, ‘success’);
}

function copyJobToAll() {
const val = document.getElementById(‘copy-job-val’).value.trim();
if (!val) { showToast(‘Enter a job ref to copy’, ‘error’); return; }
let count = 0;
document.querySelectorAll(’.day-notes’).forEach(input => { input.value = val; count++; });
showToast(`✅ Job copied to ${count} rows`, ‘success’);
}

/* ─────────────────────────────────────────────────────
RECEIPT COMPRESSION
Uses Canvas API to shrink photos before storing.
───────────────────────────────────────────────────── */
function compressImage(file, maxWidth = 1200, quality = 0.75) {
return new Promise((resolve, reject) => {
if (!file.type.startsWith(‘image/’)) {
// Non-image (PDF etc) — read as-is
const reader = new FileReader();
reader.onload  = e => resolve({
data: e.target.result, type: file.type,
originalSize: file.size, compressedSize: file.size
});
reader.onerror = reject;
reader.readAsDataURL(file);
return;
}

```
const img = new Image();
const url = URL.createObjectURL(file);
img.onload = () => {
  URL.revokeObjectURL(url);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const data = canvas.toDataURL('image/jpeg', quality);
  resolve({ data, type: 'image/jpeg',
            originalSize: file.size,
            compressedSize: Math.round((data.length * 3) / 4) });
};
img.onerror = () => reject(new Error('Could not load image'));
img.src = url;
```

});
}

async function onReceiptSelected(input) {
const file  = input.files[0];
if (!file) return;
const label = document.getElementById(‘receipt-label’);
const hint  = document.getElementById(‘receipt-size-hint’);
document.getElementById(‘receipt-upload-text’).textContent = ‘⏳ Processing…’;
try {
const r    = await compressImage(file);
const pct  = file.type.startsWith(‘image/’)
? Math.round((1 - r.compressedSize / r.originalSize) * 100) : 0;
document.getElementById(‘receipt-upload-text’).textContent = ’✅ ’ + file.name;
label.classList.add(‘has-file’);
hint.textContent = pct > 5
? `${fmtBytes(r.originalSize)} → ${fmtBytes(r.compressedSize)} (saved ${pct}%)`
: `Size: ${fmtBytes(r.originalSize)}`;
} catch {
document.getElementById(‘receipt-upload-text’).textContent = ’📎 ’ + file.name;
hint.textContent = ‘’;
}
}

function fmtBytes(b) {
if (b < 1024)      return b + ’ B’;
if (b < 1048576)   return (b/1024).toFixed(0) + ’ KB’;
return (b/1048576).toFixed(1) + ’ MB’;
}

/* ─────────────────────────────────────────────────────
EXPENSES
───────────────────────────────────────────────────── */
async function addExpense() {
const type   = document.getElementById(‘exp-type’).value;
const amount = document.getElementById(‘exp-amount’).value;
const date   = document.getElementById(‘exp-date’).value;
const desc   = document.getElementById(‘exp-desc’).value.trim();
const file   = document.getElementById(‘exp-receipt’).files[0];

if (!type)                             { showToast(‘Select a type’, ‘error’); return; }
if (!amount || parseFloat(amount) <= 0){ showToast(‘Enter a valid amount’, ‘error’); return; }
if (!date)                             { showToast(‘Select a date’, ‘error’); return; }
if (!file)                             { showToast(‘⚠️ Receipt photo required’, ‘error’); return; }

const btn = document.querySelector(’#tab-expenses .add-form .btn–primary’);
if (btn) { btn.textContent = ‘⏳ Processing…’; btn.disabled = true; }

try {
const compressed = await compressImage(file);
state.expenses.push({
id:          Date.now(),
type,
amount:      parseFloat(amount),
date,
desc,
receiptName: file.name,
receiptData: compressed.data,   // base64 string stored inside the expense object
receiptType: compressed.type
});
renderExpenses();
clearExpenseForm();
showToast(‘✅ Expense added’, ‘success’);
} catch(e) {
showToast(’Could not process receipt: ’ + e.message, ‘error’);
} finally {
if (btn) { btn.textContent = ‘Add Expense’; btn.disabled = false; }
}
}

function renderExpenses() {
const el = document.getElementById(‘expense-list’);
if (!state.expenses.length) {
el.innerHTML = ‘<div class="empty-state">No expenses added yet</div>’;
return;
}
el.innerHTML = state.expenses.map((e,i) => ` <div class="item-card"> <div class="item-main"> <div class="item-type">${escHtml(e.type)}</div> <div class="item-meta">${fmtDate(e.date)}${e.desc ? ' · '+escHtml(e.desc) : ''}</div> <div class="item-receipt">📎 ${escHtml(e.receiptName)}</div> </div> <div class="item-side"> <div class="item-amount">$${e.amount.toFixed(2)}</div> <button class="item-remove" onclick="removeExpense(${i})">✕</button> </div> </div>`).join(’’);
}

function removeExpense(i) { state.expenses.splice(i,1); renderExpenses(); }

function clearExpenseForm() {
[‘exp-type’,‘exp-amount’,‘exp-desc’].forEach(id => document.getElementById(id).value = ‘’);
document.getElementById(‘exp-date’).value = toISO(new Date());
document.getElementById(‘exp-receipt’).value = ‘’;
document.getElementById(‘receipt-upload-text’).textContent = ‘Tap to photograph or upload receipt’;
document.getElementById(‘receipt-label’)?.classList.remove(‘has-file’);
document.getElementById(‘receipt-size-hint’).textContent = ‘’;
}

/* ─────────────────────────────────────────────────────
MILEAGE
───────────────────────────────────────────────────── */
function calcMileageTotal() {
const km   = parseFloat(document.getElementById(‘mil-km’).value)   || 0;
const rate = parseFloat(document.getElementById(‘mil-rate’).value) || 0;
document.getElementById(‘mil-total’).textContent = ‘$’ + (km * rate).toFixed(2);
}

function addMileage() {
const date = document.getElementById(‘mil-date’).value;
const from = document.getElementById(‘mil-from’).value.trim();
const to   = document.getElementById(‘mil-to’).value.trim();
const km   = parseFloat(document.getElementById(‘mil-km’).value);
const rate = parseFloat(document.getElementById(‘mil-rate’).value) || 0;

if (!date)          { showToast(‘Select a date’, ‘error’); return; }
if (!from)          { showToast(‘Enter a From location’, ‘error’); return; }
if (!to)            { showToast(‘Enter a To location’, ‘error’); return; }
if (!km || km <= 0) { showToast(‘Enter a valid distance’, ‘error’); return; }

state.mileage.push({ id: Date.now(), date, from, to, km, rate, total: km * rate });
renderMileage();
clearMileageForm();
showToast(‘✅ Trip added’, ‘success’);
}

function renderMileage() {
const el = document.getElementById(‘mileage-list’);
if (!state.mileage.length) {
el.innerHTML = ‘<div class="empty-state">No trips added yet</div>’;
return;
}
el.innerHTML = state.mileage.map((m,i) => ` <div class="item-card"> <div class="item-main"> <div class="item-type">${escHtml(m.from)} → ${escHtml(m.to)}</div> <div class="item-meta">${fmtDate(m.date)} · ${m.km} km @ $${m.rate.toFixed(2)}/km</div> </div> <div class="item-side"> <div class="item-amount">$${m.total.toFixed(2)}</div> <button class="item-remove" onclick="removeMileage(${i})">✕</button> </div> </div>`).join(’’);
}

function removeMileage(i) { state.mileage.splice(i,1); renderMileage(); }

function clearMileageForm() {
document.getElementById(‘mil-date’).value = toISO(new Date());
[‘mil-from’,‘mil-to’,‘mil-km’].forEach(id => document.getElementById(id).value = ‘’);
document.getElementById(‘mil-rate’).value = ‘0.88’;
document.getElementById(‘mil-total’).textContent = ‘$0.00’;
}

/* ─────────────────────────────────────────────────────
ALLOWANCES
───────────────────────────────────────────────────── */
function addAllowance() {
const type   = document.getElementById(‘all-type’).value;
const amount = parseFloat(document.getElementById(‘all-amount’).value);
const notes  = document.getElementById(‘all-notes’).value.trim();

if (!type)             { showToast(‘Select a type’, ‘error’); return; }
if (!amount||amount<=0){ showToast(‘Enter a valid amount’, ‘error’); return; }

state.allowances.push({ id: Date.now(), type, amount, notes });
renderAllowances();
clearAllowanceForm();
showToast(‘✅ Allowance added’, ‘success’);
}

function renderAllowances() {
const el = document.getElementById(‘allowance-list’);
if (!state.allowances.length) {
el.innerHTML = ‘<div class="empty-state">No allowances added yet</div>’;
return;
}
el.innerHTML = state.allowances.map((a,i) => ` <div class="item-card"> <div class="item-main"> <div class="item-type">${escHtml(a.type)}</div> <div class="item-meta">${a.notes ? escHtml(a.notes) : 'No notes'}</div> </div> <div class="item-side"> <div class="item-amount">$${a.amount.toFixed(2)}</div> <button class="item-remove" onclick="removeAllowance(${i})">✕</button> </div> </div>`).join(’’);
}

function removeAllowance(i) { state.allowances.splice(i,1); renderAllowances(); }

function clearAllowanceForm() {
[‘all-type’,‘all-amount’,‘all-notes’].forEach(id => document.getElementById(id).value = ‘’);
}

/* ─────────────────────────────────────────────────────
COLLECT FORM DATA
───────────────────────────────────────────────────── */
function collectFormData() {
state.employee.name          = document.getElementById(‘employee-name’).value.trim();
state.employee.fortnightFrom = document.getElementById(‘fortnight-from’).value;

state.dailyHours = [];
document.querySelectorAll(’.day-row’).forEach(row => {
const iso     = row.id.replace(‘row-’, ‘’);
const hours   = parseFloat(document.getElementById(‘hours-’ + iso)?.value) || 0;
const type    = document.getElementById(‘type-’  + iso)?.value || ‘work’;
const jobNote = document.getElementById(‘notes-’ + iso)?.value || ‘’;
const dayName = row.querySelector(’.day-name’)?.textContent || ‘’;
state.dailyHours.push({ date: iso, day: dayName, hours, type, jobNote });
});
}

/* ─────────────────────────────────────────────────────
SAVE DRAFT TO INDEXEDDB
Saves entire state including receipt images.
───────────────────────────────────────────────────── */
async function saveProgress() {
collectFormData();
try {
await dbPut(‘drafts’, {
id:      ‘current’,
state,
emailTo: document.getElementById(‘email-to’)?.value  || ‘’,
emailCc: document.getElementById(‘email-cc’)?.value  || ‘’,
savedAt: new Date().toISOString()
});
showToast(‘✅ Draft saved’, ‘success’);
} catch(e) {
console.error(‘Save failed:’, e);
showToast(‘⚠️ Could not save draft’, ‘error’);
}
}

async function loadDraft() {
try {
const data = await dbGet(‘drafts’, ‘current’);
if (!data?.state) return;

```
state = data.state;
document.getElementById('employee-name').value  = state.employee.name || '';
document.getElementById('fortnight-from').value = state.employee.fortnightFrom || '';
if (data.emailTo) document.getElementById('email-to').value = data.emailTo;
if (data.emailCc) document.getElementById('email-cc').value = data.emailCc;

if (state.employee.fortnightFrom && state.employee.fortnightTo) {
  document.getElementById('fortnight-to-display').textContent =
    fmtDate(state.employee.fortnightTo) + ' (Sunday)';
  buildDailyTable();
}

renderExpenses(); renderMileage(); renderAllowances();
updateHeaderStatus();

const when = new Date(data.savedAt).toLocaleString('en-AU', { timeStyle:'short', dateStyle:'short' });
showToast(`📂 Draft restored (${when})`, 'success');
```

} catch(e) {
console.warn(‘Load draft failed:’, e);
}
}

async function cleanupDraft() {
try { await dbDelete(‘drafts’, ‘current’); } catch{}
}

/* ─────────────────────────────────────────────────────
SAVE LAST SUBMISSION TO INDEXEDDB
Stores the full state of the most recent submission,
including all receipt images, so the user can review
or restore it later.
───────────────────────────────────────────────────── */
async function saveLastSubmission(pdfBlob, filename) {
try {
// Convert PDF blob to base64 so we can store it in IndexedDB
const pdfBase64 = await blobToBase64(pdfBlob);
await dbPut(‘submissions’, {
id:          ‘last’,
state:       JSON.parse(JSON.stringify(state)), // deep copy
pdfBase64,
pdfFilename: filename,
submittedAt: new Date().toISOString()
});
} catch(e) {
console.warn(‘Could not save submission record:’, e);
}
}

/* ─────────────────────────────────────────────────────
LOAD LAST SUBMISSION (for View/Edit)
───────────────────────────────────────────────────── */
async function loadLastSubmission() {
try {
const data = await dbGet(‘submissions’, ‘last’);
if (!data) { showToast(‘No previous submission found’, ‘error’); return; }

```
// Restore state from the saved submission
state = data.state;

// Restore form fields
document.getElementById('employee-name').value  = state.employee.name || '';
document.getElementById('fortnight-from').value = state.employee.fortnightFrom || '';

if (state.employee.fortnightFrom && state.employee.fortnightTo) {
  document.getElementById('fortnight-to-display').textContent =
    fmtDate(state.employee.fortnightTo) + ' (Sunday)';
  buildDailyTable();
}

renderExpenses(); renderMileage(); renderAllowances();
updateHeaderStatus();

// Go to the timesheet tab so user can review/edit
gotoStep('tab-timesheet');

const when = new Date(data.submittedAt).toLocaleString('en-AU', { timeStyle:'short', dateStyle:'short' });
showToast(`📂 Last submission loaded (${when})`, 'success');
```

} catch(e) {
console.warn(‘Load submission failed:’, e);
showToast(‘Could not load last submission’, ‘error’);
}
}

/* ─────────────────────────────────────────────────────
REVIEW SCREEN
───────────────────────────────────────────────────── */
function buildReview() {
collectFormData();

const expTotal   = state.expenses.reduce((s,e) => s + e.amount, 0);
const milTotal   = state.mileage.reduce((s,m) => s + m.total, 0);
const allTotal   = state.allowances.reduce((s,a) => s + a.amount, 0);
const grandTotal = expTotal + milTotal + allTotal;

const hByType = {};
let totalHrs = 0;
state.dailyHours.forEach(d => {
if (d.hours > 0) {
hByType[d.type] = (hByType[d.type]||0) + d.hours;
totalHrs += d.hours;
}
});

let html = `<div class="rv-section"> <div class="rv-title">Employee</div> <div class="rv-row"><span class="rv-key">Name</span><span class="rv-val">${escHtml(state.employee.name)||'—'}</span></div> <div class="rv-row"><span class="rv-key">Fortnight</span><span class="rv-val">${fmtDate(state.employee.fortnightFrom)} – ${fmtDate(state.employee.fortnightTo)}</span></div> </div> <div class="rv-section"> <div class="rv-title">Hours — ${totalHrs.toFixed(1)} total</div> ${Object.entries(hByType).map(([k,v]) =>`
<div class="rv-row">
<span class="rv-key">${typeLabel(k)}</span>
<span class="rv-val">${v.toFixed(1)} hrs</span>
</div>`).join('')} </div>`;

if (state.expenses.length) html += `<div class="rv-section"> <div class="rv-title">Expenses (${state.expenses.length} items)</div> ${state.expenses.map(e =>`
<div class="rv-row">
<span class="rv-key">${escHtml(e.type)}</span>
<span class="rv-val">$${e.amount.toFixed(2)}</span>
</div>`).join('')} <div class="rv-row"><span class="rv-key"><strong>Subtotal</strong></span><span class="rv-val"><strong>$${expTotal.toFixed(2)}</strong></span></div> </div>`;

if (state.mileage.length) html += `<div class="rv-section"> <div class="rv-title">Mileage (${state.mileage.length} trips)</div> ${state.mileage.map(m =>`
<div class="rv-row">
<span class="rv-key">${escHtml(m.from)} → ${escHtml(m.to)}</span>
<span class="rv-val">$${m.total.toFixed(2)}</span>
</div>`).join('')} <div class="rv-row"><span class="rv-key"><strong>Subtotal</strong></span><span class="rv-val"><strong>$${milTotal.toFixed(2)}</strong></span></div> </div>`;

if (state.allowances.length) html += `<div class="rv-section"> <div class="rv-title">Allowances</div> ${state.allowances.map(a =>`
<div class="rv-row">
<span class="rv-key">${escHtml(a.type)}</span>
<span class="rv-val">$${a.amount.toFixed(2)}</span>
</div>`).join('')} <div class="rv-row"><span class="rv-key"><strong>Subtotal</strong></span><span class="rv-val"><strong>$${allTotal.toFixed(2)}</strong></span></div> </div>`;

html += ` <div class="rv-total"> <span class="rv-total-label">💰 Grand Total</span> <span class="rv-total-amt">$${grandTotal.toFixed(2)}</span> </div>`;

document.getElementById(‘review-content’).innerHTML = html;

const hasEJS = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;
document.getElementById(‘emailjs-method’).style.display      = hasEJS ? ‘block’ : ‘none’;
document.getElementById(‘emailjs-to-display’).textContent     = settings.emailTo || ‘—’;
document.getElementById(‘mailto-method’).style.display        = hasEJS ? ‘none’ : ‘block’;
document.getElementById(‘submit-note-emailjs’).style.display  = hasEJS ? ‘block’ : ‘none’;
document.getElementById(‘submit-note-manual’).style.display   = hasEJS ? ‘none’  : ‘block’;

document.getElementById(‘email-to’).value = settings.emailTo || ‘’;
document.getElementById(‘email-cc’).value = settings.emailCc || ‘’;
}

/* ─────────────────────────────────────────────────────
VALIDATE
───────────────────────────────────────────────────── */
function validate() {
collectFormData();
if (!state.employee.name) {
showToast(‘⚠️ Enter your name’, ‘error’); gotoStep(‘tab-timesheet’); return false;
}
if (!state.employee.fortnightFrom) {
showToast(‘⚠️ Select a fortnight start date’, ‘error’); gotoStep(‘tab-timesheet’); return false;
}
const hasEJS = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;
if (!hasEJS) {
const et = document.getElementById(‘email-to’).value;
if (!et || !et.includes(’@’)) {
showToast(‘⚠️ Enter a valid email address’, ‘error’); gotoStep(‘tab-review’); return false;
}
}
return true;
}

/* ─────────────────────────────────────────────────────
SUBMIT
───────────────────────────────────────────────────── */
async function submitForm() {
if (!validate()) return;

const btn = document.querySelector(’.btn–submit’);
if (btn) { btn.disabled = true; btn.textContent = ‘⏳ Preparing…’; }

showLoading(‘Generating PDF…’);

try {
// 1. Generate PDF — returns a jsPDF doc object (not just a blob)
//    We need the doc object so we can use .save() for iOS
const { doc, blob, filename } = await generatePDF();

```
// 2. Save a copy of this submission (with receipts) to IndexedDB
await saveLastSubmission(blob, filename);

const hasEJS = settings.ejsPublicKey && settings.ejsServiceId && settings.ejsTemplateId;

if (hasEJS) {
  setLoadingText('Sending email…');
  await sendViaEmailJS(blob, filename);
  hideLoading();
  // On iOS, also offer to save/share the PDF after auto-send
  await sharePDF(doc, blob, filename);
  onSubmitSuccess(filename, true);
} else {
  hideLoading();
  // Share/save the PDF first, then open email
  await sharePDF(doc, blob, filename);
  setTimeout(() => openEmailClient(filename), 800);
  onSubmitSuccess(filename, false);
}

settings.lastSubmittedFortnightEnd = state.employee.fortnightTo;
saveSettings(true);
await cleanupDraft();
```

} catch(err) {
hideLoading();
console.error(‘Submit error:’, err);
showToast(’❌ ’ + err.message, ‘error’);
} finally {
if (btn) { btn.disabled = false; btn.textContent = ‘🚀 Submit Timesheet’; }
}
}

/* ─────────────────────────────────────────────────────
PDF SHARING — THE CORRECT WAY FOR iOS

navigator.share() with files is the ONLY reliable way
to get a file from a browser into iOS Files / Mail.

On Android/desktop we fall back to a download link.
jsPDF’s .save() method also works well on iOS Safari
as a last resort — it triggers the native share sheet.
───────────────────────────────────────────────────── */
async function sharePDF(doc, blob, filename) {
// Try Web Share API with files (iOS 15+, Android Chrome)
if (navigator.share && navigator.canShare) {
try {
const file = new File([blob], filename, { type: ‘application/pdf’ });
if (navigator.canShare({ files: [file] })) {
await navigator.share({
files:   [file],
title:   ‘Timesheet Submission’,
text:    `VB Built FieldSheet — ${state.employee.name}`
});
return; // Done — user chose where to save/send
}
} catch(e) {
// User cancelled share sheet — that’s fine, continue
if (e.name === ‘AbortError’) return;
console.warn(‘Web Share failed:’, e);
}
}

// Fallback: jsPDF .save() — triggers browser download
// On iOS Safari this opens the PDF in the browser with
// a “Save to Files” option in the share menu
try {
doc.save(filename);
} catch(e) {
// Last resort: object URL download
downloadBlob(blob, filename);
}
}

function downloadBlob(blob, filename) {
const url = URL.createObjectURL(blob);
const a   = document.createElement(‘a’);
a.href = url; a.download = filename; a.style.display = ‘none’;
document.body.appendChild(a);
a.click();
setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}

function onSubmitSuccess(filename, autoSent) {
const msg = autoSent
? `Sent automatically to ${settings.emailTo}`
: ‘PDF saved/shared. Attach it in your email app and send.’;

document.getElementById(‘success-msg’).textContent = msg;
document.getElementById(‘pdf-filename-display’).textContent = filename;

const nextStart  = getNextFortnightStart(state.employee.fortnightTo);
const nextEndDt  = parseLocalDate(nextStart);
nextEndDt.setDate(nextEndDt.getDate() + 13);
const nextEndISO = toISO(nextEndDt);

document.getElementById(‘success-next-info’).innerHTML = `<strong>Next fortnight:</strong><br> ${fmtDate(nextStart)} → ${fmtDate(nextEndISO)}`;

document.getElementById(‘success-overlay’).classList.remove(‘hidden’);
if (settings.reminders) scheduleReminder(nextStart, nextEndISO);
}

/* ─────────────────────────────────────────────────────
EMAILJS
───────────────────────────────────────────────────── */
async function sendViaEmailJS(pdfBlob, filename) {
const pdfBase64 = await blobToBase64(pdfBlob);
const totalHrs  = state.dailyHours.reduce((s,d) => s+d.hours, 0);
const expTotal  = state.expenses.reduce((s,e) => s+e.amount, 0);
const milTotal  = state.mileage.reduce((s,m) => s+m.total, 0);
const allTotal  = state.allowances.reduce((s,a) => s+a.amount, 0);
const grand     = expTotal + milTotal + allTotal;
const emailTo   = settings.emailTo || document.getElementById(‘email-to’).value;
const emailCc   = settings.emailCc || document.getElementById(‘email-cc’).value;

emailjs.init(settings.ejsPublicKey);

const result = await emailjs.send(settings.ejsServiceId, settings.ejsTemplateId, {
to_email:      emailTo,
cc_email:      emailCc,
subject:       `Timesheet — ${state.employee.name} — ${fmtDate(state.employee.fortnightFrom)} to ${fmtDate(state.employee.fortnightTo)}`,
employee_name: state.employee.name,
fortnight:     `${fmtDate(state.employee.fortnightFrom)} to ${fmtDate(state.employee.fortnightTo)}`,
total_hours:   totalHrs.toFixed(1),
grand_total:   ‘$’ + grand.toFixed(2),
pdf_name:      filename,
pdf_data:      pdfBase64,
message:       `Timesheet for ${state.employee.name}\nFortnight: ${fmtDate(state.employee.fortnightFrom)} – ${fmtDate(state.employee.fortnightTo)}\nTotal Hours: ${totalHrs.toFixed(1)}\nExpenses: $${expTotal.toFixed(2)}\nMileage: $${milTotal.toFixed(2)}\nAllowances: $${allTotal.toFixed(2)}\nGrand Total: $${grand.toFixed(2)}`
});

if (result.status !== 200) throw new Error(’EmailJS returned status ’ + result.status);
}

function blobToBase64(blob) {
return new Promise((res, rej) => {
const r = new FileReader();
r.onload  = () => res(r.result.split(’,’)[1]);
r.onerror = rej;
r.readAsDataURL(blob);
});
}

/* ─────────────────────────────────────────────────────
PDF GENERATION
Returns { doc, blob, filename } so we can use both
the jsPDF doc object (.save() for iOS) and the raw
blob (for EmailJS / Web Share API).
───────────────────────────────────────────────────── */
async function generatePDF() {
const { jsPDF } = window.jspdf;
const doc = new jsPDF({ orientation:‘portrait’, unit:‘mm’, format:‘a4’ });

const W = 210, M = 14;
let y = M;

const sp  = (n=5) => { y += n; };
const chk = () => { if (y > 272) { doc.addPage(); y = M; } };

const secHdr = label => {
chk();
doc.setFillColor(15,31,53);
doc.rect(M, y-4, W-M*2, 8, ‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(label.toUpperCase(), M+3, y);
y += 7;
};

// Cover header
doc.setFillColor(15,31,53); doc.rect(0,0,W,30,‘F’);
doc.setFillColor(245,158,11); doc.rect(0,30,W,3,‘F’);
doc.setFontSize(20); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘VB BUILT — FIELDSHEET’, M, 14);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(138,173,204);
doc.text(’Timesheet & Expense Submission  ·  ’ + new Date().toLocaleString(‘en-AU’), M, 23);
y = 42;

// Employee summary box
const totalHrs = state.dailyHours.reduce((s,d) => s+d.hours, 0);
const expTotal = state.expenses.reduce((s,e) => s+e.amount, 0);
const milTotal = state.mileage.reduce((s,m) => s+m.total, 0);
const allTotal = state.allowances.reduce((s,a) => s+a.amount, 0);
const grand    = expTotal + milTotal + allTotal;

doc.setFillColor(240,244,248); doc.roundedRect(M, y-4, W-M*2, 28, 3, 3, ‘F’);
doc.setFontSize(15); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(state.employee.name || ‘Unknown’, M+4, y+4);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(74,90,110);
doc.text(`Fortnight: ${fmtDate(state.employee.fortnightFrom)} to ${fmtDate(state.employee.fortnightTo)}`, M+4, y+12);
doc.setFontSize(13); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(245,158,11);
doc.text(’$’+grand.toFixed(2), W-M-4, y+10, {align:‘right’});
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(74,90,110);
doc.text(‘Grand Total’, W-M-4, y+17, {align:‘right’});
doc.text(`Total Hours: ${totalHrs.toFixed(1)} hrs`, W-M-4, y+4, {align:‘right’});
y += 34;

// Daily hours table
secHdr(‘Daily Hours’);
doc.setFillColor(230,236,244); doc.rect(M, y-3, W-M*2, 7, ‘F’);
doc.setFontSize(8); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(74,90,110);
doc.text(‘Day’, M+2, y+1); doc.text(‘Date’, M+16, y+1);
doc.text(‘Type’, M+48, y+1); doc.text(‘Hrs’, M+95, y+1); doc.text(‘Job / Notes’, M+110, y+1);
y += 10;

state.dailyHours.forEach((d,i) => {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-4,W-M*2,7,‘F’); }
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(15,31,53);
doc.text(d.day, M+2, y);
doc.text(fmtDate(d.date), M+16, y);
doc.text(typeLabel(d.type), M+48, y);
doc.text(d.hours > 0 ? String(d.hours) : ‘—’, M+95, y);
doc.text((d.jobNote||’’).substring(0,45), M+110, y);
y += 7;
});

// Hours totals row
const typeMap = {};
state.dailyHours.forEach(d => { if(d.hours>0) typeMap[d.type]=(typeMap[d.type]||0)+d.hours; });
chk(); sp(2);
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘TOTAL HOURS’, M+2, y+2);
doc.text(totalHrs.toFixed(1)+’ hrs’, M+95, y+2);
if (Object.keys(typeMap).length > 1) {
doc.setFontSize(7); doc.setFont(‘helvetica’,‘normal’);
doc.text(Object.entries(typeMap).map(([k,v]) => `${typeLabel(k)}: ${v.toFixed(1)}`).join(’  ·  ’), M+110, y+2);
}
y += 12;

// Expenses
if (state.expenses.length) {
secHdr(‘Expenses’);
state.expenses.forEach((e,i) => {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-4,W-M*2,13,‘F’); }
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(e.type, M+2, y);
doc.setFont(‘helvetica’,‘normal’); doc.setFontSize(8); doc.setTextColor(74,90,110);
doc.text(fmtDate(e.date)+(e.desc?’  ·  ‘+e.desc:’’), M+2, y+5);
doc.setTextColor(22,163,74);
doc.text(‘Receipt: ‘+e.receiptName, M+2, y+9);
doc.setFontSize(11); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(’$’+e.amount.toFixed(2), W-M-2, y, {align:‘right’});
y += 15;
});
chk();
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘EXPENSES TOTAL’, M+2, y+2);
doc.text(’$’+expTotal.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

// Mileage
if (state.mileage.length) {
secHdr(‘Mileage’);
state.mileage.forEach((m,i) => {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-3,W-M*2,8,‘F’); }
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(15,31,53);
doc.text(fmtDate(m.date), M+2, y);
doc.text(`${m.from} → ${m.to}`, M+24, y);
doc.text(`${m.km}km @ $${m.rate.toFixed(2)}`, M+120, y);
doc.setFont(‘helvetica’,‘bold’);
doc.text(’$’+m.total.toFixed(2), W-M-2, y, {align:‘right’});
y += 8;
});
chk();
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘MILEAGE TOTAL’, M+2, y+2);
doc.text(’$’+milTotal.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

// Allowances
if (state.allowances.length) {
secHdr(‘Allowances’);
state.allowances.forEach((a,i) => {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-3,W-M*2,8,‘F’); }
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(15,31,53);
doc.text(a.type, M+2, y);
if (a.notes) doc.text(a.notes, M+70, y);
doc.setFont(‘helvetica’,‘bold’);
doc.text(’$’+a.amount.toFixed(2), W-M-2, y, {align:‘right’});
y += 8;
});
chk();
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘ALLOWANCES TOTAL’, M+2, y+2);
doc.text(’$’+allTotal.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

// Grand total bar
chk(); sp(4);
doc.setFillColor(245,158,11); doc.rect(M,y-5,W-M*2,14,‘F’);
doc.setFontSize(12); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(‘GRAND TOTAL’, M+3, y+4);
doc.text(’$’+grand.toFixed(2), W-M-3, y+4, {align:‘right’});
y += 18;

// Receipt images — one per page
for (const e of state.expenses) {
if (e.receiptData && e.receiptType?.startsWith(‘image/’)) {
doc.addPage(); y = M;
doc.setFillColor(15,31,53); doc.rect(0,0,W,18,‘F’);
doc.setFillColor(245,158,11); doc.rect(0,18,W,2,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(`RECEIPT: ${e.type}  ·  ${fmtDate(e.date)}  ·  $${e.amount.toFixed(2)}`, M, 12);
y = 26;
try {
const fmt = e.receiptType.includes(‘png’) ? ‘PNG’ : ‘JPEG’;
doc.addImage(e.receiptData, fmt, M, y, W-M*2, 210);
} catch {
doc.setTextColor(180,0,0); doc.setFontSize(10);
doc.text(’Could not embed: ’ + e.receiptName, M, y+10);
}
}
}

// Page footers
const pages = doc.getNumberOfPages();
for (let p = 1; p <= pages; p++) {
doc.setPage(p);
doc.setFontSize(7); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(150,150,150);
doc.text(
`Page ${p} of ${pages}  ·  ${state.employee.name}  ·  ${fmtDate(state.employee.fortnightFrom)} – ${fmtDate(state.employee.fortnightTo)}  ·  VB Built FieldSheet`,
W/2, 292, { align:‘center’ }
);
}

const filename = generateFilename();
const blob     = doc.output(‘blob’);
return { doc, blob, filename };
}

function generateFilename() {
const name = (state.employee.name || ‘Employee’).replace(/\s+/g, ‘_’);
const from = state.employee.fortnightFrom.replace(/-/g, ‘’);
const to   = state.employee.fortnightTo.replace(/-/g, ‘’);
return `VBBuilt_FieldSheet_${name}_${from}-${to}.pdf`;
}

/* ─────────────────────────────────────────────────────
MANUAL EMAIL FALLBACK
───────────────────────────────────────────────────── */
function openEmailClient(filename) {
const emailTo  = document.getElementById(‘email-to’).value;
const emailCc  = document.getElementById(‘email-cc’).value;
const name     = state.employee.name || ‘Employee’;
const totalHrs = state.dailyHours.reduce((s,d) => s+d.hours, 0);
const expT     = state.expenses.reduce((s,e) => s+e.amount, 0);
const milT     = state.mileage.reduce((s,m) => s+m.total, 0);
const allT     = state.allowances.reduce((s,a) => s+a.amount, 0);

const subject = encodeURIComponent(
`Timesheet & Expenses — ${name} — ${fmtDate(state.employee.fortnightFrom)} to ${fmtDate(state.employee.fortnightTo)}`
);
const body = encodeURIComponent(
`Hi,

Please find attached my timesheet submission.

Employee:   ${name}
Fortnight:  ${fmtDate(state.employee.fortnightFrom)} to ${fmtDate(state.employee.fortnightTo)}
Hours:      ${totalHrs.toFixed(1)} hrs
Expenses:   $${expT.toFixed(2)}
Mileage:    $${milT.toFixed(2)}
Allowances: $${allT.toFixed(2)}
TOTAL:      $${(expT+milT+allT).toFixed(2)}

Please attach the PDF file: ${filename}

Regards,
${name}`
);

let url = `mailto:${emailTo}?subject=${subject}&body=${body}`;
if (emailCc) url += `&cc=${encodeURIComponent(emailCc)}`;
window.location.href = url;
}

/* ─────────────────────────────────────────────────────
START NEW SUBMISSION
───────────────────────────────────────────────────── */
function startNewSubmission() {
const nextStart = settings.lastSubmittedFortnightEnd
? getNextFortnightStart(settings.lastSubmittedFortnightEnd) : ‘’;

state = {
employee: { name: settings.name||’’, fortnightFrom: nextStart, fortnightTo: ‘’ },
dailyHours: [], expenses: [], mileage: [], allowances: []
};

document.getElementById(‘employee-name’).value  = settings.name || ‘’;
document.getElementById(‘fortnight-from’).value = nextStart;
document.getElementById(‘daily-rows-container’).innerHTML = ‘’;
document.getElementById(‘daily-table-card’).style.display = ‘none’;
document.getElementById(‘fortnight-to-display’).textContent = ‘Select a start date above’;

if (nextStart) {
const end = parseLocalDate(nextStart);
end.setDate(end.getDate() + 13);
state.employee.fortnightTo = toISO(end);
document.getElementById(‘fortnight-to-display’).textContent =
fmtDate(state.employee.fortnightTo) + ’ (Sunday)’;
buildDailyTable();
showToast(`📅 Next fortnight: ${fmtDate(nextStart)}`, ‘success’);
}

renderExpenses(); renderMileage(); renderAllowances();
document.getElementById(‘success-overlay’).classList.add(‘hidden’);
gotoStep(‘tab-timesheet’);
window.scrollTo({ top: 0 });
updateHeaderStatus();
}

/* Close success screen without starting a new submission */
function dismissSuccess() {
document.getElementById(‘success-overlay’).classList.add(‘hidden’);
}

/* ─────────────────────────────────────────────────────
REMINDERS
───────────────────────────────────────────────────── */
function scheduleReminder(nextStart, nextEnd) {
const end = parseLocalDate(nextEnd);
const remindFrom = new Date(end);
remindFrom.setDate(end.getDate() - 2);
localStorage.setItem(‘fs_reminder’, JSON.stringify({
fortnightStart: nextStart,
fortnightEnd:   nextEnd,
remindFrom:     toISO(remindFrom)
}));
}

function checkReminder() {
if (!settings.reminders) return;
const raw = localStorage.getItem(‘fs_reminder’);
if (!raw) return;
try {
const r     = JSON.parse(raw);
const today = toISO(new Date());
if (today >= r.remindFrom && today <= r.fortnightEnd) {
const days = Math.round((parseLocalDate(r.fortnightEnd) - new Date()) / 86400000);
const txt  = days <= 0
? `⏰ Timesheet due today! ${fmtDate(r.fortnightEnd)}`
: `⏰ Due in ${days} day${days===1?'':'s'} — ${fmtDate(r.fortnightStart)}`;
document.getElementById(‘reminder-text’).textContent = txt;
document.getElementById(‘reminder-banner’).classList.remove(‘hidden’);
setTimeout(setContentMargin, 50);
}
} catch {}
}

function dismissReminder() {
document.getElementById(‘reminder-banner’).classList.add(‘hidden’);
setTimeout(setContentMargin, 50);
}

/* ─────────────────────────────────────────────────────
SETTINGS
───────────────────────────────────────────────────── */
function openSettings() {
document.getElementById(‘settings-name’).value         = settings.name || ‘’;
document.getElementById(‘settings-email-to’).value     = settings.emailTo || ‘’;
document.getElementById(‘settings-email-cc’).value     = settings.emailCc || ‘’;
document.getElementById(‘settings-ejs-key’).value      = settings.ejsPublicKey || ‘’;
document.getElementById(‘settings-ejs-service’).value  = settings.ejsServiceId || ‘’;
document.getElementById(‘settings-ejs-template’).value = settings.ejsTemplateId || ‘’;
document.getElementById(‘settings-reminders’).checked  = settings.reminders !== false;
updateEJSStatus();
document.getElementById(‘settings-overlay’).classList.remove(‘hidden’);
document.getElementById(‘settings-drawer’).classList.add(‘open’);
}

function closeSettings() {
document.getElementById(‘settings-drawer’).classList.remove(‘open’);
setTimeout(() => document.getElementById(‘settings-overlay’).classList.add(‘hidden’), 300);
}

function saveSettings(silent = false) {
settings.name          = document.getElementById(‘settings-name’)?.value.trim()         || settings.name;
settings.emailTo       = document.getElementById(‘settings-email-to’)?.value.trim()     || settings.emailTo;
settings.emailCc       = document.getElementById(‘settings-email-cc’)?.value.trim()     || ‘’;
settings.ejsPublicKey  = document.getElementById(‘settings-ejs-key’)?.value.trim()      || settings.ejsPublicKey;
settings.ejsServiceId  = document.getElementById(‘settings-ejs-service’)?.value.trim()  || settings.ejsServiceId;
settings.ejsTemplateId = document.getElementById(‘settings-ejs-template’)?.value.trim() || settings.ejsTemplateId;
settings.reminders     = document.getElementById(‘settings-reminders’)?.checked ?? true;

localStorage.setItem(‘fs_settings’, JSON.stringify(settings));

const nf = document.getElementById(‘employee-name’);
if (settings.name && !nf.value) nf.value = settings.name;

updateEJSStatus();
updateHeaderStatus();
if (!silent) { closeSettings(); showToast(‘✅ Settings saved’, ‘success’); }
}

function loadSettings() {
try {
const raw = localStorage.getItem(‘fs_settings’);
if (raw) settings = { …settings, …JSON.parse(raw) };
} catch {}
}

function updateEJSStatus() {
const el  = document.getElementById(‘emailjs-status’);
if (!el) return;
const key = document.getElementById(‘settings-ejs-key’)?.value.trim();
const svc = document.getElementById(‘settings-ejs-service’)?.value.trim();
const tpl = document.getElementById(‘settings-ejs-template’)?.value.trim();
if (key && svc && tpl) {
el.className = ‘ejs-status ok’;
el.textContent = ‘✅ Configured — emails will send automatically’;
} else if (key || svc || tpl) {
el.className = ‘ejs-status partial’;
el.textContent = ‘⚠️ Incomplete — fill all three fields to enable’;
} else {
el.className = ‘ejs-status’; el.style.display = ‘none’;
}
}

/* ─────────────────────────────────────────────────────
HEADER STATUS
───────────────────────────────────────────────────── */
function updateHeaderStatus() {
const name = settings.name || state.employee.name || ‘’;
document.getElementById(‘greeting-text’).textContent =
name ? ‘Hello, ’ + name.split(’ ’)[0] : ‘Timesheet Portal’;

const strip = document.getElementById(‘fortnight-strip’);
const badge = document.getElementById(‘fortnight-badge’);
if (state.employee.fortnightFrom && state.employee.fortnightTo) {
badge.textContent = fmtDate(state.employee.fortnightFrom) + ’ – ’ + fmtDate(state.employee.fortnightTo);
strip.classList.remove(‘hidden’);
} else {
strip.classList.add(‘hidden’);
}
setTimeout(setContentMargin, 30);
}

/* ─────────────────────────────────────────────────────
LOADING OVERLAY
───────────────────────────────────────────────────── */
function showLoading(txt = ‘Please wait…’) {
document.getElementById(‘loading-text’).textContent = txt;
document.getElementById(‘loading-overlay’).classList.remove(‘hidden’);
}
function setLoadingText(txt) { document.getElementById(‘loading-text’).textContent = txt; }
function hideLoading()       { document.getElementById(‘loading-overlay’).classList.add(‘hidden’); }

/* ─────────────────────────────────────────────────────
TOAST
───────────────────────────────────────────────────── */
let _toastTimer;
function showToast(msg, type = ‘’) {
const t = document.getElementById(‘toast’);
t.textContent = msg;
t.className = ‘toast’ + (type ? ’ ’ + type : ‘’);
t.classList.remove(‘hidden’);
clearTimeout(_toastTimer);
_toastTimer = setTimeout(() => t.classList.add(‘hidden’), 3500);
}

/* ─────────────────────────────────────────────────────
UTILITIES
───────────────────────────────────────────────────── */
function fmtDate(iso) {
if (!iso) return ‘—’;
const [y,m,d] = iso.split(’-’);
if (!y||!m||!d) return iso;
return `${d}/${m}/${y}`;
}

function parseLocalDate(iso) {
const [y,m,d] = iso.split(’-’).map(Number);
return new Date(y, m-1, d);
}

function toISO(d) {
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function typeLabel(val) {
return { work:‘Work’, annual:‘Annual Leave’, sick:‘Sick Leave’,
ph:‘Public Holiday’, rdo:‘RDO / Day Off’, other:‘Other’ }[val] || val;
}

function escHtml(s) {
if (!s) return ‘’;
return s.replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’)
.replace(/”/g,’"’).replace(/’/g,’'’);
}

/* ─────────────────────────────────────────────────────
INIT
───────────────────────────────────────────────────── */
async function init() {
loadSettings();

const nf = document.getElementById(‘employee-name’);
if (settings.name && !nf.value) nf.value = settings.name;
if (settings.emailTo) document.getElementById(‘email-to’).value = settings.emailTo;
if (settings.emailCc) document.getElementById(‘email-cc’).value = settings.emailCc;

const today = toISO(new Date());
document.getElementById(‘exp-date’).value = today;
document.getElementById(‘mil-date’).value = today;

// Check if a last submission exists — show “Load Last” button if so
try {
const last = await dbGet(‘submissions’, ‘last’);
const btn  = document.getElementById(‘load-last-btn’);
if (last && btn) {
const when = new Date(last.submittedAt).toLocaleDateString(‘en-AU’);
btn.textContent = `📂 Load Last Submission (${when})`;
btn.style.display = ‘block’;
}
} catch {}

await loadDraft();
checkReminder();
renderExpenses(); renderMileage(); renderAllowances();

setContentMargin();
window.addEventListener(‘resize’, setContentMargin);
updateHeaderStatus();

if (!settings.name && !settings.emailTo) {
setTimeout(() => showToast(‘👋 Welcome! Open ⚙️ Settings to get started’, ‘success’), 900);
}

console.log(‘VB Built FieldSheet v4 ✅’);
}

document.addEventListener(‘DOMContentLoaded’, init);