import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const GLM_5_3_FLASH_MODEL_ID = "glm-5.3-flash";
export const GLM_5_3_FLASH_MODEL_NAME = "GLM-5.3-Flash";
export const GLM_5_3_FLASH_PROVIDER_IDS = ["zai", "zai-coding-cn"] as const;

const GLM_5_3_MODEL_ID = "glm-5.3";

// Pi 0.84.3 predates Flash. Derive it from GLM-5.3 so provider auth and wire
// compatibility stay identical, and stop patching automatically once Pi adds it.
export function withArtemisBuiltinModels(
  providerId: string,
  models: readonly Model<Api>[],
): readonly Model<Api>[] {
  if (
    !GLM_5_3_FLASH_PROVIDER_IDS.some((candidate) => candidate === providerId) ||
    models.some((model) => model.id === GLM_5_3_FLASH_MODEL_ID)
  ) {
    return models;
  }
  const base = models.find((model) => model.id === GLM_5_3_MODEL_ID);
  if (!base) return models;
  const flash: Model<Api> = {
    ...base,
    id: GLM_5_3_FLASH_MODEL_ID,
    name: GLM_5_3_FLASH_MODEL_NAME,
    input: ["text", "image"],
  };
  return [...models, flash];
}

function providerWithArtemisBuiltinModels(provider: Provider): Provider {
  return {
    ...provider,
    getModels: () =>
      withArtemisBuiltinModels(provider.id, provider.getModels()),
    ...(provider.refreshModels
      ? {
          refreshModels: (context) => provider.refreshModels!(context),
        }
      : {}),
    ...(provider.filterModels
      ? {
          filterModels: (models, credential) =>
            provider.filterModels!(models, credential),
        }
      : {}),
    stream: (model, context, options) =>
      provider.stream(model, context, options),
    streamSimple: (model, context, options) =>
      provider.streamSimple(model, context, options),
    ...(provider.fetchDeferred
      ? {
          fetchDeferred: (model, handle, options) =>
            provider.fetchDeferred!(model, handle, options),
        }
      : {}),
    ...(provider.cancelDeferred
      ? {
          cancelDeferred: (model, handle, options) =>
            provider.cancelDeferred!(model, handle, options),
        }
      : {}),
  };
}

export function registerArtemisBuiltinModels(
  runtime: Pick<ModelRuntime, "getProvider" | "registerNativeProvider">,
): void {
  for (const providerId of GLM_5_3_FLASH_PROVIDER_IDS) {
    const provider = runtime.getProvider(providerId);
    if (!provider) continue;
    const models = provider.getModels();
    if (withArtemisBuiltinModels(providerId, models) === models) continue;
    runtime.registerNativeProvider(providerWithArtemisBuiltinModels(provider));
  }
}
