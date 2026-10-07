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
  const selected =
    view.preview === undefined ? view.state?.selection : view.preview;
  const value = selected
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
      <div className="settings-row-label">
        {uiText(locale, "Appearance.visualSkin")}
      </div>
      <Select<string>
        label={uiText(locale, "Appearance.visualSkin")}
        labelVisibility="hidden"
        value={value}
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
        onValueChange={(key) =>
          void run(() => {
            const skin = view.state?.catalog.find(
              (s) => `${s.pluginId}/${s.id}` === key,
            );
            return controller.preview(
              skin ? { pluginId: skin.pluginId, skinId: skin.id } : null,
            );
          })
        }
      />
      <div className="appearance-settings-actions">
        <Button
          disabled={view.busy || view.preview === undefined}
          onClick={() => void run(() => controller.confirmPreview())}
        >
          {uiText(locale, "Appearance.applySkin")}
        </Button>
        <Button
          disabled={view.busy || view.preview === undefined}
          variant="quiet"
          onClick={() => void run(() => controller.cancelPreview())}
        >
          {uiText(locale, "Appearance.cancelPreview")}
        </Button>
        <Button
          disabled={view.busy}
          variant="quiet"
          onClick={() => void run(() => controller.reset())}
        >
          {uiText(locale, "Appearance.restoreDefault")}
        </Button>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {view.diagnostics.map((message) => (
        <InlineNotice key={message} tone="warning">
          {message}
        </InlineNotice>
      ))}
      <p className="appearance-settings-hint">
        {uiText(locale, "Appearance.hint")}
      </p>
    </div>
  );
}
