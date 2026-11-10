# TCG API card scanner example

A small web app that scans a trading card from a photo. Open it on a phone, take a picture of a
card, graded slab or sealed product, and it shows which card it is, the printing, the TCGPlayer ID
and current prices.

It is an example for the [TCG API](https://tcgapi.dev) card scanner endpoint,
[`POST /v1/identify`](https://tcgapi.dev/api/identify/). Two files do the work, with no dependencies:

- `server.js` serves the page and forwards each photo to the API. Your API key stays here.
- `public/index.html` picks the photo and shows the answer.

## Run it

You need Node 20.12 or newer and a TCG API key. A [free key](https://tcgapi.dev/signup/) comes
with 25 scans.

```bash
git clone https://github.com/gordy-ftw/tcgapi-card-scanner-example.git
cd tcgapi-card-scanner-example
cp .env.example .env        # then put your key after TCGAPI_KEY=
npm start                   # http://127.0.0.1:3000
```

To try it from your phone on the same Wi-Fi, start it with `HOST=0.0.0.0 npm start` and open
`http://<your computer's address>:3000`.

## How it works

1. The page sends the photo (JPEG, PNG or WebP, up to 8 MB) to `/api/scan` on your own server.
2. `server.js` adds the `X-API-Key` header and forwards the image to
   `https://api.tcgapi.dev/v1/identify?include=prices`.
3. The API reads what is printed on the card (name, collector number, set, edition stamp, foil,
   and the grade on a slab) and matches it against its catalog.
4. The page shows the answer according to its `status`:

| `status` | What the page does |
|---|---|
| `matched` | Exactly one printing fits. Shows the card with its prices. |
| `ambiguous` | Several printings fit. Lists the candidates so the user can pick. |
| `retake` | The photo is blurred, cut off or has glare. Shows the message saying what to fix. |
| `not_found` | Nothing in the catalog matches what was read. |
| `unsupported` | A game or language the catalog does not list. |

`include=prices` returns prices for the top candidate. For another candidate, call
[`GET /v1/cards/{card_id}/prices`](https://tcgapi.dev/api/cards/).

## What it costs

Each photo the API reads uses one scan, including a photo it asks you to retake. Every account
gets 25 free scans once; after that, prepaid packs cost 1.5¢ to 0.8¢ per scan and never expire.
Scans are separate from your plan's daily request limit and work on every plan, Free included.
Purchased scans can be used commercially on every plan. See
[pricing](https://tcgapi.dev/pricing/#scans) and
[data licensing](https://tcgapi.dev/legal/licensing/#photo-identification-scans).

## Before you put it online

- **Keep the key on the server.** Never call the API from browser code with your key in it.
- **Protect `/api/scan`.** As written, anyone who can reach the server can spend your scans. Add
  your own login or a rate limit first. The server listens on `127.0.0.1` by default for this reason.
- **Card images.** The page shows the image URL the API returns. Card artwork belongs to the game
  publishers; whether to display it in your product is your call.

## More

- [Card scanner guide](https://tcgapi.dev/use-cases/card-scanner/): how the scan works, accuracy, cost
- [Identify reference](https://tcgapi.dev/api/identify/): every field, status and error
- [Trading card recognition APIs compared](https://tcgapi.dev/blog/card-recognition-apis-compared/)
- SDKs: [JavaScript/TypeScript](https://github.com/gordy-ftw/tcgapi-js), [Python](https://github.com/gordy-ftw/tcgapi-python)

MIT licensed.
