// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../../../src/renderer/plugins/ResourceCenter.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists capability packs without plugin receipts, including inactive packs, and refreshes after removal", async () => {
  let officeInstalled = true;
  let officeActive = true;
  let designActive = false;
  const deactivateOffice = vi.fn(async () => {
    officeActive = false;
  });
  const activateOffice = vi.fn(async () => {
    officeActive = true;
  });
  const activateDesign = vi.fn(async () => {
    designActive = true;
  });
  const deactivateDesign = vi.fn(async () => {
    designActive = false;
  });
  const status = (id: string, installed: boolean, active: boolean) => ({
    id,
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: 0,
    dependents: [],
    activeVersion: installed && active ? "1.0.0" : undefined,
    versions: installed
      ? [{ version: "1.0.0", bytes: 10, active, inUse: false }]
      : [],
  });
  stubWindowArtemis({
    listMcpServers: async () => [],
    listArtemisPlugins: async () => [],
    listInstalledSkills: async () => [],
    getArtemisPluginMarketplaces: async () => ({
      selectedView: "bundled",
      sources: [],
      marketplaces: [],
      errors: [],
    }),
    loadBundledPluginMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    officeCapabilityStatus: async () =>
      status("office-core", officeInstalled, officeActive),
    designCapabilityStatus: async () =>
      status("artemis-design", true, designActive),
    deactivateOfficeCapability: deactivateOffice,
    activateOfficeCapability: activateOffice,
    activateDesignCapability: activateDesign,
    deactivateDesignCapability: deactivateDesign,
    uninstallOfficeCapability: async () => {
      officeInstalled = false;
    },
  });
  render(
    <ResourceCenter
      locale="en"
      onConfirm={async () => true}
      onSettingsChange={() => {}}
    />,
  );
  const overview = within(
    document.querySelector(".resource-installed-overview") as HTMLElement,
  );
  expect(await overview.findByText("Office")).toBeVisible();
  expect(await overview.findByText("Design")).toBeVisible();
  expect(overview.getByText("Enabled")).toBeVisible();
  expect(overview.getByText("Disabled")).toBeVisible();
  const officeToggle = overview.getByRole("switch", {
    name: "Enabled: Office",
  });
  const designToggle = overview.getByRole("switch", {
    name: "Enabled: Design",
  });
  expect(officeToggle).toBeChecked();
  expect(designToggle).not.toBeChecked();
  fireEvent.click(officeToggle);
  expect(overview.getByText("Disabling…")).toBeVisible();
  expect(officeToggle).toBeChecked();
  await waitFor(() => expect(officeToggle).not.toBeChecked());
  expect(deactivateOffice).toHaveBeenCalledOnce();
  expect(overview.getByText("Office")).toBeVisible();
  fireEvent.click(officeToggle);
  expect(overview.getByText("Enabling…")).toBeVisible();
  expect(officeToggle).not.toBeChecked();
  await waitFor(() => expect(officeToggle).toBeChecked());
  expect(activateOffice).toHaveBeenCalledWith("1.0.0");
  fireEvent.click(designToggle);
  await waitFor(() => expect(designToggle).toBeChecked());
  expect(activateDesign).toHaveBeenCalledWith("1.0.0");
  deactivateDesign.mockRejectedValueOnce(
    new Error("Capability version is in use"),
  );
  fireEvent.click(designToggle);
  expect(await screen.findByText("Capability version is in use")).toBeVisible();
  expect(designToggle).toBeChecked();
  fireEvent.click(designToggle);
  await waitFor(() => expect(designToggle).not.toBeChecked());
  fireEvent.click(overview.getByRole("button", { name: "Configure Design" }));
  const designDialog = await screen.findByRole("dialog", {
    name: "Manage the design plugin",
  });
  fireEvent.click(
    within(designDialog).getByRole("button", { name: "Close", exact: true }),
  );
  fireEvent.click(
    overview.getByRole("button", { name: "Manage installed capabilities" }),
  );
  expect(await screen.findByRole("tab", { name: "Plugins" })).toBeVisible();
  const list = within(
    document.querySelector(".resource-management-list") as HTMLElement,
  );
  expect(list.getByText("Office")).toBeVisible();
  expect(list.getByText("Design")).toBeVisible();
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "design" } });
  expect(list.queryByText("Office")).toBeNull();
  expect(list.getByText("Design")).toBeVisible();
  fireEvent.change(search, { target: { value: "office" } });
  fireEvent.click(list.getByRole("button", { name: "Configure Office" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Remove", exact: true }),
  );
  await waitFor(() => expect(officeInstalled).toBe(false));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close", exact: true }),
  );
  await waitFor(() => expect(list.queryByText("Office")).toBeNull());
  expect(screen.getByRole("tab", { name: "Plugins" })).toBeVisible();
});
