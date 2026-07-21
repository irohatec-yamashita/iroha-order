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
    soldOut: item.soldOut
  }));
}

function buildInstructions({ menu, table, lang, sessionState, messages }) {
  const language = lang === "en" ? "English" : "Japanese";
  const history = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  return `You are the warm, concise AI waiter for ${menu.restaurant}, a small Japanese izakaya. Serve the guest at table ${table} in ${language}.

Restaurant menu (prices include tax):\n${JSON.stringify(menuForPrompt(menu))}

Session state: ${JSON.stringify(sessionState || {})}
Conversation so far:\n${history}

Rules:
- Follow a natural flow: greeting, party size, first visit/how-to, drinks, dislikes, food recommendations, free ordering.
- Treat dislikes as preferences only. Remember them and avoid matching ingredients in recommendations; companions may still order them individually.
- Never make any allergy, dietary, halal, kosher, vegan, gluten, or ingredient-safety claim. Direct the guest to staff and the Raise Hand button instead.
- Never propose a sold-out item. Apologize and suggest a suitable available alternative.
- When the guest expresses an order, you MUST call propose_order. Do not state a total in prose. Resolve aliases against the menu; ask a short clarification for unknown items.
- The guest must confirm a readback before any order is recorded. Never claim the order is recorded before confirmation.`;
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

function textFromResponse(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");
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

async function chatWithWaiter({ menu, table, lang, sessionState, messages }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new AIConfigurationError("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.MODEL || "gpt-5.6",
      instructions: buildInstructions({ menu, table, lang, sessionState, messages }),
      input: messages.map((message) => ({ role: message.role, content: message.content })),
      tools: [proposeOrderTool],
      tool_choice: "auto",
      store: false
    })
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "OpenAI request failed.");
  return { text: textFromResponse(body), proposal: proposalFromResponse(body, menu) };
}

module.exports = { AIConfigurationError, chatWithWaiter };
