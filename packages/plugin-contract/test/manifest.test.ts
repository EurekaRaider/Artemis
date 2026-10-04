import { expect, it } from "vitest";
import {
  manifestV2Schema,
  normalizeResourceManifest,
  pluginManifestSchema,
} from "../src/index.js";
const resource = {
  schemaVersion: 2,
  kind: "resource",
  id: "local.notes",
  name: "notes",
  version: "1.0.0",
  contributes: { skills: ["skills/notes"] },
};
it("normalizes explicit resource paths without granting undeclared capabilities", () => {
  const value = normalizeResourceManifest(resource);
  expect(value.skills).toEqual(["skills/notes"]);
  expect(value.hooks).toEqual([]);
  expect(value.mcpServers).toBeUndefined();
});
it("rejects mixed capability families, unknown fields and escaping package paths", () => {
  expect(() =>
    manifestV2Schema.parse({ ...resource, runtime: { entry: "run.mjs" } }),
  ).toThrow();
  for (const path of [
    "../other",
    "/absolute",
    "C:\\secret",
    "safe/../../secret",
    "safe//file",
    "a\0b",
  ]) {
    expect(() =>
      manifestV2Schema.parse({ ...resource, contributes: { skills: [path] } }),
    ).toThrow();
  }
});
it("retains legacy resource identity and declaration semantics", () => {
  const legacy = {
    schemaVersion: 1,
    name: "old-plugin",
    version: "1.0.0",
    skills: "./skills",
  };
  expect(normalizeResourceManifest(legacy)).toBe(legacy);
  expect(() => pluginManifestSchema.parse(resource)).toThrow();
});
