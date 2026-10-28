import { defineConfig } from '@playwright/test'

const port = Number(process.env.LOANSIGHT_E2E_PORT || 5173)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 2,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
})
