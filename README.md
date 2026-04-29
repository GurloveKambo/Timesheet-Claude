# 🏗️ Field Timesheet & Expenses PWA
## Complete Setup & Maintenance Guide
*Written for people who are not programmers.*

---

## 📁 FILE STRUCTURE

```
timesheet-pwa/
├── index.html      ← The main page of the app
├── style.css       ← All visual styling (colours, fonts, layout)
├── app.js          ← All app logic (forms, PDF, email)
├── sw.js           ← Service worker (offline support + updates)
├── manifest.json   ← PWA settings (app name, icons)
├── README.md       ← This file
└── icons/
    ├── icon-192.png   ← App icon (smaller, for home screen)
    └── icon-512.png   ← App icon (larger, for app stores)
```

---

## 🚀 HOW TO HOST ON GITHUB PAGES (Step by Step)

### Step 1: Create a GitHub Account
1. Go to https://github.com
2. Click "Sign up" and create a free account
3. Verify your email

### Step 2: Create a New Repository (project)
1. Once logged in, click the **+** button (top right) → "New repository"
2. Name it: `timesheet-app` (or anything you like)
3. Make sure it is set to **Public** (required for free GitHub Pages)
4. Check the box: "Add a README file"
5. Click **Create repository**

### Step 3: Upload Your Files
1. In your new repository, click **"Add file"** → **"Upload files"**
2. Drag and drop ALL files from the `timesheet-pwa` folder:
   - `index.html`
   - `style.css`
   - `app.js`
   - `sw.js`
   - `manifest.json`
3. Also upload the `icons` folder contents — you may need to do these separately
4. Scroll down and click **"Commit changes"** (green button)

### Step 4: Upload the Icons Folder
1. Click **"Add file"** → **"Upload files"** again
2. Create a path by typing `icons/` before the filename
   - GitHub will create the folder automatically
3. Upload `icon-192.png` and `icon-512.png`
4. Click **"Commit changes"**

### Step 5: Enable GitHub Pages
1. Click **"Settings"** tab in your repository
2. In the left sidebar, click **"Pages"**
3. Under "Source", select **"Deploy from a branch"**
4. Choose branch: **main**
5. Choose folder: **/ (root)**
6. Click **Save**

### Step 6: Wait & Visit
1. Wait about 2 minutes
2. A green box will appear with your URL, something like:
   `https://yourusername.github.io/timesheet-app/`
3. Share this URL with your employees!

---

## 📱 HOW EMPLOYEES INSTALL IT ON THEIR PHONE

### Android (Chrome browser):
1. Open the app URL in Chrome
2. A banner may appear at the bottom: "Add to Home Screen"
3. OR tap the **three dots** (⋮) menu → "Add to Home Screen"
4. Tap "Add" — the app icon appears on the home screen
5. Open it from there — it looks and works like a real app

### iPhone/iPad (Safari browser — MUST use Safari):
1. Open the app URL in **Safari** (not Chrome on iPhone)
2. Tap the **Share** button (the box with an arrow pointing up)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap "Add" (top right)
5. The app icon appears on your home screen

---

## 🔄 HOW TO UPDATE THE APP

When you make changes (fix something, add a feature), you need to:

### Step 1: Update the Cache Version Number
Open `sw.js` in a text editor.
Find this line near the top:
```
const CACHE_VERSION = 'v1';
```
Change it to `'v2'`, then `'v3'` the next time, etc.
This tells users' phones that a new version is available.

### Step 2: Upload the Changed Files
1. Go to your GitHub repository
2. Click on the file you changed (e.g., `sw.js`)
3. Click the **pencil icon** ✏️ to edit it directly in the browser
4. OR click "Add file" → "Upload files" to replace it

### Step 3: Done!
Next time users open the app, they'll see a blue banner:
> 🔄 A new version is available. [Update Now]

They tap it and the app refreshes with your latest changes.

---

## ✉️ HOW TO CHANGE THE DEFAULT EMAIL ADDRESS

Open `index.html` and find this line:
```html
<input type="email" id="email-to" ... value="payroll@yourcompany.com.au" />
```
Change `payroll@yourcompany.com.au` to your real payroll email address.

