import fetch from "node-fetch";

export default function unlockPromoRoutes(app) {
  const { TELEGRAM_BOT_TOKEN, ADMIN_ID } = process.env;

  async function sendMessage(chatId, text) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text
      })
    });
  }

  async function sendPhoto(chatId, base64Image, caption) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        photo: base64Image,
        caption
      })
    });
  }

  // ===============================
  // UNLOCK PROMO ENDPOINT
  // ===============================
  app.post("/unlockpromo/submit", async (req, res) => {
    try {
      const { message, image, telegramId } = req.body;

      if (!message || !image || !telegramId) {
        return res.status(400).json({ error: "Missing data" });
      }

      // Send to ADMIN
      await sendPhoto(ADMIN_ID, image, message);

      // Send confirmation to USER
      await sendMessage(
        telegramId,
        "✅ Your request has been received.\nPlease wait while admin reviews it."
      );

      res.json({ success: true });

    } catch (err) {
      console.error("UnlockPromo error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}