import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// The logo already has the cream background; where the generator adds room around it, that room is cream too.
const cream = { background: "#F3EEE2" };

/** The home-screen icons, made from the logo in public/icon.svg with `npm run icons`. */
export default defineConfig({
  images: ["public/icon.svg"],
  preset: {
    ...minimal2023Preset,
    transparent: { sizes: [192, 512], favicons: [[48, "favicon.ico"]], padding: 0 },
    // Android cuts a circle or a rounded square out of this one: keep the castle inside it.
    maskable: { sizes: [512], padding: 0.1, resizeOptions: cream },
    apple: { sizes: [180], padding: 0, resizeOptions: cream },
    assetName: (type, size) => (type === "apple" ? "apple-touch-icon.png" : type === "maskable" ? `pwa-maskable-${size.width}.png` : `pwa-${size.width}.png`),
  },
});
