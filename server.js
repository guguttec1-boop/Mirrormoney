const express = require("express");
const cors = require("cors");
const multer = require("multer");
const admin = require("firebase-admin");

const app = express();

/* ---------- CORS (explicit) ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());            // <-- handles any stray preflight

/* ---------- Request logger (fires FIRST, before anything else) ---------- */
app.use((req, res, next) => {
  console.log(`📡 ${new Date().toISOString()} ${req.method} ${req.originalUrl} | ct=${req.headers["content-type"] || "-"} | origin=${req.headers.origin || "-"}`);
  next();
});

/* ---------- Firebase ---------- */
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n").trim();

  if (!process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !privateKey ||
      !process.env.FIREBASE_DATABASE_URL) {
    console.error("❌ Missing Firebase env vars. Check Render settings.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

/* ---------- Multer (only ONE field allowed: "image") ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ---------- Health / keep-alive ---------- */
app.get("/", (req, res) => {
  res.json({ status: "online", message: "Telegram API is running" });
});

/* ---------- POST /post-to-telegram ---------- */
app.post("/post-to-telegram", (req, res, next) => {
  console.log("➡️  Reached /post-to-telegram, about to run multer");
  next();
}, upload.single("image"), async (req, res) => {
  console.log("✅ Multer done. File present:", !!req.file,
              "| size:", req.file?.size,
              "| fieldname:", req.file?.fieldname,
              "| mimetype:", req.file?.mimetype);

  try {
    if (!req.file) {
      console.warn("❌ No file received");
      return res.status(400).json({ success: false, error: "No image received" });
    }

    const caption = (req.body.caption || "").trim();
    const botToken  = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID;

    if (!botToken || !channelId) {
      console.error("❌ Missing Telegram env vars");
      return res.status(500).json({ success: false, error: "Telegram configuration missing" });
    }

    /* --- Send to Telegram --- */
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;

    const formData = new FormData();
    formData.append("chat_id", channelId);
    if (caption) formData.append("caption", caption);
    formData.append(
      "photo",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname || "image.jpg"
    );

    console.log("📤 Sending to Telegram...");
    const telegramResponse = await fetch(telegramUrl, { method: "POST", body: formData });
    const telegramResult   = await telegramResponse.json();

    if (!telegramResult.ok) {
      console.error("❌ Telegram API error:", telegramResult);
      return res.status(500).json({
        success: false,
        error: telegramResult.description || "Telegram send failed"
      });
    }

    const message  = telegramResult.result;
    const fileId   = message.photo
      ? message.photo[message.photo.length - 1].file_id
      : null;

    /* --- Build a Telegram deep-link for the post --- */
    // channelId looks like "-1004394988713"
    const numericChannel = String(channelId).replace(/^-100/, "");
    const postLink = `https://t.me/c/${numericChannel}/${message.message_id}`;

    /* --- Save to Realtime DB --- */
    const postRef = db.ref("posts").push();
    const postData = {
      caption,
      messageId: message.message_id,
      fileId,
      channelId,
      postLink,
      telegramDate: message.date || null,
      createdAt: admin.database.ServerValue.TIMESTAMP,
    };
    await postRef.set(postData);

    console.log("💾 Saved to Firebase:", postRef.key, "| link:", postLink);

    /* --- Respond with EVERYTHING the client needs --- */
    res.json({
      success: true,
      post_id:   postRef.key,
      postId:    postRef.key,
      key:       postRef.key,
      messageId: message.message_id,
      fileId:    fileId,
      postLink:  postLink,
      postText:  caption,
      channelId: channelId
    });
  } catch (error) {
    console.error("❌ Server error in /post-to-telegram:", error);
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

/* ---------- Multer / generic error handler (MUST log) ---------- */
app.use((err, req, res, next) => {
  console.error("🔥 Express error handler caught:", err.name, err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: `Multer: ${err.code} — ${err.message}` });
  }
  res.status(500).json({ success: false, error: "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
