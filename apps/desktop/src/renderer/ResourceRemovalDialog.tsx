import { useId, type ReactNode } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Dialog } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { UI_COPY } from "../shared/ui-copy.js";
import { uiText } from "../shared/ui-text.js";

export function ResourceRemovalDialog({
  avatar,
  kind,
  name,
  locale,
  onCancel,
  onRemove,
}: {
  avatar: ReactNode;
  kind: "mcp" | "skill";
  name: string;
  locale: AppLocale;
  onCancel(): void;
  onRemove(): void;
}) {
  const id = useId();
  const t = UI_COPY.ResourceCenter_labels[locale];
  const title = kind === "mcp" ? t.confirmRemoveMcp : t.confirmRemoveSkill;

  return (
    <Dialog
      aria-describedby={`${id}-resource ${id}-warning`}
      aria-labelledby={`${id}-title`}
      className="resource-removal-dialog"
      label={title}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open
      role="alertdialog"
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="resource-removal-identity">
        {avatar}
        <strong id={`${id}-resource`}>{name}</strong>
      </div>
      <p className="resource-removal-warning" id={`${id}-warning`}>
        {uiText(locale, "App_copy.confirmationDangerTitle")}
      </p>
      <div className="resource-removal-actions">
        <Button
          icon={<ArtemisIcon name="close" />}
          onClick={onCancel}
          variant="secondary"
        >
          {t.cancel}
        </Button>
        <Button
          icon={<ArtemisIcon name="trash" />}
          onClick={onRemove}
          variant="danger"
        >
          {kind === "mcp" ? t.removeMcpAction : t.remove}
        </Button>
      </div>
    </Dialog>
  );
}
