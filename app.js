/* =====================================================
VB BUILT FIELDSHEET — app.js  (clean rebuild)

Architecture principles:

1. init() is 100% synchronous — UI works immediately
1. IndexedDB for large data (receipts), localStorage for settings
1. Pages shown/hidden with display:block/none — simple and reliable
1. Header height measured and applied immediately on DOMContentLoaded
- re-measured on resize and after any banner shows/hides
  ===================================================== */

‘use strict’;

/* ─── STATE ─────────────────────────────────────── */
var state = {
emp:        { name: ‘’, fnFrom: ‘’, fnTo: ‘’ },
days:       [],   // [{date, dayName, hours, type, note}]
expenses:   [],   // [{id, type, amount, date, desc, receiptName, receiptData, receiptType}]
mileage:    [],   // [{id, date, from, to, km, rate, total}]
allowances: []    // [{id, type, amount, notes}]
};

var cfg = {
name: ‘’, emailTo: ‘’, emailCc: ‘’,
ejsKey: ‘’, ejsSvc: ‘’, ejsTpl: ‘’,
reminders: true,
lastFnEnd: ‘’
};

/* ─── INDEXEDDB ──────────────────────────────────── */
var _db = null;

function openDB(cb) {
if (_db) { cb(_db); return; }
var req = indexedDB.open(‘fieldsheet’, 1);
req.onupgradeneeded = function(e) {
var d = e.target.result;
if (!d.objectStoreNames.contains(‘store’)) {
d.createObjectStore(‘store’, { keyPath: ‘k’ });
}
};
req.onsuccess = function(e) { _db = e.target.result; cb(_db); };
req.onerror   = function()  { cb(null); };
}

function dbSet(key, val) {
openDB(function(d) {
if (!d) return;
var tx = d.transaction(‘store’, ‘readwrite’);
tx.objectStore(‘store’).put({ k: key, v: val });
});
}

function dbGet(key, cb) {
openDB(function(d) {
if (!d) { cb(null); return; }
var tx  = d.transaction(‘store’, ‘readonly’);
var req = tx.objectStore(‘store’).get(key);
req.onsuccess = function(e) { cb(e.target.result ? e.target.result.v : null); };
req.onerror   = function()  { cb(null); };
});
}

function dbDel(key) {
openDB(function(d) {
if (!d) return;
var tx = d.transaction(‘store’, ‘readwrite’);
tx.objectStore(‘store’).delete(key);
});
}

/* ─── HEADER HEIGHT → CONTENT MARGIN ────────────────
This is the fix for buttons not working.
The fixed header covers the top of the page.
We measure its height and push the content down.
─────────────────────────────────────────────────── */
function fixMargin() {
var hdr = document.getElementById(‘header’);
var con = document.getElementById(‘content’);
if (!hdr || !con) return;
var h = hdr.getBoundingClientRect().height;
if (h > 0) con.style.marginTop = Math.ceil(h) + ‘px’;
}

/* ─── SERVICE WORKER ─────────────────────────────── */
if (‘serviceWorker’ in navigator) {
navigator.serviceWorker.register(‘sw.js’).then(function(reg) {
reg.update();
reg.addEventListener(‘updatefound’, function() {
var w = reg.installing;
w.addEventListener(‘statechange’, function() {
if (w.state === ‘installed’ && navigator.serviceWorker.controller) {
show(‘update-banner’);
fixMargin();
}
});
});
});
}

function applyUpdate() {
if (navigator.serviceWorker.controller) {
navigator.serviceWorker.controller.postMessage({ action: ‘skipWaiting’ });
}
location.reload();
}

/* ─── TAB SWITCHING ──────────────────────────────── */
function showTab(n) {
/* Hide all pages */
for (var i = 1; i <= 5; i++) {
var p = document.getElementById(‘page-’ + i);
var b = document.getElementById(‘tab-btn-’ + i);
if (p) p.style.display = ‘none’;
if (b) { b.classList.remove(‘active’); }
}
/* Show selected page */
var page = document.getElementById(‘page-’ + n);
var btn  = document.getElementById(‘tab-btn-’ + n);
if (page) page.style.display = ‘block’;
if (btn)  btn.classList.add(‘active’);
window.scrollTo({ top: 0, behavior: ‘smooth’ });
}

/* ─── DATE HELPERS ───────────────────────────────── */
function localDate(iso) {
/* Parse YYYY-MM-DD as LOCAL time (avoids UTC shift) */
var p = iso.split(’-’);
return new Date(+p[0], +p[1] - 1, +p[2]);
}

function isoDate(d) {
var y = d.getFullYear();
var m = String(d.getMonth() + 1).padStart(2, ‘0’);
var day = String(d.getDate()).padStart(2, ‘0’);
return y + ‘-’ + m + ‘-’ + day;
}

function auDate(iso) {
if (!iso) return ‘—’;
var p = iso.split(’-’);
if (p.length !== 3) return iso;
return p[2] + ‘/’ + p[1] + ‘/’ + p[0];
}

function todayISO() { return isoDate(new Date()); }

/* ─── FORTNIGHT DATE PICKER ──────────────────────── */
function onStartChange() {
var inp = document.getElementById(‘fn-start’);
if (!inp.value) return;

var d   = localDate(inp.value);
var dow = d.getDay(); /* 0=Sun, 1=Mon … 6=Sat */

if (dow !== 1) {
/* Snap to nearest Monday */
d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
inp.value = isoDate(d);
toast(’📅 Snapped to Monday ’ + auDate(inp.value), ‘ok’);
}

var end = new Date(d);
end.setDate(d.getDate() + 13); /* +13 = 14-day fortnight */

state.emp.fnFrom = inp.value;
state.emp.fnTo   = isoDate(end);

document.getElementById(‘fn-end-display’).textContent =
auDate(state.emp.fnTo) + ’ (Sunday)’;

updateHeader();
buildDays();
}

function nextFnStart(lastEndISO) {
var d = localDate(lastEndISO);
d.setDate(d.getDate() + 1); /* Monday after last Sunday */
return isoDate(d);
}

/* ─── BUILD DAILY ROWS ───────────────────────────── */
var TYPE_LABELS = {
work:   ‘Work’,
annual: ‘Annual Leave’,
sick:   ‘Sick Leave’,
ph:     ‘Public Holiday’,
rdo:    ‘RDO / Day Off’,
other:  ‘Other’
};

var DAY_NAMES = [‘Sun’,‘Mon’,‘Tue’,‘Wed’,‘Thu’,‘Fri’,‘Sat’];

