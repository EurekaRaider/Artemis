import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementHeader } from "@artemis/ui/management";
import type { CodexPluginPreview } from "../shared/api.js";
import { UI_COPY } from "../shared/ui-copy.js";
import { uiText } from "../shared/ui-text.js";
import { ResourceAvatar } from "./resource-icons.js";

export function PluginInstallDialog({
  plugin,
  displayName,
  locale,
  onCancel,
  onInstall,
}: {
  plugin: CodexPluginPreview;
  displayName: string;
  locale: AppLocale;
  onCancel(): void;
  onInstall(): void;
}) {
  const t = UI_COPY.ResourceCenter_labels[locale];
  const title = uiText(locale, "ResourceCenter_labels.installPluginTitle", {
    name: displayName,
  });
  const servers = plugin.mcpServers.filter((server) => server.importable);
  const capabilities = [
    {
      icon: "skill",
      label: t.skills,
      count: plugin.skills.length,
      enabled: true,
    },
    {
      icon: "mcp",
      label: t.mcp,
      count: servers.filter((server) => !server.connector).length,
      enabled: false,
    },
    {
      icon: "connector",
      label: t.appsCount,
      count: servers.filter((server) => server.connector).length,
      enabled: false,
    },
  ] as const;

  return (
    <Dialog
      className="plugin-install-dialog"
      label={title}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open
      role="alertdialog"
    >
      <ManagementHeader
        actions={
          <IconButton
            icon={<ArtemisIcon name="close" />}
            label={uiText(locale, "App_copy.renameClose")}
            onClick={onCancel}
            variant="quiet"
          />
        }
        className="plugin-dialog-header"
        headingLevel={2}
        leading={
          <ResourceAvatar
            brandColor={plugin.brandColor}
            iconDataUrl={plugin.iconDataUrl}
            kind="plugin"
            name={plugin.name}
          />
        }
        title={title}
      />
      <p className="plugin-install-description">
        {uiText(locale, "ResourceCenter_labels.installDescription")}
      </p>
      <ul className="plugin-install-capabilities">
        {capabilities
          .filter((capability) => capability.count > 0)
          .map((capability) => (
            <li key={capability.icon} data-kind={capability.icon}>
              <ArtemisIcon name={capability.icon} />
              <span>{capability.label}</span>
              <span className="plugin-install-count">
                {new Intl.NumberFormat(locale).format(capability.count)}
              </span>
              <span className="plugin-install-default">
                {uiText(
                  locale,
                  capability.enabled
                    ? "ResourceCenter_labels.enabledAfterInstall"
                    : "ResourceCenter_labels.disabledAfterInstall",
                )}
              </span>
            </li>
          ))}
      </ul>
      <p className="plugin-install-hint">
        {uiText(locale, "ResourceCenter_labels.disabledInstallHint")}
      </p>
      {plugin.unsupported.length > 0 && (
        <InlineNotice tone="warning">
          {t.unsupported}: {plugin.unsupported.join(", ")}
        </InlineNotice>
      )}
      <div className="plugin-dialog-footer">
        <Button
          className="plugin-dialog-cancel"
          onClick={onCancel}
          variant="quiet"
        >
          {t.cancel}
        </Button>
        <Button disabled={!plugin.installable} onClick={onInstall}>
          {uiText(locale, "ResourceCenter_labels.installPluginAction")}
        </Button>
      </div>
    </Dialog>
  );
}
