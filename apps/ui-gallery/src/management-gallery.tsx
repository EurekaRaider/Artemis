import { useState } from "react";

import { Button } from "@artemis/ui/actions";
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
} from "@artemis/ui/feedback";
import { Select, Switch, TextAreaField, TextField } from "@artemis/ui/forms";
import {
  ManagementCard,
  ManagementHeader,
  ManagementRow,
  ManagementSection,
  McpEditorSurface,
  ResourceSurface,
  SettingsSurface,
} from "@artemis/ui/management";
import { Tabs } from "@artemis/ui/navigation";

const SETTINGS_TABS = [
  {
    id: "management-gallery-general-tab",
    label: "General",
    panelId: "management-gallery-general-panel",
    value: "general",
  },
  {
    id: "management-gallery-provider-tab",
    label: "Providers and models",
    panelId: "management-gallery-provider-panel",
    value: "providers",
  },
] as const;

export function ManagementGallery() {
  const [settingsTab, setSettingsTab] = useState<"general" | "providers">(
    "general",
  );
  const [provider, setProvider] = useState("synthetic-provider");
  const [eventCount, setEventCount] = useState(0);
  const [networkAllowed, setNetworkAllowed] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);

  return (
    <div className="gallery-management-grid">
      <div data-gallery-management-case="anatomy">
        <SettingsSurface
          className="gallery-management-settings"
          header={<ManagementHeader headingLevel={3} title="Settings" />}
          label={`Settings · ${settingsTab}`}
          navigation={
            <Tabs
              label="Settings sections"
              onValueChange={setSettingsTab}
              orientation="vertical"
              options={SETTINGS_TABS}
              value={settingsTab}
            />
          }
        >
          {SETTINGS_TABS.map((option) => (
            <ManagementSection
              hidden={settingsTab !== option.value}
              id={option.panelId}
              key={option.value}
              labelledBy={option.id}
              role="tabpanel"
              title={option.value === "general" ? "Application" : "Provider"}
            >
              <TextField
                label={
                  option.value === "general" ? "Display name" : "Provider ID"
                }
                onValueChange={setProvider}
                value={provider}
              />
              <Select
                label={option.value === "general" ? "Theme" : "Provider model"}
                onValueChange={() => undefined}
                options={[
                  { label: "System", value: "system" },
                  { label: "Dark", value: "dark" },
                ]}
                value="system"
              />
              <TextAreaField
                label="Global instructions"
                onValueChange={() => undefined}
                rows={3}
                value="Use synthetic paths and credentials in visual fixtures."
              />
              <Button variant="primary">Save settings</Button>
            </ManagementSection>
          ))}
        </SettingsSurface>
      </div>

      <div data-gallery-management-case="state-matrix">
        <ResourceSurface
          className="gallery-management-resource"
          header={<ManagementHeader headingLevel={3} title="Resource states" />}
          label="Resource state matrix"
        >
          <ManagementCard state="loading">
            <LoadingState label="Loading resources" lines={1} />
          </ManagementCard>
          <ManagementCard state="error" tone="danger">
            <ErrorState title="Catalog unavailable">
              Try again later.
            </ErrorState>
          </ManagementCard>
          <ManagementCard state="disabled">
            <EmptyState title="No installed resources" />
          </ManagementCard>
        </ResourceSurface>
      </div>

      <div data-gallery-management-case="controlled-events">
        <ManagementSection title="Caller-owned events">
          <ManagementRow
            actions={
              <Button onClick={() => setEventCount((count) => count + 1)}>
                Run action
              </Button>
            }
            description="The public row emits intent without owning effects."
            title="Synthetic resource"
          />
          <output aria-live="polite" data-gallery-management-event-count>
            Action count: {eventCount}
          </output>
        </ManagementSection>
      </div>

      <div data-gallery-management-case="permission-boundary">
        <McpEditorSurface
          actions={<Button variant="primary">Save and connect</Button>}
          header={<ManagementHeader headingLevel={3} title="MCP server" />}
          label="MCP permission boundary"
        >
          <ManagementCard tone={fullAccess ? "danger" : "warning"}>
            <Switch
              checked={networkAllowed}
              disabled={fullAccess}
              label="Allow network access"
              onCheckedChange={setNetworkAllowed}
            />
            <Switch
              checked={fullAccess}
              label="Full local access"
              onCheckedChange={(checked) => {
                setFullAccess(checked);
                if (checked) setNetworkAllowed(true);
              }}
            />
            <InlineNotice tone={fullAccess ? "danger" : "warning"}>
              {fullAccess
                ? "Full local access disables the operating-system sandbox."
                : "The sandbox limits files to the synthetic workspace."}
            </InlineNotice>
          </ManagementCard>
        </McpEditorSurface>
      </div>

      <div dir="rtl" data-gallery-management-case="rtl-long-content">
        <ManagementSection
          description="يبقى اختيار المزود وبيانات الاعتماد وسياسة الشبكة مملوكًا للتطبيق المستهلك"
          title="إدارة الموارد مع تسمية محلية طويلة جدًا"
          tone="info"
        >
          <ManagementRow
            actions={<Button>إدارة</Button>}
            description="وصف طويل يختبر الاتجاه من اليمين إلى اليسار دون توسيع التخطيط أو إخفاء الإجراء"
            title="موصل تجريبي باسم طويل للغاية"
          />
        </ManagementSection>
      </div>
    </div>
  );
}
