const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
for (const name of ["orders.json", "events.json"]) {
  fs.writeFileSync(path.join(dataDir, name), "[]\n", "utf8");
}

console.log("Demo data reset.");
