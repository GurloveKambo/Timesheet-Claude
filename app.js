/* =====================================================
   TIMESHEET PWA — MAIN APP LOGIC (app.js)
   
   This file controls everything the app does:
   - Saving and loading data
   - Building the daily hours table
   - Adding expenses, mileage, and allowances
   - Generating the PDF
   - Opening the email app
   
   Comments explain WHY, not just what.
   ===================================================== */

'use strict';

/* ----- APP STATE -----
   Think of "state" as the app's memory.
   All the data the user enters is stored here while they work.
   When they hit Save, we write this to localStorage.
*/
let state = {
  employee: {
    name: '',
    fortnightFrom: '',
    fortnightTo: '',
    jobRefType: 'client',
    jobClient: '',
    jobAddress: ''
  },
  dailyHours: [],       // Array of { date, day, hours, notes }
  expenses: [],         // Array of { type, amount, date, desc, receiptName, receiptData }
  mileage: [],          // Array of { date, from, to, km, rate, total }
  allowances: []        // Array of { type, amount, notes }
};

/* ----- SERVICE WORKER REGISTRATION -----
   A service worker is a background script that:
   1. Caches files so the app works offline
   2. Checks for app updates
*/
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(registration => {
      console.log('Service worker registered ✅');

      // Check for updates when user opens the app
      registration.update();

      // When a new service worker is waiting to take over, show the update banner
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version is ready! Show the update button.
            document.getElementById('update-banner').classList.remove('hidden');
          }
        });
      });
    })
    .catch(err => console.warn('Service worker failed:', err));
}

/* Tell the service worker to activate the new version */
function applyUpdate() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
  }
  window.location.reload();
}

