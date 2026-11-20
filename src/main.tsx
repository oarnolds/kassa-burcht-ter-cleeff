import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles/app.css";

// Keeps the app itself on the iPad, so the kassa also starts without a connection. A new version is fetched
// when the kassa is opened and shown right away (the page reloads once, in the first seconds after opening).
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
