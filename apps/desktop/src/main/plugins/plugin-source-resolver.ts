import {
  exists,
  readJson,
  canonicalDirectory,
  declaredPath,
} from "./plugin-files.js";
import { record, text, strings } from "./plugin-values.js";
import {
  MAX_MARKETPLACE_BYTES,
  BUNDLED_ARTIFACT_MARKETPLACE_NAME,
} from "./plugin-constants.js";
import type { ParsedPlugin } from "./plugin-types.js";

import type {
  ArtemisPluginPreview,
  ArtemisPluginSource,
} from "../../shared/api.js";

import { assertNativeManifestVersion } from "../../shared/plugin-manifest.js";
import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginSourceResolver(
  services: Pick<
    PluginServiceDependencies,
    | "loadStore"
    | "preview"
    | "parsePlugin"
    | "options"
    | "bundledArtifactMarketplaceLocation"
    | "marketplacePluginRoot"
    | "marketplaceCache"
    | "marketplaceFile"
  >,
) {
  async function inspectLocal(
    sourcePath: string,
  ): Promise<ArtemisPluginPreview> {
    await services.loadStore();
    const root = await canonicalDirectory(sourcePath);
    const source: ArtemisPluginSource = { kind: "local", path: root };
    return services.preview(await services.parsePlugin(root, source, false));
  }

  async function resolveSource(
    source: ArtemisPluginSource,
    requireFreshLocal: boolean,
  ): Promise<ParsedPlugin> {
    if (source.kind === "builtin") {
      if (!services.options.computerUseRoot)
        throw new Error(
          "Computer Use requires the macOS or Windows Artemis app.",
        );
      return services.parsePlugin(
        await canonicalDirectory(services.options.computerUseRoot),
        source,
        true,
      );
    }
    if (source.kind === "local") {
      if (requireFreshLocal && !(await exists(source.path))) {
        throw new Error(
          "The original local plugin source is no longer available.",
        );
      }
      const root = await canonicalDirectory(source.path);
      return services.parsePlugin(root, { kind: "local", path: root }, true);
    }
    if (source.kind === "bundled" || source.kind === "runtime") {
      const marketplaceRoot =
        await services.bundledArtifactMarketplaceLocation();
      if (!marketplaceRoot) {
        throw new Error(
          "The bundled Lite artifact plugins are no longer available.",
        );
      }
      const root = await services.marketplacePluginRoot(
        marketplaceRoot,
        BUNDLED_ARTIFACT_MARKETPLACE_NAME,
        source.pluginName,
      );
      return services.parsePlugin(
        root,
        { kind: "bundled", pluginName: source.pluginName },
        true,
      );
    }
    const cache = services.marketplaceCache(source.marketplaceUrl);
    if (!(await exists(cache))) {
      throw new Error(
        "Marketplace cache unavailable. Refresh the Git marketplace or re-import the offline package before installing.",
      );
    }
    const root = await services.marketplacePluginRoot(
      cache,
      source.marketplaceName,
      source.pluginName,
    );
    return services.parsePlugin(root, source, true);
  }

  async function marketplacePluginRoot(
    marketplaceRoot: string,
    expectedMarketplaceName: string,
    pluginName: string,
  ): Promise<string> {
    const filePath = await services.marketplaceFile(marketplaceRoot);
    const marketplace = record(await readJson(filePath, MAX_MARKETPLACE_BYTES));
    assertNativeManifestVersion(marketplace, "marketplace");
    if (text(marketplace?.name) !== expectedMarketplaceName) {
      throw new Error("Plugin marketplace identity changed.");
    }
    const entry = Array.isArray(marketplace?.plugins)
      ? marketplace.plugins
          .map(record)
          .find((candidate) => text(candidate?.name) === pluginName)
      : undefined;
    const policy = record(entry?.policy);
    const products = strings(policy?.products);
    if (
      !entry ||
      text(policy?.installation) === "NOT_AVAILABLE" ||
      (products.length > 0 && !products.includes("ARTEMIS"))
    ) {
      throw new Error("Marketplace plugin is no longer available.");
    }
    const entrySourceValue = entry.source;
    const entrySource = record(entrySourceValue);
    const sourcePath =
      typeof entrySourceValue === "string"
        ? text(entrySourceValue)
        : entrySource?.source === "local"
          ? text(entrySource.path)
          : undefined;
    if (!sourcePath) {
      throw new Error("Marketplace plugin is unavailable or unsupported.");
    }
    return canonicalDirectory(
      declaredPath(marketplaceRoot, sourcePath, "Marketplace plugin"),
      marketplaceRoot,
    );
  }
  const handlers = { inspectLocal, resolveSource, marketplacePluginRoot };
  return handlers;
}
