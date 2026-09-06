import { useEffect, useRef, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { TextField } from "@artemis/ui/forms";
import type { ImTranslate } from "./ImNavigation";

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
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirmation.current?.focus();
  }, [confirming]);
  function cancel() {
    setConfirming(false);
    setToken("");
    trigger.current?.focus();
  }
  return (
    <div className="im-connection-removal">
      <Button
        variant="quiet"
        className="management-text-action is-destructive"
        disabled={busy}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setConfirming(true);
        }}
      >
        {t("移除连接", "Remove connection")}
      </Button>
      {confirming && (
        <div
          ref={confirmation}
          tabIndex={-1}
          className="im-field-stack"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <p>
            {t(
              `确认移除“${name}”？将停止机器人连接、删除保存的应用凭据并解除该连接的账号绑定。重新连接需要再次填写凭据和配对。`,
              `Remove “${name}”? This stops the bot, deletes its saved credentials and unpairs its accounts. Reconnecting requires credentials and pairing again.`,
            )}
          </p>
          {!local && (
            <TextField
              label={t("移除连接的管理凭据", "Administrator token for removal")}
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
      )}
    </div>
  );
}
