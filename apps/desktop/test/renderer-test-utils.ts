// Minimal shared helpers for jsdom interactive renderer tests (D#76 PR0).
// Import this module only from tests that declare `// @vitest-environment jsdom`.
// It wires jest-dom matchers for Vitest and unmounts RTL trees after every
// test. Per-test `window.artemis` stubs are intentionally NOT provided here;
// they will land together with their first consumer and isolation regression
// tests (PR #103 review).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
