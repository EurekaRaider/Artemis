import type { AppLocale } from "@artemis/protocol";
import { I18N_RESOURCES } from "./i18n-resources.js";
import { STATUS_RESOURCES } from "./status-resources.js";
import { uiText } from "./ui-text.js";

export function statusText(locale: AppLocale, state: string): string {
  const extra = STATUS_RESOURCES[locale] as Record<string, string>;
  if (Object.hasOwn(extra, state)) return extra[state]!;
  switch (state) {
    case "active":
    case "running":
    case "working":
      return uiText(locale, "App_copy_9734.running");
    case "done":
    case "complete":
    case "completed":
      return uiText(locale, "App_copy.completed");
    case "failed":
      return uiText(locale, "App_copy.failed");
    case "idle":
    case "ready":
      return uiText(locale, "App_copy.ready");
    case "enabled":
      return I18N_RESOURCES[locale].common.enabled;
    case "disabled":
      return I18N_RESOURCES[locale].common.disabled;
    case "error":
      return I18N_RESOURCES[locale].common.error;
    case "queued":
      return uiText(locale, "App_childStatusLabels.queued");
    case "paused":
      return uiText(locale, "AutomationPage_text.paused");
    case "cancelling":
      return uiText(locale, "App_copy_9734.cancelling");
    case "cancelled":
      return uiText(locale, "App_copy.inputCancelled");
    case "waiting-approval":
      return I18N_RESOURCES[locale].app.waiting;
    case "connected":
      return uiText(locale, "ImNavigation.message12");
    case "connecting":
      return uiText(locale, "ImNavigation.message11");
    case "dm":
      return extra.direct!;
    default:
      return state;
  }
}