/* ----- TAB SWITCHING -----
   When user taps a tab button, show that section and hide others.
*/
function switchTab(clickedBtn) {
  const targetId = clickedBtn.getAttribute('data-tab');

  // Hide all tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Remove "active" from all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show the selected panel and highlight the button
  document.getElementById(targetId).classList.add('active');
  clickedBtn.classList.add('active');

  // Scroll to the top of the page so user sees the content
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Switch tab by ID (used by Next/Back buttons) */
function switchTabById(tabId) {
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (btn) switchTab(btn);
}

/* ----- JOB REFERENCE TOGGLE -----
   Show either the client name field or the address field
   depending on which radio button the user picked.
*/
function toggleJobRef() {
  const type = document.querySelector('input[name="job-ref-type"]:checked').value;
  document.getElementById('job-client').classList.toggle('hidden', type !== 'client');
  document.getElementById('job-address').classList.toggle('hidden', type !== 'address');
}

/* ----- BUILD DAILY HOURS TABLE -----
   When the user sets the fortnight dates, we create a row
   for each day in that range.
*/
function buildDailyTable() {
  const fromVal = document.getElementById('fortnight-from').value;
  const toVal   = document.getElementById('fortnight-to').value;

  if (!fromVal || !toVal) return;  // Wait until both dates are filled

  const from = new Date(fromVal);
  const to   = new Date(toVal);

  if (from > to) {
    showToast('⚠️ "From" date must be before "To" date', 'error');
    return;
  }

  // Limit to 31 days maximum (a fortnight is typically 14 days)
  const dayCount = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
  if (dayCount > 31) {
    showToast('⚠️ Date range is too long (max 31 days)', 'error');
    return;
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const tbody = document.getElementById('daily-hours-body');
  tbody.innerHTML = ''; // Clear any existing rows

  // Create one row per day
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);

    const dayName  = days[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    // Format the date as DD/MM/YYYY for display
    const dateStr  = d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    // ISO format for the underlying data
    const isoDate  = d.toISOString().split('T')[0];

    const tr = document.createElement('tr');
    if (isWeekend) tr.classList.add('weekend');

    tr.innerHTML = `
      <td><span class="day-label">${dayName}</span></td>
      <td><span class="date-label">${dateStr}</span></td>
      <td>
        <input type="number" 
               class="hours-input" 
               data-date="${isoDate}" 
               placeholder="0" 
               min="0" max="24" step="0.5"
               oninput="recalcTotalHours()"
               style="width:72px" />
      </td>
      <td>
        <input type="text" 
               class="notes-input"
               data-date="${isoDate}"
               placeholder="e.g. Site visit"
               style="min-width:110px" />
      </td>
    `;

    tbody.appendChild(tr);
  }

  document.getElementById('daily-table-card').style.display = 'block';
  recalcTotalHours();
}

/* Add up all hours entered in the table */
function recalcTotalHours() {
  let total = 0;
  document.querySelectorAll('.hours-input').forEach(input => {
    const val = parseFloat(input.value);
    if (!isNaN(val)) total += val;
  });
  document.getElementById('total-hours').textContent = total.toFixed(1);
}

/* ----- EXPENSES ----- */

/* Add an expense to the list */
function addExpense() {
  const type    = document.getElementById('exp-type').value;
  const amount  = document.getElementById('exp-amount').value;
  const date    = document.getElementById('exp-date').value;
  const desc    = document.getElementById('exp-desc').value;
  const receipt = document.getElementById('exp-receipt').files[0];

  // Validate required fields
  if (!type)    { showToast('Please select an expense type', 'error'); return; }
  if (!amount || parseFloat(amount) <= 0) { showToast('Please enter a valid amount', 'error'); return; }
  if (!date)    { showToast('Please select a date', 'error'); return; }
  if (!receipt) { showToast('⚠️ A receipt photo is required', 'error'); return; }

  // Read the file as a base64 string so we can store it locally and attach to PDF
  const reader = new FileReader();
  reader.onload = function(e) {
    const expense = {
      id: Date.now(),       // Unique ID based on timestamp
      type,
      amount: parseFloat(amount),
      date,
      desc,
      receiptName: receipt.name,
      receiptData: e.target.result,   // The file as a data URL (base64)
      receiptType: receipt.type       // e.g. "image/jpeg"
    };

    state.expenses.push(expense);
    renderExpenses();
    clearExpenseForm();
    showToast('✅ Expense added', 'success');
  };
  reader.readAsDataURL(receipt);
}

/* Draw all added expenses on screen */
function renderExpenses() {
  const container = document.getElementById('expense-list');
  
  if (state.expenses.length === 0) {
    container.innerHTML = '<div class="empty-state">No expenses added yet</div>';
    return;
  }

  container.innerHTML = state.expenses.map((exp, idx) => `
    <div class="added-item">
      <button class="remove-btn" onclick="removeExpense(${idx})" title="Remove">✕</button>
      <div class="item-title">${exp.type}</div>
      <div class="item-detail">
        ${formatDate(exp.date)} ${exp.desc ? '· ' + exp.desc : ''}
      </div>
      <div class="item-amount">$${exp.amount.toFixed(2)}</div>
      <span class="receipt-badge yes">📎 Receipt: ${exp.receiptName}</span>
    </div>
  `).join('');
}

function removeExpense(idx) {
  state.expenses.splice(idx, 1);
  renderExpenses();
}

function clearExpenseForm() {
  document.getElementById('exp-type').value   = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-date').value   = '';
  document.getElementById('exp-desc').value   = '';
  document.getElementById('exp-receipt').value = '';
}

/* ----- MILEAGE ----- */

/* Auto-calculate trip total as user types */
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

  if (!date) { showToast('Please select a date', 'error'); return; }
  if (!from) { showToast('Please enter a "From" location', 'error'); return; }
  if (!to)   { showToast('Please enter a "To" location', 'error'); return; }
  if (!km || km <= 0) { showToast('Please enter a valid distance', 'error'); return; }

  state.mileage.push({
    id: Date.now(),
    date, from, to, km, rate,
    total: km * rate
  });

  renderMileage();
  clearMileageForm();
  showToast('✅ Trip added', 'success');
}

function renderMileage() {
  const container = document.getElementById('mileage-list');

  if (state.mileage.length === 0) {
    container.innerHTML = '<div class="empty-state">No trips added yet</div>';
    return;
  }

  container.innerHTML = state.mileage.map((m, idx) => `
    <div class="added-item">
      <button class="remove-btn" onclick="removeMileage(${idx})" title="Remove">✕</button>
      <div class="item-title">${m.from} → ${m.to}</div>
      <div class="item-detail">${formatDate(m.date)} · ${m.km} km @ $${m.rate.toFixed(2)}/km</div>
      <div class="item-amount">$${m.total.toFixed(2)}</div>
    </div>
  `).join('');
}

