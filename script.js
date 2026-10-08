// Leave blank when frontend and backend are deployed together (recommended).
// For GitHub Pages, set this to your deployed backend URL, e.g. https://james-ai.onrender.com
const API_BASE_URL = String(window.JAMESAI_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE_URL}${path}`;

let googleClientId = "";
let googleCredential = localStorage.getItem("jamesai_google_credential") || "";
let googleUser = JSON.parse(localStorage.getItem("jamesai_google_user") || "null");
let googleReady = false;

function isLoggedIn() {
  return Boolean(googleCredential && googleUser);
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (googleCredential) headers.Authorization = `Bearer ${googleCredential}`;
  return headers;
}

function applyAuthGate() {
  const modal = $("#accountModal");
  if (!modal) return;
  const close = $("#accountModalClose");
  const signedIn = isLoggedIn();
  modal.classList.toggle("mandatory", !signedIn);
  if (close) {
    close.classList.toggle("hidden", !signedIn);
    close.disabled = !signedIn;
  }
  document.body.classList.toggle("auth-required", !signedIn);
  if (!signedIn) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }
}

function updateAccountButton() {
  const btn = $("#accountBtn");
  const avatar = $("#accountAvatar");
  const text = $("#accountBtnText");
  if (!btn) return;
  if (isLoggedIn()) {
    const picture = googleUser?.picture || "";
    if (avatar && picture) {
      avatar.src = picture;
      avatar.classList.remove("hidden");
    }
    if (text) text.textContent = googleUser?.name || "Google Account";
    btn.title = googleUser?.email || "Google account";
  } else {
    if (avatar) { avatar.src = ""; avatar.classList.add("hidden"); }
    if (text) text.textContent = "Sign in / Sign up";
    btn.title = "Sign in / Sign up";
  }
}

async function loadGoogleConfig() {
  try {
    const r = await fetch(apiUrl("/api/config"));
    const data = await r.json();
    googleClientId = String(data.googleClientId || "").trim();
    window.JAMESAI_GOOGLE_CLIENT_ID = googleClientId;
  } catch {}
}

async function validateStoredLogin() {
  if (!googleCredential) return false;
  try {
    const r = await fetch(apiUrl("/api/auth/google"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error("invalid");
    googleUser = data.user;
    localStorage.setItem("jamesai_google_user", JSON.stringify(googleUser));
    return true;
  } catch {
    googleCredential = "";
    googleUser = null;
    localStorage.removeItem("jamesai_google_credential");
    localStorage.removeItem("jamesai_google_user");
    return false;
  }
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const form = $("#chatForm");
const input = $("#messageInput");
const messages = $("#messages");
const sendButton = $("#sendButton");
const typing = $("#typing");
const newChatBtn = $("#newChatBtn");
const sidebar = $("#sidebar");
const mobileMenuBtn = $("#mobileMenuBtn");
const fileInput = $("#fileInput");
const attachBtn = $("#attachBtn");
const attachmentPreview = $("#attachmentPreview");

let history = JSON.parse(localStorage.getItem("jamesai_history") || "[]");
let busy = false;
let pendingAttachments = [];

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function addMessage(text, role, isError = false, attachments = []) {
  const row = document.createElement("div");
  row.className = `message-row ${role}${isError ? " error" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (attachments.length) {
    const files = document.createElement("div");
    files.className = "message-attachments";
    for (const a of attachments) {
      if (a.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = a.data;
        img.alt = a.name;
        img.className = "message-image";
        files.appendChild(img);
      } else {
        const chip = document.createElement("div");
        chip.className = "file-chip";
        chip.textContent = `📎 ${a.name}`;
        files.appendChild(chip);
      }
    }
    bubble.appendChild(files);
  }

  if (text) {
    const textNode = document.createElement("div");
    textNode.className = "message-text";
    textNode.textContent = text;
    bubble.appendChild(textNode);
  }

  if (role === "ai" && text && !isError) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `
      <button type="button" class="message-action" data-action="copy" title="Copy">📋 Copy</button>
      <button type="button" class="message-action" data-action="share" title="Share">↗ Share</button>
    `;
    actions.querySelector('[data-action="copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("✅ Copied");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove();
        toast("✅ Copied");
      }
    });
    actions.querySelector('[data-action="share"]').addEventListener("click", async () => {
      if (navigator.share) {
        try { await navigator.share({ title: "James AI", text }); }
        catch (e) { if (e?.name !== "AbortError") toast("Share မလုပ်နိုင်သေးပါ။"); }
      } else {
        try {
          await navigator.clipboard.writeText(text);
          toast("📋 Share မရသေးလို့ စာကို Copy လုပ်ပေးထားပါတယ်။");
        } catch { toast("Share မရနိုင်တဲ့ browser ဖြစ်ပါတယ်။"); }
      }
    });
    bubble.appendChild(actions);
  }

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function setBusy(v) {
  busy = v;
  sendButton.disabled = v;
  input.disabled = v;
  attachBtn.disabled = v;
  typing.classList.toggle("hidden", !v);
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

function saveHistory() {
  localStorage.setItem("jamesai_history", JSON.stringify(history.slice(-60)));
}

function renderHistory() {
  const list = $("#historyList");
  if (!history.length) {
    list.innerHTML = '<div class="empty">History မရှိသေးပါ။</div>';
    return;
  }
  const groups = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user") groups.push({ q: history[i].content, a: history[i + 1]?.content || "" });
  }
  list.innerHTML = groups.slice(-30).reverse().map(x => `
    <div class="history-item">
      <strong>${escapeHtml(x.q.slice(0, 90))}</strong>
      <span>${escapeHtml(x.a.slice(0, 130))}</span>
    </div>`).join("");
}

