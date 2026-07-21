const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderTable(table) {
  const card = node("article", `table-card ${table.status === "checkout" ? "checkout" : ""}`);
  const head = node("div", "table-head");
  head.append(node("div", "table-number", `テーブル ${table.table}`));
  head.append(node("span", "status", table.status === "checkout" ? "お会計待ち" : "注文中"));
  card.append(head);

  for (const order of table.orders) {
    const orderNode = node("div", "order");
    for (const line of order.lines || []) {
      const row = node("div", "line");
      row.append(node("span", "", line.name || line.en || line.id));
      row.append(node("strong", "", `× ${line.qty}`));
      orderNode.append(row);
    }
    card.append(orderNode);
  }
  const total = node("div", "total");
  total.append(node("span", "", "合計"));
  total.append(node("strong", "", yen.format(table.total || 0)));
  card.append(total);
  card.append(node("div", "time", `最終更新 ${clock.format(new Date(table.lastActivity))}`));
  return card;
}

function renderEvent(event) {
  const item = node("div", "event");
  item.append(node("div", "event-icon", event.type === "raise_hand" ? "🖐" : "¥"));
  const copy = node("div");
  copy.append(node("b", "", `テーブル ${event.table} · ${event.type === "raise_hand" ? "スタッフ呼び出し" : "お会計依頼"}`));
  copy.append(node("small", "", clock.format(new Date(event.time))));
  item.append(copy);
  return item;
}

function render(state) {
  const tables = state.tables || [];
  const events = state.events || [];
  document.querySelector("#activeCount").textContent = tables.length;
  document.querySelector("#orderingCount").textContent = tables.filter((table) => table.status === "ordering").length;
  document.querySelector("#checkoutCount").textContent = tables.filter((table) => table.status === "checkout").length;
  document.querySelector("#callCount").textContent = events.filter((event) => event.type === "raise_hand").length;

  const tableRoot = document.querySelector("#tables");
  tableRoot.replaceChildren(...(tables.length ? tables.map(renderTable) : [node("div", "empty", "注文を待っています")]));
  const eventRoot = document.querySelector("#events");
  eventRoot.replaceChildren(...(events.length ? events.slice(0, 12).map(renderEvent) : [node("div", "empty", "通知はありません")]));
}

async function refresh() {
  const label = document.querySelector("#connection");
  const dot = document.querySelector("#statusDot");
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    label.textContent = `自動更新 · ${clock.format(new Date())}`;
    label.classList.remove("error");
    dot.style.background = "#7ad9a4";
  } catch (error) {
    label.textContent = "接続を再試行しています";
    label.classList.add("error");
    dot.style.background = "#df7567";
  }
}

refresh();
setInterval(refresh, 3000);
