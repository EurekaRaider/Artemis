const MINIMUM_CONTEXT_WINDOW = 1_024;

export function configureModelContextWindow<
  TModel extends { contextWindow: number },
>(model: TModel, configuredContextWindow?: number): TModel {
  if (configuredContextWindow === undefined) {
    return model;
  }
  if (
    !Number.isInteger(configuredContextWindow) ||
    configuredContextWindow < MINIMUM_CONTEXT_WINDOW
  ) {
    throw new Error("Configured context window is invalid.");
  }
  if (configuredContextWindow > model.contextWindow) {
    throw new Error(
      `Configured context window cannot exceed the model limit of ${model.contextWindow}.`,
    );
  }
  if (configuredContextWindow === model.contextWindow) {
    return model;
  }
  return { ...model, contextWindow: configuredContextWindow };
}

export function compactionSettingsForContextWindow(contextWindow: number) {
  return {
    enabled: true,
    reserveTokens: Math.floor(contextWindow * 0.1),
    keepRecentTokens: Math.max(
      256,
      Math.min(20_000, Math.floor(contextWindow * 0.25)),
    ),
  };
}
