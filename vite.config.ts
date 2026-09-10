import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    base: '/graphmind/',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@xyflow/')) return 'canvas-vendor'
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          },
        },
      },
    },
    server: {
      proxy: {
        '/graphmind/api': {
          target: env.MIRA_BRIDGE_ORIGIN || 'http://127.0.0.1:56300',
          changeOrigin: true,
          rewrite: (path) => path,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.{ts,js}', 'src/**/*.test.{ts,js}'],
    },
  }
})