function buildDays() {
if (!state.emp.fnFrom || !state.emp.fnTo) return;

var container = document.getElementById(‘day-rows’);
container.innerHTML = ‘’;

var cur = localDate(state.emp.fnFrom);
var end = localDate(state.emp.fnTo);

while (cur <= end) {
var iso     = isoDate(cur);
var dn      = DAY_NAMES[cur.getDay()];
var weekend = (cur.getDay() === 0 || cur.getDay() === 6);

```
/* Restore saved values if available */
var saved = null;
for (var i = 0; i < state.days.length; i++) {
  if (state.days[i].date === iso) { saved = state.days[i]; break; }
}
var defType = saved ? saved.type  : (weekend ? 'rdo' : 'work');
var defHrs  = saved ? (saved.hours || '') : '';
var defNote = saved ? (saved.note  || '') : '';

var row = document.createElement('div');
row.className = 'day-row' + (weekend ? ' weekend' : '') + (defHrs ? ' has-hrs' : '');
row.id = 'row-' + iso;

row.innerHTML =
  '<div class="day-top">' +
    '<span class="day-name">' + dn + '</span>' +
    '<span class="day-date">' + auDate(iso) + '</span>' +
    (weekend ? '<span class="day-wktag">Weekend</span>' : '') +
  '</div>' +
  '<div class="day-inputs">' +
    '<select class="day-sel" id="ds-' + iso + '" data-t="' + defType + '" ' +
            'onchange="onTypeChange(\'' + iso + '\',this)">' +
      buildTypeOpts(defType) +
    '</select>' +
    '<input type="number" class="day-hrs" id="dh-' + iso + '" ' +
           'placeholder="0" min="0" max="24" step="0.5" inputmode="decimal" ' +
           'value="' + defHrs + '" ' +
           'oninput="onHrsChange(\'' + iso + '\')" />' +
    '<input type="text" class="day-note" id="dn-' + iso + '" ' +
           'placeholder="Job / notes" ' +
           'value="' + esc(defNote) + '" />' +
  '</div>';

container.appendChild(row);
cur.setDate(cur.getDate() + 1);
```

}

show(‘hours-card’);
calcTotals();
}

function buildTypeOpts(sel) {
var opts = [‘work’,‘annual’,‘sick’,‘ph’,‘rdo’,‘other’];
return opts.map(function(v) {
return ‘<option value=”’ + v + ‘”’ + (v === sel ? ’ selected’ : ‘’) + ‘>’ + TYPE_LABELS[v] + ‘</option>’;
}).join(’’);
}

function onTypeChange(iso, sel) {
sel.dataset.t = sel.value;
var hInput = document.getElementById(‘dh-’ + iso);
if ([‘annual’,‘sick’,‘ph’].indexOf(sel.value) !== -1 && !hInput.value) {
hInput.value = ‘7.6’;
document.getElementById(‘row-’ + iso).classList.add(‘has-hrs’);
}
if (sel.value === ‘rdo’) {
hInput.value = ‘’;
document.getElementById(‘row-’ + iso).classList.remove(‘has-hrs’);
}
calcTotals();
}

function onHrsChange(iso) {
var val = parseFloat(document.getElementById(‘dh-’ + iso).value) || 0;
document.getElementById(‘row-’ + iso).classList.toggle(‘has-hrs’, val > 0);
calcTotals();
}

function calcTotals() {
var totals = { work:0, annual:0, sick:0, ph:0, rdo:0, other:0 };
var total  = 0;

document.querySelectorAll(’.day-row’).forEach(function(row) {
var iso  = row.id.replace(‘row-’, ‘’);
var hrs  = parseFloat(document.getElementById(‘dh-’ + iso).value) || 0;
var type = document.getElementById(‘ds-’ + iso).value;
if (hrs > 0) { totals[type] = (totals[type] || 0) + hrs; total += hrs; }
});

var el = document.getElementById(‘hrs-totals’);
if (!el) return;

var cols = [
{ lbl:‘Total’, val:total,          cls:‘amber’  },
{ lbl:‘Work’,  val:totals.work,    cls:’’       },
{ lbl:‘Ann.Lv’,val:totals.annual,  cls:‘green’  },
{ lbl:‘Sick’,  val:totals.sick,    cls:‘red’    },
{ lbl:‘PH’,    val:totals.ph,      cls:‘yellow’ },
{ lbl:‘Other’, val:totals.rdo+totals.other, cls:‘purple’ }
].filter(function(c) { return c.lbl === ‘Total’ || c.val > 0; });

el.innerHTML = cols.map(function(c) {
return ‘<div class="ht-item">’ +
‘<span class="ht-lbl">’ + c.lbl + ‘</span>’ +
‘<span class="ht-val ' + c.cls + '">’ + c.val.toFixed(1) + ‘</span>’ +
‘</div>’;
}).join(’’);
}

/* ─── QUICK FILL ─────────────────────────────────── */
function qfApplyHours() {
var hrs = document.getElementById(‘qf-hrs’).value;
var typ = document.getElementById(‘qf-type’).value;
if (!hrs || parseFloat(hrs) <= 0) { toast(‘Enter hours first’, ‘err’); return; }

var count = 0;
document.querySelectorAll(’.day-row:not(.weekend)’).forEach(function(row) {
var iso = row.id.replace(‘row-’, ‘’);
var hI  = document.getElementById(‘dh-’ + iso);
var tS  = document.getElementById(‘ds-’ + iso);
if (hI) { hI.value = hrs; row.classList.add(‘has-hrs’); count++; }
if (tS) { tS.value = typ; tS.dataset.t = typ; }
});
calcTotals();
toast(‘✅ Applied to ’ + count + ’ weekdays’, ‘ok’);
}

function qfApplyJob() {
var val = document.getElementById(‘qf-job’).value.trim();
if (!val) { toast(‘Enter a job ref first’, ‘err’); return; }
var count = 0;
document.querySelectorAll(’.day-note’).forEach(function(inp) {
inp.value = val; count++;
});
toast(‘✅ Job ref copied to ’ + count + ’ rows’, ‘ok’);
}

/* ─── COLLECT FORM DATA ──────────────────────────── */
function collect() {
state.emp.name   = document.getElementById(‘emp-name’).value.trim();
state.emp.fnFrom = document.getElementById(‘fn-start’).value;

state.days = [];
document.querySelectorAll(’.day-row’).forEach(function(row) {
var iso  = row.id.replace(‘row-’, ‘’);
var hrs  = parseFloat(document.getElementById(‘dh-’ + iso).value) || 0;
var type = document.getElementById(‘ds-’ + iso).value;
var note = document.getElementById(‘dn-’ + iso).value;
var dn   = row.querySelector(’.day-name’) ? row.querySelector(’.day-name’).textContent : ‘’;
state.days.push({ date:iso, dayName:dn, hours:hrs, type:type, note:note });
});
}

