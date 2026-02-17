import express from "express";
import fetch from "node-fetch";
import FormData from "form-data"; // <-- NEW

const router = express.Router();

const {
  BOT_TOKEN,
  ADMIN_ID
} = process.env;

/* =========================
   HELPER FUNCTIONS
========================= */
async function sendTelegramPhoto(chatId, caption, base64Image) {
  if (!BOT_TOKEN || !chatId) return;

  // Remove base64 prefix (data:image/png;base64,...)
  const base64Data = base64Image.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");

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
  if (!result.ok) console.error("Telegram sendPhoto failed:", result);
  return result;
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(chatId),
      text,
      parse_mode: "HTML"
    })
  });

  const result = await res.json();
  if (!result.ok) console.error("Telegram sendMessage failed:", result);
  return result;
}

/* =========================
   SUBMIT TASK OR PAYMENT
========================= */
router.post("/unlock-promo", async (req, res) => {
  const { telegramId, name, username, method, whatsapp, call, image, type } = req.body;

  if (!telegramId || !image || !type) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const caption = `
<b>🟢 New ${type === "task" ? "Task" : "Payment"} Submission</b>
Name: ${name}
Username: ${username}
ID: ${telegramId}
Method: ${method || "-"}
WhatsApp: ${whatsapp || "-"}
Call: ${call || "-"}
`;

  try {
    // Send to admin
    await sendTelegramPhoto(ADMIN_ID, caption, image);

    // Notify user
    await sendTelegramMessage(telegramId, `✅ Your ${type} submission has been received.\nThe admin will review it and approve soon.`);

    res.json({ success: true, message: "Sent to admin and user notified" });
  } catch (err) {
    console.error("Error in /unlock-promo:", err);
    res.status(500).json({ error: "Failed to send submission" });
  }
});

export default router;