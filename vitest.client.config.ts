import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "shared/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    // A test that fakes the clock fakes only the clock. The stand-in for IndexedDB runs on setImmediate,
    // and with that faked too its transactions close before the code that awaits them can go on.
    fakeTimers: { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] },
  },
});
