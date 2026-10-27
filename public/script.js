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
const chatPhotoInput = $("#photoInput");
const attachBtn = $("#attachBtn");
const attachMenu = $("#attachMenu");
const cameraInput = $("#cameraInput");
const photosInput = $("#photosInput");
const documentsInput = $("#documentsInput");
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
async function openLiveCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Camera အသုံးပြုရန် HTTPS ဖြင့် ဖွင့်ပေးပါ။");
    return;
  }

  let stream = null;
  let facingMode = "environment";
  let flashOn = false;
  let closed = false;

  const svg = (paths) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const flashOnSvg = svg('<path d="M13 2 4.5 13h6L10 22l9.5-12h-6L13 2Z"/>');
  const flashOffSvg = svg('<path d="M13 2 4.5 13h6L10 22l9.5-12h-6L13 2Z"/><path d="m3 3 18 18"/>');
  const switchSvg = svg('<path d="M20 7h-5l2.5-2.5"/><path d="M4 17h5l-2.5 2.5"/><path d="M5 9a7 7 0 0 1 12-3l.5.5M19 15a7 7 0 0 1-12 3l-.5-.5"/>');
  const closeSvg = svg('<path d="m18 6-12 12M6 6l12 12"/>');
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Camera");
  modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:transparent;overflow:hidden;color:#fff;font-family:inherit;";

  const preview = document.createElement("div");
  preview.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:60vh;min-height:360px;max-height:calc(100dvh - 180px);overflow:hidden;border-radius:30px 30px 0 0;background:#000;";
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;background:#000;";

  const buttonStyle = "position:absolute;display:flex;align-items:center;justify-content:center;width:58px;height:58px;border:0;border-radius:50%;background:rgba(30,30,30,.72);color:#fff;box-shadow:0 2px 8px #0002;padding:0;cursor:pointer; -webkit-tap-highlight-color:transparent;";
  const flash = document.createElement("button");
  flash.type = "button";
  flash.setAttribute("aria-label", "Flash off");
  flash.title = "Flash";
  flash.style.cssText = buttonStyle + "right:20px;top:calc(50% - 88px);";
  flash.innerHTML = flashOffSvg;

  const switchCamera = document.createElement("button");
  switchCamera.type = "button";
  switchCamera.setAttribute("aria-label", "Switch camera");
  switchCamera.title = "Switch camera";
  switchCamera.style.cssText = buttonStyle + "right:20px;top:calc(50% - 12px);";
  switchCamera.innerHTML = switchSvg;

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.setAttribute("aria-label", "Close camera");
  cancel.title = "Close camera";
  cancel.style.cssText = buttonStyle + "right:20px;bottom:20px;";
  cancel.innerHTML = closeSvg;

  const back = document.createElement("button");
  back.type = "button";
  back.setAttribute("aria-label", "Back");
  back.style.cssText = buttonStyle + "left:20px;bottom:20px;";
  back.innerHTML = svg('<path d="m15 18-6-6 6-6"/>');

  const take = document.createElement("button");
  take.type = "button";
  take.setAttribute("aria-label", "Take photo");
  take.title = "Take photo";
  take.style.cssText = "position:absolute;left:50%;bottom:20px;transform:translateX(-50%);width:84px;height:84px;border:7px solid rgba(255,255,255,.25);border-radius:50%;background:#fff;box-shadow:0 2px 8px #0004;cursor:pointer;";

  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.style.cssText = "position:absolute;left:18px;right:90px;top:14px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.5);font-size:13px;display:none;";

  preview.append(video, flash, switchCamera, cancel, back, take, notice);
  modal.append(preview);
  document.body.append(modal);

  function stopStream() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }
  function closeCamera() {
    if (closed) return;
    closed = true;
    stopStream();
    modal.remove();
  }
  function showNotice(message) {
    notice.textContent = message;
    notice.style.display = "block";
    window.setTimeout(() => { if (!closed) notice.style.display = "none"; }, 2600);
  }
  async function startCamera() {
    stopStream();
    flashOn = false;
    flash.innerHTML = flashOffSvg;
    flash.setAttribute("aria-label", "Flash off");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false
      });
      if (closed) { stopStream(); return; }
      video.srcObject = stream;
      video.style.transform = facingMode === "user" ? "scaleX(-1)" : "none";
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.();
      flash.disabled = !(caps && "torch" in caps && caps.torch);
      flash.style.opacity = flash.disabled ? ".55" : "1";
      flash.title = flash.disabled ? "ဒီကင်မရာမှာ Flash မပံ့ပိုးပါ" : "Flash";
    } catch (error) {
      if (!closed) showNotice(error.name === "NotAllowedError" ? "Camera Permission ကို Allow လုပ်ပေးပါ။" : "Camera ဖွင့်မရပါ။ HTTPS နှင့် Camera Permission ကို စစ်ပါ။");
    }
  }

  flash.onclick = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track?.getCapabilities?.();
      if (!caps || !("torch" in caps) || !caps.torch) {
        showNotice("ဒီဖုန်း/ကင်မရာက Flash ကို မပံ့ပိုးပါ။");
        return;
      }
      flashOn = !flashOn;
      await track.applyConstraints({ advanced: [{ torch: flashOn }] });
      flash.innerHTML = flashOn ? flashOnSvg : flashOffSvg;
      flash.setAttribute("aria-label", flashOn ? "Flash on" : "Flash off");
    } catch (_) {
      flashOn = false;
      flash.innerHTML = flashOffSvg;
      flash.setAttribute("aria-label", "Flash off");
      showNotice("Flash မဖွင့်နိုင်ပါ။ ဒီ browser သို့မဟုတ် ကင်မရာက မပံ့ပိုးနိုင်ပါ။");
    }
  };

  switchCamera.onclick = async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    await startCamera();
  };
  cancel.onclick = closeCamera;
  back.onclick = closeCamera;
  take.onclick = async () => {
    if (!video.videoWidth || !stream) {
      showNotice("Camera ဖွင့်နေဆဲပါ။ ခဏစောင့်ပါ။");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (facingMode === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) { showNotice("ဓာတ်ပုံရိုက်မရပါ။ ထပ်စမ်းပါ။"); return; }
    const photo = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    closeCamera();
    handleFiles([photo]);
  };

  await startCamera();
}
function closeAttachMenu() {
  attachMenu.classList.add("hidden");
  attachBtn.setAttribute("aria-expanded", "false");
}
attachBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = attachMenu.classList.contains("hidden");
  attachMenu.classList.toggle("hidden", !opening);
  attachBtn.setAttribute("aria-expanded", String(opening));
});
attachMenu.addEventListener("click", async (event) => {
  const option = event.target.closest("[data-attach]");
  if (!option) return;

  event.stopPropagation();
  const type = option.dataset.attach;
  closeAttachMenu();

  if (type === "camera") {
    await openLiveCamera();
    return;
  }

  const target = {
    photos: photosInput,
    files: documentsInput
  }[type];

  if (target) target.click();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".attach-menu-wrap")) closeAttachMenu();
});
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
[cameraInput, photosInput, documentsInput].forEach((picker) => {
  picker.addEventListener("change", () => {
    if (picker.files?.length) handleFiles(picker.files);
    picker.value = "";
  });
});
cameraInput.addEventListener("change", () => {
  handleFiles(cameraInput.files);
  cameraInput.value = "";
});
function openView(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "history") renderHistory();
  if (view === "plans") loadUsage();
  sidebar.classList.remove("open");
}

