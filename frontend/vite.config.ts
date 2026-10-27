import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['kb-bridge.sjw-project.site'],
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.LOANSIGHT_API_PORT || '8000'}`,
        changeOrigin: false,
        // Preserve the browser Origin for backend write-request validation.
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
