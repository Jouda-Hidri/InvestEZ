# InvestEZ

React + TypeScript client for Alpaca (paper trading).
Current scope: list tradable assets, and load the last trade price for any of them.
Groundwork for semantic search over the asset list exists as a build script; it is
not wired into the app yet.

## Setup

```sh
npm install
cp .env.example .env   # fill in your Alpaca and Voyage keys
npm run dev            # http://localhost:5173
```

## How the API calls work

Alpaca returns no CORS headers and requires secret credentials, so the browser
cannot call it directly. The Vite dev server proxies instead. Two hosts, one set
of keys:

```
browser  →  GET /api/trading/v2/assets?status=active&asset_class=us_equity
proxy    →  GET https://paper-api.alpaca.markets/v2/assets?...

browser  →  GET /api/data/v2/stocks/AAPL/trades/latest?feed=iex
proxy    →  GET https://data.alpaca.markets/v2/stocks/AAPL/trades/latest?feed=iex

both     +  APCA-API-KEY-ID / APCA-API-SECRET-KEY headers
```

The two headers are Alpaca's documented scheme
([auth docs](https://docs.alpaca.markets/us/docs/authentication)); paper and live
credentials are separate and not interchangeable.

The keys are read by `vite.config.ts` at startup and never reach the bundle.
They are not prefixed `VITE_`, which is what keeps Vite from exposing them.

`npm run dev` refuses to start if either key is missing. This proxy exists only
in dev; a production build needs a real backend.

## Market data on the free plan

`feed=iex` is hardcoded in `getLatestTrade()`. The free Basic plan only covers
the IEX feed; the API default (`sip`, all US exchanges) answers 403 without the
paid plan. Basic is also capped at 200 requests/min and cannot read the most
recent 15 minutes of data — prices shown here are delayed.
([market data docs](https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data))

## Embedding index

`npm run build-index` writes `src/rag/asset-index.json`: one 256-dimension
[Voyage](https://docs.voyageai.com/docs/embeddings) `voyage-4-lite` vector per
asset, for semantic search ("electric vehicle makers" → TSLA, RIVN) that a
substring filter cannot do.

Indexing is offline and manual; nothing embeds the corpus at runtime. The output
is gitignored — rebuild it rather than committing it.

```sh
npm run build-index -- --limit 20   # smoke test, ~300 tokens
npm run build-index                 # all tradable + fractionable assets
```

Node reads `.env` via `--env-file` and calls both APIs directly — the dev proxy
exists for the browser's sake and is irrelevant here.

## Files

| File                      | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `vite.config.ts`          | Dev proxies to both Alpaca hosts, injects the auth headers  |
| `src/alpaca.ts`           | `Asset` / `Trade` types, `getAssets()`, `getLatestTrade()`  |
| `src/App.tsx`             | `App` loads + filters assets; `LastTrade` renders one price |
| `scripts/build-index.ts`  | Fetch → filter → batch-embed → write the index              |
| `src/rag/index-format.ts` | Index shape + model constants, shared by script and app     |
| `.env`                    | Alpaca and Voyage keys (gitignored)                         |

## Behaviour

- Fetches active US equities once on mount (~14k rows).
- Client-side filter on symbol and name; the table renders at most 100 rows.
- Loading and error states replace the table.
- **Last trade** column: one request per row, triggered by its *Load* button.
  Each symbol keeps its own loading / price / failed state; hover a price for
  its timestamp, hover *failed* for the error.

## Scripts

`npm run dev` · `npm run build` (tsc + vite) · `npm run lint` (oxlint) ·
`npm run preview` · `npm run build-index`
