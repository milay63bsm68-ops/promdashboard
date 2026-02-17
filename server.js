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
   GET BALANCE
========================= */
app.post("/get-balance", async (req,res)=>{
  const telegramId = req.body.telegramId;
  if(!telegramId) return res.json({ ngn: 0 });

  const { balances } = await readBalances();
  if (!balances[telegramId]) balances[telegramId] = { ngn:0 };

  res.json(balances[telegramId]);
});

/* =========================
   WITHDRAWAL PASSCODES
========================= */
const passcodes = {}; // { "user123": "123456" }

function generatePasscode(userId){
  const code = Math.floor(100000 + Math.random()*900000); // 6-digit
  passcodes[userId] = code.toString();
  // Auto expire after 10 minutes
  setTimeout(()=>delete passcodes[userId], 10*60*1000);
  return code;
}

/* =========================
   GENERATE PASSCODE
========================= */
app.post("/generate-passcode", async (req,res)=>{
  const { telegramId } = req.body;
  if(!telegramId) return res.status(400).json({error:"Missing user ID"});
  const code = generatePasscode(telegramId);
  // Optionally send code via Telegram if BOT_TOKEN is set
  await sendTelegram(`🔑 Your withdrawal code: ${code}`, telegramId);
  res.json({ passcode: code });
});

/* =========================
   USER WITHDRAW (PASSCODE)
========================= */
app.post("/withdraw", async (req,res)=>{
  const { telegramId, passcode, amount, method, details } = req.body;

  if(!telegramId || !passcode) 
    return res.status(401).json({ error:"User ID and passcode required" });

  if(!passcodes[telegramId] || passcodes[telegramId] !== passcode)
    return res.status(401).json({ error:"Invalid or expired passcode" });

  delete passcodes[telegramId]; // consume passcode

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