import { useState } from "react";
import type { ImOutboundCandidate } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImOutboundReview({
  t,
}: {
  t: (cn: string, en: string) => string;
}) {
  const [items, setItems] = useState<ImOutboundCandidate[]>([]);
  const [selected, setSelected] = useState<
    ImOutboundCandidate & { body: unknown }
  >();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setItems(
      (await window.artemis.manageIm({
        action: "outbound-list",
      })) as ImOutboundCandidate[],
    );
  }
  async function preview(id: string) {
    const item = (await window.artemis.manageIm({
      action: "outbound-preview",
      id,
    })) as ImOutboundCandidate & {
      body: { text?: string; name?: string; data?: string; command?: unknown };
    };
    setSelected(item);
    setText(
      item.kind === "reply"
        ? (item.body.text ?? "")
        : item.kind === "artifact"
          ? `${item.body.name}\n${t("文件未自动发送；请核对原文件和下列内容指纹。", "File has not been sent. Check the original file and this content fingerprint.")}\nSHA-256: ${item.contentHash}\n${t("编码大小", "Encoded size")}: ${item.body.data?.length ?? 0}`
          : JSON.stringify(item.body.command, null, 2),
    );
  }
  async function resolve(approve: boolean) {
    if (!selected) return;
    await window.artemis.manageIm({
      action: "outbound-resolve",
      id: selected.id,
      contentHash: selected.contentHash,
      approve,
      ...(selected.kind === "reply" ? { text } : {}),
    });
    setSelected(undefined);
    setText("");
    await refresh();
  }
  return (
    <section
      className="im-outbound-review"
      aria-label={t("待审外发结果", "Pending deliveries")}
    >
      <h3>{t("待审外发结果", "Pending deliveries")}</h3>
      <p>
        {t(
          "任务成果保留在桌面；确认只适用于当前内容与接收对象。",
          "Results stay on this desktop. Approval applies only to these contents and recipients.",
        )}
      </p>
      <Button disabled={busy} onClick={() => void run(refresh)}>
        {t("刷新待审结果", "Refresh pending results")}
      </Button>
      {items.map((item) => (
        <p key={item.id}>
          <Button
            disabled={busy}
            onClick={() => void run(() => preview(item.id))}
          >
            {item.reason} · {item.security.audience}
          </Button>
        </p>
      ))}
      {selected ? (
        <>
          <p>
            {selected.security.audience} · {selected.threadId}
          </p>
          {selected.kind === "reply" ? (
            <TextAreaField
              label={t("预览或修改发送内容", "Preview or edit delivery")}
              value={text}
              onValueChange={setText}
              disabled={busy}
            />
          ) : (
            <pre>{text}</pre>
          )}
          <Button disabled={busy} onClick={() => void run(() => resolve(true))}>
            {t("仅发送这一次", "Send once")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void run(() => resolve(false))}
          >
            {t("拒绝发送", "Reject")}
          </Button>
        </>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </section>
  );
}
