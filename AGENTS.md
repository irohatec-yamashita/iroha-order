# AGENTS.md — IROHA Order (Build Week MVP)

You are implementing **IROHA Order**: an AI waiter that talks, recommends, and takes orders — for small restaurants. Total budget: ~10 hours of implementation. Ship a working MVP, not a perfect product. Read `SPEC.md` fully before writing code. When SPEC.md and this file conflict, SPEC.md wins.

## Ground rules

1. **Spec-driven.** Implement milestone by milestone (M1→M6 below). After each milestone, run the app and verify the acceptance check before moving on.
2. **The AI never writes orders directly.** All orders pass through: model proposes → UI shows readback with Confirm/Edit buttons → guest taps Confirm → server records. This is the core invariant. Never bypass it.
3. **The AI never makes allergy/safety judgments.** See SPEC.md §6. This is a hard requirement, not a nice-to-have.
4. **Keep the stack boring.** Node.js 20 + Express, vanilla JS/HTML/CSS frontend (no build step), JSON file persistence. No database, no framework, no TypeScript. One repo, one `npm start`.
5. **Secrets server-side only.** The OpenAI API key lives in `.env` (`OPENAI_API_KEY`). The browser never sees it. Provide `.env.example`.
6. **Model via env.** `MODEL=gpt-5.6` in `.env.example` (do not hardcode; the operator will set the exact model id).
7. **Small commits with clear messages** (`M2: readback + confirm flow`), so the commit history tells the build story for judges.
8. **Language:** UI copy bilingual-ready — all strings in `public/i18n.js` with `ja` and `en` tables. Default `ja`.

## Stack & layout

```
/server.js            Express app (serves /public, API routes)
/lib/ai.js            OpenAI call: context assembly, tool schema, response parsing
/lib/store.js         JSON persistence (data/orders.json, data/events.json)
/data/menu.json       Menu master (provided in SPEC.md §3 — copy as-is)
/public/index.html    Guest chat UI  (?table=5&lang=ja)
/public/store.html    Store view     (orders, checks, raised hands)
/public/kitchen.html  Kitchen view   (auto-refresh order feed)
/public/app.js        Chat logic
/public/i18n.js       UI strings ja/en
.env.example          OPENAI_API_KEY, MODEL, PORT, SHEETS_WEBHOOK_URL (optional)
```

## Milestones

- **M1 — Skeleton.** Express serving the three pages; `GET /api/menu` returns menu.json minus sold-out items. ✅ `npm start` works, pages load.
- **M2 — Conversation core.** `POST /api/chat` → GPT-5.6 with restaurant context (SPEC §4) and `propose_order` tool (SPEC §5). Chat UI with persistent buttons (Menu / Order History / 🖐 Raise Hand / language / Check). Model proposals render as readback cards with **Confirm / Edit** inline. Confirm → `POST /api/orders`. ✅ "生ビール2つとレモンサワー1つ" → readback → confirm → order stored with table number.
- **M3 — Flow polish.** Dislike question after first drink order; recommendations avoid disliked ingredients (SPEC §4.3). Order History panel from stored orders. Sold-out items refused gracefully. ✅ "パクチーが苦手" → recommendation avoids it; alias "ナマ" resolves to 生ビール.
- **M4 — Guardrail + language.** Allergy/dietary keyword detection (server-side, SPEC §6) forces staff-redirect reply + highlights Raise Hand. `language` button switches UI strings and instructs the model to serve in English. ✅ "エビアレルギーがあります" → redirect, no safety claim. English mode: full greeting-to-order in English.
- **M5 — Store & kitchen.** Raise Hand → event; Check button → order summary readback → confirm → "please pay at the register" message + check event. `store.html` shows tables with orders/totals and event feed (polling, 3s). `kitchen.html` shows order feed, newest on top, no dismissal (append-only). ✅ Two browser windows: guest action appears on store/kitchen within 3s.
- **M6 — Optional Sheets mirror.** If `SHEETS_WEBHOOK_URL` set, POST each confirmed order (fire-and-forget) to that GAS webhook. Failure must not break ordering. ✅ Unset = app works identically.

## Testing & sample data

`data/menu.json` ships with 10 items (SPEC §3). Add `npm run demo-reset` (clears data/*.json). Include 3–4 automated smoke tests only if time remains; manual acceptance checks above are the priority.

## Out of scope (do NOT build)

Voice I/O, reservations, cancel/sold-out management UI, payment integration, analytics, auth, multi-restaurant tenancy. These are documented as future work.
