# VB Built — FieldSheet
## Complete Setup & Maintenance Guide
*Written for non-programmers. No coding knowledge needed.*

---

## 📁 YOUR FILE CHECKLIST

Before you start, make sure you have all these files:

```
Your project folder/
├── index.html          ← The app (re-downloaded — includes VB Built branding)
├── style.css           ← All visual styling
├── app.js              ← All app logic
├── sw.js               ← Offline & update support
├── manifest.json       ← PWA settings (re-downloaded — includes VB Built name)
└── icons/
    ├── icon-192.png    ← VB Built logo (home screen icon)
    └── icon-512.png    ← VB Built logo (large version)
```

> ⚠️ **Important:** You downloaded updated versions of `index.html` and
> `manifest.json` with the VB Built branding. Use those, not the originals.

---

## 🚀 PART 1 — HOSTING ON GITHUB PAGES

### Step 1 — Create a free GitHub account
1. Go to **https://github.com**
2. Click **Sign up** — use any email address
3. Verify your email address when prompted

---

### Step 2 — Create a new repository
A "repository" is just a folder on GitHub that holds your files.

1. Once logged in, click the **+** icon (top right corner)
2. Click **"New repository"**
3. Fill in:
   - **Repository name:** `vbbuilt-fieldsheet` (no spaces)
   - **Visibility:** ✅ Public *(required for free GitHub Pages)*
   - **Add a README file:** ✅ tick this
4. Click **"Create repository"** (green button)

---

### Step 3 — Upload your files
1. In your new repository, click **"Add file"** → **"Upload files"**
2. Drag and drop these files from your computer:
   - `index.html`
   - `style.css`
   - `app.js`
   - `sw.js`
   - `manifest.json`
3. Scroll down and click **"Commit changes"**

---

### Step 4 — Upload the icons folder
GitHub doesn't let you upload folders directly, so do this:

1. Click **"Add file"** → **"Create new file"**
2. In the filename box, type: `icons/placeholder.txt`
   *(typing the slash creates the folder automatically)*
3. Type anything in the file content box (e.g. "icons folder")
4. Click **"Commit new file"**
5. Now click into the `icons` folder
6. Click **"Add file"** → **"Upload files"**
7. Upload both `icon-192.png` and `icon-512.png`
8. Click **"Commit changes"**

---

### Step 5 — Enable GitHub Pages
1. Click the **"Settings"** tab in your repository
2. In the left sidebar, scroll down and click **"Pages"**
3. Under **"Source"**, select **"Deploy from a branch"**
4. Set **Branch** to **main** and folder to **/ (root)**
5. Click **Save**

---

### Step 6 — Get your app URL
1. Wait **2–3 minutes** for GitHub to build your site
2. Refresh the Settings → Pages screen
3. You'll see a green box with your URL:
   **`https://yourusername.github.io/vbbuilt-fieldsheet/`**
4. Click it to make sure the app loads ✅

**Share this URL with your employees.**

---

## 📱 PART 2 — INSTALLING ON PHONES

### Android (must use Chrome)
1. Open the app URL in **Chrome**
2. A banner may pop up saying "Add to Home Screen" — tap it
3. **OR** tap the **⋮ three-dot menu** → "Add to Home Screen"
4. Tap **"Add"** — the VB Built icon appears on the home screen
5. Open it from there — it looks and works like a native app

### iPhone / iPad (must use Safari)
1. Open the app URL in **Safari** *(not Chrome — Safari only for iOS)*
2. Tap the **Share button** (the box with an arrow pointing up ↑)
3. Scroll down in the share sheet and tap **"Add to Home Screen"**
4. Tap **"Add"** (top right)
5. The VB Built icon appears on the home screen

> 💡 **Tip for your team:** Send them the URL via SMS or email.
> Tell Android users to use Chrome, and iPhone users to use Safari.

---

## ✨ PART 3 — EMAILJS SETUP (Auto-Send)

EmailJS lets the app send the PDF **automatically** when an employee
submits — no manual email steps needed.

**Free tier: 200 emails per month** (plenty for a small team).

---

### Step 1 — Create a free EmailJS account
1. Go to **https://www.emailjs.com**
2. Click **"Sign Up Free"**
3. Verify your email

---

### Step 2 — Add an Email Service
This connects EmailJS to your email account (Gmail, Outlook, etc.).

1. In the EmailJS dashboard, click **"Email Services"** (left sidebar)
2. Click **"Add New Service"**
3. Choose your email provider (e.g. Gmail)
4. Click **"Connect Account"** and sign in with your payroll email
5. Give it a name like `VB Built Payroll`
6. Click **"Create Service"**
7. Copy the **Service ID** — it looks like `service_abc123` — save it

---

### Step 3 — Create an Email Template
This is the email that gets sent when someone submits.

1. Click **"Email Templates"** (left sidebar)
2. Click **"Create New Template"**
3. Set it up like this:

   | Field | Value |
   |---|---|
   | **To Email** | `{{to_email}}` |
   | **CC** | `{{cc_email}}` |
   | **Subject** | `{{subject}}` |
   | **Content** | `{{message}}` |

4. To attach the PDF, look for the **"Attachments"** section in the template editor and add:
   - **Name:** `{{pdf_name}}`
   - **Data:** `{{pdf_data}}`

5. Click **"Save"**
6. Copy the **Template ID** — it looks like `template_abc123` — save it

---

