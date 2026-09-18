/**
 * Builds public/asset-index.json — one embedding vector per Alpaca asset.
 *
 *   npm run build-index                  # full corpus
 *   npm run build-index -- --limit 20    # smoke test, ~200 tokens
 *
 * This is the offline half of RAG: it runs once, by hand, and freezes its
 * result into a file. Retrieval reads that file at runtime and never embeds
 * the corpus again. Node has no same-origin policy, so unlike the browser this
 * calls both APIs directly instead of going through the Vite proxy.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Asset } from '../src/alpaca.ts'
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  inCorpus,
  toDocument,
  type AssetIndex,
} from '../src/rag/index-format.ts'

const OUTPUT = 'public/asset-index.json'
const DESCRIPTIONS = 'scripts/descriptions.json'
const MAX_RETRIES = 5

// Voyage's free tier (no payment method on file) allows 3 requests/min and
// 10K tokens/min. Batches are sized to fit the token budget of one slot
// (~15 tokens per asset) and spaced out to respect the request budget. Adding
// a payment method raises both limits; raise REQUESTS_PER_MINUTE to match.
const BATCH_SIZE = 200
const REQUESTS_PER_MINUTE = 3
const MIN_GAP_MS = (60_000 / REQUESTS_PER_MINUTE) * 1.05

const {
  ALPACA_API_KEY_ID,
  ALPACA_API_SECRET_KEY,
  VOYAGE_API_KEY,
} = process.env

if (!(ALPACA_API_KEY_ID && ALPACA_API_SECRET_KEY && VOYAGE_API_KEY)) {
  throw new Error('Missing API keys — run via `npm run build-index` (loads .env)')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchAssets(): Promise<Asset[]> {
  const params = new URLSearchParams({ status: 'active', asset_class: 'us_equity' })
  const response = await fetch(`https://paper-api.alpaca.markets/v2/assets?${params}`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY_ID!,
      'APCA-API-SECRET-KEY': ALPACA_API_SECRET_KEY!,
    },
  })

  if (!response.ok) {
    throw new Error(`Alpaca ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<Asset[]>
}

let lastRequestAt = 0

/** Embeds one batch, pacing to stay under the rate limit and retrying on 429. */
async function embedBatch(input: string[]) {
  for (let attempt = 0; ; attempt++) {
    const gap = Date.now() - lastRequestAt
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap)
    lastRequestAt = Date.now()

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input,
        model: EMBEDDING_MODEL,
        // "document" here, "query" at search time: Voyage prepends a different
        // instruction for each, and mixing them quietly degrades results.
        input_type: 'document',
        output_dimension: EMBEDDING_DIM,
      }),
    })

    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Floor at a full window: the limit is per minute, so anything shorter
      // just burns a retry inside the same window that rejected us.
      const wait = Number(response.headers.get('retry-after')) || 60
      console.log(`  rate limited, retrying in ${wait}s`)
      await sleep(wait * 1000)
      continue
    }

    if (!response.ok) {
      throw new Error(`Voyage ${response.status}: ${await response.text()}`)
    }

    const body = (await response.json()) as {
      data: { index: number; embedding: number[] }[]
      usage: { total_tokens: number }
    }

    // Sort by index — the API documents an `index` field rather than promising
    // response order, and a silently misaligned vector is unfindable later.
    const vectors = body.data
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding)

    return { vectors, tokens: body.usage.total_tokens }
  }
}

const limitFlag = process.argv.indexOf('--limit')
const limit = limitFlag === -1 ? Infinity : Number(process.argv[limitFlag + 1])

const assets = await fetchAssets()
console.log(`${assets.length} active US equities`)

// Optional: run `npm run enrich` first to add an industry line per company.
// Absent, the index still builds — on names alone, as the first version did.
const descriptions: Record<string, string> = await readFile(DESCRIPTIONS, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, string>)
  .catch(() => ({}))

const enriched = Object.keys(descriptions).length > 0
const document = (asset: Asset) => toDocument(asset, descriptions[asset.symbol])

const corpus = assets.filter(inCorpus).slice(0, limit)
const batches = Math.ceil(corpus.length / BATCH_SIZE)
console.log(`${corpus.length} in corpus — embedding those`)
console.log(
  enriched
    ? `${Object.keys(descriptions).length} have an industry line`
    : 'no descriptions found — names only',
)
console.log(`e.g. ${document(corpus[0])}`)
console.log(`${batches} batches at ${REQUESTS_PER_MINUTE}/min — about ${Math.ceil(batches / REQUESTS_PER_MINUTE)} min\n`)

const vectors: number[][] = []
let tokens = 0

for (let start = 0; start < corpus.length; start += BATCH_SIZE) {
  const batch = corpus.slice(start, start + BATCH_SIZE)
  const result = await embedBatch(batch.map(document))

  vectors.push(...result.vectors)
  tokens += result.tokens
  console.log(`  ${vectors.length}/${corpus.length}`)
}

const wrong = vectors.find((vector) => vector.length !== EMBEDDING_DIM)
if (wrong) throw new Error(`Expected ${EMBEDDING_DIM} dims, got ${wrong.length}`)

const index: AssetIndex = {
  model: EMBEDDING_MODEL,
  dim: EMBEDDING_DIM,
  enriched,
  items: corpus.map((asset, i) => ({
    symbol: asset.symbol,
    name: asset.name,
    exchange: asset.exchange,
    vector: vectors[i],
  })),
}

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, JSON.stringify(index))

const { size } = await stat(OUTPUT)
console.log(
  `\nWrote ${OUTPUT} — ${index.items.length} assets, ` +
    `${tokens} tokens, ${(size / 1024 / 1024).toFixed(1)} MB`,
)
