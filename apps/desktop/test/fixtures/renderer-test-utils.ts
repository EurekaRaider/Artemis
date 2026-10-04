// Minimal shared helpers for jsdom interactive renderer tests (D#76 PR0/PR1).
// Import this module only from tests that declare `// @vitest-environment jsdom`.
// It wires jest-dom matchers for Vitest and unmounts RTL trees after every
// test. Per-test `window.artemis` stubs install the exact object a single test
// needs and are restored automatically — including the original property
// descriptor — even if the test forgets to call the returned restore function.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

type Restore = () => void;

const pendingRestores: Restore[] = [];

afterEach(() => {
  cleanup();
  while (pendingRestores.length > 0) {
    pendingRestores.pop()!();
  }
});

/**
 * Install a minimal `window.artemis` stub for a single test. The returned
 * restore function removes the stub and puts back the original property
 * descriptor (or deletes the key entirely when it did not exist). Restoration
 * also happens automatically in `afterEach`, so a failing test cannot leak the
 * stub into the next one.
 */
export function stubWindowArtemis(stub: Record<string, unknown>): () => void {
  const target = window as unknown as Record<string, unknown>;
  const key = "artemis";
  const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    value: stub,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  let restored = false;
  const restore: Restore = () => {
    if (restored) return;
    restored = true;
    const index = pendingRestores.indexOf(restore);
    if (index >= 0) pendingRestores.splice(index, 1);
    if (hadOwn && descriptor) {
      Object.defineProperty(target, key, descriptor);
    } else {
      delete target[key];
    }
  };
  pendingRestores.push(restore);
  return restore;
}
