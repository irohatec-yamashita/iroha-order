# IROHA Order

**A GPT-5.6 waiter that preserves hospitality while recommending dishes and taking confirmed orders for small restaurants.**

IROHA Order turns a table QR code into a natural Japanese or English restaurant conversation. Guests can ask open-ended questions such as where the fish came from, what pairs with sake, or whether a dish is large enough for two. GPT-5.6 answers from the restaurant's own menu context, recommends dishes, and converts actual orders into a structured proposal. Nothing reaches the kitchen until the guest reviews the price and taps **Confirm**.

Built for OpenAI Build Week 2026 in the **Work & Productivity** category.

- Repository: https://github.com/irohatec-yamashita/iroha-order
- Guest UI: `/index.html?table=5`
- Store monitor: `/store.html`
- Kitchen display: `/kitchen.html`

## What works now

- Free conversation powered by GPT-5.6, grounded in `data/menu.json` and `data/restaurant.json`
- Japanese/English guest UI based on a polished restaurant prototype
- Structured `propose_order` flow: AI proposes menu IDs and quantities; the server computes prices
- Required readback and explicit Confirm before an order is saved
- Fixed OpenAI TTS voice (`marin`) for AI replies, with an on/off control and audio caching
- Menu sheet, chips, order history, raise-hand notification, and register checkout flow
- Local JSON order/event persistence that works without Google Apps Script
- Live store and kitchen displays polling the operational state every three seconds
- Optional fire-and-forget Google Sheets mirroring when `SHEETS_WEBHOOK_URL` is configured
- Three-layer allergy/dietary guardrail that hands safety questions to staff

## Quick start

Requirements: Node.js 20+ and an OpenAI API key with access to GPT-5.6.

```bash
git clone https://github.com/irohatec-yamashita/iroha-order.git
cd iroha-order
npm install
cp .env.example .env
npm start
```

Set at least these values in `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
MODEL=gpt-5.6
```

The app creates `data/orders.json` and `data/events.json` on first use. Both are intentionally git-ignored runtime files. To clear the local demo state, run `npm run demo-reset`.

Open these views in separate windows:

| URL | Role |
|---|---|
| `http://localhost:3000/index.html?table=5` | Guest at table 5 |
| `http://localhost:3000/store.html` | Front-of-house monitor |
| `http://localhost:3000/kitchen.html` | Kitchen order feed |

## Two-minute judge path

1. Open the three URLs above.
2. Complete the short seating flow in the guest UI.
3. Ask `この刺身はどこの魚？` and `日本酒に合う料理は？` to demonstrate free, menu-grounded conversation.
4. Say `生ビール2つとレモンサワー1つ` and inspect the structured readback card.
5. Tap **Confirm**. The order appears on both the store and kitchen screens.
6. Say `エビアレルギーがあります` to see the staff handoff and highlighted Raise Hand control.
7. Tap **お会計**, review the total, and confirm. Guest order history clears while the store screen changes to checkout waiting.
8. Switch the guest language to English and continue the same session.

## Architecture

```text
Guest phone ── POST /api/chat ──> Express ──> GPT-5.6
     │                 │                       └─ propose_order({id, qty})
     │ Confirm         ├─ server menu validation and price calculation
     └─ POST /api/orders ──> data/orders.json
                              data/events.json
Store / Kitchen <── GET /api/state every 3 seconds

Optional: confirmed conversations and orders ──> GAS webhook ──> Google Sheets
```

There is no payment integration. Checkout notifies staff and the guest pays at the existing register. This keeps the MVP compatible with a small restaurant's current operations.

## How GPT-5.6 is used

Every guest turn is sent to `POST /api/chat`; there is no client-side rule-based reply engine. GPT-5.6 receives the current restaurant context, available menu, descriptions, origins, pairings, table number, session stage, confirmed orders, and conversation transcript. It returns concise natural-language service plus optional chips.

When a guest expresses an order, GPT-5.6 must call the `propose_order` tool with menu IDs and quantities. The application resolves those IDs against the menu master, rejects invalid or sold-out items, calculates all unit prices and totals on the server, and displays a readback card. Only the guest's Confirm action calls `POST /api/orders`.

## Safety design

Allergy and dietary restrictions are not treated as ordinary recommendations:

1. The first-visit explanation tells guests to call staff for allergies.
2. Server-side Japanese/English keyword detection bypasses the model, returns a fixed staff-handoff message, and highlights Raise Hand.
3. The GPT-5.6 system instructions prohibit claims that a dish is safe and require a staff handoff.

Dislikes remain conversational preferences; allergies remain human decisions.

## How Codex was used

The project was developed specification-first with `SPEC.md` and repository rules in `AGENTS.md`. Codex was used to inspect the existing prototype, replace its scripted conversation engine with the GPT-5.6 Responses API, design the tool contract and session state, implement the Express APIs and persistent order flow, add TTS and operational displays, diagnose browser/API regressions, and write regression tests. The commit history shows the milestone sequence and subsequent usability fixes.

The polished static `demo-ui.html` prototype existed before Build Week. During Build Week, its visual design was adopted as the guest UI while the scripted behavior was removed and replaced with the real GPT-5.6 server, confirmation boundary, persistence, voice playback, store/kitchen views, safety controls, and tests.

## Configuration

See `.env.example` for all options. Key values:

- `OPENAI_API_KEY`: required for chat and voice
- `MODEL`: defaults to the configured GPT-5.6 model
- `REASONING_EFFORT`: set to `low` for responsive restaurant turns
- `VOICE_MODEL`: OpenAI speech model
- `VOICE_NAME`: fixed to one host voice (`marin` by default)
- `SHEETS_WEBHOOK_URL`: optional; leave blank to use local JSON only

## Current limitations and next steps

- Single-process, single-restaurant MVP with local JSON persistence and no authentication
- Google Sheets requires a separately deployed GAS webhook and is not configured by default
- OpenAI TTS previews the voice experience; full duplex GPT Realtime conversation is future work
- Sold-out/cancel controls, reservation-based greetings, production database deployment, analytics, and payments are future work

## License

MIT — see `LICENSE`.
