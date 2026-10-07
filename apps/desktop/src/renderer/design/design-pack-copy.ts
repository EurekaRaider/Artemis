import type { AppLocale } from "@artemis/protocol";
import type { CapabilityPackCopy } from "../capabilities/CapabilityPackPanel.js";
import { officeCopy } from "../office/office-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";

export function designPackCopy(locale: AppLocale): CapabilityPackCopy {
  const copy = officeCopy(locale);
  return {
    ...copy,
    runtime: uiText(locale, "DesignPack.getTheDesignPlugin"),
    manage: uiText(locale, "DesignPack.manageTheDesignPlugin"),
    manageDescription: uiText(locale, "DesignPack.description"),
    shared: uiText(locale, "DesignPack.downloadHint"),
    lite: uiText(locale, "DesignPack.inactiveHint"),
    inUse: uiText(locale, "DesignPack.inUse"),
    removeHint: uiText(locale, "DesignPack.removeHint"),
    offlineMaintenanceHint: copy.offlineMaintenanceHint.replaceAll(
      ".artemis-office",
      ".artemis-design",
    ),
    offlineHint: copy.offlineHint.replaceAll(
      ".artemis-office",
      ".artemis-design",
    ),
  };
}

export interface DesignPackSettingsCopy {
  title: string;
  statusNone: string;
  statusInstalled: string;
  statusUpdate: string;
  manage: string;
  hint: string;
}

export function designPackSettingsCopy(
  locale: AppLocale,
): DesignPackSettingsCopy {
  const copy = designPackCopy(locale);
  const resources = UI_COPY.ResourceCenter_labels[locale];
  return {
    title: uiText(locale, "App_copy.designTab"),
    statusNone: `${resources.disabled} · ${copy.lite}`,
    statusInstalled: resources.enabled,
    statusUpdate: copy.updateAvailable,
    manage: copy.manage,
    hint: copy.manageDescription,
  };
}