function removeMileage(idx) {
  state.mileage.splice(idx, 1);
  renderMileage();
}

function clearMileageForm() {
  document.getElementById('mil-date').value = '';
  document.getElementById('mil-from').value = '';
  document.getElementById('mil-to').value   = '';
  document.getElementById('mil-km').value   = '';
  document.getElementById('mil-rate').value = '0.88';
  document.getElementById('mil-total').textContent = '$0.00';
}

/* ----- ALLOWANCES ----- */

function addAllowance() {
  const type   = document.getElementById('all-type').value;
  const amount = parseFloat(document.getElementById('all-amount').value);
  const notes  = document.getElementById('all-notes').value.trim();

  if (!type)               { showToast('Please select an allowance type', 'error'); return; }
  if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'error'); return; }

  state.allowances.push({ id: Date.now(), type, amount, notes });
  renderAllowances();
  clearAllowanceForm();
  showToast('✅ Allowance added', 'success');
}

function renderAllowances() {
  const container = document.getElementById('allowance-list');

  if (state.allowances.length === 0) {
    container.innerHTML = '<div class="empty-state">No allowances added yet</div>';
    return;
  }

  container.innerHTML = state.allowances.map((a, idx) => `
    <div class="added-item">
      <button class="remove-btn" onclick="removeAllowance(${idx})" title="Remove">✕</button>
      <div class="item-title">${a.type}</div>
      <div class="item-detail">${a.notes || 'No notes'}</div>
      <div class="item-amount">$${a.amount.toFixed(2)}</div>
    </div>
  `).join('');
}

function removeAllowance(idx) {
  state.allowances.splice(idx, 1);
  renderAllowances();
}

function clearAllowanceForm() {
  document.getElementById('all-type').value   = '';
  document.getElementById('all-amount').value = '';
  document.getElementById('all-notes').value  = '';
}

/* ----- BUILD REVIEW SCREEN -----
   Summarises everything the user has entered before they submit.
*/
function buildReview() {
  collectFormData(); // Grab all form field values into state

  let html = '';

  // --- Employee Details ---
  html += `
    <div class="review-block">
      <h3>👤 Employee Details</h3>
      <table class="review-table">
        <tr><td>Name</td><td>${state.employee.name || '—'}</td></tr>
        <tr><td>Fortnight</td><td>${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}</td></tr>
        <tr><td>Job Ref</td><td>${state.employee.jobRefType === 'client' ? state.employee.jobClient : state.employee.jobAddress}</td></tr>
      </table>
    </div>`;

  // --- Hours Summary ---
  const totalHours = parseFloat(document.getElementById('total-hours').textContent) || 0;
  html += `
    <div class="review-block">
      <h3>⏱️ Timesheet</h3>
      <table class="review-table">
        <tr><td>Total Hours</td><td><strong>${totalHours.toFixed(1)} hrs</strong></td></tr>
      </table>
    </div>`;

  // --- Expenses Summary ---
  if (state.expenses.length > 0) {
    const expTotal = state.expenses.reduce((s, e) => s + e.amount, 0);
    html += `
      <div class="review-block">
        <h3>🧾 Expenses (${state.expenses.length} items)</h3>
        <table class="review-table">
          ${state.expenses.map(e => `
            <tr>
              <td>${e.type}</td>
              <td>$${e.amount.toFixed(2)} — ${formatDate(e.date)}</td>
            </tr>`).join('')}
          <tr><td><strong>Total</strong></td><td><strong>$${expTotal.toFixed(2)}</strong></td></tr>
        </table>
      </div>`;
  }

  // --- Mileage Summary ---
  if (state.mileage.length > 0) {
    const milTotal = state.mileage.reduce((s, m) => s + m.total, 0);
    html += `
      <div class="review-block">
        <h3>🚗 Mileage (${state.mileage.length} trips)</h3>
        <table class="review-table">
          ${state.mileage.map(m => `
            <tr>
              <td>${m.from} → ${m.to}</td>
              <td>$${m.total.toFixed(2)}</td>
            </tr>`).join('')}
          <tr><td><strong>Total</strong></td><td><strong>$${milTotal.toFixed(2)}</strong></td></tr>
        </table>
      </div>`;
  }

  // --- Allowances Summary ---
  if (state.allowances.length > 0) {
    const allTotal = state.allowances.reduce((s, a) => s + a.amount, 0);
    html += `
      <div class="review-block">
        <h3>⭐ Allowances (${state.allowances.length} items)</h3>
        <table class="review-table">
          ${state.allowances.map(a => `
            <tr><td>${a.type}</td><td>$${a.amount.toFixed(2)}</td></tr>`).join('')}
          <tr><td><strong>Total</strong></td><td><strong>$${allTotal.toFixed(2)}</strong></td></tr>
        </table>
      </div>`;
  }

  // --- Grand Total ---
  const grandTotal = 
    state.expenses.reduce((s, e) => s + e.amount, 0) +
    state.mileage.reduce((s, m) => s + m.total, 0) +
    state.allowances.reduce((s, a) => s + a.amount, 0);

  html += `
    <div class="review-total">
      <span>💰 Grand Total</span>
      <span>$${grandTotal.toFixed(2)}</span>
    </div>`;

  document.getElementById('review-content').innerHTML = html;
}

