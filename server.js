/**
 * ════════════════════════════════════════════════════════════════
 *  INTEL PROMO BALANCE SERVER
 *  Render URL is the entry point — visiting it shows dashboard.html
 *
 *  KEY ENV VARIABLES  (see README.md for full list)
 *  ─────────────────────────────────────────────────────────────
 *  BOT_TOKEN          Telegram bot token
 *  ADMIN_ID           Your Telegram user ID
 *  ADMIN_PASSWORD     Secret password for admin endpoints
 *  GITHUB_TOKEN       Personal Access Token (needs repo scope)
 *
 *  GITHUB_REPO        YOUR repo  e.g. "youruser/yourrepo"
 *  BALANCE_FILE       filename   e.g. "balance.js"
 *
 *  PROMO_GITHUB_REPO  The OTHER repo that owns promolist.js
 *                     e.g. "milay63bsm68-ops/repro"
 *  PROMO_FILE         filename in that repo  e.g. "promolist.js"
 *
 *  PROMO_UNLOCK_FEE   Cost to unlock promo in NGN  (default 2000)
 * ════════════════════════════════════════════════════════════════
 */

import express         from "express";
import fetch           from "node-fetch";
import cors            from "cors";
import dotenv          from "dotenv";
import path            from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"] }));
app.use(express.json({ limit: "25mb" }));

/* ── pull env vars ── */
const {
  BOT_TOKEN,
  ADMIN_ID,
  ADMIN_PASSWORD,
  GITHUB_TOKEN,

  /* YOUR repo — stores balance.js */
  GITHUB_REPO,
  BALANCE_FILE,

  /* The OTHER GitHub repo that stores promolist.js */
  PROMO_GITHUB_REPO,
  PROMO_FILE,           // usually "promolist.js"
} = process.env;

const PROMO_UNLOCK_FEE = Number(process.env.PROMO_UNLOCK_FEE) || 2000; // ₦
const PREMIUM_COST     = 5000;   // ₦
const OWNER_SHARE      = 2500;   // ₦

/* ════════════════════════════════════════════════════════════════
   TELEGRAM HELPERS
════════════════════════════════════════════════════════════════ */
async function sendTelegram(text, chatId) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    Number(chatId),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  } catch (e) { console.error("sendTelegram:", e.message); }
}

async function sendTelegramPhoto(chatId, photoBase64, caption) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    Number(chatId),
        photo:      photoBase64,
        caption,
        parse_mode: "HTML"
      })
    });
  } catch (e) { console.error("sendTelegramPhoto:", e.message); }
}

/* ════════════════════════════════════════════════════════════════
   GITHUB HELPERS — generic read/write for any repo
════════════════════════════════════════════════════════════════ */
async function githubRead(repo, filename) {
  const url = `https://api.github.com/repos/${repo}/contents/${filename}`;
  const r   = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });
  if (!r.ok) throw new Error(`GitHub read failed [${repo}/${filename}]: ${r.status}`);
  const f       = await r.json();
  const content = Buffer.from(f.content, "base64").toString();
  return { content, sha: f.sha };
}

