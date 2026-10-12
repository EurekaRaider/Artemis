import { useLayoutEffect } from "react";

/** Share one read acknowledgement path for mouse, keyboard and native notification opens. */
export function useTaskNotificationRead(
  threadId: string | undefined,
  seenSeq: number | undefined,
  dockOpen?: boolean,
): void {
  useLayoutEffect(() => {
    const report = () => {
      const visible =
        document.visibilityState === "visible" && document.hasFocus();
      window.artemis.reportTaskView?.({
        ...(visible && threadId
          ? { threadId, ...(seenSeq === undefined ? {} : { seenSeq }) }
          : {}),
        ...(dockOpen === undefined ? {} : { dockOpen }),
      });
    };
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
      document.removeEventListener("visibilitychange", report);
      window.artemis.reportTaskView?.({});
    };
  }, [threadId, seenSeq, dockOpen]);
}
