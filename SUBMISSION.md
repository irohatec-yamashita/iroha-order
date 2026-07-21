# Devpost Submission Copy

> Replace the two `ADD BEFORE SUBMISSION` fields after recording and deployment. All other sections are ready to paste.

## Project name

IROHA Order

## Elevator pitch

A GPT-5.6 waiter that preserves hospitality while recommending dishes and taking confirmed orders for small restaurants.

## Category

Work & Productivity

## Repository

https://github.com/irohatec-yamashita/iroha-order

## Demo video

`ADD BEFORE SUBMISSION: public YouTube URL under 3 minutes`

## Try it out

`ADD BEFORE SUBMISSION: deployed guest URL, if available`

Local judge path:

1. Follow the README quick start.
2. Open `/index.html?table=5`, `/store.html`, and `/kitchen.html`.
3. Ask the AI open-ended menu questions, place an order, review and confirm it, then watch the operational screens update.

## Inspiration

Small restaurants do not only sell food. Their identity lives in the short conversation between a guest and a good host: where today's fish came from, which dish works with sake, whether a portion is right for two, and what to order next. At the same time, the same restaurants face labor shortages, language barriers, and staff who must repeatedly explain a menu while serving the room.

Most QR ordering systems remove that conversation. We wanted to see whether AI could reduce repetitive work without reducing hospitality. IROHA Order is our answer: a digital waiter that speaks in the restaurant's voice, understands free questions, and still respects a clear operational boundary before anything becomes a real order.

## What it does

A guest scans the QR code for their table and is greeted in Japanese or English. GPT-5.6 asks a short sequence of natural onboarding questions, then continues as a free-conversation waiter. The guest can ask anything about the menu—origin, taste, pairings, recommendations, or portion size—and the answer is grounded in the restaurant's own menu and service context.

When the guest expresses an order, GPT-5.6 does not simply reply with a total. It calls a structured `propose_order` tool using menu IDs and quantities. The server validates every item, calculates prices from the menu master, and renders an explicit readback card. Only after the guest taps Confirm is the order persisted.

Confirmed orders immediately appear on a front-of-house monitor with table totals and on a high-contrast kitchen display. The guest can view order history, raise a hand for staff, switch language, and request checkout. Checkout closes the guest-facing history and tells the store that the table is waiting to pay at the existing register.

The core receiver requires no Google Apps Script: orders and events are stored locally as JSON. A Google Sheets webhook remains an optional mirror for future analysis of conversations and service quality.

AI replies can be spoken with a single fixed OpenAI TTS voice, giving the demo a consistent host while previewing a future full-duplex GPT Realtime experience.

## How we built it

The guest interface is vanilla HTML, CSS, and JavaScript based on a polished restaurant UI prototype. A Node.js and Express server owns session state, menu context, validation, price calculation, confirmation, event recording, and operational state.

Every genuine guest turn goes through `POST /api/chat` to the OpenAI Responses API with GPT-5.6. The prompt includes the restaurant profile, available menu, origins and pairing notes, the current hospitality stage, confirmed orders, and conversation history. Structured outputs drive existing UI components for text, chips, and order proposals. OpenAI's speech API generates and caches spoken replies with one fixed voice.

Orders and events are persisted to local JSON files. `/api/state` aggregates per-table operational state for store and kitchen screens, which poll every three seconds. The optional Google Apps Script webhook is deliberately non-blocking, so the restaurant flow still works if Sheets is not configured or temporarily unavailable.

We used Codex throughout the Build Week development loop: reading the specification and prototype, replacing the rule-based conversation engine, implementing the GPT-5.6 tool boundary, diagnosing session-start and checkout regressions, building the operational displays, and writing automated and browser-level checks.

## Challenges we ran into

The hardest design problem was separating natural conversation from authoritative actions. A good waiter should sound flexible, but an order system cannot invent menu items, trust model-generated prices, or silently commit an ambiguous request. The proposal/readback/Confirm boundary let us keep both qualities.

Conversation continuity was another challenge. After a drink order, the AI still needs to ask about dislikes and guide the guest toward food without becoming a rigid script. We pass compact session state and confirmed-order context to GPT-5.6 while leaving the actual wording and follow-up conversation to the model.

We also had to treat allergy questions differently from ordinary recommendations. The model must never imply that an item is medically or religiously safe. We added a deterministic server guardrail that bypasses the model for relevant terms, highlights the staff call control, and complements the prompt-level rule and first-visit notice.

## Accomplishments that we're proud of

- The interface feels like a restaurant experience rather than a generic chatbot.
- Guests can ask unscripted questions and receive concise, menu-grounded answers.
- The AI is useful without becoming the source of truth for prices or final orders.
- The complete path—from conversation to confirmation to store and kitchen—is working without external back-office setup.
- Japanese and English service share the same operational flow.
- Safety handoff is enforced on the server, not left only to prompting.

## What we learned

The most important lesson was that useful restaurant AI is not just a better chat window. It needs explicit state, a trustworthy menu master, safe action boundaries, and operational screens that staff can understand at a glance.

We also learned that personality can be data. Menu descriptions, sourcing notes, pairing hints, and the restaurant's service principles give GPT-5.6 enough context to express a recognizable house style. With consent and appropriate data governance, future conversation analysis could help the restaurant refine that context over time without turning individual guests into profiles.

## What's next

Next we would move local persistence to a production database, add authentication and store-side order management, deploy the optional conversation mirror for aggregate hospitality analysis, and support reservation-based greetings. We also want to replace request/response TTS with GPT Realtime for interruptible, low-latency voice conversation while preserving the exact same structured order confirmation boundary.

Longer term, IROHA Order could help independent restaurants preserve and teach their service style across languages and new staff—not by replacing hospitality, but by making the restaurant's own knowledge available at every table.

## Built with

Codex, GPT-5.6, OpenAI Responses API, OpenAI Speech API, Node.js, Express, JavaScript, HTML, CSS, JSON, and optional Google Apps Script / Google Sheets.

## Pre-existing work disclosure

The polished static `demo-ui.html` visual prototype existed before Build Week. Build Week work adopted that design and replaced its scripted conversation with the real GPT-5.6 server, structured order tools, session state, persistence, voice playback, safety controls, store/kitchen views, and regression tests.