$$("[data-view]").forEach(b => b.addEventListener("click", () => openView(b.dataset.view)));
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
    <button class="quick" data-prompt="Python ကို beginner အနေနဲ့ ဘယ်လိုစလေ့လာရမလဲ?"><svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 8l-2 2 2 2m10-4 2 2-2 2m-4-5-2 6"/></svg> Coding</button>
    <button class="quick" data-prompt="Photosynthesis ကို ရိုးရိုးရှင်းရှင်းရှင်းပြပါ။"><svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></svg> Study</button>
    <button class="quick" data-prompt="2x + 7 = 19 ကို အဆင့်လိုက်ဖြေရှင်းပေးပါ။"><svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2"/></svg> Math</button>
    <button class="quick" data-prompt="ဒီစာကို English လို ဘာသာပြန်ပေးပါ။"><svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg> Translate</button>
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
    // Keep the generated data URL on the button and download it as a Blob.
    // This is more reliable on Android browsers than downloading a data: URL directly.
    result.innerHTML = `<img src="${data.image}" alt="Generated image"><div class="image-actions"><button type="button" class="primary-btn" id="downloadGeneratedImageBtn">⬇ Download</button></div>`;
    const downloadButton = $("#downloadGeneratedImageBtn");
    downloadButton.addEventListener("click", () => {
      try {
        const match = String(data.image || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
        if (!match) throw new Error("Generated image data is invalid.");
        const mimeType = match[1];
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
        link.href = url;
        link.download = `james-ai-generated.${ext}`;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast("ပုံ Download လုပ်ရန် စတင်လိုက်ပါပြီ။");
      } catch (error) {
        console.error("GENERATED IMAGE DOWNLOAD ERROR:", error);
        toast("Download မရပါ။ ပုံကို ဖိထားပြီး Save image ကို စမ်းပါ။");
      }
    });
  } catch(e) { toast("⚠️ " + e.message); }
  finally { btn.disabled = false; btn.innerHTML = '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg> Generate Image'; }
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


