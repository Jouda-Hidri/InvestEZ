/**
 * The online half of RAG. Loads the index built by `npm run build-index`,
 * embeds one query into the same vector space, and ranks the corpus against it.
 *
 * No vector database: 3,936 vectors × 256 dimensions is a linear scan taking
 * single-digit milliseconds. Reach for a real index when the corpus makes that
 * scan slow, not before.
 */
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  type AssetIndex,
  type IndexedAsset,
} from './index-format'

// Served from public/, not imported — a 12 MB `import` would land in the JS
// bundle. This way the browser caches it and the app code stays small.
const INDEX_URL = '/asset-index.json'

export type Match = { asset: IndexedAsset; score: number }

let cached: Promise<AssetIndex> | null = null

/** Fetches the index once and reuses it; 12 MB is not worth downloading twice. */
export function loadIndex(): Promise<AssetIndex> {
  cached ??= fetchIndex().catch((error: unknown) => {
    cached = null // a cached rejection would fail every later search too
    throw error
  })
  return cached
}

async function fetchIndex(): Promise<AssetIndex> {
  const response = await fetch(INDEX_URL)
  if (!response.ok) {
    throw new Error(`No index (${response.status}) — run \`npm run build-index\``)
  }

  const index = (await response.json()) as AssetIndex

  // Vectors from a different model, or a different dimension, occupy a
  // different space. Comparing across them yields confident nonsense and no
  // error, so refuse loudly instead.
  if (index.model !== EMBEDDING_MODEL || index.dim !== EMBEDDING_DIM) {
    throw new Error(
      `Index is ${index.model}/${index.dim}, app expects ` +
        `${EMBEDDING_MODEL}/${EMBEDDING_DIM} — rebuild it`,
    )
  }
  return index
}

/**
 * Cosine similarity without the division. Voyage returns unit-length vectors
 * (verified: norm 1.0000), so the denominator is 1 and drops out — leaving a
 * plain dot product. Higher is more similar; the range is -1 to 1.
 */
function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/** Embeds the query through the dev proxy, which adds the Voyage credentials. */
export async function embedQuery(text: string, signal?: AbortSignal) {
  const response = await fetch('/api/voyage/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
      // The corpus was embedded as 'document'. Voyage prepends a different
      // instruction per type, and using the wrong one here degrades results
      // without any error to notice.
      input_type: 'query',
      output_dimension: EMBEDDING_DIM,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Voyage ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as { data: { embedding: number[] }[] }
  return body.data[0].embedding
}

/** Top `k` assets most semantically similar to `query`, best first. */
export async function search(
  query: string,
  k = 8,
  signal?: AbortSignal,
): Promise<Match[]> {
  // Both are network-bound and independent — the index download overlaps with
  // the embedding call rather than following it.
  const [index, vector] = await Promise.all([loadIndex(), embedQuery(query, signal)])

  return index.items
    .map((asset) => ({ asset, score: dot(vector, asset.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