/* ----- COLLECT FORM DATA -----
   Reads values from all the HTML inputs and stores them in "state"
*/
function collectFormData() {
  state.employee.name           = document.getElementById('employee-name').value.trim();
  state.employee.fortnightFrom  = document.getElementById('fortnight-from').value;
  state.employee.fortnightTo    = document.getElementById('fortnight-to').value;
  state.employee.jobRefType     = document.querySelector('input[name="job-ref-type"]:checked')?.value || 'client';
  state.employee.jobClient      = document.getElementById('job-client').value.trim();
  state.employee.jobAddress     = document.getElementById('job-address').value.trim();

  // Collect daily hours from the table
  state.dailyHours = [];
  document.querySelectorAll('#daily-hours-body tr').forEach(row => {
    const hoursInput = row.querySelector('.hours-input');
    const notesInput = row.querySelector('.notes-input');
    if (hoursInput) {
      state.dailyHours.push({
        date:  hoursInput.dataset.date,
        day:   row.querySelector('.day-label')?.textContent || '',
        hours: parseFloat(hoursInput.value) || 0,
        notes: notesInput?.value || ''
      });
    }
  });
}

/* ----- SAVE PROGRESS -----
   Writes all current data to localStorage so it survives
   if the user closes the browser or their phone sleeps.
*/
function saveProgress() {
  collectFormData();
  
  try {
    // Also save the raw form data (text fields etc)
    const saveData = {
      state,
      formData: {
        employeeName:   document.getElementById('employee-name').value,
        fortnightFrom:  document.getElementById('fortnight-from').value,
        fortnightTo:    document.getElementById('fortnight-to').value,
        jobRefType:     document.querySelector('input[name="job-ref-type"]:checked')?.value,
        jobClient:      document.getElementById('job-client').value,
        jobAddress:     document.getElementById('job-address').value,
        emailTo:        document.getElementById('email-to').value,
        emailCc:        document.getElementById('email-cc').value,
      },
      savedAt: new Date().toISOString()
    };

    localStorage.setItem('timesheet_draft', JSON.stringify(saveData));
    showToast('✅ Progress saved!', 'success');
  } catch (e) {
    // localStorage can sometimes be full (especially with large receipt images)
    showToast('⚠️ Could not save — storage may be full', 'error');
    console.error('Save failed:', e);
  }
}

