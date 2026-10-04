import { useState } from "react";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Button, IconButton } from "@artemis/ui/actions";
import { InlineNotice, Tooltip } from "@artemis/ui/feedback";
import type { ImTranslate } from "./ImNavigation";

export function ImMemberRemoval({
  name,
  compact = false,
  scope,
  disabled,
  remove,
  t,
}: {
  name: string;
  compact?: boolean;
  scope: "conversation" | "space";
  disabled: boolean;
  remove(): Promise<boolean>;
  t: ImTranslate;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const label =
    scope === "space"
      ? t("ImMemberRemoval.message2")
      : t("ImMemberRemoval.message1");
  if (!confirming && compact)
    return (
      <Tooltip label={`${label}：${name}`} align="end">
        <IconButton
          className="im-member-action im-member-remove"
          icon={<ArtemisIcon name="unlink" width={14} height={14} />}
          label={`${label}：${name}`}
          disabled={disabled}
          onClick={() => setConfirming(true)}
        />
      </Tooltip>
    );
  if (!confirming)
    return (
      <Button
        variant="quiet"
        label={`${label}：${name}`}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  return (
    <div className="im-member-removal">
      <InlineNotice tone="warning">
        {scope === "space"
          ? t("ImMemberRemoval.message4", { value1: name })
          : t("ImMemberRemoval.message3", { value1: name })}
      </InlineNotice>
      <div className="im-inline-actions">
        <Button
          variant="danger"
          disabled={disabled || pending}
          onClick={async () => {
            setPending(true);
            try {
              if (await remove()) setConfirming(false);
            } finally {
              setPending(false);
            }
          }}
        >
          {t("ImMemberRemoval.message5")}
        </Button>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          {t("App_copy.renameCancel")}
        </Button>
      </div>
    </div>
  );
}
