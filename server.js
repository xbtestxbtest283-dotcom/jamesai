import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env")
});

const app = express();

app.use(express.json({ limit: '50mb' }));

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
const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || "").trim().replace(/^[\'"]|[\'"]$/g, "");
const maleVoiceId = String(
  process.env.ELEVENLABS_MALE_VOICE_ID || ""
).trim();

const femaleVoiceId = String(
  process.env.ELEVENLABS_FEMALE_VOICE_ID || ""
).trim();

const defaultVoiceId = String(
  process.env.ELEVENLABS_VOICE_ID || ""
).trim();
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const pollinationsApiKey = String(process.env.POLLINATIONS_API_KEY || "").trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "");
const pollinationsImageModel = process.env.POLLINATIONS_IMAGE_MODEL || "flux";
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim().replace(/^["\']|["\']$/g, "");
const frontendOrigin = String(process.env.FRONTEND_ORIGIN || "").trim().replace(/\/$/, "");

// Set DATA_DIR to a persistent mount path on your hosting provider, for example
// /var/data on Render after attaching a persistent disk. Without this variable,
// local development uses the project's ./data folder.
const DATA_DIR = path.join(__dirname, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const BUNDLED_USERS_FILE = path.join(__dirname, "data", "users.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const PLANS = {
  free: { id: "free", name: "Free", durationDays: null, messages: 30, images: 3, rolling24h: true },
  plus7: { id: "plus7", name: "Plus 7 Days", durationDays: 7, messages: 50, images: 5 },
  plus15: { id: "plus15", name: "Plus 15 Days", durationDays: 15, messages: 50, images: 5 },
  pro30: { id: "pro30", name: "Plus Pro", durationDays: 30, messages: Number(process.env.PRO_MESSAGE_LIMIT || 500), images: Number(process.env.PRO_IMAGE_LIMIT || 50) }
};

const PLAN_PRICES = {
  plus7: String(process.env.PLAN_PLUS7_PRICE || "SET PRICE"),
  plus15: String(process.env.PLAN_PLUS15_PRICE || "SET PRICE"),
  pro30: String(process.env.PLAN_PRO30_PRICE || "SET PRICE")
};
const PAYMENT_URLS = {
  plus7: String(process.env.PAYMENT_PLUS7_URL || "").trim(),
  plus15: String(process.env.PAYMENT_PLUS15_URL || "").trim(),
  pro30: String(process.env.PAYMENT_PRO30_URL || "").trim()
};
const WAVE_PAY_PHONE = String(process.env.WAVE_PAY_PHONE || "").trim();
const WAVE_PAY_NAME = String(process.env.WAVE_PAY_NAME || "").trim();
const ADMIN_PAYMENT_SECRET = String(process.env.ADMIN_PAYMENT_SECRET || "").trim();

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const SUPABASE_USERS_TABLE = "jamesai_user_data";

let users = {};
let writeQueue = Promise.resolve();

function readLocalUsers() {
  for (const file of [USERS_FILE, BUNDLED_USERS_FILE]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* try next local source */ }
  }
  return {};
}

async function initializeUserStore() {
  const localUsers = readLocalUsers();

  if (!supabase) {
    users = localUsers;
    if (process.env.NODE_ENV === "production") {
      console.warn("WARNING: Supabase user storage is not configured; using local users.json.");
    }
    return;
  }

  // Read cloud data first. If this fails, stop startup rather than accidentally
  // running with an empty local store and overwriting valid cloud records.
  const { data: rows, error } = await supabase
    .from(SUPABASE_USERS_TABLE)
    .select("google_sub,email,user_data");
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const cloudUsers = {};
  for (const row of rows || []) {
    if (row.google_sub && row.user_data && typeof row.user_data === "object") {
      cloudUsers[row.google_sub] = row.user_data;
    }
  }

  // Keep local records as a recovery/migration source; cloud version wins when
  // the same account exists in both places. Never delete the original JSON file.
  users = { ...localUsers, ...cloudUsers };

  // Upload local-only records and refresh cloud copies without changing plan/quota fields.
  const records = Object.entries(users).map(([sub, data]) => ({
    google_sub: sub,
    email: String(data?.email || ""),
    user_data: data,
    updated_at: new Date().toISOString()
  }));
  for (let i = 0; i < records.length; i += 100) {
    const { error: upsertError } = await supabase
      .from(SUPABASE_USERS_TABLE)
      .upsert(records.slice(i, i + 100), { onConflict: "google_sub" });
    if (upsertError) throw new Error(`Supabase migration failed: ${upsertError.message}`);
  }

  // Keep a local backup copy too. It is not the primary store when Supabase is enabled.
  await fs.promises.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  console.log(`Supabase user store ready: ${Object.keys(users).length} user record(s) loaded.`);
}

function saveUsers() {
  writeQueue = writeQueue.then(async () => {
    // Always update the local recovery copy first.
    const tmp = `${USERS_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(users, null, 2), "utf8");
    await fs.promises.rename(tmp, USERS_FILE);

    if (supabase) {
      const records = Object.entries(users).map(([sub, data]) => ({
        google_sub: sub,
        email: String(data?.email || ""),
        user_data: data,
        updated_at: new Date().toISOString()
      }));
      for (let i = 0; i < records.length; i += 100) {
        const { error } = await supabase
          .from(SUPABASE_USERS_TABLE)
          .upsert(records.slice(i, i + 100), { onConflict: "google_sub" });
        if (error) throw new Error(error.message);
      }
    }
  }).catch(err => console.error("USER STORE ERROR:", err));
  return writeQueue;
}

function nowMs() { return Date.now(); }
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
function makeUser(user) {
  const existing = users[user.sub] || {
    sub: user.sub, email: user.email, name: user.name, picture: user.picture,
    plan: "free", planStartedAt: null, planExpiresAt: null,
    messageCount: 0, imageCount: 0, windowStartedAt: null, freeResetAt: null,
    pendingPurchase: null
  };
  existing.email = user.email; existing.name = user.name; existing.picture = user.picture;
  const now = nowMs();
  if (existing.plan !== "free" && existing.planExpiresAt && now >= existing.planExpiresAt) {
    // Paid plan has ended: return to Free and reset all paid-plan counters.
    existing.plan = "free"; existing.planStartedAt = null; existing.planExpiresAt = null;
    existing.messageCount = 0; existing.imageCount = 0; existing.windowStartedAt = null; existing.freeResetAt = null;
  }
  if (existing.plan !== "free") {
    // Paid plans get a fresh message/image quota every 24 hours while the plan is active.
    if (!existing.windowStartedAt) existing.windowStartedAt = Number(existing.planStartedAt || now);
    if (now >= Number(existing.windowStartedAt) + QUOTA_WINDOW_MS) {
      const elapsedWindows = Math.floor((now - Number(existing.windowStartedAt)) / QUOTA_WINDOW_MS);
      existing.windowStartedAt = Number(existing.windowStartedAt) + elapsedWindows * QUOTA_WINDOW_MS;
      existing.messageCount = 0;
      existing.imageCount = 0;
    }
  } else if (existing.freeResetAt && now >= existing.freeResetAt) {
    existing.messageCount = 0; existing.imageCount = 0; existing.windowStartedAt = null; existing.freeResetAt = null;
  }
  users[user.sub] = existing;
  return existing;
}
function publicPlan(u) {
  const p = PLANS[u.plan] || PLANS.free;
  const resetAt = u.plan === "free" ? u.freeResetAt : (Number(u.windowStartedAt || u.planStartedAt || nowMs()) + QUOTA_WINDOW_MS);
  return {
    id: p.id, name: p.name, messagesLimit: p.messages, imagesLimit: p.images,
    messagesUsed: u.messageCount, imagesUsed: u.imageCount,
    messagesRemaining: Math.max(0, p.messages - u.messageCount),
    imagesRemaining: Math.max(0, p.images - u.imageCount),
    expiresAt: u.plan === "free" ? null : u.planExpiresAt,
    resetAt,
    expired: false
  };
}
function planList() {
  return Object.values(PLANS).map(p => ({
    id:p.id, name:p.name, durationDays:p.durationDays, messages:p.messages, images:p.images,
    price:p.id === "free" ? "Free" : PLAN_PRICES[p.id],
    paymentUrl:p.id === "free" ? "" : PAYMENT_URLS[p.id]
  }));
}
function quotaError(user, kind) {
  const p = PLANS[user.plan] || PLANS.free;
  const used = kind === "image" ? user.imageCount : user.messageCount;
  const limit = kind === "image" ? p.images : p.messages;
  const label = kind === "image" ? "Image" : "Message";
  return {
    ok:false, code:"LIMIT_REACHED", error:`${label} limit ပြည့်သွားပါပြီ။ ${p.name} plan ကို upgrade လုပ်ပါ။`,
    usage: publicPlan(user)
  };
}
function checkQuota(user, kind) {
  const p = PLANS[user.plan] || PLANS.free;
  const used = kind === "image" ? user.imageCount : user.messageCount;
  const limit = kind === "image" ? p.images : p.messages;
  return used < limit;
}
function touchUsageWindow(user) {
  if (user.plan === "free" && !user.windowStartedAt) user.windowStartedAt = nowMs();
  if (user.plan !== "free" && !user.windowStartedAt) user.windowStartedAt = Number(user.planStartedAt || nowMs());
}
function incrementUsage(user, kind) {
  touchUsageWindow(user);
  if (kind === "image") user.imageCount += 1;
  else user.messageCount += 1;
  const p = PLANS[user.plan] || PLANS.free;
  if (user.plan === "free" && (user.messageCount >= p.messages || user.imageCount >= p.images)) {
    user.freeResetAt = nowMs() + QUOTA_WINDOW_MS;
  }
}
function paymentInfoFor(planId, user) {
  return {
    plan: planId, price: PLAN_PRICES[planId], paymentUrl: PAYMENT_URLS[planId],
    wavePayPhone: WAVE_PAY_PHONE, wavePayName: WAVE_PAY_NAME,
    instructions: WAVE_PAY_PHONE
      ? "WavePay နံပါတ်ကိုသုံးပြီး အထက်ပါပမာဏကို လွှဲပေးပါ။ ပြီးရင် Transaction ID နဲ့ ငွေလွှဲ Screenshot တင်ပြီး Submit Payment လုပ်ပါ။ Admin စစ်ပြီးမှ plan activate လုပ်ပါမယ်။"
      : PAYMENT_URLS[planId]
        ? "Payment link ကိုဖွင့်ပြီး ငွေပေးချေပါ။ Payment provider က အတည်ပြုပြီးမှ plan activate လုပ်ပါမယ်။"
        : "WavePay နံပါတ် မသတ်မှတ်ရသေးပါ။ .env ထဲမှာ WAVE_PAY_PHONE ထည့်ပါ။",
    userEmail: user.email
  };
}


const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

app.use(express.json({ limit: "30mb" }));

// Allow the deployed frontend (including a separate static host) to call the API.
app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  if (origin && (!frontendOrigin || frontendOrigin === "*" || origin === frontendOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve the complete frontend (HTML, CSS, JavaScript, icons and PWA assets).
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
  }
}));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/download", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "download.html"));
});

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
  req.appUser = makeUser(user);
  next();
}


// Stable APK download endpoint. If a built APK is bundled locally, serve it.
// Otherwise redirect to the configured release/download URL.
app.get("/download-apk", (_req, res) => {
  const candidates = [
    path.join(__dirname, "public", "james-ai.apk"),
    path.join(__dirname, "James_AI-successful.apk"),
    path.join(__dirname, "public", "downloads", "jamesai.apk")
  ];
  const apkPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!apkPath) {
    return res.status(404).type("text").send("James AI APK ဖိုင် မတွေ့ပါ။");
  }
  res.setHeader("Cache-Control", "no-store");
  return res.download(apkPath, "James-AI.apk");
});

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

  // Resolve the Google identity to the existing server-side account by stable Google sub.
  // This preserves the stored plan and quota instead of creating a client-only account.
  const appUser = makeUser(user);
  await saveUsers();

  res.json({
    ok: true,
    user: {
      sub: appUser.sub,
      name: appUser.name,
      email: appUser.email,
      picture: appUser.picture
    },
    plan: publicPlan(appUser),
    pendingPurchase: appUser.pendingPurchase || null
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


app.get("/api/plans", (_req, res) => {
  res.json({ ok: true, plans: planList() });
});

app.get("/api/usage", requireGoogleLogin, async (req, res) => {
  const user = req.appUser;
  await saveUsers();
  res.json({ ok:true, plan:publicPlan(user), plans:planList(), pendingPurchase:user.pendingPurchase || null });
});

app.post("/api/purchase", requireGoogleLogin, async (req, res) => {
  const planId = String(req.body?.planId || "").trim();
  if (!["plus7","plus15","pro30"].includes(planId)) {
    return res.status(400).json({ok:false,error:"Invalid plan."});
  }
  const user = req.appUser;
  const orderId = `JAI-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  user.pendingPurchase = {
    orderId, planId, createdAt: nowMs(), status:"pending",
    price: PLAN_PRICES[planId]
  };
  await saveUsers();
  res.json({ok:true, orderId, ...paymentInfoFor(planId,user)});
});

app.post("/api/purchase/submit", requireGoogleLogin, async (req, res) => {
  const user = req.appUser;
  const order = user.pendingPurchase;
  if (!order || order.status !== "pending") return res.status(400).json({ok:false,error:"Pending order မတွေ့ပါ။"});
  const transactionId = String(req.body?.transactionId || "").trim();
  const screenshot = String(req.body?.screenshot || "").trim();
  if (!transactionId) return res.status(400).json({ok:false,error:"Transaction ID ထည့်ပါ။"});
  if (!screenshot || !screenshot.startsWith("data:image/")) return res.status(400).json({ok:false,error:"ငွေလွှဲ Screenshot တင်ပါ။"});
  order.transactionId = transactionId;
  order.screenshot = screenshot;
  order.submittedAt = nowMs();
  order.status = "payment_submitted";
  await saveUsers();
  res.json({ok:true, message:"Payment တင်ပြီးပါပြီ။ Admin စစ်ပြီးမှ plan activate လုပ်ပါမယ်။"});
});

app.get("/api/admin/orders", async (req, res) => {
  const secret = String(req.headers["x-admin-secret"] || "").trim();
  if (!ADMIN_PAYMENT_SECRET || secret !== ADMIN_PAYMENT_SECRET) return res.status(403).json({ok:false,error:"Admin authorization failed."});
  const orders = Object.values(users).filter(u => u.pendingPurchase).map(u => ({
    sub:u.sub,email:u.email,name:u.name, ...u.pendingPurchase
  }));
  res.json({ok:true,orders});
});

app.post("/api/admin/reject", async (req, res) => {
  const secret = String(req.headers["x-admin-secret"] || req.body?.adminSecret || "").trim();
  if (!ADMIN_PAYMENT_SECRET || secret !== ADMIN_PAYMENT_SECRET) return res.status(403).json({ok:false,error:"Admin authorization failed."});
  const sub = String(req.body?.sub || "").trim();
  const user = users[sub];
  if (!user?.pendingPurchase) return res.status(404).json({ok:false,error:"Order not found."});
  user.pendingPurchase.status = "rejected";
  user.pendingPurchase.rejectedAt = nowMs();
  await saveUsers();
  res.json({ok:true});
});

app.post("/api/admin/activate", async (req, res) => {
  const secret = String(req.headers["x-admin-secret"] || req.body?.adminSecret || "").trim();
  if (!ADMIN_PAYMENT_SECRET || secret !== ADMIN_PAYMENT_SECRET) {
    return res.status(403).json({ok:false,error:"Admin authorization failed."});
  }
  const sub = String(req.body?.sub || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const planId = String(req.body?.planId || "").trim();
  if ((!sub && !email) || !PLANS[planId] || planId === "free") return res.status(400).json({ok:false,error:"Invalid user or plan."});
  const user = sub ? users[sub] : Object.values(users).find(x => String(x.email || "").toLowerCase() === email);
  if (!user) return res.status(404).json({ok:false,error:"User not found."});
  const start = nowMs();
  user.plan = planId;
  user.planStartedAt = start;
  user.planExpiresAt = start + PLANS[planId].durationDays * 24*60*60*1000;
  user.messageCount = 0;
  user.imageCount = 0;
  user.windowStartedAt = start;
  user.freeResetAt = null;
  user.pendingPurchase = null;
  await saveUsers();
  res.json({ok:true, plan:publicPlan(user)});
});

app.post("/api/chat", requireGoogleLogin, async (req, res) => {
  try {
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY မတွေ့ပါ။ .env ကိုစစ်ပါ။"
      });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const images = attachments.filter((a) => a && typeof a.type === "string" &&
      a.type.startsWith("image/") && typeof a.data === "string" &&
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(a.data)).slice(0, 6);

    if (!message && images.length === 0) {
      return res.status(400).json({ ok: false, error: "စာမေးခွန်း သို့မဟုတ် ပုံတစ်ပုံ တင်ပေးပါ။" });
    }

    const user = makeUser(req.googleUser);
    if (!checkQuota(user, "message")) return res.status(429).json(quotaError(user, "message"));

    // Pass recent conversation context, then attach images as vision inputs.
    const priorHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const input = priorHistory
      .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content }));

    const content = [];
    if (message) {
      content.push({ type: "input_text", text: message });
    } else {
      content.push({ type: "input_text", text: "ဤပုံကို စစ်ဆေးပြီး မြင်ရသောစာသားများ၊ အရာဝတ္ထုများနှင့် အရေးကြီးသောအသေးစိတ်အချက်များကို ရှင်းပြပါ။" });
    }
    for (const image of images) {
      content.push({ type: "input_image", image_url: image.data, detail: "high" });
    }
    input.push({ role: "user", content });

    const response = await client.responses.create({
      model,
      instructions: `
You are James AI, a helpful multimodal assistant.
Answer naturally and accurately. If the user writes Burmese, answer in natural Burmese; if English, answer in English.
You can analyze images supplied with the user's message. Read visible text carefully (including Burmese when legible), describe objects and scenes, and answer questions grounded in the image.
If text or details are unclear, say so rather than inventing them. Distinguish what is visible from what you infer.
Help with general questions, programming, study, translation, writing, math, explanations, OCR, and image understanding.
`,
      input
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) {
      return res.status(502).json({ ok: false, error: "AI က အဖြေမပြန်လာပါ။" });
    }

    incrementUsage(user, "message");
    await saveUsers();
    res.json({ ok: true, name: "James AI", reply, usage: publicPlan(user) });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    res.status(Number(error?.status || 500)).json({
      ok: false,
      error: String(error?.message || "Server error")
    });
  }
});


// AI recap preparation: summarizes supplied transcript/script using OpenAI.
// Video files themselves are not directly decoded here; provide transcript/subtitle text.
app.post("/api/recap", requireGoogleLogin, async (req, res) => {
  try {
    if (!client) return res.status(500).json({ ok:false, error:"OPENAI_API_KEY မတွေ့ပါ။ Render Environment ကိုစစ်ပါ။" });
    const source = String(req.body?.script || "").trim();
    const language = String(req.body?.language || "my").trim().toLowerCase();
    if (!source) return res.status(400).json({ ok:false, error:"Recap/Subtitle စာသား ထည့်ပေးပါ။ Video ကို တိုက်ရိုက်ဖတ်ခြင်း မပါသေးပါ။" });
    if (source.length > 30000) return res.status(413).json({ok:false,error:"စာသားသည် အလွန်ရှည်နေပါတယ်။ အပိုင်းခွဲပြီး ထည့်ပါ။"});
    const user = makeUser(req.googleUser);
    if (!checkQuota(user, "message")) return res.status(429).json(quotaError(user, "message"));
    const response = await client.responses.create({
      model,
      instructions: language === "en"
        ? "You are James Recap. Create a concise, accurate video recap in English from the supplied transcript/subtitles. Keep key events in order, do not invent scenes. Output: Title, Recap, and optional subtitle-ready short lines."
        : "သင်သည် James Recap ဖြစ်သည်။ ပေးထားသော ဇာတ်လမ်းစာသား/Subtitle ကို အခြေခံ၍ မြန်မာဘာသာဖြင့် သဘာဝကျပြီး နားလည်လွယ်သော Recap ရေးပါ။ ဖြစ်ရပ်များကို အစဉ်လိုက်ထားပြီး မရှိသောအဖြစ်အပျက်များ မတီထွင်ပါနှင့်။ ခေါင်းစဉ်၊ မြန်မာ Recap နှင့် လိုအပ်ပါက Subtitle အတွက် စာကြောင်းတိုများ ထုတ်ပေးပါ။",
      input: source
    });
    const recap = String(response.output_text || "").trim();
    if (!recap) return res.status(502).json({ok:false,error:"OpenAI က recap မပြန်လာပါ။"});
    incrementUsage(user, "message"); await saveUsers();
    res.json({ok:true, recap, usage:publicPlan(user)});
  } catch (error) {
    console.error("RECAP ERROR:", error);
    res.status(Number(error?.status || 500)).json({ok:false,error:String(error?.message || "Recap error")});
  }
});

// ElevenLabs v3 TTS supports Burmese (my). Set ELEVENLABS_VOICE_ID to a voice available to your account.
app.post("/api/voice", requireGoogleLogin, async (req, res) => {
  try {
    if (!elevenLabsApiKey) return res.status(500).json({ok:false,error:"ELEVENLABS_API_KEY မတွေ့ပါ။ Render Environment ကိုစစ်ပါ။"});
    const text = String(req.body?.text || "").trim();
    const maleVoiceId = String(
  process.env.ELEVENLABS_MALE_VOICE_ID || ""
).trim();

const femaleVoiceId = String(
  process.env.ELEVENLABS_FEMALE_VOICE_ID || ""
).trim();

const voiceId = String(
  process.env.ELEVENLABS_VOICE_ID ||
  femaleVoiceId ||
  maleVoiceId ||
  ""
).trim();

const elevenLabsVoiceId = voiceId;
    if (!text) return res.status(400).json({ok:false,error:"ဖတ်စေလိုသော စာသား ထည့်ပေးပါ။"});
    if (!voiceId) return res.status(400).json({ok:false,error:"ELEVENLABS_VOICE_ID ကို Render Environment မှာ ထည့်ပေးပါ။"});
    if (text.length > 5000) return res.status(413).json({ok:false,error:"စာသားသည် 5,000 characters ထက် မကျော်ရပါ။"});
    const ttsModel = process.env.ELEVENLABS_MODEL || "eleven_v3";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method:"POST",
      headers:{"xi-api-key":elevenLabsApiKey,"Content-Type":"application/json","Accept":"audio/mpeg"},
      body:JSON.stringify({text,model_id:ttsModel,voice_settings:{stability:0.5,similarity_boost:0.75}})
    });
    if (!response.ok) {
      const detail = await response.text().catch(()=> "");
      return res.status(response.status).json({ok:false,error:`ElevenLabs error (${response.status}): ${detail.slice(0,400)}`});
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.json({ok:true,audio:`data:audio/mpeg;base64,${audio.toString("base64")}`});
  } catch(error) {
    console.error("VOICE ERROR:",error);
    res.status(500).json({ok:false,error:String(error?.message || "Voice generation error")});
  }
});

