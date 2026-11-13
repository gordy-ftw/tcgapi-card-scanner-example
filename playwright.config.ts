import { defineConfig, devices } from "@playwright/test";

// Three local servers: the app where each visitor types their own API key, the app with a
// server key behind an access code, and a mock TCG API both of them call.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MOCK = `http://127.0.0.1:${PORT + 2}`;
const app = (port: number, env: Record<string, string>) => ({
  command: `npx next start --port ${port}`,
  url: `http://127.0.0.1:${port}`,
  env: { TCGAPI_URL: MOCK, ...env },
  reuseExistingServer: false,
});

export default defineConfig({
  testDir: "./e2e",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://127.0.0.1:${PORT}`,
    permissions: ["camera"],
    // Chromium's built-in fake camera stands in for a real one.
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "node e2e/mock-api.mjs", url: MOCK, env: { PORT: String(PORT + 2) }, reuseExistingServer: false },
    app(PORT, { TCGAPI_KEY: "", ACCESS_CODE: "" }),
    app(PORT + 1, { TCGAPI_KEY: "tcg_test_server", ACCESS_CODE: "open-sesame" }),
  ],
});
