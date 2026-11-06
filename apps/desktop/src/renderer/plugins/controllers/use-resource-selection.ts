import {
  type McpInstallDraft,
  type ManagementTab,
  type CatalogSearchTab,
  type CatalogSearchPhase,
  type ResourceRemovalDraft,
} from "../resource-types.js";

import { useState } from "react";

import type { CapabilityPackStatus } from "@artemis/protocol";

import type {
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  McpCatalogItem,
  McpServerStatus,
} from "../../../shared/api.js";

interface UseResourceSelectionContext {
  readonly settings:
    import("../../../shared/api.js").SettingsSnapshot | undefined;
}
export function useResourceSelection(context: UseResourceSelectionContext) {
  const { settings } = context;
  const [mode, setMode] = useState<
    "marketplace" | "manage" | "add-plugin" | "mcp-editor"
  >("marketplace");
  const [connectionPlugin, setConnectionPlugin] =
    useState<InstalledArtemisPlugin>();
  const [managementTab, setManagementTab] = useState<ManagementTab>("plugins");
  const [draggingMarketplaceId, setDraggingMarketplaceId] = useState<
    string | undefined
  >(undefined);
  const [addPluginReturnMode, setAddPluginReturnMode] = useState<
    "marketplace" | "manage"
  >("marketplace");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [allMarkets, setAllMarkets] = useState(true);
  const [managementQuery, setManagementQuery] = useState("");
  const [sourceInput, setSourceInput] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingMcpServer, setEditingMcpServer] = useState<McpServerStatus>();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [mcpResults, setMcpResults] = useState<McpCatalogItem[]>([]);
  const [catalogSearchPhase, setCatalogSearchPhase] = useState<
    Record<CatalogSearchTab, CatalogSearchPhase>
  >({ mcp: "idle", skills: "idle" });
  const [mcpInstallDraft, setMcpInstallDraft] = useState<McpInstallDraft>();
  const [pluginInstallDraft, setPluginInstallDraft] =
    useState<ArtemisPluginPreview>();
  const [officePackStatus, setOfficePackStatus] =
    useState<CapabilityPackStatus>();
  const [computerRuntime, setComputerRuntime] =
    useState<import("@artemis/protocol").ComputerUseRuntimeStatus>();
  const [officeUpdating, setOfficeUpdating] = useState(false);
  const [officeCapabilityActive, setOfficeCapabilityActive] = useState(false);
  const [officeCapabilityOpen, setOfficeCapabilityOpen] = useState(false);
  const [officeCapabilityInstalled, setOfficeCapabilityInstalled] =
    useState<boolean>();
  // 设计插件卡（随应用提供的插件，todo ⑤→④）：状态轮询 + 管理弹窗。
  const [designPackStatus, setDesignPackStatus] =
    useState<CapabilityPackStatus>();
  const designPackInstalled = Boolean(designPackStatus?.versions.length);
  const [designPackOpen, setDesignPackOpen] = useState(false);
  const [pluginUninstallDraft, setPluginUninstallDraft] =
    useState<InstalledArtemisPlugin>();
  const [resourceRemovalDraft, setResourceRemovalDraft] =
    useState<ResourceRemovalDraft>();
  const [mcpServers, setMcpServers] = useState(settings?.mcpServers ?? []);
  return {
    mode,
    setMode,
    connectionPlugin,
    setConnectionPlugin,
    managementTab,
    setManagementTab,
    draggingMarketplaceId,
    setDraggingMarketplaceId,
    addPluginReturnMode,
    setAddPluginReturnMode,
    marketplaceQuery,
    setMarketplaceQuery,
    allMarkets,
    setAllMarkets,
    managementQuery,
    setManagementQuery,
    sourceInput,
    setSourceInput,
    catalogQuery,
    setCatalogQuery,
    editingMcpServer,
    setEditingMcpServer,
    discoveryOpen,
    setDiscoveryOpen,
    mcpResults,
    setMcpResults,
    catalogSearchPhase,
    setCatalogSearchPhase,
    mcpInstallDraft,
    setMcpInstallDraft,
    pluginInstallDraft,
    setPluginInstallDraft,
    officePackStatus,
    setOfficePackStatus,
    computerRuntime,
    setComputerRuntime,
    officeUpdating,
    setOfficeUpdating,
    officeCapabilityActive,
    setOfficeCapabilityActive,
    officeCapabilityOpen,
    setOfficeCapabilityOpen,
    officeCapabilityInstalled,
    setOfficeCapabilityInstalled,
    designPackStatus,
    setDesignPackStatus,
    designPackInstalled,
    designPackOpen,
    setDesignPackOpen,
    pluginUninstallDraft,
    setPluginUninstallDraft,
    resourceRemovalDraft,
    setResourceRemovalDraft,
    mcpServers,
    setMcpServers,
  };
}
