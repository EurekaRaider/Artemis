import { appLocaleSchema } from "@artemis/protocol";
import { configureApplicationHost } from "../../../src/main/application/application-host.js";
import { smokeMode } from "./environment.js";
import {
  configureSmokeSettings,
  seedSmokeWorkspace,
  seedSmokeResources,
} from "./startup.js";
import { seedSmokeMultiQuestionUiFixture } from "./user-input.js";
import {
  installSmokeWindow,
  smokeWindowOptions,
} from "../../../scripts/verify/ui/smoke/window-capture.js";
import { decorateImIpc } from "./ipc/im.js";
import { decorateMcpIpc } from "./ipc/mcp.js";
import { decorateResourcesIpc } from "./ipc/resources.js";
import { decorateWorkspaceIpc } from "./ipc/workspace.js";
import { decorateConversationIpc } from "./ipc/conversation.js";

export function installSmokeHost(): void {
  const locale = appLocaleSchema.safeParse(process.env.ARTEMIS_SMOKE_LOCALE);
  configureApplicationHost({
    ...(smokeMode && locale.success ? { locale: locale.data } : {}),
    ...(smokeMode ? { userName: "Artemis" } : {}),
    notificationsEnabled: !smokeMode,
    resumeGoals: !smokeMode,
    resumeInterruptedTurns: !(
      smokeMode && process.env.ARTEMIS_SMOKE_REVIEW06 === "1"
    ),
    showStartupErrors: !smokeMode,
    windowOptions: smokeWindowOptions,
    windowCreated: installSmokeWindow,
    configureSettings: configureSmokeSettings,
    workspaceReady: seedSmokeWorkspace,
    resourcesReady: seedSmokeResources,
    beforeWindowCreated: seedSmokeMultiQuestionUiFixture,
    decorateIpc: (channel, handler) =>
      [
        decorateImIpc,
        decorateMcpIpc,
        decorateResourcesIpc,
        decorateWorkspaceIpc,
        decorateConversationIpc,
      ].reduce((next, decorate) => decorate(channel, next), handler),
  });
}
