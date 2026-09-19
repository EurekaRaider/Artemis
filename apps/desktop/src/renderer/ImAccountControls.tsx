import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  imIdentityKey,
  type ImIdentity,
  type ImPairingRequest,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Button } from "@artemis/ui/actions";
import { Dialog, InlineNotice, Tooltip } from "@artemis/ui/feedback";
import type { ImTranslate } from "./ImNavigation";

export interface ImPairCode {
  code: string;
  expiresAt: number;
}
export function ImPairingCode({
  pair,
  slack,
  busy,
  generate,
  copy,
  onPoll,
  guide,
  requests,
  returnFocusRef,
  onClose,
  t,
}: {
  pair: ImPairCode | undefined;
  slack: boolean;
  busy: boolean;
  generate(): void;
  copy(text: string): void;
  /** 弹窗打开期间自动轮询配对状态，待确认请求自行浮现。 */
  onPoll(): void;
  /** 弹窗内的提示信息（操作指引）。 */
  guide?: ReactNode;
  /** 待确认的配对请求卡片（批准/拒绝内聚在弹窗内）。 */
  requests?: ReactNode;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  t: ImTranslate;
}) {
  const [now, setNow] = useState(Date.now);
  const pollRef = useRef(onPoll);
  pollRef.current = onPoll;
  useEffect(() => {
    setNow(Date.now());
    if (!pair) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pair]);
  useEffect(() => {
    const timer = window.setInterval(() => pollRef.current(), 4000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = pair
    ? Math.max(0, Math.ceil((pair.expiresAt - now) / 1000))
    : 0;
  const command = pair ? `${slack ? "pair" : "/pair"} ${pair.code}` : "";
  return (
    <Dialog
      className="im-pair-dialog"
      label={t("ImAccountControls.message1")}
      returnFocusRef={returnFocusRef}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <header className="im-pair-dialog-head">
        <h2>{t("ImAccountControls.message1")}</h2>
        <button
          type="button"
          className="im-detail-dialog-close"
          aria-label={t("App_copy.renameClose")}
          onClick={onClose}
        >
          <ArtemisIcon aria-hidden="true" height={14} name="close" width={14} />
        </button>
      </header>
      <div className="im-pair-dialog-body">
        {guide}
        <div className="im-pair-code-line">
          <span>{t("ImAccountControls.message4")}</span>
          {pair && (
            <>
              <strong className="im-pair-code-value">{pair.code}</strong>
              {/* 分隔点即信号灯：绿=有效，红=已过期。 */}
              <span
                aria-hidden="true"
                className="im-dot"
                data-state={seconds > 0 ? "connected" : "error"}
              />
              <span
                className="im-countdown"
                aria-label={t("ImAccountControls.message5")}
              >
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="im-pair-code-actions">
                <Button
                  disabled={busy || !seconds}
                  onClick={() => {
                    if (pair.expiresAt > Date.now()) copy(command);
                    else setNow(Date.now());
                  }}
                >
                  {t("ImAccountControls.message6")}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={generate}>
                  {t("ImAccountControls.message7")}
                </Button>
              </span>
            </>
          )}
        </div>
        {requests}
      </div>
    </Dialog>
  );
}
export function ImAccounts({
  identities,
  requests,
  busy,
  resolve,
  unpair,
  t,
  showAccounts = true,
}: {
  identities: ImIdentity[];
  requests: ImPairingRequest[];
  busy: boolean;
  resolve(id: string, approve: boolean): Promise<boolean>;
  unpair(identity: ImIdentity): Promise<boolean>;
  showAccounts?: boolean;
  t: ImTranslate;
}) {
  const [confirming, setConfirming] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const triggerKey = useRef("");
  const confirm = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirm.current?.querySelector("button")?.focus();
  }, [confirming]);
  function cancel() {
    setConfirming("");
    window.requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div
      ref={root}
      className="im-accounts"
      tabIndex={-1}
      aria-label={t("ImAccountControls.message22")}
    >
      {requests.map((request) => (
        <InlineNotice
          key={request.id}
          tone="warning"
          className="im-pairing-request"
        >
          <p>{t("ImAccountControls.message11")}</p>
          <p className="im-identifier">
            {request.identity.userId} · {request.identity.connectionId}
          </p>
          <p>{t("ImAccountControls.message12")}</p>
          <div className="im-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void resolve(request.id, true).then(() => root.current?.focus())
              }
            >
              {t("ImAccountControls.message13")}
            </Button>
            <Button
              variant="quiet"
              className="management-text-action"
              disabled={busy}
              onClick={() =>
                void resolve(request.id, false).then(() =>
                  root.current?.focus(),
                )
              }
            >
              {t("ImAccountControls.message14")}
            </Button>
          </div>
        </InlineNotice>
      ))}
      {showAccounts && <h4>{t("ImAccountControls.message15")}</h4>}
      {showAccounts && !identities.length && (
        <p>{t("ImAccountControls.message16")}</p>
      )}
      {identities.map((identity) => {
        const key = imIdentityKey(identity);
        return (
          <div className="im-identity" key={key}>
            <span className="im-account-copy">
              <strong>{identity.userId}</strong>
            </span>
            {confirming === key ? (
              <div
                className="im-unpair-confirm"
                ref={confirm}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                  }
                }}
              >
                <span>{t("ImAccountControls.message17")}</span>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void unpair(identity).then((success) => {
                      if (success) {
                        setConfirming("");
                        root.current?.focus();
                      }
                    })
                  }
                >
                  {t("ImAccountControls.message18")}
                </Button>
                <Button disabled={busy} onClick={cancel}>
                  {t("ImAccountControls.message19")}
                </Button>
              </div>
            ) : null}
            {confirming !== key && (
              <Tooltip label={t("ImAccountControls.message20")} align="end">
                <button
                  type="button"
                  ref={(node) => {
                    if (triggerKey.current === key) trigger.current = node;
                  }}
                  aria-label={t("ImAccountControls.message20")}
                  className="im-icon-action"
                  disabled={busy}
                  onClick={(event) => {
                    triggerKey.current = key;
                    trigger.current = event.currentTarget;
                    setConfirming(key);
                  }}
                >
                  <ArtemisIcon name="unlink" />
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
