import unlockPromoRoutes from "./unlockpromo.js";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());

// Allow cross-origin requests
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-admin-password"]
  })
);

const {
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  BALANCE_FILE,
  TELEGRAM_BOT_TOKEN,
  ADMIN_ID,
  PORT
} = process.env;

/* ================= ADMIN AUTH ================= */
function auth(req, res, next) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized: Wrong admin password" });
  }
  next();
}

/* ================= READ BALANCES ================= */
async function readBalances() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`
        }
      }
    );

    if (!r.ok) {
      throw new Error(`GitHub API error: ${r.status} - ${await r.text()}`);
    }

    const f = await r.json();
    const content = Buffer.from(f.content, "base64").toString();
    const jsonString = content.replace("window.USER_BALANCES =", "").trim();
    const balances = JSON.parse(jsonString);

    return { balances, sha: f.sha };
  } catch (err) {
    throw new Error("Failed to read balances: " + err.message);
  }
}

/* ================= TELEGRAM SEND ================= */
async function sendTelegram(chatId, text) {
  if (!chatId) return;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(chatId),
          text
        })
      }
    );

    const data = await res.json();
    if (!data.ok) console.warn("Telegram error:", data);
  } catch (err) {
    console.warn("Telegram message failed:", err.message);
  }
}

/* ================= USD RATE ================= */
async function getUSDRate() {
  try {
    const res = await fetch(
      "https://api.exchangerate.host/convert?from=NGN&to=USD"
    );
    const data = await res.json();
    if (data?.info?.rate) return data.info.rate;
    return 0.002;
  } catch {
    return 0.002;
  }
}

/* ================= PUBLIC USER BALANCE ================= */
app.post("/get-balance", async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) {
      return res.status(400).json({ error: "Telegram ID required" });
    }

    const { balances } = await readBalances();
    const balance = balances[telegramId]?.ngn || 0;
    const usdRate = await getUSDRate();
    const usd = +(balance * usdRate).toFixed(2);

    res.json({ ngn: balance, usd, usdRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= ADMIN NOTIFY ================= */
app.post("/notify-admin", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    await sendTelegram(ADMIN_ID, `📢 Message from WebApp:\n${message}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Notify admin error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= WITHDRAW ================= */
app.post("/withdraw", async (req, res) => {
  try {
    const { telegramId, method, amount, details } = req.body;

    if (!telegramId || !method || !amount || !details) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const { balances, sha } = await readBalances();
    const current = balances[telegramId]?.ngn || 0;
    const usdRate = await getUSDRate();

    if (method === "bank" && amount < 5000) {
      return res
        .status(400)
        .json({ error: "Minimum bank withdrawal is ₦5000" });
    }

    if (method === "crypto" && amount * usdRate < 20) {
      return res
        .status(400)
        .json({ error: "Minimum crypto withdrawal is $20" });
    }

    if (amount > current) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    balances[telegramId] = { ngn: current - amount };

    const updatedContent =
      "window.USER_BALANCES = " +
      JSON.stringify(balances, null, 2);

    const githubRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "User withdrawal",
          content: Buffer.from(updatedContent).toString("base64"),
          sha
        })
      }
    );

    if (!githubRes.ok) {
      throw new Error("Failed to update GitHub balances");
    }

    // Notify admin
    await sendTelegram(
      ADMIN_ID,
      `📢 Pending Withdrawal
User: ${telegramId}
Method: ${method}
Amount: ₦${amount}
Details: ${JSON.stringify(details)}`
    );

    // Notify user
    await sendTelegram(
      telegramId,
      `✅ Withdrawal request submitted!
Amount: ₦${amount}
Pending admin approval.`
    );

    res.json({ success: true, newBalance: balances[telegramId].ngn });
  } catch (err) {
    console.error("Withdrawal error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= REGISTER UNLOCKPROMO ================= */
unlockPromoRoutes(app);

/* ================= START SERVER ================= */
const serverPort = PORT || 3000;
app.listen(serverPort, () =>
  console.log(`Admin server running on port ${serverPort}`)
);