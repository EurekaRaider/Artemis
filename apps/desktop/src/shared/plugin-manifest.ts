export function assertNativeManifestVersion(
  value: unknown,
  kind: "plugin" | "marketplace",
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Artemis ${kind} manifest must be a JSON object.`);
  if ((value as Record<string, unknown>).schemaVersion !== 1)
    throw new Error(
      `Unsupported Artemis ${kind} schema version. Expected schemaVersion: 1.`,
    );
}
