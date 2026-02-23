# 🚀 Intel Promo Earning Dashboard — Deployment Guide

## 📁 Files in This Project

| File | Purpose |
|------|---------|
| `server.js` | Main Express server — serves all pages & handles all API |
| `dashboard.html` | Main dashboard (shown at your Render URL `/`) |
| `withdraw.html` | Withdrawal page |
| `unlockpromo.html` | Promo unlock page (pay ₦2,000 from balance OR do a task) |
| `deposit.html` | Your existing deposit page |
| `admin.html` | Your existing admin panel |
| `package.json` | Node.js dependencies |
| `.env` | Environment variables (NEVER commit to GitHub) |

---

## ⚙️ Step 1 — Set Up Your GitHub Repos

You need **two GitHub repos**:

### Repo A — YOUR repo (balances)
This is where `balance.js` lives. You control it.

**Example `balance.js` content:**
```js
window.USER_BALANCES = {}
```

### Repo B — The OTHER repo (promolist)
This is `milay63bsm68-ops/repro` — the one already used by the other website.

The server will **read and write** this file directly, keeping the **exact same format**:
```js
const PROMO_LIST = [
  "6940101627",
  "6976365864",
  "7497799470"
];
```
The format is preserved — no changes to how the file looks, just new IDs get added/removed.

---

## 🔑 Step 2 — Create a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)**
2. Click **"Generate new token (classic)"**
3. Give it a name like `intel-promo-server`
4. Select scopes: ✅ **`repo`** (full control of private repositories)
5. Click **Generate token**
6. **Copy the token immediately** — you won't see it again

> ⚠️ One token is enough. It can read/write to **both** repos (Repo A and Repo B) as long as it belongs to an account that has access to both.

---

## 📦 Step 3 — Create `package.json`

Create this file in your project root if it doesn't exist:

```json
{
  "name": "intel-promo-server",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "node-fetch": "^3.3.1"
  }
}
```

---

## 🌍 Step 4 — Deploy to Render