/* ─── SAVE / LOAD DRAFT ──────────────────────────── */
function saveProgress() {
collect();
dbSet(‘draft’, {
state:   state,
emailTo: document.getElementById(‘email-to’).value,
emailCc: document.getElementById(‘email-cc’).value,
at:      new Date().toISOString()
});
toast(‘✅ Draft saved’, ‘ok’);
}

function loadDraft() {
dbGet(‘draft’, function(data) {
if (!data || !data.state) return;
state = data.state;

```
document.getElementById('emp-name').value  = state.emp.name  || '';
document.getElementById('fn-start').value  = state.emp.fnFrom || '';
if (data.emailTo) document.getElementById('email-to').value = data.emailTo;
if (data.emailCc) document.getElementById('email-cc').value = data.emailCc;

if (state.emp.fnFrom && state.emp.fnTo) {
  document.getElementById('fn-end-display').textContent =
    auDate(state.emp.fnTo) + ' (Sunday)';
  buildDays();
}

renderExpenses();
renderMileage();
renderAllowances();
updateHeader();

var when = new Date(data.at).toLocaleString('en-AU', { timeStyle:'short', dateStyle:'short' });
toast('📂 Draft restored (' + when + ')', 'ok');
```

});
}

function clearDraft() { dbDel(‘draft’); }

/* ─── LAST SUBMISSION ────────────────────────────── */
function saveSubmission(pdfBlob, filename) {
blobToB64(pdfBlob, function(b64) {
dbSet(‘last’, {
state:    JSON.parse(JSON.stringify(state)),
pdfB64:   b64,
pdfName:  filename,
at:       new Date().toISOString()
});
});
}

function loadLastSubmission() {
dbGet(‘last’, function(data) {
if (!data) { toast(‘No previous submission found’, ‘err’); return; }
state = data.state;

```
document.getElementById('emp-name').value = state.emp.name || '';
document.getElementById('fn-start').value = state.emp.fnFrom || '';

if (state.emp.fnFrom && state.emp.fnTo) {
  document.getElementById('fn-end-display').textContent =
    auDate(state.emp.fnTo) + ' (Sunday)';
  buildDays();
}
renderExpenses();
renderMileage();
renderAllowances();
updateHeader();
showTab(1);

var when = new Date(data.at).toLocaleString('en-AU', { timeStyle:'short', dateStyle:'short' });
toast('📂 Last submission loaded (' + when + ')', 'ok');
```

});
}

/* ─── IMAGE COMPRESSION ──────────────────────────── */
function compressImage(file, cb) {
if (!file.type.startsWith(‘image/’)) {
var r = new FileReader();
r.onload = function(e) { cb({ data: e.target.result, type: file.type }); };
r.readAsDataURL(file);
return;
}
var img = new Image();
var url = URL.createObjectURL(file);
img.onload = function() {
URL.revokeObjectURL(url);
var maxW = 1200;
var w = img.naturalWidth, h = img.naturalHeight;
if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
var canvas = document.createElement(‘canvas’);
canvas.width = w; canvas.height = h;
canvas.getContext(‘2d’).drawImage(img, 0, 0, w, h);
cb({ data: canvas.toDataURL(‘image/jpeg’, 0.75), type: ‘image/jpeg’ });
};
img.onerror = function() {
var r = new FileReader();
r.onload = function(e) { cb({ data: e.target.result, type: file.type }); };
r.readAsDataURL(file);
};
img.src = url;
}

function onReceiptPicked(input) {
var file = input.files[0];
if (!file) return;
var txt  = document.getElementById(‘receipt-txt’);
var hint = document.getElementById(‘receipt-hint’);
txt.textContent = ‘⏳ Processing…’;
compressImage(file, function(r) {
txt.textContent = ’✅ ’ + file.name;
document.getElementById(‘receipt-lbl’).classList.add(‘has-file’);
var kb = Math.round(file.size / 1024);
hint.textContent = ‘Size: ~’ + kb + ’ KB’;
});
}

