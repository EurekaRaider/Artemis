// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.unstubAllGlobals();
});

it("confirms the named MCP or Skill before removing it and preserves cancellation and retry", async () => {
  const user = userEvent.setup();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const server = {
    config: {
      id: "context7",
      name: "Context7",
      enabled: true,
      transport: "stdio",
      command: "synthetic",
    },
    state: "connected",
    tools: [],
  };
  const skill = {
    id: "design-skill",
    name: "design-taste-frontend",
    description: "Design guidance",
    path: "/synthetic/skills/design",
    enabled: true,
  };
  const settings = { mcpServers: [], trustedExtensions: [] };
  const removeMcp = vi
    .fn()
    .mockRejectedValueOnce(new Error("Removal failed"))
    .mockResolvedValue(settings);
  let finishSkillRemoval!: () => void;
  const removeSkill = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finishSkillRemoval = resolve;
    });
    return [];
  });
  const genericConfirm = vi.fn(async () => true);
  const changed = vi.fn();
  stubWindowArtemis({
    listCodexPlugins: async () => [],
    listInstalledSkills: async () => [skill],
    listMcpServers: async () => [server],
    getCodexPluginMarketplaces: async () => ({
      sources: [],
      marketplaces: [],
      errors: [],
    }),
    loadCodexRuntimeMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    removeMcpServer: removeMcp,
    removeSkill,
  });
  render(
    <ResourceCenter
      locale="en"
      onConfirm={genericConfirm}
      onSettingsChange={changed}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Manage installed capabilities" }),
  );
  await user.click(screen.getByRole("tab", { name: "MCP", exact: true }));
  const removeTrigger = await screen.findByRole("button", {
    name: "Remove Context7",
  });
  for (const dismissal of ["Cancel", "Escape"]) {
    await user.click(removeTrigger);
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove this MCP server?",
    });
    expect(dialog).toHaveAccessibleDescription(/Context7.*cannot be undone/);
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(
      within(dialog)
        .getByRole("button", { name: "Cancel" })
        .querySelector('[data-artemis-icon="close"]'),
    ).not.toBeNull();
    expect(
      within(dialog)
        .getByRole("button", { name: "Remove", exact: true })
        .querySelector('[data-artemis-icon="trash"]'),
    ).not.toBeNull();
    expect(removeMcp).not.toHaveBeenCalled();
    if (dismissal === "Escape")
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    else
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(removeTrigger).toHaveFocus();
  }
  await user.click(removeTrigger);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Remove",
      exact: true,
    }),
  );
  expect(await screen.findByText("Removal failed")).toBeVisible();
  expect(removeTrigger).toBeEnabled();
  expect(changed).not.toHaveBeenCalled();
  await user.click(removeTrigger);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Remove",
      exact: true,
    }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledWith(settings));
  expect(removeMcp).toHaveBeenLastCalledWith(server.config.id);
  expect(screen.queryByRole("button", { name: "Remove Context7" })).toBeNull();

  await user.click(screen.getByRole("tab", { name: "Skills", exact: true }));
  const uninstallTrigger = screen.getByRole("button", {
    name: "Uninstall design-taste-frontend",
  });
  await user.click(uninstallTrigger);
  let dialog = screen.getByRole("alertdialog", {
    name: "Uninstall this Skill?",
  });
  expect(dialog).toHaveAccessibleDescription(
    /design-taste-frontend.*cannot be undone/,
  );
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(removeSkill).not.toHaveBeenCalled();
  await user.click(uninstallTrigger);
  dialog = screen.getByRole("alertdialog");
  await user.dblClick(
    within(dialog).getByRole("button", { name: "Uninstall", exact: true }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(removeSkill).toHaveBeenCalledExactlyOnceWith(skill.id);
  expect(uninstallTrigger).toBeDisabled();
  expect(genericConfirm).not.toHaveBeenCalled();
  finishSkillRemoval();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Uninstall design-taste-frontend" }),
    ).toBeNull(),
  );
});
