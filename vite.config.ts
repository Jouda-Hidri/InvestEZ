import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The Alpaca API sends no CORS headers and needs secret credentials, so the
// browser cannot call it directly. The dev server proxies instead and adds the
// auth headers here, where the keys stay server-side.
// Auth scheme: https://docs.alpaca.markets/us/docs/authentication
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'ALPACA_')

  if (command === 'serve' && !(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY)) {
    throw new Error('Missing ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY — see .env.example')
  }

  const alpaca = (target: string, prefix: string) => ({
    target,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(prefix.length),
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_API_KEY_ID,
      'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET_KEY,
    },
  })

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/trading': alpaca('https://paper-api.alpaca.markets', '/api/trading'),
        '/api/data': alpaca('https://data.alpaca.markets', '/api/data'),
      },
    },
  }
})
