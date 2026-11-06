import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { SettingsApi } from "../../shared/api/settings.js";
export const settingsBridge: SettingsApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setLanguage: (language) =>
    ipcRenderer.invoke(IPC.settingsLanguageSet, language),
  setTheme: (theme) => ipcRenderer.invoke(IPC.settingsThemeSet, theme),
  setMaterial: (material) =>
    ipcRenderer.invoke(IPC.settingsMaterialSet, material),
  setComposerPredictions: (enabled) =>
    ipcRenderer.invoke(IPC.settingsComposerPredictionsSet, enabled),
  setPreventSleep: (enabled) =>
    ipcRenderer.invoke(IPC.settingsPreventSleepSet, enabled),
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
  setProjectThreadOrder: (projectId, order) =>
    ipcRenderer.invoke(IPC.settingsProjectThreadOrderSet, projectId, order),
  setExpandedProjectIds: (projectIds) =>
    ipcRenderer.invoke(IPC.settingsExpandedProjectIdsSet, projectIds),
  setCollapsedProjectIds: (projectIds) =>
    ipcRenderer.invoke(IPC.settingsCollapsedProjectIdsSet, projectIds),
  setProjectSidebarWidth: (width) =>
    ipcRenderer.invoke(IPC.settingsProjectSidebarWidthSet, width),
  setTemporaryConversationsOpen: (open) =>
    ipcRenderer.invoke(IPC.settingsTemporaryConversationsOpenSet, open),
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
  providerLoginOptions: () => ipcRenderer.invoke(IPC.providerLoginOptions),
  providerLoginStart: (providerId, type) =>
    ipcRenderer.invoke(IPC.providerLoginStart, providerId, type),
  providerLoginStatus: (id) => ipcRenderer.invoke(IPC.providerLoginStatus, id),
  providerLoginAnswer: (id, promptId, value) =>
    ipcRenderer.invoke(IPC.providerLoginAnswer, id, promptId, value),
  providerLoginCancel: (id) => ipcRenderer.invoke(IPC.providerLoginCancel, id),
  importPiCredentials: () => ipcRenderer.invoke(IPC.settingsPiImport),
  saveGlobalAgents: (content) =>
    ipcRenderer.invoke(IPC.settingsGlobalAgentsSave, content),
};
