import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "25mb" }));

const { BOT_TOKEN, ADMIN_ID } = process.env;

/* ================= LOG ENV ================= */
console.log("=".repeat(50));
console.log("BOT_TOKEN:", BOT_TOKEN ? "SET ✅" : "MISSING ❌");
console.log("ADMIN_ID:", ADMIN_ID || "MISSING ❌");
console.log("=".repeat(50));

/* ================= SEND MESSAGE ================= */
async function sendTelegram(text, chatId) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(chatId),
          text,
          parse_mode: "HTML"
        })
      }
    );
    return await res.json();
  } catch (err) {
    console.error("❌ sendMessage error:", err.message);
    return { ok: false };
  }
}

/* ================= SEND PHOTO (via base64) ================= */
async function sendTelegramPhoto(chatId, base64Image, caption) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
    const payload = {
      chat_id: Number(chatId),
      photo: base64Image,
      caption,
      parse_mode: "HTML"
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error("❌ sendPhoto error:", err.message);
    return { ok: false, error: err.message };
  }
}

/* ================= ROUTES ================= */
app.get("/", (req, res) => {
  res.json({ status: "Server running ✅" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    botToken: BOT_TOKEN ? "SET" : "MISSING",
    adminId: ADMIN_ID || "MISSING"
  });
});

app.post("/unlock-promo", async (req, res) => {
  const {
    telegramId,
    name,
    username,
    method,
    whatsapp,
    telegramTask,
    call,
    image,
    type
  } = req.body;

  if (!BOT_TOKEN || !ADMIN_ID) {
    return res.status(500).json({ error: "Bot not configured" });
  }

  if (!telegramId || !image) {
    return res.status(400).json({ error: "Missing telegramId or image" });
  }

  const caption = `
<b>🟢 PROMO ${type === "task" ? "TASK" : "PAYMENT"}</b>
Name: ${name || "N/A"}
Username: ${username || "N/A"}
Telegram ID: ${telegramId}
Method: ${method || "N/A"}
WhatsApp: ${whatsapp || "N/A"}
Telegram Task: ${telegramTask || "N/A"}
Call: ${call || "N/A"}
Status: Pending review
`;

  try {
    const adminResult = await sendTelegramPhoto(
      ADMIN_ID,
      image,
      caption
    );

    if (!adminResult.ok) {
      throw new Error("Telegram rejected photo");
    }

    await sendTelegram(
      "✅ Your submission has been received. Admin will review it shortly.",
      telegramId
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Submission error:", err.message);
    res.status(500).json({
      error: "Failed to send submission",
      details: err.message
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});