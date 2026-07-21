require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { AIConfigurationError, chatWithWaiter } = require("./lib/ai");
const { createConfirmedOrder, ordersForTable } = require("./lib/store");

const app = express();
const port = Number(process.env.PORT) || 3000;
const menuPath = path.join(__dirname, "data", "menu.json");

function readMenu() {
  return JSON.parse(fs.readFileSync(menuPath, "utf8"));
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
    const { table, lang = "ja", sessionState = {}, messages } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    if (!["ja", "en"].includes(lang)) throw new Error("Unsupported language.");
    const reply = await chatWithWaiter({
      menu: readMenu(),
      table,
      lang,
      sessionState: typeof sessionState === "object" && sessionState ? sessionState : {},
      messages: safeMessages(messages)
    });
    res.json(reply);
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
    const { table, items } = req.body || {};
    if (!validTable(table)) throw new Error("A valid table number is required.");
    const order = createConfirmedOrder({ table, items, menu: readMenu() });
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

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`IROHA Order is running at http://localhost:${port}`);
});
