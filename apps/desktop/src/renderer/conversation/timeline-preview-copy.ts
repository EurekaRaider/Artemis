import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";

export function timelinePreviewCopy(locale: AppLocale) {
  return {
    open: uiText(locale, "TimelinePreview.openInSidePanel"),
    loading: uiText(locale, "TimelinePreview.loadingPreview"),
    failed: uiText(locale, "TimelinePreview.previewUnavailable"),
    retry: uiText(locale, "App_copy.queueRetry"),
    enlarge: uiText(locale, "TimelinePreview.enlarge"),
    close: uiText(locale, "DesignPanel.close"),
    source: uiText(locale, "TimelinePreview.viewSource"),
    copy: uiText(locale, "TimelinePreview.copySource"),
    copied: uiText(locale, "EnvironmentPullRequestError_labels.copied"),
    copyFailed: uiText(locale, "TimelinePreview.copyFailedRetry"),
    diagram: uiText(locale, "TimelinePreview.diagram"),
    audioFailed: uiText(locale, "TimelinePreview.audioFailed"),
    refresh: uiText(locale, "DesignPanel.refreshPreview"),
    htmlNote: uiText(locale, "TimelinePreview.htmlNote"),
  };
}
