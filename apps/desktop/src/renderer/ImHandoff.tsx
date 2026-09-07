import { useState } from "react";
import type { ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImHandoff({
  tasks,
  t,
}: {
  tasks: NonNullable<ImStatus["remoteTasks"]>;
  t: (cn: string, en: string) => string;
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
      setNotice(
        t(
          "选定文字已交接，原任务历史未导入。",
          "Selected text handed off. Original history was not imported.",
        ),
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="im-security-scope">
      <summary>
        {t("选择文字交接到受限任务", "Hand off selected text to a scoped task")}
      </summary>
      <p>
        {t(
          "先在 IM 使用 /continue 选择任务，或打开群协作任务。粘贴并预览你愿意共享的交接文字；原任务历史不会自动导入。",
          "Select a task with /continue in IM, or open a group task. Paste and preview the handoff text you want to share. Original task history is never imported automatically.",
        )}
      </p>
      <Select
        labelVisibility="visible"
        label={t("交接目标", "Handoff target")}
        value={threadId}
        onValueChange={setThreadId}
        disabled={busy}
        options={[
          { value: "", label: t("请选择受限任务", "Choose a scoped task") },
          ...tasks.map((task) => ({
            value: task.threadId,
            label: `${task.channel} · ${task.kind} · ${task.threadId}`,
          })),
        ]}
      />
      <TextAreaField
        label={t("仅分享以下文字", "Share only this text")}
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
        {t("确认文字并交接", "Confirm text and hand off")}
      </Button>
      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
    </details>
  );
}
