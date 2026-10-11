import { expect, it } from "vitest";
// @ts-expect-error Build scripts are exercised directly.
import { assertInstalledComputerUse } from "../../scripts/verify/native/installed-computer-use-state.mjs";

function installed() {
  return {
    before: { supported: true, availableVersion: "1.2.3" },
    after: { activeVersion: "1.2.3" },
    plugin: {
      installed: true,
      version: "1.2.3",
      skillNames: ["computer-use"],
      mcpServerIds: ["owned-computer-use-server"],
    },
    skills: [{ name: "computer-use", enabled: true }],
    mcpServers: [{ id: "owned-computer-use-server", enabled: true }],
  };
}

it("accepts the installed-plugin API without a nonexistent enabled property", () => {
  expect(() => assertInstalledComputerUse(installed())).not.toThrow();
});

it.each(["skills", "mcpServers"] as const)(
  "rejects a disabled owned %s even if a plugin claims to be enabled",
  (resource) => {
    const state = installed();
    state[resource][0].enabled = false;
    expect(() =>
      assertInstalledComputerUse({
        ...state,
        plugin: { ...state.plugin, enabled: true },
      }),
    ).toThrow();
  },
);

it.each(["skills", "mcpServers"] as const)(
  "rejects missing owned %s even if a plugin claims to be enabled",
  (resource) => {
    const state = installed();
    state[resource] = [];
    expect(() =>
      assertInstalledComputerUse({
        ...state,
        plugin: { ...state.plugin, enabled: true },
      }),
    ).toThrow();
  },
);

it("rejects unrelated enabled resources in place of the plugin's owned resources", () => {
  const state = installed();
  expect(() =>
    assertInstalledComputerUse({
      ...state,
      plugin: { ...state.plugin, enabled: true },
      skills: [{ name: "unrelated", enabled: true }],
      mcpServers: [{ id: "unrelated", enabled: true }],
    }),
  ).toThrow();
});

it("rejects an absent installation, version mismatch, or a reused profile", () => {
  const state = installed();
  for (const invalid of [
    { ...state, plugin: { ...state.plugin, installed: false, enabled: true } },
    { ...state, plugin: { ...state.plugin, version: "1.2.2", enabled: true } },
    { ...state, before: { ...state.before, activeVersion: "1.2.3" } },
  ]) {
    expect(() => assertInstalledComputerUse(invalid)).toThrow();
  }
});

it("rejects empty ownership declarations", () => {
  const state = installed();
  expect(() =>
    assertInstalledComputerUse({
      ...state,
      plugin: {
        ...state.plugin,
        enabled: true,
        skillNames: [],
        mcpServerIds: [],
      },
      skills: [],
      mcpServers: [],
    }),
  ).toThrow();
});
