import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentEvent,
  AgentHostEvent,
  AutomationEvent,
} from "@artemis/protocol";

import { IPC, type ArtemisApi } from "../shared/api.js";
import { readPromptAttachmentsFromFiles } from "./prompt-attachments.js";

const api: ArtemisApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  getThreadEvents: (threadId) => ipcRenderer.invoke(IPC.threadEvents, threadId),
  getTokenUsageEvents: () => ipcRenderer.invoke(IPC.tokenUsageEvents),
  getPromptHistory: () => ipcRenderer.invoke(IPC.promptHistory),
  rendererReady: () => ipcRenderer.send(IPC.rendererReady),
  openProject: () => ipcRenderer.invoke(IPC.projectOpen),
  removeProject: (projectId) =>
    ipcRenderer.invoke(IPC.projectRemove, projectId),
  getProjectGitInfo: (projectId) =>
    ipcRenderer.invoke(IPC.projectGitInfo, projectId),
  switchProjectBranch: (projectId, branchName) =>
    ipcRenderer.invoke(IPC.projectGitBranchSwitch, projectId, branchName),
  createProjectBranch: (projectId, branchName) =>
    ipcRenderer.invoke(IPC.projectGitBranchCreate, projectId, branchName),
  commitProjectChanges: (projectId, message, includeUnstaged) =>
    ipcRenderer.invoke(
      IPC.projectGitCommit,
      projectId,
      message,
      includeUnstaged,
    ),
  pushProjectBranch: (projectId) =>
    ipcRenderer.invoke(IPC.projectGitPush, projectId),
  selectPromptAttachments: () =>
    ipcRenderer.invoke(IPC.promptAttachmentsSelect),
  readPromptAttachments: (files) =>
    readPromptAttachmentsFromFiles(
      files,
      (file) => webUtils.getPathForFile(file),
      (paths) => ipcRenderer.invoke(IPC.promptAttachmentsRead, paths),
    ),
  createThread: (input) => ipcRenderer.invoke(IPC.threadCreate, input),
  setThreadModelSelection: (threadId, selection) =>
    ipcRenderer.invoke(IPC.threadModelSet, threadId, selection),
  renameThread: (threadId, title) =>
    ipcRenderer.invoke(IPC.threadRename, threadId, title),
  setThreadGoal: (threadId, goal) =>
    ipcRenderer.invoke(IPC.threadGoal, threadId, goal),
  archiveThread: (threadId, archived) =>
    ipcRenderer.invoke(IPC.threadArchive, threadId, archived),
  deleteThread: (threadId) => ipcRenderer.invoke(IPC.threadDelete, threadId),
  forkThread: (threadId, entryId) =>
    ipcRenderer.invoke(IPC.threadFork, threadId, entryId),
  compactThread: (threadId, instructions) =>
    ipcRenderer.invoke(IPC.threadCompact, threadId, instructions),
  prepareThread: (threadId) => ipcRenderer.invoke(IPC.threadPrepare, threadId),
  branchizeWorktree: (threadId, branchName) =>
    ipcRenderer.invoke(IPC.worktreeBranchize, threadId, branchName),
  cleanupWorktree: (threadId, force) =>
    ipcRenderer.invoke(IPC.worktreeCleanup, threadId, force),
  restoreWorktreeSnapshot: (worktreeId) =>
    ipcRenderer.invoke(IPC.worktreeRestoreSnapshot, worktreeId),
  handoffWorkspace: (threadId, destination) =>
    ipcRenderer.invoke(IPC.worktreeHandoff, threadId, destination),
  startTurn: (input) => ipcRenderer.invoke(IPC.turnStart, input),
  reportTurnRendered: (turnId, renderedAt) =>
    ipcRenderer.send(IPC.turnRendered, turnId, renderedAt),
  steerTurn: (input) => ipcRenderer.invoke(IPC.turnSteer, input),
  followUpTurn: (input) => ipcRenderer.invoke(IPC.turnFollowUp, input),
  clearTurnQueue: (threadId) =>
    ipcRenderer.invoke(IPC.turnQueueClear, threadId),
  steerTurnQueue: (threadId) =>
    ipcRenderer.invoke(IPC.turnQueueSteer, threadId),
  cancelTurn: (threadId) => ipcRenderer.invoke(IPC.turnCancel, threadId),
  controlChildAgent: (input) =>
    ipcRenderer.invoke(IPC.childAgentControl, input),
  controlAgentTeam: (input) => ipcRenderer.invoke(IPC.agentTeamControl, input),
  resolveApproval: (resolution) =>
    ipcRenderer.invoke(IPC.approvalResolve, resolution),
  resolveUserInput: (resolution) =>
    ipcRenderer.invoke(IPC.userInputResolve, resolution),
  listAutomations: (projectId) =>
    ipcRenderer.invoke(IPC.automationList, projectId),
  listAutomationRuns: (automationId, limit) =>
    ipcRenderer.invoke(IPC.automationRunList, automationId, limit),
  saveAutomation: (input) => ipcRenderer.invoke(IPC.automationSave, input),
  setAutomationEnabled: (id, enabled) =>
    ipcRenderer.invoke(IPC.automationEnable, id, enabled),
  authorizeAutomation: (id) => ipcRenderer.invoke(IPC.automationAuthorize, id),
  deleteAutomation: (id) => ipcRenderer.invoke(IPC.automationDelete, id),
  runAutomationNow: (id) => ipcRenderer.invoke(IPC.automationRunNow, id),
  getReviewDiff: (query) => ipcRenderer.invoke(IPC.reviewDiff, query),
  mutateReviewDiff: (input) => ipcRenderer.invoke(IPC.reviewMutate, input),
  listReviewComments: (threadId) =>
    ipcRenderer.invoke(IPC.reviewCommentList, threadId),
  addReviewComment: (input) => ipcRenderer.invoke(IPC.reviewCommentAdd, input),
  deleteReviewComment: (threadId, commentId) =>
    ipcRenderer.invoke(IPC.reviewCommentDelete, threadId, commentId),
  readWorkspaceTextFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceTextFileRead, threadId, path),
  readWorkspaceImage: (threadId, markdownPath, href) =>
    ipcRenderer.invoke(IPC.workspaceImageRead, threadId, markdownPath, href),
  listWorkspaceDirectory: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceDirectoryList, threadId, path),
  readWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileRead, threadId, path),
  writeWorkspaceFile: (threadId, path, content) =>
    ipcRenderer.invoke(IPC.workspaceFileWrite, threadId, path, content),
  inspectWorkspaceFileLink: (threadId, href) =>
    ipcRenderer.invoke(IPC.workspaceFileLinkInspect, threadId, href),
  revealWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileReveal, threadId, path),
  runWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileRun, threadId, path),
  openTerminal: (input) => ipcRenderer.invoke(IPC.terminalOpen, input),
  writeTerminal: (terminalId, data) =>
    ipcRenderer.invoke(IPC.terminalWrite, terminalId, data),
  resizeTerminal: (terminalId, cols, rows) =>
    ipcRenderer.invoke(IPC.terminalResize, terminalId, cols, rows),
  closeTerminal: (terminalId) =>
    ipcRenderer.invoke(IPC.terminalClose, terminalId),
  onTerminalData(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.terminalData, handler);
    return () => ipcRenderer.removeListener(IPC.terminalData, handler);
  },
  onTerminalExit(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.terminalExit, handler);
    return () => ipcRenderer.removeListener(IPC.terminalExit, handler);
  },
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setLanguage: (language) =>
    ipcRenderer.invoke(IPC.settingsLanguageSet, language),
  setTheme: (theme) => ipcRenderer.invoke(IPC.settingsThemeSet, theme),
  setApprovalPolicy: (policy) =>
    ipcRenderer.invoke(IPC.settingsApprovalPolicySet, policy),
  setLocalFullAccess: (enabled) =>
    ipcRenderer.invoke(IPC.settingsLocalFullAccessSet, enabled),
  setShellRuntimeConfiguration: (configuration) =>
    ipcRenderer.invoke(IPC.settingsShellRuntimeSet, configuration),
  setAgentConcurrency: (preference) =>
    ipcRenderer.invoke(IPC.settingsAgentConcurrencySet, preference),
  setModelSelection: (selection) =>
    ipcRenderer.invoke(IPC.settingsModelSet, selection),
  addModel: (model, apiKey) =>
    ipcRenderer.invoke(IPC.settingsModelAdd, model, apiKey),
  removeModel: (model) => ipcRenderer.invoke(IPC.settingsModelDelete, model),
  setProfileAvatar: (avatar) =>
    ipcRenderer.invoke(IPC.settingsProfileAvatarSet, avatar),
  setProjectOrder: (order) =>
    ipcRenderer.invoke(IPC.settingsProjectOrderSet, order),
  setProjectSidebarWidth: (width) =>
    ipcRenderer.invoke(IPC.settingsProjectSidebarWidthSet, width),
  setWorkspaceDockWidth: (width) =>
    ipcRenderer.invoke(IPC.settingsWorkspaceDockWidthSet, width),
  saveApiKey: (providerId, apiKey) =>
    ipcRenderer.invoke(IPC.settingsApiKeySave, providerId, apiKey),
  saveProviderConnection: (provider, apiKey) =>
    ipcRenderer.invoke(IPC.settingsProviderSave, provider, apiKey),
  deleteProviderConnection: (providerId) =>
    ipcRenderer.invoke(IPC.settingsProviderDelete, providerId),
  deleteCredential: (providerId) =>
    ipcRenderer.invoke(IPC.settingsCredentialDelete, providerId),
  importPiCredentials: () => ipcRenderer.invoke(IPC.settingsPiImport),
  saveGlobalAgents: (content) =>
    ipcRenderer.invoke(IPC.settingsGlobalAgentsSave, content),
  scanConfigurationImports: () => ipcRenderer.invoke(IPC.settingsImportScan),
  importConfiguration: (request) =>
    ipcRenderer.invoke(IPC.settingsImportApply, request),
  saveMcpServer: (config, bearerToken) =>
    ipcRenderer.invoke(IPC.mcpServerSave, config, bearerToken),
  setMcpServerEnabled: (serverId, enabled) =>
    ipcRenderer.invoke(IPC.mcpServerEnable, serverId, enabled),
  reconnectMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerReconnect, serverId),
  authorizeMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerAuthorize, serverId),
  removeMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerRemove, serverId),
  confirmResourceAction: (message) =>
    ipcRenderer.invoke(IPC.resourceConfirm, message),
  listMcpServers: () => ipcRenderer.invoke(IPC.resourceMcpList),
  searchMcpCatalog: (query) => ipcRenderer.invoke(IPC.resourceMcpSearch, query),
  installMcpCatalog: (request) =>
    ipcRenderer.invoke(IPC.resourceMcpInstall, request),
  searchSkillCatalog: (query) =>
    ipcRenderer.invoke(IPC.resourceSkillSearch, query),
  listInstalledSkills: () => ipcRenderer.invoke(IPC.resourceSkillList),
  installSkillCatalog: (skillId, operationId) =>
    ipcRenderer.invoke(IPC.resourceSkillInstall, skillId, operationId),
  installLocalSkill: (operationId) =>
    ipcRenderer.invoke(IPC.resourceSkillInstallLocal, operationId),
  setSkillEnabled: (skillId, enabled) =>
    ipcRenderer.invoke(IPC.resourceSkillEnable, skillId, enabled),
  removeSkill: (skillId) =>
    ipcRenderer.invoke(IPC.resourceSkillRemove, skillId),
  listCodexPlugins: () => ipcRenderer.invoke(IPC.resourcePluginList),
  inspectLocalCodexPlugin: () =>
    ipcRenderer.invoke(IPC.resourcePluginInspectLocal),
  loadCodexPluginMarketplace: (url, operationId, refresh) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceLoad,
      url,
      operationId,
      refresh,
    ),
  getCodexPluginMarketplaces: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceList, sourceId),
  addCodexPluginMarketplace: (url, operationId, signingKeyFingerprint) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceAdd,
      url,
      operationId,
      signingKeyFingerprint,
    ),
  inspectCodexPluginMarketplaceTrust: (url) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceTrust, url),
  inspectOfflineCodexPluginMarketplace: () =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceInspectOffline),
  addOfflineCodexPluginMarketplace: (
    path,
    operationId,
    signingKeyFingerprint,
  ) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceAddOffline,
      path,
      operationId,
      signingKeyFingerprint,
    ),
  getGoogleAccountStatus: () => ipcRenderer.invoke(IPC.googleAccountStatus),
  authorizeGoogleGrant: (grant) =>
    ipcRenderer.invoke(IPC.googleAccountAuthorizeGrant, grant),
  disconnectGoogleGrant: (grant) =>
    ipcRenderer.invoke(IPC.googleAccountDisconnectGrant, grant),
  disconnectGoogleAccount: () =>
    ipcRenderer.invoke(IPC.googleAccountDisconnect),
  selectCodexPluginMarketplace: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceSelect, sourceId),
  refreshCodexPluginMarketplace: (sourceId, operationId) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceRefresh,
      sourceId,
      operationId,
    ),
  removeCodexPluginMarketplace: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceRemove, sourceId),
  reorderCodexPluginMarketplaces: (sourceIds) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceReorder, sourceIds),
  loadCodexRuntimeMarketplace: () =>
    ipcRenderer.invoke(IPC.resourcePluginRuntimeMarketplace),
  installCodexRuntimePlugins: (operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginRuntimeInstall, operationId),
  installCodexPlugin: (source, operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginInstall, source, operationId),
  updateCodexPlugin: (pluginId, operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginUpdate, pluginId, operationId),
  setCodexPluginEnabled: (pluginId, enabled) =>
    ipcRenderer.invoke(IPC.resourcePluginEnable, pluginId, enabled),
  removeCodexPlugin: (pluginId) =>
    ipcRenderer.invoke(IPC.resourcePluginRemove, pluginId),
  trustExtension: () => ipcRenderer.invoke(IPC.extensionTrust),
  retrustExtension: (extensionId) =>
    ipcRenderer.invoke(IPC.extensionRetrust, extensionId),
  setTrustedExtensionEnabled: (extensionId, enabled) =>
    ipcRenderer.invoke(IPC.extensionEnable, extensionId, enabled),
  setTrustedExtensionNetwork: (extensionId, allowNetwork) =>
    ipcRenderer.invoke(IPC.extensionNetwork, extensionId, allowNetwork),
  removeTrustedExtension: (extensionId) =>
    ipcRenderer.invoke(IPC.extensionRemove, extensionId),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  exportDiagnostics: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  reportRendererError: (diagnostic) =>
    ipcRenderer.send(IPC.diagnosticsRendererError, diagnostic),
  onResourceInstallProgress(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.resourceInstallProgress, handler);
    return () =>
      ipcRenderer.removeListener(IPC.resourceInstallProgress, handler);
  },
  onUpdateStatus(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.updateStatus, handler);
    return () => ipcRenderer.removeListener(IPC.updateStatus, handler);
  },
  onAgentEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: AgentEvent) => {
      listener(value);
    };
    ipcRenderer.on(IPC.agentEvent, handler);
    return () => ipcRenderer.removeListener(IPC.agentEvent, handler);
  },
  onAgentEvents(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: AgentEvent[]) =>
      listener(value);
    ipcRenderer.on(IPC.agentEvents, handler);
    return () => ipcRenderer.removeListener(IPC.agentEvents, handler);
  },
  onAgentActivities(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: AgentHostEvent[],
    ) => listener(value);
    ipcRenderer.on(IPC.agentActivities, handler);
    return () => ipcRenderer.removeListener(IPC.agentActivities, handler);
  },
  onAutomationEvent(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: AutomationEvent,
    ) => listener(value);
    ipcRenderer.on(IPC.automationEvent, handler);
    return () => ipcRenderer.removeListener(IPC.automationEvent, handler);
  },
  onAutomationThreadOpen(listener) {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on(IPC.automationThreadOpen, handler);
    return () => ipcRenderer.removeListener(IPC.automationThreadOpen, handler);
  },
};

contextBridge.exposeInMainWorld("artemis", api);
