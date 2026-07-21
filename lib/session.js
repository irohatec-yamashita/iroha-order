const { randomUUID } = require("crypto");

const STAGES = new Set([
  "party_size",
  "first_visit",
  "drinks",
  "dislikes",
  "food",
  "free_ordering",
  "order_confirmation",
  "checkout"
]);

const sessions = new Map();
const transcripts = new Map();

function freshSession({ table, lang }) {
  return {
    sessionId: randomUUID(),
    table,
    lang,
    stage: "party_size",
    partySize: null,
    firstVisit: null,
    dislikes: [],
    dislikesAsked: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function beginSession({ table, lang }) {
  const session = freshSession({ table, lang });
  sessions.set(table, session);
  transcripts.set(table, []);
  return { ...session };
}

function sessionForTable({ table, lang }) {
  if (!sessions.has(table)) return beginSession({ table, lang });
  const session = sessions.get(table);
  if (session.lang !== lang) {
    session.lang = lang;
    session.updatedAt = new Date().toISOString();
  }
  return { ...session, dislikes: [...session.dislikes] };
}

function applySessionUpdate({ table, lang, update, forceStage }) {
  const current = sessions.get(table) || freshSession({ table, lang });
  const next = { ...current, lang };

  if (update && typeof update === "object") {
    if (STAGES.has(update.stage)) next.stage = update.stage;
    if (update.partySize === null || (Number.isInteger(update.partySize) && update.partySize >= 1 && update.partySize <= 99)) {
      next.partySize = update.partySize;
    }
    if (update.firstVisit === null || typeof update.firstVisit === "boolean") next.firstVisit = update.firstVisit;
    if (Array.isArray(update.dislikes)) {
      next.dislikes = [...new Set(update.dislikes
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
        .slice(0, 20))];
    }
    if (typeof update.dislikesAsked === "boolean") next.dislikesAsked = current.dislikesAsked || update.dislikesAsked;
  }

  if (STAGES.has(forceStage)) next.stage = forceStage;
  next.updatedAt = new Date().toISOString();
  sessions.set(table, next);
  return { ...next, dislikes: [...next.dislikes] };
}

function appendTranscript({ table, role, content }) {
  if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim()) return null;
  const entries = transcripts.get(table) || [];
  const entry = { role, content: content.trim(), time: new Date().toISOString() };
  entries.push(entry);
  transcripts.set(table, entries.slice(-100));
  return { ...entry };
}

function messagesForTable(table, limit = 28) {
  return (transcripts.get(table) || []).slice(-limit).map(({ role, content }) => ({ role, content }));
}

function resetSessions() {
  sessions.clear();
  transcripts.clear();
}

module.exports = {
  STAGES,
  appendTranscript,
  applySessionUpdate,
  beginSession,
  messagesForTable,
  resetSessions,
  sessionForTable
};
