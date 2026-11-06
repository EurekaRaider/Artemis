import { IPC } from "../../../../src/shared/api.js";
import { imService } from "../../../../src/main/main.js";
import { smokeMode } from "../environment.js";

export function decorateImIpc(
  channel: string,
  next: Parameters<import("electron").IpcMain["handle"]>[1],
) {
  const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
  if (channel === IPC.imStatus && smokeMode && view === "nocturne-group")
    return async () => {
      if (!imService) throw new Error("IM service is not ready.");
      const status = await imService.status();
      if (smokeMode && process.env.ARTEMIS_SMOKE_VIEW === "nocturne-group") {
        const identity = (userId: string) => ({
          userId,
          channel: "slack" as const,
          connectionId: "artemis-smoke-group",
          appId: "artemis-smoke-bot",
          tenantId: "artemis-smoke-team",
        });
        return {
          ...status,
          remoteTasks: [
            {
              threadId: "artemis-smoke-environment-thread",
              kind: "group",
              channel: "slack",
              connectionState: "connected",
              group: {
                spaceId: "artemis-smoke-team",
                name: "Synthetic review team",
                confirmed: true,
                stale: false,
                ...(process.env.ARTEMIS_SMOKE_REVIEW06_STATE ===
                "notice-retired"
                  ? { retired: "archived" as const }
                  : {}),
                executingDeviceId: "artemis-smoke-reviewer",
                members: [
                  {
                    deviceId: "artemis-smoke-local",
                    identity: identity("synthetic-local"),
                    name: "Synthetic member",
                    deviceName: "Test Mac",
                    state: "online",
                  },
                  {
                    deviceId: "artemis-smoke-reviewer",
                    identity: identity("synthetic-reviewer"),
                    name: "Synthetic reviewer",
                    deviceName: "Test PC",
                    state: "online",
                  },
                ],
              },
              delegationWaits: [
                {
                  id: "artemis-smoke-wait",
                  state: "waiting",
                  deadline: Date.now() + 300_000,
                  taskIds: ["artemis-smoke-remote-task"],
                  continuation: "Review the synthetic changes",
                },
              ],
            },
          ],
        };
      }
      return status;
    };
  return next;
}
