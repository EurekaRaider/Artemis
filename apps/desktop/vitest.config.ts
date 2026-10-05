import { mergeConfig } from "vitest/config";

import sharedConfig from "../../vitest.config.js";
import viteConfig from "./vite.config.js";

export default mergeConfig(mergeConfig(viteConfig, sharedConfig), {
  test: {
    // Fresh SQLite databases and Git fixtures can exceed five seconds on
    // hosted Windows even with serial files. Keep explicit per-test limits.
    ...(process.platform === "win32" ? { testTimeout: 15_000 } : {}),
  },
});