/* ----- LOAD SAVED PROGRESS -----
   When the app starts, check if there's a saved draft and restore it.
*/
function loadSavedProgress() {
  try {
    const saved = localStorage.getItem('timesheet_draft');
    if (!saved) return;

    const data = JSON.parse(saved);
    if (!data || !data.state) return;

    // Restore state object
    state = data.state;

    // Restore form fields
    const f = data.formData || {};
    if (f.employeeName)  document.getElementById('employee-name').value   = f.employeeName;
    if (f.fortnightFrom) document.getElementById('fortnight-from').value  = f.fortnightFrom;
    if (f.fortnightTo)   document.getElementById('fortnight-to').value    = f.fortnightTo;
    if (f.jobClient)     document.getElementById('job-client').value      = f.jobClient;
    if (f.jobAddress)    document.getElementById('job-address').value     = f.jobAddress;
    if (f.emailTo)       document.getElementById('email-to').value        = f.emailTo;
    if (f.emailCc)       document.getElementById('email-cc').value        = f.emailCc;

    // Restore radio button selection
    if (f.jobRefType) {
      const radio = document.querySelector(`input[name="job-ref-type"][value="${f.jobRefType}"]`);
      if (radio) { radio.checked = true; toggleJobRef(); }
    }

    // Rebuild the daily table if we have dates
    if (f.fortnightFrom && f.fortnightTo) {
      buildDailyTable();

      // Restore saved hours values into the table
      setTimeout(() => {
        state.dailyHours.forEach(dayData => {
          const input = document.querySelector(`.hours-input[data-date="${dayData.date}"]`);
          const notes = document.querySelector(`.notes-input[data-date="${dayData.date}"]`);
          if (input) input.value = dayData.hours || '';
          if (notes) notes.value = dayData.notes || '';
        });
        recalcTotalHours();
      }, 50); // Small delay to let the table build first
    }

    // Re-render lists
    renderExpenses();
    renderMileage();
    renderAllowances();

    const savedDate = new Date(data.savedAt).toLocaleString('en-AU');
    showToast(`📂 Draft restored (saved ${savedDate})`, 'success');

  } catch (e) {
    console.warn('Could not load saved data:', e);
  }
}

/* ----- CLEAN UP OLD DATA -----
   After a successful submission, delete old saved data.
   We keep only the most recent fortnight to save storage space.
*/
function cleanupOldData() {
  localStorage.removeItem('timesheet_draft');
}

/* ----- VALIDATE BEFORE SUBMIT -----
   Check that all required fields are filled in.
   Returns true if valid, false if there are problems.
*/
function validateForm() {
  collectFormData();

  if (!state.employee.name) {
    showToast('⚠️ Please enter employee name', 'error');
    switchTabById('tab-timesheet');
    return false;
  }
  if (!state.employee.fortnightFrom || !state.employee.fortnightTo) {
    showToast('⚠️ Please select fortnight dates', 'error');
    switchTabById('tab-timesheet');
    return false;
  }
  const jobRef = state.employee.jobRefType === 'client' 
    ? state.employee.jobClient 
    : state.employee.jobAddress;
  if (!jobRef) {
    showToast('⚠️ Please enter a job reference', 'error');
    switchTabById('tab-timesheet');
    return false;
  }

  const emailTo = document.getElementById('email-to').value;
  if (!emailTo || !emailTo.includes('@')) {
    showToast('⚠️ Please enter a valid email address', 'error');
    switchTabById('tab-review');
    return false;
  }

  return true;
}

/* ----- SUBMIT FORM -----
   This is the big one. When the user clicks Submit:
   1. Validate everything
   2. Generate a PDF
   3. Download the PDF
   4. Open the email app with pre-filled subject/body
*/
async function submitForm() {
  if (!validateForm()) return;

  const btn = document.querySelector('.btn-submit');
  btn.textContent = '⏳ Generating PDF...';
  btn.disabled = true;

  try {
    // Small pause so the button text updates before heavy work begins
    await new Promise(resolve => setTimeout(resolve, 100));

    const pdfBlob = await generatePDF();
    const filename = generateFilename();

    // Download the PDF to the user's device
    downloadFile(pdfBlob, filename, 'application/pdf');

    // Open the email client
    setTimeout(() => openEmailClient(filename), 1000);

    // Show success screen
    document.getElementById('pdf-filename').textContent = filename;
    document.getElementById('success-screen').classList.remove('hidden');

    // Clean up old saved data
    cleanupOldData();

  } catch (err) {
    console.error('Submission error:', err);
    showToast('❌ Something went wrong: ' + err.message, 'error');
  } finally {
    btn.textContent = '🚀 Generate PDF & Open Email';
    btn.disabled = false;
  }
}

