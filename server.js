import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "25mb" }));

/* =========================
   SIMPLE IN-MEMORY STORAGE
   ========================= */
const balances = {}; // { telegramId: { ngn: number } }

/* =========================
   HELPERS
   ========================= */
function authAdmin(req, res) {
  const pass = req.headers["x-admin-password"];
  if (!pass || pass !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized admin access" });
    return false;
  }
  return true;
}

async function sendTelegram(text, imageBase64 = null) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.ADMIN_ID;

  if (!token || !chatId) return;

  if (imageBase64) {
    const base64 = imageBase64.split(",")[1];
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        caption: text,
        photo: base64
      })
    });
  } else {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });
  }
}

/* =========================
   USER BALANCE
   ========================= */
app.post("/get-balance", (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) return res.json({ ngn: 0 });

  if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
  res.json(balances[telegramId]);
});

/* =========================
   ADMIN – LOAD BALANCE
   ========================= */
app.post("/admin/get-balance", (req, res) => {
  if (!authAdmin(req, res)) return;

  const { telegramId } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
  res.json(balances[telegramId]);
});

/* =========================
   ADMIN – DEPOSIT / WITHDRAW
   ========================= */
app.post("/admin/update-balance", (req, res) => {
  if (!authAdmin(req, res)) return;

  const { telegramId, amount, type } = req.body;
  if (!telegramId || !amount || !type)
    return res.status(400).json({ error: "Invalid request" });

  if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

  if (type === "deposit") {
    balances[telegramId].ngn += amount;
  }

  if (type === "withdraw") {
    if (balances[telegramId].ngn < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    balances[telegramId].ngn -= amount;
  }

  sendTelegram(
    `🛠 ADMIN ACTION
User: ${telegramId}
Action: ${type.toUpperCase()}
Amount: ₦${amount.toLocaleString()}
New Balance: ₦${balances[telegramId].ngn.toLocaleString()}`
  );

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   USER WITHDRAW
   ========================= */
app.post("/withdraw", async (req, res) => {
  const { telegramId, amount, method, details } = req.body;

  if (!telegramId || !amount || !method)
    return res.status(400).json({ error: "Invalid withdrawal request" });

  if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

  if (balances[telegramId].ngn < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  balances[telegramId].ngn -= amount;

  await sendTelegram(
    `💸 WITHDRAW REQUEST
User: ${telegramId}
Method: ${method}
Amount: ₦${amount.toLocaleString()}

Details:
${JSON.stringify(details, null, 2)}`
  );

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   ADMIN NOTIFY (TEXT)
   ========================= */
app.post("/notify-admin", async (req, res) => {
  const { message } = req.body;
  await sendTelegram(message);
  res.json({ success: true });
});

/* =========================
   ADMIN NOTIFY (IMAGE)
   ========================= */
app.post("/notify-admin-image", async (req, res) => {
  const { message, image } = req.body;
  await sendTelegram(message, image);
  res.json({ success: true });
});

/* =========================
   START SERVER
   ========================= */
app.listen(PORT, () => {
  console.log("API running on port " + PORT);
});