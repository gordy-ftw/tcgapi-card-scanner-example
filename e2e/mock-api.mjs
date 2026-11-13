// A stand-in for api.tcgapi.dev, so the tests spend no scans. Each API key gets the same
// sequence of answers: matched, ambiguous, retake, then matched again.
import http from "node:http";

const darkrai = {
  card_id: 24535, tcgplayer_id: 138577, name: "Darkrai", number: "87/147",
  set: { name: "SM - Burning Shadows" }, game: { name: "Pokemon" },
  image_url: null, suggested_printing: "Holofoil",
  prices: [
    { printing: "Holofoil", market_price: 1.49 },
    { printing: "Reverse Holofoil", market_price: 1.41 },
  ],
};
const charizard = (card_id, set, number, prices) => ({
  card_id, tcgplayer_id: card_id + 5, name: "Charizard", number,
  set: { name: set }, game: { name: "Pokemon" }, image_url: null, suggested_printing: null, prices,
});
const answers = [
  { status: "matched", candidates: [darkrai], warnings: [] },
  {
    status: "ambiguous", warnings: [],
    candidates: [
      charizard(1001, "Base Set", "4/102", [{ printing: "Holofoil", market_price: 300 }]),
      charizard(1002, "Base Set 2", "4/130"), // only the top candidate comes with prices
    ],
  },
  { status: "retake", message: "The collector number is cut off.", candidates: [], warnings: [] },
];

const scansByKey = new Map();
const send = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

http.createServer(async (req, res) => {
  const key = req.headers["x-api-key"] ?? "";
  if (!key.startsWith("tcg_test_")) return send(res, 401, { error: { message: "Invalid API key.", code: "INVALID_API_KEY" } });

  if (req.method === "GET" && req.url === "/v1/cards/1002/prices") {
    return send(res, 200, { data: [{ printing: "Holofoil", market_price: 120.75 }, { printing: "1st Edition Holofoil", market_price: null }] });
  }
  if (req.method === "POST" && req.url === "/v1/identify?include=prices") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const image = Buffer.concat(chunks);
    const isJpeg = req.headers["content-type"] === "image/jpeg" && image[0] === 0xff && image[1] === 0xd8;
    if (!isJpeg) return send(res, 400, { error: { message: "Not a JPEG.", code: "INVALID_IMAGE" } });
    const n = (scansByKey.get(key) ?? 0) + 1;
    scansByKey.set(key, n);
    return send(res, 200, { data: answers[n - 1] ?? answers[0], meta: { charged: "scan", scans_remaining: 25 - n } });
  }
  send(res, 404, { error: { message: "Not found.", code: "NOT_FOUND" } });
}).listen(Number(process.env.PORT), "127.0.0.1");
