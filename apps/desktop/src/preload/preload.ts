import { contextBridge } from "electron";
import type { ArtemisApi } from "../shared/api.js";
import { computerBridge } from "./bridges/computer.js";
import { hooksBridge } from "./bridges/hooks.js";
import { taskNotificationsBridge } from "./bridges/task-notifications.js";
import { imBridge } from "./bridges/im.js";
import { historyBridge } from "./bridges/history.js";
import { projectsBridge } from "./bridges/projects.js";
import { attachmentsBridge } from "./bridges/attachments.js";
import { conversationBridge } from "./bridges/conversation.js";
import { automationBridge } from "./bridges/automation.js";
import { reviewBridge } from "./bridges/review.js";
import { workspacePreviewsBridge } from "./bridges/workspace-previews.js";
import { officeBridge } from "./bridges/office.js";
import { designBridge } from "./bridges/design.js";
import { workspaceFilesBridge } from "./bridges/workspace-files.js";
import { terminalBridge } from "./bridges/terminal.js";
import { appearanceBridge } from "./bridges/appearance.js";
import { settingsBridge } from "./bridges/settings.js";
import { customAgentsBridge } from "./bridges/custom-agents.js";
import { configurationImportBridge } from "./bridges/configuration-import.js";
import { mcpBridge } from "./bridges/mcp.js";
import { skillsBridge } from "./bridges/skills.js";
import { integrationsBridge } from "./bridges/integrations.js";
import { extensionsBridge } from "./bridges/extensions.js";
import { updatesDiagnosticsBridge } from "./bridges/updates-diagnostics.js";
import { eventsBridge } from "./bridges/events.js";

const api: ArtemisApi = {
  ...computerBridge,
  ...hooksBridge,
  ...taskNotificationsBridge,
  ...imBridge,
  ...historyBridge,
  ...projectsBridge,
  ...attachmentsBridge,
  ...conversationBridge,
  ...automationBridge,
  ...reviewBridge,
  ...workspacePreviewsBridge,
  ...officeBridge,
  ...designBridge,
  ...workspaceFilesBridge,
  ...terminalBridge,
  ...appearanceBridge,
  ...settingsBridge,
  ...customAgentsBridge,
  ...configurationImportBridge,
  ...mcpBridge,
  ...skillsBridge,
  ...integrationsBridge,
  ...extensionsBridge,
  ...updatesDiagnosticsBridge,
  ...eventsBridge,
};
contextBridge.exposeInMainWorld("artemis", api);
