import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());

// Allow cross-origin requests from anywhere
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

// Middleware to check admin password
function auth(req, res, next) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized: Wrong admin password" });
  }
  next();
}

// Read balances safely from GitHub
async function readBalances() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`GitHub API error: ${r.status} - ${text}`);
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

// Send Telegram message helper
async function sendTelegram(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    console.warn("Telegram message failed:", err.message);
  }
}

// ADMIN ROUTES
app.post("/admin/get-balance", auth, async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ error: "Telegram ID required" });

    const { balances } = await readBalances();
    const balance = balances[telegramId]?.ngn || 0;

    res.json({ ngn: balance });
  } catch (err) {
    console.error("GET balance error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/update-balance", auth, async (req, res) => {
  try {
    const { telegramId, amount, type } = req.body;
    if (!telegramId || !amount || !type) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const { balances, sha } = await readBalances();
    const current = balances[telegramId]?.ngn || 0;

    let newBalance = type === "deposit" ? current + amount : current - amount;
    if (newBalance < 0) return res.status(400).json({ error: "Insufficient balance" });

    balances[telegramId] = { ngn: newBalance };
    const updatedContent = "window.USER_BALANCES = " + JSON.stringify(balances, null, 2);

    const githubRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      {
        method: "PUT",
        headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Admin balance update", content: Buffer.from(updatedContent).toString("base64"), sha })
      }
    );
    if (!githubRes.ok) {
      const text = await githubRes.text();
      throw new Error(`GitHub update failed: ${githubRes.status} - ${text}`);
    }

    await sendTelegram(telegramId,
      type === "deposit"
        ? `💰 Deposit +₦${amount}\nNew balance: ₦${newBalance}`
        : `💸 Withdrawal -₦${amount}\nNew balance: ₦${newBalance}`
    );

    res.json({ success: true, newBalance });
  } catch (err) {
    console.error("UPDATE balance error:", err);
    res.status(500).json({ error: err.message });
  }
});

// USER WITHDRAWAL ROUTE
app.post("/withdraw", async (req, res) => {
  try {
    const { telegramId, method, amount, details } = req.body;
    if (!telegramId || !method || !amount || !details) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const { balances, sha } = await readBalances();
    const current = balances[telegramId]?.ngn || 0;

    // Use a simple API for live USD rate
    const rateRes = await fetch("https://api.exchangerate.host/convert?from=NGN&to=USD");
    const rateData = await rateRes.json();
    const usdRate = rateData?.info?.rate || 0.002; // fallback

    // Minimum withdrawal checks
    if (method === "bank" && amount < 5000) {
      return res.status(400).json({ error: "Minimum bank withdrawal is ₦5000" });
    }
    if (method === "crypto" && amount * usdRate < 20) {
      return res.status(400).json({ error: "Minimum crypto withdrawal is $20" });
    }
    if (amount > current) return res.status(400).json({ error: "Insufficient balance" });

    // Deduct balance immediately
    balances[telegramId] = { ngn: current - amount };
    const updatedContent = "window.USER_BALANCES = " + JSON.stringify(balances, null, 2);

    // Update GitHub
    const githubRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
      {
        method: "PUT",
        headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "User withdrawal", content: Buffer.from(updatedContent).toString("base64"), sha })
      }
    );
    if (!githubRes.ok) throw new Error("Failed to update GitHub balances");

    // Notify admin
    const adminText = `📢 Pending Withdrawal\nUser: ${telegramId}\nMethod: ${method}\nAmount: ₦${amount}\nDetails: ${JSON.stringify(details)}`;
    await sendTelegram(ADMIN_ID, adminText);

    // Notify user
    await sendTelegram(telegramId, `✅ Withdrawal request submitted!\nAmount: ₦${amount}\nPending admin approval.`);

    res.json({ success: true, newBalance: balances[telegramId].ngn });

  } catch (err) {
    console.error("Withdrawal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/test", async (req, res) => {
  try {
    const { balances } = await readBalances();
    res.json({ ok: true, firstUser: Object.keys(balances)[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const serverPort = PORT || 3000;
app.listen(serverPort, () => {
  console.log(`Admin server running on port ${serverPort}`);
});