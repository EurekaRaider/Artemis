// Minimal shared helpers for jsdom interactive renderer tests (D#76 PR0).
// Import this module only from tests that declare `// @vitest-environment jsdom`.
// Keep stubs per-test: install only what a single test needs and always
// restore it. Never add a global always-succeeds Electron mock here.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

/**
 * Install a minimal `window.artemis` stub for a single test and return a
 * restore function. Call the returned function when the test finishes so the
 * stub never leaks into other tests.
 */
export function stubWindowArtemis(stub: Record<string, unknown>): () => void {
  const target = window as unknown as { artemis?: Record<string, unknown> };
  const original = target.artemis;
  target.artemis = stub;
  return () => {
    target.artemis = original;
  };
}
