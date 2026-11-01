import { uiText } from "../../shared/i18n/ui-text.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@artemis/ui/actions";
import { Select } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { AppLocale } from "@artemis/protocol";
import { getAppearanceController } from "./appearance-controller.js";

export function AppearanceSettingsSection({
  locale,
}: {
  readonly locale: AppLocale;
}) {
  if (typeof window.artemis?.getAppearanceState !== "function") return null;
  return <ConnectedAppearanceSettingsSection locale={locale} />;
}
function ConnectedAppearanceSettingsSection({
  locale,
}: {
  readonly locale: AppLocale;
}) {
  const controller = getAppearanceController();
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string>();
  const selected =
    view.preview === undefined ? view.state?.selection : view.preview;
  const currentValue = selected
    ? `${selected.pluginId}/${selected.skinId}`
    : "default";
  useEffect(
    () => () => {
      if (controller.snapshot().preview !== undefined)
        void controller.cancelPreview();
    },
    [controller],
  );
  if (!view.state) return null;
  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="appearance-settings">
      <div className="appearance-settings-copy">
        <div className="settings-row-label">
          {uiText(locale, "Appearance.visualSkin")}
        </div>
        <p className="appearance-settings-hint">
          {uiText(locale, "Appearance.hint")}
        </p>
      </div>
      <div className="appearance-settings-controls">
        <Select<string>
          label={uiText(locale, "Appearance.visualSkin")}
          labelVisibility="hidden"
          value={draft ?? currentValue}
          disabled={view.busy}
          options={[
            {
              value: "default",
              label: uiText(locale, "Appearance.artemisDefault"),
            },
            ...view.state.catalog.map((s) => ({
              value: `${s.pluginId}/${s.id}`,
              label: `${s.name} · ${s.version} · ${s.pluginName}${s.available ? "" : uiText(locale, "Appearance.unavailable")}`,
              disabled: !s.available,
            })),
          ]}
          onValueChange={(key) => {
            setDraft(key);
            if (view.preview !== undefined)
              void run(() => controller.cancelPreview());
          }}
        />
        <div className="appearance-settings-actions">
          <Button
            disabled={view.busy}
            onClick={() =>
              void run(async () => {
                if (view.preview !== undefined) {
                  await controller.confirmPreview();
                  setDraft(undefined);
                } else {
                  const skin = view.state?.catalog.find(
                    (s) => `${s.pluginId}/${s.id}` === (draft ?? currentValue),
                  );
                  await controller.preview(
                    skin ? { pluginId: skin.pluginId, skinId: skin.id } : null,
                  );
                }
              })
            }
          >
            {uiText(
              locale,
              view.preview === undefined
                ? "Review02.preview"
                : "Review02.apply",
            )}
          </Button>
          {view.preview !== undefined && (
            <Button
              disabled={view.busy}
              variant="quiet"
              onClick={() =>
                void run(async () => {
                  await controller.cancelPreview();
                  setDraft(undefined);
                })
              }
            >
              {uiText(locale, "App_copy.renameCancel")}
            </Button>
          )}
        </div>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {view.diagnostics.map((message) => (
        <InlineNotice key={message} tone="warning">
          {message}
        </InlineNotice>
      ))}
    </div>
  );
}
