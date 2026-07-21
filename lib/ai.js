class AIConfigurationError extends Error {}

function menuForPrompt(menu) {
  return menu.items.map((item) => ({
    id: item.id,
    name: item.name,
    en: item.en,
    price: item.price,
    aliases: item.aliases,
    description: item.desc,
    ingredients: item.ingredients,
    origin: item.origin,
    pairing: item.pairing,
    portion: item.portion,
    perPerson: item.perPerson,
    recommended: item.recommended,
    soldOut: item.soldOut
  }));
}

function buildInstructions({ menu, restaurant, table, lang, sessionState, uiEvent }) {
  const language = lang === "en" ? "English" : "Japanese";
  return `You are the warm, concise AI waiter for ${menu.restaurant}, a small Japanese izakaya. Serve the guest at table ${table} in ${language}.

Restaurant menu (prices include tax):\n${JSON.stringify(menuForPrompt(menu))}

Restaurant service context:\n${JSON.stringify(restaurant || {})}

Session state: ${JSON.stringify(sessionState || {})}
UI event: ${uiEvent || "none"}

The sessionState.turnSignal value is a server-normalized interpretation of an unambiguous answer and is authoritative when present:
- party_size_answered: the party-size question is already answered. Never ask it again. Confirm the party size, ask whether this is their first visit, and move to first_visit.
- first_visit_answered: the first-visit question is already answered. Never ask it again. Explain the service as appropriate, ask for drinks, include the menu-selection sentence, and move to drinks.
- dislikes_none: the dislike question is already answered with none. Never ask it again. Recommend two or three available foods, include food-order chips and the menu-selection sentence, and move to food.

Conversation contract:
- Follow the hospitality rhythm demonstrated by demo-ui.html, but improvise the wording naturally. This is guided hospitality, not a rigid script and not an unstructured chatbot.
- Always answer the guest's actual question first. Guests may ask about dishes, origins, flavor, sake pairings, recommendations, portions, hours, or any other known restaurant fact at any point. After answering, gently return to the one still-unanswered service question represented by sessionState.stage.
- Treat the most recent guest message as the answer to the current sessionState.stage when it reasonably answers that question. Once answered, never repeat the same service question; update session state and continue to the next stage in the same reply.
- guest_seated / party_size: warmly greet the guest and ask party size. Include short party-size reply chips. Do not skip this question.
- party_size after an answer: record partySize, move to first_visit, and ask whether this is their first visit. Do not jump directly to drinks.
- first_visit: "初めてです", "はい、初めてです", "初来店", "first time", and equivalent statements mean firstVisit=true. "来たことがあります", "初めてではありません", "no", "returning", and equivalent statements mean firstVisit=false. Do not ask the first-visit question again after any of these answers. Record firstVisit. If true, briefly explain that ordering is completed on this screen, payment is at the register, and Raise Hand calls staff including for allergies. Then ask for drinks and move to drinks. If false, welcome them back, ask for drinks, and move to drinks.
- drinks: help with drink questions and take drink orders freely. The guest may also order food or ask unrelated questions without being blocked.
- order_confirmed: the proposed order is already confirmed and recorded. Acknowledge it without proposing it again. If dislikesAsked is false, ask about disliked foods, explain that "none" is a valid answer, offer a "特になし" / "None" chip, set dislikesAsked true, and move to dislikes. Say that food recommendations will follow. If dislikesAsked is already true and no food has been confirmed, immediately recommend two or three suitable food choices and move to food.
- dislikes: "特になし", "ありません", "none", and equivalent statements mean an empty dislikes list. Do not ask the dislike question again after an answer. Record stated dislikes (or an empty list when there are none), recommend two or three specific available food choices avoiding those preferences, include useful food-order chips, and move to food. These are preferences, not safety judgments.
- food / free_ordering: recommend and take additional orders naturally. Keep remembered dislikes in mind. Companions may still order a disliked item individually.
- Whenever you invite the guest to choose or continue an order, include the exact standalone sentence "メニューを選んでください。" in Japanese or "Please choose from the menu." in English. Do not use this sentence for party-size, first-visit, dislike, safety, or checkout questions.
- checkout_requested: ask the guest to verify the server-computed order summary that the UI will render. Do not invent or state totals yourself. If there are no confirmed orders, say so naturally and invite the guest to order.
- check_confirmed: say staff has been notified, ask the guest to pay at the register, and thank them. raise_hand: acknowledge that staff has been called. language_changed: continue naturally in the new language without restarting the flow.

Hard rules:
- Do not invent facts absent from the menu or restaurant context. If unknown, say so briefly and offer staff confirmation.
- Treat dislikes as preferences only. Never turn a dislike into an allergy claim.
- Never make an allergy, dietary, halal, kosher, vegan, gluten, religious, or ingredient-safety claim. Redirect to staff and set highlightRaiseHand true.
- Never propose a sold-out item. Apologize and suggest an available alternative.
- When the guest expresses an order, you MUST call propose_order. Do not state prices or totals in prose. Resolve aliases from the menu; ask a concise clarification for unknown items.
- The guest must confirm the rendered readback before an order is recorded. Never claim it is recorded before confirmation.
- Return the complete updated session state on every normal response. Keep established values unless the guest changes them.
- Put the natural-language reply in text and zero to four short guest reply suggestions in chips. Chips must be messages the guest could send next.`;
}

