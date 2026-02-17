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
   TELEGRAM SEND FUNCTION
========================= */
async function sendTelegram(text, chatId){
  if(!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id:Number(chatId), text })
  });
}

/* =========================
   GITHUB BALANCES
========================= */
async function readBalances(){
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

async function updateBalances(balances, sha, message){
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
   PASSCODE STORAGE
========================= */
const passcodes = {}; // { telegramId: { passcode, expiresAt } }
const attempts = {};  // { telegramId: number }

/* =========================
   SERVE FILES
========================= */
app.get("/withdraw",(req,res)=>res.sendFile(path.join(__dirname,"withdraw.html")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

/* =========================
   GET USER BALANCE
========================= */
app.post("/get-balance", async (req,res)=>{
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if(!telegramId) return res.json({ ngn: 0 });

  const { balances } = await readBalances();
  if(!balances[telegramId]) balances[telegramId] = { ngn:0 };

  res.json(balances[telegramId]);
});

/* =========================
   GENERATE PASSCODE
========================= */
app.post("/generate-passcode", async (req,res)=>{
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if(!telegramId) return res.status(400).json({ error:"Missing Telegram ID" });

  const passcode = Math.floor(100000 + Math.random()*900000).toString();
  const expiresAt = Date.now() + 5*60*1000; // 5 minutes

  passcodes[telegramId] = { passcode, expiresAt };
  attempts[telegramId] = 0; // reset attempts on new passcode

  // Send passcode to Telegram with strong warning
  const message = `💳 Your withdrawal passcode is: ${passcode}\n\n` +
    `⚠️ IMPORTANT: Never share this passcode with anyone.\n` +
    `✅ Use it ONLY in the trusted Telegram bot or web app @intelpremiumbot.\n` +
    `⏳ This passcode will expire in 5 minutes.`;

  await sendTelegram(message, telegramId);

  res.json({ success:true, message:"Passcode sent to your Telegram bot" });
});

/* =========================
   WITHDRAW
========================= */
app.post("/withdraw", async (req,res)=>{
  const { telegramId, method, amount, details, passcode } = req.body;
  if(!telegramId) return res.status(400).json({ error:"Missing Telegram ID" });

  const record = passcodes[telegramId];

  // Validate passcode
  if(!record || record.passcode !== passcode || record.expiresAt < Date.now()){
    attempts[telegramId] = (attempts[telegramId] || 0) + 1;

    if(attempts[telegramId] >= 3){
      delete passcodes[telegramId];
      attempts[telegramId] = 0;
      return res.status(400).json({ error:"Too many failed attempts. Passcode reset." });
    }

    return res.status(400).json({ error:"Invalid or expired passcode" });
  }

  attempts[telegramId] = 0; // reset attempts on success
  delete passcodes[telegramId]; // delete after use

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
User: ${telegramId}
Method: ${method}
Amount: ₦${amountNGN.toLocaleString()} ${usdAmount?`($${usdAmount})`:""}
Before: ₦${before.toLocaleString()}
After: ₦${balances[telegramId].ngn.toLocaleString()}
Details: ${JSON.stringify(details,null,2)}`, ADMIN_ID);

  // Notify user
  await sendTelegram(`✅ Withdrawal request received.\nAmount: ₦${amountNGN.toLocaleString()}`, telegramId);

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
Balance After: ₦${balances[telegramId].ngn.toLocaleString()}`, ADMIN_ID);

  res.json({ newBalance: balances[telegramId].ngn });
});

/* =========================
   START SERVER
========================= */
app.listen(PORT,()=>console.log("✅ Server running on port",PORT));