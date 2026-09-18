import { useEffect, useState } from 'react'
import { getAssets, getLatestTrade, type Asset, type Trade } from './alpaca'
import './App.css'

const MAX_ROWS = 100

// A price is fetched per symbol, on click, so each one has its own state.
type TradeState =
  | { status: 'loading' }
  | { status: 'done'; trade: Trade }
  | { status: 'error'; message: string }

export default function App() {
  // Three pieces of state: the data, whether the request is in flight, and the
  // error if it failed. Every `fetch`-backed React component needs these three.
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [trades, setTrades] = useState<Record<string, TradeState>>({})

  // Empty dependency array => run once, after the first render.
  // The AbortController cancels the request if the component unmounts first
  // (React StrictMode mounts twice in dev, so this runs twice).
  useEffect(() => {
    const controller = new AbortController()

    getAssets({ status: 'active', asset_class: 'us_equity' }, controller.signal)
      .then(setAssets)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  // Updates go through `setTrades(previous => ...)` so concurrent clicks on
  // different symbols never overwrite each other's results.
  async function loadTrade(symbol: string) {
    setTrades((previous) => ({ ...previous, [symbol]: { status: 'loading' } }))
    try {
      const trade = await getLatestTrade(symbol)
      setTrades((previous) => ({ ...previous, [symbol]: { status: 'done', trade } }))
    } catch (e) {
      const message = (e as Error).message
      setTrades((previous) => ({ ...previous, [symbol]: { status: 'error', message } }))
    }
  }

  // Derived from state on every render — not stored in state.
  const term = search.trim().toUpperCase()
  const matches = term
    ? assets.filter(
        (a) => a.symbol.includes(term) || a.name.toUpperCase().includes(term),
      )
    : assets

  if (loading) return <p>Loading assets…</p>
  if (error) return <p role="alert">{error}</p>

  return (
    <>
      <h1>Alpaca assets</h1>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter by symbol or name"
      />

      <p>
        {matches.length} of {assets.length} assets
        {matches.length > MAX_ROWS && ` — showing the first ${MAX_ROWS}`}
      </p>

      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th>Exchange</th>
            <th>Tradable</th>
            <th>Last trade</th>
          </tr>
        </thead>
        <tbody>
          {matches.slice(0, MAX_ROWS).map((asset) => (
            <tr key={asset.id}>
              <td>{asset.symbol}</td>
              <td>{asset.name}</td>
              <td>{asset.exchange}</td>
              <td>{asset.tradable ? 'yes' : 'no'}</td>
              <td>
                <LastTrade
                  state={trades[asset.symbol]}
                  onLoad={() => loadTrade(asset.symbol)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// A child component receives data through props and renders one of the four
// states. `state` is undefined until the row has been clicked.
function LastTrade({
  state,
  onLoad,
}: {
  state?: TradeState
  onLoad: () => void
}) {
  if (!state) return <button onClick={onLoad}>Load</button>
  if (state.status === 'loading') return <>…</>
  if (state.status === 'error')
    return (
      <span role="alert" title={state.message}>
        failed
      </span>
    )

  return (
    <span title={new Date(state.trade.t).toLocaleString()}>
      {state.trade.p.toFixed(2)}
    </span>
  )
}
