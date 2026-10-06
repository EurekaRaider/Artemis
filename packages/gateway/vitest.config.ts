import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database and native-process fixtures compete for Windows runner I/O.
    // Serialize files while retaining the existing per-test timeout.
    maxWorkers: process.platform === "win32" ? 1 : undefined,
  },
});
