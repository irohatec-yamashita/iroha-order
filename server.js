require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const menuPath = path.join(__dirname, "data", "menu.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/menu", (_req, res) => {
  try {
    const menu = JSON.parse(fs.readFileSync(menuPath, "utf8"));
    res.json({ ...menu, items: menu.items.filter((item) => !item.soldOut) });
  } catch (error) {
    console.error("Unable to load menu:", error);
    res.status(500).json({ error: "Menu is unavailable." });
  }
});

app.listen(port, () => {
  console.log(`IROHA Order is running at http://localhost:${port}`);
});
