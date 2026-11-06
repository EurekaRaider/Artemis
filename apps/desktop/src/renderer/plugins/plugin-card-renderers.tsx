import {
  pluginPageText,
  labels,
  GearIcon,
  TrashIcon,
} from "./resource-presentation.js";

import { COMPUTER_USE_RUNTIME_RESOURCES } from "../../shared/i18n/computer-use-resources.js";

import { localizedPluginText } from "../../shared/i18n/plugin-localization.js";
import { bundledPluginDescription } from "../../shared/i18n/bundled-plugin-copy.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import { type CSSProperties } from "react";

import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";

import { ManagementCard } from "@artemis/ui/management";

import type {
  ArtemisPluginMarketplaceSource,
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  InstalledSkill,
  McpServerStatus,
  ResourceInstallProgress,
} from "../../shared/api.js";

import { ArtemisIcon } from "@artemis/ui/icons";
import { ResourceAvatar } from "./resource-icons.js";
interface PluginCardRenderersDependencies {
  installedSkills: InstalledSkill[];
  installedPlugins: InstalledArtemisPlugin[];
  t: (typeof labels)[import("@artemis/protocol").AppLocale];
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
  officeCapabilityActive: boolean;
  mcpServers: McpServerStatus[];
  installedPluginIds: Set<string>;
  computerRuntime:
    import("@artemis/protocol").ComputerUseRuntimeStatus | undefined;
  marketplaceSourceForPlugin: (
    plugin: ArtemisPluginPreview,
  ) => ArtemisPluginMarketplaceSource | undefined;
  marketplaceSourceById: Map<string, ArtemisPluginMarketplaceSource>;
  pluginMarketplaceLabel: (plugin: ArtemisPluginPreview) => string;
  marketplaceSourceLabel: (source: ArtemisPluginMarketplaceSource) => string;
  office: {
    fitWidth: string;
    fitPage: string;
    previousPage: string;
    nextPage: string;
    grid: string;
    printPreview: string;
    cellHint: string;
    gridHint: string;
    notePlaceholder: string;
    previewDetails: string;
    invalidRange: string;
    slides: string;
    cellLimit: string;
    paragraph: string;
    object: string;
    regionSelection: string;
    runtime: string;
    manage: string;
    manageDescription: string;
    checkUpdates: string;
    checkingUpdates: string;
    updateAvailable: string;
    updateNow: string;
    upToDate: string;
    noUpdates: string;
    updatesUnavailable: string;
    checkFailed: string;
    offlineMaintenance: string;
    selectOfflinePack: string;
    offlineMaintenanceHint: string;
    installed: string;
    inactive: string;
    inUse: string;
    removeHint: string;
    offlineHint: string;
    shared: string;
    lite: string;
    unavailable: string;
    install: string;
    offline: string;
    cancel: string;
    rollback: string;
    remove: string;
    close: string;
    follow: string;
    page: string;
    zoom: string;
    sheet: string;
    selection: string;
    note: string;
    addNote: string;
    region: string;
    preview: string;
    version: string;
    loading: string;
    editing: string;
    saved: string;
    saving: string;
    opening: string;
    conflict: string;
    recovering: string;
    failed: string;
    closed: string;
    select: string;
    noPreview: string;
    range: string;
    working: string;
  };
  operationPending: boolean;
  setPluginInstallDraft: import("react").Dispatch<
    import("react").SetStateAction<ArtemisPluginPreview | undefined>
  >;
  updatePlugin: (plugin: InstalledArtemisPlugin) => Promise<void>;
  onReviewHooks:
    ((pluginId: string, trigger: HTMLButtonElement) => void) | undefined;
  busyId: string | undefined;
  installProgress: ResourceInstallProgress | undefined;
  officePackStatus: CapabilityPackStatus | undefined;
  officeUpdating: boolean;
  setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  setOfficeUpdating: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  runResourceOperation: (operation: () => Promise<void>) => void;
  officeCapabilityInstalled: boolean | undefined;
  setOfficeCapabilityOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  setConnectionPlugin: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin | undefined>
  >;
  setPluginUninstallDraft: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin | undefined>
  >;
}
export function createPluginCardRenderers({
  installedSkills,
  installedPlugins,
  t,
  locale,
  officeCapabilityActive,
  mcpServers,
  installedPluginIds,
  computerRuntime,
  marketplaceSourceForPlugin,
  marketplaceSourceById,
  pluginMarketplaceLabel,
  marketplaceSourceLabel,
  office,
  operationPending,
  setPluginInstallDraft,
  updatePlugin,
  onReviewHooks,
  busyId,
  installProgress,
  officePackStatus,
  officeUpdating,
  setMessage,
  setOfficeUpdating,
  runResourceOperation,
  officeCapabilityInstalled,
  setOfficeCapabilityOpen,
  setConnectionPlugin,
  setPluginUninstallDraft,
}: PluginCardRenderersDependencies) {
  function pluginSkillConflict(
    plugin: ArtemisPluginPreview,
  ): string | undefined {
    for (const skill of plugin.skills) {
      const installed = installedSkills.find(
        (candidate) => candidate.name === skill.name,
      );
      if (!installed) continue;
      if (
        (plugin.source.kind === "builtin" ||
          plugin.source.kind === "bundled" ||
          plugin.source.kind === "runtime") &&
        plugin.source.pluginName === skill.name
      ) {
        continue;
      }
      const owner = installedPlugins.find((candidate) =>
        candidate.skillNames.includes(skill.name),
      );
      return `${t.skillConflict}: ${pluginPageText(skill.name)} · ${pluginPageText(
        owner ? pluginDisplayName(owner) : t.skills,
      )}`;
    }
    return undefined;
  }

  function pluginDisplayName(plugin: ArtemisPluginPreview): string {
    return pluginPageText(localizedPluginText(plugin, locale).displayName);
  }

  function pluginDescription(plugin: ArtemisPluginPreview): string {
    const copy = localizedPluginText(plugin, locale);
    if (
      plugin.source.kind === "builtin" ||
      plugin.source.kind === "bundled" ||
      plugin.source.kind === "runtime"
    ) {
      const translated = bundledPluginDescription(
        locale,
        plugin.source.pluginName,
        officeCapabilityActive,
      );
      if (translated) return translated;
    }
    const translated = plugin.localizations?.[locale];
    if (translated?.shortDescription || translated?.description) {
      return pluginPageText(
        translated.shortDescription || translated.description!,
      );
    }
    return pluginPageText(
      copy.shortDescription || copy.description || plugin.name,
    );
  }

  function pluginHasConnection(plugin: InstalledArtemisPlugin): boolean {
    return mcpServers.some(
      (server) =>
        server.config.connector &&
        plugin.mcpServerIds.includes(server.config.id),
    );
  }

  function renderPluginCard(plugin: ArtemisPluginPreview, sourceId?: string) {
    const installed = installedPluginIds.has(plugin.id);
    const installedPlugin = installedPlugins.find(
      (candidate) => candidate.id === plugin.id,
    );
    const computer =
      plugin.source.kind === "builtin" &&
      plugin.source.pluginName === "computer-use";
    const runtimeCopy = COMPUTER_USE_RUNTIME_RESOURCES[locale];
    const computerWorking = Boolean(
      computerRuntime && computerRuntime.phase !== "idle",
    );
    const installedVersion = computer
      ? computerRuntime?.activeVersion
      : installedPlugin?.version;
    const displayVersion =
      installedVersion ??
      (!installed && !computer ? plugin.version : undefined);
    const conflict = installed ? undefined : pluginSkillConflict(plugin);
    const displayName = pluginDisplayName(plugin);
    const description = pluginDescription(plugin);
    const hasOfficeCapability = plugin.capabilityDependencies?.some(
      (dependency) => dependency.id === "office-core",
    );
    const source =
      plugin.source.kind === "builtin" ||
      plugin.source.kind === "bundled" ||
      plugin.source.kind === "runtime"
        ? undefined
        : sourceId
          ? marketplaceSourceById.get(sourceId)
          : marketplaceSourceForPlugin(plugin);
    const sourceLabel = source
      ? marketplaceSourceLabel(source)
      : pluginMarketplaceLabel(plugin);
    const diagnostic = conflict
      ? conflict
      : plugin.installable
        ? plugin.warnings.join(" · ")
        : plugin.unsupported.join(", ");
    return (
      <ManagementCard className="plugin-market-card" key={plugin.id}>
        <div className="plugin-market-card-heading">
          {computer ? (
            <span
              className="resource-avatar"
              data-plugin="true"
              data-icon="monitor"
              style={{ "--resource-plugin-hue": 225 } as CSSProperties}
            >
              <ArtemisIcon name="monitor" />
            </span>
          ) : (
            <ResourceAvatar
              brandColor={plugin.brandColor}
              iconDataUrl={plugin.iconDataUrl}
              iconKey={plugin.hasHooks ? "hook-plugin" : undefined}
              kind="plugin"
              name={plugin.name}
            />
          )}
          <div className="plugin-market-card-titles">
            <strong
              title={`${displayName}${displayVersion ? ` v${displayVersion}` : ""}`}
            >
              {displayName}
            </strong>
            {displayVersion && (
              <span className="plugin-market-card-vn">v{displayVersion}</span>
            )}
          </div>
        </div>
        <div className="plugin-market-copy">
          <small title={description}>{description}</small>
          {Boolean(plugin.skins?.length) && (
            <small>
              <ArtemisIcon name="palette" />{" "}
              {uiText(locale, "Appearance.visualSkin")}: {plugin.skins!.length}
            </small>
          )}
          {computer && computerRuntime && (
            <>
              {!computerRuntime.supported && (
                <small>{runtimeCopy.supported}</small>
              )}
              {computerRuntime.pendingVersion && (
                <small>
                  {runtimeCopy.waiting.replace(
                    "{version}",
                    computerRuntime.pendingVersion,
                  )}
                </small>
              )}
              {computerRuntime.migrationRequired && (
                <small>{runtimeCopy.migration}</small>
              )}
              {(computerRuntime.error || computerRuntime.updateError) && (
                <InlineNotice tone="warning">
                  {computerRuntime.error || computerRuntime.updateError}
                </InlineNotice>
              )}
              {computerWorking && (
                <progress
                  aria-label={office.working}
                  max={computerRuntime.totalBytes || 1}
                  value={computerRuntime.downloadedBytes}
                />
              )}
            </>
          )}
          {diagnostic && (
            <InlineNotice className="plugin-market-diagnostic" tone="warning">
              {pluginPageText(diagnostic)}
            </InlineNotice>
          )}
        </div>
        <div className="plugin-market-card-footer">
          <span className="plugin-permission-tags">
            {plugin.mcpServers.length > 0 && (
              <span>
                <ArtemisIcon name="mcp" />
                {t.mcp} {plugin.mcpServers.length}
              </span>
            )}
            {plugin.skills.length > 0 && (
              <span>
                <ArtemisIcon name="skill" />
                {t.skills} {plugin.skills.length}
              </span>
            )}
            {plugin.hasHooks && (
              <span>
                <ArtemisIcon name="hooks" />
                {uiText(locale, "Hooks.title")}
              </span>
            )}
          </span>
          <details
            className="plugin-market-card-actions"
            data-office={hasOfficeCapability || undefined}
            data-computer={computer || undefined}
            data-installed={installed}
            open={installed ? undefined : true}
          >
            <summary>
              <ArtemisIcon name="check" width={14} height={14} />
              {t.installed}
            </summary>
            <div className="plugin-card-menu-body">
              {computer &&
                installed &&
                computerRuntime &&
                (computerRuntime.updateVersion ||
                  computerRuntime.migrationRequired ||
                  computerRuntime.pendingVersion ||
                  computerWorking) && (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={
                      operationPending ||
                      computerWorking ||
                      (Boolean(computerRuntime.pendingVersion) &&
                        !computerRuntime.error) ||
                      !computerRuntime.supported
                    }
                    onClick={() =>
                      installedPlugin
                        ? void updatePlugin(installedPlugin)
                        : setPluginInstallDraft(plugin)
                    }
                  >
                    {computerWorking
                      ? office.working
                      : computerRuntime.error
                        ? uiText(locale, "App_copy.queueRetry")
                        : computerRuntime.pendingVersion
                          ? runtimeCopy.ready
                          : computerRuntime.migrationRequired
                            ? runtimeCopy.install
                            : office.updateNow.replace(
                                "{version}",
                                computerRuntime.updateVersion!,
                              )}
                  </Button>
                )}
              {computer && computerRuntime?.phase === "downloading" && (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => {
                    void window.artemis.cancelComputerRuntimeDownload();
                  }}
                >
                  {t.cancel}
                </Button>
              )}
              {installed && plugin.hasHooks && onReviewHooks && (
                <Button
                  variant="quiet"
                  size="compact"
                  icon={<ArtemisIcon name="hooks" />}
                  onClick={(event) =>
                    onReviewHooks(plugin.id, event.currentTarget)
                  }
                >
                  {uiText(locale, "Hooks.title")}
                </Button>
              )}
              {installed && installedPlugin ? (
                <>
                  {hasOfficeCapability &&
                    (officePackStatus?.updateVersion || officeUpdating) && (
                      <>
                        {officeUpdating && (
                          <progress
                            aria-label={office.working}
                            max={officePackStatus?.totalBytes || 1}
                            value={officePackStatus?.downloadedBytes}
                            style={{ width: 100 }}
                          />
                        )}
                        <Button
                          className="plugin-market-update-action"
                          variant="secondary"
                          size="compact"
                          disabled={
                            operationPending ||
                            Boolean(
                              officePackStatus &&
                              officePackStatus.phase !== "idle",
                            )
                          }
                          onClick={() =>
                            runResourceOperation(async () => {
                              setMessage(undefined);
                              setOfficeUpdating(true);
                              try {
                                await window.artemis.installOfficeCapability();
                              } finally {
                                setOfficeUpdating(false);
                              }
                            })
                          }
                        >
                          {officeUpdating
                            ? office.working
                            : office.updateNow.replace(
                                "{version}",
                                officePackStatus!.updateVersion!,
                              )}
                        </Button>
                      </>
                    )}
                  {hasOfficeCapability ? (
                    <Button
                      className="plugin-market-configure-action"
                      disabled={officeUpdating}
                      icon={
                        <ArtemisIcon
                          name={
                            officeCapabilityInstalled === false
                              ? "push"
                              : "gear"
                          }
                        />
                      }
                      variant="secondary"
                      title={
                        officeCapabilityInstalled === false
                          ? office.shared
                          : office.manageDescription
                      }
                      onClick={() => setOfficeCapabilityOpen(true)}
                    >
                      {officeCapabilityInstalled === false
                        ? office.runtime
                        : office.manage}
                    </Button>
                  ) : null}
                  {pluginHasConnection(installedPlugin) && (
                    <Button
                      className="plugin-market-configure-action"
                      icon={<GearIcon />}
                      variant="secondary"
                      disabled={operationPending || busyId === plugin.id}
                      onClick={() => setConnectionPlugin(installedPlugin)}
                    >
                      {t.configure}
                    </Button>
                  )}
                  <Button
                    className="management-destructive-action plugin-market-remove-action"
                    icon={<TrashIcon />}
                    disabled={operationPending || busyId === plugin.id}
                    onClick={() => setPluginUninstallDraft(installedPlugin)}
                    variant="secondary"
                  >
                    {t.remove}
                  </Button>
                </>
              ) : (
                <Button
                  className="resource-inline-action"
                  variant="secondary"
                  disabled={
                    operationPending ||
                    !plugin.installable ||
                    (computer && computerRuntime?.supported === false) ||
                    (computer && computerWorking) ||
                    Boolean(conflict) ||
                    busyId === plugin.id ||
                    installProgress !== undefined
                  }
                  onClick={() => setPluginInstallDraft(plugin)}
                  title={
                    diagnostic ||
                    (plugin.installable ? t.install : t.needsSetup)
                  }
                >
                  {conflict
                    ? t.skillConflict
                    : plugin.installable
                      ? t.install
                      : t.needsSetup}
                </Button>
              )}
            </div>
          </details>
        </div>
      </ManagementCard>
    );
  }
  return {
    pluginSkillConflict,
    pluginDisplayName,
    pluginDescription,
    pluginHasConnection,
    renderPluginCard,
  };
}