### Step 4 — Get your Public Key
1. Click your account name (top right) → **"Account"**
2. Under **"API Keys"**, copy your **Public Key** — it looks like `user_abc123xyz`

---

### Step 5 — Enter keys in the app
1. Open the FieldSheet app on your phone
2. Tap the **⚙️ Settings** button (top right)
3. Scroll to **"EmailJS Auto-Send"**
4. Paste in:
   - **Public Key**
   - **Service ID**
   - **Template ID**
5. Tap **"Save Settings"**

A green tick will appear: *"✅ EmailJS configured — emails will be sent automatically"*

From now on, every submission sends automatically with the PDF attached.

---

### What if I don't set up EmailJS?
No problem — the app falls back to the manual method:
- The PDF downloads to the employee's phone
- Their email app opens with the subject pre-filled
- They attach the PDF manually and tap Send

---

## ⚙️ PART 4 — EMPLOYEE SETTINGS

Each employee should do this once after installing the app:

1. Open the app and tap **⚙️ Settings** (top right)
2. Enter their **name** — this auto-fills on every timesheet
3. The **Send To** email address should already be pre-filled
   (you set a default in `index.html` — see customisation below)
4. Tap **Save Settings**

After that, they just open the app and start filling in the form.

---

## 🔄 PART 5 — HOW UPDATES WORK

### To update the app:
1. Make your changes to the files on your computer
2. **Open `sw.js`** and change the version number:
   ```
   const CACHE_VERSION = 'v2';   ← change to v3, v4, etc.
   ```
3. Upload the changed file(s) to GitHub (click the file → pencil icon ✏️ to edit, or re-upload)
4. GitHub Pages updates automatically within 1–2 minutes

### What employees see:
Next time they open the app, a yellow banner appears:
> 🔄 New version available — **[Update Now]**

They tap it, the app refreshes, done.

---

## 🎨 PART 6 — CUSTOMISATION

### Change the default payroll email address
Open `index.html`, find this line (search for `payroll@`):
```html
<input type="email" id="email-to" ... value="payroll@yourcompany.com.au" />
```
Replace `payroll@yourcompany.com.au` with your real address.

---

### Change the mileage rate
Open `index.html`, find:
```html
<input type="number" id="mil-rate" ... value="0.88" .../>
```
Change `0.88` to your current ATO rate.

---

### Change colours
Open `style.css`, find the `:root` section at the top:
```css
:root {
  --navy-800: #0f1f35;   ← main dark colour
  --amber:    #f59e0b;   ← gold/amber accent colour
  ...
}
```
Replace the hex codes with your brand colours.
Use **https://coolors.co** to find colour codes.

---

### Add or remove expense / allowance types
Open `index.html` and search for `exp-type` to find the expenses dropdown:
```html
<select id="exp-type" ...>
  <option>Materials / Supplies</option>
  <option>Tools / Equipment</option>
  ...add or remove lines here...
</select>
```
Do the same for `all-type` (allowances).

---

### Change the app name
- **In the header:** open `index.html`, find `VB Built` and change it
- **On the home screen:** open `manifest.json`, change `"short_name"`
- **Browser tab:** open `index.html`, change `<title>VB Built — FieldSheet</title>`

---

## ❓ PART 7 — TROUBLESHOOTING

| Problem | Solution |
|---|---|
| App won't install on iPhone | Must use **Safari** — not Chrome |
| App won't install on Android | Must use **Chrome** |
| PDF doesn't download | Allow downloads when prompted. On iPhone, tap Share → Save to Files |
| Email app doesn't open | Make sure a default email app is set up (Gmail, Mail, Outlook) |
| EmailJS not sending | Double-check all three keys are correct in Settings. Check your EmailJS dashboard for error logs |
| Saved data disappeared | Clearing browser history/data removes local saves. Always tap 💾 Save before closing |
| App shows old content | Tap "Update Now" if the banner appears. Or close and reopen. |
| Date not snapping to Monday | The app corrects it automatically — a toast message confirms the new date |

---

## 🔒 PART 8 — PRIVACY & SECURITY NOTES

- All data stays **on the employee's device** until they submit
- Receipt photos are stored temporarily in the browser's local storage
- The PDF is generated locally and sent via EmailJS (or email app)
- No data is stored on any VB Built server
- Employees should **not** use the app on a shared/public device without clearing their browser data afterwards
- For sensitive payroll data on shared devices, consider adding a PIN lock (a future enhancement)

---

## 💡 PART 9 — FUTURE IMPROVEMENT IDEAS

1. **Manager approval screen** — a separate view for managers to review and approve submissions before payroll processes them

2. **Google Sheets logging** — automatically record each submission as a row in a spreadsheet using the Google Sheets API

3. **Push notifications** — remind employees to submit on specific days (requires a notification permission prompt)

4. **PIN / passcode lock** — add a 4-digit PIN on the settings screen so the app is locked on shared devices

5. **Signature field** — add a digital sign-off box using the HTML canvas element

6. **Multiple jobs per day** — allow splitting a single day across two job codes (e.g. morning on Site A, afternoon on Site B)

7. **Automatic receipt OCR** — read the amount and date from a receipt photo automatically using a vision API

8. **Submission history** — keep a log of past submissions viewable in the app

---

*Built with plain HTML, CSS, and JavaScript — no frameworks, no server.*
*Works offline after first load. Installs on Android and iOS.*
*Icons and branding: VB Built.*
