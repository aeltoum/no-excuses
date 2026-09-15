import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "./node_modules/.bin/vite --host 127.0.0.1",
    env: {
      VITE_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY:
        process.env.LIVE_PWA_INTEGRATION === "1"
          ? (process.env.LOCAL_SUPABASE_ANON_KEY ?? "")
          : "local-public-test-key",
    },
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