function renderPendingAttachments() {
  if (!pendingAttachments.length) {
    attachmentPreview.classList.add("hidden");
    attachmentPreview.innerHTML = "";
    return;
  }
  attachmentPreview.classList.remove("hidden");
  attachmentPreview.innerHTML = pendingAttachments.map((a, i) => {
    const visual = a.type.startsWith("image/")
      ? `<img src="${a.data}" alt="${escapeHtml(a.name)}">`
      : `<span class="file-icon">📎</span>`;
    return `<div class="attachment-chip">${visual}<span title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span><button type="button" data-remove="${i}" aria-label="Remove">×</button></div>`;
  }).join("");

  attachmentPreview.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
    pendingAttachments.splice(Number(btn.dataset.remove), 1);
    renderPendingAttachments();
  }));
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 6 * 1024 * 1024) return reject(new Error(`${file.name} သည် 6 MB ထက်ကြီးနေပါတယ်။`));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", data: String(reader.result) });
    reader.onerror = () => reject(new Error(`${file.name} ကို ဖတ်မရပါ။`));
    reader.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  const selected = [...files].slice(0, 6 - pendingAttachments.length);
  if (!selected.length) return;
  for (const file of selected) {
    try {
      const attachment = await readFile(file);
      pendingAttachments.push(attachment);
    } catch (e) {
      toast(`⚠️ ${e.message}`);
    }
  }
  renderPendingAttachments();
  fileInput.value = "";
}

async function sendMessage(text) {
  if (!isLoggedIn()) {
    openAccountModal();
    toast("Google Login လုပ်ပြီးမှ James AI ကို အသုံးပြုနိုင်ပါတယ်။");
    return;
  }
  const message = text.trim();
  if (busy || (!message && !pendingAttachments.length)) return;

  const oldHistory = [...history];
  const attachments = pendingAttachments.map(a => ({ ...a }));
  addMessage(message, "user", false, attachments);
  history.push({ role: "user", content: message || `[${attachments.map(a => a.name).join(", ")}]` });
  setBusy(true);
  pendingAttachments = [];
  renderPendingAttachments();

  try {
    const r = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message, history: oldHistory, attachments })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || "AI request failed.");
    const reply = String(data.reply || "").trim();
    addMessage(reply || "James AI က အဖြေမပြန်နိုင်သေးပါ။", "ai");
    history.push({ role: "assistant", content: reply });
    history = history.slice(-60);
    saveHistory();
    if (data.usage) { currentUsage = data.usage; updateUsageUI(); }
  } catch (e) {
    history = oldHistory;
    addMessage("⚠️ " + e.message, "ai", true);
  } finally {
    setBusy(false);
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  const t = input.value;
  input.value = "";
  autoResize();
  sendMessage(t);
});

