# InvestEZ

React + TypeScript client for Alpaca (paper trading).
Current scope: search the asset list by meaning, list tradable assets, and load
the last trade price for any of them.

## Setup

```sh
npm install
cp .env.example .env   # fill in your Alpaca and Voyage keys
npm run dev            # http://localhost:5173
```

## How the API calls work

None of these APIs send CORS headers, and all need secret credentials, so the
browser cannot call them directly. The Vite dev server proxies instead — three
routes, two vendors, and a different auth scheme per vendor:

| Browser path   | Upstream                        | Auth |
| -------------- | ------------------------------- | ---- |
| `/api/trading` | `paper-api.alpaca.markets`      | `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` |
| `/api/data`    | `data.alpaca.markets`           | same pair |
| `/api/voyage`  | `api.voyageai.com`              | `Authorization: Bearer` |

Alpaca's two headers are its
[documented scheme](https://docs.alpaca.markets/us/docs/authentication); paper
and live credentials are separate and not interchangeable.

The keys are read by `vite.config.ts` at startup and never reach the bundle.
They are not prefixed `VITE_`, which is what keeps Vite from exposing them.

`npm run dev` refuses to start if any key is missing, naming the ones absent.
The proxy exists only in dev; a production build needs a real backend.

## Market data on the free plan

`feed=iex` is hardcoded in `getLatestTrade()`. The free Basic plan only covers
the IEX feed; the API default (`sip`, all US exchanges) answers 403 without the
paid plan. Basic is also capped at 200 requests/min and cannot read the most
recent 15 minutes of data — prices shown here are delayed.
([market data docs](https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data))

## Semantic search

Two halves, deliberately separate.

**Indexing — offline, once.** `npm run build-index` embeds each asset as a
256-dimension [Voyage](https://docs.voyageai.com/docs/embeddings) `voyage-4-lite`
vector and writes `public/asset-index.json` (3,936 assets, ~50k tokens, 12 MB).
Corpus is `tradable && fractionable && NASDAQ|NYSE && has listed options` —
options act as a liquidity proxy. Node reads `.env` via `--env-file` and calls
both APIs directly; the dev proxy is for the browser and is irrelevant here.

```sh
npm run build-index -- --limit 20   # smoke test, ~300 tokens
npm run build-index                 # full corpus, ~7 min
```

The run is paced to Voyage's free tier: 3 requests/min and 10K tokens/min
without a payment method on file. Batches are large (200) because *requests*,
not tokens, are the scarce resource, and 429 backoff floors at a full minute.

**Retrieval — per query, in the browser.** `src/rag/retrieve.ts` fetches the
index once, embeds the query with `input_type: "query"` (the corpus used
`"document"` — Voyage prepends a different instruction for each), and ranks all
3,936 vectors by dot product. Dot rather than cosine because Voyage returns
unit-length vectors, so the denominator is 1. A linear scan over 3,936 × 256 is
milliseconds; no vector database.

The index lives in `public/` so it is served rather than bundled, and is
gitignored — rebuild it rather than committing 12 MB of derived data.

**What the corpus can answer.** Each asset is embedded as one string:
`SYMBOL — Name (EXCHANGE)`. Nothing else is retrievable, and that bounds the
results in both directions:

| Query | Semantic search | Substring filter |
| --- | --- | --- |
| companies that make video games | TTWO, Unity, Roblox | 2 ETFs with *Video Games* in their titles |
| big American banks | BAC, JPM, C — but partly because *Bank* is in the name | 0 |
| electric vehicle makers | GM 3rd, **Tesla 13th** | 0 |

Tesla loses to General Motors because "Tesla, Inc. Common Stock" never says what
Tesla builds. Richer documents, not a better embedding model, is the fix.

## Files

| File                      | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `vite.config.ts`             | Dev proxies to Alpaca and Voyage, injects the auth headers |
| `src/App.tsx`                | Shell: two sections, each owning its own fetching          |
| `src/alpaca.ts`              | `Asset` / `Trade` types, `getAssets()`, `getLatestTrade()` |
| `src/AssetTable.tsx`         | Asset list, substring filter, per-row `LastTrade`          |
| `scripts/build-index.ts`     | Fetch → filter → batch-embed → write the index             |
| `src/rag/index-format.ts`    | Index shape + model constants, shared by script and app    |
| `src/rag/retrieve.ts`        | `loadIndex()`, `embedQuery()`, `search()`                  |
| `src/rag/SemanticSearch.tsx` | Query box, ranked results with scores                      |
| `public/asset-index.json`    | Generated vectors (gitignored)                             |
| `.env`                       | Alpaca and Voyage keys (gitignored)                        |

## Behaviour

**Semantic search** — one Voyage call per query; the index downloads on the
first search only. Results show their similarity score, and the retrieved set
stays on screen deliberately: when an answer is wrong you need to see whether
retrieval or generation failed, and those have different fixes.

**Asset table** — fetches active US equities once on mount (~14k rows),
substring filter on symbol and name, at most 100 rows. The **Last trade**
column makes one request per row, triggered by its *Load* button; each symbol
keeps its own loading / price / failed state. Hover a price for its timestamp,
hover *failed* for the error.

## Scripts

`npm run dev` · `npm run build` (tsc + vite) · `npm run lint` (oxlint) ·
`npm run preview` · `npm run build-index`
