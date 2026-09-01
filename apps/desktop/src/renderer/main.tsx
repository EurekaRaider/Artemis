import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { bootstrapDesktopSkin } from "./desktop-skin-bootstrap.js";
import "./i18n.js";
import "./styles.css";
import "@artemis/theme-artemis/theme.css";

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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
