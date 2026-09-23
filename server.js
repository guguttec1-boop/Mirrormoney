const express = require("express");
const cors = require("cors");
const multer = require("multer");
const admin = require("firebase-admin");

const app = express();
app.use(cors());

/* ---------- Firebase (from separate env vars) ---------- */
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    // Render stores "\n" as literal backslash-n; turn them into real newlines
    .replace(/\\n/g, "\n")
    .trim();

  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !privateKey ||
    !process.env.FIREBASE_DATABASE_URL
  ) {
    console.error("❌ Missing Firebase env vars. Check Render settings.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

/* ---------- Multer ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ---------- Health / keep-alive ---------- */
app.get("/", (req, res) => {
  res.json({ status: "online", message: "Telegram API is running" });
});

/* ---------- Post route ---------- */
app.post("/post-to-telegram", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No image received" });
    }

    const caption = (req.body.caption || "").trim();

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID;

    if (!botToken || !channelId) {
      return res.status(500).json({
        success: false,
        error: "Telegram configuration is missing",
      });
    }

    /* --- 1. Send to Telegram --- */
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;

    const formData = new FormData();
    formData.append("chat_id", channelId);
    if (caption) formData.append("caption", caption);
    formData.append(
      "photo",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname || "image.jpg"
    );

    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      body: formData,
    });
    const telegramResult = await telegramResponse.json();

    if (!telegramResult.ok) {
      console.error("Telegram error:", telegramResult);
      return res.status(500).json({
        success: false,
        error: telegramResult.description || "Telegram send failed",
      });
    }

    const message = telegramResult.result;
    const fileId = message.photo
      ? message.photo[message.photo.length - 1].file_id
      : null;

    /* --- 2. Save to Realtime DB --- */
    const postRef = db.ref("posts").push();
    const postData = {
      caption,
      messageId: message.message_id,
      fileId,
      channelId,
      telegramDate: message.date || null,
      createdAt: admin.database.ServerValue.TIMESTAMP,
    };

    await postRef.set(postData);

    /* --- 3. Respond --- */
    res.json({
      success: true,
      key: postRef.key,
      messageId: message.message_id,
      fileId,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ---------- Multer / generic error handler ---------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ success: false, error: "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
