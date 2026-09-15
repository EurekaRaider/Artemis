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
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
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
  onRefresh,
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
  /** 用户已在机器人单聊发送指令后，手动重拉配对状态。 */
  onRefresh(): void;
  /** 弹窗内的提示信息（操作指引）。 */
  guide?: ReactNode;
  /** 待确认的配对请求卡片（批准/拒绝内聚在弹窗内）。 */
  requests?: ReactNode;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  t: ImTranslate;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!pair) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pair]);
  const seconds = pair
    ? Math.max(0, Math.ceil((pair.expiresAt - now) / 1000))
    : 0;
  const command = pair ? `${slack ? "pair" : "/pair"} ${pair.code}` : "";
  return (
    <Dialog
      className="im-pair-dialog"
      label={t("机器人配对码", "Bot pairing code")}
      returnFocusRef={returnFocusRef}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <header>
        <h2>{t("机器人配对码", "Bot pairing code")}</h2>
      </header>
      <div className="im-pair-dialog-body">
        {guide}
        <span role="status">
          {seconds
            ? t("配对码有效", "Pairing code active")
            : t(
                "配对码已过期，请重新生成。",
                "Pairing code expired. Generate a new one.",
              )}
        </span>
        <div className="im-pair-code-line">
          <span>{t("配对码", "Pairing code")}</span>
          {pair && (
            <>
              <strong className="im-pair-code-value">{pair.code}</strong>
              {seconds > 0 && (
                <span
                  className="im-countdown"
                  aria-label={t("剩余有效时间", "Time remaining")}
                >
                  {" "}
                  · {Math.floor(seconds / 60)}:
                  {String(seconds % 60).padStart(2, "0")}
                </span>
              )}
              <Button
                disabled={busy || !seconds}
                onClick={() => {
                  if (pair.expiresAt > Date.now()) copy(command);
                  else setNow(Date.now());
                }}
              >
                {t("复制配对指令", "Copy pairing command")}
              </Button>
            </>
          )}
        </div>
        {requests}
        <div className="im-actions">
          <Button variant="quiet" disabled={busy} onClick={generate}>
            {t("重新生成配对码", "Generate a new pairing code")}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onRefresh}>
            {t("我已发送，刷新配对结果", "I sent it — refresh pairing")}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            {t("关闭", "Close")}
          </Button>
        </div>
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
      aria-label={t("已绑定账号与配对请求", "Paired accounts and requests")}
    >
      {requests.map((request) => (
        <InlineNotice
          key={request.id}
          tone="warning"
          className="im-pairing-request"
        >
          <p>
            {t("配对请求 · 待确认", "Pairing request · Awaiting confirmation")}
          </p>
          <p className="im-identifier">
            {request.identity.userId} · {request.identity.connectionId}
          </p>
          <p>
            {t(
              "请核对这是你本人的 IM 账号。",
              "Verify that this is your own IM account.",
            )}
          </p>
          <div className="im-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void resolve(request.id, true).then(() => root.current?.focus())
              }
            >
              {t("批准", "Approve")}
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
              {t("拒绝", "Reject")}
            </Button>
          </div>
        </InlineNotice>
      ))}
      {showAccounts && <h4>{t("已绑定账号", "Paired accounts")}</h4>}
      {showAccounts && !identities.length && (
        <p>{t("尚未绑定账号", "No paired accounts yet")}</p>
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
                <span>
                  {t("确认解除与该账号的绑定？", "Unpair this account?")}
                </span>
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
                  {t("确认解除", "Confirm unpair")}
                </Button>
                <Button disabled={busy} onClick={cancel}>
                  {t("保留", "Keep paired")}
                </Button>
              </div>
            ) : null}
            <span hidden={confirming === key}>
              <button
                type="button"
                aria-label={t("解除绑定", "Unpair")}
                title={t("解除绑定", "Unpair")}
                className="im-icon-action"
                disabled={busy}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setConfirming(key);
                }}
              >
                <ArtemisIcon name="unlink" />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
