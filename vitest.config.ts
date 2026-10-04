import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node's native Web Storage globals prevent Vitest from installing jsdom's.
    // Disable them only in test workers so jsdom supplies browser Storage.
    execArgv: ["--no-experimental-webstorage"],
  },
});
