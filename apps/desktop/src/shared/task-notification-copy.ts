import type { AppLocale, TaskNotificationState } from "@artemis/protocol";

export function taskNotificationCopy(locale: AppLocale) {
  const zh = locale.startsWith("zh");
  return {
    titles: {
      completed: zh ? "任务已完成" : "Task completed",
      failed: zh ? "任务执行失败" : "Task failed",
      "input-required": zh ? "任务等待你的输入" : "Task needs your input",
      "approval-required": zh ? "任务需要你的审批" : "Task needs your approval",
    } satisfies Record<NonNullable<TaskNotificationState["kind"]>, string>,
    actions: {
      completed: zh ? "点击查看结果" : "Click to view results",
      failed: zh ? "点击查看原因" : "Click to view details",
      "input-required": zh ? "点击回答" : "Click to answer",
      "approval-required": zh ? "点击处理" : "Click to review",
    },
    unread: zh ? "未读状态更新" : "Unread task update",
    background: zh
      ? "本轮回复已完成，后台进程仍在运行"
      : "Response completed; background processes are still running",
  };
}
