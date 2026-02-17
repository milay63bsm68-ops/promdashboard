import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import FormData from "form-data";  // ✅ needed for FormData
import { Buffer } from "buffer";   // ✅ needed for base64 → binary

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
   TELEGRAM SEND FUNCTIONS
========================= */
async function sendTelegram(text, chatId){
  if(!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id:Number(chatId), text, parse_mode:"HTML" })
  });
}

// ✅ Send photo via FormData (binary) — Telegram prefers this over base64 in JSON
async function sendTelegramPhoto(chatId, caption, base64Image, retries = 1) {
  if(!BOT_TOKEN || !chatId) return { ok:false, error:"Missing BOT_TOKEN or chatId" };

  try {
    const base64Data = base64Image.split(",")[1];       // Remove "data:image/png;base64,"
    const buffer = Buffer.from(base64Data, "base64");   // Convert to binary

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", buffer, { filename: "submission.png" });

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });

    const result = await res.json();
    if(!result.ok && retries>0){
      console.log("Retrying sendPhoto...");
      return sendTelegramPhoto(chatId, caption, base64Image, retries-1);
    }
    return result;
  } catch(err){
    console.error("Error in sendTelegramPhoto:", err);
    return { ok:false, error:err.message };
  }
}

/* =========================
   ... REST OF YOUR CODE (balances, withdraw, admin, unlock-promo) ...
   REMAIN THE SAME AS YOUR ORIGINAL SERVER.JS
========================= */

app.listen(PORT,()=>console.log("✅ Server running on port",PORT));