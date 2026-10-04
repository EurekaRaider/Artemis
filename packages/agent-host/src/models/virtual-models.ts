import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderConnection } from "@artemis/protocol";

/** Routing stays inside Pi's request/retry loop; no independent agent loop or replay. */
export function registerVirtualModels(
  runtime: ModelRuntime,
  providers: ProviderConnection[],
): Array<{ provider: string; id: string }> {
  const registered: Array<{ provider: string; id: string }> = [];
  for (const provider of providers)
    for (const model of provider.models) {
      const routes = model.virtualRoutes;
      if (!routes) continue;
      runtime.registerVirtualModel({
        provider: provider.id,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        thinkingLevels: model.reasoning
          ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
          : ["off"],
        route: (request) => {
          request.signal?.throwIfAborted();
          const previous = request.failed?.model ?? request.previous?.model;
          const index = previous
            ? routes.findIndex(
                (route) =>
                  route.providerId === previous.provider &&
                  route.modelId === previous.id,
              )
            : -1;
          const routeIndex =
            request.reason === "retry"
              ? Math.min(index + 1, routes.length - 1)
              : request.reason === "continuation" && index >= 0
                ? index
                : 0;
          const route = routes[routeIndex]!;
          const target = runtime.getPhysicalModel(
            route.providerId,
            route.modelId,
          );
          if (!target)
            throw new Error(
              `Virtual model target is unavailable: ${route.providerId}/${route.modelId}`,
            );
          return {
            model: target,
            thinkingLevel: route.thinkingLevel ?? request.thinkingLevel,
          };
        },
      });
      registered.push({ provider: provider.id, id: model.id });
    }
  return registered;
}
