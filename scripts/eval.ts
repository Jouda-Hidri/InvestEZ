/**
 * Scores retrieval against a hand-written expectation set.
 *
 *   npm run eval
 *
 * Without this, "did that change help?" is answerable only by squinting at a
 * list. With it, every future change to the corpus, the document format, or
 * the model is a number that moved.
 *
 * The cases below were written from what a user would *want* back, before
 * looking at what the system actually returns. Grading against current
 * behaviour would make every score a 1.0 and measure nothing.
 */
import { readFile, writeFile } from 'node:fs/promises'
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  type AssetIndex,
} from '../src/rag/index-format.ts'
import { rank } from '../src/rag/rank.ts'

const INDEX = 'public/asset-index.json'
const CACHE = 'scripts/.eval-cache.json'
const K = 10

type Case = { query: string; expect: string[] }

const CASES: Case[] = [
  { query: 'companies that make video games', expect: ['TTWO', 'RBLX', 'U'] },
  { query: 'big American banks', expect: ['JPM', 'BAC', 'C', 'WFC'] },
  { query: 'electric vehicle makers', expect: ['TSLA', 'RIVN', 'LCID'] },
  { query: 'passenger airlines', expect: ['DAL', 'UAL', 'AAL', 'LUV'] },
  { query: 'gold mining companies', expect: ['NEM', 'GOLD', 'AEM'] },
  { query: 'semiconductor chip makers', expect: ['NVDA', 'AMD', 'INTC', 'MU'] },
  { query: 'streaming entertainment services', expect: ['NFLX', 'DIS', 'SPOT'] },
  { query: 'pharmaceutical drug companies', expect: ['PFE', 'MRK', 'LLY', 'BMY'] },
  { query: 'oil and gas producers', expect: ['XOM', 'CVX', 'COP', 'OXY'] },
  { query: 'fast food restaurant chains', expect: ['MCD', 'YUM', 'CMG'] },
  { query: 'enterprise cloud software', expect: ['MSFT', 'CRM', 'ORCL', 'NOW'] },
  { query: 'cybersecurity companies', expect: ['CRWD', 'PANW', 'ZS'] },
  { query: 'home improvement retailers', expect: ['HD', 'LOW'] },
  { query: 'cruise lines', expect: ['CCL', 'RCL', 'NCLH'] },
  { query: 'credit card and payment processors', expect: ['V', 'MA', 'PYPL'] },
]

const { VOYAGE_API_KEY } = process.env
if (!VOYAGE_API_KEY) throw new Error('Missing VOYAGE_API_KEY — run `npm run eval`')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Query embeddings are deterministic, so cache them: the free tier allows 3
// requests/min, which makes a cold run ~5 minutes and a warm one instant.
// Keyed by model and dimension so changing either invalidates the cache.
const cache: Record<string, number[]> = await readFile(CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number[]>)
  .catch(() => ({}))

let lastRequestAt = 0

async function embedQuery(text: string): Promise<number[]> {
  const key = `${EMBEDDING_MODEL}:${EMBEDDING_DIM}:${text}`
  if (cache[key]) return cache[key]

  const gap = Date.now() - lastRequestAt
  if (gap < 21_000) await sleep(21_000 - gap)
  lastRequestAt = Date.now()

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
      input_type: 'query',
      output_dimension: EMBEDDING_DIM,
    }),
  })

  if (!response.ok) {
    throw new Error(`Voyage ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as { data: { embedding: number[] }[] }
  cache[key] = body.data[0].embedding
  return cache[key]
}

const index = JSON.parse(await readFile(INDEX, 'utf8')) as AssetIndex
const symbols = new Set(index.items.map((item) => item.symbol))
console.log(`${index.items.length} assets, ${CASES.length} cases, k=${K}\n`)

const uncached = CASES.filter(
  (c) => !cache[`${EMBEDDING_MODEL}:${EMBEDDING_DIM}:${c.query}`],
).length
if (uncached) {
  console.log(`${uncached} queries to embed — about ${Math.ceil(uncached / 3)} min\n`)
}

let totalRecall = 0
let totalRR = 0
const absent: string[] = []

for (const { query, expect } of CASES) {
  const top = rank(await embedQuery(query), index.items, K)
  const found = top.map((match) => match.asset.symbol)

  // An expected symbol that isn't in the corpus at all was dropped by the
  // build filter. Counting it as a retrieval miss would grade the wrong thing.
  const inCorpus = expect.filter((symbol) => symbols.has(symbol))
  absent.push(...expect.filter((symbol) => !symbols.has(symbol)))

  const hits = inCorpus.filter((symbol) => found.includes(symbol))
  const recall = inCorpus.length ? hits.length / inCorpus.length : 0

  // Reciprocal rank: 1 if the first result is right, 1/2 if second, 0 if the
  // top k holds nothing expected. Rewards ordering, not just membership.
  const firstHit = found.findIndex((symbol) => inCorpus.includes(symbol))
  const rr = firstHit === -1 ? 0 : 1 / (firstHit + 1)

  totalRecall += recall
  totalRR += rr

  console.log(
    `recall ${recall.toFixed(2)}  rr ${rr.toFixed(2)}  ${query}` +
      `\n    got:  ${found.slice(0, 5).join(' ')}`,
  )

  // Where the misses actually landed. A symbol at rank 12 means the ordering
  // needs work; one at rank 900 means the document text is the problem.
  const missed = inCorpus.filter((symbol) => !found.includes(symbol))
  if (missed.length) {
    const all = rank(await embedQuery(query), index.items, index.items.length)
    const places = missed.map((symbol) => {
      const at = all.findIndex((match) => match.asset.symbol === symbol)
      return `${symbol}@${at + 1}`
    })
    console.log(`    miss: ${places.join(' ')}`)
  }
}

await writeFile(CACHE, JSON.stringify(cache))

console.log(
  `\nrecall@${K}: ${(totalRecall / CASES.length).toFixed(3)}` +
    `   MRR: ${(totalRR / CASES.length).toFixed(3)}`,
)
if (absent.length) {
  console.log(`\nnot in corpus (filtered out, not a retrieval miss): ${absent.join(' ')}`)
}
