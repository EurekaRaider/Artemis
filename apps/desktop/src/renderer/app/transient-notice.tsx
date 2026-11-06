import { Toast } from "@artemis/ui/feedback";

import { type ToastState } from "./app-types.js";
export function TransientNotice({
  dismissLabel,
  notice,
  onDismiss,
  placement,
}: {
  dismissLabel: string;
  notice: ToastState;
  onDismiss(): void;
  placement: "composer" | "view";
}) {
  const error = typeof notice.content !== "string" && "error" in notice.content;
  const success =
    typeof notice.content !== "string" && "success" in notice.content;
  return (
    <Toast
      className={`transient-notice ${placement}-notice${error ? " error" : ""}${notice.fading ? " fading" : ""}`}
      dismissLabel={dismissLabel}
      exiting={notice.fading}
      onDismiss={onDismiss}
      tone={error ? "danger" : success ? "success" : "info"}
    >
      {typeof notice.content === "string"
        ? notice.content
        : notice.content.message}
    </Toast>
  );
}
