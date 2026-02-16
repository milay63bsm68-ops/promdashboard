import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());

// Allow cross-origin requests
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-admin-password"]
}));

const {
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  BALANCE_FILE,
  TELEGRAM_BOT_TOKEN,
  ADMIN_ID,
  PORT
} = process.env;

// ---------------- ADMIN AUTH ----------------
function auth(req, res, next) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized: Wrong admin password" });
  }
  next();
}

// ---------------- READ BALANCES ----------------
async function readBalances() {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  );
  if (!r.ok) throw new Error("GitHub read failed");
  const f = await r.json();
  const content = Buffer.from(f.content, "base64").toString();
  const jsonString = content.replace("window.USER_BALANCES =", "").trim();
  return { balances: JSON.parse(jsonString), sha: f.sha };
}

// ---------------- SEND TELEGRAM MESSAGE ----------------
async function sendTelegram(chatId, text, replyMarkup = null) {
  if (!chatId) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(chatId),
      text,
      reply_markup: replyMarkup
    })
  });
}

// ---------------- SEND TELEGRAM PHOTO ----------------
async function sendTelegramPhoto(chatId, imageBase64, caption, replyMarkup = null) {
  if (!chatId || !imageBase64) return;
  const photo = imageBase64.split(",")[1]; // remove base64 header
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(chatId),
      photo,
      caption,
      reply_markup: replyMarkup
    })
  });
}

// ---------------- USD RATE ----------------
async function getUSDRate() {
  try {
    const r = await fetch("https://api.exchangerate.host/convert?from=NGN&to=USD");
    const d = await r.json();
    return d?.info?.rate || 0.002;
  } catch {
    return 0.002;
  }
}

/* ---------------- PUBLIC USER BALANCE ---------------- */
app.post("/get-balance", async (req, res) => {
  try {
    const { telegramId } = req.body;
    const { balances } = await readBalances();
    const ngn = balances[telegramId]?.ngn || 0;
    const rate = await getUSDRate();
    res.json({ ngn, usd: +(ngn * rate).toFixed(2), usdRate: rate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- ADMIN NOTIFICATION ---------------- */
app.post("/notify-admin", async (req, res) => {
  await sendTelegram(ADMIN_ID, `📢 Message from WebApp:\n${req.body.message}`);
  res.json({ success: true });
});

/* ---------------- USER WITHDRAWAL ---------------- */
app.post("/withdraw", async (req, res) => {
  try {
    const { telegramId, method, amount, details } = req.body;

    const { balances } = await readBalances();
    const rate = await getUSDRate();

    if (amount > (balances[telegramId]?.ngn || 0))
      return res.status(400).json({ error: "Insufficient balance" });

    const text =
`📢 *Withdrawal Request*
User: ${telegramId}
Method: ${method}
Amount: ₦${amount}
Details: ${JSON.stringify(details)}`;

    const keyboard = {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `approve_${telegramId}_${amount}` },
        { text: "❌ Reject", callback_data: `reject_${telegramId}_${amount}` }
      ]]
    };

    await sendTelegram(ADMIN_ID, text, keyboard);
    await sendTelegram(telegramId, "⏳ Withdrawal submitted. Awaiting admin decision.");

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- TELEGRAM CALLBACK HANDLER ---------------- */
app.post("/telegram-webhook", async (req, res) => {
  const cb = req.body.callback_query;
  if (!cb) return res.sendStatus(200);

  const [action, telegramId, amount] = cb.data.split("_");

  if (action === "approve") {
    await sendTelegram(telegramId, `✅ Your withdrawal of ₦${amount} has been APPROVED.`);
    await sendTelegram(ADMIN_ID, `✅ Approved withdrawal for ${telegramId}`);
  }

  if (action === "reject") {
    await sendTelegram(telegramId, `❌ Your withdrawal of ₦${amount} was REJECTED.`);
    await sendTelegram(ADMIN_ID, `❌ Rejected withdrawal for ${telegramId}`);
  }

  // Answer callback
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id })
  });

  res.sendStatus(200);
});

/* ---------------- ADMIN IMAGE NOTIFICATION (TASK/PAYMENT) ---------------- */
app.post("/notify-admin-image", async (req, res) => {
  try {
    const { message, image, telegramId } = req.body;
    if (!message || !image) return res.status(400).json({ error: "Message and image required" });

    // Add Approve/Reject buttons for promo submissions
    const keyboard = {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `promo_approve_${telegramId}` },
        { text: "❌ Reject", callback_data: `promo_reject_${telegramId}` }
      ]]
    };

    await sendTelegramPhoto(ADMIN_ID, image, message, keyboard);

    res.json({ success: true });
  } catch (e) {
    console.error("Notify admin image error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- START SERVER ---------------- */
const serverPort = PORT || 3000;
app.listen(serverPort, () =>
  console.log(`Admin server running on port ${serverPort}`)
);