/* ----- GENERATE PDF -----
   Uses jsPDF (loaded in index.html) to build a PDF document.
   This runs entirely in the browser — no server required.
*/
async function generatePDF() {
  // jsPDF is loaded as a global variable by the script tag in index.html
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210;    // A4 width in mm
  const margin = 15;
  let y = margin;   // Current Y position on the page (moves down as we add content)

  // -- Helper: add text and move Y down --
  function addText(text, x, size = 10, style = 'normal', color = [30, 42, 56]) {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.setTextColor(...color);
    doc.text(String(text), x, y);
  }

  function line() {
    y += 1;
    doc.setDrawColor(200, 210, 220);
    doc.line(margin, y, W - margin, y);
    y += 5;
  }

  function space(mm = 6) { y += mm; }

  // Check if we need a new page
  function checkPage() {
    if (y > 270) { doc.addPage(); y = margin; }
  }

  // === HEADER ===
  doc.setFillColor(26, 58, 92);
  doc.rect(0, 0, W, 28, 'F');

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('TIMESHEET & EXPENSE SUBMISSION', margin, 13);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`, margin, 22);

  y = 36;

  // === EMPLOYEE DETAILS ===
  doc.setFillColor(238, 242, 247);
  doc.rect(margin, y - 4, W - margin * 2, 30, 'F');

  addText('EMPLOYEE DETAILS', margin + 3, 11, 'bold', [26, 58, 92]); space(7);
  addText(`Name:  ${state.employee.name}`, margin + 3, 10); space(6);
  addText(`Fortnight:  ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`, margin + 3, 10); space(6);
  const jobRef = state.employee.jobRefType === 'client' ? state.employee.jobClient : state.employee.jobAddress;
  addText(`Job Reference:  ${jobRef}`, margin + 3, 10);
  space(10);

  // === DAILY HOURS ===
  checkPage();
  addText('TIMESHEET — DAILY HOURS', margin, 12, 'bold', [26, 58, 92]); space(2);
  line();

  // Table header
  doc.setFillColor(26, 58, 92);
  doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Day', margin + 2, y);
  doc.text('Date', margin + 20, y);
  doc.text('Hours', margin + 60, y);
  doc.text('Notes', margin + 85, y);
  y += 6;

  // Table rows
  let totalHoursForPDF = 0;
  state.dailyHours.forEach((d, i) => {
    checkPage();
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 253);
      doc.rect(margin, y - 4, W - margin * 2, 7, 'F');
    }
    doc.setTextColor(30, 42, 56);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(d.day, margin + 2, y);
    doc.text(formatDate(d.date), margin + 20, y);
    doc.text(d.hours > 0 ? String(d.hours) : '—', margin + 60, y);
    doc.text(d.notes || '', margin + 85, y);
    totalHoursForPDF += d.hours;
    y += 7;
  });

  // Total row
  doc.setFillColor(26, 58, 92);
  doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('TOTAL HOURS', margin + 2, y);
  doc.text(totalHoursForPDF.toFixed(1), margin + 60, y);
  y += 12;

  // === EXPENSES ===
  if (state.expenses.length > 0) {
    checkPage();
    addText('EXPENSES', margin, 12, 'bold', [26, 58, 92]); space(2);
    line();

    const expTotal = state.expenses.reduce((s, e) => s + e.amount, 0);

    state.expenses.forEach((exp, i) => {
      checkPage();
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 253);
        doc.rect(margin, y - 5, W - margin * 2, 14, 'F');
      }
      doc.setTextColor(30, 42, 56);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(exp.type, margin + 2, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(formatDate(exp.date), margin + 2, y + 5);
      doc.text(exp.desc || '', margin + 40, y + 5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`$${exp.amount.toFixed(2)}`, W - margin - 20, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 120, 80);
      doc.text('📎 ' + exp.receiptName, margin + 2, y + 9);
      doc.setTextColor(30, 42, 56);
      y += 16;
    });

    checkPage();
    doc.setFillColor(26, 58, 92);
    doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('EXPENSES TOTAL', margin + 2, y);
    doc.text(`$${expTotal.toFixed(2)}`, W - margin - 20, y, { align: 'right' });
    y += 12;
  }

  // === MILEAGE ===
  if (state.mileage.length > 0) {
    checkPage();
    addText('MILEAGE', margin, 12, 'bold', [26, 58, 92]); space(2);
    line();

    const milTotal = state.mileage.reduce((s, m) => s + m.total, 0);

    state.mileage.forEach((m, i) => {
      checkPage();
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 253);
        doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
      }
      doc.setTextColor(30, 42, 56);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(formatDate(m.date), margin + 2, y);
      doc.text(`${m.from} → ${m.to}`, margin + 25, y);
      doc.text(`${m.km} km @ $${m.rate.toFixed(2)}`, margin + 105, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`$${m.total.toFixed(2)}`, W - margin - 20, y, { align: 'right' });
      y += 8;
    });

    checkPage();
    doc.setFillColor(26, 58, 92);
    doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('MILEAGE TOTAL', margin + 2, y);
    doc.text(`$${milTotal.toFixed(2)}`, W - margin - 20, y, { align: 'right' });
    y += 12;
  }

  // === ALLOWANCES ===
  if (state.allowances.length > 0) {
    checkPage();
    addText('ALLOWANCES', margin, 12, 'bold', [26, 58, 92]); space(2);
    line();

    const allTotal = state.allowances.reduce((s, a) => s + a.amount, 0);

    state.allowances.forEach((a, i) => {
      checkPage();
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 253);
        doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
      }
      doc.setTextColor(30, 42, 56);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(a.type, margin + 2, y);
      doc.text(a.notes || '', margin + 70, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`$${a.amount.toFixed(2)}`, W - margin - 20, y, { align: 'right' });
      y += 8;
    });

    checkPage();
    doc.setFillColor(26, 58, 92);
    doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('ALLOWANCES TOTAL', margin + 2, y);
    const allTotalStr = '$' + allTotal.toFixed(2);
    doc.text(allTotalStr, W - margin - 20, y, { align: 'right' });
    y += 12;
  }

  // === GRAND TOTAL ===
  checkPage();
  space(4);
  doc.setFillColor(240, 140, 47); // Orange accent colour
  doc.rect(margin, y - 5, W - margin * 2, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const grandTotal = 
    state.expenses.reduce((s, e) => s + e.amount, 0) +
    state.mileage.reduce((s, m) => s + m.total, 0) +
    state.allowances.reduce((s, a) => s + a.amount, 0);
  doc.text('GRAND TOTAL (Expenses + Mileage + Allowances)', margin + 2, y + 2);
  doc.text(`$${grandTotal.toFixed(2)}`, W - margin - 20, y + 2, { align: 'right' });
  y += 20;

  // === RECEIPT IMAGES (one per page) ===
  // Each receipt image gets its own page in the PDF
  for (const exp of state.expenses) {
    if (exp.receiptData && exp.receiptType && exp.receiptType.startsWith('image/')) {
      doc.addPage();
      y = margin;

      doc.setFillColor(26, 58, 92);
      doc.rect(0, 0, W, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`RECEIPT: ${exp.type} — ${formatDate(exp.date)} — $${exp.amount.toFixed(2)}`, margin, 11);

      y = 25;

      try {
        // Determine image format for jsPDF
        const fmt = exp.receiptType.includes('png') ? 'PNG' : 'JPEG';
        // Add image, fitting within the page margins
        doc.addImage(exp.receiptData, fmt, margin, y, W - margin * 2, 220);
      } catch (imgErr) {
        doc.setTextColor(180, 0, 0);
        doc.setFontSize(10);
        doc.text('(Could not embed image: ' + exp.receiptName + ')', margin, y + 10);
      }
    }
  }

  // === FOOTER on every page ===
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Page ${p} of ${totalPages}  |  ${state.employee.name}  |  ${formatDate(state.employee.fortnightFrom)} to ${formatDate(state.employee.fortnightTo)}`,
      W / 2, 292, { align: 'center' }
    );
  }

  // Return the PDF as a binary blob (a file in memory)
  return doc.output('blob');
}