app.post("/api/images", requireGoogleLogin, async (req, res) => {
  try {
    if (!pollinationsApiKey) {
      return res.status(500).json({
        ok: false,
        error: "POLLINATIONS_API_KEY မတွေ့ပါ။ .env ထဲမှာ Pollinations API key ထည့်ပါ။"
      });
    }

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    const user = makeUser(req.googleUser);
    if (!checkQuota(user, "image")) return res.status(429).json(quotaError(user, "image"));
    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Image prompt is empty."
      });
    }

    const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=${encodeURIComponent(pollinationsImageModel)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${pollinationsApiKey}` }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Pollinations image request failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Pollinations returned empty image data.");

    incrementUsage(user, "image");
    await saveUsers();
    res.json({
      ok: true,
      image: `data:${contentType};base64,${buffer.toString("base64")}`,
      usage: publicPlan(user)
    });

  } catch (error) {
    console.error("IMAGE ERROR:", error);

    res.status(Number(error?.status || 500)).json({
      ok: false,
      error: String(error?.message || "Image error")
    });
  }
});

async function startServer() {
  await initializeUserStore();
  const server = app.listen(PORT, HOST, () => {
    console.log("");
    console.log("=================================");
    console.log("       JAMES AI SERVER");
    console.log("=================================");
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`OpenAI: ${client ? "configured" : "MISSING"}`);
    console.log(`Pollinations Image: ${pollinationsApiKey ? `configured (${pollinationsImageModel})` : "MISSING API KEY"}`);
    console.log(`Google Login: ${googleClientId ? "configured" : "MISSING GOOGLE_CLIENT_ID"}`);
    console.log(`Supabase User Store: ${supabase ? "configured" : "disabled (local JSON)"}`);
    console.log(`Model: ${model}`);
    console.log("=================================");
    console.log("");
  });
  server.on("error", (error) => console.error("SERVER ERROR:", error));
}

startServer().catch(error => {
  console.error("STARTUP FAILED:", error.message);
  process.exitCode = 1;
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});
