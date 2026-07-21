require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { AIConfigurationError, chatWithWaiter } = require("./lib/ai");
const { mirrorSheetEvent } = require("./lib/sheets");
const {
  appendTranscript,
  applySessionUpdate,
  beginSession,
  messagesForTable,
  sessionForTable
} = require("./lib/session");
const { appendEvent, createConfirmedOrder, ordersForTable } = require("./lib/store");

const app = express();
const port = Number(process.env.PORT) || 3000;
const menuPath = path.join(__dirname, "data", "menu.json");
const contextPath = path.join(__dirname, "data", "restaurant.json");
const chatEventTypes = new Set(["guest_seated", "order_confirmed", "raise_hand", "checkout_requested", "check_confirmed", "language_changed"]);

function readMenu() {
  return JSON.parse(fs.readFileSync(menuPath, "utf8"));
}

function readRestaurantContext() {
  return JSON.parse(fs.readFileSync(contextPath, "utf8"));
}

function validTable(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,20}$/.test(value);
}

function safeMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 30) throw new Error("Invalid message history.");
  return messages.map((message) => {
    if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string") {
      throw new Error("Invalid message.");
    }
    const content = message.content.trim();
    if (!content || content.length > 2000) throw new Error("Invalid message content.");
    return { role: message.role, content };
  });
}

function safeMessage(message) {
  if (message === undefined || message === null) return null;
  if (typeof message !== "string") throw new Error("Invalid guest message.");
  const content = message.trim();
  if (!content || content.length > 2000) throw new Error("Invalid guest message content.");
  return content;
}

function safeChatEvent(type, uiEvent) {
  if (type && uiEvent && type !== uiEvent) throw new Error("Conflicting chat event types.");
  const event = type || uiEvent;
  if (event && !chatEventTypes.has(event)) throw new Error("Unsupported chat event.");
  return event;
}

app.use(express.json({ limit: "100kb" }));

app.get("/api/menu", (_req, res) => {
  try {
    const menu = readMenu();
    res.json({ ...menu, items: menu.items.filter((item) => !item.soldOut) });
  } catch (error) {
    console.error("Unable to load menu:", error);
    res.status(500).json({ error: "Menu is unavailable." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { table, lang = "ja", message, messages, type, uiEvent } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    if (!["ja", "en"].includes(lang)) throw new Error("Unsupported language.");
    const chatEvent = safeChatEvent(type, uiEvent);
    const suppliedMessages = messages === undefined ? [] : safeMessages(messages);
    let session = chatEvent === "guest_seated" ? beginSession({ table, lang }) : sessionForTable({ table, lang });
    let guestMessage = safeMessage(message);
    if (!guestMessage && !chatEvent && suppliedMessages.at(-1)?.role === "user") {
      guestMessage = suppliedMessages.at(-1).content;
    }
    if (!chatEvent && !guestMessage) throw new Error("A guest message or chat event is required.");

    if (guestMessage) {
      const entry = appendTranscript({ table, role: "user", content: guestMessage });
      mirrorSheetEvent({ type: "conversation", sessionId: session.sessionId, table, lang, stage: session.stage, ...entry });
    }

    const menu = readMenu();
    const confirmed = ordersForTable(table);
    const categoryById = new Map(menu.items.map((item) => [item.id, item.cat]));
    const hasConfirmedDrink = confirmed.orders.some((order) => order.lines.some((line) => categoryById.get(line.id) === "drink"));
    const hasConfirmedFood = confirmed.orders.some((order) => order.lines.some((line) => categoryById.get(line.id) === "food"));
    const conversation = messagesForTable(table);
    const reply = await chatWithWaiter({
      menu,
      restaurant: readRestaurantContext(),
      table,
      lang,
      sessionState: {
        ...session,
        confirmedOrders: confirmed.orders,
        confirmedTotal: confirmed.total,
        hasConfirmedDrink,
        hasConfirmedFood
      },
      messages: conversation.length ? conversation : suppliedMessages,
      uiEvent: chatEvent
    });

    session = applySessionUpdate({
      table,
      lang,
      update: reply.session,
      forceStage: reply.proposal ? "order_confirmation" : chatEvent === "checkout_requested" ? "checkout" : undefined
    });
    if (reply.text) {
      const entry = appendTranscript({ table, role: "assistant", content: reply.text });
      mirrorSheetEvent({ type: "conversation", sessionId: session.sessionId, table, lang, stage: session.stage, ...entry });
    }

    const checkout = chatEvent === "checkout_requested" && confirmed.orders.length
      ? { orders: confirmed.orders, total: confirmed.total }
      : null;
    res.json({
      text: reply.text,
      chips: reply.chips,
      proposal: reply.proposal,
      highlightRaiseHand: reply.highlightRaiseHand,
      sessionState: session,
      checkout
    });
  } catch (error) {
    if (error instanceof AIConfigurationError) {
      return res.status(503).json({ error: "AI service is not configured." });
    }
    console.error("Chat request failed:", error);
    res.status(400).json({ error: "Unable to process this message." });
  }
});

app.post("/api/orders", (req, res) => {
  try {
    const { table, lang = "ja", items } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    if (!["ja", "en"].includes(lang)) throw new Error("Unsupported language.");
    const session = sessionForTable({ table, lang });
    const order = createConfirmedOrder({ table, lang, sessionId: session.sessionId, items, menu: readMenu() });
    mirrorSheetEvent({ type: "order", order });
    res.status(201).json({ order });
  } catch (error) {
    console.error("Order confirmation failed:", error);
    res.status(400).json({ error: "Unable to confirm this order." });
  }
});

app.get("/api/orders", (req, res) => {
  if (!validTable(req.query.table)) return res.status(400).json({ error: "A valid table number is required." });
  res.json(ordersForTable(req.query.table));
});

app.post("/api/events", (req, res) => {
  try {
    const { table, type } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    res.status(201).json({ event: appendEvent({ table, type }) });
  } catch (error) {
    console.error("Event creation failed:", error);
    res.status(400).json({ error: "Unable to create this event." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

function startServer(listenPort = port) {
  return app.listen(listenPort, () => {
    console.log(`IROHA Order is running at http://localhost:${listenPort}`);
  });
}

if (require.main === module) startServer();

module.exports = { app, startServer };
