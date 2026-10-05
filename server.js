import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env")
});

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const apiKey = String(process.env.OPENAI_API_KEY || "")
  .trim()
  .replace(/^['"]|['"]$/g, "");

const model = process.env.OPENAI_MODEL || "gpt-6-luna";
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

app.use(express.json({ limit: "30mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "James AI",
    apiConfigured: Boolean(client),
    model,
    imageModel
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY မတွေ့ပါ။ .env ကိုစစ်ပါ။"
      });
    }

    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "Message is required."
      });
    }

    const response = await client.responses.create({
      model,
      instructions: `
You are James AI.

Answer naturally and accurately.
If the user writes Burmese, answer in natural Burmese.
If English, answer in English.

Help with:
- General questions
- Programming
- Study
- Translation
- Writing
- Math
- Explanations
`,
      input: message
    });

    const reply = String(response.output_text || "").trim();

    if (!reply) {
      return res.status(502).json({
        ok: false,
        error: "AI က အဖြေမပြန်လာပါ။"
      });
    }

    res.json({
      ok: true,
      name: "James AI",
      reply
    });

  } catch (error) {
    console.error("CHAT ERROR:", error);

    res.status(Number(error?.status || 500)).json({
      ok: false,
      error: String(error?.message || "Server error")
    });
  }
});

app.post("/api/images", async (req, res) => {
  try {
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY မတွေ့ပါ။"
      });
    }

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Image prompt is empty."
      });
    }

    const result = await client.images.generate({
      model: imageModel,
      prompt,
      size: "1024x1024"
    });

    const image = result?.data?.[0]?.b64_json;

    if (!image) {
      return res.status(502).json({
        ok: false,
        error: "Image data မရပါ။"
      });
    }

    res.json({
      ok: true,
      image: `data:image/png;base64,${image}`
    });

  } catch (error) {
    console.error("IMAGE ERROR:", error);

    res.status(Number(error?.status || 500)).json({
      ok: false,
      error: String(error?.message || "Image error")
    });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log("");
  console.log("=================================");
  console.log("       JAMES AI SERVER");
  console.log("=================================");
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`OpenAI: ${client ? "configured" : "MISSING"}`);
  console.log(`Model: ${model}`);
  console.log("=================================");
  console.log("");
});

server.on("error", (error) => {
  console.error("SERVER ERROR:", error);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});