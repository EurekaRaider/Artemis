import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { Button } from "@artemis/ui/actions";
import { TextAreaField } from "@artemis/ui/forms";
import {
  MANAGEMENT_COMPONENT_CONTRACTS,
  ManagementCard,
  ManagementHeader,
  ManagementRow,
  ManagementSection,
  McpEditorSurface,
  ResourceSurface,
  SettingsSurface,
} from "@artemis/ui/management";
import { managementSource, uiCss } from "./shared.js";

export const managementCases = {
  "management-anatomy"() {
    const { container } = render(
      <>
        <SettingsSurface
          header={<ManagementHeader title="Settings" />}
          label="Settings"
          navigation={<span>Navigation</span>}
        >
          <ManagementSection title="Provider">
            <TextAreaField
              label="Instructions"
              onValueChange={() => undefined}
              value="Synthetic"
            />
          </ManagementSection>
        </SettingsSurface>
        <ResourceSurface label="Resources">
          <ManagementCard>Catalog</ManagementCard>
          <ManagementRow description="Disabled" title="Synthetic MCP" />
        </ResourceSurface>
        <McpEditorSurface
          actions={<Button>Save</Button>}
          header={<ManagementHeader title="MCP" />}
          label="MCP editor"
        >
          Editor
        </McpEditorSurface>
      </>,
    );
    for (const contract of Object.values(MANAGEMENT_COMPONENT_CONTRACTS)) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
    expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Resources" })).toBeTruthy();
  },
  "management-state-matrix"() {
    const { container } = render(
      <ResourceSurface busy label="Resource states" state="loading">
        <ManagementCard state="loading">Loading</ManagementCard>
        <ManagementCard state="error" tone="danger">
          Failed
        </ManagementCard>
        <ManagementSection state="disabled" title="Unavailable">
          Disabled
        </ManagementSection>
        <ManagementRow state="busy" title="Installing" />
      </ResourceSurface>,
    );
    for (const state of ["loading", "error", "disabled", "busy"]) {
      expect(container.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Resource states" })
        .getAttribute("aria-busy"),
    ).toBe("true");
  },
  async "management-controlled-events"() {
    const action = vi.fn();
    render(
      <ManagementSection title="Caller effects">
        <ManagementRow
          actions={<Button onClick={action}>Install</Button>}
          title="Synthetic resource"
        />
      </ManagementSection>,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Install" }));
    expect(action).toHaveBeenCalledOnce();
  },
  "management-permission-boundary"() {
    expect(managementSource).not.toMatch(/window\.artemis|electron|node:/u);
    expect(managementSource).toContain(
      "caller-owns-provider-credential-connector-and-mcp-effects",
    );
    expect(managementSource).toContain(
      "caller-owns-sandbox-network-and-full-access-policy",
    );
    expect(managementSource).toContain(
      "credentials-never-become-presentational-props",
    );
  },
  "management-rtl-long-content"() {
    const { container } = render(
      <div dir="rtl">
        <ManagementSection
          description="يبقى اختيار المزود والسياسة لدى التطبيق المستهلك"
          title="إدارة الموارد مع تسمية محلية طويلة جدًا"
        >
          <ManagementRow
            actions={<Button>إدارة</Button>}
            description="وصف طويل يختبر التخطيط المنطقي"
            title="موصل تجريبي باسم طويل للغاية"
          />
        </ManagementSection>
      </div>,
    );
    for (const root of container.querySelectorAll("[data-artemis-component]")) {
      expect(root.closest('[dir="rtl"]')).not.toBeNull();
    }
    expect(uiCss).toContain("margin-inline");
    expect(uiCss).toContain("border-inline-end");
  },
};
