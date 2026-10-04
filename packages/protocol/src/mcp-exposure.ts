import { z } from "zod";
export type McpExposure = "direct" | "deferred" | "codemode" | "hidden";
export interface McpExposureSettings {
  exposure?: McpExposure | undefined;
  toolExposure?: Record<string, McpExposure> | undefined;
}
export function mcpToolExposure(
  settings: McpExposureSettings,
  name: string,
): McpExposure | undefined {
  if (settings.toolExposure?.[name]) return settings.toolExposure[name];
  for (const [pattern, exposure] of Object.entries(
    settings.toolExposure ?? {},
  )) {
    const expression = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (new RegExp(`^${expression}$`).test(name)) return exposure;
  }
  return settings.exposure;
}

const exposureSchema = z.enum(["direct", "deferred", "codemode", "hidden"]);
export const mcpProjectOverridesSchema = z.record(
  z.string(),
  z.object({
    enabled: z.boolean().optional(),
    exposure: exposureSchema.optional(),
    toolExposure: z.record(z.string(), exposureSchema).optional(),
  }),
);