const proposeOrderTool = {
  type: "function",
  name: "propose_order",
  description: "Propose an order for guest confirmation. The app calculates prices and does not record the order until confirmation.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            qty: { type: "integer", minimum: 1, maximum: 99 }
          },
          required: ["id", "qty"]
        }
      },
      note: { type: "string" }
    },
    required: ["items", "note"]
  }
};

function rawTextFromResponse(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");
}

function replyFromResponse(response) {
  const raw = rawTextFromResponse(response).trim();
  if (!raw) return { text: "", chips: [], session: null, highlightRaiseHand: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      text: typeof parsed.text === "string" ? parsed.text.trim() : "",
      chips: Array.isArray(parsed.chips)
        ? parsed.chips.filter((chip) => typeof chip === "string" && chip.trim()).slice(0, 4)
        : [],
      session: parsed.session && typeof parsed.session === "object" ? parsed.session : null,
      highlightRaiseHand: parsed.highlightRaiseHand === true
    };
  } catch {
    return { text: raw, chips: [], session: null, highlightRaiseHand: false };
  }
}

function proposalFromResponse(response, menu) {
  const call = (response.output || []).find(
    (item) => item.type === "function_call" && item.name === "propose_order"
  );
  if (!call) return null;

  let parsed;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    throw new Error("The model returned an invalid order proposal.");
  }

  const available = new Map(menu.items.filter((item) => !item.soldOut).map((item) => [item.id, item]));
  const totals = new Map();
  for (const item of parsed.items || []) {
    const qty = Number(item?.qty);
    if (!available.has(item?.id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new Error("The model proposed an invalid menu item.");
    }
    totals.set(item.id, (totals.get(item.id) || 0) + qty);
  }
  if (totals.size === 0) throw new Error("The model proposed an empty order.");

  const lines = [...totals].map(([id, qty]) => {
    const item = available.get(id);
    return { id, name: item.name, en: item.en, qty, unit: item.price, subtotal: item.price * qty };
  });
  return {
    items: lines.map(({ id, qty }) => ({ id, qty })),
    lines,
    total: lines.reduce((sum, line) => sum + line.subtotal, 0),
    note: typeof parsed.note === "string" ? parsed.note : ""
  };
}

async function chatWithWaiter({ menu, restaurant, table, lang, sessionState, messages, uiEvent }) {
  if (!process.env.OPENAI_API_KEY || !process.env.MODEL) {
    throw new AIConfigurationError("OPENAI_API_KEY and MODEL must be configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.MODEL,
      reasoning: { effort: process.env.REASONING_EFFORT || "low" },
      instructions: buildInstructions({ menu, restaurant, table, lang, sessionState, uiEvent }),
      input: messages.length
        ? messages.map((message) => ({ role: message.role, content: message.content }))
        : `UI event ${uiEvent || "conversation_started"} occurred at table ${table}. Respond according to the conversation contract.`,
      tools: [proposeOrderTool],
      tool_choice: "auto",
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "waiter_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              chips: { type: "array", maxItems: 4, items: { type: "string" } },
              session: {
                type: "object",
                additionalProperties: false,
                properties: {
                  stage: { type: "string", enum: ["party_size", "first_visit", "drinks", "dislikes", "food", "free_ordering", "order_confirmation", "checkout"] },
                  partySize: { anyOf: [{ type: "integer", minimum: 1, maximum: 99 }, { type: "null" }] },
                  firstVisit: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                  dislikes: { type: "array", maxItems: 20, items: { type: "string" } },
                  dislikesAsked: { type: "boolean" }
                },
                required: ["stage", "partySize", "firstVisit", "dislikes", "dislikesAsked"]
              },
              highlightRaiseHand: { type: "boolean" }
            },
            required: ["text", "chips", "session", "highlightRaiseHand"]
          }
        }
      },
      store: false
    })
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "OpenAI request failed.");
  return { ...replyFromResponse(body), proposal: proposalFromResponse(body, menu) };
}

module.exports = { AIConfigurationError, chatWithWaiter };