/* Create a sensible filename for the PDF */
function generateFilename() {
  const name = (state.employee.name || 'Employee').replace(/\s+/g, '_');
  const from = state.employee.fortnightFrom.replace(/-/g, '');
  const to   = state.employee.fortnightTo.replace(/-/g, '');
  return `Timesheet_${name}_${from}-${to}.pdf`;
}

/* ----- DOWNLOAD FILE -----
   Creates a temporary invisible link and clicks it to trigger a download.
*/
function downloadFile(blob, filename, mimeType) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // Free up memory
  }, 1000);
}

/* ----- OPEN EMAIL CLIENT -----
   Creates a mailto: link which opens the user's email app.
   The PDF must be manually attached — browsers don't allow
   automatic attachments for security reasons.
   
   We include clear instructions in the email body.
*/
function openEmailClient(pdfFilename) {
  const emailTo = document.getElementById('email-to').value;
  const emailCc = document.getElementById('email-cc').value;
  const name    = state.employee.name || 'Employee';
  const from    = formatDate(state.employee.fortnightFrom);
  const to      = formatDate(state.employee.fortnightTo);

  const subject = encodeURIComponent(
    `Timesheet & Expenses — ${name} — ${from} to ${to}`
  );

  const expTotal = state.expenses.reduce((s, e) => s + e.amount, 0);
  const milTotal = state.mileage.reduce((s, m) => s + m.total, 0);
  const allTotal = state.allowances.reduce((s, a) => s + a.amount, 0);
  const grandTotal = expTotal + milTotal + allTotal;
  const totalHrs = parseFloat(document.getElementById('total-hours').textContent) || 0;

  const body = encodeURIComponent(
`Hi,

Please find attached my timesheet and expense submission for the fortnight ${from} to ${to}.

SUMMARY
-------
Employee:     ${name}
Total Hours:  ${totalHrs.toFixed(1)} hrs
Expenses:     $${expTotal.toFixed(2)}
Mileage:      $${milTotal.toFixed(2)}
Allowances:   $${allTotal.toFixed(2)}
TOTAL:        $${grandTotal.toFixed(2)}

⚠️ IMPORTANT: Please attach the file "${pdfFilename}" that was downloaded to your device.

Kind regards,
${name}`
  );

  // Build the mailto URL
  let mailtoUrl = `mailto:${emailTo}?subject=${subject}&body=${body}`;
  if (emailCc) mailtoUrl += `&cc=${encodeURIComponent(emailCc)}`;

  // Open the email app
  window.location.href = mailtoUrl;
}

