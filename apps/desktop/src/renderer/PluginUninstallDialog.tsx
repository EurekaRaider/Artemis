import { useId } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Dialog } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementHeader } from "@artemis/ui/management";
import type { InstalledCodexPlugin } from "../shared/api.js";
import { UI_COPY } from "../shared/ui-copy.js";
import { uiText } from "../shared/ui-text.js";
import { ResourceAvatar } from "./resource-icons.js";

export function PluginUninstallDialog({
  plugin,
  displayName,
  locale,
  onCancel,
  onUninstall,
}: {
  plugin: InstalledCodexPlugin;
  displayName: string;
  locale: AppLocale;
  onCancel(): void;
  onUninstall(): void;
}) {
  const descriptionId = useId();
  const t = UI_COPY.ResourceCenter_labels[locale];
  const title = uiText(locale, "ResourceCenter_labels.uninstallPluginTitle", {
    name: displayName,
  });

  return (
    <Dialog
      aria-describedby={descriptionId}
      className="plugin-uninstall-dialog"
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
      <div id={descriptionId}>
        <p className="plugin-uninstall-description">{t.confirmRemovePlugin}</p>
        <p className="plugin-uninstall-warning">
          <ArtemisIcon name="warning" />
          <span>{uiText(locale, "App_copy.confirmationDangerTitle")}</span>
        </p>
      </div>
      <div className="plugin-dialog-footer">
        <Button
          className="plugin-dialog-cancel"
          onClick={onCancel}
          variant="quiet"
        >
          {t.cancel}
        </Button>
        <Button
          className="plugin-dialog-uninstall"
          icon={<ArtemisIcon name="trash" />}
          onClick={onUninstall}
          variant="danger"
        >
          {uiText(locale, "ResourceCenter_labels.uninstallPluginAction")}
        </Button>
      </div>
    </Dialog>
  );
}