// James Recap + ElevenLabs voiceover integration
function setupRecapUI() {
  const moviePanel = document.querySelector('#movieRecapPanel');
  const voicePanel = document.querySelector('#voiceClonePanel');
  document.querySelector('#openMovieRecap')?.addEventListener('click', () => moviePanel?.classList.toggle('hidden'));
  document.querySelector('#openVoiceClone')?.addEventListener('click', () => voicePanel?.classList.toggle('hidden'));

  document.querySelector('#recapVideoFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0], status = document.querySelector('#recapStatus');
    if (f && status) status.textContent = `ရွေးထားသော video: ${f.name}. AI recap အတွက် transcript/subtitle စာသားကို ထည့်ပေးပါ။`;
  });
  document.querySelector('#voiceSampleFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0], status = document.querySelector('#voiceStatus');
    if (f && status) status.textContent = `ရွေးထားသော audio: ${f.name}. Browser TTS သို့မဟုတ် API အသံကို အသုံးပြုနိုင်ပါတယ်။`;
  });

  document.querySelector('#prepareRecapBtn')?.addEventListener('click', async () => {
    const script = document.querySelector('#recapScript')?.value.trim();
    const status = document.querySelector('#recapStatus');
    if (!script) { if(status) status.textContent = 'Recap/Subtitle စာသား ထည့်ပေးပါ။ Video file ကို တိုက်ရိုက် decode မလုပ်နိုင်သေးပါ။'; return; }
    const btn = document.querySelector('#prepareRecapBtn');
    btn.disabled = true; if(status) status.textContent = 'OpenAI နဲ့ recap ပြင်ဆင်နေပါတယ်…';
    try {
      const r = await fetch(apiUrl('/api/recap'), {method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({script, language:document.querySelector('#recapLanguage')?.value || 'my'})});
      const d = await r.json().catch(()=>({}));
      if(!r.ok || !d.ok) throw new Error(d.error || 'Recap မအောင်မြင်ပါ။');
      document.querySelector('#recapScript').value = d.recap;
      if(status) status.textContent = 'Recap အောင်မြင်ပါပြီ။ စာသားကို ပြင်ဆင်နိုင်ပါတယ်။';
     } catch(e) {
      if (status) status.textContent = `Recap API မအောင်မြင်ပါ: ${e.message}. OpenAI/API ချိတ်ဆက်မှုကို စစ်ပါ။`;
    }
    finally { btn.disabled = false; }
  });

  document.querySelector('#prepareVoiceBtn')?.addEventListener('click', async () => {
    const text = document.querySelector('#voiceText')?.value.trim();
    const status = document.querySelector('#voiceStatus');
    if (!text) { if(status) status.textContent = 'ဖတ်စေလိုသော စာသား ထည့်ပေးပါ။'; return; }
    const btn = document.querySelector('#prepareVoiceBtn');
    btn.disabled = true; if(status) status.textContent = 'AI voice API ကို စမ်းသပ်နေပါတယ်…';
    try {
      const r = await fetch(apiUrl('/api/voice'), {method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({text, language:document.querySelector('#voiceLanguage')?.value || 'my', voice:document.querySelector('#voiceGender')?.value || 'female'})});
      const d = await r.json().catch(()=>({}));
      if(!r.ok || !d.ok) throw new Error(d.error || 'Voiceover မအောင်မြင်ပါ။');
      let player = document.querySelector('#jamesVoiceAudio');
      if(!player) { player = document.createElement('audio'); player.id='jamesVoiceAudio'; player.controls=true; player.style.display='block'; player.style.width='100%'; btn.insertAdjacentElement('afterend',player); }
      player.src = d.audio;
      if(status) status.textContent = 'အသံဖန်တီးပြီးပါပြီ။ အောက်မှာ နားထောင်နိုင်ပြီး download လုပ်နိုင်ပါတယ်။';
      let link = document.querySelector('#jamesVoiceDownload');
      if(!link) { link=document.createElement('a'); link.id='jamesVoiceDownload'; link.textContent='Download voiceover (MP3)'; link.className='primary-btn'; link.style.display='inline-block'; player.insertAdjacentElement('afterend',link); }
      link.href=d.audio; link.download='james-voiceover.mp3';
    } catch(e) {
      // Free fallback: browser/OS voices. This previews speech only; it cannot create an MP3.
      if ('speechSynthesis' in window && window.SpeechSynthesisUtterance) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          const language = document.querySelector('#voiceLanguage')?.value || 'my';
          const gender = document.querySelector('#voiceGender')?.value || 'female';
          const langPrefix = language === 'my' ? 'my' : 'en';
          const voices = window.speechSynthesis.getVoices();
          const matching = voices.filter(v => (v.lang || '').toLowerCase().startsWith(langPrefix));
          const genderPattern = gender === 'male' ? /male|man|thiha|ko/i : /female|woman|nilar|yin/i;
          const preferred = matching.find(v => genderPattern.test(v.name));
          if (preferred || matching[0]) utterance.voice = preferred || matching[0];
          utterance.lang = language === 'my' ? 'my-MM' : 'en-US';
          utterance.onstart = () => { if (status) status.textContent = `Browser TTS ဖြင့် ဖတ်နေပါသည်။ ${matching.length ? 'အသံသည် သင့်စက်တွင် ရရှိသောအသံများအပေါ် မူတည်ပါသည်။' : 'သင့်စက်တွင် သက်ဆိုင်ရာဘာသာစကားအသံ မရှိနိုင်ပါ။'} MP3 download မရပါ။`; };
          utterance.onerror = () => { if (status) status.textContent = `TTS API မအောင်မြင်ပါ (${e.message})၊ Browser အသံလည်း မဖတ်နိုင်ပါ။ မြန်မာအသံ ရရှိမှုသည် စက်/Browser ပေါ်မူတည်ပါသည်။`; };
          window.speechSynthesis.speak(utterance);
          if (status) status.textContent = `API မရပါ (${e.message})။ အခမဲ့ Browser TTS ဖြင့် ဖတ်ရန် ကြိုးစားနေပါသည်။ ဒီနည်းလမ်းသည် MP3 မထုတ်ပေးပါ။`;
        } catch (fallbackError) {
          if (status) status.textContent = `API Error: ${e.message}. Browser TTS မအောင်မြင်ပါ: ${fallbackError.message}`;
        }
      } else if (status) status.textContent = `API Error: ${e.message}. ဒီ browser မှာ Speech Synthesis မပါဝင်ပါ။`;
    }
    finally { btn.disabled = false; }
  });
}
setupRecapUI();


