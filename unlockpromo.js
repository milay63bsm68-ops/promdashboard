import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const {
  BOT_TOKEN,
  ADMIN_ID
} = process.env;

/* =========================
   HELPER FUNCTIONS
========================= */
async function sendTelegramPhoto(chatId, caption, base64Image) {
  if(!BOT_TOKEN || !chatId) return;
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
  return res.json();
}

async function sendTelegramMessage(chatId, text) {
  if(!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      chat_id:Number(chatId),
      text,
      parse_mode: "HTML"
    })
  });
}

/* =========================
   SUBMIT TASK OR PAYMENT
========================= */
router.post("/unlock-promo", async (req,res)=>{
  const { telegramId, name, username, method, whatsapp, call, image, type } = req.body;

  if(!telegramId || !image || !type){
    return res.status(400).json({error:"Missing required fields"});
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

  try{
    // Send to admin
    await sendTelegramPhoto(ADMIN_ID, caption, image);

    // Notify user
    await sendTelegramMessage(telegramId, `✅ Your ${type} submission has been received.\nThe admin will review it and approve soon.`);

    res.json({success:true, message:"Sent to admin and user notified"});
  }catch(err){
    console.error(err);
    res.status(500).json({error:"Failed to send submission"});
  }
});

export default router;