input.addEventListener("input", autoResize);
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFiles(fileInput.files));

function openView(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "history") renderHistory();
  if (view === "plans") loadUsage();
  sidebar.classList.remove("open");
}

$$("[data-view]").forEach(b => b.addEventListener("click", () => openView(b.dataset.view)));

function downloadApk() {
  window.location.href = apiUrl("/download-apk");
}

$$(".apk-download-btn").forEach(b => b.addEventListener("click", downloadApk));
$("#settingsDownloadApkBtn")?.addEventListener("click", downloadApk);
$$("[data-prompt]").forEach(b => b.addEventListener("click", () => {
  const p = b.dataset.prompt || "";
  if (b.dataset.view) return;
  openView("chat");
  input.value = p + " ";
  autoResize();
  input.focus();
}));
$$(".quick").forEach(b => b.addEventListener("click", () => {
  input.value = b.dataset.prompt || "";
  autoResize();
  input.focus();
}));

newChatBtn.addEventListener("click", () => {
  history = [];
  saveHistory();
  messages.innerHTML = `<div class="welcome"><img class="welcome-logo" src="jamesai-logo.jpg" alt="James AI logo"><h2>What can I help with?</h2><p>မေးချင်တာကို ရိုက်ပါ၊ James AI ကို မေးလို့ရပါတယ်။</p><div class="quick-grid">
    <button class="quick" data-prompt="Python ကို beginner အနေနဲ့ ဘယ်လိုစလေ့လာရမလဲ?">💻 Coding</button>
    <button class="quick" data-prompt="Photosynthesis ကို ရိုးရိုးရှင်းရှင်းရှင်းပြပါ။">📚 Study</button>
    <button class="quick" data-prompt="2x + 7 = 19 ကို အဆင့်လိုက်ဖြေရှင်းပေးပါ။">🧮 Math</button>
    <button class="quick" data-prompt="ဒီစာကို English လို ဘာသာပြန်ပေးပါ။">🌐 Translate</button>
  </div></div>`;
  $$(".quick").forEach(b => b.addEventListener("click", () => { input.value = b.dataset.prompt || ""; autoResize(); input.focus(); }));
  openView("chat");
});

mobileMenuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

// Account / Google Login & Sign up
const accountBtn = $("#accountBtn");
const accountModal = $("#accountModal");
const accountModalClose = $("#accountModalClose");
const googleFallbackBtn = $("#googleFallbackBtn");
const accountStatus = $("#accountStatus");

function showGoogleError(message) {
  accountStatus.textContent = message;
  toast(message);
}

function googleOAuthPopup() {
  return new Promise((resolve, reject) => {
    const redirectUri = window.location.origin + "/oauth2callback";
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("jamesai_google_nonce", nonce);
    const handoffKey = `jamesai_google_handoff_${nonce}`;
    sessionStorage.setItem("jamesai_google_handoff_key", handoffKey);

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce,
      state: nonce,
      prompt: "select_account"
    });

    const width = 500, height = 650;
    const left = Math.max(0, Math.round((screen.width - width) / 2));
    const top = Math.max(0, Math.round((screen.height - height) / 2));
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "jamesai_google_login",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) return reject(new Error("Google popup ကို Browser က block လုပ်ထားပါတယ်။"));

    let finished = false;
    const finish = (credential, error) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
      try { popup.close(); } catch {}
      try { sessionStorage.removeItem("jamesai_google_handoff_key"); } catch {}
      if (error) reject(new Error(error));
      else if (credential) resolve(credential);
      else reject(new Error("Google credential မရပါ။"));
    };

    const timer = setInterval(() => {
      try {
        const raw = localStorage.getItem(handoffKey);
        if (raw) {
          localStorage.removeItem(handoffKey);
          const result = JSON.parse(raw);
          finish(result.credential || "", result.error || "");
          return;
        }
        if (popup.closed) finish("", "Google Login ကို ပိတ်လိုက်ပါတယ်။");
      } catch {}
    }, 250);

    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "JAMESAI_GOOGLE_RESULT") return;
      finish(event.data.credential || "", event.data.error || "");
    }
    window.addEventListener("message", onMessage);
  });
}

