import { useRef, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { Dialog, InlineNotice, Tooltip } from "@artemis/ui/feedback";
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
  error,
  remove,
  t,
}: {
  name: string;
  local: boolean;
  busy: boolean;
  error?: string | undefined;
  remove(adminToken: string): Promise<boolean>;
  t: ImTranslate;
}) {
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState("");
  const [attempted, setAttempted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function cancel() {
    setConfirming(false);
    setToken("");
    setAttempted(false);
  }
  return (
    <div className="im-connection-removal">
      {/* ui Button 契约要求可见文字；纯图标动作用原生按钮（aria-label 可达性）。 */}
      <Tooltip label={t("ImConnectionRemoval.message2")} align="end">
        <button
          type="button"
          className="im-icon-action"
          disabled={busy}
          aria-label={t("ImConnectionRemoval.message1", { value1: name })}
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
          label={t("ImConnectionRemoval.message8", { value1: name })}
          returnFocusRef={trigger}
          onOpenChange={(open) => {
            if (!open) cancel();
          }}
          open
        >
          <header>
            <h2>{t("ImConnectionRemoval.message3", { value1: name })}</h2>
          </header>
          <div className="im-removal-dialog-body">
            <p>{t("ImConnectionRemoval.message4")}</p>
            {!local && (
              <TextField
                label={t("ImConnectionRemoval.message5")}
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
                aria-busy={busy}
                onClick={() => {
                  const credential = token;
                  setAttempted(true);
                  setToken("");
                  void remove(credential).then((success) => {
                    if (success) setConfirming(false);
                  });
                }}
              >
                {t("ImConnectionRemoval.message6")}
              </Button>
              <Button disabled={busy} onClick={cancel}>
                {t("App_copy.renameCancel")}
              </Button>
            </div>
            {attempted && error && (
              <InlineNotice tone="danger" role="alert">
                {error}
              </InlineNotice>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
