// @vitest-environment jsdom
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../../../src/renderer/plugins/ResourceCenter.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows localized provenance and the Windows skill parent directory in RTL", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const skills = [
    {
      id: "owned",
      name: "document-helper",
      path: "/plugins/document-tools/skills/document-helper",
      description: "Write documents.",
      enabled: true,
    },
    {
      id: "builtin",
      name: "goal",
      path: "/bundled/goal",
      description: "Set a goal.",
      enabled: true,
      source: "builtin",
    },
    {
      id: "windows",
      name: "find-docs",
      path: "C:\\Users\\reader\\.agents\\skills\\find-docs\\SKILL.md",
      description: "Find documents.",
      enabled: true,
    },
  ];
  const setSkillEnabled = vi.fn(async (id: string, enabled: boolean) =>
    skills.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)),
  );
  stubWindowArtemis({
    listArtemisPlugins: async () => [
      {
        id: "document-tools",
        name: "document-tools",
        displayName: "Document tools",
        version: "1.0.0",
        description: "Document skills",
        localizations: { "zh-CN": { displayName: "文档插件" } },
        source: { kind: "local", path: "/plugins/document-tools" },
        installed: true,
        installable: true,
        skills: [],
        mcpServers: [],
        apps: [],
        unsupported: [],
        warnings: [],
        skillNames: ["document-helper"],
        mcpServerIds: [],
      },
    ],
    listInstalledSkills: async () => skills,
    listMcpServers: async () => [],
    getArtemisPluginMarketplaces: async () => ({
      sources: [],
      marketplaces: [],
      errors: [],
    }),
    loadBundledPluginMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    setSkillEnabled,
  });
  const { container } = render(
    <div dir="rtl">
      <ResourceCenter
        locale="zh-CN"
        onConfirm={async () => false}
        onSettingsChange={() => {}}
      />
    </div>,
  );
  await userEvent.click(screen.getByRole("button", { name: /^技能(?: \d+)?$/ }));
  await screen.findByText("document-helper");
  const sources = [...container.querySelectorAll(".resource-skill-source")].map(
    (element) => element.textContent,
  );
  expect(sources).toEqual(
    expect.arrayContaining(["文档插件", "内置", "~/.agents/skills"]),
  );
  expect(sources).toHaveLength(3);
  for (const source of container.querySelectorAll(".resource-skill-source")) {
    expect(source).toHaveAttribute(
      "dir",
      source.textContent === "~/.agents/skills" ? "ltr" : "auto",
    );
  }
  expect(screen.getByRole("button", { name: "技能 3" })).toBeVisible();
  const ownedRow = screen
    .getByText("document-helper")
    .closest(".resource-skill-row")!;
  expect(ownedRow.querySelector(".resource-avatar")).toHaveAttribute(
    "data-plugin",
    "true",
  );
  expect(ownedRow.querySelector(".resource-remove-button")).toBeDisabled();
  await userEvent.click(within(ownedRow as HTMLElement).getByRole("switch"));
  await waitFor(() =>
    expect(setSkillEnabled).toHaveBeenCalledWith("owned", false),
  );
  expect(ownedRow.querySelector(".resource-avatar")).toHaveAttribute(
    "data-disabled",
    "true",
  );
});
