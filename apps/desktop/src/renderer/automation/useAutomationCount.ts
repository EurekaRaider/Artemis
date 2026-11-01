import type { Automation } from "@artemis/protocol";
import { useEffect, useState } from "react";

/** The navigation badge follows the stored list, without background polling. */
export function useAutomations(): Automation[] | undefined {
  const [automations, setAutomations] = useState<Automation[]>();
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void window.artemis
        .listAutomations()
        .then((automations) => {
          if (mounted && request === revision) setAutomations(automations);
        })
        .catch(() => {
          if (mounted && request === revision) setAutomations(undefined);
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
  return automations;
}

export function useAutomationCount(): number | undefined {
  return useAutomations()?.length;
}
