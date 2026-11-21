import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { secureAddress } from "./lib/secure-address";
import "./styles/app.css";

const secure = secureAddress(window.location.href);
if (secure) {
  // Opened without https: go there before anything is typed or sent.
  window.location.replace(secure);
} else {
  // Keeps the app itself on the iPad, so the kassa also starts without a connection. A new version is fetched
  // when the kassa is opened and shown right away (the page reloads once, in the first seconds after opening).
  registerSW({ immediate: true });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
