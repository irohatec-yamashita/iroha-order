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
const { appendEvent, closeOrdersForTable, createConfirmedOrder, ordersForTable, stateSnapshot } = require("./lib/store");

const app = express();
const port = Number(process.env.PORT) || 3000;
const voiceModel = process.env.VOICE_MODEL || "gpt-4o-mini-tts-2025-12-15";
const voiceName = process.env.VOICE_NAME || "marin";
const speechCache = new Map();
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

function safetyRedirectFor(message, lang = "ja") {
  if (!message) return null;
  const safetyPattern = /(?:アレルギー|食物(?:制限|アレルギー)|宗教(?:上|的)?(?:の)?(?:制限|理由)|ハラール|ヴィーガン|ビーガン|グルテン|allerg(?:y|ies|ic)|dietary restriction|halal|kosher|vegan|gluten)/i;
  if (!safetyPattern.test(message.normalize("NFKC"))) return null;
  return lang === "en"
    ? "This is important, so a staff member will confirm it with you directly. Please tap the Raise Hand button."
    : "大切なことですので、スタッフが直接確認いたします。🖐 手を挙げるボタンを押してください。";
}

function serviceAnswerFor(session, message) {
  if (!message) return null;
  const normalized = message.trim().normalize("NFKC").toLowerCase();
  if (session.stage === "party_size") {
    const match = normalized.match(/([1-9]\d?)\s*(?:名|人|people|persons?)/);
    if (match) return { kind: "party_size_answered", partySize: Number(match[1]) };
  }
  if (session.stage === "first_visit") {
    if (/初めて(?:では|じゃ)ない|来たことが|リピーター|returning|not (?:my |our )?first|^no\b/.test(normalized)) {
      return { kind: "first_visit_answered", firstVisit: false };
    }
    if (/初めて|初来店|first time|^yes\b/.test(normalized)) {
      return { kind: "first_visit_answered", firstVisit: true };
    }
  }
  if (session.stage === "dislikes" && /^(特になし|なし|ありません|ないです|特にありません|none|nothing|no)$/i.test(normalized)) {
    return { kind: "dislikes_none", dislikes: [] };
  }
  return null;
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

app.post("/api/speech", async (req, res) => {
  try {
    const { text, lang = "ja" } = req.body || {};
    const input = typeof text === "string" ? text.trim() : "";
    if (!input || input.length > 2000) throw new Error("Invalid speech text.");
    if (!["ja", "en"].includes(lang)) throw new Error("Unsupported language.");
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Voice service is not configured." });

    const cacheKey = `${lang}:${input}`;
    const cached = speechCache.get(cacheKey);
    if (cached) {
      res.set("Content-Type", "audio/mpeg");
      res.set("Cache-Control", "private, max-age=3600");
      res.set("X-Iroha-Voice", voiceName);
      return res.send(cached);
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: voiceModel,
        voice: voiceName,
        input,
        instructions: lang === "ja"
          ? "毎回まったく同じ一人の居酒屋スタッフとして、声質・年齢感・話し方を変えずに話してください。自然で温かく、落ち着いた速さで、過度に演技しないでください。"
          : "Always speak as the exact same single restaurant host. Keep the voice identity, perceived age, accent, and delivery consistent. Be warm, natural, concise, and do not overact.",
        response_format: "mp3"
      })
    });
    if (!response.ok) {
      console.error("Voice generation failed:", response.status, await response.text());
      return res.status(502).json({ error: "Voice generation failed." });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    speechCache.set(cacheKey, audio);
    if (speechCache.size > 64) speechCache.delete(speechCache.keys().next().value);
    res.set("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Iroha-Voice", voiceName);
    res.send(audio);
  } catch (error) {
    console.error("Speech request failed:", error);
    res.status(400).json({ error: "Unable to generate speech." });
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
    const mustAdvanceToDislikes = chatEvent === "order_confirmed" && !session.dislikesAsked;
    let guestMessage = safeMessage(message);
    if (!guestMessage && !chatEvent && suppliedMessages.at(-1)?.role === "user") {
      guestMessage = suppliedMessages.at(-1).content;
    }
    if (!chatEvent && !guestMessage) throw new Error("A guest message or chat event is required.");
    const turnSignal = serviceAnswerFor(session, guestMessage);

    if (guestMessage) {
      const entry = appendTranscript({ table, role: "user", content: guestMessage });
      mirrorSheetEvent({ type: "conversation", sessionId: session.sessionId, table, lang, stage: session.stage, ...entry });
    }

    const safetyText = safetyRedirectFor(guestMessage, lang);
    if (safetyText) {
      const entry = appendTranscript({ table, role: "assistant", content: safetyText });
      mirrorSheetEvent({ type: "conversation", sessionId: session.sessionId, table, lang, stage: session.stage, ...entry });
      return res.json({
        text: safetyText,
        chips: [],
        proposal: null,
        highlightRaiseHand: true,
        sessionState: session,
        checkout: null
      });
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
        turnSignal,
        confirmedOrders: confirmed.orders,
        confirmedTotal: confirmed.total,
        hasConfirmedDrink,
        hasConfirmedFood
      },
      messages: conversation.length ? conversation : suppliedMessages,
      uiEvent: chatEvent
    });
    // A UI event is an acknowledgement/transition, never a new order request.
    // Keep this server-side boundary even if a model unexpectedly emits a tool call.
    const proposal = chatEvent ? null : reply.proposal;

    let sessionUpdate = mustAdvanceToDislikes
      ? { ...(reply.session || {}), stage: "dislikes", dislikesAsked: true }
      : reply.session;
    if (turnSignal?.kind === "party_size_answered") {
      sessionUpdate = { ...(sessionUpdate || {}), stage: "first_visit", partySize: turnSignal.partySize };
    }
    if (turnSignal?.kind === "first_visit_answered") {
      sessionUpdate = { ...(sessionUpdate || {}), stage: "drinks", firstVisit: turnSignal.firstVisit };
    }
    if (turnSignal?.kind === "dislikes_none") {
      sessionUpdate = { ...(sessionUpdate || {}), stage: "food", dislikes: [], dislikesAsked: true };
    }
    const forcedStage = proposal
      ? "order_confirmation"
      : chatEvent === "checkout_requested"
        ? "checkout"
        : turnSignal?.kind === "party_size_answered"
          ? "first_visit"
          : turnSignal?.kind === "first_visit_answered"
            ? "drinks"
            : turnSignal?.kind === "dislikes_none"
              ? "food"
              : undefined;
    session = applySessionUpdate({
      table,
      lang,
      update: sessionUpdate,
      forceStage: forcedStage
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
      proposal,
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

app.get("/api/state", (_req, res) => {
  try {
    res.json(stateSnapshot());
  } catch (error) {
    console.error("State snapshot failed:", error);
    res.status(500).json({ error: "Unable to load restaurant state." });
  }
});

app.post("/api/events", (req, res) => {
  try {
    const { table, type } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    const event = appendEvent({ table, type });
    const closedOrderIds = type === "check" ? closeOrdersForTable(table) : [];
    if (closedOrderIds.length) mirrorSheetEvent({ type: "checkout_requested", table, orderIds: closedOrderIds, time: event.time });
    res.status(201).json({ event, closedOrderIds });
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

module.exports = { app, safetyRedirectFor, serviceAnswerFor, startServer };
