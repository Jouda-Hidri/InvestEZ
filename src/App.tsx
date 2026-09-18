import { AssetTable } from './AssetTable'
import { SemanticSearch } from './rag/SemanticSearch'
import './App.css'

// A shell. Each section owns its own fetching and loading state, so a slow
// asset list never blocks the search box from rendering.
export default function App() {
  return (
    <>
      <h1>InvestEZ</h1>
      <SemanticSearch />
      <AssetTable />
    </>
  )
}
