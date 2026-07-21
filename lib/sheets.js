function validWebhook(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mirrorSheetEvent(payload) {
  const webhook = validWebhook(process.env.SHEETS_WEBHOOK_URL);
  if (!webhook) return;
  fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch((error) => console.error("Sheets mirror failed:", error.message));
}

module.exports = { mirrorSheetEvent };
