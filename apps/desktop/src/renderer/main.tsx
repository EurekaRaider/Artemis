import { AppearanceProvider } from "./appearance/AppearanceProvider.js";
import { bootstrapAppearance } from "./appearance/appearance-controller.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import { bootstrapDesktopSkin } from "./appearance/desktop-skin-bootstrap.js";
import "./app/i18n.js";
import "@artemis/ui/styles.css";
import "./styles/styles.css";
import "./styles/prototype-migration.css";
import "@artemis/theme-artemis/theme.css";
import "./appearance/appearance.css";

performance.mark?.("artemis:renderer-entry");

function diagnosticDetails(value: unknown): {
  message: string;
  stack?: string;
} {
  if (value instanceof Error) {
    return {
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  return { message: String(value) };
}

window.addEventListener("error", (event) => {
  window.artemis.reportRendererError({
    kind: "error",
    ...diagnosticDetails(event.error ?? event.message),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  window.artemis.reportRendererError({
    kind: "unhandled-rejection",
    ...diagnosticDetails(event.reason),
  });
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Artemis root element was not found.");
}

await bootstrapDesktopSkin();
await bootstrapAppearance();
performance.mark?.("artemis:skin-ready");

createRoot(root).render(
  <StrictMode>
    <AppearanceProvider>
      <App />
    </AppearanceProvider>
  </StrictMode>,
);
performance.mark?.("artemis:react-scheduled");
