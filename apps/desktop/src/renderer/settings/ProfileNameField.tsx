import { useState } from "react";
import { TextField } from "@artemis/ui/forms";

import { PROFILE_NAME_MAX_CHARACTERS } from "../../shared/profile-name.js";

/** Saves on Enter or blur; blank or the default name clears the saved name. */
export function ProfileNameField({
  label,
  savedName,
  defaultName,
  disabled,
  onCommit,
}: {
  label: string;
  savedName: string | undefined;
  defaultName: string;
  disabled: boolean;
  onCommit: (name: string | undefined) => void;
}) {
  const effective = savedName ?? defaultName;
  const [draft, setDraft] = useState(effective);
  const [shown, setShown] = useState(effective);
  if (shown !== effective) {
    setShown(effective);
    setDraft(effective);
  }
  function commit() {
    const next = draft.replace(/\s+/gu, " ").trim() || defaultName;
    setDraft(next);
    if (next !== effective) onCommit(next === defaultName ? undefined : next);
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <TextField
        autoComplete="off"
        disabled={disabled}
        label={label}
        labelVisibility="hidden"
        maxLength={PROFILE_NAME_MAX_CHARACTERS}
        onBlur={commit}
        onValueChange={setDraft}
        placeholder={defaultName}
        size="compact"
        spellCheck={false}
        value={draft}
      />
    </form>
  );
}
