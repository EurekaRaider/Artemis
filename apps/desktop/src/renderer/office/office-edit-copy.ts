import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";

export function officeEditCopy(locale: AppLocale) {
  return {
    copy: uiText(locale, "OfficeEdit.workingCopy"),
    destination: uiText(locale, "OfficeEdit.savedTo"),
    text: uiText(locale, "OfficeEdit.editText"),
    pending: uiText(locale, "OfficeEdit.unsavedChanges"),
    hint: uiText(locale, "OfficeEdit.hint"),
  };
}