1. Go to [render.com](https://render.com) and log in
2. Click **"New +" → "Web Service"**
3. Connect your **GitHub repo A** (your own repo)
4. Fill in the settings:

| Setting | Value |
|---------|-------|
| **Name** | `promdashboard` (or whatever you like) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | Free |

5. Click **"Advanced"** and add all environment variables (see Step 5)
6. Click **"Create Web Service"**

Your Render URL will be something like:  
`https://promdashboard.onrender.com`

**Visiting that URL will now show `dashboard.html` automatically.**

---

## 🔒 Step 5 — Environment Variables

In Render → your service → **"Environment"** tab, add these:

```
BOT_TOKEN=your_telegram_bot_token_here
ADMIN_ID=your_personal_telegram_id_here
ADMIN_PASSWORD=choose_a_strong_secret_password

GITHUB_TOKEN=your_github_personal_access_token

# YOUR repo — where balance.js lives
GITHUB_REPO=yourGithubUsername/yourRepoName
BALANCE_FILE=balance.js

# THE OTHER repo — where promolist.js lives
PROMO_GITHUB_REPO=milay63bsm68-ops/repro
PROMO_FILE=promolist.js

# Cost to unlock promo (in Naira, default is 2000)
PROMO_UNLOCK_FEE=2000
```

> ⚠️ Replace all values with your actual data. Never share `ADMIN_PASSWORD` or `GITHUB_TOKEN`.

---

## 📱 Step 6 — Set Up Your Telegram Bot

Your bot (`@intelpremiumbot`) is already set up. Just make sure:

1. The bot can **send messages to users** — users must start the bot first (`/start`)
2. Your `BOT_TOKEN` is correct in the env vars
3. Your `ADMIN_ID` is your own Telegram user ID (find it by messaging [@userinfobot](https://t.me/userinfobot))

---

## 🧪 Step 7 — Test Everything

### Test 1: Dashboard loads
Visit your Render URL → should see the dashboard.

### Test 2: Balance loads  
Open from Telegram WebApp → balance should show.

### Test 3: Promo unlock (pay from balance)
1. Make sure a test user has ₦2,000+ balance
2. Open `unlockpromo.html` from Telegram  
3. Click **"Generate Passcode"**
4. Check Telegram — should receive 6-digit code
5. Enter code → click "Unlock Promo"
6. Check that the Telegram ID appears in `promolist.js` on GitHub

### Test 4: Withdraw
1. Open `withdraw.html`
2. Generate passcode → enter → submit
3. Check admin Telegram for notification

### Test 5: Admin — manually add promo ID
```bash
curl -X POST https://YOUR_RENDER_URL/admin/add-promo \
  -H "Content-Type: application/json" \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD" \
  -d '{"telegramId": "1234567890"}'
```

### Test 6: Admin — view promo list
```bash
curl https://YOUR_RENDER_URL/admin/promolist \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD"
```

---

## 🔄 How the Promo Unlock Flow Works

```
User opens unlockpromo.html
         │
         ├── Option A: "Pay from Balance"
         │       │
         │       ├─ Click "Generate Passcode"
         │       │       └─ Server sends 6-digit code to user's Telegram
         │       │           (proves it's really them)
         │       │
         │       ├─ User enters passcode
         │       │
         │       └─ Click "Unlock Promo — ₦2,000"
         │               └─ POST /buy-promo
         │                       ├─ Validates passcode
         │                       ├─ Checks user has ₦2,000
         │                       ├─ Deducts ₦2,000 from balance.js (Repo A)
         │                       ├─ Adds Telegram ID to promolist.js (Repo B)
         │                       ├─ Sends success message to user on Telegram
         │                       └─ Dashboard shows promo code immediately
         │
         └── Option B: "Do a Task"
                 │
                 └─ User uploads screenshots
                         └─ POST /unlock-promo
                                 └─ Admin receives photo on Telegram
                                         └─ Admin manually calls /admin/add-promo
                                                 └─ User gets Telegram notification
```

---

## 🗂️ All API Endpoints

### Public
| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/` | Serves `dashboard.html` |
| `GET` | `/withdraw.html` | Serves `withdraw.html` |
| `GET` | `/unlockpromo.html` | Serves `unlockpromo.html` |
| `POST` | `/get-balance` | Returns user's NGN balance |
| `POST` | `/generate-passcode` | Sends OTP to user's Telegram |
| `POST` | `/buy-promo` | Deducts ₦2,000 + adds to PROMO_LIST |
| `POST` | `/withdraw` | Submits withdrawal request |
| `POST` | `/unlock-promo` | Sends task/screenshot to admin |

### Admin (require `x-admin-password` header)
| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/admin/add-promo` | Manually add ID to PROMO_LIST |
| `POST` | `/admin/remove-promo` | Remove ID from PROMO_LIST |
| `GET` | `/admin/promolist` | View all IDs in PROMO_LIST |
| `POST` | `/admin/get-balance` | Check any user's balance |
| `POST` | `/admin/update-balance` | Deposit/withdraw from any user |

---

## ❓ Troubleshooting

**Problem: "GitHub read failed: 404"**  
→ Check `PROMO_GITHUB_REPO` and `PROMO_FILE` env vars. Make sure the file exists in the repo.

**Problem: "GitHub write failed: 422"**  
→ The `sha` mismatch. This happens if two writes happen at the same time. Retry.

**Problem: Users don't receive passcode**  
→ Users must `/start` your bot first. Check `BOT_TOKEN` is correct.

**Problem: Dashboard shows but balance says error**  
→ Check `GITHUB_REPO` and `BALANCE_FILE` point to your own repo correctly.

**Problem: Render URL shows "Not Found"**  
→ Make sure `server.js` has `app.get("/", ...)` pointing to `dashboard.html`. ✅ It does.

---

## 📌 Important Notes

- The **external `promolist.js`** format is preserved exactly: `const PROMO_LIST = [...]`
- This server does **NOT** change how `PROMO_LIST` is structured — it just adds/removes IDs
- The dashboard still loads `promolist.js` from the GitHub Pages URL as before:  
  `https://milay63bsm68-ops.github.io/repro/promolist.js`
- Since GitHub Pages caches files, new IDs may take **up to 10 minutes** to appear on the dashboard after being added. The user still gets their Telegram notification immediately.
- The other website using `promolist.js` will also automatically see new IDs ✅

---

*Built for Intel Promo Earning Dashboard — 2025*
