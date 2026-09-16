import { useEffect, useRef, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { Select, TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { ImGroupContext } from "@artemis/protocol";

type State = {
  tasks: Array<{
    id: string;
    time?: number;
    title: string;
    state: string;
    visibility: string;
    text?: string;
    running?: boolean;
    instruction?: string;
  }>;
  messages: Array<{ id: string; text: string; state: string; time?: number }>;
  activity?: Array<{
    id: string;
    taskId: string;
    time: number;
    kind: string;
    visibility: string;
  }>;
  cooperation?: {
    history?: Array<{
      id: string;
      time: number;
      direction: string;
      envelope: {
        action: string;
        sender: string;
        recipient: string;
        text: string;
      };
    }>;
    tasks?: Array<{
      id: string;
      direction: string;
      state: string;
      peer: string;
      text: string;
      result?: string;
      updatedAt: number;
      workflow: string;
      delivery?: string;
    }>;
  };
};
export type NativeDraft = { local: string; group: string };
export function ImNativeConversation({
  threadId,
  group,
  zh,
  drafts,
  open,
  readOnly = false,
}: {
  threadId: string;
  group: ImGroupContext;
  zh: boolean;
  drafts: Map<string, NativeDraft>;
  open(id: string): void;
  readOnly?: boolean;
}) {
  const [destination, setDestination] = useState<"local" | "group">("local");
  const [draft, setDraft] = useState<NativeDraft>(
    () => drafts.get(threadId) ?? { local: "", group: "" },
  );
  const [state, setState] = useState<State>({ tasks: [], messages: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<
    { id: string; text: string; destination: "local" | "group" } | undefined
  >(undefined);
  useEffect(() => {
    let active = true,
      refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = (await window.artemis.manageIm({
          action: "native-group-state",
          threadId,
        })) as State;
        if (active) setState(result);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [threadId]);
  const change = (text: string) => {
    const next = { ...draft, [destination]: text };
    setDraft(next);
    drafts.set(threadId, next);
  };
  const send = async () => {
    if (busy || !draft[destination].trim()) return;
    setBusy(true);
    setError("");
    const text = draft[destination];
    if (
      !pending.current ||
      pending.current.text !== text ||
      pending.current.destination !== destination
    )
      pending.current = { id: crypto.randomUUID(), text, destination };
    try {
      await window.artemis.manageIm({
        action: "native-group-input",
        threadId,
        messageId: pending.current.id,
        text,
        destination,
      });
      change("");
      pending.current = undefined;
      setState(
        (await window.artemis.manageIm({
          action: "native-group-state",
          threadId,
        })) as State,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const renderTask = (task: State["tasks"][number]) => (
    <div className="im-field-stack" key={task.id}>
      <Button variant="quiet" onClick={() => open(task.id)}>
        {task.title}
      </Button>
      {task.instruction ? <p>{task.instruction}</p> : null}
      {task.running ? (
        <Button
          variant="quiet"
          onClick={() =>
            void window.artemis
              .cancelTurn(task.id)
              .catch((e) => setError(String(e)))
          }
        >
          {zh ? "停止本机任务" : "Stop local task"}
        </Button>
      ) : null}
      {task.text ? <p>{task.text}</p> : null}
      <span>
        {zh
          ? task.state
          : ({
              正在执行: "Running",
              等待确认: "Waiting for approval",
              失败: "Failed",
              已停止: "Cancelled",
              完成: "Completed",
              空闲: "Idle",
            }[task.state] ?? task.state)}{" "}
        ·{" "}
        {task.visibility === "local"
          ? zh
            ? "仅本地"
            : "Local only"
          : zh
            ? "群内任务"
            : "Group task"}
      </span>
    </div>
  );
  const renderMessage = (message: State["messages"][number]) => (
    <div key={message.id}>
      <p>{message.text}</p>
      <small>
        {message.state === "queued"
          ? zh
            ? "已排队，送达未确认"
            : "Queued, delivery unconfirmed"
          : message.state === "submitted"
            ? zh
              ? "已提交到本机网关，平台送达待确认"
              : "Submitted to local gateway; platform delivery unconfirmed"
            : ({
                "platform-accepted": zh
                  ? "平台已确认接收"
                  : "Accepted by IM platform",
                uncertain: zh
                  ? "发送结果待核实，不会自动重发"
                  : "Delivery uncertain; no automatic resend",
                failed: zh ? "发送失败" : "Send failed",
                revoked: zh
                  ? "授权已撤销，已停止发送"
                  : "Authorization revoked; sending stopped",
              }[message.state] ?? message.state)}
      </small>
    </div>
  );

  const remoteLabel = (state: string) =>
    ({
      sent: zh ? "已发送，等待接收回执" : "Sent; awaiting acceptance",
      accepted: zh ? "对方已接收" : "Accepted by peer",
      blocked: zh ? "等待前置任务" : "Waiting for prerequisites",
      running: zh ? "正在执行" : "Running",
      progress: zh ? "进度" : "Progress",
      completed: zh ? "完成" : "Completed",
      failed: zh ? "失败，等待处理" : "Failed; action required",
      "cancel-sent": zh
        ? "取消已发送，等待确认"
        : "Cancellation sent; awaiting confirmation",
      cancelled: zh ? "取消已确认" : "Cancellation confirmed",
      uncertain: zh
        ? "执行状态待核实，不自动重放"
        : "Execution uncertain; no automatic replay",
      rejected: zh ? "已拒绝" : "Rejected",
      hello: zh ? "能力发现" : "Bot discovery",
      probe: zh ? "IM 往返测试" : "IM probe",
      proof: zh ? "IM 测试回执" : "IM probe receipt",
      delegate: zh ? "派工" : "Assignment",
      cancel: zh ? "取消请求" : "Cancellation request",
      note: zh ? "协作消息" : "Cooperation note",
    })[state] ?? state;
  const activityLabel = (kind: string) =>
    ({
      "tool.started": zh ? "任务进度更新" : "Task progress",
      "turn.completed": zh ? "本机任务结束" : "Local task ended",
      "turn.failed": zh ? "本机任务失败" : "Local task failed",
      "approval.requested": zh ? "等待确认" : "Approval required",
      "user-input.requested": zh ? "等待回答" : "Input required",
    })[kind] ?? kind;
  const timeline = [
    ...state.tasks.map((value) => ({
      kind: "task" as const,
      value,
      time: value.time ?? 0,
    })),
    ...state.messages.map((value) => ({
      kind: "message" as const,
      value,
      time: value.time ?? 0,
    })),
    ...(state.activity ?? []).map((value) => ({
      kind: "activity" as const,
      value,
      time: value.time,
    })),
    ...(state.cooperation?.history ?? []).map((value) => ({
      kind: "protocol" as const,
      value,
      time: value.time,
    })),
    ...(state.cooperation?.tasks ?? []).map((value) => ({
      kind: "remote" as const,
      value,
      time: value.updatedAt,
    })),
  ].sort((a, b) => a.time - b.time || a.value.id.localeCompare(b.value.id));
  return (
    <div className="im-native-conversation im-field-stack">
      {group.stale || !group.confirmed ? (
        <InlineNotice tone="info">
          {zh
            ? "群已暂停或授权失效。历史保留，重新授权后可继续接入。"
            : "This group is paused or its authorization is unavailable. History is preserved."}
        </InlineNotice>
      ) : null}
      <p>
        {group.capability === "events"
          ? zh
            ? "显示此机器人参与的消息和任务。自动交接仅通过当前 IM 群。"
            : "Shows messages and tasks involving this bot. Automatic handoffs use this IM group only."
          : zh
            ? "显示此机器人参与的消息和任务。当前仅支持人工 @ 派工。"
            : "Shows messages and tasks involving this bot. Manual assignment only."}
      </p>
      {timeline.map((entry) => (
        <div key={`${entry.kind}:${entry.value.id}`}>
          <small>{new Date(entry.time).toLocaleString()}</small>
          {entry.kind === "task" ? (
            renderTask(entry.value)
          ) : entry.kind === "message" ? (
            renderMessage(entry.value)
          ) : entry.kind === "activity" ? (
            <Button variant="quiet" onClick={() => open(entry.value.taskId)}>
              {activityLabel(entry.value.kind)} ·{" "}
              {entry.value.visibility === "local"
                ? zh
                  ? "仅本地"
                  : "Local only"
                : zh
                  ? "群内任务"
                  : "Group task"}
            </Button>
          ) : entry.kind === "remote" ? (
            <div className="im-field-stack">
              <strong>
                {entry.value.peer} ·{" "}
                {["sent", "cancel-sent"].includes(entry.value.state) &&
                entry.value.delivery !== "done"
                  ? zh
                    ? "已排队，等待 IM 发送"
                    : "Queued; awaiting IM delivery"
                  : remoteLabel(entry.value.state)}
              </strong>
              <p>{entry.value.text}</p>
              <p>{entry.value.result}</p>
              {entry.value.direction === "outgoing" &&
              !["completed", "failed", "rejected", "cancelled"].includes(
                entry.value.state,
              ) ? (
                <Button
                  disabled={
                    readOnly ||
                    group.stale ||
                    !group.confirmed ||
                    entry.value.state === "cancel-sent"
                  }
                  onClick={() =>
                    void window.artemis
                      .manageIm({
                        action: "native-cancel",
                        groupId: group.spaceId,
                        taskId: entry.value.id,
                        messageId: crypto.randomUUID(),
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  {zh ? "通过 IM 请求取消" : "Request cancellation through IM"}
                </Button>
              ) : null}
            </div>
          ) : (
            <div>
              <strong>
                {entry.value.envelope.sender} → {entry.value.envelope.recipient}{" "}
                · {remoteLabel(entry.value.envelope.action)}
              </strong>
              <p>{entry.value.envelope.text}</p>
            </div>
          )}
        </div>
      ))}
      <Select
        labelVisibility="visible"
        label={zh ? "输入用途" : "Destination"}
        value={destination}
        onValueChange={(v) => setDestination(v as "local" | "group")}
        disabled={busy}
        options={[
          { value: "local", label: zh ? "本地指令" : "Local instruction" },
          { value: "group", label: zh ? "发送到群" : "Send to group" },
        ]}
      />
      <TextAreaField
        label={
          destination === "local"
            ? zh
              ? "仅在本机执行，结果不自动外发"
              : "Run locally without publishing results"
            : `${zh ? "公开发送到" : "Send publicly to"} ${group.name}`
        }
        value={draft[destination]}
        onValueChange={change}
        disabled={busy}
        rows={3}
      />
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      <Button
        disabled={
          busy ||
          readOnly ||
          !group.confirmed ||
          group.stale ||
          !draft[destination].trim()
        }
        onClick={() => void send()}
      >
        {destination === "local"
          ? zh
            ? "启动本地任务"
            : "Start local task"
          : `${zh ? "发送到" : "Send to"} ${group.name}`}
      </Button>
    </div>
  );
}
