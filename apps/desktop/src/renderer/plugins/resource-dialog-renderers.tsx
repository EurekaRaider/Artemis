import { type ResourceRemovalDraft } from "./resource-types.js";

import { PluginConnectionDialog } from "./PluginConnectionDialog.js";

import { OfficeCapabilityPanel } from "../office/OfficeCapabilityPanel.js";
import { DesignCapabilityPanel } from "../design/DesignCapabilityPanel.js";

import { PluginUninstallDialog } from "./PluginUninstallDialog.js";
import { ResourceRemovalDialog } from "./ResourceRemovalDialog.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import type {
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  InstalledSkill,
  McpServerStatus,
  SettingsSnapshot,
} from "../../shared/api.js";

import { ResourceAvatar } from "./resource-icons.js";
interface ResourceDialogRenderersDependencies {
  pluginUninstallDraft: InstalledArtemisPlugin | undefined;
  pluginDisplayName: (plugin: ArtemisPluginPreview) => string;
  locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  setPluginUninstallDraft: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin | undefined>
  >;
  removePlugin: (plugin: InstalledArtemisPlugin) => Promise<void>;
  runResourceOperation: (operation: () => Promise<void>) => void;
  resourceRemovalDraft: ResourceRemovalDraft | undefined;
  visualForSkill: (skill: InstalledSkill) => {
    brandColor: string | undefined;
    iconDataUrl: string | undefined;
    pluginName: string | undefined;
    iconKey:
      | "agent"
      | "agents"
      | "book"
      | "browser"
      | "bug"
      | "calendar"
      | "chart"
      | "chat"
      | "checklist"
      | "cloud"
      | "code"
      | "code-review"
      | "codegraph"
      | "connector"
      | "database"
      | "document"
      | "edit"
      | "email"
      | "figma"
      | "file-search"
      | "filesystem"
      | "folder"
      | "git-branch"
      | "github"
      | "hook-plugin"
      | "image"
      | "lightbulb"
      | "lightning"
      | "mcp"
      | "monitor"
      | "package"
      | "palette"
      | "pdf"
      | "plugin"
      | "presentation"
      | "review"
      | "rocket"
      | "search"
      | "server"
      | "shield"
      | "skill"
      | "skill-authoring"
      | "skill-search"
      | "slack"
      | "spreadsheet"
      | "target"
      | "terminal"
      | "test"
      | "toolbox"
      | "translate"
      | "verify"
      | "video"
      | "wand"
      | "web-video";
  };
  visualForMcp: (server: McpServerStatus) => {
    brandColor: string | undefined;
    iconDataUrl: string | undefined;
    pluginName: string | undefined;
    iconKey:
      | "agent"
      | "agents"
      | "book"
      | "browser"
      | "bug"
      | "calendar"
      | "chart"
      | "chat"
      | "checklist"
      | "cloud"
      | "code"
      | "code-review"
      | "codegraph"
      | "connector"
      | "database"
      | "document"
      | "edit"
      | "email"
      | "figma"
      | "file-search"
      | "filesystem"
      | "folder"
      | "git-branch"
      | "github"
      | "hook-plugin"
      | "image"
      | "lightbulb"
      | "lightning"
      | "mcp"
      | "monitor"
      | "package"
      | "palette"
      | "pdf"
      | "plugin"
      | "presentation"
      | "review"
      | "rocket"
      | "search"
      | "server"
      | "shield"
      | "skill"
      | "skill-authoring"
      | "skill-search"
      | "slack"
      | "spreadsheet"
      | "target"
      | "terminal"
      | "test"
      | "toolbox"
      | "translate"
      | "verify"
      | "video"
      | "wand"
      | "web-video";
  };
  setResourceRemovalDraft: import("react").Dispatch<
    import("react").SetStateAction<ResourceRemovalDraft | undefined>
  >;
  removeSkill: (skill: InstalledSkill) => Promise<void>;
  removeMcp: (serverId: string) => Promise<void>;
  setDesignPackOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  designPackOpen: boolean;
  officeCapabilityInstalled: boolean | undefined;
  setOfficeCapabilityInstalled: import("react").Dispatch<
    import("react").SetStateAction<boolean | undefined>
  >;
  setOfficeCapabilityOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  officeCapabilityOpen: boolean;
  connectionPlugin: InstalledArtemisPlugin | undefined;
  setConnectionPlugin: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin | undefined>
  >;
  setMcpServers: import("react").Dispatch<
    import("react").SetStateAction<McpServerStatus[]>
  >;
  onSettingsChange: (settings: SettingsSnapshot) => void;
}
export function createResourceDialogRenderers({
  pluginUninstallDraft,
  pluginDisplayName,
  locale,
  setPluginUninstallDraft,
  removePlugin,
  runResourceOperation,
  resourceRemovalDraft,
  visualForSkill,
  visualForMcp,
  setResourceRemovalDraft,
  removeSkill,
  removeMcp,
  setDesignPackOpen,
  designPackOpen,
  officeCapabilityInstalled,
  setOfficeCapabilityInstalled,
  setOfficeCapabilityOpen,
  officeCapabilityOpen,
  connectionPlugin,
  setConnectionPlugin,
  setMcpServers,
  onSettingsChange,
}: ResourceDialogRenderersDependencies) {
  function renderPluginUninstall() {
    return pluginUninstallDraft ? (
      <PluginUninstallDialog
        plugin={pluginUninstallDraft}
        displayName={pluginDisplayName(pluginUninstallDraft)}
        locale={locale}
        onCancel={() => setPluginUninstallDraft(undefined)}
        onUninstall={() => {
          setPluginUninstallDraft(undefined);
          runResourceOperation(() => removePlugin(pluginUninstallDraft));
        }}
      />
    ) : null;
  }

  function renderResourceRemoval() {
    if (!resourceRemovalDraft) return null;
    const draft = resourceRemovalDraft;
    const name =
      draft.kind === "mcp" ? draft.server.config.name : draft.skill.name;
    const visual =
      draft.kind === "mcp"
        ? visualForMcp(draft.server)
        : visualForSkill(draft.skill);
    return (
      <ResourceRemovalDialog
        avatar={<ResourceAvatar {...visual} kind={draft.kind} name={name} />}
        kind={draft.kind}
        name={name}
        locale={locale}
        onCancel={() => setResourceRemovalDraft(undefined)}
        onRemove={() => {
          setResourceRemovalDraft(undefined);
          runResourceOperation(() =>
            draft.kind === "mcp"
              ? removeMcp(draft.server.config.id)
              : removeSkill(draft.skill),
          );
        }}
      />
    );
  }

  function renderPluginConnection() {
    if (designPackOpen)
      return (
        <DesignCapabilityPanel
          locale={locale}
          onClose={() => setDesignPackOpen(false)}
        />
      );
    if (officeCapabilityOpen)
      return (
        <OfficeCapabilityPanel
          locale={locale}
          installed={officeCapabilityInstalled !== false}
          onInstalledChange={setOfficeCapabilityInstalled}
          onClose={() => setOfficeCapabilityOpen(false)}
        />
      );
    return connectionPlugin ? (
      <PluginConnectionDialog
        key={connectionPlugin.id}
        plugin={connectionPlugin}
        locale={locale}
        closeLabel={uiText(locale, "App_copy.renameClose")}
        onClose={() => setConnectionPlugin(undefined)}
        onChanged={async () => {
          const next = await window.artemis.getSettings();
          setMcpServers(next.mcpServers);
          onSettingsChange(next);
        }}
      />
    ) : null;
  }
  return {
    renderPluginUninstall,
    renderResourceRemoval,
    renderPluginConnection,
  };
}
