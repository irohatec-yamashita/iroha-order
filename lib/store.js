const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataPath = (name) => path.join(__dirname, "..", "data", name);

function readJson(name) {
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

function ordersForTable(table) {
  const orders = readJson("orders.json").filter((order) => order.table === table && order.status === "confirmed");
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

module.exports = { appendEvent, closeOrdersForTable, createConfirmedOrder, markOrdersCheckoutRequested, ordersForTable, validateItems };
