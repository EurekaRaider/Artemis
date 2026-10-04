import { mergeConfig } from "vitest/config";

import sharedConfig from "../../vitest.config.js";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, sharedConfig);
