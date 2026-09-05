import { useEffect, useRef, useState } from "react";
import {
  imIdentityKey,
  type ImIdentity,
  type ImPairingRequest,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
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
  t,
}: {
  pair: ImPairCode | undefined;
  slack: boolean;
  busy: boolean;
  generate(): void;
  copy(text: string): void;
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
    <div className="im-pairing-code">
      {pair && (
        <InlineNotice tone={seconds ? "info" : "warning"}>
          <span role="status">
            {seconds
              ? t("配对码有效", "Pairing code active")
              : t(
                  "配对码已过期，请重新生成。",
                  "Pairing code expired. Generate a new one.",
                )}
          </span>
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
          <p className="im-identifier">{command}</p>
          <Button
            disabled={busy || !seconds}
            onClick={() => {
              if (pair.expiresAt > Date.now()) copy(command);
              else setNow(Date.now());
            }}
          >
            {t("复制配对指令", "Copy pairing command")}
          </Button>
        </InlineNotice>
      )}
      <Button disabled={busy} onClick={generate}>
        {pair
          ? t("重新生成配对码", "Generate a new pairing code")
          : t("生成一次性配对码", "Generate pairing code")}
      </Button>
    </div>
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
        <InlineNotice key={request.id} tone="info">
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
              disabled={busy}
              onClick={() =>
                void resolve(request.id, true).then(() => root.current?.focus())
              }
            >
              {t("批准", "Approve")}
            </Button>
            <Button
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
            <span className="im-identifier">
              {identity.userId} · {identity.connectionId}
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
              <Button
                disabled={busy}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setConfirming(key);
                }}
              >
                {t("解除绑定", "Unpair")}
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
