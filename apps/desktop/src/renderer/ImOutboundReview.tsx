import { type UiTranslate } from "../shared/ui-text.js";
import { useState } from "react";
import type { ImOutboundCandidate } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImOutboundReview({ t }: { t: UiTranslate }) {
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
          ? `${item.body.name}\n${t("ImOutboundReview.message1")}\nSHA-256: ${item.contentHash}\n${t("ImOutboundReview.message2")}: ${item.body.data?.length ?? 0}`
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
      aria-label={t("ImOutboundReview.message3")}
    >
      <h3>{t("ImOutboundReview.message3")}</h3>
      <p>{t("ImOutboundReview.message4")}</p>
      <Button disabled={busy} onClick={() => void run(refresh)}>
        {t("ImOutboundReview.message5")}
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
              label={t("ImOutboundReview.message6")}
              value={text}
              onValueChange={setText}
              disabled={busy}
            />
          ) : (
            <pre>{text}</pre>
          )}
          <Button disabled={busy} onClick={() => void run(() => resolve(true))}>
            {t("ImOutboundReview.message7")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void run(() => resolve(false))}
          >
            {t("ImOutboundReview.message8")}
          </Button>
        </>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </section>
  );
}
