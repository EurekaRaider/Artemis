import { useRef, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { Dialog, Tooltip } from "@artemis/ui/feedback";
import { TextField } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { ImTranslate } from "./ImNavigation";

/**
 * Connection-row trash action: an icon button inline with the row; the
 * confirmation (and the team-Gateway administrator token field when needed)
 * opens in a modal dialog instead of expanding in place.
 */
export function ImConnectionRemoval({
  name,
  local,
  busy,
  remove,
  t,
}: {
  name: string;
  local: boolean;
  busy: boolean;
  remove(adminToken: string): Promise<boolean>;
  t: ImTranslate;
}) {
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  function cancel() {
    setConfirming(false);
    setToken("");
  }
  return (
    <div className="im-connection-removal">
      {/* ui Button 契约要求可见文字；纯图标动作用原生按钮（aria-label 可达性）。 */}
      <Tooltip label={t("移除连接", "Remove connection")} align="end">
        <button
          type="button"
          className="im-icon-action"
          disabled={busy}
          aria-label={t(`移除连接 ${name}`, `Remove connection ${name}`)}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setConfirming(true);
          }}
        >
          <ArtemisIcon height={13} name="trash" width={13} />
        </button>
      </Tooltip>
      {confirming && (
        <Dialog
          className="im-removal-dialog"
          label={t(`移除连接 · ${name}`, `Remove connection · ${name}`)}
          returnFocusRef={trigger}
          onOpenChange={(open) => {
            if (!open) cancel();
          }}
          open
        >
          <header>
            <h2>{t(`确认移除“${name}”？`, `Remove “${name}”?`)}</h2>
          </header>
          <div className="im-removal-dialog-body">
            <p>
              {t(
                "将停止机器人连接、删除保存的应用凭据并解除该连接的账号绑定。重新连接需要再次填写凭据和配对。",
                "This stops the bot, deletes its saved credentials and unpairs its accounts. Reconnecting requires credentials and pairing again.",
              )}
            </p>
            {!local && (
              <TextField
                label={t(
                  "移除连接的管理凭据",
                  "Administrator token for removal",
                )}
                type="password"
                value={token}
                onValueChange={setToken}
                autoComplete="off"
                disabled={busy}
              />
            )}
            <div className="im-actions">
              <Button
                variant="danger"
                disabled={busy || (!local && !token)}
                onClick={() => {
                  const credential = token;
                  setToken("");
                  void remove(credential).then((success) => {
                    if (success) setConfirming(false);
                  });
                }}
              >
                {t("确认移除", "Confirm removal")}
              </Button>
              <Button disabled={busy} onClick={cancel}>
                {t("取消", "Cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
