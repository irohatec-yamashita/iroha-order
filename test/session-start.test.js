const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

process.env.OPENAI_API_KEY = "test-key";
process.env.MODEL = "gpt-5.6";
process.env.SHEETS_WEBHOOK_URL = "";

const realFetch = global.fetch;
const modelRequests = [];
const speechRequests = [];
const modelReplies = [
  {
    text: "いらっしゃいませ。本日は何名様でご来店ですか？",
    chips: ["1名です", "2名です", "3名です", "4名です"],
    session: { stage: "party_size", partySize: null, firstVisit: null, dislikes: [], dislikesAsked: false },
    highlightRaiseHand: false
  },
  {
    text: "2名様ですね、ありがとうございます。当店は初めてですか？",
    chips: ["はい、初めてです", "いいえ、来たことがあります"],
    session: { stage: "first_visit", partySize: 2, firstVisit: null, dislikes: [], dislikesAsked: false },
    highlightRaiseHand: false
  },
  {
    text: "初めてのご来店ありがとうございます。ご注文はこの画面で確定し、お会計はレジです。お困りの際やアレルギーのご相談は手を挙げるボタンでスタッフをお呼びください。お飲み物は何にされますか？",
    chips: ["生ビールを2つ", "飲み物を教えて"],
    session: { stage: "drinks", partySize: 2, firstVisit: true, dislikes: [], dislikesAsked: false },
    highlightRaiseHand: false
  },
  {
    tool: { items: [{ id: "beer", qty: 2 }, { id: "lemonsour", qty: 1 }], note: "" }
  },
  {
    text: "ご注文ありがとうございます。苦手な食材はありますか？なければ『特になし』で大丈夫です。続けてお料理をご案内します。",
    chips: ["特になし", "パクチーが苦手", "おすすめ料理を見る"],
    session: { stage: "dislikes", partySize: 2, firstVisit: true, dislikes: [], dislikesAsked: true },
    highlightRaiseHand: false
  },
  {
    text: "特になしですね。刺身盛り合わせと若鶏の唐揚げがおすすめです。メニューを選んでください。",
    chips: ["刺身盛り合わせを1つ", "若鶏の唐揚げを1つ", "料理をもっと見る"],
    session: { stage: "food", partySize: 2, firstVisit: true, dislikes: [], dislikesAsked: true },
    highlightRaiseHand: false
  }
];

global.fetch = async (url, options) => {
  if (url === "https://api.openai.com/v1/audio/speech") {
    const request = JSON.parse(options.body);
    speechRequests.push(request);
    return {
      ok: true,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer
    };
  }
  assert.equal(url, "https://api.openai.com/v1/responses");
  const request = JSON.parse(options.body);
  modelRequests.push(request);
  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.reasoning.effort, "low");
  assert.equal(request.text.verbosity, "low");
  assert.match(request.instructions, /demo-ui\.html/);
  assert.match(request.instructions, /Do not jump directly to drinks/);
  const reply = modelReplies.shift();
  assert.ok(reply, "Unexpected additional model request");
  if (reply.tool) {
    return {
      ok: true,
      json: async () => ({
        output: [{ type: "function_call", name: "propose_order", arguments: JSON.stringify(reply.tool) }]
      })
    };
  }
  return {
    ok: true,
    json: async () => ({ output_text: JSON.stringify(reply), output: [] })
  };
};

const { app, serviceAnswerFor } = require("../server");
const { resetSessions } = require("../lib/session");
const { activeOrdersForTable, markOrdersCheckoutRequested } = require("../lib/store");

function request(server, { method = "GET", path, body }) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function chat(server, body) {
  const response = await request(server, { method: "POST", path: "/api/chat", body });
  assert.equal(response.status, 200, response.text);
  return JSON.parse(response.text);
}

