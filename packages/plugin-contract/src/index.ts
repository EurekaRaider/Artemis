import { z } from "zod";

const packagePath = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    /^(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:\x00/]+(?:\/[^\\:\x00/]+)*$/,
    "Expected a package-relative path without traversal",
  );
/** Draft manifest for artemis.plugin.json (S0 slice, schemaVersion 1). */
export const legacyInteractiveManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  engines: z.object({ artemisPluginApi: z.literal("1") }),
  projectTypes: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        title: z.record(z.string(), z.string()),
        targets: z.array(z.enum(["project", "temporary"])),
        panelIds: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  panels: z
    .array(z.object({ id: z.string().min(1), entry: packagePath }))
    .min(1),
  runtime: z.object({
    entry: packagePath,
    protocolVersion: z.literal(1),
  }),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().min(1).max(2000),
        effect: z.enum(["artifact-write", "state-read"]),
      }),
    )
    .min(1),
  capabilities: z.object({
    // 托管账本退役：设计目标=工作区文件，插件对它们只读
    artifactStore: z.enum(["thread", "none"]).default("none"),
    projectFiles: z.literal("explicit-import"),
    network: z.literal("none"),
    sessionInput: z.literal("host-user-action"),
  }),
});

const metadata = {
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  version: z
    .string()
    .regex(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    ),
  description: z.string().max(2000).optional(),
};
export const resourceManifestV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal("resource"),
  ...metadata,
  contributes: z.strictObject({
    skills: z.array(packagePath).max(128).default([]),
    skins: z.array(packagePath).max(32).default([]),
    hooks: z.array(packagePath).max(32).default([]),
    mcp: packagePath.optional(),
  }),
});
export const interactiveManifestV2Schema = legacyInteractiveManifestSchema
  .omit({ schemaVersion: true, id: true, version: true })
  .extend({
    schemaVersion: z.literal(2),
    kind: z.literal("interactive"),
    ...metadata,
  });
export const manifestV2Schema = z.discriminatedUnion("kind", [
  resourceManifestV2Schema,
  interactiveManifestV2Schema,
]);
export type ManifestV2 = z.infer<typeof manifestV2Schema>;

// The host's existing runtime protocol consumes the normalized v1 shape.
export const pluginManifestSchema = z
  .union([legacyInteractiveManifestSchema, interactiveManifestV2Schema])
  .transform((value) => {
    if (value.schemaVersion === 1) return value;
    const {
      kind: _kind,
      name: _name,
      description: _description,
      ...runtime
    } = value;
    return { ...runtime, schemaVersion: 1 as const };
  });
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function normalizeResourceManifest(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Plugin manifest must be an object.");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion === 1) return input;
  const manifest = manifestV2Schema.parse(input);
  if (manifest.kind === "interactive")
    return {
      ...manifest,
      name: manifest.name,
      skills: [],
      skins: [],
      hooks: [],
    };
  return {
    ...manifest,
    skills: manifest.contributes.skills,
    skins: manifest.contributes.skins,
    hooks: manifest.contributes.hooks,
    mcpServers: manifest.contributes.mcp,
  };
}
