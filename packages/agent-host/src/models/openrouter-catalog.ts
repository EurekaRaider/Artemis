import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnyModel, Credential, Provider } from "@earendil-works/pi-ai";
import { isModelType } from "@earendil-works/pi-ai";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";

interface CatalogEntry {
  id: string;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

function restoreCatalog(
  value: unknown,
  models: readonly AnyModel[],
): AnyModel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = new Map<string, CatalogEntry>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !Number.isSafeInteger(item.contextWindow) ||
      item.contextWindow <= 0 ||
      !Number.isSafeInteger(item.maxTokens) ||
      item.maxTokens <= 0 ||
      !item.cost ||
      !["input", "output", "cacheRead", "cacheWrite"].every(
        (key) =>
          typeof item.cost[key] === "number" &&
          Number.isFinite(item.cost[key]) &&
          item.cost[key] >= 0,
      )
    )
      return undefined;
    entries.set(item.id, item as CatalogEntry);
  }
  return models.flatMap<AnyModel>((model) => {
    if (!isModelType(model, "chat")) return [model];
    const entry = entries.get(model.id);
    return entry
      ? [
          {
            ...model,
            contextWindow: entry.contextWindow,
            maxTokens: entry.maxTokens,
            cost: {
              input: entry.cost.input,
              output: entry.cost.output,
              cacheRead: entry.cost.cacheRead,
              cacheWrite: entry.cost.cacheWrite,
            },
          },
        ]
      : [];
  });
}

/** Keep account-specific catalog data local; only Pi assembles the provider request. */
export async function personalizeArtemisOpenRouter(
  provider: Provider,
  credential: Credential,
  directory: string,
): Promise<Provider | undefined> {
  const key = credential.type === "oauth" ? credential.access : credential.key;
  if (!key) return undefined;
  const baseUrl = provider.baseUrl ?? "https://openrouter.ai/api/v1";
  const baseline = provider.getAllModels?.() ?? provider.getModels();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([baseUrl, key, baseline]))
    .digest("hex");
  const path = join(directory, `${fingerprint}.json`);
  let models: readonly AnyModel[] | undefined;
  let checkedAt = 0;
  try {
    const cached = JSON.parse(await readFile(path, "utf8"));
    models = restoreCatalog(cached.models, baseline);
    checkedAt = typeof cached.checkedAt === "number" ? cached.checkedAt : 0;
  } catch {
    // A missing or invalid cache falls back to the configured catalog.
  }
  if (
    process.env.PI_OFFLINE === undefined &&
    (!models || Date.now() - checkedAt >= 5 * 60_000)
  ) {
    try {
      const refreshed = await personalizeOpenRouterCatalog(baseline, {
        credential,
        baseUrl,
        allowNetwork: true,
        signal: AbortSignal.timeout(8_000),
        publish: async () => true,
      });
      // Pi returns the original catalog for unsupported endpoints or rejected keys.
      if (refreshed === baseline) return undefined;
      models = refreshed;
      const cached = models
        .filter((model) => isModelType(model, "chat"))
        .map(({ id, contextWindow, maxTokens, cost }) => ({
          id,
          contextWindow,
          maxTokens,
          cost,
        }));
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          temporary,
          JSON.stringify({ checkedAt: Date.now(), models: cached }),
          { mode: 0o600 },
        );
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    } catch {
      // Network/cache write failures must not prevent using the current account offline.
    }
  }
  if (!models) return undefined;
  const snapshot = models;
  const { refreshModels: _refreshModels, ...base } = provider;
  return {
    ...base,
    getModels: () => snapshot.filter((model) => isModelType(model, "chat")),
    getAllModels: () => snapshot,
  };
}
