// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CatalogSearchNotice,
  ResourceCenter,
} from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

afterEach(() => cleanup());

function expectLinkedTabPanels(selector: string): void {
  const tablist = document.querySelector(selector);
  expect(tablist).not.toBeNull();
  const tabs = [...tablist!.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.length).toBeGreaterThan(1);
  for (const tab of tabs) {
    const panelId = tab.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(panel!.hidden).toBe(tab.getAttribute("aria-selected") !== "true");
  }
}

describe("Resource Center catalog feedback", () => {
  it("keeps polite status semantics when search changes from loading to empty", async () => {
    const user = userEvent.setup();
    function Example() {
      const [loading, setLoading] = useState(true);
      return (
        <>
          <CatalogSearchNotice loading={loading}>
            {loading ? "Searching the catalog…" : "No matching servers found."}
          </CatalogSearchNotice>
          <button onClick={() => setLoading(false)} type="button">
            Complete search
          </button>
        </>
      );
    }

    render(<Example />);
    const loadingStatus = screen.getByRole("status");
    expect(loadingStatus.getAttribute("aria-live")).toBe("polite");
    expect(loadingStatus.getAttribute("aria-atomic")).toBe("true");
    expect(loadingStatus.textContent).toContain("Searching the catalog");

    await user.click(screen.getByRole("button", { name: "Complete search" }));
    const emptyStatus = screen.getByRole("status");
    expect(emptyStatus.getAttribute("aria-live")).toBe("polite");
    expect(emptyStatus.getAttribute("aria-atomic")).toBe("true");
    expect(emptyStatus.textContent).toContain("No matching servers found");
  });

  it("prevents every same-tick marketplace submit while running one operation", async () => {
    const inspectTrust = vi.fn(() =>
      Promise.resolve({
        url: "https://github.com/synthetic-owner/synthetic-marketplace.git",
        repository: "synthetic-owner/synthetic-marketplace",
        marketplaceName: "synthetic-marketplace",
        displayName: "Synthetic marketplace",
        signed: true,
        signingKeyFingerprint: "synthetic-fingerprint",
      }),
    );
    let resolveConfirm!: (confirmed: boolean) => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    stubWindowArtemis({
      getCodexPluginMarketplaces: () =>
        Promise.resolve({
          selectedView: "source-a",
          sources: [
            {
              id: "source-a",
              url: "https://github.com/synthetic-owner/source-a.git",
              marketplaceName: "source-a",
              displayName: "Synthetic marketplace",
              repository: "synthetic-owner/source-a",
              builtIn: false,
              removable: true,
              offline: false,
              refreshable: true,
              order: 0,
            },
            {
              id: "source-b",
              url: "https://github.com/synthetic-owner/source-b.git",
              marketplaceName: "source-b",
              displayName: "Synthetic marketplace",
              repository: "synthetic-owner/source-b",
              builtIn: false,
              removable: true,
              offline: false,
              refreshable: true,
              order: 1,
            },
          ],
          marketplaces: [
            {
              sourceId: "source-a",
              marketplace: {
                name: "Synthetic marketplace",
                marketplaceName: "source-a",
                url: "https://github.com/synthetic-owner/source-a.git",
                warnings: [],
                plugins: [
                  {
                    id: "synthetic-warning-plugin",
                    name: "synthetic-warning-plugin",
                    displayName: "Synthetic warning plugin",
                    version: "0.0.0",
                    description: "Synthetic plugin with a visible warning.",
                    source: {
                      kind: "git",
                      marketplaceUrl:
                        "https://github.com/synthetic-owner/source-a.git",
                      marketplaceName: "source-a",
                      pluginName: "synthetic-warning-plugin",
                    },
                    installed: false,
                    installable: true,
                    skills: [],
                    mcpServers: [],
                    apps: [],
                    unsupported: [],
                    warnings: ["Synthetic manifest has no version."],
                  },
                  {
                    id: "synthetic-unsupported-plugin",
                    name: "synthetic-unsupported-plugin",
                    displayName: "Synthetic unsupported plugin",
                    version: "1.0.0",
                    description: "Synthetic plugin with unsupported features.",
                    source: {
                      kind: "git",
                      marketplaceUrl:
                        "https://github.com/synthetic-owner/source-a.git",
                      marketplaceName: "source-a",
                      pluginName: "synthetic-unsupported-plugin",
                    },
                    installed: false,
                    installable: false,
                    skills: [],
                    mcpServers: [],
                    apps: [],
                    unsupported: ["Hooks", "Scheduled templates"],
                    warnings: [],
                  },
                ],
              },
            },
          ],
          errors: [],
        }),
      inspectCodexPluginMarketplaceTrust: inspectTrust,
      listCodexPlugins: () => Promise.resolve([]),
      listInstalledSkills: () => Promise.resolve([]),
      listMcpServers: () => Promise.resolve([]),
      loadCodexRuntimeMarketplace: () => Promise.resolve(undefined),
      onResourceInstallProgress: () => () => {},
      searchSkillCatalog: () =>
        Promise.resolve([
          {
            id: "synthetic-owner/synthetic-skills/example",
            slug: "example",
            name: "Synthetic catalog skill",
            source: "synthetic-owner/synthetic-skills",
            installs: 42,
            installed: false,
          },
        ]),
    });
    render(
      <ResourceCenter
        locale="en"
        onConfirm={onConfirm}
        onSettingsChange={vi.fn()}
      />,
    );

    await screen.findByRole("tab", {
      name: "Synthetic marketplace · synthetic-owner/source-a",
    });
    expect(
      screen.getByRole("tab", {
        name: "Synthetic marketplace · synthetic-owner/source-b",
      }),
    ).toBeInTheDocument();
    expectLinkedTabPanels(".resource-scope-tabs");
    expect(
      screen.getByText("Synthetic manifest has no version."),
    ).toBeVisible();
    expect(screen.getByText("Hooks, Scheduled templates")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Manage installed capabilities" }),
    );
    expectLinkedTabPanels(".resource-management-tabs");
    await userEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    expect(screen.getByText("synthetic-owner/source-a")).toBeVisible();
    expect(screen.getByText("synthetic-owner/source-b")).toBeVisible();
    const source = screen.getByLabelText(
      "Public GitHub owner/repository or HTTPS URL",
    );
    fireEvent.change(source, {
      target: { value: "synthetic-owner/synthetic-marketplace" },
    });
    const form = source.closest("form");
    expect(form).not.toBeNull();
    const first = new Event("submit", { bubbles: true, cancelable: true });
    const second = new Event("submit", { bubbles: true, cancelable: true });

    act(() => {
      form!.dispatchEvent(first);
      form!.dispatchEvent(second);
    });

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    await waitFor(() => expect(inspectTrust).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(source).toBeDisabled();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    const trustMessage = String(onConfirm.mock.calls[0]?.[0]);
    expect(trustMessage).toContain("synthetic-owner/synthetic-marketplace");
    expect(trustMessage).not.toContain("Synthetic marketplace");
    await act(async () => resolveConfirm(false));
    await waitFor(() => expect(source).toBeEnabled());
    await userEvent.click(
      screen.getByRole("button", { name: "Back to plugins" }),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Skills 0" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Find Agent Skills" }),
    );
    const skillSearch = screen.getByLabelText("Search Agent Skills");
    await userEvent.type(skillSearch, "synthetic");
    await userEvent.click(
      screen.getByRole("button", { name: "Search Agent Skills" }),
    );
    expect(
      await screen.findByText("synthetic-owner/synthetic-skills"),
    ).toBeVisible();
  });
});
