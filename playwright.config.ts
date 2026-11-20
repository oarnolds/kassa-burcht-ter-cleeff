import { defineConfig } from "@playwright/test";

// The end-to-end run has its own local database, made afresh every time: the trial data in .wrangler/state stays as it is.
const STATE = ".wrangler/e2e";
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // One kassa, one database: the tests take turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  // The iPad in its wall holder: Safari's engine, landscape.
  projects: [{ name: "webkit", use: { browserName: "webkit", viewport: { width: 1180, height: 820 } } }],
  webServer: {
    command: [
      `rm -rf ${STATE}`,
      `npx wrangler d1 migrations apply kassa --local --persist-to ${STATE}`,
      `KASSA_STATE=${STATE} npm run build`,
      `KASSA_STATE=${STATE} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
