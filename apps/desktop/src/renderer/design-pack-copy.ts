// Design capability-pack copy (todo ⑤): en/zh-CN/zh-TW translated; other
// locales fall back to English until translated.
import type { AppLocale } from "@artemis/protocol";
import type { CapabilityPackCopy } from "./CapabilityPackPanel.js";

const en: CapabilityPackCopy = {
  runtime: "Get the design plugin",
  manage: "Manage the design plugin",
  manageDescription:
    "The design plugin opens and edits design files in design mode. Updates arrive through the same verified channel.",
  shared: "Download the design plugin to open and edit design files in design mode.",
  lite: "Design mode stays hidden until the plugin is downloaded.",
  working: "Working…",
  cancel: "Cancel download",
  installed: "Installed",
  inactive: "Not active",
  rollback: "Use this version",
  remove: "Remove",
  inUse: "Close design tasks using the plugin before removing it.",
  removeHint:
    "Removing the plugin hides design mode. Your design files and version history are kept.",
  checkFailed: "Could not check for updates. Try again later.",
  updateAvailable: "Version {version} is available",
  updateNow: "Update to {version}",
  upToDate: "You have the latest compatible version.",
  noUpdates: "No compatible online release was found.",
  updatesUnavailable: "Online updates are not available yet.",
  checkUpdates: "Check for updates",
  checkingUpdates: "Checking…",
  offlineMaintenance: "Offline update / repair",
  selectOfflinePack: "Choose offline pack",
  offlineMaintenanceHint:
    "Choose a newer .artemis-design pack to update, or the current version to repair.",
  offlineHint: "Select one .artemis-design file. No extraction is needed.",
  unavailable: "Online installation is not available yet. Import an offline pack.",
  install: "Download",
  offline: "Import offline pack",
  close: "Close",
};

const zh: CapabilityPackCopy = {
  runtime: "获取设计插件",
  manage: "管理设计插件",
  manageDescription:
    "设计插件在设计模式中打开和修改设计文件，更新通过与 Office 能力包相同的签名渠道分发。",
  shared: "下载设计插件后，即可在设计模式中打开和修改设计文件。",
  lite: "下载插件之前，设计模式不会出现。",
  working: "正在处理…",
  cancel: "取消下载",
  installed: "已安装",
  inactive: "未启用",
  rollback: "使用此版本",
  remove: "移除",
  inUse: "请先关闭正在使用插件的设计任务，再移除。",
  removeHint: "移除后设计模式隐藏；你的设计文件和版本历史都会保留。",
  checkFailed: "检查更新失败，请稍后重试。",
  updateAvailable: "有新版本 {version}",
  updateNow: "更新到 {version}",
  upToDate: "已是最新兼容版本。",
  noUpdates: "没有找到可用的在线版本。",
  updatesUnavailable: "在线更新暂不可用。",
  checkUpdates: "检查更新",
  checkingUpdates: "检查中…",
  offlineMaintenance: "离线更新 / 修复",
  selectOfflinePack: "选择离线包",
  offlineMaintenanceHint:
    "选择更新的 .artemis-design 离线包进行更新，或选择当前版本进行修复。",
  offlineHint: "选择一个 .artemis-design 文件，无需解压。",
  unavailable: "在线安装暂不可用，可先导入离线包。",
  install: "下载",
  offline: "导入离线包",
  close: "关闭",
};

const zhTW: CapabilityPackCopy = {
  ...zh,
  runtime: "取得設計外掛",
  manage: "管理設計外掛",
  manageDescription:
    "設計外掛在設計模式中開啟與修改設計檔案，更新與 Office 能力包走相同的簽署渠道。",
  shared: "下載設計外掛後，即可在設計模式中開啟與修改設計檔案。",
  lite: "下載外掛之前，設計模式不會出現。",
  working: "正在處理…",
  cancel: "取消下載",
  installed: "已安裝",
  inactive: "未啟用",
  rollback: "使用此版本",
  remove: "移除",
  inUse: "請先關閉正在使用外掛的設計任務，再移除。",
  removeHint: "移除後設計模式隱藏；你的設計檔案與版本歷史都會保留。",
  checkFailed: "檢查更新失敗，請稍後再試。",
  updateAvailable: "有新版本 {version}",
  updateNow: "更新到 {version}",
  upToDate: "已是最新相容版本。",
  noUpdates: "找不到可用的線上版本。",
  updatesUnavailable: "線上更新暫不可用。",
  checkUpdates: "檢查更新",
  checkingUpdates: "檢查中…",
  offlineMaintenance: "離線更新 / 修復",
  selectOfflinePack: "選擇離線包",
  offlineMaintenanceHint:
    "選擇較新的 .artemis-design 離線包進行更新，或選擇目前版本進行修復。",
  offlineHint: "選擇一個 .artemis-design 檔案，無需解壓。",
  unavailable: "線上安裝暫不可用，可先匯入離線包。",
  install: "下載",
  offline: "匯入離線包",
  close: "關閉",
};

const translations: Partial<Record<AppLocale, CapabilityPackCopy>> = {
  en,
  "zh-CN": zh,
  "zh-TW": zhTW,
};

export function designPackCopy(locale: AppLocale): CapabilityPackCopy {
  return translations[locale] ?? en;
}

/** Settings-row copy: the toggle's title, state line and manage action. */
export interface DesignPackSettingsCopy {
  title: string;
  statusNone: string;
  statusInstalled: string;
  statusUpdate: string;
  manage: string;
  hint: string;
}

const settingsCopy: Partial<Record<AppLocale, DesignPackSettingsCopy>> = {
  en: {
    title: "Design plugin",
    statusNone: "Off — design mode is hidden.",
    statusInstalled: "On — design mode is available.",
    statusUpdate: "On — version {version} is available.",
    manage: "Manage…",
    hint: "Downloading uses the same verified channel as the Office pack.",
  },
  "zh-CN": {
    title: "设计插件",
    statusNone: "关 —— 设计模式隐藏。",
    statusInstalled: "开 —— 设计模式可用。",
    statusUpdate: "开 —— 有新版本 {version} 可更新。",
    manage: "管理…",
    hint: "下载使用与 Office 能力包相同的签名渠道。",
  },
  "zh-TW": {
    title: "設計外掛",
    statusNone: "關 —— 設計模式隱藏。",
    statusInstalled: "開 —— 設計模式可用。",
    statusUpdate: "開 —— 有新版本 {version} 可更新。",
    manage: "管理…",
    hint: "下載使用與 Office 能力包相同的簽署渠道。",
  },
};

export function designPackSettingsCopy(locale: AppLocale): DesignPackSettingsCopy {
  return settingsCopy[locale] ?? settingsCopy.en!;
}
