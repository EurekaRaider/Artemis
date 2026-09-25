import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real child sessions load the SDK per worker. Bound Windows I/O contention
    // rather than weakening the integration tests' existing timeouts.
    maxWorkers: process.platform === "win32" ? 2 : undefined,
  },
});
