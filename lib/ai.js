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

function buildInstructions({ menu, table, lang, sessionState, uiEvent }) {
  const language = lang === "en" ? "English" : "Japanese";
  return `You are the warm, concise AI waiter for ${menu.restaurant}, a small Japanese izakaya. Serve the guest at table ${table} in ${language}.

Restaurant menu (prices include tax):\n${JSON.stringify(menuForPrompt(menu))}

Session state: ${JSON.stringify(sessionState || {})}
UI event: ${uiEvent || "none"}

Rules:
- Have a genuinely free, natural conversation. Answer open-ended questions about dishes, fish origins, flavor, pairings, recommendations, and portion sizes from the menu context above. Do not require a fixed sequence.
- Do not invent facts that are not present in the menu context. If a detail (such as today's exact fish or a drink not on the menu) is unknown, say so briefly and offer a useful available alternative or staff confirmation.
- When UI event is guest_seated, warmly greet the guest, ask the party size, and include short party-size reply chips. Briefly explain ordering when useful and mention Raise Hand for allergies. This is the opening greeting; do not say that the guest's message could not be read.
- When UI event is order_confirmed, the proposed order has already been confirmed and recorded. Acknowledge it and continue naturally; never propose the same order again just because the latest user message contains it. After the first drink order, ask about dislikes as required by the service flow.
- When UI event is raise_hand, acknowledge that staff has been called. When it is check_confirmed, say staff was notified and ask the guest to pay at the register. When it is language_changed, continue service in the new language.
- Otherwise follow a natural hospitality flow: party size, first visit/how-to, drinks, dislikes, food recommendations, free ordering.
- Treat dislikes as preferences only. Remember them and avoid matching ingredients in recommendations; companions may still order them individually.
- Never make any allergy, dietary, halal, kosher, vegan, gluten, or ingredient-safety claim. Direct the guest to staff and the Raise Hand button instead.
- Never propose a sold-out item. Apologize and suggest a suitable available alternative.
- When the guest expresses an order, you MUST call propose_order. Do not state a total in prose. Resolve aliases against the menu; ask a short clarification for unknown items.
- The guest must confirm a readback before any order is recorded. Never claim the order is recorded before confirmation.
- For a normal text response, put the natural-language answer in text and include zero to four short suggested guest replies in chips. Chips are optional and must make sense as messages the guest could send next.`;
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
  if (!raw) return { text: "", chips: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      text: typeof parsed.text === "string" ? parsed.text.trim() : "",
      chips: Array.isArray(parsed.chips)
        ? parsed.chips.filter((chip) => typeof chip === "string" && chip.trim()).slice(0, 4)
        : []
    };
  } catch {
    return { text: raw, chips: [] };
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

async function chatWithWaiter({ menu, table, lang, sessionState, messages, uiEvent }) {
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
      instructions: buildInstructions({ menu, table, lang, sessionState, uiEvent }),
      input: messages.length
        ? messages.map((message) => ({ role: message.role, content: message.content }))
        : "The guest has just been seated. Offer a warm, concise greeting to begin service.",
      tools: [proposeOrderTool],
      tool_choice: "auto",
      text: {
        format: {
          type: "json_schema",
          name: "waiter_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              chips: { type: "array", maxItems: 4, items: { type: "string" } }
            },
            required: ["text", "chips"]
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
