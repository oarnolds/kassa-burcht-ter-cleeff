import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

// The end-to-end tests keep their own local database (see playwright.config.ts).
const state = process.env.KASSA_STATE;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "worker" }, ...(state ? { persistState: { path: state } } : {}) }),
    // The kassa as an app on the iPad's home screen, which also starts without a connection.
    // Only the app in the browser is one: without this the Worker's build gets a copy of the manifest and
    // of the registration script, and the script is uploaded with the Worker.
    ...VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Kassa Burcht ter Cleeff",
        short_name: "Kassa",
        lang: "nl",
        display: "standalone",
        orientation: "landscape",
        start_url: "/",
        background_color: "#F3EEE2",
        theme_color: "#F3EEE2",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app itself is kept on the iPad. Nothing under /api is: what the server says is never served from a cache.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }).map((plugin) => ({ ...plugin, applyToEnvironment: (environment: { name: string }) => environment.name === "client" })),
  ],
  environments: { worker: { build: { sourcemap: true } } },
});
