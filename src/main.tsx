import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Automatically check for updated Service Worker when the iOS PWA / browser returns to foreground
// and reload once when a new version activates so users never stay stuck on stale cached bundles.
let isReloadingForSwUpdate = false;
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !isReloadingForSwUpdate) {
      isReloadingForSwUpdate = true;
      window.location.reload();
    }
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Check for updates immediately and whenever app returns to foreground (iOS PWA)
    registration.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
