import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  getPublishConfigs,
} = require("app-builder-lib/out/publish/PublishManager.js");
const config = require("../../scripts/packaging/engineering-builder.config.cjs");

afterEach(() => vi.unstubAllEnvs());

it("does not infer a publisher for engineering builds on CI", async () => {
  vi.stubEnv("GITHUB_TOKEN", "synthetic-ci-token");
  const packager = { config, platformSpecificBuildOptions: config.mac };
  await expect(
    getPublishConfigs(packager, null, null, true),
  ).resolves.toBeNull();
});
