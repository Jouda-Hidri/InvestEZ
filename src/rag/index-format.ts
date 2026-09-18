// Shape of asset-index.json, shared by the build script and the retrieval code.
//
// `model` and `dim` are stored in the file on purpose: a query embedded with a
// different model lands in a different vector space and produces confident,
// meaningless rankings — with no error anywhere. Retrieval asserts on them.

export const EMBEDDING_MODEL = 'voyage-4-lite'
export const EMBEDDING_DIM = 256

export type IndexedAsset = {
  symbol: string
  name: string
  exchange: string
  vector: number[]
}

export type AssetIndex = {
  model: string
  dim: number
  items: IndexedAsset[]
}

/**
 * The only text the embedding model ever sees. It cannot retrieve on a fact
 * that isn't in this string — if you want a concept to be searchable, the
 * words have to be here.
 */
export function toDocument(asset: {
  symbol: string
  name: string
  exchange: string
}): string {
  return `${asset.symbol} — ${asset.name} (${asset.exchange})`
}
