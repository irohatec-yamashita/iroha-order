# IROHA Order

**An AI waiter that talks, recommends, and takes orders — for small restaurants.**

Scan the QR code at your table and an AI waiter greets you, recommends today's specials around your dislikes, takes your order in natural conversation (Japanese or English), and notifies the staff when you're ready to pay at the register. Built for OpenAI Build Week with **Codex** (development) and **GPT-5.6** (the serving engine).

- 🎥 Demo video: `<YOUTUBE_LINK>`
- 🌐 Live demo: `<DEMO_URL>/index.html?table=5` (guest) / `<DEMO_URL>/store.html` (store) / `<DEMO_URL>/kitchen.html` (kitchen)

## Quick start

```bash
git clone <REPO_URL> && cd iroha-order
npm install
cp .env.example .env        # set OPENAI_API_KEY and MODEL (gpt-5.6)
npm start                   # http://localhost:3000
```

Open three windows to simulate the restaurant:

| URL | Role |
|---|---|
| `http://localhost:3000/index.html?table=5` | Guest at table 5 (phone) |
| `http://localhost:3000/store.html` | Store device |
| `http://localhost:3000/kitchen.html` | Kitchen display |

**Try:** "生ビール2つとレモンサワー1つ" → Confirm → order appears on store/kitchen. Say "パクチーが苦手" and ask for a recommendation. Say "エビアレルギーがあります" to see the safety guardrail. Tap **language** for English service. Tap **お会計** to notify staff (payment at the register — no payment integration by design).

Sample data ships in `data/menu.json` (10 izakaya items with aliases, descriptions, one sold-out item). `npm run demo-reset` clears orders/events.

## How Codex was used

We wrote the full specification first (`SPEC.md`) — conversation scripts, allergy guardrail, data structures, screens — then handed it to Codex with working rules in `AGENTS.md` and implemented in six milestones (M1 skeleton → M6 optional Sheets mirror). Codex generated the Express server, chat UI, readback/confirm flow, and store/kitchen views; we also used it to reason about the tool schema, hunt down errors, and propose fixes in short spec→implement→verify cycles. The commit history follows the milestones. Session ID submitted via `/feedback`.

## How GPT-5.6 is used

GPT-5.6 is the runtime serving engine. Each turn it receives the restaurant's AI context (menu with prices, aliases like "ナマ" for draft beer, descriptions, sold-out flags, the guest's dislikes and order state) and converses naturally in the guest's language. When the guest orders, it calls the `propose_order` tool with structured items; **the app computes all prices from the menu master and nothing is recorded until the guest taps Confirm**. For allergy/dietary topics a server-side guardrail bypasses the model's judgment entirely and redirects to human staff.

## Architecture

```
Guest phone (chat UI) ──POST /api/chat──▶ Express ──▶ GPT-5.6 (context + propose_order tool)
        │ Confirm                          │
        └────POST /api/orders──────────────┤  data/orders.json, data/events.json
Store view / Kitchen display ◀──GET /api/state (poll 3s)
Optional: confirmed orders mirrored to Google Sheets via GAS webhook (SHEETS_WEBHOOK_URL)
```

No database, no build step, no payment integration — a small restaurant can run this next to its existing register without changing anything.

## Safety design

The AI never makes allergy or dietary-safety claims. Three layers: an upfront multilingual notice, server-side keyword detection that forces a staff-redirect reply and highlights the 🖐 Raise Hand button, and a hard system-prompt rule. Dislikes (preferences) are handled by the AI; allergies (safety) are handled by humans.

## Future work

Voice conversation, reserved-guest hospitality, store-side sold-out/cancel management, per-language customer analytics, payment integration for automated checkout.
