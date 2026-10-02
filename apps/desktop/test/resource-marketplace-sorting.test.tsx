// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtemisPluginMarketplaceState } from "../src/shared/api.js";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

async function setup() {
  const user = userEvent.setup();
  const state: ArtemisPluginMarketplaceState = {
    selectedView: "built-in",
    sources: ["built-in", "first", "second", "third"].map((id, order) => ({
      id,
      url: `https://github.com/example/${id}.git`,
      repository: `example/${id}`,
      marketplaceName: id,
      displayName: id,
      builtIn: order === 0,
      removable: order !== 0,
      offline: false,
      refreshable: order !== 0,
      order,
    })),
    marketplaces: [],
    errors: [],
  };
  const reorder = vi.fn(async (ids: string[]) => ({
    ...state,
    sources: [
      state.sources[0]!,
      ...ids.map((id) => state.sources.find((source) => source.id === id)!),
    ],
  }));
  stubWindowArtemis({
    getArtemisPluginMarketplaces: async () => state,
    reorderArtemisPluginMarketplaces: reorder,
    listArtemisPlugins: async () => [],
    listInstalledSkills: async () => [],
    listMcpServers: async () => [],
    loadBundledPluginMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
  });
  await act(async () => {
    render(
      <ResourceCenter
        locale="en"
        onConfirm={vi.fn(async () => true)}
        onSettingsChange={vi.fn()}
      />,
    );
  });
  return { user, state, reorder };
}

function row(id: string) {
  return screen.getByText(`example/${id}`).closest("article")!;
}

describe("marketplace source ordering", () => {
  it("keeps keyboard sorting available alongside dragging", async () => {
    const { user, reorder } = await setup();
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    const moveUp = screen.getByRole("button", {
      name: "Move marketplace up: second",
    });
    moveUp.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(reorder).toHaveBeenCalledWith(["second", "first", "third"]),
    );
    expect(moveUp).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move marketplace down: third" }),
    ).toBeDisabled();
  });

  it("moves a dragged source to its destination and excludes the built-in source", async () => {
    const { user, reorder } = await setup();
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(row("first"), { dataTransfer });
    expect(row("first")).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(row("third"), { dataTransfer });
    await waitFor(() =>
      expect(reorder).toHaveBeenCalledWith(["second", "third", "first"]),
    );
    expect(row("first")).not.toHaveAttribute("data-dragging");
    expect(
      [...document.querySelectorAll(".resource-marketplace-source-row")].map(
        (element) =>
          element.querySelector('[data-part="description"]')?.textContent,
      ),
    ).toEqual(["example/second", "example/third", "example/first"]);
  });

  it("rejects another drop while an ordering operation is pending", async () => {
    const { user, state, reorder } = await setup();
    let finish!: (value: ArtemisPluginMarketplaceState) => void;
    reorder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.drop(row("third"), {
      dataTransfer: { getData: () => "first" },
    });
    expect(row("second")).toHaveAttribute("draggable", "false");
    fireEvent.drop(row("first"), {
      dataTransfer: { getData: () => "second" },
    });
    expect(reorder).toHaveBeenCalledTimes(1);
    await act(async () => finish(state));
  });

  it("returns to the marketplace or management entry that opened the add page", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    await user.click(
      screen.getByRole("button", { name: "Back to marketplace" }),
    );
    expect(
      screen.getByRole("button", { name: "Add", exact: true }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Manage installed capabilities" }),
    );
    await user.click(screen.getByRole("button", { name: "Add plugin" }));
    await user.click(screen.getByRole("button", { name: "Back to plugins" }));
    expect(screen.getByRole("button", { name: "Add plugin" })).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "Plugins", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
