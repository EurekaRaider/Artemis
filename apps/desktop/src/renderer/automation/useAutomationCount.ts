import { useEffect, useState } from "react";

/** The navigation badge follows the stored list, without background polling. */
export function useAutomationCount(): number | undefined {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void window.artemis
        .listAutomations()
        .then((automations) => {
          if (mounted && request === revision) setCount(automations.length);
        })
        .catch(() => {
          if (mounted && request === revision) setCount(undefined);
        });
    };
    const unsubscribe = window.artemis.onAutomationEvent((event) => {
      if (event.payload.type !== "automation-run.upserted") refresh();
    });
    refresh();
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return count;
}