/* ─── EXPENSES ───────────────────────────────────── */
function addExpense() {
var type   = document.getElementById(‘exp-type’).value;
var amount = parseFloat(document.getElementById(‘exp-amount’).value);
var date   = document.getElementById(‘exp-date’).value;
var desc   = document.getElementById(‘exp-desc’).value.trim();
var file   = document.getElementById(‘exp-receipt’).files[0];

if (!type)         { toast(‘Select a type’, ‘err’); return; }
if (!amount||amount<=0) { toast(‘Enter a valid amount’, ‘err’); return; }
if (!date)         { toast(‘Select a date’, ‘err’); return; }
if (!file)         { toast(‘Receipt photo required’, ‘err’); return; }

var btn = document.querySelector(’#page-2 .add-box .btn-navy’);
btn.disabled = true; btn.textContent = ‘⏳ Processing…’;

compressImage(file, function(compressed) {
state.expenses.push({
id:          Date.now(),
type:        type,
amount:      amount,
date:        date,
desc:        desc,
receiptName: file.name,
receiptData: compressed.data,
receiptType: compressed.type
});
renderExpenses();
clearExpForm();
toast(‘✅ Expense added’, ‘ok’);
btn.disabled = false; btn.textContent = ‘Add Expense’;
});
}

function renderExpenses() {
var el = document.getElementById(‘exp-list’);
if (!state.expenses.length) {
el.innerHTML = ‘<div class="empty">No expenses added yet</div>’;
return;
}
el.innerHTML = state.expenses.map(function(e, i) {
return ‘<div class="item-card">’ +
‘<div class="item-main">’ +
‘<div class="item-type">’ + esc(e.type) + ‘</div>’ +
‘<div class="item-meta">’ + auDate(e.date) + (e.desc ? ’ · ’ + esc(e.desc) : ‘’) + ‘</div>’ +
‘<div class="item-receipt">📎 ’ + esc(e.receiptName) + ‘</div>’ +
‘</div>’ +
‘<div class="item-side">’ +
‘<div class="item-amt">$’ + e.amount.toFixed(2) + ‘</div>’ +
‘<button class="item-del" onclick="delExpense(' + i + ')">✕</button>’ +
‘</div>’ +
‘</div>’;
}).join(’’);
}

function delExpense(i) { state.expenses.splice(i, 1); renderExpenses(); }

function clearExpForm() {
document.getElementById(‘exp-type’).value   = ‘’;
document.getElementById(‘exp-amount’).value = ‘’;
document.getElementById(‘exp-date’).value   = todayISO();
document.getElementById(‘exp-desc’).value   = ‘’;
document.getElementById(‘exp-receipt’).value = ‘’;
document.getElementById(‘receipt-txt’).textContent = ‘Tap to photograph or upload’;
document.getElementById(‘receipt-lbl’).classList.remove(‘has-file’);
document.getElementById(‘receipt-hint’).textContent = ‘’;
}

/* ─── MILEAGE ────────────────────────────────────── */
function calcMil() {
var km   = parseFloat(document.getElementById(‘mil-km’).value)   || 0;
var rate = parseFloat(document.getElementById(‘mil-rate’).value) || 0;
document.getElementById(‘mil-total’).textContent = ‘$’ + (km * rate).toFixed(2);
}

function addMileage() {
var date = document.getElementById(‘mil-date’).value;
var from = document.getElementById(‘mil-from’).value.trim();
var to   = document.getElementById(‘mil-to’).value.trim();
var km   = parseFloat(document.getElementById(‘mil-km’).value);
var rate = parseFloat(document.getElementById(‘mil-rate’).value) || 0;

if (!date)         { toast(‘Select a date’, ‘err’); return; }
if (!from)         { toast(‘Enter a From location’, ‘err’); return; }
if (!to)           { toast(‘Enter a To location’, ‘err’); return; }
if (!km || km <= 0){ toast(‘Enter a valid distance’, ‘err’); return; }

state.mileage.push({ id:Date.now(), date:date, from:from, to:to, km:km, rate:rate, total:km*rate });
renderMileage();
clearMilForm();
toast(‘✅ Trip added’, ‘ok’);
}

function renderMileage() {
var el = document.getElementById(‘mil-list’);
if (!state.mileage.length) {
el.innerHTML = ‘<div class="empty">No trips added yet</div>’;
return;
}
el.innerHTML = state.mileage.map(function(m, i) {
return ‘<div class="item-card">’ +
‘<div class="item-main">’ +
‘<div class="item-type">’ + esc(m.from) + ’ → ’ + esc(m.to) + ‘</div>’ +
‘<div class="item-meta">’ + auDate(m.date) + ’ · ’ + m.km + ’ km @ $’ + m.rate.toFixed(2) + ‘/km</div>’ +
‘</div>’ +
‘<div class="item-side">’ +
‘<div class="item-amt">$’ + m.total.toFixed(2) + ‘</div>’ +
‘<button class="item-del" onclick="delMileage(' + i + ')">✕</button>’ +
‘</div>’ +
‘</div>’;
}).join(’’);
}

function delMileage(i) { state.mileage.splice(i, 1); renderMileage(); }

function clearMilForm() {
document.getElementById(‘mil-date’).value = todayISO();
document.getElementById(‘mil-from’).value = ‘’;
document.getElementById(‘mil-to’).value   = ‘’;
document.getElementById(‘mil-km’).value   = ‘’;
document.getElementById(‘mil-rate’).value = ‘0.88’;
document.getElementById(‘mil-total’).textContent = ‘$0.00’;
}

/* ─── ALLOWANCES ─────────────────────────────────── */
function addAllowance() {
var type   = document.getElementById(‘all-type’).value;
var amount = parseFloat(document.getElementById(‘all-amount’).value);
var notes  = document.getElementById(‘all-notes’).value.trim();

if (!type)          { toast(‘Select a type’, ‘err’); return; }
if (!amount||amount<=0){ toast(‘Enter a valid amount’, ‘err’); return; }

state.allowances.push({ id:Date.now(), type:type, amount:amount, notes:notes });
renderAllowances();
clearAllForm();
toast(‘✅ Allowance added’, ‘ok’);
}

function renderAllowances() {
var el = document.getElementById(‘all-list’);
if (!state.allowances.length) {
el.innerHTML = ‘<div class="empty">No allowances added yet</div>’;
return;
}
el.innerHTML = state.allowances.map(function(a, i) {
return ‘<div class="item-card">’ +
‘<div class="item-main">’ +
‘<div class="item-type">’ + esc(a.type) + ‘</div>’ +
‘<div class="item-meta">’ + (a.notes || ‘No notes’) + ‘</div>’ +
‘</div>’ +
‘<div class="item-side">’ +
‘<div class="item-amt">$’ + a.amount.toFixed(2) + ‘</div>’ +
‘<button class="item-del" onclick="delAllowance(' + i + ')">✕</button>’ +
‘</div>’ +
‘</div>’;
}).join(’’);
}

function delAllowance(i) { state.allowances.splice(i, 1); renderAllowances(); }

function clearAllForm() {
document.getElementById(‘all-type’).value   = ‘’;
document.getElementById(‘all-amount’).value = ‘’;
document.getElementById(‘all-notes’).value  = ‘’;
}

/* ─── BUILD REVIEW ───────────────────────────────── */
function buildReview() {
collect();

var expTotal = state.expenses.reduce(function(s,e)  { return s + e.amount; }, 0);
var milTotal = state.mileage.reduce(function(s,m)   { return s + m.total;  }, 0);
var allTotal = state.allowances.reduce(function(s,a){ return s + a.amount; }, 0);
var grand    = expTotal + milTotal + allTotal;

var hByType = {};
var totalHrs = 0;
state.days.forEach(function(d) {
if (d.hours > 0) {
hByType[d.type] = (hByType[d.type] || 0) + d.hours;
totalHrs += d.hours;
}
});

var html = ‘<div class="rv-block">’ +
‘<div class="rv-head">Employee</div>’ +
rvRow(‘Name’, esc(state.emp.name) || ‘—’) +
rvRow(‘Fortnight’, auDate(state.emp.fnFrom) + ’ – ’ + auDate(state.emp.fnTo)) +
‘</div>’;

html += ‘<div class="rv-block"><div class="rv-head">Hours — ’ + totalHrs.toFixed(1) + ’ total</div>’;
Object.keys(hByType).forEach(function(k) {
html += rvRow(TYPE_LABELS[k] || k, hByType[k].toFixed(1) + ’ hrs’);
});
html += ‘</div>’;

if (state.expenses.length) {
html += ‘<div class="rv-block"><div class="rv-head">Expenses (’ + state.expenses.length + ‘)</div>’;
state.expenses.forEach(function(e) { html += rvRow(esc(e.type), ‘$’ + e.amount.toFixed(2)); });
html += rvRow(’<strong>Subtotal</strong>’, ‘<strong>$’ + expTotal.toFixed(2) + ‘</strong>’);
html += ‘</div>’;
}

if (state.mileage.length) {
html += ‘<div class="rv-block"><div class="rv-head">Mileage (’ + state.mileage.length + ‘)</div>’;
state.mileage.forEach(function(m) { html += rvRow(esc(m.from) + ’ → ’ + esc(m.to), ‘$’ + m.total.toFixed(2)); });
html += rvRow(’<strong>Subtotal</strong>’, ‘<strong>$’ + milTotal.toFixed(2) + ‘</strong>’);
html += ‘</div>’;
}

if (state.allowances.length) {
html += ‘<div class="rv-block"><div class="rv-head">Allowances</div>’;
state.allowances.forEach(function(a) { html += rvRow(esc(a.type), ‘$’ + a.amount.toFixed(2)); });
html += rvRow(’<strong>Subtotal</strong>’, ‘<strong>$’ + allTotal.toFixed(2) + ‘</strong>’);
html += ‘</div>’;
}

html += ‘<div class="rv-grand">’ +
‘<span class="rv-grand-lbl">💰 Grand Total</span>’ +
‘<span class="rv-grand-amt">$’ + grand.toFixed(2) + ‘</span>’ +
‘</div>’;

document.getElementById(‘review-content’).innerHTML = html;

/* Show/hide email method */
var hasEJS = cfg.ejsKey && cfg.ejsSvc && cfg.ejsTpl;
document.getElementById(‘ejs-block’).style.display    = hasEJS ? ‘block’ : ‘none’;
document.getElementById(‘manual-block’).style.display = hasEJS ? ‘none’  : ‘block’;
document.getElementById(‘submit-note’).style.display  = hasEJS ? ‘none’  : ‘block’;
if (hasEJS) document.getElementById(‘ejs-to’).textContent = cfg.emailTo || ‘—’;

document.getElementById(‘email-to’).value = cfg.emailTo || ‘’;
document.getElementById(‘email-cc’).value = cfg.emailCc || ‘’;
}

function rvRow(k, v) {
return ‘<div class="rv-row"><span class="rv-k">’ + k + ‘</span><span class="rv-v">’ + v + ‘</span></div>’;
}

/* ─── VALIDATE ───────────────────────────────────── */
function validate() {
collect();
if (!state.emp.name)   { toast(‘Enter your name’, ‘err’);           showTab(1); return false; }
if (!state.emp.fnFrom) { toast(‘Select a fortnight start’, ‘err’);  showTab(1); return false; }
var hasEJS = cfg.ejsKey && cfg.ejsSvc && cfg.ejsTpl;
if (!hasEJS) {
var et = document.getElementById(‘email-to’).value;
if (!et || et.indexOf(’@’) < 0) { toast(‘Enter a valid email’, ‘err’); showTab(5); return false; }
}
return true;
}

/* ─── SUBMIT ─────────────────────────────────────── */
function submitForm() {
if (!validate()) return;

var btn = document.getElementById(‘submit-btn’);
btn.disabled = true;
btn.textContent = ‘⏳ Generating PDF…’;
setLoading(‘Generating PDF…’);

/* Small delay so the loading screen renders before heavy PDF work */
setTimeout(function() {
try {
var result = makePDF();
var filename = makeFilename();
var hasEJS = cfg.ejsKey && cfg.ejsSvc && cfg.ejsTpl;

```
  saveSubmission(result.blob, filename);

  if (hasEJS) {
    setLoading('Sending email…');
    blobToB64(result.blob, function(b64) {
      sendEmail(b64, filename,
        function() {
          hideLoading();
          sharePDF(result.doc, result.blob, filename);
          showSuccess(filename, true);
          cfg.lastFnEnd = state.emp.fnTo;
          saveCfg(true);
          clearDraft();
          btn.disabled = false; btn.textContent = '🚀 Submit Timesheet';
        },
        function(err) {
          hideLoading();
          toast('EmailJS error: ' + err, 'err');
          btn.disabled = false; btn.textContent = '🚀 Submit Timesheet';
        }
      );
    });
  } else {
    hideLoading();
    sharePDF(result.doc, result.blob, filename);
    setTimeout(function() { openMail(filename); }, 800);
    showSuccess(filename, false);
    cfg.lastFnEnd = state.emp.fnTo;
    saveCfg(true);
    clearDraft();
    btn.disabled = false; btn.textContent = '🚀 Submit Timesheet';
  }
} catch(e) {
  hideLoading();
  toast('Error: ' + e.message, 'err');
  btn.disabled = false; btn.textContent = '🚀 Submit Timesheet';
}
```

}, 80);
}

/* ─── PDF SHARING (iOS fix) ──────────────────────── */
function sharePDF(doc, blob, filename) {
/* Try Web Share API with file (iOS 15+) */
if (navigator.share && navigator.canShare) {
var file = new File([blob], filename, { type: ‘application/pdf’ });
if (navigator.canShare({ files: [file] })) {
navigator.share({ files:[file], title:‘Timesheet Submission’, text:’VB Built FieldSheet — ’ + state.emp.name })
.catch(function(e) {
if (e.name !== ‘AbortError’) doc.save(filename);
});
return;
}
}
/* Fallback: jsPDF .save() — triggers iOS Save to Files */
doc.save(filename);
}

/* ─── SUCCESS / NEXT FORTNIGHT ───────────────────── */
function showSuccess(filename, autoSent) {
var msg = autoSent
? ’Sent automatically to ’ + cfg.emailTo
: ‘PDF saved to your device. Attach it in your email app.’;
document.getElementById(‘success-msg’).textContent = msg;
document.getElementById(‘success-file’).textContent = filename;

var ns  = nextFnStart(state.emp.fnTo);
var ned = localDate(ns);
ned.setDate(ned.getDate() + 13);
document.getElementById(‘success-next’).innerHTML =
‘<strong>Next fortnight:</strong><br>’ + auDate(ns) + ’ → ’ + auDate(isoDate(ned));

document.getElementById(‘success-overlay’).style.display = ‘flex’;
}

function closeSuccess() {
document.getElementById(‘success-overlay’).style.display = ‘none’;
}

function nextFortnight() {
var ns = cfg.lastFnEnd ? nextFnStart(cfg.lastFnEnd) : ‘’;

state = { emp:{ name:cfg.name||’’, fnFrom:ns, fnTo:’’ }, days:[], expenses:[], mileage:[], allowances:[] };

document.getElementById(‘emp-name’).value = cfg.name || ‘’;
document.getElementById(‘fn-start’).value = ns;
document.getElementById(‘day-rows’).innerHTML = ‘’;
hide(‘hours-card’);
document.getElementById(‘fn-end-display’).textContent = ‘Select a start date above’;

if (ns) {
var end = localDate(ns);
end.setDate(end.getDate() + 13);
state.emp.fnTo = isoDate(end);
document.getElementById(‘fn-end-display’).textContent = auDate(state.emp.fnTo) + ’ (Sunday)’;
buildDays();
toast(’📅 Next fortnight loaded: ’ + auDate(ns), ‘ok’);
}

renderExpenses(); renderMileage(); renderAllowances();
closeSuccess();
showTab(1);
updateHeader();
}

/* ─── EMAILJS ────────────────────────────────────── */
function sendEmail(pdfB64, filename, onOk, onErr) {
var expTotal = state.expenses.reduce(function(s,e)  { return s + e.amount; }, 0);
var milTotal = state.mileage.reduce(function(s,m)   { return s + m.total;  }, 0);
var allTotal = state.allowances.reduce(function(s,a){ return s + a.amount; }, 0);
var grand    = expTotal + milTotal + allTotal;
var totalHrs = state.days.reduce(function(s,d) { return s + d.hours; }, 0);

emailjs.init(cfg.ejsKey);
emailjs.send(cfg.ejsSvc, cfg.ejsTpl, {
to_email:      cfg.emailTo,
cc_email:      cfg.emailCc,
subject:       ’Timesheet — ’ + state.emp.name + ’ — ’ + auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo),
employee_name: state.emp.name,
fortnight:     auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo),
total_hours:   totalHrs.toFixed(1),
grand_total:   ‘$’ + grand.toFixed(2),
pdf_name:      filename,
pdf_data:      pdfB64,
message:       ’Timesheet for ’ + state.emp.name + ‘\n’ +
’Fortnight: ’ + auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo) + ‘\n’ +
’Total Hours: ’ + totalHrs.toFixed(1) + ‘\n’ +
‘Expenses: $’ + expTotal.toFixed(2) + ‘\n’ +
‘Mileage: $’ + milTotal.toFixed(2) + ‘\n’ +
‘Allowances: $’ + allTotal.toFixed(2) + ‘\n’ +
‘Grand Total: $’ + grand.toFixed(2)
}).then(function(r) {
if (r.status === 200) onOk(); else onErr(’status ’ + r.status);
}).catch(function(e) { onErr(e.text || String(e)); });
}

