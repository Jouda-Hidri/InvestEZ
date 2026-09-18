// Both hosts are reached through the dev proxy declared in vite.config.ts,
// which attaches the credentials. Same keys, two different Alpaca hosts.
const TRADING = '/api/trading' // paper-api.alpaca.markets — accounts, assets, orders
const DATA = '/api/data' // data.alpaca.markets — prices

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`Alpaca ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

// One asset as returned by GET /v2/assets.
// Full field list: https://docs.alpaca.markets/reference/get-v2-assets-1
export type Asset = {
  id: string
  class: string
  exchange: string
  symbol: string
  name: string
  status: 'active' | 'inactive'
  tradable: boolean
  fractionable: boolean
}

export type AssetQuery = {
  status?: 'active' | 'inactive'
  asset_class?: 'us_equity' | 'us_option' | 'crypto'
}

/** GET paper-api.alpaca.markets/v2/assets */
export function getAssets(query: AssetQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(query)
  return get<Asset[]>(`${TRADING}/v2/assets?${params}`, signal)
}

export type Trade = {
  p: number // price
  s: number // size
  t: string // RFC-3339 timestamp
}

/**
 * GET data.alpaca.markets/v2/stocks/{symbol}/trades/latest
 *
 * `feed=iex` is what the free Basic plan covers; the default `sip` feed needs
 * the paid plan and otherwise answers 403.
 * https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data
 */
export async function getLatestTrade(symbol: string, signal?: AbortSignal) {
  const { trade } = await get<{ symbol: string; trade: Trade }>(
    `${DATA}/v2/stocks/${symbol}/trades/latest?feed=iex`,
    signal,
  )
  return trade
}