test("guest flow follows demo-ui hospitality stages while replies remain model-generated", async (t) => {
  assert.deepEqual(serviceAnswerFor({ stage: "party_size" }, "2名です"), { kind: "party_size_answered", partySize: 2 });
  assert.deepEqual(serviceAnswerFor({ stage: "first_visit" }, "初めてです"), { kind: "first_visit_answered", firstVisit: true });
  assert.deepEqual(serviceAnswerFor({ stage: "first_visit" }, "来たことがあります"), { kind: "first_visit_answered", firstVisit: false });
  assert.deepEqual(serviceAnswerFor({ stage: "dislikes" }, "特になし"), { kind: "dislikes_none", dislikes: [] });
  resetSessions();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
  });

  const page = await request(server, { path: "/index.html?table=5" });
  assert.equal(page.status, 200);
  assert.match(page.text, /guest\.js/);

  const greeting = await chat(server, { table: "5", lang: "ja", type: "guest_seated" });
  assert.match(greeting.text, /何名様/);
  assert.equal(greeting.sessionState.stage, "party_size");
  assert.match(greeting.sessionState.sessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(greeting.chips, ["1名です", "2名です", "3名です", "4名です"]);

  const party = await chat(server, { table: "5", lang: "ja", message: "2名です" });
  assert.match(party.text, /初めてですか/);
  assert.equal(party.sessionState.partySize, 2);
  assert.equal(party.sessionState.stage, "first_visit");
  assert.doesNotMatch(party.text, /お飲み物は何に/);

  const firstVisit = await chat(server, { table: "5", lang: "ja", message: "はい、初めてです" });
  assert.match(firstVisit.text, /お会計はレジ/);
  assert.match(firstVisit.text, /お飲み物は何に/);
  assert.equal(firstVisit.sessionState.firstVisit, true);
  assert.equal(firstVisit.sessionState.stage, "drinks");

  const proposal = await chat(server, { table: "5", lang: "ja", message: "生ビール2つとレモンサワー1つ" });
  assert.equal(proposal.proposal.total, 1700);
  assert.deepEqual(proposal.proposal.items, [{ id: "beer", qty: 2 }, { id: "lemonsour", qty: 1 }]);
  assert.equal(proposal.sessionState.stage, "order_confirmation");

  const confirmed = await chat(server, { table: "5", lang: "ja", type: "order_confirmed" });
  assert.match(confirmed.text, /苦手な食材/);
  assert.ok(confirmed.chips.includes("特になし"));
  assert.equal(confirmed.sessionState.stage, "dislikes");
  assert.equal(confirmed.sessionState.dislikesAsked, true);

  const food = await chat(server, { table: "5", lang: "ja", message: "特になし" });
  assert.match(food.text, /メニューを選んでください。/);
  assert.equal(food.sessionState.stage, "food");
  assert.ok(food.chips.some((chip) => /刺身|唐揚げ/.test(chip)));

  const speech = await request(server, { method: "POST", path: "/api/speech", body: { text: greeting.text, lang: "ja" } });
  assert.equal(speech.status, 200);
  assert.match(speech.headers["content-type"], /^audio\/mpeg/);
  assert.equal(speech.headers["x-iroha-voice"], "marin");
  assert.equal(speechRequests[0].model, "gpt-4o-mini-tts-2025-12-15");
  assert.equal(speechRequests[0].voice, "marin");

  const cachedSpeech = await request(server, { method: "POST", path: "/api/speech", body: { text: greeting.text, lang: "ja" } });
  assert.equal(cachedSpeech.status, 200);
  assert.equal(speechRequests.length, 1);

  assert.equal(modelRequests.length, 6);
  assert.match(JSON.stringify(modelRequests[1].input), /2名です/);
  assert.match(JSON.stringify(modelRequests[2].input), /初めてです/);
  assert.match(modelRequests[2].instructions, /"kind":"first_visit_answered"/);
  assert.match(modelRequests[2].instructions, /hospitalityProfile/);
  assert.match(modelRequests[5].instructions, /"kind":"dislikes_none"/);

  const checkoutRecords = markOrdersCheckoutRequested([
    { orderId: "a", table: "5", status: "confirmed" },
    { orderId: "b", table: "5", status: "checkout_requested" },
    { orderId: "c", table: "6", status: "confirmed" }
  ], "5", "2026-07-21T00:00:00.000Z");
  assert.equal(checkoutRecords[0].status, "checkout_requested");
  assert.equal(checkoutRecords[0].checkoutRequestedAt, "2026-07-21T00:00:00.000Z");
  assert.equal(checkoutRecords[1].status, "checkout_requested");
  assert.equal(checkoutRecords[2].status, "confirmed");

  const activeAfterLegacyCheck = activeOrdersForTable([
    { orderId: "before", table: "5", status: "confirmed", time: "2026-07-21T09:00:00.000Z" },
    { orderId: "after", table: "5", status: "confirmed", time: "2026-07-21T11:00:00.000Z" },
    { orderId: "other", table: "6", status: "confirmed", time: "2026-07-21T11:00:00.000Z" }
  ], [
    { table: "5", type: "check", time: "2026-07-21T10:00:00.000Z" }
  ], "5");
  assert.deepEqual(activeAfterLegacyCheck.map((order) => order.orderId), ["after"]);
});
