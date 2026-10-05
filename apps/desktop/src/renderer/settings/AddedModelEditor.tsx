import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentModelInfo, AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { TextField } from "@artemis/ui/forms";
import type {
  AddedModelConfiguration,
  SettingsSnapshot,
} from "../../shared/api.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";

export function AddedModelEditor({
  model,
  catalogModel,
  settings,
  locale,
  busy,
  onSave,
  onCancel,
}: {
  model: AddedModelConfiguration;
  catalogModel: AgentModelInfo | undefined;
  settings: SettingsSnapshot;
  locale: AppLocale;
  busy: boolean;
  onSave(model: AddedModelConfiguration, apiKey?: string): Promise<void>;
  onCancel(): void;
}) {
  const t = UI_COPY.SettingsPanel_labels[locale];
  const [contextWindow, setContextWindow] = useState(
    String(model.contextWindow),
  );
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const contextInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const credential = settings.credentials.find(
    (item) => item.providerId === model.providerId && item.type === "api_key",
  );
  const parsedContextWindow = Number(contextWindow);
  const valid = Boolean(
    catalogModel &&
    Number.isInteger(parsedContextWindow) &&
    parsedContextWindow >= 1_024 &&
    parsedContextWindow <= catalogModel.contextWindow &&
    (catalogModel.configured || credential),
  );
  const title = `${t.edit}: ${catalogModel?.name ?? model.modelId}`;

  useEffect(() => {
    contextInputRef.current?.focus({ preventScroll: true });
    formRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  useEffect(() => {
    if (error) actionsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !valid) return;
    setError("");
    try {
      await onSave({ ...model, contextWindow: parsedContextWindow }, undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <form
      aria-label={title}
      aria-busy={busy}
      className="added-model-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onCancel();
        }
      }}
      onSubmit={(event) => void save(event)}
      ref={formRef}
    >
      <strong className="added-model-editor-title">{title}</strong>
      <TextField
        description={
          catalogModel
            ? t.contextWindowHint.replace(
                "{limit}",
                catalogModel.contextWindow.toLocaleString(locale),
              )
            : undefined
        }
        disabled={busy || !catalogModel}
        inputRef={contextInputRef}
        label={t.contextWindow}
        max={catalogModel?.contextWindow}
        min={1_024}
        onValueChange={setContextWindow}
        required
        size="compact"
        step={1}
        type="number"
        value={contextWindow}
      />
      {error && (
        <InlineNotice title={t.modelSaveFailed} tone="danger">
          {error}
        </InlineNotice>
      )}
      <div className="added-model-editor-actions" ref={actionsRef}>
        <Button disabled={busy} onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button
          disabled={!valid || busy}
          loading={busy}
          type="submit"
          variant="primary"
        >
          {t.saveChanges}
        </Button>
      </div>
    </form>
  );
}
