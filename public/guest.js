const params = new URLSearchParams(location.search);
const requestedTable = params.get("table") || "5";
const table = /^[A-Za-z0-9-]{1,20}$/.test(requestedTable) ? requestedTable : "5";

const UI = {
  ja: {
    placeholder: "メッセージを入力…", ttsOn: "🔊 読み上げ ON", ttsOff: "🔇 読み上げ OFF",
    menu: "メニュー", history: "注文履歴", hand: "手を挙げる", check: "お会計",
    pickItems: "品を選んでください", orderN: (n) => `選択した ${n} 点を注文する`,
    confirm: "確定", edit: "修正する", total: "合計", subtotal: "小計",
    emptyHistory: "まだ注文はありません。", taxNote: "※ 価格は税込です",
    drinks: "お飲み物", food: "お料理", dessert: "デザート", other: "その他",
    recommended: "おすすめ", table: (n) => `テーブル ${n} ｜ AI接客中`,
    tableOnly: (n) => `テーブル ${n}`, menuSelection: "（メニューから選択）",
    checkQuestion: "ご注文内容です。お間違いないですか？",
    noOrdersCheck: "お会計をお願いします。", changeBeforeCheck: "お会計の前に注文内容を変更したいです。", staffNotified: (kind) => `店舗スタッフに「テーブル${table} ${kind}」を通知しました`,
    raiseKind: "呼び出し", checkKind: "お会計", remove: "削除", retry: "通信に失敗しました。少し待ってからもう一度お試しください。",
    micUnsupported: "このブラウザは音声入力に対応していません（Chrome推奨）", listening: "🎤 お話しください…"
  },
  en: {
    placeholder: "Type a message…", ttsOn: "🔊 Voice ON", ttsOff: "🔇 Voice OFF",
    menu: "Menu", history: "Order History", hand: "Call Staff", check: "Check",
    pickItems: "Select items", orderN: (n) => `Order ${n} selected item(s)`,
    confirm: "Confirm", edit: "Change", total: "Total", subtotal: "Subtotal",
    emptyHistory: "No orders yet.", taxNote: "※ Prices include tax",
    drinks: "Drinks", food: "Food", dessert: "Dessert", other: "Other",
    recommended: "Recommended", table: (n) => `Table ${n} | AI Service`,
    tableOnly: (n) => `Table ${n}`, menuSelection: "(selected from menu)",
    checkQuestion: "Here is your order. Is everything correct?",
    noOrdersCheck: "I'd like the check, please.", changeBeforeCheck: "I'd like to change the order before checkout.", staffNotified: (kind) => `Staff notified: Table ${table} — ${kind}`,
    raiseKind: "Call Staff", checkKind: "Check", remove: "Remove", retry: "Connection failed. Please wait a moment and try again.",
    micUnsupported: "Voice input is not supported in this browser (Chrome recommended)", listening: "🎤 Listening…"
  }
};

const ICONS = { beer: "🍺", lemonsour: "🍋", highball: "🥃", oolong: "🍵", sashimi: "🐟", karaage: "🍗", potatosalad: "🥔", edamame: "🫛", yakitori: "🍢", dashimaki: "🍳" };
const $ = (id) => document.getElementById(id);
const chat = $("chat");
let lang = params.get("lang") === "en" ? "en" : "ja";
let ttsOn = true;
let menu = { restaurant: "居酒屋 いろは", items: [] };
let messages = [];
let pendingProposal = null;
let menuSel = {};
let activeChips = null;
let typingRow = null;
let busy = false;
let sessionStarted = false;
let toastTimer = null;

function t() { return UI[lang]; }
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function money(value) { return `¥${Number(value || 0).toLocaleString()}`; }
function itemName(item) { return lang === "en" ? item.en : item.name; }
function lineName(line) { return lang === "en" ? (line.en || line.name) : line.name; }

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function setBusy(value) {
  busy = value;
  $("sendBtn").disabled = value;
  $("msgInput").disabled = value;
}

