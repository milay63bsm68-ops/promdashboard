import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "25mb" }));

const { BOT_TOKEN, ADMIN_ID, GITHUB_TOKEN, GITHUB_REPO, BALANCE_FILE } = process.env;

/* =========================
   SEND TELEGRAM MESSAGE
========================= */
async function sendTelegram(text, chatId = ADMIN_ID) {
  if (!BOT_TOKEN || !chatId) return;
  chatId = Number(chatId);

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const result = await r.json();
    if (!result.ok) console.error("Telegram sendMessage error:", result);
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

/* =========================
   GITHUB BALANCE FUNCTIONS
========================= */
async function readBalances() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    if (!r.ok) throw new Error(`GitHub read error: ${r.status}`);
    const f = await r.json();
    const content = Buffer.from(f.content, "base64").toString();
    const balances = JSON.parse(content.replace("window.USER_BALANCES =", "").trim());
    return { balances, sha: f.sha };
  } catch (err) {
    console.error("Failed to read balances:", err.message);
    return { balances: {}, sha: null };
  }
}

async function updateBalancesOnGitHub(balances, sha, message = "Update balances") {
  if (!sha) return false;
  const content = "window.USER_BALANCES = " + JSON.stringify(balances, null, 2);
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    {
      method: "PUT",
      headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: Buffer.from(content).toString("base64"), sha })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub update failed: ${res.status} - ${text}`);
  }
  return true;
}

/* =========================
   SERVE WITHDRAW HTML
========================= */
app.get("/withdraw", (req, res) => {
  res.sendFile(path.join(__dirname, "withdraw.html"));
});

/* =========================
   GET USER BALANCE
========================= */
app.post("/get-balance", async (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) return res.json({ ngn: 0 });

  try {
    const { balances } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };
    res.json(balances[telegramId]);
  } catch {
    res.json({ ngn: 0 });
  }
});

/* =========================
   USER WITHDRAW
========================= */
app.post("/withdraw", async (req, res) => {
  const { telegramId, amount, method, details } = req.body;

  if (!telegramId || !amount || !method) {
    return res.status(400).json({ error: "Invalid withdrawal request" });
  }

  try {
    const { balances, sha } = await readBalances();
    if (!balances[telegramId]) balances[telegramId] = { ngn: 0 };

    const prevBalance = balances[telegramId].ngn;
    if (prevBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    balances[telegramId].ngn -= amount;
    await updateBalancesOnGitHub(balances, sha, `User withdrawal: ${telegramId}`);

    // Notify admin
    await sendTelegram(
      `💸 WITHDRAW REQUEST
User: ${telegramId}
Method: ${method}
Amount: ₦${amount.toLocaleString()}
Balance Before: ₦${prevBalance.toLocaleString()}
Balance After: ₦${balances[telegramId].ngn.toLocaleString()}
Details: ${JSON.stringify(details, null, 2)}`
    );

    // Notify user
    await sendTelegram(
      `✅ Your withdrawal request of ₦${amount.toLocaleString()} has been submitted and is pending admin approval.`,
      telegramId
    );

    res.json({ newBalance: balances[telegramId].ngn });
  } catch (err) {
    console.error("Withdrawal error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});