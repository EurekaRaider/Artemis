import { lazy } from "react";

export const DesignPluginPanel = lazy(() =>
  import("../design/DesignPluginPanel.js").then((module) => ({
    default: module.DesignPluginPanel,
  })),
);

export const OfficeFilePanel = lazy(() =>
  import("../office/OfficeFilePanel.js").then((module) => ({
    default: module.OfficeFilePanel,
  })),
);

export const loadAutomationPage = () =>
  import("../automation/AutomationPage.js");

export const loadResourceCenter = () => import("../plugins/ResourceCenter.js");

export const loadSettingsPanel = () => import("./SettingsPanel.js");

export const loadTerminalPanel = () => import("../terminal/TerminalPanel.js");

export const loadTokenUsagePage = () =>
  import("../conversation/TokenUsagePage.js");

export const ComputerUseControls = lazy(() =>
  import("../computer-use/ComputerUseControls.js").then((module) => ({
    default: module.ComputerUseControls,
  })),
);

export const ComputerPreview = lazy(() =>
  import("../computer-use/ComputerPreview.js").then((module) => ({
    default: module.ComputerPreview,
  })),
);

export const AutomationPage = lazy(() =>
  loadAutomationPage().then((module) => ({ default: module.AutomationPage })),
);

export const HookTaskNotice = lazy(() =>
  import("../hooks/HookTaskNotice.js").then((module) => ({
    default: module.HookTaskNotice,
  })),
);

export const ResourceCenter = lazy(() =>
  loadResourceCenter().then((module) => ({ default: module.ResourceCenter })),
);

export const SettingsPanel = lazy(() =>
  loadSettingsPanel().then((module) => ({ default: module.SettingsPanel })),
);

export const TerminalPanel = lazy(() =>
  loadTerminalPanel().then((module) => ({ default: module.TerminalPanel })),
);

export const TokenUsagePage = lazy(() =>
  loadTokenUsagePage().then((module) => ({ default: module.TokenUsagePage })),
);
