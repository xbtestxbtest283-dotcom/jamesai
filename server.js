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

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const apiKey = String(process.env.OPENAI_API_KEY || "")
  .trim()
  .replace(/^['"]|['"]$/g, "");

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim().replace(/^["\']|["\']$/g, "");
const frontendOrigin = String(process.env.FRONTEND_ORIGIN || "").trim().replace(/\/$/, "");

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

app.use(express.json({ limit: "30mb" }));

// Allow the deployed frontend (including a separate static host) to call the API.
app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  if (origin && (!frontendOrigin || origin === frontendOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// OAuth popup callback route: this MUST be a minimal callback page.
// Do not load the full James AI app here; otherwise the callback popup
// initializes the login modal again instead of closing after posting the token.
app.get("/oauth2callback", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Google Login</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center;background:#0b0d12;color:#fff">
<div id="status">Google Login ပြန်ပို့နေပါတယ်…</div>
<script>
(() => {
  const status = document.getElementById("status");
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const credential = hash.get("id_token") || "";
    const error = hash.get("error_description") || hash.get("error") || "";
    const state = hash.get("state") || "";
    const result = JSON.stringify({ credential, error });

    // Primary handoff: postMessage to the original popup opener.
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: "JAMESAI_GOOGLE_RESULT",
        credential,
        error
      }, window.location.origin);
    }

    // Fallback handoff: same-origin localStorage. This works even when
    // Chrome strips window.opener during the Google -> localhost navigation.
    if (state) {
      localStorage.setItem("jamesai_google_handoff_" + state, result);
    }

    status.textContent = error ? "Google Login မအောင်မြင်ပါ။" : "Login အောင်မြင်ပါပြီ။ Window ပိတ်နေပါတယ်…";
    setTimeout(() => window.close(), 400);
  } catch (e) {
    status.textContent = "Google Login callback error ဖြစ်နေပါတယ်။";
  }
})();
</script></body></html>`);
});


function getBearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function verifyGoogleCredential(req) {
  const credential = getBearerToken(req);
  if (!credential || !googleClientId) return null;

  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!r.ok) return null;

    const data = await r.json();

    // Verify the token is meant for this James AI Google OAuth client.
    if (String(data.aud || "") !== googleClientId) return null;

    // tokeninfo validates expiry/signature with Google. Keep only the
    // identity information needed by the app.
    return {
      sub: String(data.sub || ""),
      email: String(data.email || ""),
      name: String(data.name || ""),
      picture: String(data.picture || ""),
      email_verified: String(data.email_verified || "") === "true"
    };
  } catch {
    return null;
  }
}

async function requireGoogleLogin(req, res, next) {
  const user = await verifyGoogleCredential(req);
  if (!user || !user.email_verified) {
    return res.status(401).json({
      ok: false,
      error: "Google Login လုပ်ပြီးမှ James AI ကို အသုံးပြုနိုင်ပါတယ်။",
      code: "GOOGLE_LOGIN_REQUIRED"
    });
  }
  req.googleUser = user;
  next();
}


app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    googleClientId
  });
});

app.post("/api/auth/google", async (req, res) => {
  const user = await verifyGoogleCredential(req);
  if (!user || !user.email_verified) {
    return res.status(401).json({
      ok: false,
      error: "Google account verification failed."
    });
  }

  res.json({
    ok: true,
    user: {
      name: user.name,
      email: user.email,
      picture: user.picture
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "James AI",
    apiConfigured: Boolean(client),
    model,
    imageModel
  });
});

app.post("/api/chat", requireGoogleLogin, async (req, res) => {
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

app.post("/api/images", requireGoogleLogin, async (req, res) => {
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
  console.log(`Google Login: ${googleClientId ? "configured" : "MISSING GOOGLE_CLIENT_ID"}`);
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