async function renderGoogleButton() {
  if (!googleClientId) {
    googleFallbackBtn.classList.add("hidden");
    accountStatus.textContent = "Google Login မရသေးပါ — server မှာ GOOGLE_CLIENT_ID ထည့်ပါ။";
    return false;
  }

  const target = $("#googleSignInButton");
  target.innerHTML = `<button type="button" id="customGoogleLoginBtn" class="primary-btn google-custom-btn">Continue with Google</button>`;
  googleFallbackBtn.classList.add("hidden");

  $("#customGoogleLoginBtn")?.addEventListener("click", async () => {
    try {
      accountStatus.textContent = "Google account ရွေးနေပါ...";
      const credential = await googleOAuthPopup();
      if (!credential) throw new Error("Google credential မရပါ။");

      googleCredential = credential;
      const r = await fetch(apiUrl("/api/auth/google"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || "Google account verification failed.");

      googleUser = data.user;
      localStorage.setItem("jamesai_google_credential", googleCredential);
      localStorage.setItem("jamesai_google_user", JSON.stringify(googleUser));
      updateAccountButton();
      applyAuthGate();
      closeAccountModal();
      await loadUsage();
      toast("Google Login successful ✅");
    } catch (e) {
      googleCredential = "";
      googleUser = null;
      localStorage.removeItem("jamesai_google_credential");
      localStorage.removeItem("jamesai_google_user");
      showGoogleError("❌ Google Login မအောင်မြင်ပါ။ " + (e.message || ""));
    }
  });
  return true;
}

function openAccountModal() {
  accountModal.classList.remove("hidden");
  accountModal.setAttribute("aria-hidden", "false");
  applyAuthGate();
  renderGoogleButton();
}

function closeAccountModal() {
  if (!isLoggedIn()) {
    applyAuthGate();
    return;
  }
  accountModal.classList.add("hidden");
  accountModal.setAttribute("aria-hidden", "true");
}

accountBtn?.addEventListener("click", openAccountModal);
accountModalClose?.addEventListener("click", closeAccountModal);
accountModal?.addEventListener("click", e => {
  if (e.target === accountModal && isLoggedIn()) closeAccountModal();
});

googleFallbackBtn?.addEventListener("click", async () => {
  const ok = await renderGoogleButton();
  if (ok) {
    try {
      window.google.accounts.id.prompt();
      accountStatus.textContent = "Google account ရွေးပြီး Login ဝင်ပါ။";
    } catch {
      showGoogleError("Google Login ကို ပြန်ဖွင့်မရပါ။");
    }
  }
});

async function initAuthentication() {
  await loadGoogleConfig();
  const valid = await validateStoredLogin();
  updateAccountButton();
  applyAuthGate();

  if (!valid) {
    openAccountModal();
  } else {
    closeAccountModal();
    await loadUsage();
  }
}


let currentUsage = null;

function formatDate(ms) {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleString(); } catch { return "—"; }
}
function updateUsageUI() {
  const card = $("#usageCard");
  const hint = $("#imageQuotaHint");
  if (!currentUsage) {
    if (card) card.innerHTML = '<div class="empty">Google Login ဝင်ပြီး usage ကို ကြည့်နိုင်ပါတယ်။</div>';
    if (hint) hint.textContent = "";
    return;
  }
  const p = currentUsage;
  if (card) {
    card.innerHTML = `
      <div class="usage-top"><div><span class="usage-label">CURRENT PLAN</span><h3>${escapeHtml(p.name)}</h3></div>
      <button id="refreshUsageBtn" class="secondary-btn" type="button">↻ Refresh</button></div>
      <div class="usage-grid">
        <div><strong>${p.messagesRemaining}</strong><span>Messages left / ${p.messagesLimit}</span></div>
        <div><strong>${p.imagesRemaining}</strong><span>Images left / ${p.imagesLimit}</span></div>
      </div>
      <div class="usage-foot">${p.resetAt ? `Reset / Expire: ${escapeHtml(formatDate(p.resetAt))}` : "Free quota resets 24 hours after its usage window starts."}</div>`;
    $("#refreshUsageBtn")?.addEventListener("click", loadUsage);
  }
  if (hint) hint.textContent = `${p.imagesRemaining} image${p.imagesRemaining === 1 ? "" : "s"} left`;
}
async function loadUsage() {
  if (!isLoggedIn()) { currentUsage = null; updateUsageUI(); return; }
  try {
    const r = await fetch(apiUrl("/api/usage"), { headers: authHeaders() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || "Usage load failed");
    currentUsage = data.plan;
    updateUsageUI();
    renderPlans(data.plans || []);
  } catch (e) {
    currentUsage = null;
    updateUsageUI();
  }
}
function renderPlans(plans) {
  const grid = $("#plansGrid");
  if (!grid) return;
  grid.innerHTML = plans.map(p => {
    const current = currentUsage?.id === p.id;
    const paid = p.id !== "free";
    return `<div class="plan-card ${current ? "current" : ""}">
      <div class="plan-badge">${current ? "CURRENT" : paid ? "UPGRADE" : "DEFAULT"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="plan-price">${escapeHtml(p.price)}</div>
      <ul><li>${p.messages >= 500 ? "Limited" : p.messages} Messages</li><li>${p.images >= 50 ? "Limited" : p.images} Images</li><li>${p.durationDays ? `${p.durationDays} Days` : "24-hour rolling quota"}</li></ul>
      ${paid ? `<button class="primary-btn plan-buy-btn" data-plan="${p.id}" type="button">${p.paymentUrl ? "Buy / Pay" : "Setup Payment"}</button>` : `<button class="secondary-btn" type="button" disabled>Free Plan</button>`}
    </div>`;
  }).join("");
  grid.querySelectorAll(".plan-buy-btn").forEach(btn => btn.addEventListener("click", () => openPurchase(btn.dataset.plan, plans)));
}
async function openPurchase(planId, plans) {
  const plan = plans.find(x => x.id === planId);
  if (!plan) return;
  const modal = $("#purchaseModal"), body = $("#purchaseBody"), title = $("#purchaseTitle");
  title.textContent = `${plan.name} — Purchase`;
  body.innerHTML = `<p><strong>Price:</strong> ${escapeHtml(plan.price)}</p>
    <p><strong>Messages:</strong> ${plan.messages >= 500 ? "Limited" : plan.messages} &nbsp; <strong>Images:</strong> ${plan.images >= 50 ? "Limited" : plan.images}</p>
    <p><strong>Duration:</strong> ${plan.durationDays} days</p>
    <button id="createOrderBtn" class="primary-btn google-custom-btn" type="button">Create Order</button>
    <div id="orderResult" class="payment-result"></div>`;
  modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
  $("#createOrderBtn").addEventListener("click", async () => {
    const btn = $("#createOrderBtn"); btn.disabled = true; btn.textContent = "Creating...";
    try {
      const r = await fetch(apiUrl("/api/purchase"), { method:"POST", headers:authHeaders({"Content-Type":"application/json"}), body:JSON.stringify({planId}) });
      const data = await r.json().catch(()=>({}));
      if (!r.ok || !data.ok) throw new Error(data.error || "Order creation failed");
      const wave = data.wavePayPhone ? `<div class="wavepay-box"><strong>WavePay</strong><div class="wave-number">${escapeHtml(data.wavePayPhone)}</div>${data.wavePayName ? `<div>${escapeHtml(data.wavePayName)}</div>` : ""}<div>ပေးရန် — <strong>${escapeHtml(data.price)}</strong></div></div>` : "";
      const payment = data.paymentUrl ? `<a class="primary-btn payment-link" href="${escapeHtml(data.paymentUrl)}" target="_blank" rel="noopener">Open Payment</a>` : "";
      $("#orderResult").innerHTML = `<div class="order-box"><strong>Order ID</strong><code>${escapeHtml(data.orderId)}</code>${wave}<p>${escapeHtml(data.instructions)}</p>${payment}<label>Transaction ID<input id="paymentTxId" class="payment-input" placeholder="ဥပမာ TX123456"></label><label>ငွေလွှဲ Screenshot<input id="paymentShot" class="payment-input" type="file" accept="image/*"></label><button id="submitPaymentBtn" class="primary-btn google-custom-btn" type="button">Submit Payment</button><div id="submitPaymentStatus" class="small-note"></div></div>`;
      $("#submitPaymentBtn").addEventListener("click", async () => {
        const tx = $("#paymentTxId").value.trim(); const file = $("#paymentShot").files[0];
        if (!tx || !file) { $("#submitPaymentStatus").textContent = "Transaction ID နဲ့ Screenshot နှစ်ခုလုံးလိုပါတယ်။"; return; }
        const reader = new FileReader();
        reader.onload = async () => {
          try { const r2 = await fetch(apiUrl("/api/purchase/submit"), {method:"POST", headers:authHeaders({"Content-Type":"application/json"}), body:JSON.stringify({transactionId:tx,screenshot:reader.result})}); const d2=await r2.json(); if(!r2.ok||!d2.ok) throw new Error(d2.error||"Submit failed"); $("#submitPaymentStatus").textContent=d2.message; $("#submitPaymentBtn").disabled=true; } catch(e) { $("#submitPaymentStatus").textContent=e.message; }
        }; reader.readAsDataURL(file);
      });
    } catch(e) {
      $("#orderResult").innerHTML = `<p class="payment-warn">${escapeHtml(e.message)}</p>`;
    } finally { btn.disabled = false; btn.textContent = "Create Order"; }
  });
}
$("#purchaseClose")?.addEventListener("click", () => { const m=$("#purchaseModal"); m.classList.add("hidden"); m.setAttribute("aria-hidden","true"); });
$("#purchaseModal")?.addEventListener("click", e => { if (e.target.id === "purchaseModal") e.target.classList.add("hidden"); });

$("#generateImageBtn")?.addEventListener("click", async () => {
  if (!isLoggedIn()) return openAccountModal();
  const prompt = ($("#imagePrompt")?.value || "").trim();
  if (!prompt) return toast("Image prompt ရေးပါ။");
  const btn = $("#generateImageBtn"); btn.disabled = true; btn.textContent = "Generating...";
  try {
    const r = await fetch(apiUrl("/api/images"), { method:"POST", headers:authHeaders({"Content-Type":"application/json"}), body:JSON.stringify({prompt}) });
    const data = await r.json().catch(()=>({}));
    if (!r.ok || !data.ok) {
      if (data.usage) { currentUsage = data.usage; updateUsageUI(); }
      throw new Error(data.error || "Image generation failed");
    }
    currentUsage = data.usage || currentUsage; updateUsageUI();
    const result = $("#generatedImageResult");
    result.classList.remove("hidden");
    result.innerHTML = `<img src="${data.image}" alt="Generated image"><div class="image-actions"><a class="primary-btn" href="${data.image}" download="james-ai-generated.png">⬇ Download</a></div>`;
  } catch(e) { toast("⚠️ " + e.message); }
  finally { btn.disabled = false; btn.textContent = "✨ Generate Image"; }
});


const photoInput = $("#photoEditorInput");
const photoCanvas = $("#photoCanvas");
const photoCtx = photoCanvas.getContext("2d");
let photoImage = null;
let photoRotation = 0;
let photoText = "";

function updatePhotoLabels() {
  $("#brightnessValue").textContent = `${$("#brightnessControl").value}%`;
  $("#contrastValue").textContent = `${$("#contrastControl").value}%`;
  $("#grayscaleValue").textContent = `${$("#grayscaleControl").value}%`;
}

function drawPhoto() {
  if (!photoImage) return;
  const angle = ((photoRotation % 360) + 360) % 360;
  const swap = angle === 90 || angle === 270;
  const w = photoImage.naturalWidth || photoImage.width;
  const h = photoImage.naturalHeight || photoImage.height;
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const iw = Math.max(1, Math.round(w * scale));
  const ih = Math.max(1, Math.round(h * scale));
  photoCanvas.width = swap ? ih : iw;
  photoCanvas.height = swap ? iw : ih;
  photoCtx.save();
  photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  photoCtx.filter = `brightness(${$("#brightnessControl").value}%) contrast(${$("#contrastControl").value}%) grayscale(${$("#grayscaleControl").value}%)`;
  photoCtx.translate(photoCanvas.width / 2, photoCanvas.height / 2);
  photoCtx.rotate(angle * Math.PI / 180);
  photoCtx.drawImage(photoImage, -iw / 2, -ih / 2, iw, ih);
  photoCtx.filter = "none";
  if (photoText) {
    const size = Math.max(24, Math.round(Math.min(photoCanvas.width, photoCanvas.height) / 13));
    photoCtx.font = `700 ${size}px Arial, sans-serif`;
    photoCtx.textAlign = "center";
    photoCtx.textBaseline = "middle";
    photoCtx.lineWidth = Math.max(3, size / 12);
    photoCtx.strokeStyle = "rgba(0,0,0,.8)";
    photoCtx.fillStyle = "white";
    photoCtx.strokeText(photoText, 0, photoCanvas.height * 0.42);
    photoCtx.fillText(photoText, 0, photoCanvas.height * 0.42);
  }
  photoCtx.restore();
}

function setPhotoStatus(text) {
  $("#photoEditorStatus").textContent = text;
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("ပုံဖိုင်ကိုပဲ ရွေးပါ။");
  if (file.size > 20 * 1024 * 1024) return toast("Photo သည် 20 MB ထက်မကြီးရပါ။");
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      photoImage = img;
      photoRotation = 0;
      photoText = "";
      $("#photoTextInput").value = "";
      $("#photoEmpty").classList.add("hidden");
      drawPhoto();
      setPhotoStatus(`Loaded: ${file.name}`);
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
  photoInput.value = "";
});

