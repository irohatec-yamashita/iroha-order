const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

process.env.OPENAI_API_KEY = "test-key";
process.env.MODEL = "gpt-5.6";

const realFetch = global.fetch;
global.fetch = async (url, options) => {
  assert.equal(url, "https://api.openai.com/v1/responses");
  const request = JSON.parse(options.body);
  assert.equal(request.model, "gpt-5.6");
  assert.match(request.instructions, /UI event: guest_seated/);
  assert.match(String(request.input), /guest has just been seated/i);
  return {
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        text: "いらっしゃいませ。何名様でしょうか？",
        chips: ["1名です", "2名です", "3名です", "4名です"]
      }),
      output: []
    })
  };
};

const { app } = require("../server");

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
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("opening the guest page can start a GPT greeting without a 400", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
  });

  const page = await request(server, { path: "/index.html?table=5" });
  assert.equal(page.status, 200);
  assert.match(page.text, /guest\.js/);

  const start = await request(server, {
    method: "POST",
    path: "/api/chat",
    body: { table: "5", lang: "ja", type: "guest_seated", sessionState: {} }
  });
  assert.equal(start.status, 200);
  const reply = JSON.parse(start.text);
  assert.match(reply.text, /何名様/);
  assert.deepEqual(reply.chips, ["1名です", "2名です", "3名です", "4名です"]);
  assert.equal(reply.proposal, null);
});
