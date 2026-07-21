const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataPath = (name) => path.join(__dirname, "..", "data", name);

function readJson(name) {
  if (!fs.existsSync(dataPath(name))) return [];
  return JSON.parse(fs.readFileSync(dataPath(name), "utf8"));
}

function writeJson(name, value) {
  const target = dataPath(name);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function validateItems(items, menu) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one order item is required.");
  }

  const byId = new Map(menu.items.map((item) => [item.id, item]));
  const quantities = new Map();
  for (const item of items) {
    const qty = Number(item?.qty);
    if (!byId.has(item?.id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new Error("Invalid order item.");
    }
    const menuItem = byId.get(item.id);
    if (menuItem.soldOut) throw new Error("An item is sold out.");
    quantities.set(item.id, (quantities.get(item.id) || 0) + qty);
  }

  return [...quantities].map(([id, qty]) => {
    const item = byId.get(id);
    return { id, name: item.name, en: item.en, qty, unit: item.price, subtotal: item.price * qty };
  });
}

function createConfirmedOrder({ table, lang = "ja", sessionId = null, items, menu }) {
  const lines = validateItems(items, menu);
  const order = {
    orderId: crypto.randomUUID(),
    time: new Date().toISOString(),
    table,
    lang,
    sessionId,
    source: "guest",
    lines,
    status: "confirmed"
  };
  const orders = readJson("orders.json");
  orders.push(order);
  writeJson("orders.json", orders);
  return order;
}

function activeOrdersForTable(records, events, table) {
  const latestCheck = events
    .filter((event) => event.table === table && event.type === "check")
    .reduce((latest, event) => Math.max(latest, Date.parse(event.time) || 0), 0);
  return records.filter((order) => order.table === table
    && order.status === "confirmed"
    && (!latestCheck || (Date.parse(order.time) || 0) > latestCheck));
}

function ordersForTable(table) {
  const orders = activeOrdersForTable(readJson("orders.json"), readJson("events.json"), table);
  const total = orders.reduce(
    (sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.subtotal, 0),
    0
  );
  return { orders, total };
}

function markOrdersCheckoutRequested(records, table, time = new Date().toISOString()) {
  return records.map((order) => order.table === table && order.status === "confirmed"
    ? { ...order, status: "checkout_requested", checkoutRequestedAt: time }
    : order);
}

function closeOrdersForTable(table) {
  const orders = readJson("orders.json");
  const closedOrderIds = orders
    .filter((order) => order.table === table && order.status === "confirmed")
    .map((order) => order.orderId);
  if (!closedOrderIds.length) return [];
  writeJson("orders.json", markOrdersCheckoutRequested(orders, table));
  return closedOrderIds;
}

function appendEvent({ table, type }) {
  if (!["raise_hand", "check"].includes(type)) throw new Error("Invalid event type.");
  const event = { eventId: crypto.randomUUID(), time: new Date().toISOString(), table, type };
  const events = readJson("events.json");
  events.push(event);
  writeJson("events.json", events);
  return event;
}

function orderTotal(order) {
  return Array.isArray(order?.lines)
    ? order.lines.reduce((sum, line) => sum + (Number(line.subtotal) || 0), 0)
    : 0;
}

function buildStateSnapshot(orders, events) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const latestCheckByTable = new Map();

  for (const event of safeEvents) {
    if (event?.type !== "check" || !event.table) continue;
    const time = Date.parse(event.time) || 0;
    latestCheckByTable.set(event.table, Math.max(latestCheckByTable.get(event.table) || 0, time));
  }

  const operationalOrders = safeOrders.filter((order) => {
    if (order?.status === "checkout_requested") return true;
    if (order?.status !== "confirmed") return false;
    const latestCheck = latestCheckByTable.get(order.table) || 0;
    return !latestCheck || (Date.parse(order.time) || 0) > latestCheck;
  });

  const tableMap = new Map();
  for (const order of operationalOrders) {
    if (!tableMap.has(order.table)) {
      tableMap.set(order.table, {
        table: order.table,
        status: "ordering",
        orders: [],
        total: 0,
        lastActivity: order.time
      });
    }
    const table = tableMap.get(order.table);
    table.orders.push(order);
    table.total += orderTotal(order);
    if (order.status === "checkout_requested") table.status = "checkout";
    const activity = order.checkoutRequestedAt || order.time;
    if ((Date.parse(activity) || 0) > (Date.parse(table.lastActivity) || 0)) table.lastActivity = activity;
  }

  const recentEvents = safeEvents
    .filter((event) => ["raise_hand", "check"].includes(event?.type))
    .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));

  for (const event of recentEvents) {
    const table = tableMap.get(event.table);
    if (table && (Date.parse(event.time) || 0) > (Date.parse(table.lastActivity) || 0)) {
      table.lastActivity = event.time;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    tables: [...tableMap.values()]
      .map((table) => ({
        ...table,
        orders: table.orders.sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0))
      }))
      .sort((a, b) => (Date.parse(b.lastActivity) || 0) - (Date.parse(a.lastActivity) || 0)),
    orders: [...safeOrders].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0)),
    events: recentEvents.slice(0, 100)
  };
}

function stateSnapshot() {
  return buildStateSnapshot(readJson("orders.json"), readJson("events.json"));
}

module.exports = {
  activeOrdersForTable,
  appendEvent,
  buildStateSnapshot,
  closeOrdersForTable,
  createConfirmedOrder,
  markOrdersCheckoutRequested,
  ordersForTable,
  stateSnapshot,
  validateItems
};
