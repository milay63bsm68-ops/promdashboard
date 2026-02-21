/**
 * ============================================================
 *  BALANCE SERVER  —  promdashboard.onrender.com (OLD RENDER)
 *  Handles: balances, withdrawals, passcodes, admin actions
 *  NEW:  /api/premium-purchase  — called automatically by the
 *         main Groups server when a user buys premium.
 *         Deducts ₦5,000 from buyer, credits ₦2,500 to the
 *         group owner (50% of the premium price).
 * ============================================================
 */

import express  from "express";
import fetch    from "node-fetch";
import cors     from "cors";
import dotenv   from "dotenv";
import path     from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

/* Allow ALL origins and all needed methods so both the
   main Groups server and the HTML pages can call us */
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"] }));
app.use(express.json({ limit: "25mb" }));

const {
  BOT_TOKEN,
  ADMIN_ID,
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  BALANCE_FILE
} = process.env;

/* ═══════════════════════════ CONSTANTS ══════════════════════════ */
const PREMIUM_COST  = 5000;   // ₦ — what the buyer pays
const OWNER_SHARE   = 2500;   // ₦ — 50 % goes to the group owner

/* ═══════════════════════════ TELEGRAM ═══════════════════════════ */
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

/* ═══════════════════════════ GITHUB BALANCES ════════════════════ */
async function readBalances() {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  );
  if (!r.ok) throw new Error("GitHub read failed: " + r.status);
  const f       = await r.json();
  const content = Buffer.from(f.content, "base64").toString();
  return {
    balances: JSON.parse(content.replace("window.USER_BALANCES =", "").trim()),
    sha: f.sha
  };
}

async function writeBalances(balances, sha, message) {
  const content = "window.USER_BALANCES = " + JSON.stringify(balances, null, 2);
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    {
      method:  "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        sha,
        content: Buffer.from(content).toString("base64")
      })
    }
  );
  if (!r.ok) throw new Error("GitHub write failed: " + r.status);
}

/* ═══════════════════════════ EXCHANGE RATE ══════════════════════ */
/** Returns how many NGN = 1 USD  (e.g. 1600) */
async function fetchNgnPerUsd() {
  try {
    const r    = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await r.json();
    const rate = data?.rates?.NGN;
    if (rate && rate > 100) return rate;
    return 1600;
  } catch {
    return 1600;
  }
}

/** Returns how many USD = 1 NGN  (e.g. 0.000625) */
async function fetchUsdPerNgn() {
  const ngnPerUsd = await fetchNgnPerUsd();
  return 1 / ngnPerUsd;
}

/* ═══════════════════════════ ADMIN AUTH ═════════════════════════ */
function authAdmin(req, res) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ═══════════════════════════ PASSCODES ══════════════════════════ */
const passcodes = {};   // { telegramId: { passcode, expiresAt } }
const attempts  = {};   // { telegramId: count }

/* ═══════════════════════════ STATIC PAGES ═══════════════════════ */
app.get("/withdraw", (req, res) =>
  res.sendFile(path.join(__dirname, "withdraw.html")));
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "admin.html")));

