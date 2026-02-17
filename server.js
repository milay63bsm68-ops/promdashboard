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

    const secret = crypto.createHash("sha256").update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

    if (hmac !== hash) return null;

    const user = JSON.parse(params.get("user"));
    return { id: String(user.id), first_name: user.first_name, username: user.username };
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
   USER BALANCES
========================= */
app.post("/get-balance", async (req,res)=>{
  const { balances } = await readBalances();
  // If admin wants to check for a dashboard with Telegram ID
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if(!telegramId) return res.json({ ngn: 0 });
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };
  res.json(balances[telegramId]);
});

/* =========================
   PASSCODE STORAGE
========================= */
const passcodes = {}; // { telegramId: { passcode, expiresAt } }

/* =========================
   GENERATE PASSCODE
========================= */
app.post("/generate-passcode", async (req,res)=>{
  const initData = req.body.initData;
  const user = verifyTelegram(initData);
  if(!user) return res.status(401).json({ error:"Unauthorized: Telegram verification failed" });

  const telegramId = user.id;

  // Generate 6-digit random passcode
  const passcode = Math.floor(100000 + Math.random()*900000).toString();
  const expiresAt = Date.now() + 5*60*1000; // 5 minutes validity

  passcodes[telegramId] = { passcode, expiresAt };

  // Send passcode via Telegram
  await sendTelegram(`💳 Your withdrawal passcode is: ${passcode}`, telegramId);

  res.json({ success:true, message:"Passcode generated and sent via Telegram" });
});

/* =========================
   WITHDRAW
========================= */
app.post("/withdraw", async (req,res)=>{
  const { initData, method, amount, details, passcode } = req.body;
  const user = verifyTelegram(initData);
  if(!user) return res.status(401).json({ error:"Unauthorized: Telegram verification failed" });

  const telegramId = user.id;

  // Validate passcode
  const record = passcodes[telegramId];
  if(!record || record.passcode !== passcode || record.expiresAt < Date.now()){
    return res.status(400).json({ error:"Invalid or expired passcode" });
  }

  const safeAmount = Number(amount);
  if(!safeAmount || safeAmount <= 0) return res.status(400).json({ error:"Invalid amount" });

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

  // Notify admin
  await sendTelegram(`💸 WITHDRAW REQUEST
User: ${telegramId} (${user.username || "N/A"})
Name: ${user.first_name || "N/A"}
Method: ${method}
Amount: ₦${amountNGN.toLocaleString()} ${usdAmount?`($${usdAmount})`:""}
Before: ₦${before.toLocaleString()}
After: ₦${balances[telegramId].ngn.toLocaleString()}
Details: ${JSON.stringify(details,null,2)}`);

  // Notify user
  await sendTelegram(`✅ Withdrawal request received.\nAmount: ₦${amountNGN.toLocaleString()}`, telegramId);

  // Delete used passcode
  delete passcodes[telegramId];

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   ADMIN ENDPOINTS
========================= */
app.post("/admin/get-balance", async (req,res)=>{
  if(!authAdmin(req,res)) return;
  const { telegramId } = req.body;
  if(!telegramId) return res.status(400).json({error:"Missing Telegram ID"});

  const { balances } = await readBalances();
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };
  res.json(balances[telegramId]);
});

app.post("/admin/update-balance", async (req,res)=>{
  if(!authAdmin(req,res)) return;
  const { telegramId, amount, type } = req.body;
  if(!telegramId || !amount || !type) return res.status(400).json({error:"Invalid request"});

  const { balances, sha } = await readBalances();
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };

  const prev = balances[telegramId].ngn;

  if(type==="deposit") balances[telegramId].ngn += amount;
  if(type==="withdraw"){
    if(balances[telegramId].ngn < amount) return res.status(400).json({error:"Insufficient balance"});
    balances[telegramId].ngn -= amount;
  }

  await updateBalances(balances, sha, `Admin ${type} for ${telegramId}`);

  await sendTelegram(`🛠 ADMIN ACTION
User: ${telegramId}
Action: ${type.toUpperCase()}
Amount: ₦${amount.toLocaleString()}
Balance Before: ₦${prev.toLocaleString()}
Balance After: ₦${balances[telegramId].ngn.toLocaleString()}`);

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   START SERVER
========================= */
app.listen(PORT,()=>console.log("✅ Server running on port",PORT));