---

## 🎨 HOW TO REPLACE THE LOGO / ICONS

### App Icon (what shows on the home screen):
Replace the files in the `icons/` folder:
- `icon-192.png` — must be exactly 192×192 pixels
- `icon-512.png` — must be exactly 512×512 pixels

Use any image editor (Canva, Photoshop, GIMP) to make square PNG images.

### Logo Emoji in the Header:
Open `index.html` and find:
```html
<span class="logo-icon">🏗️</span>
```
Replace `🏗️` with any emoji, or replace the whole span with an `<img>` tag:
```html
<img src="your-logo.png" style="height:40px" alt="Logo" />
```

---

## 🎨 HOW TO CHANGE COLOURS

Open `style.css` and look for the `:root` section near the top:
```css
:root {
  --color-primary:  #1a3a5c;   /* Dark navy blue */
  --color-accent:   #f08c2f;   /* Orange buttons */
  ...
}
```
Change the hex colour codes (#1a3a5c etc.) to your brand colours.
Use a tool like https://coolors.co to find colour codes.

---

## 🔧 CUSTOMISATION QUICK REFERENCE

| What to change | Where to find it |
|---|---|
| Default email address | `index.html` → search for `payroll@` |
| App name | `manifest.json` → `"name"` and `"short_name"` |
| Expense types | `index.html` → search for `exp-type` |
| Allowance types | `index.html` → search for `all-type` |
| Default mileage rate | `index.html` → search for `mil-rate` |
| Colours | `style.css` → `:root` section |
| App icon | Replace files in `icons/` folder |
| Force update | `sw.js` → change `CACHE_VERSION` |

---

## ❓ TROUBLESHOOTING

**"The app doesn't install / no Add to Home Screen prompt"**
- Android: Must use Chrome browser
- iPhone: MUST use Safari (not Chrome, not Firefox)
- The site must be served over HTTPS (GitHub Pages does this automatically)

**"PDF doesn't download"**
- Some phones ask for permission to download files — allow it
- On iPhone, the PDF opens in the browser; tap the Share icon to save it

**"Email app doesn't open"**
- Make sure a default email app is set up on the phone
- The mailto: link opens the default mail app (Gmail, Mail, Outlook etc.)
- The PDF attachment must be added manually in the email app

**"My saved data disappeared"**
- Data is stored in the browser's local storage
- Clearing browser history/data will delete it
- Always tap 💾 Save before closing the app

**"The app shows old content after an update"**
- Tap the "🔄 Update Now" banner if it appears
- OR close and reopen the app
- OR force-refresh: hold Shift and press F5 (desktop), or clear site data

---

## 💡 OPTIONAL IMPROVEMENTS (Future Ideas)

1. **Email Direct Sending**: Set up a free service like Formspree or EmailJS
   to send submissions automatically without opening the email app.

2. **Cloud Backup**: Use Google Sheets API to automatically log submissions
   to a spreadsheet as a record.

3. **Employee List**: Pre-populate a dropdown with employee names
   pulled from a config file.

4. **Multiple Job Codes**: Allow selecting multiple job codes per fortnight
   if employees work across different sites.

5. **Manager Approval Screen**: Add a separate URL/view for managers
   to review and approve submissions.

6. **Push Notifications**: Remind employees to submit on specific days
   using browser push notifications.

7. **Signature Field**: Add a digital signature pad (using a canvas element)
   for employees to sign off their submission.

8. **Receipt Compression**: Automatically reduce image file sizes before
   storing them (to save space and speed up PDF generation).

---

## 🔒 SECURITY NOTES

- All data stays on the employee's device (no server)
- Receipt photos are stored temporarily in the browser's local storage
- The PDF is generated locally and downloaded to the device
- No personal data is sent anywhere except via the employee's own email app
- Consider reminding employees to clear their browser data on shared devices
- For very sensitive data, a proper backend server with authentication
  would be more appropriate

---

*Built with plain HTML, CSS, and JavaScript. No frameworks required.*
*Works offline after first load. Installable on Android and iOS.*
