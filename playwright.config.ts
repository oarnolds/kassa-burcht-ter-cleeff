import { defineConfig } from "@playwright/test";

// The end-to-end run has its own local database, made afresh every time: the trial data in .wrangler/state stays as it is.
const STATE = ".wrangler/e2e";
const PORT = 4173;
// The run has its own secrets too (.dev.vars.e2e): made-up values and a Mollie that is played by e2e/global-setup.ts.
// The penningmeester's own .dev.vars is not read, and the real Mollie is never called.
const ENV = `CLOUDFLARE_ENV=e2e KASSA_STATE=${STATE}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
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
      `${ENV} npm run build`,
      `${ENV} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
