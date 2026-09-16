import type { AppLocale } from "@artemis/protocol";
import { statusText } from "../shared/status-text.js";
import { type UiTranslate } from "../shared/ui-text.js";
import { useState } from "react";
import type { ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImHandoff({
  tasks,
  t,
  locale,
}: {
  tasks: NonNullable<ImStatus["remoteTasks"]>;
  t: UiTranslate;
  locale: AppLocale;
}) {
  const [threadId, setThreadId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function send() {
    setBusy(true);
    setNotice("");
    try {
      await window.artemis.manageIm({ action: "handoff", threadId, text });
      setText("");
      setNotice(t("ImHandoff.message1"));
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="im-security-scope">
      <summary>{t("ImHandoff.message2")}</summary>
      <p>{t("ImHandoff.message3")}</p>
      <Select
        labelVisibility="visible"
        label={t("ImHandoff.message4")}
        value={threadId}
        onValueChange={setThreadId}
        disabled={busy}
        options={[
          { value: "", label: t("ImHandoff.message5") },
          ...tasks.map((task) => ({
            value: task.threadId,
            label: `${task.channel === "wecom" ? t("ImNavigation.message2") : task.channel === "feishu" ? t("ImNavigation.message1") : task.channel === "slack" ? "Slack" : task.channel} · ${statusText(locale, task.kind)} · ${task.threadId}`,
          })),
        ]}
      />
      <TextAreaField
        label={t("ImHandoff.message6")}
        value={text}
        onValueChange={setText}
        disabled={busy}
      />
      <Button
        disabled={
          busy ||
          !text.trim() ||
          !tasks.some((task) => task.threadId === threadId)
        }
        onClick={() => void send()}
      >
        {t("ImHandoff.message7")}
      </Button>
      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
    </details>
  );
}