["brightnessControl", "contrastControl", "grayscaleControl"].forEach(id => {
  $(`#${id}`).addEventListener("input", () => { updatePhotoLabels(); drawPhoto(); });
});

$("#rotateLeftBtn").addEventListener("click", () => { if (!photoImage) return toast("Photo အရင်ရွေးပါ။"); photoRotation -= 90; drawPhoto(); });
$("#rotateRightBtn").addEventListener("click", () => { if (!photoImage) return toast("Photo အရင်ရွေးပါ။"); photoRotation += 90; drawPhoto(); });
$("#addPhotoTextBtn").addEventListener("click", () => {
  if (!photoImage) return toast("Photo အရင်ရွေးပါ။");
  photoText = $("#photoTextInput").value.trim();
  drawPhoto();
});

$("#clearPhotoBtn").addEventListener("click", () => {
  photoImage = null; photoRotation = 0; photoText = "";
  $("#photoTextInput").value = "";
  $("#brightnessControl").value = 100; $("#contrastControl").value = 100; $("#grayscaleControl").value = 0;
  updatePhotoLabels();
  photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  $("#photoEmpty").classList.remove("hidden");
  setPhotoStatus("ပုံတစ်ပုံရွေးပြီး စတင်ပါ။");
});

$("#downloadPhotoBtn").addEventListener("click", () => {
  if (!photoImage) return toast("Photo အရင်ရွေးပါ။");
  const type = $("#photoFormat").value;
  const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  photoCanvas.toBlob(blob => {
    if (!blob) return toast("Photo export မလုပ်နိုင်ပါ။");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `james-ai-photo.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPhotoStatus("Photo ကို သိမ်းပြီးပါပြီ။");
  }, type, 0.92);
});

updatePhotoLabels();

$("#clearHistoryBtn").addEventListener("click", () => {
  history = [];
  saveHistory();
  renderHistory();
  toast("History cleared.");
});

window.addEventListener("load", () => {
  renderPendingAttachments();
});


initAuthentication();
