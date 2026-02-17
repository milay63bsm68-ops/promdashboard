import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Telegram bot token from environment
const BOT_TOKEN = process.env.BOT_TOKEN;
// Directly using your admin Telegram ID
const ADMIN_ID = 6940101627;

/* =========================
   HELPER FUNCTIONS
========================= */
async function sendTelegramPhoto(chatId, caption, base64Image, retries = 1) {
  if (!BOT_TOKEN || !chatId) return { ok: false, error: "Missing BOT_TOKEN or chatId" };

  try {
    // Telegram accepts full data URL directly
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        photo: base64Image,
        caption: caption,
        parse_mode: "HTML"
      })
    });

    const result = await res.json();
    if (!result.ok) {
      console.error("Telegram sendPhoto failed:", result);
      if (retries > 0) {
        console.log("Retrying sendPhoto...");
        return sendTelegramPhoto(chatId, caption, base64Image, retries - 1);
      }
    }
    return result;
  } catch (err) {
    console.error("Error in sendTelegramPhoto:", err);
    return { ok: false, error: err.message };
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId) return { ok: false, error: "Missing BOT_TOKEN or chatId" };

  try {
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
  } catch (err) {
    console.error("Error in sendTelegramMessage:", err);
    return { ok: false, error: err.message };
  }
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
    // Send submission to admin
    const adminResult = await sendTelegramPhoto(ADMIN_ID, caption, image);
    console.log("Admin send result:", adminResult);

    // Notify user
    const userResult = await sendTelegramMessage(
      telegramId,
      `✅ Your ${type} submission has been received.\nThe admin will review it soon.`
    );
    console.log("User send result:", userResult);

    res.json({
      success: true,
      message: "Submission processed",
      status: {
        admin: adminResult.ok ? "Sent" : `Failed: ${adminResult.error || "Unknown"}`,
        user: userResult.ok ? "Sent" : `Failed: ${userResult.error || "Unknown"}`
      }
    });
  } catch (err) {
    console.error("Error in /unlock-promo:", err);
    res.status(500).json({ error: "Failed to send submission", details: err.message });
  }
});

export default router;