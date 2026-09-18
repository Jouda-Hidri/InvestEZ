import { useState, type FormEvent } from 'react'
import { search, type Match } from './retrieve'
import './SemanticSearch.css'

const EXAMPLES = [
  'companies that make video games',
  'big American banks',
  'gold and silver miners',
]

export function SemanticSearch() {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(query: string) {
    if (!query.trim() || busy) return

    setBusy(true)
    setError(null)
    try {
      setMatches(await search(query))
    } catch (e) {
      setError((e as Error).message)
      setMatches(null)
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(query)
  }

  return (
    <section>
      <h2>Semantic search</h2>
      <p className="hint">
        Ranked by meaning, not spelling — these queries match no symbol or
        company name. The first search downloads the 12 MB index.
      </p>

      <form onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe what you're looking for"
        />
        <button disabled={busy || !query.trim()}>Search</button>
      </form>

      <p className="hint">
        Try:{' '}
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="link"
            onClick={() => {
              setQuery(example)
              void run(example)
            }}
          >
            {example}
          </button>
        ))}
      </p>

      {busy && <p>Searching…</p>}
      {error && <p role="alert">{error}</p>}

      {/* The retrieved set is shown on purpose, not just the ranking: when an
          answer is wrong you need to see whether retrieval or generation
          failed, and those have different fixes. */}
      {matches && !busy && (
        <ol className="matches">
          {matches.map(({ asset, score }) => (
            <li key={asset.symbol}>
              <span className="score">{score.toFixed(3)}</span>
              <span className="bar" style={{ width: `${score * 100}%` }} />
              <b>{asset.symbol}</b> {asset.name}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
