import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { SkillsApi } from "../../shared/api/skills.js";
export const skillsBridge: SkillsApi = {
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
};
