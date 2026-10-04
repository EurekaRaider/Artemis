import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";

export function workspaceFileError(reason: unknown, locale: AppLocale): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const limit = /Workspace (?:preview )?file exceeds (\d+) MiB\./u.exec(
    message,
  )?.[1];
  return limit
    ? uiText(locale, "WorkspaceFilesPanel.fileTooLarge", {
        limit: Number(limit),
      })
    : message;
}
