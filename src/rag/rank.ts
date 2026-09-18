/**
 * Pure ranking — no network, no DOM, no browser globals.
 *
 * Split out from retrieve.ts so the eval harness can score the real
 * implementation from Node rather than a copy of it. A metric that measures a
 * duplicate of your code measures nothing.
 */
import type { IndexedAsset } from './index-format.ts'

export type Match = { asset: IndexedAsset; score: number }

/**
 * Cosine similarity without the division. Voyage returns unit-length vectors
 * (verified: norm 1.0000), so the denominator is 1 and drops out — leaving a
 * plain dot product. Higher is more similar; the range is -1 to 1.
 */
export function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/** Every asset scored against the query, best first, truncated to `k`. */
export function rank(query: number[], items: IndexedAsset[], k: number): Match[] {
  return items
    .map((asset) => ({ asset, score: dot(query, asset.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