/* ----- START NEW SUBMISSION -----
   Resets everything so the user can start fresh.
*/
function startNewSubmission() {
  // Reset state
  state = {
    employee: { name: '', fortnightFrom: '', fortnightTo: '', jobRefType: 'client', jobClient: '', jobAddress: '' },
    dailyHours: [],
    expenses: [],
    mileage: [],
    allowances: []
  };

  // Clear all form fields
  document.getElementById('employee-name').value  = '';
  document.getElementById('fortnight-from').value = '';
  document.getElementById('fortnight-to').value   = '';
  document.getElementById('job-client').value     = '';
  document.getElementById('job-address').value    = '';
  document.getElementById('daily-hours-body').innerHTML = '';
  document.getElementById('daily-table-card').style.display = 'none';
  document.getElementById('total-hours').textContent = '0';

  renderExpenses();
  renderMileage();
  renderAllowances();

  // Hide success screen and go back to first tab
  document.getElementById('success-screen').classList.add('hidden');
  switchTabById('tab-timesheet');
  window.scrollTo({ top: 0 });
}

/* ----- TOAST NOTIFICATIONS -----
   Shows a small message bar at the bottom of the screen.
   It disappears after 3 seconds.
*/
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.classList.remove('hidden');

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

/* ----- DATE FORMATTING -----
   Converts "2025-09-01" (how dates are stored) to "01/09/2025" (how Australians read dates)
*/
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/* ----- INITIALISE APP -----
   This runs when the page first loads.
*/
function init() {
  // Load any saved draft
  loadSavedProgress();

  // Set today's date as default for expense and mileage inputs
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('exp-date').value = today;
  document.getElementById('mil-date').value = today;

  // Render empty lists (shows "none added yet" message)
  renderExpenses();
  renderMileage();
  renderAllowances();

  console.log('App initialised ✅');
}

// Run init when the page has fully loaded
document.addEventListener('DOMContentLoaded', init);
