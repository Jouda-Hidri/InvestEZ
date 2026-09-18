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
  enriched?: boolean
  items: IndexedAsset[]
}

/**
 * The only text the embedding model ever sees. It cannot retrieve on a fact
 * that isn't in this string — if you want a concept to be searchable, the
 * words have to be here.
 *
 * `description` is the industry line from SEC EDGAR. Without it, "NVIDIA
 * Corporation" carries no hint of semiconductors and the query never matches.
 */
export function toDocument(
  asset: { symbol: string; name: string; exchange: string },
  description?: string,
): string {
  const base = `${asset.symbol} — ${asset.name} (${asset.exchange})`
  return description ? `${base}. ${description}` : base
}

/**
 * Which assets belong in the index. Shared by the build and enrichment passes
 * so they operate on exactly the same set — describing rows the index excludes
 * wastes work, and embedding rows with no description silently skews results.
 *
 * Every asset dropped here is one the app can never retrieve, so this is a
 * recall decision as much as a file-size one. Listed options act as a liquidity
 * proxy: they keep the household names and drop most shells and thin ETFs.
 */
export function inCorpus(asset: {
  tradable: boolean
  fractionable: boolean
  exchange: string
  attributes?: string[]
}): boolean {
  return (
    asset.tradable &&
    asset.fractionable &&
    (asset.exchange === 'NASDAQ' || asset.exchange === 'NYSE') &&
    (asset.attributes?.includes('has_options') ?? false)
  )
}