/* ─── MAILTO FALLBACK ────────────────────────────── */
function openMail(filename) {
var to      = document.getElementById(‘email-to’).value;
var cc      = document.getElementById(‘email-cc’).value;
var name    = state.emp.name || ‘Employee’;
var expT    = state.expenses.reduce(function(s,e)  { return s + e.amount; }, 0);
var milT    = state.mileage.reduce(function(s,m)   { return s + m.total;  }, 0);
var allT    = state.allowances.reduce(function(s,a){ return s + a.amount; }, 0);
var hrs     = state.days.reduce(function(s,d) { return s + d.hours; }, 0);

var subj = encodeURIComponent(’Timesheet & Expenses — ’ + name + ’ — ’ + auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo));
var body = encodeURIComponent(
‘Hi,\n\nPlease find attached my timesheet submission.\n\n’ +
’Employee:    ’ + name + ‘\n’ +
’Fortnight:   ’ + auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo) + ‘\n’ +
‘Hours:       ’ + hrs.toFixed(1) + ’ hrs\n’ +
‘Expenses:    $’ + expT.toFixed(2) + ‘\n’ +
‘Mileage:     $’ + milT.toFixed(2) + ‘\n’ +
‘Allowances:  $’ + allT.toFixed(2) + ‘\n’ +
‘TOTAL:       $’ + (expT+milT+allT).toFixed(2) + ‘\n\n’ +
’Please attach the file: ’ + filename + ‘\n\n’ +
‘Regards,\n’ + name
);

