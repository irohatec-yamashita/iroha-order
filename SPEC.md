# SPEC.md — IROHA Order MVP Specification (Build Week)

An AI waiter that talks, recommends, and takes orders — for small restaurants.
Guest scans a table QR (URL with table number) → chat opens → AI serves in natural conversation → confirmed orders are recorded → store/kitchen views update → payment happens at the register (Check button only notifies staff).

## 1. Roles & screens

| Screen | User | Purpose |
|---|---|---|
| `/index.html?table=N&lang=ja\|en` | Guest (own phone) | AI conversation, ordering, raise hand, check |
| `/store.html` | Store (one device) | Tables with orders & totals, raise-hand / check events |
| `/kitchen.html` | Kitchen display | Order feed, newest first, append-only (no dismissal) |

## 2. Guest UI

- Chat area (AI left, guest right). Text input + send.
- **Persistent bottom buttons:** `メニュー / 注文履歴 / 🖐手を挙げる / language / お会計` (i18n).
  - メニュー: modal listing menu by category (name, price, description); sold-out hidden.
  - 注文履歴: modal listing confirmed items + running total.
  - 🖐手を挙げる: records a `raise_hand` event; AI replies "スタッフがまいります。少々お待ちください。"
  - language: toggles ja/en (UI strings + model serving language).
  - お会計: triggers check flow (§7).
- **Confirm/Edit is inline, not persistent:** when the model proposes an order, render a readback card: item list + amounts + `［確定］［修正する］` buttons. Edit reopens quantity steppers / remove per line, then re-confirm.

## 3. Menu master — `data/menu.json`

```json
{ "restaurant": "居酒屋 いろは", "taxNote": "prices include 10% tax",
  "items": [
    {"id":"beer","name":"生ビール","en":"Draft Beer","cat":"drink","price":600,
     "aliases":["ナマ","生","生ビ","ビール"],"desc":"キンキンに冷えた生ビール","ingredients":[],"soldOut":false},
    {"id":"lemonsour","name":"レモンサワー","en":"Lemon Sour","cat":"drink","price":500,
     "aliases":["レモン"],"desc":"自家製レモンの酸味","ingredients":["lemon"],"soldOut":false},
    {"id":"highball","name":"ハイボール","en":"Highball","cat":"drink","price":550,
     "aliases":["ハイボ"],"desc":"すっきり辛口","ingredients":[],"soldOut":false},
    {"id":"oolong","name":"ウーロン茶","en":"Oolong Tea","cat":"drink","price":300,
     "aliases":["ウーロン","お茶"],"desc":"","ingredients":[],"soldOut":false},
    {"id":"sashimi","name":"刺身盛り合わせ","en":"Sashimi Platter","cat":"food","price":800,
     "aliases":["盛り合わせ","刺身","盛合せ"],"desc":"瀬戸内の地魚（鯛・イカ・アジ）","ingredients":["fish"],"soldOut":false,"perPerson":true,"recommended":true},
    {"id":"karaage","name":"唐揚げ","en":"Fried Chicken","cat":"food","price":600,
     "aliases":["からあげ","鶏唐"],"desc":"外はカリッと中はジューシー","ingredients":["chicken"],"soldOut":false,"recommended":true},
    {"id":"potatosalad","name":"ポテトサラダ","en":"Potato Salad","cat":"food","price":400,
     "aliases":["ポテサラ"],"desc":"","ingredients":["potato","egg","cucumber"],"soldOut":true},
    {"id":"edamame","name":"枝豆","en":"Edamame","cat":"food","price":350,
     "aliases":[],"desc":"","ingredients":["soybean"],"soldOut":false},
    {"id":"yakitori","name":"焼き鳥盛り","en":"Yakitori Platter","cat":"food","price":700,
     "aliases":["焼き鳥","やきとり"],"desc":"タレ・塩から選べる5本盛り","ingredients":["chicken"],"soldOut":false},
    {"id":"dashimaki","name":"だし巻き卵","en":"Dashimaki Omelet","cat":"food","price":450,
     "aliases":["だし巻き","卵焼き"],"desc":"出汁たっぷりふわふわ","ingredients":["egg"],"soldOut":false}
  ]}
```

