import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const {
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  BALANCE_FILE,
  TELEGRAM_BOT_TOKEN
} = process.env;

function auth(req, res, next) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function readBalances() {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  );
  const f = await r.json();

  const balances = eval(
    Buffer.from(f.content, "base64")
      .toString()
      .replace("window.USER_BALANCES =", "")
  );

  return { balances, sha: f.sha };
}

app.post("/admin/get-balance", auth, async (req, res) => {
  const { telegramId } = req.body;
  const { balances } = await readBalances();
  res.json({ ngn: balances[telegramId]?.ngn || 0 });
});

app.post("/admin/update-balance", auth, async (req, res) => {
  const { telegramId, amount, type } = req.body;

  const { balances, sha } = await readBalances();
  const current = balances[telegramId]?.ngn || 0;

  let newBalance =
    type === "deposit"
      ? current + amount
      : current - amount;

  if (newBalance < 0) {
    return res.json({ error: "Insufficient balance" });
  }

  balances[telegramId] = { ngn: newBalance };

  const updated =
    "window.USER_BALANCES = " +
    JSON.stringify(balances, null, 2);

  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Admin balance update",
        content: Buffer.from(updated).toString("base64"),
        sha
      })
    }
  );

  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text:
          type === "deposit"
            ? `💰 Deposit +₦${amount}\nNew balance: ₦${newBalance}`
            : `💸 Withdrawal -₦${amount}\nNew balance: ₦${newBalance}`
      })
    }
  );

  res.json({ success: true, newBalance });
});

app.listen(3000, () => {
  console.log("Admin server running");
});