var url = ‘mailto:’ + to + ‘?subject=’ + subj + ‘&body=’ + body;
if (cc) url += ‘&cc=’ + encodeURIComponent(cc);
window.location.href = url;
}

/* ─── PDF GENERATION ─────────────────────────────── */
function makePDF() {
var jsPDF = window.jspdf.jsPDF;
var doc   = new jsPDF({ orientation:‘portrait’, unit:‘mm’, format:‘a4’ });
var W = 210, M = 14, y = M;

var sp  = function(n) { y += (n||5); };
var chk = function() { if (y > 272) { doc.addPage(); y = M; } };

var secHdr = function(label) {
chk();
doc.setFillColor(15,31,53); doc.rect(M, y-4, W-M*2, 8, ‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(label.toUpperCase(), M+3, y);
y += 7;
};

/* Header */
doc.setFillColor(15,31,53); doc.rect(0,0,W,30,‘F’);
doc.setFillColor(245,158,11); doc.rect(0,30,W,3,‘F’);
doc.setFontSize(20); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘VB BUILT — FIELDSHEET’, M, 14);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(138,173,204);
doc.text(’Timesheet & Expense Submission  ·  ’ + new Date().toLocaleString(‘en-AU’), M, 23);
y = 42;

var expT = state.expenses.reduce(function(s,e)  { return s + e.amount; }, 0);
var milT = state.mileage.reduce(function(s,m)   { return s + m.total;  }, 0);
var allT = state.allowances.reduce(function(s,a){ return s + a.amount; }, 0);
var grand = expT + milT + allT;
var totalHrs = state.days.reduce(function(s,d) { return s + d.hours; }, 0);

/* Employee box */
doc.setFillColor(240,244,248); doc.roundedRect(M, y-4, W-M*2, 28, 3, 3, ‘F’);
doc.setFontSize(15); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(state.emp.name || ‘Unknown’, M+4, y+4);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(74,90,110);
doc.text(‘Fortnight: ’ + auDate(state.emp.fnFrom) + ’ to ’ + auDate(state.emp.fnTo), M+4, y+12);
doc.setFontSize(13); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(245,158,11);
doc.text(’$’ + grand.toFixed(2), W-M-4, y+10, {align:‘right’});
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(74,90,110);
doc.text(‘Grand Total’, W-M-4, y+17, {align:‘right’});
doc.text(‘Total Hours: ’ + totalHrs.toFixed(1) + ’ hrs’, W-M-4, y+4, {align:‘right’});
y += 34;

/* Daily hours */
secHdr(‘Daily Hours’);
doc.setFillColor(230,236,244); doc.rect(M, y-3, W-M*2, 7, ‘F’);
doc.setFontSize(8); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(74,90,110);
doc.text(‘Day’, M+2, y+1); doc.text(‘Date’, M+16, y+1);
doc.text(‘Type’, M+48, y+1); doc.text(‘Hrs’, M+95, y+1); doc.text(‘Job / Notes’, M+110, y+1);
y += 10;

state.days.forEach(function(d, i) {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-4,W-M*2,7,‘F’); }
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(15,31,53);
doc.text(d.dayName, M+2, y);
doc.text(auDate(d.date), M+16, y);
doc.text(TYPE_LABELS[d.type] || d.type, M+48, y);
doc.text(d.hours > 0 ? String(d.hours) : ‘—’, M+95, y);
doc.text((d.note||’’).substring(0,45), M+110, y);
y += 7;
});

