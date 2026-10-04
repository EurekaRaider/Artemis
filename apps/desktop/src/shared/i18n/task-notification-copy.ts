import type { AppLocale, TaskNotificationState } from "@artemis/protocol";
import { TASK_NOTIFICATION_RESOURCES } from "./task-notification-resources.js";

export function taskNotificationCopy(locale: AppLocale) {
  const copy = TASK_NOTIFICATION_RESOURCES[locale];
  return {
    titles: {
      assigned: copy.assigned,
      completed: copy.completed,
      failed: copy.failed,
      "input-required": copy["input-required"],
      "approval-required": copy["approval-required"],
    } satisfies Record<NonNullable<TaskNotificationState["kind"]>, string>,
    actions: {
      assigned: copy.viewTask,
      completed: copy.viewResults,
      failed: copy.viewFailure,
      "input-required": copy.answer,
      "approval-required": copy.review,
    },
    unread: copy.unread,
    background: copy.background,
  };
}
