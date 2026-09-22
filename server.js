const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

app.use(cors());

app.get("/", (req, res) => {
    res.json({
        status: "online",
        message: "Telegram API is running"
    });
});

app.post(
    "/post-to-telegram",
    upload.single("image"),
    async (req, res) => {

        try {

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: "No image received"
                });
            }

            const caption = req.body.caption || "";

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const channelId = process.env.TELEGRAM_CHANNEL_ID;

            if (!botToken || !channelId) {
                return res.status(500).json({
                    success: false,
                    error: "Telegram configuration is missing"
                });
            }

            const telegramUrl =
                `https://api.telegram.org/bot${botToken}/sendPhoto`;

            const formData = new FormData();

            formData.append(
                "chat_id",
                channelId
            );

            formData.append(
                "caption",
                caption
            );

            formData.append(
                "photo",
                new Blob(
                    [req.file.buffer],
                    { type: req.file.mimetype }
                ),
                req.file.originalname
            );

            const telegramResponse =
                await fetch(telegramUrl, {
                    method: "POST",
                    body: formData
                });

            const telegramResult =
                await telegramResponse.json();

            if (!telegramResult.ok) {

                console.error(
                    "Telegram error:",
                    telegramResult
                );

                return res.status(500).json({
                    success: false,
                    error: telegramResult.description
                });
            }

            const message =
                telegramResult.result;

            res.json({
                success: true,
                messageId: message.message_id,
                fileId: message.photo
                    ? message.photo[message.photo.length - 1].file_id
                    : null
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Server error"
            });
        }
    }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
