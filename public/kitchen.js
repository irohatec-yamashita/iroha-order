const clock = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderTicket(order) {
  const ticket = node("article", "ticket");
  const head = node("div", "ticket-head");
  head.append(node("div", "table", `TABLE ${order.table}`));
  head.append(node("div", "time", clock.format(new Date(order.time))));
  ticket.append(head);
  const lines = node("div", "lines");
  for (const line of order.lines || []) {
    const row = node("div", "line");
    row.append(node("span", "", line.name || line.en || line.id));
    row.append(node("span", "qty", `×${line.qty}`));
    lines.append(row);
  }
  ticket.append(lines);
  ticket.append(node("div", `ticket-foot ${order.status === "checkout_requested" ? "checkout" : ""}`,
    order.status === "checkout_requested" ? "お会計依頼済み" : `注文ID ${String(order.orderId || "").slice(0, 8)}`));
  return ticket;
}

async function refresh() {
  const label = document.querySelector("#connection");
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    const orders = (state.orders || []).filter((order) => ["confirmed", "checkout_requested"].includes(order.status));
    const root = document.querySelector("#orders");
    root.replaceChildren(...(orders.length ? orders.map(renderTicket) : [node("div", "empty", "確定注文を待っています")]));
    label.textContent = `自動更新 · ${clock.format(new Date())}`;
  } catch (error) {
    label.textContent = "接続を再試行しています";
  }
}

refresh();
setInterval(refresh, 3000);
