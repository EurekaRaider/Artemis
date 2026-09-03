// @vitest-environment jsdom
import { renderToString } from "react-dom/server";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../src/actions.js";
import {
  MANAGEMENT_ACCESSIBLE_NAME_ERROR,
  MANAGEMENT_COMPONENT_CONTRACTS,
  ManagementCard,
  ManagementHeader,
  ManagementRow,
  ManagementSection,
  McpEditorSurface,
  ResourceSurface,
  SettingsSurface,
  validateManagementComponentContracts,
} from "../src/management.js";

describe("management surface public contract", () => {
  it("is deeply frozen and rejects exact-contract drift", () => {
    expect(Object.isFrozen(MANAGEMENT_COMPONENT_CONTRACTS)).toBe(true);
    expect(
      Object.isFrozen(MANAGEMENT_COMPONENT_CONTRACTS.settingsSurface.theme),
    ).toBe(true);
    expect(
      validateManagementComponentContracts(MANAGEMENT_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });

    const drifted = structuredClone(MANAGEMENT_COMPONENT_CONTRACTS);
    (drifted as Record<string, unknown>).credential = {};
    expect(validateManagementComponentContracts(drifted)).toEqual({
      valid: false,
      errors: ["contracts fields are not exact"],
    });
  });

  it("renders Settings anatomy while leaving navigation and effects caller-owned", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const { container } = render(
      <SettingsSurface
        busy
        header={<ManagementHeader headingLevel={2} title="Settings" />}
        label="Application settings"
        navigation={<Button onClick={select}>General</Button>}
      >
        <ManagementSection title="Provider">
          <Button>Save provider</Button>
        </ManagementSection>
      </SettingsSurface>,
    );

    await user.click(screen.getByRole("button", { name: "General" }));
    expect(select).toHaveBeenCalledOnce();
    expect(
      screen
        .getByRole("region", { name: "Application settings" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    for (const part of ["header", "body", "navigation", "content"]) {
      expect(container.querySelector(`[data-part="${part}"]`)).not.toBeNull();
    }
    expect(screen.getByRole("region", { name: "Provider" })).toBeTruthy();
  });

  it("renders Resource cards and rows without owning their actions", async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    const { container } = render(
      <ResourceSurface
        header={<ManagementHeader title="Resources" />}
        label="Resource Center"
        state="ready"
      >
        <ManagementCard tone="info">
          <span>Catalog discovery</span>
        </ManagementCard>
        <ManagementRow
          actions={
            <Button onClick={remove} variant="danger">
              Remove
            </Button>
          }
          description="Sandboxed · network disabled"
          leading={<span aria-hidden="true">M</span>}
          title="Synthetic MCP"
        />
      </ResourceSurface>,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledOnce();
    expect(
      container
        .querySelector('[data-artemis-component="management-card"]')
        ?.getAttribute("data-tone"),
    ).toBe("info");
    expect(screen.getByText("Sandboxed · network disabled")).toBeTruthy();
  });

  it("exposes MCP busy/error state without receiving credential or permission data", () => {
    const html = renderToString(
      <McpEditorSurface
        actions={<Button disabled>Save and connect</Button>}
        busy
        feedback={<span role="status">Saving</span>}
        header={<ManagementHeader title="MCP server" />}
        label="MCP server editor"
        state="error"
      >
        <ManagementCard tone="warning">Permission controls</ManagementCard>
      </McpEditorSurface>,
    );

    expect(html).toContain('data-artemis-component="mcp-editor-surface"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/bearer|api.?key|credential value/iu);
  });

  it("requires perceptible surface labels", () => {
    expect(() =>
      renderToString(
        <ResourceSurface label=" ">
          <span>Invalid</span>
        </ResourceSurface>,
      ),
    ).toThrow(MANAGEMENT_ACCESSIBLE_NAME_ERROR);
  });
});
