/**
 * Writes one industry line per company to scripts/descriptions.json, so the
 * index can embed what a company *does* rather than only what it is called.
 *
 *   npm run enrich                  # all uncached symbols
 *   npm run enrich -- --limit 40    # one slice, to read the output first
 *
 * The eval baseline showed the corpus retrieves funds well and companies
 * badly: "First Trust Cloud Computing ETF" contains its own theme, while
 * "NVIDIA Corporation" contains none of "semiconductor". This closes that gap.
 *
 * Source is SEC EDGAR's assigned SIC classification — a fact on file with the
 * regulator, not a generated guess, so nothing here can be hallucinated into
 * the index. The tradeoff is vocabulary: SIC says "Semiconductors & Related
 * Devices", never "AI chips".
 *
 * Resumable: already-described symbols are skipped, so an interrupted run
 * costs only the requests in flight.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { Asset } from '../src/alpaca.ts'
import { inCorpus } from '../src/rag/index-format.ts'

const OUTPUT = 'scripts/descriptions.json'

// SEC asks for no more than 10 requests/second and for traffic to identify
// itself. Both are conditions of access, not suggestions.
const GAP_MS = 125
const CONCURRENCY = 5

const { ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, SEC_USER_AGENT } = process.env

if (!(ALPACA_API_KEY_ID && ALPACA_API_SECRET_KEY)) {
  throw new Error('Missing Alpaca keys — run via `npm run enrich` (loads .env)')
}
if (!SEC_USER_AGENT) {
  throw new Error(
    'Missing SEC_USER_AGENT — SEC requires a name and email, e.g. "InvestEZ you@example.com"',
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Spaces requests globally rather than per worker: each caller claims the next
// slot up front, so five concurrent workers still average one request per GAP.
let nextSlot = 0
async function paced<T>(request: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + GAP_MS
  if (slot > now) await sleep(slot - now)
  return request()
}

function sec(url: string) {
  return paced(() => fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT! } }))
}

async function fetchAssets(): Promise<Asset[]> {
  const params = new URLSearchParams({ status: 'active', asset_class: 'us_equity' })
  const response = await fetch(`https://paper-api.alpaca.markets/v2/assets?${params}`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY_ID!,
      'APCA-API-SECRET-KEY': ALPACA_API_SECRET_KEY!,
    },
  })
  if (!response.ok) throw new Error(`Alpaca ${response.status}: ${await response.text()}`)
  return response.json() as Promise<Asset[]>
}

/** ticker → CIK, the id every other EDGAR endpoint is keyed by. */
async function fetchTickerMap(): Promise<Map<string, string>> {
  const response = await sec('https://www.sec.gov/files/company_tickers.json')
  if (!response.ok) throw new Error(`SEC ${response.status}: ${await response.text()}`)

  const rows = Object.values(
    (await response.json()) as Record<string, { cik_str: number; ticker: string }>,
  )
  // CIKs are zero-padded to ten digits in the submissions path.
  return new Map(rows.map((row) => [row.ticker, String(row.cik_str).padStart(10, '0')]))
}

async function fetchIndustry(cik: string): Promise<string> {
  const response = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`)
  if (!response.ok) return ''

  const body = (await response.json()) as { sicDescription?: string }
  return body.sicDescription?.trim() ?? ''
}

const limitFlag = process.argv.indexOf('--limit')
const limit = limitFlag === -1 ? Infinity : Number(process.argv[limitFlag + 1])

const descriptions: Record<string, string> = await readFile(OUTPUT, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, string>)
  .catch(() => ({}))

const [assets, tickers] = await Promise.all([fetchAssets(), fetchTickerMap()])
const corpus = assets.filter(inCorpus)
const todo = corpus.filter((asset) => !(asset.symbol in descriptions)).slice(0, limit)

console.log(`${corpus.length} in corpus, ${Object.keys(descriptions).length} described`)
console.log(`${todo.length} to look up — about ${Math.ceil((todo.length * GAP_MS) / 60_000)} min\n`)

let done = 0
let noCik = 0
let noSic = 0
let next = 0

// A worker pool: CONCURRENCY lookups in flight, each taking the next symbol
// off the queue. The pacer above is what actually enforces the rate limit.
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const asset = todo[next++]
      const cik = tickers.get(asset.symbol)

      if (!cik) {
        noCik++ // usually an ETF or a foreign issuer — not in the company file
      } else {
        const industry = await fetchIndustry(cik)
        if (industry) descriptions[asset.symbol] = industry
        else noSic++
      }

      if (++done % 200 === 0) {
        console.log(`  ${done}/${todo.length}`)
        await writeFile(OUTPUT, JSON.stringify(descriptions, null, 1))
      }
    }
  }),
)

await writeFile(OUTPUT, JSON.stringify(descriptions, null, 1))

console.log(`\nWrote ${OUTPUT} — ${Object.keys(descriptions).length} of ${corpus.length} described`)
console.log(`  ${noCik} not in SEC's company file, ${noSic} with no SIC on record\n`)

for (const symbol of ['NVDA', 'TSLA', 'JPM', 'MSFT', 'XOM']) {
  if (descriptions[symbol]) console.log(`  ${symbol}: ${descriptions[symbol]}`)
}