/* Hours type totals row */
var typeMap = {};
state.days.forEach(function(d) { if(d.hours>0) typeMap[d.type]=(typeMap[d.type]||0)+d.hours; });
chk(); sp(2);
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘TOTAL HOURS’, M+2, y+2);
doc.text(totalHrs.toFixed(1)+’ hrs’, M+95, y+2);
y += 12;

/* Expenses */
if (state.expenses.length) {
secHdr(‘Expenses’);
state.expenses.forEach(function(e, i) {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-4,W-M*2,13,‘F’); }
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(e.type, M+2, y);
doc.setFont(‘helvetica’,‘normal’); doc.setFontSize(8); doc.setTextColor(74,90,110);
doc.text(auDate(e.date)+(e.desc?’  ·  ‘+e.desc:’’), M+2, y+5);
doc.setTextColor(22,163,74); doc.text(‘Receipt: ‘+e.receiptName, M+2, y+9);
doc.setFontSize(11); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(’$’+e.amount.toFixed(2), W-M-2, y, {align:‘right’});
y += 15;
});
chk();
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘EXPENSES TOTAL’, M+2, y+2);
doc.text(’$’+expT.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

/* Mileage */
if (state.mileage.length) {
secHdr(‘Mileage’);
state.mileage.forEach(function(m, i) {
chk();
if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-3,W-M*2,8,‘F’); }
doc.setFontSize(8); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(15,31,53);
doc.text(auDate(m.date), M+2, y);
doc.text(m.from+’ → ‘+m.to, M+24, y);
doc.text(m.km+‘km @ $’+m.rate.toFixed(2), M+120, y);
doc.setFont(‘helvetica’,‘bold’);
doc.text(’$’+m.total.toFixed(2), W-M-2, y, {align:‘right’});
y += 8;
});
chk();
doc.setFillColor(15,31,53); doc.rect(M,y-3,W-M*2,8,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘MILEAGE TOTAL’, M+2, y+2);
doc.text(’$’+milT.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

/* Allowances */
if (state.allowances.length) {
secHdr(‘Allowances’);
state.allowances.forEach(function(a, i) {
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
doc.text(’$’+allT.toFixed(2), W-M-2, y+2, {align:‘right’});
y += 12;
}

/* Grand total */
chk(); sp(4);
doc.setFillColor(245,158,11); doc.rect(M, y-5, W-M*2, 14, ‘F’);
doc.setFontSize(12); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(15,31,53);
doc.text(‘GRAND TOTAL’, M+3, y+4);
doc.text(’$’+grand.toFixed(2), W-M-3, y+4, {align:‘right’});
y += 18;

/* Receipt images */
state.expenses.forEach(function(e) {
if (e.receiptData && e.receiptType && e.receiptType.indexOf(‘image’) === 0) {
doc.addPage(); y = M;
doc.setFillColor(15,31,53); doc.rect(0,0,W,18,‘F’);
doc.setFillColor(245,158,11); doc.rect(0,18,W,2,‘F’);
doc.setFontSize(9); doc.setFont(‘helvetica’,‘bold’); doc.setTextColor(255,255,255);
doc.text(‘RECEIPT: ‘+e.type+’  ·  ‘+auDate(e.date)+’  ·  $’+e.amount.toFixed(2), M, 12);
try {
var fmt = e.receiptType.indexOf(‘png’) >= 0 ? ‘PNG’ : ‘JPEG’;
doc.addImage(e.receiptData, fmt, M, 26, W-M*2, 210);
} catch(err) {
doc.setTextColor(180,0,0); doc.setFontSize(10);
doc.text(’Could not embed: ’+e.receiptName, M, 40);
}
}
});

/* Page footers */
var pages = doc.getNumberOfPages();
for (var p = 1; p <= pages; p++) {
doc.setPage(p);
doc.setFontSize(7); doc.setFont(‘helvetica’,‘normal’); doc.setTextColor(150,150,150);
doc.text(
‘Page ‘+p+’ of ‘+pages+’  ·  ‘+state.emp.name+’  ·  ‘+auDate(state.emp.fnFrom)+’ – ‘+auDate(state.emp.fnTo)+’  ·  VB Built FieldSheet’,
W/2, 292, {align:‘center’}
);
}

return { doc: doc, blob: doc.output(‘blob’) };
}

function makeFilename() {
var name = (state.emp.name || ‘Employee’).replace(/\s+/g, ‘*’);
var from = state.emp.fnFrom.replace(/-/g, ‘’);
var to   = state.emp.fnTo.replace(/-/g, ‘’);
return ’VBBuilt_FieldSheet*’ + name + ‘_’ + from + ‘-’ + to + ‘.pdf’;
}

/* ─── SETTINGS ───────────────────────────────────── */
function openSettings() {
document.getElementById(‘s-name’).value     = cfg.name    || ‘’;
document.getElementById(‘s-email-to’).value = cfg.emailTo || ‘’;
document.getElementById(‘s-email-cc’).value = cfg.emailCc || ‘’;
document.getElementById(‘s-ejs-key’).value  = cfg.ejsKey  || ‘’;
document.getElementById(‘s-ejs-svc’).value  = cfg.ejsSvc  || ‘’;
document.getElementById(‘s-ejs-tpl’).value  = cfg.ejsTpl  || ‘’;
document.getElementById(‘s-reminders’).checked = cfg.reminders !== false;
updateEJSStatus();
document.getElementById(‘s-overlay’).style.display = ‘block’;
document.getElementById(‘s-drawer’).classList.add(‘open’);
}

function closeSettings() {
document.getElementById(‘s-drawer’).classList.remove(‘open’);
setTimeout(function() {
document.getElementById(‘s-overlay’).style.display = ‘none’;
}, 300);
}

function saveSettings(silent) {
cfg.name      = document.getElementById(‘s-name’).value.trim();
cfg.emailTo   = document.getElementById(‘s-email-to’).value.trim();
cfg.emailCc   = document.getElementById(‘s-email-cc’).value.trim();
cfg.ejsKey    = document.getElementById(‘s-ejs-key’).value.trim();
cfg.ejsSvc    = document.getElementById(‘s-ejs-svc’).value.trim();
cfg.ejsTpl    = document.getElementById(‘s-ejs-tpl’).value.trim();
cfg.reminders = document.getElementById(‘s-reminders’).checked;
saveCfg(false);
var nf = document.getElementById(‘emp-name’);
if (cfg.name && !nf.value) nf.value = cfg.name;
updateEJSStatus();
updateHeader();
if (!silent) { closeSettings(); toast(‘✅ Settings saved’, ‘ok’); }
}

function saveCfg(silent) {
/* Also save any runtime-only cfg keys like lastFnEnd */
localStorage.setItem(‘fs_cfg’, JSON.stringify(cfg));
if (!silent) toast(‘✅ Settings saved’, ‘ok’);
}

function loadCfg() {
try {
var raw = localStorage.getItem(‘fs_cfg’);
if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
} catch(e) {}
}

function updateEJSStatus() {
var el  = document.getElementById(‘ejs-status’);
if (!el) return;
var key = document.getElementById(‘s-ejs-key’).value.trim();
var svc = document.getElementById(‘s-ejs-svc’).value.trim();
var tpl = document.getElementById(‘s-ejs-tpl’).value.trim();
if (key && svc && tpl) {
el.className = ‘ejs-status ok’;
el.textContent = ‘✅ Configured — emails will send automatically’;
} else if (key || svc || tpl) {
el.className = ‘ejs-status partial’;
el.textContent = ‘⚠️ Incomplete — fill all three fields’;
} else {
el.className = ‘ejs-status’; el.style.display = ‘none’;
}
}

/* ─── REMINDERS ──────────────────────────────────── */
function scheduleReminder(ns, ne) {
var end = localDate(ne);
var from = new Date(end);
from.setDate(end.getDate() - 2);
localStorage.setItem(‘fs_rem’, JSON.stringify({ ns:ns, ne:ne, from:isoDate(from) }));
}

function checkReminder() {
if (!cfg.reminders) return;
var raw = localStorage.getItem(‘fs_rem’);
if (!raw) return;
try {
var r     = JSON.parse(raw);
var today = todayISO();
if (today >= r.from && today <= r.ne) {
var days = Math.round((localDate(r.ne) - new Date()) / 86400000);
var txt  = days <= 0
? ‘⏰ Timesheet due today! ’ + auDate(r.ne)
: ‘⏰ Due in ’ + days + ’ day’ + (days===1?’’:‘s’) + ’ — ’ + auDate(r.ns);
document.getElementById(‘reminder-text’).textContent = txt;
show(‘reminder-banner’);
fixMargin();
}
} catch(e) {}
}

function dismissReminder() {
hide(‘reminder-banner’);
fixMargin();
}

/* ─── HEADER ─────────────────────────────────────── */
function updateHeader() {
var name = cfg.name || state.emp.name || ‘’;
document.getElementById(‘greeting’).textContent = name
? ‘Hello, ’ + name.split(’ ’)[0]
: ‘Timesheet Portal’;

var strip = document.getElementById(‘fn-strip’);
if (state.emp.fnFrom && state.emp.fnTo) {
document.getElementById(‘fn-badge’).textContent =
auDate(state.emp.fnFrom) + ’ – ’ + auDate(state.emp.fnTo);
strip.style.display = ‘block’;
} else {
strip.style.display = ‘none’;
}
fixMargin();
}

/* ─── LOADING ────────────────────────────────────── */
function setLoading(txt) {
document.getElementById(‘loading-txt’).textContent = txt || ‘Please wait…’;
document.getElementById(‘loading-overlay’).style.display = ‘flex’;
}
function hideLoading() { document.getElementById(‘loading-overlay’).style.display = ‘none’; }

/* ─── TOAST ──────────────────────────────────────── */
var _tt;
function toast(msg, type) {
var el = document.getElementById(‘toast’);
el.textContent = msg;
el.className = ‘toast’ + (type ? ’ ’ + type : ‘’);
el.style.display = ‘block’;
clearTimeout(_tt);
_tt = setTimeout(function() { el.style.display = ‘none’; }, 3500);
}

/* ─── UTILITIES ──────────────────────────────────── */
function show(id) { var el = document.getElementById(id); if (el) el.style.display = ‘block’; }
function hide(id) { var el = document.getElementById(id); if (el) el.style.display = ‘none’; }

function esc(s) {
if (!s) return ‘’;
return String(s).replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’)
.replace(/”/g,’"’).replace(/’/g,’'’);
}

function blobToB64(blob, cb) {
var r = new FileReader();
r.onload  = function() { cb(r.result.split(’,’)[1]); };
r.onerror = function() { cb(’’); };
r.readAsDataURL(blob);
}

/* ─── INIT ───────────────────────────────────────── */
function init() {
/* 1. Load saved config */
loadCfg();

/* 2. Pre-fill fields from config */
if (cfg.name)    document.getElementById(‘emp-name’).value  = cfg.name;
if (cfg.emailTo) document.getElementById(‘email-to’).value  = cfg.emailTo;
if (cfg.emailCc) document.getElementById(‘email-cc’).value  = cfg.emailCc;

/* 3. Default dates */
var t = todayISO();
document.getElementById(‘exp-date’).value = t;
document.getElementById(‘mil-date’).value = t;

/* 4. Render empty lists */
renderExpenses();
renderMileage();
renderAllowances();

/* 5. FIX MARGIN — must happen before anything else
Measures header and pushes content below it */
fixMargin();
window.addEventListener(‘resize’, fixMargin);

/* 6. Check reminder */
checkReminder();

/* 7. Update header greeting */
updateHeader();

/* 8. Load draft from IndexedDB (async — does not block UI) */
loadDraft();

/* 9. Check for last submission button */
dbGet(‘last’, function(data) {
if (data) {
var btn = document.getElementById(‘load-last-btn’);
if (btn) {
var when = new Date(data.at).toLocaleDateString(‘en-AU’);
btn.textContent = ‘📂 Load Last Submission (’ + when + ‘)’;
btn.style.display = ‘block’;
}
}
});

/* 10. First-time welcome */
if (!cfg.name && !cfg.emailTo) {
setTimeout(function() { toast(‘👋 Welcome! Tap ⚙️ Settings to get started’, ‘ok’); }, 800);
}

/* Re-measure margin several times to catch any late layout shifts
(fonts loading, banners appearing, etc.) */
setTimeout(fixMargin, 200);
setTimeout(fixMargin, 600);
setTimeout(fixMargin, 1200);
}

document.addEventListener(‘DOMContentLoaded’, init);