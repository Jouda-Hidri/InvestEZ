import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// None of these APIs send CORS headers, and all need secret credentials, so the
// browser cannot call them directly. The dev server proxies instead and adds the
// auth headers here, where the keys stay server-side.
// Alpaca auth: https://docs.alpaca.markets/us/docs/authentication
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const required = ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'VOYAGE_API_KEY']
  const missing = required.filter((name) => !env[name])
  if (command === 'serve' && missing.length) {
    throw new Error(`Missing ${missing.join(', ')} — see .env.example`)
  }

  // Each vendor authenticates differently, so headers are per-route rather than
  // shared: Alpaca uses custom headers, Voyage uses a bearer token.
  const proxy = (target: string, prefix: string, headers: Record<string, string>) => ({
    target,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(prefix.length),
    headers,
  })

  const alpaca = {
    'APCA-API-KEY-ID': env.ALPACA_API_KEY_ID,
    'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET_KEY,
  }
  const voyage = { Authorization: `Bearer ${env.VOYAGE_API_KEY}` }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/trading': proxy('https://paper-api.alpaca.markets', '/api/trading', alpaca),
        '/api/data': proxy('https://data.alpaca.markets', '/api/data', alpaca),
        '/api/voyage': proxy('https://api.voyageai.com', '/api/voyage', voyage),
      },
    },
  }
})
