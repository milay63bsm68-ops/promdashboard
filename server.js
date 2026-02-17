import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET","POST"] }));
app.use(express.json({ limit: "25mb" }));

const {
  BOT_TOKEN,
  ADMIN_ID,
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  BALANCE_FILE
} = process.env;

/* =========================
   TELEGRAM VERIFICATION
========================= */
function verifyTelegram(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort()
      .map(([k,v]) => `${k}=${v}`)
      .join("\n");

    const secret = crypto
      .createHash("sha256")
      .update(BOT_TOKEN)
      .digest();

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    if (hmac !== hash) return null;

    const user = JSON.parse(params.get("user"));
    return String(user.id);
  } catch {
    return null;
  }
}

/* =========================
   TELEGRAM SEND
========================= */
async function sendTelegram(text, chatId = ADMIN_ID) {
  if (!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id:Number(chatId), text })
  });
}

/* =========================
   GITHUB BALANCES
========================= */
async function readBalances() {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    { headers:{ Authorization:`token ${GITHUB_TOKEN}` } }
  );
  const f = await r.json();
  const content = Buffer.from(f.content,"base64").toString();
  return {
    balances: JSON.parse(content.replace("window.USER_BALANCES =","")),
    sha: f.sha
  };
}

async function updateBalances(balances, sha, message) {
  const content = "window.USER_BALANCES = " + JSON.stringify(balances,null,2);
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BALANCE_FILE}`,
    {
      method:"PUT",
      headers:{
        Authorization:`token ${GITHUB_TOKEN}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        message,
        sha,
        content: Buffer.from(content).toString("base64")
      })
    }
  );
}

/* =========================
   ADMIN AUTH
========================= */
function authAdmin(req,res){
  if(req.headers["x-admin-password"] !== ADMIN_PASSWORD){
    res.status(401).json({ error:"Unauthorized" });
    return false;
  }
  return true;
}

/* =========================
   SERVE FILES
========================= */
app.get("/withdraw",(req,res)=>res.sendFile(path.join(__dirname,"withdraw.html")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

/* =========================
   USER BALANCE (SAFE)
========================= */
app.post("/get-balance", async (req,res)=>{
  const telegramId = verifyTelegram(req.body.initData);
  if(!telegramId) return res.status(401).json({ ngn:0 });

  const { balances } = await readBalances();
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };
  res.json(balances[telegramId]);
});

/* =========================
   USER WITHDRAW (SAFE)
========================= */
app.post("/withdraw", async (req,res)=>{
  const { initData, amount, method, details } = req.body;
  const telegramId = verifyTelegram(initData);

  if(!telegramId) return res.status(401).json({ error:"Unauthorized" });

  const safeAmount = Number(amount);
  if(!safeAmount || safeAmount <= 0)
    return res.status(400).json({ error:"Invalid amount" });

  const { balances, sha } = await readBalances();
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };

  let amountNGN = safeAmount;
  let usdAmount = 0;

  if(method === "crypto"){
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/NGN");
    const rate = (await r.json()).rates.USD || 0.0026;
    usdAmount = safeAmount;
    amountNGN = Math.round(safeAmount / rate);
  }

  if(balances[telegramId].ngn < amountNGN)
    return res.status(400).json({ error:"Insufficient balance" });

  const before = balances[telegramId].ngn;
  balances[telegramId].ngn -= amountNGN;

  await updateBalances(balances, sha, `Withdraw ${telegramId}`);

  await sendTelegram(`💸 WITHDRAW REQUEST
User: ${telegramId}
Method: ${method}
Amount: ₦${amountNGN.toLocaleString()} ${usdAmount?`($${usdAmount})`:""}
Before: ₦${before.toLocaleString()}
After: ₦${balances[telegramId].ngn.toLocaleString()}
Details: ${JSON.stringify(details,null,2)}`);

  await sendTelegram(
    `✅ Withdrawal request received.\nAmount: ₦${amountNGN.toLocaleString()}`,
    telegramId
  );

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   START
========================= */
app.listen(PORT,()=>console.log("✅ Server running on",PORT));