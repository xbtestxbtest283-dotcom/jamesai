// Leave blank when frontend and backend are deployed together (recommended).
// For GitHub Pages, set this to your deployed backend URL, e.g. https://james-ai.onrender.com
const API_BASE_URL = String(window.JAMESAI_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE_URL}${path}`;

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
    textNode.textContent = text;
    bubble.appendChild(textNode);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: oldHistory, attachments })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || "AI request failed.");
    const reply = String(data.reply || "").trim();
    addMessage(reply || "James AI က အဖြေမပြန်နိုင်သေးပါ။", "ai");
    history.push({ role: "assistant", content: reply });
    history = history.slice(-60);
    saveHistory();
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
    <button class="quick" data-prompt="Python ကို beginner အနေနဲ့ ဘယ်လိုစလေ့လာရမလဲ?">💻 Coding</button>
    <button class="quick" data-prompt="Photosynthesis ကို ရိုးရိုးရှင်းရှင်းရှင်းပြပါ။">📚 Study</button>
    <button class="quick" data-prompt="2x + 7 = 19 ကို အဆင့်လိုက်ဖြေရှင်းပေးပါ။">🧮 Math</button>
    <button class="quick" data-prompt="ဒီစာကို English လို ဘာသာပြန်ပေးပါ။">🌐 Translate</button>
  </div></div>`;
  $$(".quick").forEach(b => b.addEventListener("click", () => { input.value = b.dataset.prompt || ""; autoResize(); input.focus(); }));
  openView("chat");
});

mobileMenuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

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
