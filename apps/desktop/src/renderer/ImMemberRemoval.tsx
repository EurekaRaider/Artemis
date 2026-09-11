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
      ? t("从整个空间移除", "Remove from entire space")
      : t("从本对话移除", "Remove from this conversation");
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
          ? t(
              `将“${name}”从整个协作空间移除，所有连接的群与协作对话都不能再向其派发任务。原生 IM 群与已有对话历史保留。`,
              `Remove ${name} from the entire space. Connected groups and collaboration conversations will no longer be able to delegate to them. Native IM groups and conversation history remain.`,
            )
          : t(
              `将“${name}”从本对话的目标成员中移除。该成员仍可在空间内的其他对话和 IM 群中参与协作，已有对话历史保留。`,
              `Remove ${name} from this conversation's targets. They can still collaborate in other conversations and IM groups in the space. Conversation history remains.`,
            )}
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
          {t("确认移除成员", "Confirm member removal")}
        </Button>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          {t("取消", "Cancel")}
        </Button>
      </div>
    </div>
  );
}