function addRow(role, html) {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  row.innerHTML = role === "ai"
    ? `<div class="avatar">🤖</div><div class="bubble">${html}</div>`
    : `<div class="bubble">${html}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return row;
}

function sysSay(text) { addRow("sys", esc(text)); }
function showTyping() { typingRow = addRow("ai", '<span class="typing"><span></span><span></span><span></span></span>'); }
function hideTyping() { if (typingRow) typingRow.remove(); typingRow = null; }

function botSay(text, options = {}) {
  return new Promise((resolve) => {
    showTyping();
    setTimeout(() => {
      hideTyping();
      const html = options.html ? text : esc(text).replace(/\n/g, "<br>");
      addRow("ai", html);
      if (options.speak !== false) speak(options.speakText || String(text).replace(/<[^>]+>/g, " "));
      if (options.chips?.length) addChips(options.chips);
      if (options.actions?.length) addActions(options.actions);
      resolve();
    }, options.delay ?? 250);
  });
}

function addActions(actions) {
  const div = document.createElement("div");
  div.className = "inline-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = action.cls;
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      [...div.children].forEach((child) => { child.disabled = true; });
      try { await action.fn(); } catch { [...div.children].forEach((child) => { child.disabled = false; }); }
    });
    div.appendChild(button);
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addChips(labels) {
  removeChips();
  const div = document.createElement("div");
  div.className = "chips";
  for (const label of labels) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      removeChips();
      sendGuestMessage(label);
    });
    div.appendChild(button);
  }
  chat.appendChild(div);
  activeChips = div;
  chat.scrollTop = chat.scrollHeight;
}

function removeChips() { if (activeChips) activeChips.remove(); activeChips = null; }

const SPEECH_READINGS = [["何名様", "なんめいさま"], ["生ビール", "なまビール"], ["地魚", "じざかな"], ["人前", "にんまえ"], ["瀬戸内", "せとうち"]];
const VOICE_PRIORITY = {
  ja: ["Nanami Online", "Keita Online", "Nanami", "Google 日本語", "Kyoko", "Ayumi"],
  en: ["Aria Online", "Jenny Online", "Guy Online", "Google US English", "Samantha", "Aria"]
};
let cachedVoices = [];
function loadVoices() { if ("speechSynthesis" in window) cachedVoices = speechSynthesis.getVoices(); }
loadVoices();
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = loadVoices;
function pickVoice() {
  const candidates = cachedVoices.filter((voice) => voice.lang.toLowerCase().startsWith(lang));
  for (const key of VOICE_PRIORITY[lang]) {
    const voice = candidates.find((candidate) => candidate.name.includes(key));
    if (voice) return voice;
  }
  return candidates[0] || null;
}
function speak(text) {
  if (!ttsOn || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  let clean = String(text).replace(/[🖐🍺🍽🍨💴🧾📖🌐🔊🔇🍶✕→（）\[\]［］]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return;
  if (lang === "ja") for (const [from, to] of SPEECH_READINGS) clean = clean.split(from).join(to);
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = lang === "ja" ? "ja-JP" : "en-US";
  utterance.rate = 1;
  utterance.voice = pickVoice();
  speechSynthesis.speak(utterance);
}
function toggleTTS() {
  ttsOn = !ttsOn;
  if (!ttsOn && "speechSynthesis" in window) speechSynthesis.cancel();
  $("ttsBtn").textContent = ttsOn ? t().ttsOn : t().ttsOff;
  $("ttsBtn").classList.toggle("off", !ttsOn);
}

function sessionState() {
  return { pendingProposal: pendingProposal ? { items: pendingProposal.items, note: pendingProposal.note || "" } : null };
}

async function requestAI({ userText, uiEvent } = {}) {
  if (busy) return;
  removeChips();
  if (userText) {
    addRow("user", esc(userText));
    messages.push({ role: "user", content: userText });
  }
  setBusy(true);
  showTyping();
  try {
    const reply = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, lang, sessionState: sessionState(), messages: messages.slice(-28), uiEvent })
    });
    hideTyping();
    if (reply.text) {
      messages.push({ role: "assistant", content: reply.text });
      await botSay(reply.text, { chips: reply.chips || [], delay: 0 });
    } else if (reply.chips?.length) {
      addChips(reply.chips);
    }
    if (reply.proposal) {
      pendingProposal = reply.proposal;
      await renderProposal(reply.proposal);
    }
    messages = messages.slice(-28);
  } catch (error) {
    hideTyping();
    console.error(error);
    await botSay(t().retry, { speak: false, delay: 0 });
  } finally {
    setBusy(false);
    $("msgInput").focus();
  }
}

function proposalHtml(proposal) {
  const lines = proposal.lines.map((line) => `<div class="li"><span>${esc(lineName(line))}　×${line.qty}</span><span>${money(line.subtotal)}</span></div>`).join("");
  return `<div class="order-list">${lines}<div class="li total"><span>${esc(t().subtotal)}</span><span>${money(proposal.total)}</span></div></div>`;
}

async function renderProposal(proposal) {
  await botSay(proposalHtml(proposal), {
    html: true,
    speakText: proposal.lines.map((line) => `${lineName(line)} ${line.qty}`).join(", "),
    actions: [
      { label: t().confirm, cls: "btn-confirm", fn: () => confirmProposal(proposal.items) },
      { label: t().edit, cls: "btn-modify", fn: () => renderProposalEditor(proposal) }
    ]
  });
}

function renderProposalEditor(proposal) {
  const quantities = new Map(proposal.items.map((item) => [item.id, item.qty]));
  const available = new Map(menu.items.map((item) => [item.id, item]));
  const row = addRow("ai", '<div class="order-list" data-editor></div>');
  const container = row.querySelector("[data-editor]");
  const draw = () => {
    container.innerHTML = "";
    for (const [id, qty] of quantities) {
      if (qty < 1) continue;
      const item = available.get(id);
      if (!item) continue;
      const line = document.createElement("div");
      line.className = "li";
      line.innerHTML = `<span>${esc(itemName(item))}</span><span class="stepper"><button type="button">−</button><span class="cnt">${qty}</span><button type="button">＋</button></span>`;
      const [minus, plus] = line.querySelectorAll("button");
      minus.addEventListener("click", () => { quantities.set(id, Math.max(0, quantities.get(id) - 1)); draw(); });
      plus.addEventListener("click", () => { quantities.set(id, Math.min(99, quantities.get(id) + 1)); draw(); });
      container.appendChild(line);
    }
  };
  draw();
  addActions([{ label: t().confirm, cls: "btn-confirm", fn: () => {
    const items = [...quantities].filter(([, qty]) => qty > 0).map(([id, qty]) => ({ id, qty }));
    if (!items.length) { toast(t().pickItems); throw new Error("Empty proposal"); }
    return confirmProposal(items);
  }}]);
}

async function confirmProposal(items) {
  const result = await api("/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, items })
  });
  pendingProposal = null;
  await refreshOrderBadge();
  sysSay(`${result.order.lines.map((line) => `${lineName(line)} ×${line.qty}`).join("、")} ✓`);
  await requestAI({ uiEvent: "order_confirmed" });
}

function sendGuestMessage(text) { return requestAI({ userText: String(text).trim() }); }
function sendFromInput() {
  const input = $("msgInput");
  const value = input.value.trim();
  if (!value || busy) return;
  input.value = "";
  sendGuestMessage(value);
}
$("msgInput").addEventListener("keydown", (event) => { if (event.key === "Enter") sendFromInput(); });

function closeSheets() { document.querySelectorAll(".sheet-wrap").forEach((sheet) => sheet.classList.remove("open")); }
async function openSheet(name) {
  closeSheets();
  if (name === "menu") renderMenu();
  if (name === "history") await renderHistory();
  $("sheet-" + name).classList.add("open");
}
document.querySelectorAll(".sheet-wrap").forEach((sheet) => sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheets(); }));

function categoryLabel(category) {
  if (category === "drink") return t().drinks;
  if (category === "food") return t().food;
  if (category === "dessert") return t().dessert;
  return t().other;
}
function renderMenu() {
  menuSel = {};
  const body = $("menuBody");
  body.innerHTML = "";
  const categories = [...new Set(menu.items.map((item) => item.cat))];
  for (const category of categories) {
    const title = document.createElement("div");
    title.className = "cat-title";
    title.textContent = categoryLabel(category);
    body.appendChild(title);
    for (const item of menu.items.filter((candidate) => candidate.cat === category)) {
      const card = document.createElement("div");
      card.className = "m-item";
      card.innerHTML = `<div class="ph">${ICONS[item.id] || "🍽"}</div><div class="info"><div class="nm">${esc(itemName(item))}</div><div class="ds">${esc(item.desc || "")}${item.recommended ? ` ⭐${esc(t().recommended)}` : ""}</div><div class="pr">${money(item.price)}</div></div><div class="stepper"><button type="button">−</button><span class="cnt">0</span><button type="button">＋</button></div>`;
      const count = card.querySelector(".cnt");
      const [minus, plus] = card.querySelectorAll("button");
      const step = (delta) => { menuSel[item.id] = Math.max(0, (menuSel[item.id] || 0) + delta); count.textContent = menuSel[item.id]; updateMenuBar(); };
      minus.addEventListener("click", () => step(-1));
      plus.addEventListener("click", () => step(1));
      body.appendChild(card);
    }
  }
  updateMenuBar();
}
function updateMenuBar() {
  const count = Object.values(menuSel).reduce((sum, qty) => sum + qty, 0);
  const button = $("menuOrderBtn");
  button.disabled = count === 0;
  button.textContent = count ? t().orderN(count) : t().pickItems;
}
function orderFromMenu() {
  const selected = Object.entries(menuSel).filter(([, qty]) => qty > 0);
  if (!selected.length) return;
  const text = selected.map(([id, qty]) => {
    const item = menu.items.find((candidate) => candidate.id === id);
    return lang === "ja" ? `${item.name}を${qty}つ` : `${qty} ${item.en}`;
  }).join(lang === "ja" ? "、" : ", ") + ` ${t().menuSelection}`;
  closeSheets();
  sendGuestMessage(text);
}

async function getOrderHistory() { return api(`/api/orders?table=${encodeURIComponent(table)}`); }
async function renderHistory() {
  const body = $("histBody");
  const history = await getOrderHistory();
  if (!history.orders.length) { body.innerHTML = `<div class="h-note">${esc(t().emptyHistory)}</div>`; return; }
  const cards = history.orders.map((order) => {
    const time = new Date(order.time).toLocaleTimeString(lang === "ja" ? "ja-JP" : "en-US", { hour: "2-digit", minute: "2-digit" });
    return order.lines.map((line) => `<div class="h-line"><span>${esc(lineName(line))}<span class="q">×${line.qty}　${time}</span></span><span>${money(line.subtotal)}</span></div>`).join("");
  }).join("");
  body.innerHTML = `<div class="hist-card">${cards}</div><div class="h-total"><span>${esc(t().total)}</span><span>${money(history.total)}</span></div><div class="h-note">${esc(t().taxNote)}</div>`;
}
async function refreshOrderBadge() {
  try {
    const history = await getOrderHistory();
    const count = history.orders.flatMap((order) => order.lines).reduce((sum, line) => sum + line.qty, 0);
    $("histBadge").style.display = count ? "block" : "none";
    $("histBadge").textContent = count;
  } catch (error) { console.error(error); }
}

async function raiseHand() {
  closeSheets();
  try {
    await api("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, type: "raise_hand" }) });
    sysSay(`🖐 ${t().staffNotified(t().raiseKind)}`);
    await requestAI({ uiEvent: "raise_hand" });
  } catch (error) { console.error(error); toast(t().retry); }
}

async function checkout() {
  closeSheets();
  try {
    const history = await getOrderHistory();
    if (!history.orders.length) { await sendGuestMessage(t().noOrdersCheck); return; }
    const lines = history.orders.flatMap((order) => order.lines);
    const html = `${esc(t().checkQuestion)}<div class="order-list">${lines.map((line) => `<div class="li"><span>${esc(lineName(line))}　×${line.qty}</span><span>${money(line.subtotal)}</span></div>`).join("")}<div class="li total"><span>${esc(t().total)}</span><span>${money(history.total)}</span></div></div>`;
    await botSay(html, { html: true, speakText: `${t().checkQuestion} ${t().total} ${history.total}`, actions: [
      { label: t().confirm, cls: "btn-confirm", fn: confirmCheckout },
      { label: t().edit, cls: "btn-modify", fn: () => sendGuestMessage(t().changeBeforeCheck) }
    ] });
  } catch (error) { console.error(error); toast(t().retry); }
}
async function confirmCheckout() {
  await api("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, type: "check" }) });
  sysSay(`💴 ${t().staffNotified(t().checkKind)}`);
  await requestAI({ uiEvent: "check_confirmed" });
}

async function setLang(nextLang) {
  if (nextLang === lang) { closeSheets(); return; }
  lang = nextLang;
  params.set("lang", lang);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  applyLangUI();
  closeSheets();
  sysSay(`🌐 language: ${lang === "ja" ? "日本語" : "English"}`);
  await requestAI({ uiEvent: "language_changed" });
}
function applyLangUI() {
  document.documentElement.lang = lang;
  $("msgInput").placeholder = t().placeholder;
  $("ttsBtn").textContent = ttsOn ? t().ttsOn : t().ttsOff;
  $("menuTitle").textContent = t().menu;
  $("histTitle").textContent = t().history;
  $("nvMenu").textContent = t().menu;
  $("nvHistory").textContent = t().history;
  $("nvHand").textContent = t().hand;
  $("nvPay").textContent = t().check;
  $("hdTable").textContent = t().table(table);
  $("lb-ja").classList.toggle("active", lang === "ja");
  $("lb-en").classList.toggle("active", lang === "en");
}

let recognition = null;
let recording = false;
function toggleMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { toast(t().micUnsupported); return; }
  if (recording) { recognition.stop(); return; }
  recognition = new SpeechRecognition();
  recognition.lang = lang === "ja" ? "ja-JP" : "en-US";
  recognition.interimResults = false;
  recording = true;
  $("micBtn").classList.add("rec");
  toast(t().listening);
  recognition.onresult = (event) => { $("msgInput").value = event.results[0][0].transcript; sendFromInput(); };
  recognition.onend = () => { recording = false; $("micBtn").classList.remove("rec"); };
  recognition.onerror = () => { recording = false; $("micBtn").classList.remove("rec"); toast(t().retry); };
  recognition.start();
}
function toast(message, duration = 2400) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), duration);
}

async function loadMenu() {
  menu = await api("/api/menu");
  $("hdShop").textContent = menu.restaurant;
  $("splashShop").textContent = menu.restaurant;
}
async function startSession(selectedLang) {
  if (sessionStarted) return;
  sessionStarted = true;
  lang = selectedLang;
  params.set("table", table);
  params.set("lang", lang);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  applyLangUI();
  $("splash").style.display = "none";
  await requestAI({ uiEvent: "guest_seated" });
}
async function restartDemo() {
  if (!sessionStarted || busy) return;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  chat.innerHTML = "";
  messages = [];
  pendingProposal = null;
  await requestAI({ uiEvent: "guest_seated" });
}

applyLangUI();
$("splashTable").textContent = t().tableOnly(table);
loadMenu().then(refreshOrderBadge).catch((error) => { console.error(error); toast(t().retry, 5000); });