/* ═══════════════════════════════════════════════════════════════
   PUBLIC:  GET BALANCE
   Called by both frontend pages and the main Groups server.
═══════════════════════════════════════════════════════════════ */
app.post("/get-balance", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if (!telegramId) return res.json({ ngn: 0, usd: 0, usdRate: 1600 });

  try {
    const { balances } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    const usdRate = await fetchNgnPerUsd();          // NGN per 1 USD
    const ngn     = balances[telegramId].ngn;
    const usd     = parseFloat((ngn / usdRate).toFixed(2));

    res.json({ ...balances[telegramId], ngn, usd, usdRate });
  } catch (err) {
    res.status(500).json({ error: "Failed to read balance: " + err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   PUBLIC:  GENERATE PASSCODE  (withdrawal & premium purchase)
═══════════════════════════════════════════════════════════════ */
app.post("/generate-passcode", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  const passcode  = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;   // 5 minutes

  passcodes[telegramId] = { passcode, expiresAt };
  attempts[telegramId]  = 0;

  await sendTelegram(
    `💳 Your passcode is: <b>${passcode}</b>\n\n` +
    `⚠️ IMPORTANT: Never share this with anyone.\n` +
    `✅ Use it ONLY in the trusted app @intelpremiumbot.\n` +
    `⏳ Expires in 5 minutes.`,
    telegramId
  );

  res.json({ success: true, message: "Passcode sent to your Telegram" });
});

/* ═══════════════════════════════════════════════════════════════
   PUBLIC:  WITHDRAW
═══════════════════════════════════════════════════════════════ */
app.post("/withdraw", async (req, res) => {
  const { telegramId, method, amount, details, passcode } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  /* ── Validate passcode ── */
  const record = passcodes[String(telegramId)];
  if (!record || record.passcode !== String(passcode) || record.expiresAt < Date.now()) {
    attempts[telegramId] = (attempts[telegramId] || 0) + 1;
    if (attempts[telegramId] >= 3) {
      delete passcodes[telegramId];
      attempts[telegramId] = 0;
      return res.status(400).json({ error: "Too many failed attempts. Passcode reset." });
    }
    return res.status(400).json({ error: "Invalid or expired passcode" });
  }
  attempts[telegramId] = 0;
  delete passcodes[telegramId];

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
      `✅ Withdrawal request received.\nAmount: ₦${amountNGN.toLocaleString()}${usdDisplay}`,
      telegramId
    );

    res.json({ newBalance: balances[telegramId].ngn });
  } catch (err) {
    res.status(500).json({ error: "Withdrawal failed: " + err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   NEW ★  PREMIUM PURCHASE  — called by the main Groups server
   ─────────────────────────────────────────────────────────────
   Body: { telegramId, buyerName, buyerUsername,
           groupOwnerId?, groupOwnerName?, groupName?,
           passcode, secretKey }

   Flow:
     1. Validate secretKey (server-to-server auth)
     2. Validate passcode
     3. Check buyer has ₦5,000
     4. Deduct ₦5,000 from buyer
     5. Credit ₦2,500 to group owner (if provided)
     6. Notify buyer, owner, and admin via Telegram
     7. Return { success, newBuyerBalance, newOwnerBalance?, usd }
═══════════════════════════════════════════════════════════════ */
app.post("/api/premium-purchase", async (req, res) => {
  const {
    telegramId,
    buyerName,
    buyerUsername,
    groupOwnerId,
    groupOwnerName,
    groupName,
    passcode,
    secretKey
  } = req.body;

  /* ── Server-to-server auth ── */
  if (!secretKey || secretKey !== ADMIN_PASSWORD)
    return res.status(401).json({ error: "Unauthorized" });

  if (!telegramId)
    return res.status(400).json({ error: "Missing buyer Telegram ID" });

  /* ── Validate passcode ── */
  const record = passcodes[String(telegramId)];
  if (!record || record.passcode !== String(passcode) || record.expiresAt < Date.now()) {
    attempts[telegramId] = (attempts[telegramId] || 0) + 1;
    if (attempts[telegramId] >= 3) {
      delete passcodes[telegramId];
      attempts[telegramId] = 0;
      return res.status(400).json({ error: "Too many failed attempts. Request a new code." });
    }
    return res.status(400).json({ error: "Invalid or expired passcode" });
  }
  attempts[telegramId] = 0;
  delete passcodes[telegramId];

  try {
    const usdRate = await fetchNgnPerUsd();    // NGN per 1 USD
    const { balances, sha } = await readBalances();

    /* ── Ensure records exist ── */
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
    const ownerHasAccount = groupOwnerId && groupOwnerId !== telegramId;
    if (ownerHasAccount && !balances[groupOwnerId]) balances[groupOwnerId] = { ngn: 0 };

    /* ── Check buyer balance ── */
    if (balances[telegramId].ngn < PREMIUM_COST) {
      const shortfall = PREMIUM_COST - balances[telegramId].ngn;
      return res.status(400).json({
        error: `Insufficient balance. You need ₦${PREMIUM_COST.toLocaleString()} ` +
               `but have ₦${balances[telegramId].ngn.toLocaleString()}. ` +
               `Please deposit ₦${shortfall.toLocaleString()} more.`
      });
    }

    /* ── Deduct from buyer ── */
    balances[telegramId].ngn -= PREMIUM_COST;
    const newBuyerBalance    = balances[telegramId].ngn;
    const buyerUsd           = parseFloat((newBuyerBalance / usdRate).toFixed(2));

    /* ── Credit owner ── */
    let newOwnerBalance = null;
    let ownerUsd        = null;
    if (ownerHasAccount) {
      balances[groupOwnerId].ngn += OWNER_SHARE;
      newOwnerBalance = balances[groupOwnerId].ngn;
      ownerUsd        = parseFloat((newOwnerBalance / usdRate).toFixed(2));
    }

    /* ── Persist ── */
    await writeBalances(
      balances,
      sha,
      `Premium purchase: buyer=${telegramId}${ownerHasAccount ? ` owner=${groupOwnerId}` : ""}`
    );

    /* ── Notify buyer ── */
    await sendTelegram(
      `🎉 <b>You are now Premium!</b>\n\n` +
      `⭐ Unlimited messaging in all groups.\n` +
      `💰 ₦${PREMIUM_COST.toLocaleString()} deducted.\n` +
      `💳 New balance: ₦${newBuyerBalance.toLocaleString()} ($${buyerUsd})\n\n` +
      `Enjoy your upgrade, ${buyerName}!`,
      telegramId
    );

    /* ── Notify group owner ── */
    if (ownerHasAccount) {
      await sendTelegram(
        `💰 <b>Earnings Alert!</b>\n\n` +
        `${buyerName} bought Premium in your group <b>${groupName || "a group"}</b>.\n` +
        `You earned ₦${OWNER_SHARE.toLocaleString()} (50% commission) 🎉\n` +
        `💳 New balance: ₦${newOwnerBalance.toLocaleString()} ($${ownerUsd})`,
        groupOwnerId
      );
    }

    /* ── Notify admin ── */
    await sendTelegram(
      `⭐ <b>PREMIUM PURCHASE</b>\n` +
      `👤 ${buyerName} (@${buyerUsername || "N/A"})\n` +
      `🆔 Buyer ID: <code>${telegramId}</code>\n` +
      `💰 Paid: ₦${PREMIUM_COST.toLocaleString()} ($${(PREMIUM_COST / usdRate).toFixed(2)})\n` +
      `💳 Buyer balance: ₦${newBuyerBalance.toLocaleString()} ($${buyerUsd})\n` +
      (ownerHasAccount
        ? `🏠 Group: ${groupName || "N/A"}\n` +
          `👑 Owner: ${groupOwnerName || groupOwnerId} (<code>${groupOwnerId}</code>)\n` +
          `💵 Owner earned: ₦${OWNER_SHARE.toLocaleString()} ($${(OWNER_SHARE / usdRate).toFixed(2)})\n` +
          `💳 Owner balance: ₦${newOwnerBalance.toLocaleString()} ($${ownerUsd})`
        : `🌐 Direct purchase (no group)`),
      ADMIN_ID
    );

    res.json({
      success:          true,
      message:          "🎉 Premium activated!",
      newBuyerBalance,
      buyerUsd,
      newOwnerBalance,
      ownerUsd,
      premiumCostNgn:   PREMIUM_COST,
      premiumCostUsd:   parseFloat((PREMIUM_COST / usdRate).toFixed(2)),
      ownerEarnedNgn:   ownerHasAccount ? OWNER_SHARE : 0,
      ownerEarnedUsd:   ownerHasAccount ? parseFloat((OWNER_SHARE / usdRate).toFixed(2)) : 0,
    });

  } catch (err) {
    console.error("premium-purchase error:", err.message);
    res.status(500).json({ error: "Purchase failed: " + err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   PUBLIC:  UNLOCK PROMO (existing endpoint — unchanged)
═══════════════════════════════════════════════════════════════ */
app.post("/unlock-promo", async (req, res) => {
  const { telegramId, name, username, method, whatsapp, call, image, type } = req.body;
  if (!telegramId || !image) return res.status(400).json({ error: "Missing data" });

  const caption =
    `<b>🟢 PROMO ${type === "task" ? "TASK" : "PAYMENT"} SUBMISSION</b>\n` +
    `Name: ${name}\nUsername: ${username}\nID: ${telegramId}\n` +
    `Method: ${method || "Task"}\nWhatsApp: ${whatsapp || "N/A"}\n` +
    `Call: ${call || "N/A"}\nStatus: Pending review by admin`;

  try {
    await sendTelegramPhoto(ADMIN_ID, image, caption);
    await sendTelegram(
      `✅ Your ${type} submission has been received. Admin will review it shortly.`,
      telegramId
    );
    res.json({ success: true, message: "Submission sent to admin" });
  } catch (err) {
    res.status(500).json({ error: "Failed to send submission" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN:  GET BALANCE
═══════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════
   ADMIN:  UPDATE BALANCE  (manual deposit / withdraw)
   Also called by the main server for legacy compatibility.
═══════════════════════════════════════════════════════════════ */
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

    /* ── Notify admin ── */
    await sendTelegram(
      `🛠 <b>ADMIN ACTION</b>\n` +
      `User: <code>${telegramId}</code>\n` +
      `Action: ${type.toUpperCase()}\n` +
      `Amount: ₦${amt.toLocaleString()} ($${(amt / usdRate).toFixed(2)})\n` +
      `Before: ₦${prev.toLocaleString()}\n` +
      `After:  ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`,
      ADMIN_ID
    );

    /* ── FIX: Notify the user whose balance was changed ── */
    await sendTelegram(
      type === "deposit"
        ? `💰 <b>Deposit Received!</b>\n\n` +
          `✅ ₦${amt.toLocaleString()} ($${(amt / usdRate).toFixed(2)}) has been credited to your account.\n` +
          `💳 New Balance: ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`
        : `💸 <b>Balance Updated</b>\n\n` +
          `✅ ₦${amt.toLocaleString()} ($${(amt / usdRate).toFixed(2)}) has been deducted from your account.\n` +
          `💳 New Balance: ₦${newNgn.toLocaleString()} ($${(newNgn / usdRate).toFixed(2)})`,
      telegramId
    );

    res.json({
      newBalance: newNgn,
      usd: parseFloat((newNgn / usdRate).toFixed(2)),
      usdRate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════════ */
app.listen(PORT, () => console.log(`✅ Balance server running on port ${PORT}`));
