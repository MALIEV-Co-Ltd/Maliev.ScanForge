import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles.css";
import { clearDevelopmentCache } from "./development-cache";
// Suppress browser UI even when a captured pan ends outside its canvas.
// Keep propagation intact so application and portal context menus still work.
document.addEventListener(
  "contextmenu",
  (event) => event.preventDefault(),
  true,
);

async function mount() {
  if (import.meta.env.DEV && "serviceWorker" in navigator) {
    try {
      if (
        await clearDevelopmentCache(
          navigator.serviceWorker,
          caches,
          new URL("sw.js", document.baseURI).href,
        )
      ) {
        window.location.reload();
        return;
      }
    } catch (error) {
      console.warn("Development offline cache reset unavailable:", error);
    }
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
void mount();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) =>
        console.warn("Offline installation unavailable:", error),
      );
  });
}