async function githubWrite(repo, filename, content, sha, message) {
  const url = `https://api.github.com/repos/${repo}/contents/${filename}`;
  const r   = await fetch(url, {
    method:  "PUT",
    headers: {
      Authorization:  `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      sha,
      content: Buffer.from(content).toString("base64")
    })
  });
  if (!r.ok) throw new Error(`GitHub write failed [${repo}/${filename}]: ${r.status}`);
}

/* ── BALANCE FILE  (your own repo) ── */
async function readBalances() {
  const { content, sha } = await githubRead(GITHUB_REPO, BALANCE_FILE);
  const balances = JSON.parse(content.replace("window.USER_BALANCES =", "").trim());
  return { balances, sha };
}
async function writeBalances(balances, sha, message) {
  const content = "window.USER_BALANCES = " + JSON.stringify(balances, null, 2);
  await githubWrite(GITHUB_REPO, BALANCE_FILE, content, sha, message);
}

/* ── PROMO LIST  (the OTHER repo — keeps original format) ──
   Format in that file:
     const PROMO_LIST = [
       "6940101627",
       ...
     ];
   We parse it, add/remove IDs, write it back in the SAME format.
*/
async function readPromoList() {
  const repo     = PROMO_GITHUB_REPO;
  const filename = PROMO_FILE || "promolist.js";
  const { content, sha } = await githubRead(repo, filename);

  /* Extract the JSON array from:  const PROMO_LIST = [...]; */
  const match = content.match(/const\s+PROMO_LIST\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("Could not parse PROMO_LIST from file");
  const list = JSON.parse(match[1]);
  return { list, sha };
}

async function writePromoList(list, sha) {
  const repo     = PROMO_GITHUB_REPO;
  const filename = PROMO_FILE || "promolist.js";

  /* Rebuild file in the EXACT SAME format as the original */
  const entries  = list.map(id => `  "${id}"`).join(",\n");
  const content  = `const PROMO_LIST = [\n${entries}\n];\n`;

  await githubWrite(repo, filename, content, sha,
    `Update PROMO_LIST — ${list.length} entries`);
}

/* ════════════════════════════════════════════════════════════════
   EXCHANGE RATE
════════════════════════════════════════════════════════════════ */
async function fetchNgnPerUsd() {
  try {
    const r    = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await r.json();
    const rate = data?.rates?.NGN;
    if (rate && rate > 100) return rate;
    return 1600;
  } catch { return 1600; }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN AUTH
════════════════════════════════════════════════════════════════ */
function authAdmin(req, res) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ════════════════════════════════════════════════════════════════
   PASSCODE STORE
════════════════════════════════════════════════════════════════ */
const passcodes = {};   // { telegramId: { passcode, expiresAt, purpose } }
const attempts  = {};   // { telegramId: count }

function validatePasscode(telegramId, passcode) {
  const record = passcodes[String(telegramId)];
  if (!record)                                  return "No passcode found. Please generate one.";
  if (record.passcode !== String(passcode))     return "Wrong passcode.";
  if (record.expiresAt < Date.now())            return "Passcode expired. Please generate a new one.";
  return null; // OK
}

function consumePasscode(telegramId) {
  delete passcodes[telegramId];
  attempts[telegramId] = 0;
}

function failPasscode(telegramId) {
  attempts[telegramId] = (attempts[telegramId] || 0) + 1;
  if (attempts[telegramId] >= 3) {
    delete passcodes[telegramId];
    attempts[telegramId] = 0;
    return "Too many failed attempts. Passcode reset. Please generate a new one.";
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   STATIC ROUTES — serve HTML files
   Root "/" → dashboard.html  (so Render link opens the dashboard)
════════════════════════════════════════════════════════════════ */
app.get("/",                 (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/dashboard.html",   (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/withdraw.html",    (req, res) => res.sendFile(path.join(__dirname, "withdraw.html")));
app.get("/unlockpromo.html", (req, res) => res.sendFile(path.join(__dirname, "unlockpromo.html")));
app.get("/deposit.html",     (req, res) => res.sendFile(path.join(__dirname, "deposit.html")));
app.get("/admin.html",       (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

/* Legacy paths without .html extension */
app.get("/withdraw",         (req, res) => res.sendFile(path.join(__dirname, "withdraw.html")));
app.get("/unlockpromo",      (req, res) => res.sendFile(path.join(__dirname, "unlockpromo.html")));
app.get("/admin",            (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  SERVE promolist.js  (proxied from GitHub repo)
   dashboard.html loads this as <script src="/promolist.js">
════════════════════════════════════════════════════════════════ */
app.get("/promolist.js", async (req, res) => {
  try {
    const { list } = await readPromoList();
    const entries  = list.map(id => `  "${id}"`).join(",\n");
    const js       = `const PROMO_LIST = [\n${entries}\n];\n`;
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-cache");
    res.send(js);
  } catch (err) {
    console.error("promolist.js endpoint:", err.message);
    /* Serve an empty list so the page still loads gracefully */
    res.setHeader("Content-Type", "application/javascript");
    res.send("const PROMO_LIST = [];\n");
  }
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  GET BALANCE
════════════════════════════════════════════════════════════════ */
app.post("/get-balance", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if (!telegramId) return res.json({ ngn: 0, usd: 0, usdRate: 1600 });

  try {
    const { balances } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    const usdRate = await fetchNgnPerUsd();
    const ngn     = balances[telegramId].ngn;
    const usd     = parseFloat((ngn / usdRate).toFixed(2));

    res.json({ ...balances[telegramId], ngn, usd, usdRate });
  } catch (err) {
    res.status(500).json({ error: "Failed to read balance: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  GENERATE PASSCODE
   purpose: "withdraw" | "promo"   (default: "withdraw")
════════════════════════════════════════════════════════════════ */
app.post("/generate-passcode", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  const purpose    = req.body.purpose    || "withdraw";
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  const passcode  = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;   // 5 minutes

  passcodes[telegramId] = { passcode, expiresAt, purpose };
  attempts[telegramId]  = 0;

  const purposeLabel = purpose === "promo" ? "Promo Unlock" : "Withdrawal";

  await sendTelegram(
    `🔐 <b>${purposeLabel} Passcode</b>\n\n` +
    `Your passcode: <b>${passcode}</b>\n\n` +
    `⚠️ Never share this with anyone.\n` +
    `✅ Use it ONLY in the trusted app.\n` +
    `⏳ Expires in 5 minutes.`,
    telegramId
  );

  res.json({ success: true, message: "Passcode sent to your Telegram" });
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  WITHDRAW
════════════════════════════════════════════════════════════════ */
app.post("/withdraw", async (req, res) => {
  const { telegramId, method, amount, details, passcode } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  /* Validate passcode */
  const err1 = validatePasscode(telegramId, passcode);
  if (err1) {
    const lockMsg = failPasscode(telegramId);
    return res.status(400).json({ error: lockMsg || err1 });
  }
  consumePasscode(telegramId);

  const amountNGN = Math.round(Number(amount));
  if (!amountNGN || amountNGN <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  try {
    const { balances, sha } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    if (balances[telegramId].ngn < amountNGN)
      return res.status(400).json({ error: "Insufficient balance" });

    let usdDisplay = "";
    if (method === "crypto") {
      const ngnPerUsd = await fetchNgnPerUsd();
      usdDisplay = ` ($${(amountNGN / ngnPerUsd).toFixed(2)})`;
    }

    const before = balances[telegramId].ngn;
    balances[telegramId].ngn -= amountNGN;
    await writeBalances(balances, sha, `Withdraw ${telegramId}`);

    await sendTelegram(
      `💸 <b>WITHDRAW REQUEST</b>\n` +
      `User: <code>${telegramId}</code>\n` +
      `Method: ${method}\n` +
      `Amount: ₦${amountNGN.toLocaleString()}${usdDisplay}\n` +
      `Before: ₦${before.toLocaleString()}\n` +
      `After:  ₦${balances[telegramId].ngn.toLocaleString()}\n` +
      `Details: ${JSON.stringify(details, null, 2)}`,
      ADMIN_ID
    );

    await sendTelegram(
      `✅ Withdrawal request received.\n` +
      `Amount: ₦${amountNGN.toLocaleString()}${usdDisplay}\n` +
      `You will be paid shortly.`,
      telegramId
    );

    res.json({ newBalance: balances[telegramId].ngn });
  } catch (err) {
    res.status(500).json({ error: "Withdrawal failed: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  BUY PROMO ACCESS
   ──────────────────────────────────────────────────────────────
   Flow:
     1. User generates a passcode (/generate-passcode with purpose:"promo")
     2. Passcode is sent to their Telegram — proves it's really them
     3. User enters passcode here
     4. Server verifies passcode, deducts ₦2,000 from their balance
     5. Server adds their Telegram ID to PROMO_LIST in the other repo
     6. User gets Telegram notification + dashboard updates instantly
════════════════════════════════════════════════════════════════ */
app.post("/buy-promo", async (req, res) => {
  const { telegramId, name, username, passcode } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });
  if (!passcode)   return res.status(400).json({ error: "Missing passcode" });

  /* Validate passcode */
  const err1 = validatePasscode(telegramId, passcode);
  if (err1) {
    const lockMsg = failPasscode(telegramId);
    return res.status(400).json({ error: lockMsg || err1 });
  }
  consumePasscode(telegramId);

  try {
    /* Check balance */
    const { balances, sha: balSha } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    if (balances[telegramId].ngn < PROMO_UNLOCK_FEE) {
      const shortfall = PROMO_UNLOCK_FEE - balances[telegramId].ngn;
      return res.status(400).json({
        error: `Insufficient balance. You need ₦${PROMO_UNLOCK_FEE.toLocaleString()} ` +
               `but have ₦${balances[telegramId].ngn.toLocaleString()}. ` +
               `Please deposit ₦${shortfall.toLocaleString()} more.`
      });
    }

    /* Check if already in promo list */
    const { list, sha: promoSha } = await readPromoList();
    if (list.includes(String(telegramId))) {
      return res.status(400).json({
        error: "You already have promo access! Check your dashboard."
      });
    }

    /* Deduct ₦2,000 from balance */
    const before = balances[telegramId].ngn;
    balances[telegramId].ngn -= PROMO_UNLOCK_FEE;
    await writeBalances(balances, balSha,
      `Promo unlock fee deducted: ${telegramId}`);

    /* Add to PROMO_LIST in the other repo */
    list.push(String(telegramId));
    await writePromoList(list, promoSha);

    const usdRate   = await fetchNgnPerUsd();
    const newBal    = balances[telegramId].ngn;
    const promoLink = `https://intelligentverificationlink.ct.ws?ref=${telegramId}`;

    /* Notify user */
    await sendTelegram(
      `🎉 <b>Promo Access Unlocked!</b>\n\n` +
      `✅ ₦${PROMO_UNLOCK_FEE.toLocaleString()} deducted from your balance.\n` +
      `💳 New balance: ₦${newBal.toLocaleString()} ($${(newBal / usdRate).toFixed(2)})\n\n` +
      `🏷️ Your promo code: <code>${telegramId}</code>\n` +
      `🔗 Your promo link:\n${promoLink}\n\n` +
      `Share your link and start earning commission! 💰`,
      telegramId
    );

    /* Notify admin */
    await sendTelegram(
      `🟢 <b>PROMO UNLOCK</b>\n` +
      `👤 ${name || "N/A"} (${username || "N/A"})\n` +
      `🆔 <code>${telegramId}</code>\n` +
      `💰 Paid: ₦${PROMO_UNLOCK_FEE.toLocaleString()}\n` +
      `Before: ₦${before.toLocaleString()}\n` +
      `After:  ₦${newBal.toLocaleString()}\n` +
      `📋 Promo list now has ${list.length} entries`,
      ADMIN_ID
    );

    res.json({
      success:    true,
      message:    "🎉 Promo access unlocked!",
      newBalance: newBal,
      promoCode:  String(telegramId),
      promoLink
    });

  } catch (err) {
    console.error("buy-promo error:", err.message);
    res.status(500).json({ error: "Failed to unlock promo: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  UNLOCK PROMO VIA TASK / MANUAL PAYMENT SCREENSHOT
   (old flow — still works, admin manually approves)
════════════════════════════════════════════════════════════════ */
app.post("/unlock-promo", async (req, res) => {
  const { telegramId, name, username, method, whatsapp, call, image, type } = req.body;
  if (!telegramId || !image) return res.status(400).json({ error: "Missing data" });

  const caption =
    `<b>🟡 PROMO ${type === "task" ? "TASK" : "MANUAL PAYMENT"} SUBMISSION</b>\n` +
    `Name: ${name}\nUsername: ${username}\nID: <code>${telegramId}</code>\n` +
    `Method: ${method || "Task"}\n` +
    `WhatsApp: ${whatsapp || "N/A"}\nCall: ${call || "N/A"}\n\n` +
    `To approve, call: /admin/add-promo with ID ${telegramId}`;

  try {
    await sendTelegramPhoto(ADMIN_ID, image, caption);
    await sendTelegram(
      `✅ Your ${type === "task" ? "task" : "payment"} has been received.\n` +
      `Admin will review and unlock your promo access shortly.`,
      telegramId
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to send submission" });
  }
});

/* ════════════════════════════════════════════════════════════════
   ADMIN:  ADD PROMO ID MANUALLY (for task/screenshot approvals)
════════════════════════════════════════════════════════════════ */
app.post("/admin/add-promo", async (req, res) => {
  if (!authAdmin(req, res)) return;
  const id = req.body.telegramId ? String(req.body.telegramId).trim() : null;
  if (!id) return res.status(400).json({ error: "Missing telegramId" });

  try {
    const { list, sha } = await readPromoList();
    if (list.includes(id))
      return res.json({ success: true, message: "Already in promo list", list });

    list.push(id);
    await writePromoList(list, sha);

    const promoLink = `https://intelligentverificationlink.ct.ws?ref=${id}`;
    await sendTelegram(
      `🎉 <b>Promo Access Unlocked!</b>\n\n` +
      `✅ Your promo code is now active.\n` +
      `🏷️ Your promo code: <code>${id}</code>\n` +
      `🔗 Your promo link:\n${promoLink}\n\n` +
      `Share your link and start earning commission!`,
      id
    );

    await sendTelegram(
      `✅ Admin added promo: <code>${id}</code>\nTotal: ${list.length}`,
      ADMIN_ID
    );

    res.json({ success: true, message: `Added ${id}`, list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ADMIN:  REMOVE PROMO ID
════════════════════════════════════════════════════════════════ */
app.post("/admin/remove-promo", async (req, res) => {
  if (!authAdmin(req, res)) return;
  const id = req.body.telegramId ? String(req.body.telegramId).trim() : null;
  if (!id) return res.status(400).json({ error: "Missing telegramId" });

  try {
    const { list, sha } = await readPromoList();
    const newList = list.filter(x => x !== id);
    if (newList.length === list.length)
      return res.json({ success: false, message: "ID not found", list });

    await writePromoList(newList, sha);
    res.json({ success: true, message: `Removed ${id}`, list: newList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ADMIN:  VIEW PROMO LIST
════════════════════════════════════════════════════════════════ */
app.get("/admin/promolist", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { list } = await readPromoList();
    res.json({ count: list.length, list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   PUBLIC:  PREMIUM PURCHASE  (called by main Groups server)
════════════════════════════════════════════════════════════════ */
app.post("/api/premium-purchase", async (req, res) => {
  const {
    telegramId, buyerName, buyerUsername,
    groupOwnerId, groupOwnerName, groupName,
    passcode, secretKey
  } = req.body;

  if (!secretKey || secretKey !== ADMIN_PASSWORD)
    return res.status(401).json({ error: "Unauthorized" });
  if (!telegramId)
    return res.status(400).json({ error: "Missing buyer Telegram ID" });

  const err1 = validatePasscode(telegramId, passcode);
  if (err1) {
    const lockMsg = failPasscode(telegramId);
    return res.status(400).json({ error: lockMsg || err1 });
  }
  consumePasscode(telegramId);

  try {
    const usdRate = await fetchNgnPerUsd();
    const { balances, sha } = await readBalances();

    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
    const ownerHasAccount = groupOwnerId && groupOwnerId !== telegramId;
    if (ownerHasAccount && !balances[groupOwnerId]) balances[groupOwnerId] = { ngn: 0 };

    if (balances[telegramId].ngn < PREMIUM_COST) {
      const shortfall = PREMIUM_COST - balances[telegramId].ngn;
      return res.status(400).json({
        error: `Insufficient balance. Need ₦${PREMIUM_COST.toLocaleString()}, ` +
               `have ₦${balances[telegramId].ngn.toLocaleString()}. ` +
               `Deposit ₦${shortfall.toLocaleString()} more.`
      });
    }

    balances[telegramId].ngn -= PREMIUM_COST;
    const newBuyerBalance = balances[telegramId].ngn;
    const buyerUsd        = parseFloat((newBuyerBalance / usdRate).toFixed(2));

    let newOwnerBalance = null, ownerUsd = null;
    if (ownerHasAccount) {
      balances[groupOwnerId].ngn += OWNER_SHARE;
      newOwnerBalance = balances[groupOwnerId].ngn;
      ownerUsd        = parseFloat((newOwnerBalance / usdRate).toFixed(2));
    }

    await writeBalances(balances, sha,
      `Premium: buyer=${telegramId}${ownerHasAccount ? ` owner=${groupOwnerId}` : ""}`);

    await sendTelegram(
      `🎉 <b>You are now Premium!</b>\n\n` +
      `⭐ Unlimited messaging in all groups.\n` +
      `💰 ₦${PREMIUM_COST.toLocaleString()} deducted.\n` +
      `💳 New balance: ₦${newBuyerBalance.toLocaleString()} ($${buyerUsd})\n\n` +
      `Enjoy your upgrade, ${buyerName}!`,
      telegramId
    );

    if (ownerHasAccount) {
      await sendTelegram(
        `💰 <b>Earnings Alert!</b>\n\n` +
        `${buyerName} bought Premium in <b>${groupName || "your group"}</b>.\n` +
        `You earned ₦${OWNER_SHARE.toLocaleString()} (50%) 🎉\n` +
        `💳 New balance: ₦${newOwnerBalance.toLocaleString()} ($${ownerUsd})`,
        groupOwnerId
      );
    }

    await sendTelegram(
      `⭐ <b>PREMIUM PURCHASE</b>\n` +
      `👤 ${buyerName} (@${buyerUsername || "N/A"})\n` +
      `🆔 <code>${telegramId}</code>\n` +
      `💰 Paid: ₦${PREMIUM_COST.toLocaleString()}\n` +
      `💳 Buyer bal: ₦${newBuyerBalance.toLocaleString()} ($${buyerUsd})\n` +
      (ownerHasAccount
        ? `🏠 Group: ${groupName || "N/A"}\n` +
          `👑 Owner: <code>${groupOwnerId}</code> earned ₦${OWNER_SHARE.toLocaleString()}\n` +
          `💳 Owner bal: ₦${newOwnerBalance.toLocaleString()} ($${ownerUsd})`
        : `🌐 Direct purchase`),
      ADMIN_ID
    );

    res.json({
      success: true, message: "🎉 Premium activated!",
      newBuyerBalance, buyerUsd, newOwnerBalance, ownerUsd,
      premiumCostNgn:   PREMIUM_COST,
      premiumCostUsd:   parseFloat((PREMIUM_COST / usdRate).toFixed(2)),
      ownerEarnedNgn:   ownerHasAccount ? OWNER_SHARE : 0,
      ownerEarnedUsd:   ownerHasAccount ? parseFloat((OWNER_SHARE / usdRate).toFixed(2)) : 0,
    });
  } catch (err) {
    console.error("premium-purchase:", err.message);
    res.status(500).json({ error: "Purchase failed: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ADMIN:  GET BALANCE
════════════════════════════════════════════════════════════════ */
app.post("/admin/get-balance", async (req, res) => {
  if (!authAdmin(req, res)) return;
  const { telegramId } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  try {
    const { balances } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
    const usdRate = await fetchNgnPerUsd();
    const ngn     = balances[telegramId].ngn;
    res.json({ ngn, usd: parseFloat((ngn / usdRate).toFixed(2)), usdRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ADMIN:  UPDATE BALANCE  (deposit / manual withdraw)
════════════════════════════════════════════════════════════════ */
app.post("/admin/update-balance", async (req, res) => {
  if (!authAdmin(req, res)) return;
  const { telegramId, amount, type } = req.body;
  if (!telegramId || amount == null || !type)
    return res.status(400).json({ error: "Invalid request" });

  try {
    const { balances, sha } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    const prev = balances[telegramId].ngn;
    const amt  = Number(amount);

    if (type === "deposit")  balances[telegramId].ngn += amt;
    if (type === "withdraw") {
      if (balances[telegramId].ngn < amt)
        return res.status(400).json({ error: "Insufficient balance" });
      balances[telegramId].ngn -= amt;
    }

    await writeBalances(balances, sha, `Admin ${type} for ${telegramId}`);

    const usdRate = await fetchNgnPerUsd();
    const newNgn  = balances[telegramId].ngn;

    await sendTelegram(
      `🛠 <b>ADMIN ACTION</b>\n` +
      `User: <code>${telegramId}</code>\n` +
      `Action: ${type.toUpperCase()}\n` +
      `Amount: ₦${amt.toLocaleString()}\n` +
      `Before: ₦${prev.toLocaleString()}\n` +
      `After:  ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`,
      ADMIN_ID
    );

    await sendTelegram(
      type === "deposit"
        ? `💰 <b>Deposit Received!</b>\n\n` +
          `✅ ₦${amt.toLocaleString()} credited to your account.\n` +
          `💳 New Balance: ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`
        : `💸 <b>Balance Updated</b>\n\n` +
          `✅ ₦${amt.toLocaleString()} deducted.\n` +
          `💳 New Balance: ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`,
      telegramId
    );

    res.json({ newBalance: newNgn, usd: parseFloat((newNgn / usdRate).toFixed(2)), usdRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   START
════════════════════════════════════════════════════════════════ */
app.listen(PORT, () => console.log(`✅ Intel Promo Server running on port ${PORT}`));