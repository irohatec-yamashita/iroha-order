(() => {
  const params = new URLSearchParams(location.search);
  const table = params.get("table") || "";
  const lang = params.get("lang") === "en" ? "en" : "ja";
  const t = window.I18N[lang];
  const state = { messages: [], menu: [], pendingProposal: null };
  const $ = (selector) => document.querySelector(selector);

  document.documentElement.lang = lang;
  document.title = t.appName;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t[el.dataset.i18n]; });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t[el.dataset.i18nPlaceholder]; });
  $("#table-label").textContent = table ? `${t.table} ${table}` : "";
  if (!table) { $("#table-missing").classList.remove("hidden"); $("#chat-input").disabled = true; $("#chat-form button").disabled = true; }

  function yen(value) { return new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value); }
  function addMessage(role, content) { state.messages.push({ role, content }); const bubble = document.createElement("p"); bubble.className = `bubble ${role}`; bubble.textContent = content; $("#chat-log").append(bubble); $("#chat-log").scrollTop = $("#chat-log").scrollHeight; }
  function setBusy(busy) { $("#chat-input").disabled = busy || !table || Boolean(state.pendingProposal); $("#chat-form button").disabled = busy || !table || Boolean(state.pendingProposal); }

  function renderProposal() {
    const area = $("#proposal-area"); area.replaceChildren();
    const proposal = state.pendingProposal; if (!proposal) return;
    const card = document.createElement("section"); card.className = "proposal-card";
    const heading = document.createElement("h2"); heading.textContent = t.proposalTitle; card.append(heading);
    const prompt = document.createElement("p"); prompt.textContent = t.proposed; card.append(prompt);
    const list = document.createElement("ul");
    proposal.lines.forEach((line, index) => {
      const item = document.createElement("li");
      const label = document.createElement("span"); label.textContent = `${lang === "en" ? line.en : line.name} × ${line.qty} — ${yen(line.subtotal)}`; item.append(label);
      if (proposal.editing) {
        const controls = document.createElement("span"); controls.className = "quantity-controls";
        [["−", () => adjust(index, -1)], ["+", () => adjust(index, 1)], [t.remove, () => remove(index)]].forEach(([text, action]) => { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.addEventListener("click", action); controls.append(button); });
        item.append(controls);
      }
      list.append(item);
    });
    card.append(list);
    if (proposal.note) { const note = document.createElement("p"); note.className = "note"; note.textContent = `${t.note}: ${proposal.note}`; card.append(note); }
    const total = document.createElement("p"); total.className = "proposal-total"; total.textContent = `${t.total}: ${yen(proposal.total)}`; card.append(total);
    const actions = document.createElement("div"); actions.className = "proposal-actions";
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = t.confirm; confirm.disabled = proposal.lines.length === 0; confirm.addEventListener("click", confirmOrder);
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary"; edit.textContent = t.edit; edit.addEventListener("click", () => { proposal.editing = true; addMessage("assistant", t.editing); renderProposal(); });
    actions.append(confirm, edit); card.append(actions); area.append(card);
  }
  function recalculate() { const proposal = state.pendingProposal; proposal.items = proposal.lines.map(({ id, qty }) => ({ id, qty })); proposal.total = proposal.lines.reduce((sum, line) => sum + line.subtotal, 0); }
  function adjust(index, delta) { const line = state.pendingProposal.lines[index]; line.qty = Math.max(1, line.qty + delta); line.subtotal = line.qty * line.unit; recalculate(); renderProposal(); }
  function remove(index) { state.pendingProposal.lines.splice(index, 1); recalculate(); renderProposal(); }

  async function loadMenu() { const response = await fetch("/api/menu"); const menu = await response.json(); state.menu = menu.items || []; return menu; }
  async function sendMessage(event) {
    event.preventDefault(); if (state.pendingProposal) return;
    const input = $("#chat-input"); const content = input.value.trim(); if (!content) return;
    input.value = ""; addMessage("user", content); setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, lang, sessionState: {}, messages: state.messages }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (body.text) addMessage("assistant", body.text);
      if (body.proposal) { state.pendingProposal = { ...body.proposal, editing: false }; renderProposal(); }
    } catch { addMessage("assistant", t.chatError); }
    finally { setBusy(false); }
  }
  async function confirmOrder() {
    const proposal = state.pendingProposal; if (!proposal || !proposal.lines.length) return;
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, items: proposal.items }) });
      if (!response.ok) throw new Error(); state.pendingProposal = null; renderProposal(); addMessage("assistant", t.confirmed);
    } catch { addMessage("assistant", t.orderError); }
    finally { setBusy(false); }
  }
  function openDialog(id) { $(id).showModal(); }
  async function showMenu() {
    const content = $("#menu-content"); content.textContent = t.loading; openDialog("#menu-dialog");
    try { const menu = await loadMenu(); content.replaceChildren(); ["drink", "food"].forEach((category) => { const items = menu.items.filter((item) => item.cat === category); if (!items.length) return; const heading = document.createElement("h3"); heading.textContent = t[category]; const list = document.createElement("ul"); items.forEach((item) => { const li = document.createElement("li"); li.textContent = `${lang === "en" ? item.en : item.name} — ${yen(item.price)}${item.desc ? ` · ${item.desc}` : ""}`; list.append(li); }); content.append(heading, list); }); } catch { content.textContent = t.chatError; }
  }
  async function showHistory() {
    const content = $("#history-content"); content.textContent = t.loading; openDialog("#history-dialog");
    try { const response = await fetch(`/api/orders?table=${encodeURIComponent(table)}`); const body = await response.json(); content.replaceChildren(); if (!body.orders?.length) { content.textContent = t.noOrders; return; } const list = document.createElement("ul"); body.orders.forEach((order) => order.lines.forEach((line) => { const li = document.createElement("li"); li.textContent = `${lang === "en" ? line.en : line.name} × ${line.qty} — ${yen(line.subtotal)}`; list.append(li); })); const total = document.createElement("p"); total.className = "proposal-total"; total.textContent = `${t.total}: ${yen(body.total)}`; content.append(list, total); } catch { content.textContent = t.chatError; }
  }
  $("#chat-form").addEventListener("submit", sendMessage);
  $("#menu-button").addEventListener("click", showMenu); $("#history-button").addEventListener("click", showHistory);
  $("#raise-button").addEventListener("click", () => addMessage("assistant", t.unavailable)); $("#check-button").addEventListener("click", () => addMessage("assistant", t.unavailable));
  $("#language-button").addEventListener("click", () => { params.set("lang", lang === "ja" ? "en" : "ja"); location.search = params.toString(); });
  document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  addMessage("assistant", t.greeting); loadMenu().catch(() => {});
})();