## 4. Conversation design (system prompt requirements)

**4.1 Context given to the model each turn:** restaurant name, menu (name/en/price/aliases/desc/ingredients, sold-out excluded or flagged), serving language, table number, session state (party size, dislikes, confirmed orders so far), and conversation history.

**4.2 Serving style:** warm, concise izakaya hospitality. Flow: greeting → party size → first-visit? (brief how-to, mention Raise Hand incl. for allergies) → drinks → **dislike question** → food + today's recommendation → free ordering → check on request.

**4.3 Dislikes vs. allergies (critical distinction):**
- Dislikes (苦手) are *preferences*: remember them; recommend items avoiding those ingredients; note that companions can still order the item individually.
- Allergies are *safety*: never claim any item is safe; always redirect to staff (§6).

**4.4 Readback rule:** whenever the guest expresses an order, the model must call the `propose_order` tool (never plain-text totals). Aliases resolve via menu master; unknown items → clarify; sold-out → apologize + suggest alternative.

## 5. Tool schema & API

`propose_order` (model → app): `{ items: [{id, qty}], note? }` → app computes prices/total from menu.json (never trust model prices) → renders readback card.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | `{table, lang, sessionState, messages[]}` → model reply `{text, proposal?}` |
| `POST /api/orders` | Confirm: `{table, items:[{id,qty}]}` → append to orders.json `{orderId, time, table, source:"guest", lines:[{id,name,qty,unit,subtotal}], status:"confirmed"}` |
| `GET /api/orders?table=N` | Order history / totals |
| `POST /api/events` | `{table, type:"raise_hand"|"check"}` → events.json |
| `GET /api/state` | Store/kitchen polling: orders + events + per-table totals |
| `GET /api/menu` | Menu for UI |

## 6. Allergy guardrail (three layers)

1. **Upfront notice** in the first-visit explanation (both languages): allergies → Raise Hand.
2. **Server-side detection** on guest input: keywords (アレルギー, allergy, allergic, ハラール, halal, kosher, ビーガン, vegan, グルテン, gluten, 食物制限…) → force fixed reply: "大切なことですので、スタッフが直接確認いたします。🖐手を挙げるボタンを押してください。" and visually highlight Raise Hand. The model is bypassed for the safety claim.
3. **System prompt hard rule:** the model must never state an item is safe for any allergy/restriction; on such topics it must redirect to staff.

## 7. Check flow (register payment — no payment integration)

Guest taps お会計 → order summary readback (all confirmed items + total) → `［確定］［修正する］` → on confirm: record `check` event, AI: "スタッフにお会計をお知らせしました。恐れ入りますが、レジにてご精算をお願いいたします。本日はありがとうございました。" Store view shows "テーブルN お会計 ¥total". Staff settles at register (cash/cashless as usual). Optional: staff marks table as settled in store.html (nice-to-have).

## 8. Store & kitchen views

- **store.html:** table cards (unpaid orders + total, status: 空席/注文中/お会計), event feed with timestamps ("19:25 テーブル5が手を挙げています"). Poll `/api/state` every 3s.
- **kitchen.html:** large-text feed of order lines, newest on top, append-only (no dismissal — deliberate design: zero kitchen operations).

## 9. Sheets mirror (optional, M6)

If `SHEETS_WEBHOOK_URL` is set, POST confirmed orders (JSON) to the GAS webhook; fire-and-forget, errors logged only.

## 10. Non-goals (future work)

Voice, reservations & personalized greeting, cancellations/sold-out toggle UI, payment integration & auto-reconciliation, per-language analytics, multi-restaurant tenancy, auth.
