# Conversation history and restaurant context

When `SHEETS_WEBHOOK_URL` is configured, the server mirrors each guest and AI
message to the Google Apps Script webhook. Ordering never waits for this webhook;
a Sheets outage must not interrupt service.

Conversation rows contain:

- `type`: `conversation`
- `sessionId`: one ID per seated party
- `table`, `lang`, `stage`
- `role`: `user` or `assistant`
- `content`, `time`

Confirmed-order rows use `type: order` and include the same `sessionId`. This makes
it possible to analyze complete visits without mixing consecutive parties at the
same table.

## Safe feedback loop

Use the Sheet history to produce periodic summaries such as frequently asked
questions, successful recommendation patterns, preferred tone, and missing menu
facts. A person at the restaurant should review those summaries before promoting
them to `data/restaurant.json` under `hospitalityProfile.approvedInsights`.

The server reloads `data/restaurant.json` on every GPT turn, so approved insights
take effect immediately. Raw guest messages are never copied automatically into
the AI context. This prevents personal information, one-off requests, prompt
injection, or a mistaken analysis from silently changing the restaurant's voice.