// Recap video export: browser-side MP4/WebM capture with optional subtitle overlay.
// Uses the selected source video and creates a downloadable WebM without changing other features.
function setupRecapVideoExport() {
  const btn = document.querySelector('#exportRecapVideoBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    const file = document.querySelector('#recapVideoFile')?.files?.[0];
    const script = document.querySelector('#recapScript')?.value?.trim() || '';
    const status = document.querySelector('#recapStatus');
    const setStatus = (s) => { if (status) status.textContent = s; };
    if (!file) { setStatus('Video file ကို အရင်ရွေးပေးပါ။'); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setStatus('ဒီ Browser မှာ Video Export မထောက်ပံ့ပါ။ Chrome သို့မဟုတ် Edge နဲ့ စမ်းပါ။'); return;
    }
    btn.disabled = true;
    let video, canvas, ctx, raf, recorder, stream, voiceAudio, voiceStream, chunks = [];
    try {
      setStatus('Video ကို ပြင်ဆင်နေပါတယ်…');
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.src = URL.createObjectURL(file);
      await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('Video ဖိုင်ကို ဖတ်မရပါ။'));});
      canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth || 1280, 1280);
      canvas.height = Math.round(canvas.width * (video.videoHeight || 720) / (video.videoWidth || 1280));
      ctx = canvas.getContext('2d');
      const draw = () => {
        if (!video || !ctx) return;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        if (document.querySelector('#recapSubtitle')?.checked && script) {
          const lines = [];
          const words = script.replace(/\s+/g,' ').split(' ');
          let line = '';
          for (const word of words) { const next = line ? line+' '+word : word;
            if (ctx.measureText(next).width > canvas.width*0.84 && line) { lines.push(line); line=word; } else line=next; }
          if (line) lines.push(line);
          const shown = lines.slice(0,3);
          ctx.fillStyle='rgba(0,0,0,.68)'; ctx.fillRect(0,canvas.height-canvas.height*.19,canvas.width,canvas.height*.19);
          ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.font=`${Math.max(18,Math.round(canvas.width*.035))}px sans-serif`;
          shown.forEach((t,i)=>ctx.fillText(t,canvas.width/2,canvas.height-canvas.height*.13+i*Math.max(22,canvas.height*.045),canvas.width*.92));
        }
        raf = requestAnimationFrame(draw);
      };
      stream = canvas.captureStream(25);
      let voiceUrl = window.jamesRecapVoiceUrl || document.querySelector('#jamesRecapVoiceAudio')?.src || '';
      if (!voiceUrl && script) {
        setStatus('ElevenLabs v3 က မြန်မာအသံ ဖန်တီးနေပါတယ်…');
        const vr = await fetch(apiUrl('/api/voice'), {
          method:'POST',
          headers:authHeaders({'Content-Type':'application/json'}),
          body:JSON.stringify({text:script, language:document.querySelector('#voiceLanguage')?.value || 'my', voice:document.querySelector('#voiceGender')?.value || 'female'})
        });
        const vd = await vr.json().catch(()=>({}));
        if (!vr.ok || !vd.ok || !vd.audio) throw new Error(vd.error || 'မြန်မာအသံ မထုတ်နိုင်ပါ။ ELEVENLABS_API_KEY နဲ့ ELEVENLABS_VOICE_ID ကို စစ်ပါ။');
        voiceUrl = vd.audio;
        window.jamesRecapVoiceUrl = voiceUrl;
        let voicePlayer = document.querySelector('#jamesRecapVoiceAudio');
        if (!voicePlayer) {
          voicePlayer = document.createElement('audio');
          voicePlayer.id='jamesRecapVoiceAudio'; voicePlayer.controls=true;
          voicePlayer.style.display='block'; voicePlayer.style.width='100%'; voicePlayer.style.marginTop='10px';
          btn.insertAdjacentElement('afterend', voicePlayer);
        }
        voicePlayer.src = voiceUrl;
      }
      if (voiceUrl) {
        voiceAudio = new Audio();
        voiceAudio.src = voiceUrl;
        voiceAudio.preload = 'auto';
        voiceAudio.crossOrigin = 'anonymous';
        await new Promise((resolve,reject) => {
          voiceAudio.oncanplaythrough = resolve;
          voiceAudio.onerror = () => reject(new Error('မြန်မာအသံဖိုင်ကို ဖတ်မရပါ။ Prepare recap + Myanmar voice ကို အရင်နှိပ်ပါ။'));
          voiceAudio.load();
          setTimeout(() => resolve(), 8000);
        });
        if (voiceAudio.captureStream) voiceStream = voiceAudio.captureStream();
        else if (voiceAudio.mozCaptureStream) voiceStream = voiceAudio.mozCaptureStream();
        if (!voiceStream || !voiceStream.getAudioTracks().length) {
          throw new Error('ဒီ Browser က Audio Capture မထောက်ပံ့ပါ။ Chrome ကို အသုံးပြုပြီး ပြန်စမ်းပါ။');
        }
        voiceStream.getAudioTracks().forEach(track => stream.addTrack(track));
      } else {
        throw new Error('Recap Script မရှိပါ။ Script ထည့်ပြီး Prepare recap ကို အရင်နှိပ်ပါ။');
      }
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' :
        (MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm');
      recorder = new MediaRecorder(stream,{mimeType:mime});
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(new Error('Video export မအောင်မြင်ပါ။'));});
      draw(); recorder.start(1000);
      if (voiceAudio) {
        voiceAudio.currentTime = 0;
        const voicePlay = voiceAudio.play().catch(()=>{});
        await video.play();
        setStatus('မြန်မာအသံ + Subtitle ပါတဲ့ Video ကို Export လုပ်နေပါတယ်…');
        await new Promise(resolve => {
          let done = false;
          const finish = () => { if (!done) { done=true; resolve(); } };
          video.onended = finish; video.onerror = finish;
          voiceAudio.onended = finish;
          // Do not stop before the video ends; if voice is shorter, keep video running.
          if (voiceAudio.duration && video.duration && voiceAudio.duration >= video.duration) voiceAudio.onended = finish;
        });
        voiceAudio.pause();
      } else {
        await video.play();
        setStatus('အသံမတွေ့ပါ။ Subtitle ပါတဲ့ Video ကို Export လုပ်နေပါတယ်…');
        await new Promise(resolve=>{ video.onended=resolve; video.onerror=resolve; });
      }
      recorder.stop(); await stopped;
      const blob = new Blob(chunks,{type:'video/webm'});
      if (!blob.size) throw new Error('Video ဖိုင်မထွက်လာပါ။ ထပ်စမ်းကြည့်ပါ။');
      const url = URL.createObjectURL(blob);
      const preview = document.querySelector('#recapExportPreview');
      const player = document.querySelector('#recapExportPlayer');
      const download = document.querySelector('#recapExportDownload');
      if (player && preview) {
        player.src = url;
        preview.hidden = false;
        if (download) download.href = url;
        preview.scrollIntoView({behavior:'smooth', block:'start'});
        setStatus('Video Export ပြီးပါပြီ။ အောက်မှာ Recap Video ကို ကြည့်နိုင်ပါပြီ။');
      } else {
        const a = document.createElement('a'); a.href=url; a.download='james-ai-myanmar-recap.webm';
        document.body.appendChild(a); a.click(); a.remove();
        setStatus('Video Export ပြီးပါပြီ။ Download လုပ်နေပါတယ်။');
      }
      
    } catch (e) { setStatus('Export မအောင်မြင်ပါ: '+(e?.message || 'Browser ခွင့်ပြုချက်/Video format ကို စစ်ပါ။')); }
    finally { if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t=>t.stop()); if (voiceStream) voiceStream.getTracks().forEach(t=>t.stop()); if (voiceAudio) { voiceAudio.pause(); voiceAudio.src=''; } if(video?.src) URL.revokeObjectURL(video.src); btn.disabled=false; }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupRecapVideoExport);
else setupRecapVideoExport();
